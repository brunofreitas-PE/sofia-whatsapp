// Agendador: dispara a sugestão do dia e os lembretes de publicação.
// Horários em cron (fuso do servidor — configure TZ=America/Sao_Paulo no Railway).
const cron = require("node-cron");
const { sendText, sendTemplate } = require("./whatsapp");
const { generateSuggestion } = require("./claude");
const { load, save } = require("./store");

// Template aprovado pela Meta (ver server/lib/whatsapp.js) — usado pra avisar o
// Bruno às 8h mesmo quando a janela de 24h está fechada (ele não precisa
// interagir todo dia). O corpo é fixo, sem variáveis.
const TEMPLATE_SUGESTAO_DIARIA = "sugestao_diaria";
const TEMPLATE_IDIOMA = "pt_BR";

// As 5 especialidades do Atelier do Sorriso — únicos temas que a Sofia pode sugerir
// (ver também a regra equivalente no SYSTEM_PROMPT de server/lib/claude.js).
// Quando não há item específico no calendário pro dia, giramos por essa lista em vez
// de cair num tema genérico de "saúde bucal".
const ESPECIALIDADES = [
  "Implantes dentários (dente fixo)",
  "Prótese / Protocolo",
  "Facetas em resina 3D",
  "Alinhadores",
  "Harmonização Facial",
];

function especialidadeDoDia(date) {
  // Dia do ano (0-indexado) módulo 5 — rotação determinística e simples, sem
  // precisar guardar estado extra de "qual foi a última vez".
  const inicioDoAno = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diaDoAno = Math.floor((date - inicioDoAno) / 86400000);
  return ESPECIALIDADES[diaDoAno % ESPECIALIDADES.length];
}

// Lógica da sugestão do dia, isolada numa função própria pra poder ser chamada
// tanto pelo cron das 8h quanto por uma rota de teste manual (ver server/index.js).
async function runDailySuggestionNow() {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  const state = load();
  const agora = new Date();
  const today = agora.toISOString().slice(0, 10);
  const calendarItem =
    state.calendar.find((i) => i.date === today) || {
      date: today,
      pillar: "educativo",
      format: "post simples",
      especialidade: especialidadeDoDia(agora),
      title: `Especialidade do dia (sem item específico no calendário): ${especialidadeDoDia(
        agora
      )}`,
    };
  // generateSuggestion já devolve a mensagem E os slides (com imagePrompt) numa
  // resposta só — isso garante que a prévia de imagem que o Bruno lê no WhatsApp é
  // fiel ao que vai ser gerado de verdade na aprovação (ver claude.js e
  // gerarEEnviarImagens em server/routes/webhook.js).
  const { text, slides } = await generateSuggestion({ calendarItem });
  // A Sofia é quem inicia a conversa aqui (o Bruno não mandou nada antes) — se a
  // janela de 24h dele estiver fechada, um texto livre seria recusado pela API do
  // WhatsApp sem aviso nenhum. Por isso manda só o template aprovado agora (isso
  // funciona mesmo com a janela fechada); a mensagem completa só sai quando o
  // Bruno responder — ver o tratamento de `textoEnviado` em webhook.js.
  await sendTemplate(owner, TEMPLATE_SUGESTAO_DIARIA, TEMPLATE_IDIOMA);
  // Guardamos format + calendarItem + slides junto, não só o texto — são usados
  // depois na hora de gerar/renderizar a imagem quando o Bruno aprovar.
  state.pendingSuggestion = {
    date: today,
    text,
    slides,
    status: "aguardando",
    textoEnviado: false, // vira true em webhook.js quando a sugestão completa for enviada
    format: calendarItem.format,
    calendarItem,
  };
  save(state);
  return text;
}

function start() {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!owner) {
    console.warn(
      "[scheduler] OWNER_WHATSAPP_NUMBER não configurado — agendador não vai enviar nada."
    );
    return;
  }

  // 08:00 — sugestão do dia
  cron.schedule("0 8 * * *", async () => {
    try {
      await runDailySuggestionNow();
    } catch (err) {
      console.error("[scheduler] falha ao enviar sugestão do dia:", err.message);
    }
  });

  // 13:00 e 18:00 — lembrete de publicação (só se ainda não foi marcado como publicado)
  ["0 13 * * *", "0 18 * * *"].forEach((expr) => {
    cron.schedule(expr, async () => {
      const state = load();
      if (state.pendingSuggestion && state.pendingSuggestion.status !== "publicado") {
        await sendText(
          owner,
          "Lembrete: o post de hoje ainda não foi marcado como publicado 👀"
        ).catch((err) => console.error("[scheduler] falha no lembrete:", err.message));
      }
    });
  });

  console.log("[scheduler] agendador iniciado.");
}

module.exports = { start, runDailySuggestionNow };
