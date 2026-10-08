// Armazenamento simples em arquivo JSON — suficiente para 1 cliente (Bruno) na v1.
// Quando a Sofia virar produto multi-cliente, isso vira um banco de verdade (Postgres),
// mas a "forma" dos dados (as chaves abaixo) pode continuar parecida.
const fs = require("fs");
const path = require("path");

// Onde o arquivo de dados fica salvo. Por padrão é uma pasta dentro do próprio
// código (server/data) — só que, no Railway, o filesystem é EFÊMERO: some todo
// deploy, e a Sofia "esquece" tudo (sugestão pendente, histórico). A correção é
// um Railway Volume (disco que sobrevive a deploys), montado num caminho — mas em
// vez de o código ter que adivinhar/acertar exatamente onde o Railway coloca os
// arquivos do projeto (ex: /app/server/data), a variável de ambiente opcional
// DATA_DIR deixa escolher: configure o Volume pra montar em, por exemplo, /data,
// e defina DATA_DIR=/data no Railway — os dois precisam ser o MESMO caminho. Sem
// essa variável definida, nada muda (continua gravando em server/data, como antes).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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
