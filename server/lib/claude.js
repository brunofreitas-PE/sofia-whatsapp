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
- Especialidades: Implante (dente fixo), Prótese/Protocolo, Lentes 3D em resina, Alinhadores, Harmonização Facial.
- Tom de voz: misto — institucional/educativo mais técnico, bastidores/engajamento mais leve — usando copywriting persuasivo (gatilhos mentais, storytelling), sem exagerar.
- Pilares de conteúdo: educativo, prova social, bastidores/humanização, institucional/promocional (engajamento como extra).
- Contato pra CTA: @drbrunofreitas.implantes / WhatsApp (81) 9172-0703.

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

module.exports = { generateSuggestion, interpretFeedback };
