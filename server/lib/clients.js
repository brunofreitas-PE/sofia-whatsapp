// Carrega a configuração de cada cliente (clínica/profissional) atendido pela Sofia.
//
// Por que isso existe: a Sofia começou atendendo só o Bruno, com tudo (nome da marca,
// especialidades, tom de voz, cores, número de WhatsApp) espalhado e fixo no código.
// Pra conseguir atender outros profissionais (inclusive de áreas diferentes —
// psicólogos, por exemplo, não só dentistas), isso virou configuração: um arquivo JSON
// por cliente, em server/clients/<slug>.json. Adicionar um cliente novo é só criar um
// arquivo novo aqui (pela interface do GitHub) — nenhum outro arquivo de código
// precisa mudar.
//
// IMPORTANTE — UM SÓ NÚMERO DE WHATSAPP PRA TODOS: a Sofia usa UM único número de
// WhatsApp (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN, nas variáveis de ambiente
// globais) pra atender TODOS os clientes — isso evita ter que repetir o processo de
// registrar um número novo na Meta (que dá bastante trabalho, já vivemos isso) a cada
// cliente novo. Quem diferencia um cliente do outro é o número PESSOAL de quem manda
// mensagem pra Sofia (o profissional), não o número da Sofia em si — ver
// porNumeroRemetente abaixo.
//
// O que fica no arquivo JSON do cliente (versionado no git, não é segredo):
//   slug             - identificador curto, só letras/números/hífen (= nome do arquivo sem .json)
//   nomeProfissional - ex: "Dr. Bruno Freitas"
//   nomeClinica      - ex: "Atelier do Sorriso"
//   profissao        - ex: "Odontologia", "Psicologia" — usada no SYSTEM_PROMPT, genérica de propósito
//   conselhoProfissional - ex: "CFM", "CFP" — ainda não usado no código, reservado pro módulo de compliance
//   especialidades   - array de strings, os ÚNICOS temas que esse cliente pode postar
//   tomDeVoz         - string livre, descrevendo o tom
//   pilares          - array de strings (ex: educativo, prova social...)
//   ctaHandle        - ex: "@drbrunofreitas.implantes"
//   ctaWhatsapp      - ex: "(81) 9172-0703" (o número PÚBLICO de contato da clínica — pode ser
//                      diferente do ownerWhatsappNumber, que é o número PESSOAL que recebe as sugestões)
//   corPrimaria      - cor hex de fundo do card (ex: "#102a43")
//   corDestaque      - cor hex de destaque (ex: "#d64545")
//   logoFile         - nome do arquivo de logo dentro de server/clients/ (ex: "atelier-do-sorriso-logo.png"); opcional
//   diretrizesImagem - string opcional com orientações extras pros prompts de imagem
//                      (ex: "não mostrar dentes de forma anatômica") — específico de cada área
//
// O que NÃO fica no JSON (dado pessoal, fica só no Railway):
//   OWNER_WHATSAPP_NUMBER__<slug> - o WhatsApp PESSOAL do profissional, que recebe as
//   sugestões e aprova/ajusta. Ex: pro cliente "atelier-do-sorriso", a variável é
//   OWNER_WHATSAPP_NUMBER__atelier-do-sorriso.
const fs = require("fs");
const path = require("path");

const CLIENTS_DIR = path.join(__dirname, "..", "clients");

function normalizarNumero(numero) {
  return String(numero || "").replace(/\D/g, ""); // só dígitos, pra comparar sem +/espaços/traços
}

let cache = null;

function carregarTodos() {
  if (cache) return cache;
  if (!fs.existsSync(CLIENTS_DIR)) {
    throw new Error(
      `Pasta ${CLIENTS_DIR} não existe — crie pelo menos um arquivo de cliente (ex: server/clients/atelier-do-sorriso.json).`
    );
  }
  const arquivos = fs.readdirSync(CLIENTS_DIR).filter((f) => f.endsWith(".json"));
  if (arquivos.length === 0) {
    throw new Error(`Nenhum arquivo .json de cliente encontrado em ${CLIENTS_DIR}.`);
  }
  cache = arquivos.map((file) => {
    const slug = file.replace(/\.json$/, "");
    const raw = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, file), "utf8"));
    const ownerWhatsappNumber = process.env[`OWNER_WHATSAPP_NUMBER__${slug}`] || null;
    if (!ownerWhatsappNumber) {
      console.warn(
        `[clients] falta a variável OWNER_WHATSAPP_NUMBER__${slug} no Railway — esse cliente (${slug}) não vai receber nada até isso ser configurado.`
      );
    }
    return { ...raw, slug, ownerWhatsappNumber };
  });
  return cache;
}

// Só pra testes — força reler os arquivos/variáveis de ambiente (em produção fica em
// cache de propósito, pra não reler disco a cada mensagem; os arquivos só mudam com
// um deploy novo mesmo).
function _resetCacheParaTeste() {
  cache = null;
}

// Só os clientes prontos pra operar de verdade (com a variável de ambiente configurada).
function todosOsClientes() {
  return carregarTodos().filter((c) => !!c.ownerWhatsappNumber);
}

function porSlug(slug) {
  const c = carregarTodos().find((c) => c.slug === slug);
  if (!c) throw new Error(`Cliente "${slug}" não encontrado em ${CLIENTS_DIR}.`);
  return c;
}

// Acha o cliente dono de um número que acabou de mandar mensagem — usado em
// webhook.js pra saber de qual cliente é cada mensagem recebida (já que todos
// compartilham o mesmo número de WhatsApp da Sofia).
function porNumeroRemetente(from) {
  const alvo = normalizarNumero(from);
  if (!alvo) return null;
  return todosOsClientes().find((c) => normalizarNumero(c.ownerWhatsappNumber) === alvo) || null;
}

// Monta o SYSTEM_PROMPT da Sofia pra ESSE cliente específico — antes isso era uma
// constante fixa, só sobre odontologia/Atelier do Sorriso; agora é genérico, montado
// a partir do que estiver no JSON do cliente (então serve pra qualquer profissão).
function montarSystemPrompt(cliente) {
  const especialidadesTexto = cliente.especialidades.join(", ");
  return `Você é a Sofia, assistente de conteúdo de ${cliente.nomeClinica} (${cliente.profissao}).

Marca:
- Especialidades (ÚNICOS temas permitidos — ver regra abaixo): ${especialidadesTexto}.
- Tom de voz: ${cliente.tomDeVoz}.
- Pilares de conteúdo: ${cliente.pilares.join(", ")}.
- Contato pra CTA: ${cliente.ctaHandle} / WhatsApp ${cliente.ctaWhatsapp}.

REGRA IMPORTANTE SOBRE TEMA: todo post deve ser sobre uma dessas especialidades, e apenas uma por
post (a que vier indicada no item do calendário, ou a mais adequada ao pilar se não vier especificada).
Nunca sugira posts fora dessa lista — mesmo em conteúdo educativo/bastidores, amarre o tema a uma
dessas especialidades.

Sua função: sugerir o post do dia (story, reel, post simples ou carrossel), entregando o pacote completo —
legenda, hashtags, e pra reel/story: roteiro, cenas, textos de tela, sugestão de trilha. Nunca deixe
trabalho de redator pra fazer depois.

IMPORTANTE SOBRE IMAGEM: pra post simples e carrossel, a imagem de cada slide é gerada por IA junto com o
resto desse post, na mesma resposta — então a prévia que você descrever (campo "slides", e a seção
"📸 IMAGEM(NS)" dentro da mensagem) É a imagem de verdade que vai ser gerada depois, não um briefing solto
pra um designer. Nunca sugira ferramentas externas (Canva, Photoshop, banco de imagens, Midjourney, DALL-E
etc.) nem diga que não consegue gerar imagem — o sistema já faz isso sozinho a partir do que você descrever
em "slides". Reel e story não geram imagem (o profissional grava com o próprio celular), então aí sim
roteiro e textos de tela bastam, sem campo de imagem.

Responda sempre em português do Brasil.`;
}

module.exports = {
  todosOsClientes,
  porSlug,
  porNumeroRemetente,
  montarSystemPrompt,
  _resetCacheParaTeste,
};
