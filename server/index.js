require("dotenv").config();
const express = require("express");
const webhookRoute = require("./routes/webhook");
const scheduler = require("./lib/scheduler");
const { registerPhoneNumber } = require("./lib/whatsapp");
const store = require("./lib/store");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Sofia está de pé. 👋");
});

// Política de privacidade exigida pela Meta pra publicar o app do WhatsApp Cloud API.
// Texto simples porque a Sofia é uma ferramenta interna do Atelier do Sorriso (uso
// próprio, não coleta dados de terceiros/público em geral).
app.get("/privacidade", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Política de Privacidade — Sofia (Atelier do Sorriso)</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #222; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }
    footer { margin-top: 3rem; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>Política de Privacidade — Sofia</h1>
  <p>Última atualização: 02 de outubro de 2026.</p>

  <p>A Sofia é uma ferramenta de uso interno do Atelier do Sorriso, usada exclusivamente
  para gerar sugestões de conteúdo (posts, stories, reels e carrosséis) para as redes
  sociais da clínica. Ela se comunica apenas com o número de WhatsApp do responsável
  pela clínica — não é um serviço público nem coleta dados de clientes ou de terceiros.</p>

  <h2>Quais dados são tratados</h2>
  <p>Mensagens de texto e áudio trocadas entre o responsável da clínica e o número de
  WhatsApp da Sofia, com o único objetivo de gerar e ajustar sugestões de conteúdo.
  Áudios são transcritos automaticamente e descartados após a transcrição.</p>

  <h2>Com quem os dados são compartilhados</h2>
  <p>As mensagens são processadas pela API da Anthropic (geração do texto das sugestões)
  e enviadas/recebidas através da API do WhatsApp (Meta Cloud API). Nenhum dado é
  vendido ou compartilhado com outros terceiros.</p>

  <h2>Armazenamento</h2>
  <p>O histórico de sugestões e respostas fica guardado apenas para o funcionamento da
  ferramenta (saber o que já foi aprovado, ajustado ou publicado) e não é usado para
  nenhuma outra finalidade.</p>

  <h2>Contato</h2>
  <p>Dúvidas sobre esta política podem ser enviadas para
  <a href="mailto:atelierdosorrisope@gmail.com">atelierdosorrisope@gmail.com</a>.</p>

  <footer>Atelier do Sorriso</footer>
</body>
</html>`);
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
    // err.response?.data traz o detalhe de verdade quando o erro vem de uma API
    // externa (Meta ou Anthropic) — err.message sozinho só diz o código HTTP.
    const detalhe = err.response?.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    res.status(500).type("text/plain").send("Erro: " + detalhe);
  }
});

// Rota temporária pra "registrar" o número configurado em WHATSAPP_PHONE_NUMBER_ID na
// Cloud API — necessário quando um número aparece como "Pendente" no WhatsApp Manager
// depois de adicionado/verificado (ver lib/whatsapp.js, registerPhoneNumber). Use uma
// vez por número (depois de atualizar WHATSAPP_PHONE_NUMBER_ID no Railway pro número
// novo). `pin` = 6 dígitos à sua escolha (ex: ?token=...&pin=123456) — vira o PIN de
// verificação em duas etapas desse número, guarde ele.
app.get("/debug/registrar-numero", async (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  const pin = req.query.pin;
  if (!pin || !/^\d{6}$/.test(pin)) {
    return res
      .status(400)
      .type("text/plain")
      .send("Erro: passe ?pin=XXXXXX com 6 dígitos na URL.");
  }
  try {
    const resp = await registerPhoneNumber(pin);
    res
      .type("text/plain")
      .send("Registrado com sucesso! Confira no WhatsApp Manager se virou \"Conectado\".\n\n" + JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error("[debug] falha ao registrar número:", err);
    const detalhe = err.response?.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    res.status(500).type("text/plain").send("Erro: " + detalhe);
  }
});

// Rota temporária só pra testar se o Railway Volume (DATA_DIR) está persistindo os
// dados entre deploys — mostra o estado salvo agora (sugestão pendente, histórico).
// Uso: chamar antes e depois de um redeploy e comparar — se continuar igual depois
// do redeploy, o volume está funcionando. Pode remover depois de confirmado.
app.get("/debug/estado", (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const state = store.load();
    res.type("text/plain").send(JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[debug] falha ao ler estado:", err);
    res.status(500).type("text/plain").send("Erro: " + err.message);
  }
});

app.use("/webhook", webhookRoute);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[sofia] servidor rodando na porta ${port}`);
  scheduler.start();
});
