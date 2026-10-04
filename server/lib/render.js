// Renderizador das imagens prontas (post simples / carrossel), a partir de uma
// estrutura de "slides" gerada pela Sofia depois que o Bruno aprova uma sugestão.
// Usa @napi-rs/canvas (API de canvas, com a fonte carregada direto do arquivo) em
// vez de SVG+sharp — mais confiável entre ambientes diferentes, porque não depende
// de nenhuma fonte instalada no sistema operacional do servidor.
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

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

function drawSlide({ headline, body, footer }, index, total) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Fundo
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 14, HEIGHT);

  const marginX = 80;
  const maxTextWidth = WIDTH - marginX - 80;

  // Headline
  ctx.font = `700 64px "${FONT_FAMILY}"`;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = "alphabetic";
  const headlineLines = wrapText(ctx, headline, maxTextWidth);

  let y = 300 - Math.max(0, headlineLines.length - 2) * 38;
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

  // Marca
  ctx.font = `700 30px "${FONT_FAMILY}"`;
  ctx.fillStyle = RED;
  ctx.fillText("ATELIER DO SORRISO", marginX, HEIGHT - 150);

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

async function renderSlides(slides) {
  return slides.map((slide, i) => drawSlide(slide, i, slides.length));
}

module.exports = { renderSlides };
