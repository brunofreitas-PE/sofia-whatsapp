const express = require("express");
const router = express.Router();
const { sendText, uploadMedia, sendImageByMediaId } = require("../lib/whatsapp");
const {
  interpretFeedback,
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

// Gera as imagens da sugestão aprovada e manda pelo WhatsApp, uma por uma. Toda
// imagem (capa do post simples, ou cada slide do carrossel) é gerada por IA via
// OpenAI (server/lib/imagegen.js) — é o padrão agora, não precisa pedir. Se a chave
// não estiver configurada, ou a geração de algum slide falhar, esse slide cai de
// volta pro fluxo padrão (foto de banco/ícone) em vez de travar o post inteiro.
async function gerarEEnviarImagens({ to, pendingSuggestion }) {
  await sendText(to, "Show! Gerando as imagens do post, só um instante... 🎨");
  const spec = await generateImageSpec({
    calendarItem: pendingSuggestion.calendarItem,
    suggestionText: pendingSuggestion.text,
  });
  const especialidade =
    pendingSuggestion.calendarItem?.especialidade || pendingSuggestion.calendarItem?.title;

  let imagensIA = null;
  if (!process.env.OPENAI_API_KEY) {
    console.error("[webhook] OPENAI_API_KEY não configurada — usando foto de banco/ícone no lugar da IA.");
  } else {
    imagensIA = [];
    for (const slide of spec.slides) {
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

  const pngBuffers = await renderSlides(spec.slides, especialidade, pendingSuggestion.date, imagensIA);
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
    if (!message) return; // status update (entregue/lido), não é mensagem nova

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

    const reply = await interpretFeedback({
      suggestion: state.pendingSuggestion.text,
      feedbackText: text,
    });
    await sendText(from, reply);

    const decision = await classifyDecision({
      suggestion: state.pendingSuggestion.text,
      feedbackText: text,
    });

    state.history.push({ from, text, reply, decision, at: new Date().toISOString() });

    if (decision === "aprovado") {
      state.pendingSuggestion.status = "aprovado";
      save(state); // salva a aprovação já, antes de tentar gerar imagem (que pode falhar)

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
    } else if (decision === "rejeitado") {
      state.pendingSuggestion.status = "rejeitado";
    }

    save(state);
  } catch (err) {
    console.error("[webhook] erro processando mensagem:", err);
  }
});

module.exports = router;
