// Armazenamento simples em arquivo JSON, um por cliente (ver lib/clients.js) — cada
// cliente tem seu próprio arquivo, pra nunca misturar a sugestão pendente/histórico de
// um cliente com o de outro. Quando a Sofia crescer bastante, isso vira um banco de
// verdade (Postgres), mas a "forma" dos dados (as chaves abaixo) pode continuar parecida.
const fs = require("fs");
const path = require("path");

// Onde os arquivos de dados ficam salvos. Por padrão é uma pasta dentro do próprio
// código (server/data) — só que, no Railway, o filesystem é EFÊMERO: some todo
// deploy, e a Sofia "esquece" tudo (sugestão pendente, histórico). A correção é
// um Railway Volume (disco que sobrevive a deploys), montado num caminho — mas em
// vez de o código ter que adivinhar/acertar exatamente onde o Railway coloca os
// arquivos do projeto (ex: /app/server/data), a variável de ambiente opcional
// DATA_DIR deixa escolher: configure o Volume pra montar em, por exemplo, /data,
// e defina DATA_DIR=/data no Railway — os dois precisam ser o MESMO caminho. Sem
// essa variável definida, nada muda (continua gravando em server/data, como antes).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

function dbPath(slug) {
  if (!slug || typeof slug !== "string") {
    throw new Error("store.js: load(slug)/save(slug, state) precisam do slug do cliente.");
  }
  return path.join(DATA_DIR, `${slug}.json`);
}

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

// Migração de uma vez só: antes de existir multi-cliente, tudo ficava num único
// DATA_DIR/db.json — e o único cliente que existia até aqui era o Bruno
// ("atelier-do-sorriso"). Por isso essa migração é restrita a ESSE slug específico,
// de propósito: se fosse "qualquer cliente que ainda não tem arquivo", um cliente
// NOVO (sem nenhuma relação com esse histórico) correria o risco de "herdar" por
// engano a sugestão pendente do Bruno, só por ter sido carregado antes dele.
function migrarDoArquivoAntigoSePreciso(slug) {
  if (slug !== "atelier-do-sorriso") return;
  const legacyPath = path.join(DATA_DIR, "db.json");
  const novoPath = dbPath(slug);
  if (!fs.existsSync(novoPath) && fs.existsSync(legacyPath)) {
    fs.mkdirSync(path.dirname(novoPath), { recursive: true });
    fs.renameSync(legacyPath, novoPath);
    console.log(`[store] migrado server/data/db.json (formato antigo) para ${novoPath} (cliente "${slug}").`);
  }
}

function load(slug) {
  migrarDoArquivoAntigoSePreciso(slug);
  const file = dbPath(slug);
  if (!fs.existsSync(file)) {
    save(slug, defaultState());
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function save(slug, state) {
  const file = dbPath(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

module.exports = { load, save };
