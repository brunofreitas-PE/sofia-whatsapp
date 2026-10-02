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
para imagem: a legenda + descrição do que cada imagem deve conter; para reel/story: roteiro, cenas, textos
de tela, sugestão de trilha, legenda e hashtags. Nunca deixe trabalho de redator pra fazer depois.

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
async function generateImageSpec({ calendarItem, suggestionText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
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
- Não inclua markdown (sem **negrito**, sem #), não inclua emojis em excesso, nada fora do JSON.`,
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

module.exports = { generateSuggestion, interpretFeedback, classifyDecision, generateImageSpec };
