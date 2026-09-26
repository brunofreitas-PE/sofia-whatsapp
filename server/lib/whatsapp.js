// Funções de envio pela Meta Cloud API.
// Docs oficiais: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
const axios = require("axios");

const GRAPH_VERSION = "v21.0";

function client() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    throw new Error(
      "Faltam WHATSAPP_PHONE_NUMBER_ID e/ou WHATSAPP_TOKEN no .env — veja o README."
    );
  }
  return axios.create({
    baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function sendText(to, body) {
  const api = client();
  return api.post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

// Envia uma imagem já hospedada numa URL pública (a Cloud API não aceita upload
// direto de arquivo local nesta chamada simples — precisa de uma URL acessível
// pela internet, ou usar o endpoint /media pra fazer upload primeiro).
async function sendImageByUrl(to, imageUrl, caption) {
  const api = client();
  return api.post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

module.exports = { sendText, sendImageByUrl };
