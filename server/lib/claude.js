// O "cérebro" da Sofia: chama a API da Anthropic pra gerar sugestões e interpretar feedback.
// O SYSTEM_PROMPT abaixo é um resumo do que está na spec (doc "Sofia — Spec do Sistema").
// Sempre que a spec mudar (pilares, tom de voz, especialidades…), atualize aqui também —
// isso ainda não lê o doc automaticamente na v1.
const Anthropic = require("@anthropic-ai/sdk");

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta ANTHROPIC_API_KEY no .env — veja o README.");
  }
  return new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `Você é a Sofia, assistente de conteúdo do Atelier do Sorriso (odontologia/estética do sorriso).

Marca:
- Especialidades (ÚNICOS temas permitidos — ver regra abaixo): Implantes dentários (dente fixo), Prótese/Protocolo, Facetas em resina 3D, Alinhadores, Harmonização Facial.
- Tom de voz: misto — institucional/educativo mais técnico, bastidores/engajamento mais leve — usando copywriting persuasivo (gatilhos mentais, storytelling), sem exagerar.
- Pilares de conteúdo: educativo, prova social, bastidores/humanização, institucional/promocional (engajamento como extra).
- Contato pra CTA: @drbrunofreitas.implantes / WhatsApp (81) 9172-0703.

REGRA IMPORTANTE SOBRE TEMA: todo post deve ser sobre uma dessas cinco especialidades, e apenas uma por
post (a que vier indicada no item do calendário, ou a mais adequada ao pilar se não vier especificada).
Nunca sugira posts sobre saúde bucal genérica, outros procedimentos odontológicos ou qualquer assunto fora
dessa lista — mesmo em conteúdo educativo/bastidores, amarre o tema a uma dessas especialidades.

Sua função: sugerir o post do dia (story, reel, post simples ou carrossel), entregando o pacote completo —
legenda, hashtags, e pra reel/story: roteiro, cenas, textos de tela, sugestão de trilha. Nunca deixe
trabalho de redator pra fazer depois.

IMPORTANTE SOBRE IMAGEM: pra post simples e carrossel, a imagem de cada slide é gerada por IA junto com o
resto desse post, na mesma resposta — então a prévia que você descrever (campo "slides", e a seção
"📸 IMAGEM(NS)" dentro da mensagem) É a imagem de verdade que vai ser gerada depois, não um briefing solto
pra um designer. Nunca sugira ferramentas externas (Canva, Photoshop, banco de imagens, Midjourney, DALL-E
etc.) nem diga que não consegue gerar imagem — o sistema já faz isso sozinho a partir do que você descrever
em "slides". Reel e story não geram imagem (o Bruno grava com o celular), então aí sim roteiro e textos de
tela bastam, sem campo de imagem.

Responda sempre em português do Brasil.`;

// Instruções compartilhadas pros campos de imagem gerada por IA (imagePrompt em
// inglês pra OpenAI, imagePromptPt em português pra prévia do Bruno). Usado tanto
// em generateSuggestion (fluxo normal, gera tudo numa única resposta) quanto em
// generateImageSpec (fallback defensivo, ver mais abaixo). Pede uma descrição bem
// detalhada/elaborada — luz, composição, textura, estilo — porque o Bruno pediu
// imagens mais ricas, e insiste em variar a cena a cada slide (evitar convergir
// sempre pra "cadeira odontológica vazia").
const CAMPOS_IMAGEM_IA = `
- Inclua também em cada slide um campo "imagePrompt": uma descrição em inglês, bem detalhada e elaborada (4 a 6 frases), descrevendo cena, composição (enquadramento, regra dos terços), iluminação (ex: luz natural lateral, golden hour, luz suave de estúdio), textura/material, paleta de cores e um estilo fotográfico consistente (ex: fotografia editorial, lifestyle, still life) — pra gerar uma imagem por IA rica e elaborada que combine com ESSE slide em particular, baseada no headline/body que você mesmo escreveu pra ele, não um prompt genérico que serviria pra qualquer post. IMPORTANTE:
  - NÃO peça pra mostrar dentes, boca ou procedimentos de forma anatômica/diagnóstica (número de dentes, estrutura interna, close-up técnico) — a IA erra esse tipo de detalhe com frequência.
  - NÃO repita sempre a mesma cena de "cadeira odontológica vazia num consultório claro com planta no canto" — isso fica repetitivo entre posts e entre slides do mesmo carrossel. Varie de verdade a cada slide: pode ser um detalhe de mãos (segurando um alinhador transparente, um modelo de prótese, um espelho de mão), uma pessoa sorrindo de forma confiante e à distância segura (sem foco nos dentes), uma textura ou material (cerâmica, resina, luz entrando por uma janela), um momento de bem-estar fora do consultório (harmonização facial pode ser um momento de cuidado/spa, por exemplo), um detalhe arquitetônico ou decorativo diferente do consultório, ou um objeto relacionado ao tema (escova, fio dental, estojo de alinhador).
  - Pense no que ESSE slide específico está dizendo e escolha uma cena que ilustre essa ideia particular, não uma cena-padrão repetida.
  - Capriche nos detalhes sensoriais (luz, profundidade de campo, textura) pra imagem sair elaborada — sem exagerar a ponto de ficar artificial ou carregada.
- Inclua também um campo "imagePromptPt": a MESMA cena descrita em "imagePrompt", só que em português e resumida numa frase curta e natural — isso vai aparecer pro Bruno na mensagem como prévia, então tem que descrever exatamente a mesma cena (só traduzida/resumida), nunca uma cena diferente da que vai ser gerada de verdade.`;

// Schema da sugestão do dia, usado via "tool use" da Anthropic (ver generateSuggestion
// abaixo) em vez de pedir pro modelo escrever o JSON como texto solto e tentar dar
// JSON.parse nele. Antes disso, de vez em quando a resposta vinha com um JSON mal
// formado (ex: uma aspa dentro de uma frase sem escapar direito) e quebrava o
// JSON.parse com um erro tipo "Expected ',' or '}' after property value" — sem
// relação com corte por limite de tokens (isso também foi corrigido, à parte, subindo
// o max_tokens). Com "tool use", é a própria API da Anthropic que garante um JSON
// válido batendo com esse formato — elimina essa categoria inteira de erro.
const SUGESTAO_SCHEMA = {
  name: "entregar_sugestao",
  description: "Entrega a sugestão de post do dia, pronta pro Bruno aprovar.",
  input_schema: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description:
          "O texto completo que o Bruno vai receber no WhatsApp: legenda, hashtags, e pra reel/story o roteiro, cenas, textos de tela e sugestão de trilha — o pacote completo, como sempre.",
      },
      slides: {
        type: "array",
        description:
          'Vazio ([]) se o formato for "reel" ou "story" (não geram imagem por IA). Exatamente 1 item se "post simples". Entre 4 e 6 itens se "carrossel" (capa, pontos principais, CTA final).',
        items: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Texto principal/destaque do slide, curto (até uns 60 caracteres)." },
            body: { type: "string", description: "Texto de apoio, até uns 200 caracteres — pode ficar vazio na capa se não precisar." },
            footer: { type: "string", description: "Linha pequena opcional (ex: contato/CTA leve) — vazio na maioria dos slides, use só no último." },
            imagePrompt: { type: "string", description: "Em inglês — ver instruções detalhadas no prompt." },
            imagePromptPt: { type: "string", description: "A mesma cena de imagePrompt, em português, resumida numa frase curta." },
          },
          required: ["headline", "body", "footer", "imagePrompt", "imagePromptPt"],
        },
      },
    },
    required: ["mensagem", "slides"],
  },
};

// Gera a sugestão do dia: o texto completo pro WhatsApp (legenda, hashtags, roteiro
// se for reel/story) E, no mesmo call, a estrutura de slides + imagePrompt de cada
// imagem — tudo isso numa resposta só, pra garantir que a prévia que o Bruno lê
// (dentro de "mensagem", na seção "📸 IMAGEM(NS)") seja fiel à imagem que de fato vai
// ser gerada depois (ver gerarEEnviarImagens em server/routes/webhook.js), em vez de
// duas chamadas desconectadas descrevendo coisas diferentes.
async function generateSuggestion({ calendarItem }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    // Pra carrossel (4-6 slides, cada um com headline/body/footer/imagePrompt em
    // inglês bem detalhado/imagePromptPt) + a "mensagem" completa (legenda, hashtags,
    // seção de imagens), a resposta pode passar fácil de 3000 tokens — e se cortar no
    // meio o stop_reason vira "max_tokens" com conteúdo incompleto. Subido pra 6000
    // com folga, pra não repetir isso.
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    tools: [SUGESTAO_SCHEMA],
    tool_choice: { type: "tool", name: SUGESTAO_SCHEMA.name },
    messages: [
      {
        role: "user",
        content: `Gere a sugestão de post de hoje com base neste item do calendário: ${JSON.stringify(
          calendarItem
        )}${CAMPOS_IMAGEM_IA}

Se "slides" não vier vazio, inclua dentro de "mensagem" (perto do final, antes das hashtags) uma seção assim, usando exatamente o "imagePromptPt" de cada slide (só numerado), pra ser a prévia fiel do que vai ser gerado:

📸 IMAGEM(NS):
1. <imagePromptPt do slide 1>
2. <imagePromptPt do slide 2>
(uma linha por slide)

Não inclua markdown dentro dos campos (sem **negrito**, sem #).`,
      },
    ],
  });
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error(
      `generateSuggestion: resposta sem tool_use (stop_reason=${msg.stop_reason})`
    );
  }
  const parsed = toolUse.input; // já vem como objeto — a API garante que bate com o schema, sem precisar de JSON.parse
  if (typeof parsed.mensagem !== "string" || !Array.isArray(parsed.slides)) {
    throw new Error(
      "generateSuggestion: resposta não trouxe o formato esperado ({mensagem, slides})"
    );
  }
  return { text: parsed.mensagem, slides: parsed.slides };
}

// Usada só pra confirmação curta quando o Bruno APROVA (ver webhook.js) — nesse
// caso o conteúdo não muda, então não precisa reconstruir slides, só uma resposta
// de texto natural. Pra ajuste/rejeição, ver reviseSuggestion abaixo.
async function interpretFeedback({ suggestion, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão enviada:\n\n${suggestion}\n\nO Bruno respondeu:\n"${feedbackText}"\n\nEle aprovou. Confirme de forma curta e natural.`,
      },
    ],
  });
  return msg.content[0].text;
}

// Gera a sugestão REVISADA (texto completo + slides, no mesmo formato de
// generateSuggestion) quando o Bruno pede um ajuste OU rejeita e a Sofia precisa
// propor uma alternativa — chamada por webhook.js nesses dois casos. Usa o mesmo
// "tool use" forçado de generateSuggestion, pelos mesmos motivos (sem JSON.parse
// manual, sem risco de aspa mal escapada).
//
// CORREÇÃO (09/10/2026): antes disso, um pedido de ajuste ou de "outro assunto"
// só gerava uma resposta de texto solta (via interpretFeedback), que NUNCA era
// salva de volta em pendingSuggestion.text/.slides. Se o Bruno aprovasse essa
// resposta revisada depois, a geração de imagem continuava usando os slides da
// sugestão ORIGINAL (o tema/conteúdo que ele tinha acabado de recusar ou pedido
// pra mudar) — foi exatamente o que aconteceu quando ele pediu outro assunto,
// aprovou o novo, mas as imagens saíram do assunto antigo (não aprovado). Agora
// cada ajuste/alternativa regenera o pacote inteiro e webhook.js salva o
// resultado de volta em pendingSuggestion ANTES de qualquer aprovação futura —
// então o que for aprovado depois é garantidamente o que o Bruno acabou de ver.
async function reviseSuggestion({ suggestion, calendarItem, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    tools: [SUGESTAO_SCHEMA],
    tool_choice: { type: "tool", name: SUGESTAO_SCHEMA.name },
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão de post enviada pro Bruno:\n\n${suggestion}\n\nItem do calendário original: ${JSON.stringify(
          calendarItem
        )}\n\nO Bruno respondeu pedindo uma mudança (ou recusando e esperando uma alternativa):\n"${feedbackText}"\n\nGere a sugestão REVISADA, completa — o pacote inteiro de novo (legenda, hashtags, e os slides com imagePrompt/imagePromptPt de cada imagem), já refletindo o que ele pediu:
- Se ele pediu outro assunto/tema, troque o tema (sempre dentro das 5 especialidades permitidas) — evite repetir a mesma especialidade da sugestão anterior, já que foi isso que ele não quis.
- Se pediu um ajuste específico (algo no texto, tom, imagem, formato etc.), aplique só esse ajuste, mantendo o resto o mais parecido possível com a sugestão original.
- Se rejeitou sem detalhar, proponha uma alternativa diferente dentro das regras da marca.${CAMPOS_IMAGEM_IA}

Se "slides" não vier vazio, inclua dentro de "mensagem" (perto do final, antes das hashtags) a seção "📸 IMAGEM(NS)" do jeito de sempre, numerada, usando exatamente o "imagePromptPt" de cada slide.

Não inclua markdown dentro dos campos (sem **negrito**, sem #).`,
      },
    ],
  });
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error(
      `reviseSuggestion: resposta sem tool_use (stop_reason=${msg.stop_reason})`
    );
  }
  const parsed = toolUse.input;
  if (typeof parsed.mensagem !== "string" || !Array.isArray(parsed.slides)) {
    throw new Error(
      "reviseSuggestion: resposta não trouxe o formato esperado ({mensagem, slides})"
    );
  }
  return { text: parsed.mensagem, slides: parsed.slides };
}

// Classifica a resposta do Bruno numa decisão que o código consegue usar (diferente
// de interpretFeedback, que gera só o texto de resposta pra ele). Usada pra saber se
// deve disparar a geração das imagens depois de uma aprovação.
async function classifyDecision({ suggestion, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão de post enviada pra aprovação:\n\n${suggestion}\n\nO Bruno respondeu:\n"${feedbackText}"\n\nClassifique a resposta dele. Responda APENAS com um JSON, sem nenhum texto antes ou depois, em um destes três formatos exatos:\n{"decision":"aprovado"}\n{"decision":"ajuste"}\n{"decision":"rejeitado"}\n\n"aprovado" = ele confirmou que gostou e pode seguir/publicar. "ajuste" = ele pediu alguma mudança ou está em dúvida. "rejeitado" = ele não quer esse post.`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (["aprovado", "ajuste", "rejeitado"].includes(parsed.decision)) {
      return parsed.decision;
    }
  } catch (err) {
    console.error("[claude] classifyDecision: resposta não era o JSON esperado:", raw);
  }
  return "ajuste"; // fallback seguro: se não deu pra classificar, não dispara geração de imagem à toa
}

// Fallback DEFENSIVO: só é chamado por webhook.js quando uma sugestão pendente não
// tem "slides" salvos (por exemplo, state antigo gerado antes dessa versão, que
// guardava só o texto). No fluxo normal os slides já vêm prontos de
// generateSuggestion, gerados junto com a mensagem — então essa função não roda mais
// no dia a dia.
async function generateImageSpec({ calendarItem, suggestionText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `A sugestão abaixo foi aprovada pelo Bruno. Converta ela numa estrutura JSON pra geração das imagens.

Sugestão aprovada:
${suggestionText}

Item do calendário: ${JSON.stringify(calendarItem)}

Responda APENAS com um JSON válido, sem nenhum texto antes ou depois, neste formato:
{"slides":[{"headline":"...","body":"...","footer":"..."}]}

Regras:
- Se o formato for "post simples", gere exatamente 1 slide.
- Se o formato for "carrossel", gere entre 4 e 6 slides (capa, pontos principais, CTA final).
- "headline" = texto principal/destaque do slide, curto (até uns 60 caracteres).
- "body" = texto de apoio, até uns 200 caracteres — pode ficar vazio na capa se não precisar.
- "footer" = linha pequena opcional (ex: contato/CTA leve) — deixe vazio na maioria dos slides, use só no último.
- Não inclua markdown (sem **negrito**, sem #), não inclua emojis em excesso, nada fora do JSON.${CAMPOS_IMAGEM_IA}`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned); // deixa propagar o erro se vier mal formado — quem chama decide o que fazer
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("generateImageSpec: resposta não trouxe um array de slides válido");
  }
  return parsed;
}

// Depois que um post já foi aprovado (e a imagem, se tinha, já foi gerada e
// mandada), o Bruno pode avisar depois que já publicou nas redes (ex: "postei",
// "já publiquei", "saiu"). Isso é usado pra marcar status="publicado" e desligar os
// lembretes das 13h/18h (ver scheduler.js) — sem isso, o lembrete dispara mesmo nos
// dias em que ele já publicou, porque nada avisava o sistema disso antes.
async function classificarConfirmacaoPublicacao(feedbackText) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `O Bruno já tinha aprovado um post antes. Agora ele mandou esta mensagem:\n"${feedbackText}"\n\nEle está avisando que já publicou/postou esse conteúdo nas redes sociais (Instagram, etc.)? Responda APENAS com um JSON, sem texto antes ou depois, neste formato exato: {"publicado":true} ou {"publicado":false}.`,
      },
    ],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.publicado === true;
  } catch (err) {
    console.error("[claude] classificarConfirmacaoPublicacao: resposta não era o JSON esperado:", raw);
    return false;
  }
}

module.exports = {
  generateSuggestion,
  interpretFeedback,
  reviseSuggestion,
  classifyDecision,
  generateImageSpec,
  classificarConfirmacaoPublicacao,
};
