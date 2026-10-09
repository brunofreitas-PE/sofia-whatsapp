// Ícones ilustrativos (estilo "line art") pra cada uma das 5 especialidades do
// Atelier do Sorriso. Desenhados direto no canvas (sem foto, sem IA de imagem, sem
// arquivo externo) — assim não depende de nenhuma conta/API nova nem de upload de
// imagem no GitHub, e o visual fica sempre consistente com a marca.
//
// Cada especialidade tem 2 variações ("variant" 0 e 1) só pra não repetir sempre o
// mesmo desenho — dá pra adicionar mais variações aqui no futuro sem mexer no resto
// do código (isso é a "renovação do banco de imagens" combinada com o Bruno).
//
// Sistema de coordenadas: cada função desenha dentro de um quadrado local de
// -50 a 50 (centro em 0,0). drawIllustration() cuida de posicionar/escalar isso
// pro tamanho e posição reais no slide.
//
// Estilo "ícone preenchido": as silhuetas principais (dente, rosto) ficam
// preenchidas sólidas, não só contornadas — fica com mais peso visual/mais rico.
// Detalhes desenhados POR CIMA de uma silhueta preenchida (brilho, sorriso,
// estrelinha) usam a cor de CONTRASTE (a cor de fundo do card) em vez da cor do
// ícone, senão ficariam brancos sobre branco e desapareceriam. Essa cor é
// client-specific agora (cada cliente tem sua própria corPrimaria — ver
// lib/clients.js e lib/render.js) — por isso é passada como parâmetro
// (`contrast`) em vez de uma constante fixa; o valor abaixo é só o padrão de
// segurança, caso alguma chamada antiga não passe nada.
const CONTRAST_PADRAO = "#102a43";

function tooth(ctx, { rootsVisible = true } = {}) {
  // Coroa (parte de cima, arredondada) + duas raízes (parte de baixo, pontudas).
  ctx.beginPath();
  ctx.moveTo(-17, -8);
  ctx.bezierCurveTo(-19, -28, 19, -28, 17, -8);
  ctx.bezierCurveTo(17, 2, 11, 2, 9, 10);
  if (rootsVisible) {
    ctx.bezierCurveTo(8, 20, 4, 24, 2, 16);
    ctx.bezierCurveTo(1, 22, -1, 22, -2, 16);
    ctx.bezierCurveTo(-4, 24, -8, 20, -9, 10);
  } else {
    ctx.lineTo(-9, 10);
  }
  ctx.bezierCurveTo(-11, 2, -17, 2, -17, -8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function implantScrew(ctx, x, yTop, h) {
  // Pino/parafuso do implante: corpo afunilado + linhas de rosca.
  ctx.beginPath();
  ctx.moveTo(x - 6, yTop);
  ctx.lineTo(x - 3.5, yTop + h);
  ctx.lineTo(x + 3.5, yTop + h);
  ctx.lineTo(x + 6, yTop);
  ctx.stroke();
  const threads = 4;
  for (let i = 1; i <= threads; i++) {
    const ly = yTop + (h * i) / (threads + 1);
    const w = 6 - (2.5 * i) / threads;
    ctx.beginPath();
    ctx.moveTo(x - w, ly);
    ctx.lineTo(x + w, ly);
    ctx.stroke();
  }
}

// --- Implantes dentários -----------------------------------------------
function implantesV0(ctx) {
  ctx.save();
  ctx.translate(0, -14);
  tooth(ctx, { rootsVisible: false });
  ctx.restore();
  implantScrew(ctx, 0, 6, 26);
}

function implantesV1(ctx) {
  // Visão "explodida": coroa, pilar e parafuso separados por um pequeno espaço,
  // sugerindo as peças do implante.
  ctx.save();
  ctx.translate(0, -30);
  ctx.scale(0.8, 0.8);
  tooth(ctx, { rootsVisible: false });
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(-6, -8);
  ctx.lineTo(-4, 2);
  ctx.lineTo(4, 2);
  ctx.lineTo(6, -8);
  ctx.stroke();

  implantScrew(ctx, 0, 10, 24);
}

// --- Prótese / Protocolo -------------------------------------------------
function proteseV0(ctx) {
  // Arco de "dentes" (ponte) apoiado numa base — vista frontal simplificada.
  const n = 5;
  const spacing = 15;
  const startX = -((n - 1) * spacing) / 2;
  ctx.beginPath();
  ctx.moveTo(startX - 10, 14);
  ctx.lineTo(startX + (n - 1) * spacing + 10, 14);
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const x = startX + i * spacing;
    ctx.beginPath();
    ctx.moveTo(x - 6, 14);
    ctx.bezierCurveTo(x - 7, -4, x + 7, -4, x + 6, 14);
    ctx.stroke();
  }
}

function proteseV1(ctx) {
  // Arco (U) com divisórias de dentes — vista oclusal (de cima) simplificada.
  ctx.beginPath();
  ctx.moveTo(-26, -10);
  ctx.bezierCurveTo(-30, 20, 30, 20, 26, -10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-18, -6);
  ctx.bezierCurveTo(-21, 16, 21, 16, 18, -6);
  ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    const x = i * 9;
    const yTop = -4 + Math.abs(i) * 1.5;
    const yBot = 17 - Math.abs(i) * 2;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBot);
    ctx.stroke();
  }
}

// --- Facetas em resina 3D -------------------------------------------------
function sparkle(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.28, y - s * 0.28);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s * 0.28, y + s * 0.28);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s * 0.28, y + s * 0.28);
  ctx.lineTo(x - s, y);
  ctx.lineTo(x - s * 0.28, y - s * 0.28);
  ctx.closePath();
  ctx.stroke();
}

function facetasV0(ctx, contrast = CONTRAST_PADRAO) {
  ctx.save();
  ctx.translate(0, -2);
  tooth(ctx);
  ctx.restore();
  // "brilho" diagonal sobre o dente preenchido — precisa da cor de contraste,
  // senão fica branco sobre branco e some.
  ctx.save();
  ctx.strokeStyle = contrast;
  ctx.beginPath();
  ctx.moveTo(-8, -24);
  ctx.lineTo(-2, -4);
  ctx.stroke();
  ctx.restore();
  sparkle(ctx, 20, -22, 7);
}

function facetasV1(ctx, contrast = CONTRAST_PADRAO) {
  ctx.save();
  ctx.translate(-13, 0);
  ctx.scale(0.72, 0.72);
  tooth(ctx);
  ctx.restore();
  ctx.save();
  ctx.translate(13, 0);
  ctx.scale(0.72, 0.72);
  tooth(ctx);
  ctx.restore();
  sparkle(ctx, 0, -30, 6);
}

// --- Alinhadores -------------------------------------------------------
function alinhadorV0(ctx) {
  // Bandeja/placa invisível: arco duplo (contorno externo + interno) com marcas
  // de dentes, mais leve que o desenho de prótese (sem base sólida).
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.bezierCurveTo(-30, 22, 30, 22, 26, -6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.bezierCurveTo(-29, 16, 29, 16, 26, -6);
  ctx.stroke();
  for (let i = -3; i <= 3; i++) {
    const x = i * 7;
    const yTop = -2 + Math.abs(i) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yTop + 14);
    ctx.stroke();
  }
}

function alinhadorV1(ctx) {
  // Duas bandejas empilhadas (superior/inferior), sugerindo o par do tratamento.
  ctx.save();
  ctx.translate(0, -14);
  ctx.scale(0.85, 0.6);
  alinhadorV0(ctx);
  ctx.restore();
  ctx.save();
  ctx.translate(0, 16);
  ctx.scale(0.85, 0.6);
  ctx.rotate(Math.PI);
  alinhadorV0(ctx);
  ctx.restore();
}

// --- Harmonização Facial -------------------------------------------------
function faceProfileV0(ctx, contrast = CONTRAST_PADRAO) {
  // Perfil do rosto, de lado, com um leve sorriso.
  ctx.beginPath();
  ctx.moveTo(-6, -32);
  ctx.bezierCurveTo(14, -32, 22, -18, 20, -4);
  ctx.bezierCurveTo(26, -2, 24, 6, 18, 6);
  ctx.bezierCurveTo(18, 14, 12, 16, 10, 22);
  ctx.bezierCurveTo(8, 28, 0, 30, -6, 28);
  ctx.bezierCurveTo(-16, 25, -20, 14, -18, 0);
  ctx.bezierCurveTo(-24, -4, -22, -26, -6, -32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // leve curva de sorriso + brilho, por cima da silhueta preenchida — usa a cor
  // de contraste (senão fica branco sobre branco e some).
  ctx.save();
  ctx.strokeStyle = contrast;
  ctx.beginPath();
  ctx.moveTo(4, 14);
  ctx.quadraticCurveTo(10, 17, 14, 13);
  ctx.stroke();
  sparkle(ctx, -14, -16, 5);
  ctx.restore();
}

function faceProfileV1(ctx, contrast = CONTRAST_PADRAO) {
  // Rosto de frente (oval simples) com eixo central tracejado, sugerindo simetria,
  // e dois pontos de brilho nas maçãs do rosto.
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 27, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eixo de simetria, sorriso e brilhos — tudo por cima do rosto preenchido, em
  // cor de contraste (senão fica branco sobre branco e some).
  ctx.save();
  ctx.strokeStyle = contrast;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(0, 24);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-6, 10);
  ctx.quadraticCurveTo(0, 14, 6, 10);
  ctx.stroke();
  sparkle(ctx, -13, -2, 5);
  sparkle(ctx, 13, -2, 5);
  ctx.restore();
}

const BANCO = {
  implantes: [implantesV0, implantesV1],
  protocolo: [proteseV0, proteseV1],
  facetas: [facetasV0, facetasV1],
  alinhadores: [alinhadorV0, alinhadorV1],
  harmonizacao: [faceProfileV0, faceProfileV1],
};

// Reconhece a especialidade (texto livre, como vem do calendário/sugestão) e
// devolve a chave usada em BANCO acima. Mantém só um ponto de mapeamento pra não
// espalhar essa lógica — se um dia mudar o texto das especialidades, mexe só aqui.
function chaveDaEspecialidade(especialidade) {
  const e = (especialidade || "").toLowerCase();
  if (e.includes("implante")) return "implantes";
  if (e.includes("prótese") || e.includes("protese") || e.includes("protocolo")) return "protocolo";
  if (e.includes("faceta")) return "facetas";
  if (e.includes("alinhador")) return "alinhadores";
  if (e.includes("harmoniza")) return "harmonizacao";
  return null; // especialidade não reconhecida — quem chama decide o que fazer (ex: não desenhar ícone)
}

// Escolhe determinísticamente uma das variações pra uma especialidade+data, pra
// não ficar sempre a mesma mas também não sortear diferente a cada re-render do
// mesmo post (ex: ao reenviar carrossel).
function escolherVariante(chave, seed) {
  const variantes = BANCO[chave];
  if (!variantes || variantes.length === 0) return null;
  const s = String(seed || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return variantes[s % variantes.length];
}

// Desenha a ilustração da especialidade centralizada em (cx, cy), ocupando
// aproximadamente `size` pixels de diâmetro. `color`/`lineWidth` seguem o estilo
// do resto do card (ver server/lib/render.js). `contrastColor` é a cor de fundo
// do card do cliente que está sendo renderizado (cliente.corPrimaria) — usada só
// pelos detalhes desenhados por cima das silhuetas preenchidas (brilho, sorriso);
// se omitida, cai no padrão de segurança (CONTRAST_PADRAO).
function drawIllustration(ctx, { especialidade, seed, cx, cy, size, color, lineWidth = 3.2, contrastColor }) {
  const chave = chaveDaEspecialidade(especialidade);
  if (!chave) return false;
  const fn = escolherVariante(chave, seed);
  if (!fn) return false;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 100, size / 100);
  ctx.strokeStyle = color;
  ctx.fillStyle = color; // silhuetas principais (dente, rosto) são preenchidas, não só contornadas
  ctx.lineWidth = lineWidth / (size / 100);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  fn(ctx, contrastColor || CONTRAST_PADRAO);
  ctx.restore();
  return true;
}

module.exports = { drawIllustration, chaveDaEspecialidade };
