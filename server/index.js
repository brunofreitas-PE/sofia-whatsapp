require("dotenv").config();
const express = require("express");
const webhookRoute = require("./routes/webhook");
const scheduler = require("./lib/scheduler");
const { registerPhoneNumber } = require("./lib/whatsapp");
const { generateImageSpec } = require("./lib/claude");
const store = require("./lib/store");
const { porSlug, todosOsClientes } = require("./lib/clients");

// Helper usado pelas rotas de debug abaixo: resolve QUAL cliente usar. Se vier
// ?cliente=<slug> na URL, usa esse (e já valida que existe). Se não vier e só
// existir UM cliente configurado, usa esse (bom pra continuar funcionando com
// ?token=... só, do jeito que já estava antes do multi-cliente). Se houver mais
// de um cliente e nenhum slug foi passado, não dá pra adivinhar — pede pra
// especificar.
function resolverClienteDaQuery(slugQuery) {
  if (slugQuery) {
    return porSlug(slugQuery); // já lança erro claro se o slug não existir
  }
  const todos = todosOsClientes();
  if (todos.length === 1) return todos[0];
  if (todos.length === 0) {
    throw new Error(
      "Nenhum cliente configurado (confira server/clients/*.json e as variáveis OWNER_WHATSAPP_NUMBER__<slug> no Railway)."
    );
  }
  throw new Error(
    `Mais de um cliente configurado (${todos
      .map((c) => c.slug)
      .join(", ")}) — passe ?cliente=<slug> na URL pra dizer qual.`
  );
}

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
// depois que não precisar mais testar manualmente. Passe ?cliente=<slug> pra testar
// um cliente específico (necessário assim que houver mais de um cadastrado).
app.get("/debug/gerar-sugestao", async (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const cliente = resolverClienteDaQuery(req.query.cliente);
    const suggestion = await scheduler.runDailySuggestionNow(cliente);
    res
      .type("text/plain")
      .send(`Sugestão gerada e enviada pro cliente "${cliente.slug}"! Confira o WhatsApp.\n\n` + suggestion);
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
// dados entre deploys — mostra o estado salvo agora (sugestão pendente, histórico) de
// UM cliente (?cliente=<slug>, ver resolverClienteDaQuery acima). Uso: chamar antes e
// depois de um redeploy e comparar — se continuar igual depois do redeploy, o volume
// está funcionando. Pode remover depois de confirmado.
app.get("/debug/estado", (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const cliente = resolverClienteDaQuery(req.query.cliente);
    const state = store.load(cliente.slug);
    res.type("text/plain").send(JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[debug] falha ao ler estado:", err);
    res.status(500).type("text/plain").send("Erro: " + err.message);
  }
});

// Rota de resgate: gera e manda as imagens certas a partir de um texto já aprovado
// de verdade (ex: quando um bug fez a imagem sair de um assunto diferente do que foi
// aprovado — ver claude/sofia-whatsapp-setup.md, 09/10/2026).
//
// GET mostra um formulariozinho (o profissional não tem como fazer um POST colando
// uma URL na barra de endereço) — ele escolhe o CLIENTE (quando houver mais de um
// cadastrado), cola o texto aprovado numa caixa, escolhe a especialidade/formato e
// aperta um botão, que dispara o POST de verdade pro mesmo endereço. A lista de
// especialidades do dropdown muda sozinha de acordo com o cliente escolhido (cada
// cliente tem sua própria lista — ver server/clients/<slug>.json). POST espera um
// corpo JSON { "cliente": "<slug>", "texto": "...", "especialidade": "...",
// "format": "post simples" | "carrossel" } (especialidade e format são opcionais) e
// manda pro ownerWhatsappNumber desse cliente.
app.get("/debug/gerar-imagens-aprovado", (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  let clientes;
  try {
    clientes = todosOsClientes();
  } catch (err) {
    return res.status(500).type("text/plain").send("Erro: " + err.message);
  }
  if (clientes.length === 0) {
    return res
      .status(500)
      .type("text/plain")
      .send(
        "Nenhum cliente configurado (confira server/clients/*.json e as variáveis OWNER_WHATSAPP_NUMBER__<slug> no Railway)."
      );
  }

  const actionUrl = `/debug/gerar-imagens-aprovado?token=${encodeURIComponent(req.query.token)}`;
  const especialidadesPorCliente = {};
  clientes.forEach((c) => {
    especialidadesPorCliente[c.slug] = c.especialidades || [];
  });
  const clienteOptions = clientes
    .map((c) => `<option value="${c.slug}">${c.nomeClinica} (${c.nomeProfissional})</option>`)
    .join("\n      ");

  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gerar imagens do texto aprovado — Sofia</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 680px; margin: 30px auto; padding: 0 16px; line-height: 1.5; color: #222; }
    label { display: block; font-weight: 600; margin-top: 16px; margin-bottom: 4px; }
    textarea, select, button { width: 100%; font-size: 1rem; padding: 10px; box-sizing: border-box; }
    textarea { min-height: 300px; font-family: inherit; }
    button { margin-top: 20px; background: #102a43; color: white; border: none; border-radius: 8px; padding: 14px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.6; }
    #status { margin-top: 16px; white-space: pre-wrap; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h2>Gerar as imagens certas de um texto já aprovado</h2>
  <p>Escolhe o cliente, cola abaixo o texto COMPLETO que foi aprovado de verdade (legenda + a parte "IMAGEM(NS)" + hashtags, tudo junto), escolhe a especialidade e o formato, e aperta o botão.</p>
  <form id="f">
    ${
      clientes.length > 1
        ? `<label for="cliente">Cliente</label>
    <select id="cliente" name="cliente">
      ${clienteOptions}
    </select>`
        : `<input type="hidden" id="cliente" name="cliente" value="${clientes[0].slug}">`
    }

    <label for="texto">Texto aprovado</label>
    <textarea id="texto" name="texto" required placeholder="Cole aqui o texto inteiro..."></textarea>

    <label for="especialidade">Especialidade</label>
    <select id="especialidade" name="especialidade"></select>

    <label for="format">Formato</label>
    <select id="format" name="format">
      <option value="post simples">Post simples</option>
      <option value="carrossel">Carrossel</option>
    </select>

    <button type="submit" id="btn">Gerar e enviar imagens pelo WhatsApp</button>
  </form>
  <div id="status"></div>
  <script>
    const ESPECIALIDADES_POR_CLIENTE = ${JSON.stringify(especialidadesPorCliente)};
    const clienteEl = document.getElementById("cliente");
    const especialidadeEl = document.getElementById("especialidade");

    function atualizarEspecialidades() {
      const lista = ESPECIALIDADES_POR_CLIENTE[clienteEl.value] || [];
      especialidadeEl.innerHTML = lista.map((e) => \`<option value="\${e}">\${e}</option>\`).join("");
    }
    if (clienteEl.tagName === "SELECT") {
      clienteEl.addEventListener("change", atualizarEspecialidades);
    }
    atualizarEspecialidades();

    document.getElementById("f").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = document.getElementById("btn");
      const status = document.getElementById("status");
      btn.disabled = true;
      status.textContent = "Gerando... isso pode levar um minuto, não feche essa tela.";
      try {
        const resp = await fetch(${JSON.stringify(actionUrl)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente: clienteEl.value,
            texto: document.getElementById("texto").value,
            especialidade: especialidadeEl.value,
            format: document.getElementById("format").value,
          }),
        });
        const text = await resp.text();
        status.textContent = (resp.ok ? "✅ " : "❌ ") + text;
      } catch (err) {
        status.textContent = "❌ Erro: " + err.message;
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

app.post("/debug/gerar-imagens-aprovado", async (req, res) => {
  if (req.query.token !== process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.sendStatus(403);
  }
  const { texto, especialidade, format, cliente: clienteSlug } = req.body || {};
  if (!texto || typeof texto !== "string") {
    return res
      .status(400)
      .type("text/plain")
      .send('Erro: passe um corpo JSON com {"texto": "..."} (o texto completo que foi aprovado).');
  }
  try {
    const cliente = resolverClienteDaQuery(clienteSlug);
    const calendarItem = {
      especialidade: especialidade || null,
      format: format || "post simples",
      title: "gerado manualmente via /debug/gerar-imagens-aprovado",
    };
    const spec = await generateImageSpec({ cliente, calendarItem, suggestionText: texto });
    await webhookRoute.gerarEEnviarImagens({
      to: cliente.ownerWhatsappNumber,
      cliente,
      pendingSuggestion: {
        slides: spec.slides,
        format: calendarItem.format,
        calendarItem,
        date: new Date().toISOString().slice(0, 10),
      },
    });
    res.type("text/plain").send(`Imagens geradas e enviadas pro cliente "${cliente.slug}"! Confira o WhatsApp.`);
  } catch (err) {
    console.error("[debug] falha ao gerar imagens manualmente:", err);
    const detalhe = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
    res.status(500).type("text/plain").send("Erro: " + detalhe);
  }
});

app.use("/webhook", webhookRoute);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[sofia] servidor rodando na porta ${port}`);
  scheduler.start();
});
