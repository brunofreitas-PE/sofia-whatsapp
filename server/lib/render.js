// Renderizador das imagens prontas (post simples / carrossel), a partir de uma
// estrutura de "slides" gerada pela Sofia depois que o Bruno aprova uma sugestão.
// Usa SVG (montado em string) + sharp pra rasterizar em PNG — sem precisar de
// nenhum serviço externo de geração de imagem.
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// A fonte vem embutida (base64) direto no SVG via @font-face, em vez de depender
// de alguma fonte instalada no servidor — o Railway não vem com nenhuma fonte por
// padrão, e sem isso o texto saía como quadradinhos vazios (tofu). Os arquivos são
// um subconjunto só com os caracteres latinos/acentos que a gente usa (bem leve).
const FONT_REGULAR_B64 = fs
  .readFileSync(path.join(__dirname, "../Sans-Regular.ttf"))
  .toString("base64");
const FONT_BOLD_B64 = fs
  .readFileSync(path.join(__dirname, "../Sans-Bold.ttf"))
  .toString("base64");
const FONT_FACE_CSS = `<style>
@font-face { font-family: "SofiaSans"; src: url(data:font/ttf;base64,${FONT_REGULAR_B64}) format("truetype"); font-weight: 400; }
@font-face { font-family: "SofiaSans"; src: url(data:font/ttf;base64,${FONT_BOLD_B64}) format("truetype"); font-weight: 700; }
</style>`;

const WIDTH = 1080;
const HEIGHT = 1350; // proporção 4:5, a mesma usada no carrossel de teste da fase 1

const NAVY = "#102a43";
const RED = "#d64545";
const WHITE = "#ffffff";
const LIGHT = "#cbd5e1";
const DOT_OFF = "#3b4f66";

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Quebra de linha simples por contagem de caracteres (sem medir largura real da
// fonte — suficiente pro estilo de texto grande/curto que usamos aqui).
function wrapText(text, maxCharsPerLine) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function slideSVG({ headline, body, footer }, index, total) {
  const headlineLines = wrapText(headline, 20);
  const bodyLines = wrapText(body, 34);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`;
  svg += FONT_FACE_CSS;
  svg += `<rect width="${WIDTH}" height="${HEIGHT}" fill="${NAVY}"/>`;
  svg += `<rect x="0" y="0" width="14" height="${HEIGHT}" fill="${RED}"/>`;

  let y = 300 - Math.max(0, headlineLines.length - 2) * 38;
  for (const line of headlineLines) {
    svg += `<text x="80" y="${y}" font-family="SofiaSans" font-size="64" font-weight="700" fill="${WHITE}">${escapeXml(
      line
    )}</text>`;
    y += 76;
  }

  y += 44;
  for (const line of bodyLines) {
    svg += `<text x="80" y="${y}" font-family="SofiaSans" font-size="36" fill="${LIGHT}">${escapeXml(
      line
    )}</text>`;
    y += 50;
  }

  svg += `<text x="80" y="${HEIGHT - 150}" font-family="SofiaSans" font-size="30" font-weight="700" fill="${RED}">ATELIER DO SORRISO</text>`;
  if (footer) {
    const footerLines = wrapText(footer, 48);
    let fy = HEIGHT - 100;
    for (const line of footerLines) {
      svg += `<text x="80" y="${fy}" font-family="SofiaSans" font-size="26" fill="${LIGHT}">${escapeXml(
        line
      )}</text>`;
      fy += 36;
    }
  }

  if (total > 1) {
    const dotsY = HEIGHT - 40;
    const spacing = 26;
    const startX = WIDTH / 2 - ((total - 1) * spacing) / 2;
    for (let i = 0; i < total; i++) {
      const cx = startX + i * spacing;
      svg += `<circle cx="${cx}" cy="${dotsY}" r="7" fill="${i === index ? RED : DOT_OFF}"/>`;
    }
  }

  svg += `</svg>`;
  return svg;
}

async function renderSlides(slides) {
  const buffers = [];
  for (let i = 0; i < slides.length; i++) {
    const svg = slideSVG(slides[i], i, slides.length);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    buffers.push(png);
  }
  return buffers;
}

module.exports = { renderSlides, slideSVG };
