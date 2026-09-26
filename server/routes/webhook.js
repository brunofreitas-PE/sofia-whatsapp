const express = require("express");
const router = express.Router();
const { sendText } = require("../lib/whatsapp");
const { interpretFeedback } = require("../lib/claude");
const { transcribeAudio } = require("../lib/transcribe");
const { load, save } = require("../lib/store");

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

    const reply = await interpretFeedback({
      suggestion: state.pendingSuggestion.text,
      feedbackText: text,
    });
    await sendText(from, reply);

    state.history.push({ from, text, reply, at: new Date().toISOString() });
    save(state);
  } catch (err) {
    console.error("[webhook] erro processando mensagem:", err);
  }
});

module.exports = router;
