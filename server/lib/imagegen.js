// Geração de imagem por IA (OpenAI) — usada só quando o Bruno pede algo "mais
// elaborado" num post específico (ver classifyDecision/imagemElaborada em
// server/lib/claude.js e server/routes/webhook.js). NÃO roda automaticamente
// nos posts do dia a dia — esses continuam usando a foto de banco fixa
// (server/stock/) ou o ícone desenhado, sem custo nenhum.
//
// Precisa da variável de ambiente OPENAI_API_KEY configurada no Railway (é uma
// conta separada da assinatura do ChatGPT Plus — precisa ser criada em
// platform.openai.com, com cartão cadastrado lá). Se a chave não estiver
// configurada, gerarImagemIA lança um erro — quem chama (webhook.js) trata
// isso e avisa o Bruno, caindo de volta pro fluxo padrão.
const OpenAI = require("openai");

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta OPENAI_API_KEY no Railway — configure a chave da API da OpenAI antes de pedir imagem gerada por IA."
    );
  }
  return new OpenAI({ apiKey });
}

// `prompt` já vem pronto (gerado pela Sofia em generateImageSpec, com cuidado
// pra não pedir detalhes anatômicos/diagnósticos — ver claude.js). Retorna um
// Buffer PNG, pronto pra entrar no mesmo compositor de imagem usado pras fotos
// de banco (ver carregarFotoDaEspecialidade / drawSlide em render.js).
async function gerarImagemIA(prompt) {
  const api = client();
  const resp = await api.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1536", // retrato — mais perto da proporção 4:5 do card (1080x1350)
    quality: "medium", // meio-termo custo/qualidade; dá pra subir pra "high" se quiser mais capricho
  });
  const b64 = resp.data[0]?.b64_json;
  if (!b64) {
    throw new Error("gerarImagemIA: resposta da OpenAI não trouxe imagem (b64_json ausente).");
  }
  return Buffer.from(b64, "base64");
}

module.exports = { gerarImagemIA };
