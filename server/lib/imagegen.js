// Geração de imagem por IA (OpenAI) — roda em TODO post simples/carrossel, pra
// cada slide (ver gerarEEnviarImagens em server/routes/webhook.js). Se a chave ou
// a geração de um slide falhar, esse slide cai pro ícone/texto de fallback (ver
// render.js) em vez de travar o post inteiro.
//
// Precisa da variável de ambiente OPENAI_API_KEY configurada no Railway (é uma
// conta separada da assinatura do ChatGPT Plus — precisa ser criada em
// platform.openai.com, com cartão cadastrado lá).
//
// ATENÇÃO — PRAZO: a OpenAI avisou que o modelo "gpt-image-1" (o padrão abaixo)
// sai do ar em 23/10/2026 (confirmado na documentação oficial de depreciação:
// https://platform.openai.com/docs/deprecations, seção "Legacy GPT Image"). O
// nome do modelo que vai substituir ele ainda está mudando de um dia pro outro
// na documentação da OpenAI (viu-se "gpt-image-2.5-sunburst"/"gpt-image-2.5-flare"
// numa consulta recente, mas são nomes incomuns demais pra confiar sem conferir
// de novo mais perto da data) — por isso o modelo agora vem de uma variável de
// ambiente (OPENAI_IMAGE_MODEL), pra trocar sem precisar mexer no código: é só
// criar essa variável no Railway com o nome certo, assim que a OpenAI confirmar
// qual é, e o deploy nem precisa ser refeito.
const OpenAI = require("openai");

const MODELO_PADRAO = "gpt-image-1"; // troque via OPENAI_IMAGE_MODEL no Railway antes de 23/10/2026

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta OPENAI_API_KEY no Railway — configure a chave da API da OpenAI antes de pedir imagem gerada por IA."
    );
  }
  return new OpenAI({ apiKey });
}

// `prompt` já vem pronto (gerado pela Sofia em generateSuggestion, com cuidado
// pra não pedir detalhes anatômicos/diagnósticos — ver claude.js). Retorna um
// Buffer PNG, pronto pra entrar no mesmo compositor de imagem usado pras fotos
// de banco (ver carregarFotoDaEspecialidade / drawSlide em render.js).
async function gerarImagemIA(prompt) {
  const api = client();
  const resp = await api.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || MODELO_PADRAO,
    prompt,
    size: "1024x1536", // retrato — mais perto da proporção 4:5 do card (1080x1350)
    quality: "high", // o Bruno pediu imagens mais elaboradas/caprichadas — custa mais que "medium", mas sai bem mais rica em detalhe
  });
  const b64 = resp.data[0]?.b64_json;
  if (!b64) {
    throw new Error("gerarImagemIA: resposta da OpenAI não trouxe imagem (b64_json ausente).");
  }
  return Buffer.from(b64, "base64");
}

module.exports = { gerarImagemIA };
