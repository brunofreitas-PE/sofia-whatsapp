// Agendador: dispara a sugestão do dia e os lembretes de publicação.
// Horários em cron (fuso do servidor — configure TZ=America/Sao_Paulo no Railway).
const cron = require("node-cron");
const { sendText } = require("./whatsapp");
const { generateSuggestion } = require("./claude");
const { load, save } = require("./store");

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
      title: `Especialidade do dia (sem item específico no calendário): ${especialidadeDoDia(
        agora
      )}`,
    };
  const suggestion = await generateSuggestion({ calendarItem });
  await sendText(owner, suggestion);
  state.pendingSuggestion = { date: today, text: suggestion, status: "aguardando" };
  save(state);
  return suggestion;
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
