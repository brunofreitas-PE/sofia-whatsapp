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

// Envia uma imagem já hospedada numa URL pública. Não é o caminho usado hoje (ver
// uploadMedia abaixo), mas fica disponível caso um dia a gente hospede as imagens
// em algum lugar em vez de fazer upload direto.
async function sendImageByUrl(to, imageUrl, caption) {
  const api = client();
  return api.post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

// Sobe um arquivo de imagem (buffer, ex: PNG gerado pelo render.js) direto pro
// WhatsApp, sem precisar de nenhuma URL pública — usa o endpoint /media da Cloud
// API. Retorna o media id, usado depois em sendImageByMediaId.
async function uploadMedia(buffer, mimeType = "image/png") {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    throw new Error(
      "Faltam WHATSAPP_PHONE_NUMBER_ID e/ou WHATSAPP_TOKEN no .env — veja o README."
    );
  }

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([buffer], { type: mimeType }), "imagem.png");

  const resp = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/media`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error("Falha ao subir mídia pro WhatsApp (uploadMedia)");
    err.response = { data };
    throw err;
  }
  return data.id;
}

// Manda uma imagem já enviada via uploadMedia, pelo media id.
async function sendImageByMediaId(to, mediaId, caption) {
  const api = client();
  return api.post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: caption ? { id: mediaId, caption } : { id: mediaId },
  });
}

module.exports = { sendText, sendImageByUrl, uploadMedia, sendImageByMediaId };
