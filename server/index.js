require("dotenv").config();
const express = require("express");
const webhookRoute = require("./routes/webhook");
const scheduler = require("./lib/scheduler");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Sofia está de pé. 👋");
});

// Rota temporária pra testar a sugestão do dia sem esperar o horário do agendador (8h).
// Protegida por um token simples na URL (reaproveita o WHATSAPP_VERIFY_TOKEN) — não é
// segurança de verdade, só evita que alguém aleatório dispare isso. Dá pra remover
// depois que não precisar mais testar manualmente.
app.get("/debug/gerar-sugestao", async (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const suggestion = await scheduler.runDailySuggestionNow();
    res.type("text/plain").send("Sugestão gerada e enviada! Confira seu WhatsApp.\n\n" + suggestion);
  } catch (err) {
    console.error("[debug] falha ao gerar sugestão:", err);
    res.status(500).send("Erro: " + err.message);
  }
});

app.use("/webhook", webhookRoute);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[sofia] servidor rodando na porta ${port}`);
  scheduler.start();
});
