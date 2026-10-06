// O "cérebro" da Sofia: chama a API da Anthropic pra gerar sugestões e interpretar feedback.
// O SYSTEM_PROMPT abaixo é um resumo do que está na spec (doc "Sofia — Spec do Sistema").
// Sempre que a spec mudar (pilares, tom de voz, especialidades…), atualize aqui também —
// isso ainda não lê o doc automaticamente na v1.
const Anthropic = require("@anthropic-ai/sdk");

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta ANTHROPIC_API_KEY no .env — veja o README.");
  }
  return new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `Você é a Sofia, assistente de conteúdo do Atelier do Sorriso (odontologia/estética do sorriso).

Marca:
- Especialidades (ÚNICOS temas permitidos — ver regra abaixo): Implantes dentários (dente fixo), Prótese/Protocolo, Facetas em resina 3D, Alinhadores, Harmonização Facial.
- Tom de voz: misto — institucional/educativo mais técnico, bastidores/engajamento mais leve — usando copywriting persuasivo (gatilhos mentais, storytelling), sem exagerar.
- Pilares de conteúdo: educativo, prova social, bastidores/humanização, institucional/promocional (engajamento como extra).
- Contato pra CTA: @drbrunofreitas.implantes / WhatsApp (81) 9172-0703.

REGRA IMPORTANTE SOBRE TEMA: todo post deve ser sobre uma dessas cinco especialidades, e apenas uma por
post (a que vier indicada no item do calendário, ou a mais adequada ao pilar se não vier especificada).
Nunca sugira posts sobre saúde bucal genérica, outros procedimentos odontológicos ou qualquer assunto fora
dessa lista — mesmo em conteúdo educativo/bastidores, amarre o tema a uma dessas especialidades.

Sua função: sugerir o post do dia (story, reel, post simples ou carrossel), entregando o pacote completo —
legenda, hashtags, e pra reel/story: roteiro, cenas, textos de tela, sugestão de trilha. Nunca deixe
trabalho de redator pra fazer depois.

IMPORTANTE SOBRE IMAGEM: pra post simples e carrossel, NÃO inclua nenhuma descrição, sugestão ou "briefing"
de como a imagem deveria ser (nada de "sugestão prática", "composição visual", descrição de cores/fundo/
elementos etc.) — isso é decidido automaticamente por outro processo, separado desta conversa, depois que o
Bruno aprovar, então qualquer coisa que você escrever aqui sobre a imagem NÃO vai bater com a imagem de
verdade e só vai confundir. Não descreva a imagem pra um designer nem sugira ferramentas externas (Canva,
Photoshop, banco de imagens, Midjourney, DALL-E etc.). Nunca diga que não consegue gerar imagem, nem que
isso é trabalho de designer/banco de imagens — se ele perguntar sobre a imagem, só confirme que ela vem
pronta automaticamente em seguida, sem detalhar como vai ser. Reel e story continuam sem imagem gerada (ele
grava com o celular), então aí sim roteiro e textos de tela bastam.

Responda sempre em português do Brasil.`;

async function generateSuggestion({ calendarItem }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Gere a sugestão de post de hoje com base neste item do calendário: ${JSON.stringify(
          calendarItem
        )}`,
      },
    ],
  });
  return msg.content[0].text;
}

async function interpretFeedback({ suggestion, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão enviada:\n\n${suggestion}\n\nO Bruno respondeu:\n"${feedbackText}"\n\nSe for aprovação, confirme. Se for pedido de ajuste, gere a versão revisada. Se for rejeição, proponha uma alternativa.`,
      },
    ],
  });
  return msg.content[0].text;
}

// Classifica a resposta do Bruno numa decisão que o código consegue usar (diferente
// de interpretFeedback, que gera só o texto de resposta pra ele). Usada pra saber se
// deve disparar a geração das imagens depois de uma aprovação.
async function classifyDecision({ suggestion, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão de post enviada pra aprovação:\n\n${suggestion}\n\nO Bruno respondeu:\n"${feedbackText}"\n\nClassifique a resposta dele. Responda APENAS com um JSON, sem nenhum texto antes ou depois, em um destes três formatos exatos:\n{"decision":"aprovado"}\n{"decision":"ajuste"}\n{"decision":"rejeitado"}\n\n"aprovado" = ele confirmou que gostou e pode seguir/publicar. "ajuste" = ele pediu alguma mudança ou está em dúvida. "rejeitado" = ele não quer esse post.`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (["aprovado", "ajuste", "rejeitado"].includes(parsed.decision)) {
      return parsed.decision;
    }
  } catch (err) {
    console.error("[claude] classifyDecision: resposta não era o JSON esperado:", raw);
  }
  return "ajuste"; // fallback seguro: se não deu pra classificar, não dispara geração de imagem à toa
}

// Depois que o Bruno aprova, converte a sugestão (texto corrido) numa estrutura de
// slides pro renderizador (server/lib/render.js) desenhar as imagens de verdade.
// Sempre pede também um "imagePrompt" por slide, usado pra gerar uma imagem por IA
// via OpenAI (ver server/lib/imagegen.js) — é o padrão agora pra todo post simples/
// carrossel, não só quando pedido. Esse prompt é escrito com cuidado pra evitar o
// risco de a IA errar detalhes anatômicos/diagnósticos de odontologia.
async function generateImageSpec({ calendarItem, suggestionText }) {
  const api = client();
  const camposImagemIA = `\n- Inclua também em cada slide um campo "imagePrompt": uma descrição em inglês, específica e visual (2-3 frases), pra gerar uma imagem por IA que combine com ESSE slide em particular — baseada no headline/body que você mesmo escreveu pra ele, não um prompt genérico que serviria pra qualquer post. IMPORTANTE:
  - NÃO peça pra mostrar dentes, boca ou procedimentos de forma anatômica/diagnóstica (número de dentes, estrutura interna, close-up técnico) — a IA erra esse tipo de detalhe com frequência.
  - NÃO repita sempre a mesma cena de "cadeira odontológica vazia num consultório claro com planta no canto" — isso fica repetitivo entre posts e entre slides do mesmo carrossel. Varie de verdade a cada slide: pode ser um detalhe de mãos (segurando um alinhador transparente, um modelo de prótese, um espelho de mão), uma pessoa sorrindo de forma confiante e à distância seguro (sem foco nos dentes), uma textura ou material (cerâmica, resina, luz entrando por uma janela), um momento de bem-estar fora do consultório (harmonização facial pode ser um momento de cuidado/spa, por exemplo), um detalhe arquitetônico ou decorativo diferente do consultório, ou um objeto relacionado ao tema (escova, fio dental, estojo de alinhador).
  - Pense no que ESSE slide específico está dizendo e escolha uma cena que ilustre essa ideia particular, não uma cena-padrão repetida.`;
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `A sugestão abaixo foi aprovada pelo Bruno. Converta ela numa estrutura JSON pra geração das imagens.

Sugestão aprovada:
${suggestionText}

Item do calendário: ${JSON.stringify(calendarItem)}

Responda APENAS com um JSON válido, sem nenhum texto antes ou depois, neste formato:
{"slides":[{"headline":"...","body":"...","footer":"..."}]}

Regras:
- Se o formato for "post simples", gere exatamente 1 slide.
- Se o formato for "carrossel", gere entre 4 e 6 slides (capa, pontos principais, CTA final).
- "headline" = texto principal/destaque do slide, curto (até uns 60 caracteres).
- "body" = texto de apoio, até uns 200 caracteres — pode ficar vazio na capa se não precisar.
- "footer" = linha pequena opcional (ex: contato/CTA leve) — deixe vazio na maioria dos slides, use só no último.
- Não inclua markdown (sem **negrito**, sem #), não inclua emojis em excesso, nada fora do JSON.${camposImagemIA}`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned); // deixa propagar o erro se vier mal formado — quem chama decide o que fazer
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("generateImageSpec: resposta não trouxe um array de slides válido");
  }
  return parsed;
}

// Depois que um post já foi aprovado (e a imagem, se tinha, já foi gerada e
// mandada), o Bruno pode avisar depois que já publicou nas redes (ex: "postei",
// "já publiquei", "saiu"). Isso é usado pra marcar status="publicado" e desligar os
// lembretes das 13h/18h (ver scheduler.js) — sem isso, o lembrete dispara mesmo nos
// dias em que ele já publicou, porque nada avisava o sistema disso antes.
async function classificarConfirmacaoPublicacao(feedbackText) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `O Bruno já tinha aprovado um post antes. Agora ele mandou esta mensagem:\n"${feedbackText}"\n\nEle está avisando que já publicou/postou esse conteúdo nas redes sociais (Instagram, etc.)? Responda APENAS com um JSON, sem texto antes ou depois, neste formato exato: {"publicado":true} ou {"publicado":false}.`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.publicado === true;
  } catch (err) {
    console.error("[claude] classificarConfirmacaoPublicacao: resposta não era o JSON esperado:", raw);
    return false;
  }
}

module.exports = {
  generateSuggestion,
  interpretFeedback,
  classifyDecision,
  generateImageSpec,
  classificarConfirmacaoPublicacao,
};
