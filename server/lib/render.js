// Renderizador das imagens prontas (post simples / carrossel), a partir de uma
// estrutura de "slides" gerada pela Sofia depois que o Bruno aprova uma sugestão.
// Usa @napi-rs/canvas (API de canvas, com a fonte carregada direto do arquivo) em
// vez de SVG+sharp — mais confiável entre ambientes diferentes, porque não depende
// de nenhuma fonte instalada no sistema operacional do servidor.
const path = require("path");
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { drawIllustration, chaveDaEspecialidade } = require("./illustrations");

// Pasta opcional com fotos reais por especialidade (server/stock/<chave>.jpg —
// chave igual à usada em illustrations.js: implantes, protocolo, facetas,
// alinhadores, harmonizacao). Se o arquivo não existir, o card cai de volta pro
// ícone desenhado — então dá pra ir adicionando fotos aos poucos, uma
// especialidade de cada vez, sem quebrar nada.
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

// Logo real do Atelier do Sorriso (server/logo.png, .jpg ou .jpeg — o primeiro
// que existir, direto dentro de server/, junto com as fontes). Se nenhum arquivo
// existir, o card cai de volta pro texto "ATELIER DO SORRISO" de sempre — então
// dá pra fazer deploy antes de ter a logo pronta, sem quebrar nada. PNG com fundo
// transparente é o ideal pro card navy; JPG funciona, mas vem com fundo
// (geralmente branco) por cima do card.
const LOGO_CANDIDATES = ["logo.png", "logo.jpg", "logo.jpeg"].map((f) =>
  path.join(__dirname, "..", f)
);
let logoPromise = null;
function carregarLogo() {
  if (!logoPromise) {
    logoPromise = (async () => {
      for (const file of LOGO_CANDIDATES) {
        if (fs.existsSync(file)) {
          try {
            return await loadImage(file);
          } catch (err) {
            console.error(`[render] falha ao carregar logo (${file}):`, err.message);
            return null;
          }
        }
      }
      return null; // nenhum arquivo de logo ainda — cai pro texto
    })();
  }
  return logoPromise; // cacheada: o arquivo não muda entre slides nem entre posts
}

const FONT_FAMILY = "SofiaSans";
GlobalFonts.registerFromPath(path.join(__dirname, "../Sans-Regular.ttf"), FONT_FAMILY);
GlobalFonts.registerFromPath(path.join(__dirname, "../Sans-Bold.ttf"), FONT_FAMILY);

const WIDTH = 1080;
const HEIGHT = 1350; // proporção 4:5, a mesma usada no carrossel de teste da fase 1

const NAVY = "#102a43";
const RED = "#d64545";
const WHITE = "#ffffff";
const LIGHT = "#cbd5e1";
const DOT_OFF = "#3b4f66";

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
// gerada por IA pra esse slide específico (imagemBuffer — só existe quando o Bruno
// pediu algo "mais elaborado", ver imagemElaborada em webhook.js/claude.js) > foto
// de banco fixa (server/stock/<chave>.jpg), que só se aplica à capa (índice 0).
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

async function drawSlide({ headline, body, footer }, index, total, especialidade, seed, imagemBuffer) {
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
      blend.addColorStop(0, "rgba(16, 42, 67, 0)");
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
      ctx.fillStyle = "rgba(214, 69, 69, 0.14)";
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

  // Marca — logo real (server/assets/logo.*), se existir; senão o texto de sempre.
  // Mesma posição nos dois casos (apoiada na mesma linha, perto do rodapé). A
  // maioria das logos é desenhada pra fundo claro (texto escuro, traços finos),
  // então fica ilegível solta em cima do navy do card — por isso desenhamos uma
  // "placa" clara atrás dela, do tamanho da logo + uma margem, pra ela aparecer
  // do jeito que foi desenhada.
  const logo = await carregarLogo();
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
    ctx.font = `700 30px "${FONT_FAMILY}"`;
    ctx.fillStyle = RED;
    ctx.fillText("ATELIER DO SORRISO", marginX, HEIGHT - 150);
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

// `especialidade` decide qual ícone desenhar (ver server/lib/illustrations.js);
// `seed` só escolhe entre as variações do ícone de forma estável (mesmo post =
// mesmo ícone, mesmo se for renderizado de novo) — pode ser a data do post, por
// exemplo. Ambos são opcionais: sem eles, o card sai só com texto, como antes.
// `imagensIA` é opcional: um array de Buffers (ou null/undefined em cada posição),
// alinhado por índice com `slides` — só é usado quando o Bruno pediu uma imagem
// mais elaborada pra esse post (ver imagemElaborada em webhook.js/claude.js). Onde
// tiver um Buffer, ele tem prioridade sobre a foto de banco fixa.
async function renderSlides(slides, especialidade, seed, imagensIA) {
  const buffers = [];
  // Sequencial (não Promise.all) de propósito: são poucas imagens por post, e
  // assim fica bem mais simples de ler os logs de erro se algo falhar numa delas.
  for (let i = 0; i < slides.length; i++) {
    const imagemBuffer = imagensIA && imagensIA[i] ? imagensIA[i] : null;
    buffers.push(await drawSlide(slides[i], i, slides.length, especialidade, seed, imagemBuffer));
  }
  return buffers;
}

module.exports = { renderSlides };
