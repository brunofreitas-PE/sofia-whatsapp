const express = require("express");
const router = express.Router();
const { sendText, uploadMedia, sendImageByMediaId } = require("../lib/whatsapp");
const {
  interpretFeedback,
  reviseSuggestion,
  classifyDecision,
  generateImageSpec,
  classificarConfirmacaoPublicacao,
} = require("../lib/claude");
const { transcribeAudio } = require("../lib/transcribe");
const { load, save } = require("../lib/store");
const { renderSlides } = require("../lib/render");
const { gerarImagemIA } = require("../lib/imagegen");

// Formatos que precisam de imagem pronta depois da aprovação (reel/story ficam só
// no roteiro + textos de tela, porque o Bruno grava com o próprio celular).
function precisaDeImagem(format) {
  const f = (format || "").toLowerCase();
  return f.includes("post simples") || f.includes("carross");
}

// Gera as imagens da sugestão aprovada e manda pelo WhatsApp, uma por uma. Os
// slides (com o imagePrompt de cada imagem) já vêm prontos desde a hora em que a
// sugestão foi gerada (ver generateSuggestion em claude.js e scheduler.js) — assim a
// imagem gerada aqui é garantidamente a mesma que o Bruno já viu descrita na
// mensagem original, em vez de duas chamadas desconectadas. Só cai no
// generateImageSpec (fallback) se por algum motivo não tiver slides salvos (ex:
// sugestão antiga, de antes dessa versão). Toda imagem (capa do post simples, ou
// cada slide do carrossel) é gerada por IA via OpenAI (server/lib/imagegen.js). Se a
// chave não estiver configurada, ou a geração de algum slide falhar, esse slide cai
// de volta pro fluxo padrão (foto de banco/ícone) em vez de travar o post inteiro.
async function gerarEEnviarImagens({ to, pendingSuggestion }) {
  await sendText(to, "Show! Gerando as imagens do post, só um instante... 🎨");

  let slides = pendingSuggestion.slides;
  if (!Array.isArray(slides) || slides.length === 0) {
    console.error(
      "[webhook] sugestão pendente sem slides salvos — usando generateImageSpec como fallback."
    );
    const spec = await generateImageSpec({
      calendarItem: pendingSuggestion.calendarItem,
      suggestionText: pendingSuggestion.text,
    });
    slides = spec.slides;
  }

  const especialidade =
    pendingSuggestion.calendarItem?.especialidade || pendingSuggestion.calendarItem?.title;

  let imagensIA = null;
  if (!process.env.OPENAI_API_KEY) {
    console.error("[webhook] OPENAI_API_KEY não configurada — usando foto de banco/ícone no lugar da IA.");
  } else {
    imagensIA = [];
    for (const slide of slides) {
      if (!slide.imagePrompt) {
        imagensIA.push(null);
        continue;
      }
      try {
        imagensIA.push(await gerarImagemIA(slide.imagePrompt));
      } catch (err) {
        console.error("[webhook] falha ao gerar imagem por IA de um slide:", err.message);
        imagensIA.push(null); // esse slide cai pro padrão (foto de banco/texto), não trava o post inteiro
      }
    }
  }

  const pngBuffers = await renderSlides(slides, especialidade, pendingSuggestion.date, imagensIA);
  for (let i = 0; i < pngBuffers.length; i++) {
    const mediaId = await uploadMedia(pngBuffers[i]);
    const isUltima = i === pngBuffers.length - 1;
    const caption = isUltima ? "Imagem(ns) pronta(s) pra postar! 📲" : undefined;
    await sendImageByMediaId(to, mediaId, caption);
  }
}

// A Meta chama essa rota UMA VEZ, na hora que você cadastra o webhook no painel,
// só pra confirmar que o servidor é seu.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Toda mensagem que chega no número (texto, áudio, etc.) cai aqui.
router.post("/", async (req, res) => {
  // Responde rápido pra Meta não reenviar o webhook por timeout — o processamento
  // de verdade continua depois, de forma assíncrona.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) {
      // Não é mensagem nova — pode ser um status (enviado/entregue/lido/FALHOU) de
      // uma mensagem que a própria Sofia mandou (ex: o template das 8h). A Meta manda
      // isso pra cá, mas antes a gente simplesmente ignorava — por isso uma falha de
      // entrega do template nunca aparecia em lugar nenhum. Agora loga no Railway
      // (aba Deployments > View Logs) pra dar pra investigar.
      const statuses = change?.statuses;
      if (Array.isArray(statuses)) {
        for (const s of statuses) {
          if (s.status === "failed") {
            console.error(
              `[webhook] FALHA ao entregar mensagem (id ${s.id}):`,
              JSON.stringify(s.errors || s, null, 2)
            );
          } else {
            console.log(`[webhook] status da mensagem ${s.id}: ${s.status}`);
          }
        }
      }
      return;
    }

    const from = message.from;
    let text = null;

    if (message.type === "text") {
      text = message.text.body;
    } else if (message.type === "audio") {
      text = await transcribeAudio(message.audio.id);
    } else {
      await sendText(from, "Por enquanto só entendo texto ou áudio 🙂");
      return;
    }

    const state = load();
    if (!state.pendingSuggestion) {
      await sendText(from, "Não tem nenhuma sugestão pendente agora.");
      return;
    }

    // Às 8h a Sofia manda só um template (ver scheduler.js), porque a janela de
    // 24h pode estar fechada — a sugestão completa fica guardada, esperando o
    // Bruno responder qualquer coisa pra reabrir a janela. Essa é exatamente essa
    // primeira resposta: manda a sugestão de verdade agora, e NÃO trata essa
    // mensagem como feedback sobre um conteúdo que ele ainda nem viu (por isso
    // retorna aqui, sem cair no interpretFeedback/classifyDecision abaixo).
    if (state.pendingSuggestion.textoEnviado === false) {
      await sendText(from, state.pendingSuggestion.text);
      state.pendingSuggestion.textoEnviado = true;
      save(state);
      return;
    }

    // Se o post já foi aprovado antes, a mensagem pode ser só o Bruno avisando que
    // já publicou (ex: "postei") — isso não é feedback sobre o CONTEÚDO da
    // sugestão, então não faz sentido passar pelo interpretFeedback/classifyDecision
    // normal (que ia tentar reinterpretar isso como ajuste/aprovação do texto). Só
    // atualiza o status e para por aqui; os lembretes das 13h/18h (scheduler.js)
    // checam esse status pra saber se ainda precisam avisar.
    if (
      state.pendingSuggestion.status === "aprovado" ||
      state.pendingSuggestion.status === "publicado"
    ) {
      const jaPublicou = await classificarConfirmacaoPublicacao(text);
      if (jaPublicou) {
        state.pendingSuggestion.status = "publicado";
        save(state);
        await sendText(from, "Show, marcado como publicado! ✅");
        return;
      }
    }

    // Classifica ANTES de gerar qualquer resposta de texto — pra decidir qual dos
    // dois caminhos abaixo seguir (ver motivo no comentário da branch de
    // ajuste/rejeição logo adiante).
    const decision = await classifyDecision({
      suggestion: state.pendingSuggestion.text,
      feedbackText: text,
    });

    if (decision === "aprovado") {
      // Aprovação não muda o conteúdo — só precisa de uma confirmação natural,
      // não precisa reconstruir texto/slides (ver interpretFeedback em claude.js).
      const reply = await interpretFeedback({
        suggestion: state.pendingSuggestion.text,
        feedbackText: text,
      });
      await sendText(from, reply);

      state.pendingSuggestion.status = "aprovado";
      state.history.push({ from, text, reply, decision, at: new Date().toISOString() });
      save(state); // salva a aprovação já, antes de tentar gerar imagem (que pode falhar)

      // O "reply" acima é só uma confirmação curta — não garante que a legenda/
      // hashtags de verdade estejam escritas por extenso ali. Pra garantir que o
      // Bruno sempre tenha a copy pronta pra copiar e colar, reenvia aqui o texto
      // completo (pendingSuggestion.text), sempre junto da aprovação, antes (ou no
      // lugar, se não precisar de imagem) das imagens.
      await sendText(from, state.pendingSuggestion.text);

      if (precisaDeImagem(state.pendingSuggestion.format)) {
        try {
          await gerarEEnviarImagens({ to: from, pendingSuggestion: state.pendingSuggestion });
        } catch (err) {
          console.error("[webhook] falha ao gerar/enviar imagens:", err.response?.data || err.message);
          await sendText(
            from,
            "Consegui registrar a aprovação, mas tive um problema gerando as imagens agora. Vou deixar anotado o erro — pode tentar de novo em alguns minutos, ou me avisa se continuar falhando."
          );
        }
      }
      return;
    }

    // "ajuste" (mudança pedida, incluindo "quero outro assunto") ou "rejeitado"
    // (Sofia precisa propor uma alternativa): regenera o PACOTE INTEIRO (texto +
    // slides, com reviseSuggestion em claude.js) refletindo o pedido, e salva esse
    // resultado de volta em pendingSuggestion ANTES de qualquer aprovação futura.
    //
    // Isso corrige um bug real (09/10/2026): antes, esse caminho só gerava uma
    // resposta de texto solta (interpretFeedback), sem nunca atualizar
    // pendingSuggestion.text/.slides — então, se o Bruno aprovasse essa resposta
    // revisada (ex: pediu "outro assunto", gostou do novo, aprovou), a geração de
    // imagem continuava usando os slides da sugestão ORIGINAL (o assunto que ele
    // tinha acabado de recusar), porque era isso que ainda estava salvo. Agora,
    // qualquer ajuste/alternativa já fica salvo como a nova pendingSuggestion, então
    // uma aprovação posterior sempre bate com o que o Bruno realmente viu por último.
    try {
      const revisado = await reviseSuggestion({
        suggestion: state.pendingSuggestion.text,
        calendarItem: state.pendingSuggestion.calendarItem,
        feedbackText: text,
      });
      state.pendingSuggestion.text = revisado.text;
      state.pendingSuggestion.slides = revisado.slides;
      state.pendingSuggestion.status = "aguardando";
      state.history.push({ from, text, reply: revisado.text, decision, at: new Date().toISOString() });
      save(state);
      await sendText(from, revisado.text);
    } catch (err) {
      console.error("[webhook] falha ao revisar sugestão:", err.response?.data || err.message);
      await sendText(
        from,
        "Entendi o que você pediu, mas tive um problema gerando a versão revisada agora. Pode tentar de novo em instantes?"
      );
    }
  } catch (err) {
    console.error("[webhook] erro processando mensagem:", err);
  }
});

module.exports = router;
// Exportada à parte (o router em si é só as rotas do webhook) pra poder ser
// reaproveitada numa rota de debug em index.js (ver /debug/gerar-imagens-aprovado) —
// usada quando uma sugestão foi aprovada mas a imagem gerada não bateu com o que foi
// aprovado (ex: bug corrigido em 09/10, ver claude/sofia-whatsapp-setup.md), pra gerar
// e mandar as imagens certas manualmente, sem precisar esperar o próximo post do dia.
module.exports.gerarEEnviarImagens = gerarEEnviarImagens;
