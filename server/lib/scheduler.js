// Agendador: dispara a sugestão do dia e os lembretes de publicação.
// Horários em cron (fuso do servidor — configure TZ=America/Sao_Paulo no Railway).
const cron = require("node-cron");
const { sendText } = require("./whatsapp");
const { generateSuggestion } = require("./claude");
const { load, save } = require("./store");

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
      const state = load();
      const today = new Date().toISOString().slice(0, 10);
      const calendarItem =
        state.calendar.find((i) => i.date === today) || {
          date: today,
          pillar: "educativo",
          format: "post simples",
          title: "(sem item no calendário — gerar algo genérico)",
        };
      const suggestion = await generateSuggestion({ calendarItem });
      await sendText(owner, suggestion);
      state.pendingSuggestion = { date: today, text: suggestion, status: "aguardando" };
      save(state);
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

module.exports = { start };
