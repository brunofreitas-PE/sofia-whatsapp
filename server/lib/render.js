// Renderizador das imagens prontas (post simples / carrossel), a partir de uma
// estrutura de "slides" gerada pela Sofia depois que o profissional aprova uma
// sugestão. Usa @napi-rs/canvas (API de canvas, com a fonte carregada direto do
// arquivo) em vez de SVG+sharp — mais confiável entre ambientes diferentes,
// porque não depende de nenhuma fonte instalada no sistema operacional do
// servidor.
//
// Multi-cliente: cores e logo vêm do `cliente` (ver lib/clients.js), não de
// constantes fixas — assim cada clínica/profissional tem sua própria
// identidade visual no card, sem precisar editar esse arquivo pra cada um.
const path = require("path");
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { drawIllustration, chaveDaEspecialidade } = require("./illustrations");

// Pasta opcional com fotos reais por especialidade (server/stock/<chave>.jpg —
// chave igual à usada em illustrations.js: implantes, protocolo, facetas,
// alinhadores, harmonizacao). Se o arquivo não existir, o card cai de volta pro
// ícone desenhado — então dá pra ir adicionando fotos aos poucos, uma
// especialidade de cada vez, sem quebrar nada. (Essas fotos continuam
// compartilhadas entre clientes por enquanto — são específicas de odontologia;
// um cliente de outra profissão simplesmente nunca bate em nenhuma chave e cai
// pro ícone/texto, sem erro.)
const STOCK_DIR = path.join(__dirname, "..", "stock");

async function carregarFotoDaEspecialidade(especialidade) {
  const chave = chaveDaEspecialidade(especialidade);
  if (!chave) return null;
  const file = path.join(STOCK_DIR, `${chave}.jpg`);
  if (!fs.existsSync(file)) return null;
  try {
    return await loadImage(file);
  } catch (err) {
    console.error(`[render] falha ao carregar foto de "${chave}":`, err.message);
    return null;
  }
}

// Logo de cada cliente: server/clients/<cliente.logoFile> (ver o schema em
// lib/clients.js). Se o cliente não tiver `logoFile` configurado, ou o arquivo
// não existir ainda, o card cai de volta pro texto com o nome da clínica — então
// dá pra cadastrar um cliente novo antes de ter a logo pronta, sem quebrar nada.
// PNG com fundo transparente é o ideal (o card desenha uma placa clara atrás da
// logo pra ela ficar legível em qualquer cor de fundo).
//
// Cacheada POR CLIENTE (slug), não globalmente — antes só existia um cliente
// então um único cache bastava; agora cada slug pode ter uma logo diferente, e
// cachear teria que ser por arquivo, não um valor fixo só.
const CLIENTS_DIR = path.join(__dirname, "..", "clients");
const logoPromises = new Map(); // slug -> Promise<Image|null>

function carregarLogo(cliente) {
  const slug = cliente?.slug || "default";
  if (!logoPromises.has(slug)) {
    logoPromises.set(
      slug,
      (async () => {
        if (!cliente?.logoFile) return null;
        const file = path.join(CLIENTS_DIR, cliente.logoFile);
        if (!fs.existsSync(file)) return null;
        try {
          return await loadImage(file);
        } catch (err) {
          console.error(`[render] falha ao carregar logo do cliente "${slug}" (${file}):`, err.message);
          return null;
        }
      })()
    );
  }
  return logoPromises.get(slug); // cacheada: o arquivo não muda entre slides nem entre posts
}

const FONT_FAMILY = "SofiaSans";
GlobalFonts.registerFromPath(path.join(__dirname, "../Sans-Regular.ttf"), FONT_FAMILY);
GlobalFonts.registerFromPath(path.join(__dirname, "../Sans-Bold.ttf"), FONT_FAMILY);

const WIDTH = 1080;
const HEIGHT = 1350; // proporção 4:5, a mesma usada no carrossel de teste da fase 1

// Cores NEUTRAS (não dependem do cliente): texto claro/escuro e bolinhas do
// carrossel funcionam bem em cima de qualquer corPrimaria razoavelmente escura.
// corPrimaria/corDestaque (navy/vermelho no caso do Atelier do Sorriso) vêm de
// cada cliente agora — ver resolverCores() abaixo.
const WHITE = "#ffffff";
const LIGHT = "#cbd5e1";
const DOT_OFF = "#3b4f66";

// Valores de segurança, usados só se um cliente (por engano) não tiver
// corPrimaria/corDestaque configurados no JSON — pra nunca quebrar o render.
const COR_PRIMARIA_PADRAO = "#102a43";
const COR_DESTAQUE_PADRAO = "#d64545";

function resolverCores(cliente) {
  return {
    primaria: cliente?.corPrimaria || COR_PRIMARIA_PADRAO,
    destaque: cliente?.corDestaque || COR_DESTAQUE_PADRAO,
  };
}

// Converte uma cor hex (#rrggbb) pra rgba(...) com a opacidade pedida — usado
// pro disco sutil atrás do ícone da capa, que precisa ser uma versão bem
// transparente da cor de destaque do cliente (antes era um rgba fixo calculado
// manualmente a partir do vermelho do Atelier do Sorriso).
function hexParaRgba(hex, alpha) {
  const limpo = String(hex || "").replace("#", "");
  if (limpo.length !== 6) return `rgba(214, 69, 69, ${alpha})`; // fallback se vier algo inesperado
  const r = parseInt(limpo.slice(0, 2), 16);
  const g = parseInt(limpo.slice(2, 4), 16);
  const b = parseInt(limpo.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Quebra de linha medindo a largura real do texto na fonte (em vez de contar
// caracteres) — mais preciso agora que temos acesso à métrica de verdade via canvas.
function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Resolve qual imagem (se alguma) vai no topo deste slide. Prioridade: imagem
// gerada por IA pra esse slide específico (imagemBuffer — só existe quando o
// profissional pediu algo "mais elaborado", ver imagemElaborada em
// webhook.js/claude.js) > foto de banco fixa (server/stock/<chave>.jpg), que só
// se aplica à capa (índice 0).
async function resolverFotoDoSlide({ index, especialidade, imagemBuffer }) {
  if (imagemBuffer) {
    try {
      return await loadImage(imagemBuffer);
    } catch (err) {
      console.error(`[render] falha ao carregar imagem gerada por IA (slide ${index}):`, err.message);
    }
  }
  if (index === 0) {
    return await carregarFotoDaEspecialidade(especialidade);
  }
  return null;
}

async function drawSlide(cliente, { headline, body, footer }, index, total, especialidade, seed, imagemBuffer) {
  const { primaria: NAVY, destaque: RED } = resolverCores(cliente);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Fundo
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 14, HEIGHT);

  const marginX = 80;
  const maxTextWidth = WIDTH - marginX - 80;

  // Topo do card — imagem (foto de banco ou gerada por IA) + ícone de fallback só
  // valem pra capa (índice 0); um slide do meio só ganha imagem no topo se vier uma
  // imagem gerada por IA especificamente pra ele (imagemBuffer). Se não tiver nada
  // disso, o slide fica só com texto, como sempre foi.
  let headlineBaseY = 300; // padrão: sem nada no topo
  {
    const foto = await resolverFotoDoSlide({ index, especialidade, imagemBuffer });
    if (foto) {
      const panelH = 560;
      // "cover": escala pra preencher o painel inteiro sem distorcer, cortando o excesso.
      const scale = Math.max(WIDTH / foto.width, panelH / foto.height);
      const w = foto.width * scale;
      const h = foto.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, WIDTH, panelH);
      ctx.clip();
      ctx.drawImage(foto, (WIDTH - w) / 2, (panelH - h) / 2, w, h);
      ctx.restore();
      // gradiente escurecendo a base da foto, pra fundir com o resto do card
      const blend = ctx.createLinearGradient(0, panelH - 220, 0, panelH);
      blend.addColorStop(0, hexParaRgba(NAVY, 0));
      blend.addColorStop(1, NAVY);
      ctx.fillStyle = blend;
      ctx.fillRect(0, panelH - 220, WIDTH, 220);
      headlineBaseY = panelH + 90;
    } else if (index === 0) {
      const badgeCx = WIDTH / 2;
      const badgeCy = 190;
      const badgeR = 76;
      ctx.save();
      // disco de fundo bem sutil, só pra dar profundidade atrás do ícone
      ctx.fillStyle = hexParaRgba(RED, 0.14);
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const temIlustracao = drawIllustration(ctx, {
        especialidade,
        seed,
        cx: badgeCx,
        cy: badgeCy,
        size: badgeR * 1.5,
        color: WHITE,
        lineWidth: 3.2,
        contrastColor: NAVY,
      });
      if (temIlustracao) {
        headlineBaseY = 430;
      } else {
        // Não desenhou ícone (especialidade não reconhecida) — apaga o círculo vazio
        // redesenhando o fundo por cima, pra não sobrar um anel sem sentido no card.
        ctx.fillStyle = NAVY;
        ctx.beginPath();
        ctx.arc(badgeCx, badgeCy, badgeR + 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Headline
  ctx.font = `700 64px "${FONT_FAMILY}"`;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = "alphabetic";
  const headlineLines = wrapText(ctx, headline, maxTextWidth);

  let y = headlineBaseY - Math.max(0, headlineLines.length - 2) * 38;
  for (const line of headlineLines) {
    ctx.fillText(line, marginX, y);
    y += 76;
  }

  // Corpo
  y += 44;
  ctx.font = `400 36px "${FONT_FAMILY}"`;
  ctx.fillStyle = LIGHT;
  const bodyLines = wrapText(ctx, body, maxTextWidth);
  for (const line of bodyLines) {
    ctx.fillText(line, marginX, y);
    y += 50;
  }

  // Marca — logo real do cliente (server/clients/<logoFile>), se existir; senão o
  // nome da clínica em texto. Mesma posição nos dois casos (apoiada na mesma
  // linha, perto do rodapé). A maioria das logos é desenhada pra fundo claro
  // (texto escuro, traços finos), então fica ilegível solta em cima do card
  // colorido — por isso desenhamos uma "placa" clara atrás dela, do tamanho da
  // logo + uma margem, pra ela aparecer do jeito que foi desenhada.
  const logo = await carregarLogo(cliente);
  if (logo) {
    // Centro vertical fixo pra placa+logo, acima da linha do rodapé opcional
    // (HEIGHT-100) com folga suficiente pra nunca encostar nele.
    const logoCenterY = HEIGHT - 185;
    const maxLogoW = 220;
    const targetH = 50;
    let logoH = targetH;
    let logoW = (logo.width / logo.height) * logoH;
    if (logoW > maxLogoW) {
      logoW = maxLogoW;
      logoH = (logo.height / logo.width) * logoW;
    }
    const logoX = marginX;
    const logoY = logoCenterY - logoH / 2;
    const pad = 14;
    ctx.save();
    ctx.fillStyle = "#f4f6f8"; // branco levemente acinzentado, mais confortável que branco puro
    ctx.beginPath();
    ctx.roundRect(logoX - pad, logoY - pad, logoW + pad * 2, logoH + pad * 2, 14);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(logo, logoX, logoY, logoW, logoH);
  } else {
    const nomeExibido = (cliente?.nomeClinica || cliente?.nomeProfissional || "").toUpperCase();
    ctx.font = `700 30px "${FONT_FAMILY}"`;
    ctx.fillStyle = RED;
    ctx.fillText(nomeExibido, marginX, HEIGHT - 150);
  }

  // Rodapé opcional
  if (footer) {
    ctx.font = `400 26px "${FONT_FAMILY}"`;
    ctx.fillStyle = LIGHT;
    const footerLines = wrapText(ctx, footer, maxTextWidth);
    let fy = HEIGHT - 100;
    for (const line of footerLines) {
      ctx.fillText(line, marginX, fy);
      fy += 36;
    }
  }

  // Bolinhas de carrossel
  if (total > 1) {
    const dotsY = HEIGHT - 40;
    const spacing = 26;
    const startX = WIDTH / 2 - ((total - 1) * spacing) / 2;
    for (let i = 0; i < total; i++) {
      const cx = startX + i * spacing;
      ctx.beginPath();
      ctx.arc(cx, dotsY, 7, 0, Math.PI * 2);
      ctx.fillStyle = i === index ? RED : DOT_OFF;
      ctx.fill();
    }
  }

  return canvas.toBuffer("image/png");
}

// `cliente` (ver lib/clients.js) decide as cores (corPrimaria/corDestaque) e a
// logo (logoFile) do card — ver resolverCores()/carregarLogo() acima.
// `especialidade` decide qual ícone desenhar (ver server/lib/illustrations.js);
// `seed` só escolhe entre as variações do ícone de forma estável (mesmo post =
// mesmo ícone, mesmo se for renderizado de novo) — pode ser a data do post, por
// exemplo. Ambos são opcionais: sem eles, o card sai só com texto, como antes.
// `imagensIA` é opcional: um array de Buffers (ou null/undefined em cada posição),
// alinhado por índice com `slides` — só é usado quando o profissional pediu uma
// imagem mais elaborada pra esse post (ver imagemElaborada em
// webhook.js/claude.js). Onde tiver um Buffer, ele tem prioridade sobre a foto de
// banco fixa.
async function renderSlides(cliente, slides, especialidade, seed, imagensIA) {
  const buffers = [];
  // Sequencial (não Promise.all) de propósito: são poucas imagens por post, e
  // assim fica bem mais simples de ler os logs de erro se algo falhar numa delas.
  for (let i = 0; i < slides.length; i++) {
    const imagemBuffer = imagensIA && imagensIA[i] ? imagensIA[i] : null;
    buffers.push(await drawSlide(cliente, slides[i], i, slides.length, especialidade, seed, imagemBuffer));
  }
  return buffers;
}

module.exports = { renderSlides };
