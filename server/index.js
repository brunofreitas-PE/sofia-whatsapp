require("dotenv").config();
const express = require("express");
const webhookRoute = require("./routes/webhook");
const scheduler = require("./lib/scheduler");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Sofia está de pé. 👋");
});

app.use("/webhook", webhookRoute);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[sofia] servidor rodando na porta ${port}`);
  scheduler.start();
});
