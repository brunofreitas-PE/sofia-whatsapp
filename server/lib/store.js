// Armazenamento simples em arquivo JSON — suficiente para 1 cliente (Bruno) na v1.
// Quando a Sofia virar produto multi-cliente, isso vira um banco de verdade (Postgres),
// mas a "forma" dos dados (as chaves abaixo) pode continuar parecida.
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function defaultState() {
  return {
    // calendário do mês: lista de itens { date, pillar, format, title, status }
    calendar: [],
    // sugestão do dia atualmente aguardando aprovação/ajuste do Bruno
    pendingSuggestion: null,
    // histórico simples de conversas/decisões, pra dar contexto pra Sofia depois
    history: [],
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultState());
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function save(state) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

module.exports = { load, save };
