// O "cérebro" da Sofia: chama a API da Anthropic pra gerar sugestões e interpretar
// feedback. Desde a separação por cliente (ver lib/clients.js), nenhuma função aqui
// tem mais marca/especialidades/tom fixos no código — tudo isso vem de um objeto
// `cliente` (carregado de server/clients/<slug>.json) que cada função recebe como
// parâmetro. Isso é o que permite a Sofia atender profissionais de áreas diferentes
// (odontologia, psicologia etc.), cada um com sua própria configuração.
const Anthropic = require("@anthropic-ai/sdk");
const { montarSystemPrompt } = require("./clients");

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Falta ANTHROPIC_API_KEY no .env — veja o README.");
  }
  return new Anthropic({ apiKey });
}

// Instruções compartilhadas pros campos de imagem gerada por IA (imagePrompt em
// inglês pra OpenAI, imagePromptPt em português pra prévia do profissional). Usado
// tanto em generateSuggestion (fluxo normal, gera tudo numa única resposta) quanto em
// generateImageSpec (fallback defensivo, ver mais abaixo) e reviseSuggestion. Pede uma
// descrição bem detalhada/elaborada — luz, composição, textura, estilo — e aceita
// `cliente.diretrizesImagem` (string opcional, no JSON do cliente) com orientações
// extras específicas daquela área — por exemplo, o que evitar mostrar, ou como variar
// a cena — já que isso muda bastante de uma especialidade pra outra.
function camposImagemIA(cliente) {
  const extra = cliente?.diretrizesImagem ? `\n  - ${cliente.diretrizesImagem}` : "";
  return `
- Inclua também em cada slide um campo "imagePrompt": uma descrição em inglês, bem detalhada e elaborada (4 a 6 frases), descrevendo cena, composição (enquadramento, regra dos terços), iluminação (ex: luz natural lateral, golden hour, luz suave de estúdio), textura/material, paleta de cores e um estilo fotográfico consistente (ex: fotografia editorial, lifestyle, still life) — pra gerar uma imagem por IA rica e elaborada que combine com ESSE slide em particular, baseada no headline/body que você mesmo escreveu pra ele, não um prompt genérico que serviria pra qualquer post. IMPORTANTE:
  - Pense no que ESSE slide específico está dizendo e escolha uma cena que ilustre essa ideia particular, não uma cena-padrão repetida entre posts ou entre slides do mesmo carrossel.
  - Capriche nos detalhes sensoriais (luz, profundidade de campo, textura) pra imagem sair elaborada — sem exagerar a ponto de ficar artificial ou carregada.${extra}
- Inclua também um campo "imagePromptPt": a MESMA cena descrita em "imagePrompt", só que em português e resumida numa frase curta e natural — isso vai aparecer na mensagem como prévia, então tem que descrever exatamente a mesma cena (só traduzida/resumida), nunca uma cena diferente da que vai ser gerada de verdade.`;
}

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
  description: "Entrega a sugestão de post do dia, pronta pro profissional aprovar.",
  input_schema: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description:
          "O texto completo que o profissional vai receber no WhatsApp: legenda, hashtags, e pra reel/story o roteiro, cenas, textos de tela e sugestão de trilha — o pacote completo, como sempre.",
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
async function generateSuggestion({ cliente, calendarItem }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    // Pra carrossel (4-6 slides, cada um com headline/body/footer/imagePrompt em
    // inglês bem detalhado/imagePromptPt) + a "mensagem" completa (legenda, hashtags,
    // seção de imagens), a resposta pode passar fácil de 3000 tokens — e se cortar no
    // meio o stop_reason vira "max_tokens" com conteúdo incompleto. Subido pra 6000
    // com folga, pra não repetir isso.
    max_tokens: 6000,
    system: montarSystemPrompt(cliente),
    tools: [SUGESTAO_SCHEMA],
    tool_choice: { type: "tool", name: SUGESTAO_SCHEMA.name },
    messages: [
      {
        role: "user",
        content: `Gere a sugestão de post de hoje com base neste item do calendário: ${JSON.stringify(
          calendarItem
        )}${camposImagemIA(cliente)}

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
async function interpretFeedback({ cliente, suggestion, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: montarSystemPrompt(cliente),
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão enviada:\n\n${suggestion}\n\nO profissional respondeu:\n"${feedbackText}"\n\nEle aprovou. Confirme de forma curta e natural.`,
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
async function reviseSuggestion({ cliente, suggestion, calendarItem, feedbackText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 6000,
    system: montarSystemPrompt(cliente),
    tools: [SUGESTAO_SCHEMA],
    tool_choice: { type: "tool", name: SUGESTAO_SCHEMA.name },
    messages: [
      {
        role: "user",
        content: `Esta foi a sugestão de post enviada pro profissional:\n\n${suggestion}\n\nItem do calendário original: ${JSON.stringify(
          calendarItem
        )}\n\nO profissional respondeu pedindo uma mudança (ou recusando e esperando uma alternativa):\n"${feedbackText}"\n\nGere a sugestão REVISADA, completa — o pacote inteiro de novo (legenda, hashtags, e os slides com imagePrompt/imagePromptPt de cada imagem), já refletindo o que ele pediu:
- Se ele pediu outro assunto/tema, troque o tema (sempre dentro das especialidades permitidas) — evite repetir a mesma especialidade da sugestão anterior, já que foi isso que ele não quis.
- Se pediu um ajuste específico (algo no texto, tom, imagem, formato etc.), aplique só esse ajuste, mantendo o resto o mais parecido possível com a sugestão original.
- Se rejeitou sem detalhar, proponha uma alternativa diferente dentro das regras da marca.${camposImagemIA(cliente)}

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
        content: `Esta foi a sugestão de post enviada pra aprovação:\n\n${suggestion}\n\nO profissional respondeu:\n"${feedbackText}"\n\nClassifique a resposta dele. Responda APENAS com um JSON, sem nenhum texto antes ou depois, em um destes três formatos exatos:\n{"decision":"aprovado"}\n{"decision":"ajuste"}\n{"decision":"rejeitado"}\n\n"aprovado" = ele confirmou que gostou e pode seguir/publicar. "ajuste" = ele pediu alguma mudança ou está em dúvida. "rejeitado" = ele não quer esse post.`,
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
async function generateImageSpec({ cliente, calendarItem, suggestionText }) {
  const api = client();
  const msg = await api.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1800,
    system: montarSystemPrompt(cliente),
    messages: [
      {
        role: "user",
        content: `A sugestão abaixo foi aprovada pelo profissional. Converta ela numa estrutura JSON pra geração das imagens.

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
- Não inclua markdown (sem **negrito**, sem #), não inclua emojis em excesso, nada fora do JSON.${camposImagemIA(cliente)}`,
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
        content: `O profissional já tinha aprovado um post antes. Agora ele mandou esta mensagem:\n"${feedbackText}"\n\nEle está avisando que já publicou/postou esse conteúdo nas redes sociais (Instagram, etc.)? Responda APENAS com um JSON, sem texto antes ou depois, neste formato exato: {"publicado":true} ou {"publicado":false}.`,
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
