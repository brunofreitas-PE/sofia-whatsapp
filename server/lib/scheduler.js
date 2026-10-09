// Agendador: dispara a sugestão do dia e os lembretes de publicação — PRA CADA
// CLIENTE configurado (ver lib/clients.js). Todos compartilham o mesmo horário
// (8h/13h/18h, fuso do servidor — configure TZ=America/Sao_Paulo no Railway) e o
// mesmo número de WhatsApp da Sofia; o que muda de cliente pra cliente é o número
// PESSOAL de quem recebe (cliente.ownerWhatsappNumber) e o conteúdo (especialidades,
// tom, etc.).
const cron = require("node-cron");
const { sendText, sendTemplate } = require("./whatsapp");
const { generateSuggestion } = require("./claude");
const { load, save } = require("./store");
const { todosOsClientes } = require("./clients");

// Template aprovado pela Meta (ver server/lib/whatsapp.js) — usado pra avisar o
// profissional às 8h mesmo quando a janela de 24h está fechada (ele não precisa
// interagir todo dia). O corpo é fixo, sem variáveis — o mesmo template serve pra
// todos os clientes, já que não menciona nome de clínica nenhuma.
const TEMPLATE_SUGESTAO_DIARIA = "sugestao_diaria";
const TEMPLATE_IDIOMA = "pt_BR";

function especialidadeDoDia(date, especialidades) {
  // Dia do ano (0-indexado) módulo o tamanho da lista do cliente — rotação
  // determinística e simples, sem precisar guardar estado extra de "qual foi a
  // última vez". Cada cliente tem sua própria lista (ver server/clients/<slug>.json).
  const inicioDoAno = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diaDoAno = Math.floor((date - inicioDoAno) / 86400000);
  return especialidades[diaDoAno % especialidades.length];
}

// Igual à rotação de especialidade acima, mas pro FORMATO do post — essa continua
// compartilhada entre todos os clientes (não depende de especialidade nenhuma). 7
// posições (coprimo com qualquer lista razoável de especialidades) pra combinação
// especialidade×formato variar bastante antes de repetir. Post simples continua
// sendo o mais comum (é o mais rápido/barato), mas carrossel, story e reel aparecem
// com frequência real.
const FORMATOS = ["post simples", "carrossel", "post simples", "story", "carrossel", "post simples", "reel"];

function formatoDoDia(date) {
  const inicioDoAno = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diaDoAno = Math.floor((date - inicioDoAno) / 86400000);
  return FORMATOS[diaDoAno % FORMATOS.length];
}

// Lógica da sugestão do dia PRA UM CLIENTE, isolada numa função própria pra poder ser
// chamada tanto pelo cron das 8h (pra todos os clientes, ver start() abaixo) quanto
// por uma rota de teste manual (ver /debug/gerar-sugestao em server/index.js, que
// recebe ?cliente=<slug> e chama isso só pra esse um).
async function runDailySuggestionNow(cliente) {
  if (!cliente || !cliente.slug) {
    throw new Error("runDailySuggestionNow: precisa receber o objeto do cliente (ver lib/clients.js).");
  }
  const state = load(cliente.slug);
  const agora = new Date();
  const today = agora.toISOString().slice(0, 10);
  const calendarItem =
    state.calendar.find((i) => i.date === today) || {
      date: today,
      pillar: "educativo",
      format: formatoDoDia(agora),
      especialidade: especialidadeDoDia(agora, cliente.especialidades),
      title: `Especialidade do dia (sem item específico no calendário): ${especialidadeDoDia(
        agora,
        cliente.especialidades
      )}, formato: ${formatoDoDia(agora)}`,
    };
  // generateSuggestion já devolve a mensagem E os slides (com imagePrompt) numa
  // resposta só — isso garante que a prévia que o profissional lê no WhatsApp é fiel
  // ao que vai ser gerado de verdade na aprovação (ver claude.js e
  // gerarEEnviarImagens em server/routes/webhook.js).
  const { text, slides } = await generateSuggestion({ cliente, calendarItem });
  // A Sofia é quem inicia a conversa aqui (o profissional não mandou nada antes) —
  // se a janela de 24h dele estiver fechada, um texto livre seria recusado pela API
  // do WhatsApp sem aviso nenhum. Por isso manda só o template aprovado agora (isso
  // funciona mesmo com a janela fechada); a mensagem completa só sai quando ele
  // responder — ver o tratamento de `textoEnviado` em webhook.js.
  await sendTemplate(cliente.ownerWhatsappNumber, TEMPLATE_SUGESTAO_DIARIA, TEMPLATE_IDIOMA);
  // Guardamos format + calendarItem + slides junto, não só o texto — são usados
  // depois na hora de gerar/renderizar a imagem quando o profissional aprovar.
  state.pendingSuggestion = {
    date: today,
    text,
    slides,
    status: "aguardando",
    textoEnviado: false, // vira true em webhook.js quando a sugestão completa for enviada
    format: calendarItem.format,
    calendarItem,
  };
  save(cliente.slug, state);
  return text;
}

// Roda runDailySuggestionNow pra TODOS os clientes configurados, um de cada vez (não
// em paralelo, de propósito — assim um erro num cliente aparece isolado no log, sem
// derrubar nem confundir o envio dos outros).
async function runDailySuggestionForAllClients() {
  for (const cliente of todosOsClientes()) {
    try {
      await runDailySuggestionNow(cliente);
    } catch (err) {
      console.error(`[scheduler] falha ao enviar sugestão do dia pro cliente "${cliente.slug}":`, err.message);
    }
  }
}

function start() {
  const clientes = todosOsClientes();
  if (clientes.length === 0) {
    console.warn(
      "[scheduler] nenhum cliente configurado (confira server/clients/*.json e as variáveis OWNER_WHATSAPP_NUMBER__<slug>) — agendador não vai enviar nada."
    );
    return;
  }

  // 08:00 — sugestão do dia, pra cada cliente
  cron.schedule("0 8 * * *", async () => {
    await runDailySuggestionForAllClients();
  });

  // 13:00 e 18:00 — lembrete de publicação, pra cada cliente (só se ainda não foi
  // marcado como publicado)
  ["0 13 * * *", "0 18 * * *"].forEach((expr) => {
    cron.schedule(expr, async () => {
      for (const cliente of todosOsClientes()) {
        const state = load(cliente.slug);
        if (state.pendingSuggestion && state.pendingSuggestion.status !== "publicado") {
          await sendText(
            cliente.ownerWhatsappNumber,
            "Lembrete: o post de hoje ainda não foi marcado como publicado 👀"
          ).catch((err) =>
            console.error(`[scheduler] falha no lembrete pro cliente "${cliente.slug}":`, err.message)
          );
        }
      }
    });
  });

  console.log(`[scheduler] agendador iniciado — ${clientes.length} cliente(s): ${clientes.map((c) => c.slug).join(", ")}.`);
}

module.exports = { start, runDailySuggestionNow, runDailySuggestionForAllClients, especialidadeDoDia, formatoDoDia };
