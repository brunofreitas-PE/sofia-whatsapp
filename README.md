# Sofia — integração com WhatsApp (fase 2, v0.1)

Este é o esqueleto inicial da automação descrita na spec ("Sofia — Spec do Sistema" no
projeto). Ele já sabe:

- Receber mensagens no WhatsApp (texto e áudio) via webhook.
- Responder usando a Anthropic API com o contexto de marca do Atelier do Sorriso.
- Mandar a sugestão do dia e lembretes de publicação em horários fixos (cron).
- Guardar o estado básico (sugestão pendente, histórico) num arquivo JSON simples.

O que **ainda não** faz (de propósito, pra não travar o início):

- **Transcrever áudio de verdade** — `server/lib/transcribe.js` é um stub. Precisa
  escolher um provedor de speech-to-text (ver seção própria abaixo).
- **Gerar/enviar imagens e carrosséis** — só manda texto por enquanto.
- **Montar o calendário mensal sozinha** — hoje ele lê `state.calendar`, mas nada
  preenche isso ainda; é feito à mão editando `server/data/db.json` por enquanto.
- **Multi-cliente** — está desenhado pra UM número (o do Bruno). Virar multi-tenant é
  passo futuro, quando/se a Sofia for comercializada (já está anotado na spec).

## 1. Criar o app do WhatsApp na Meta

1. Crie uma conta em [developers.facebook.com](https://developers.facebook.com) (pode
   usar seu Facebook normal).
2. "Meus Apps" → "Criar app" → tipo **Negócios** → dê um nome (ex: "Sofia Atelier do
   Sorriso").
3. Dentro do app, adicione o produto **WhatsApp**.
4. Na tela "Introdução"/"API Setup" você já ganha automaticamente:
   - Um **número de teste** (pode mandar mensagem pra até 5 números verificados, de
     graça, sem precisar verificar empresa — ótimo pra validar antes de ir pra
     produção).
   - Um **Temporary access token** (válido por 24h — dá pra gerar um permanente
     depois, em "Configurações do App" → "System Users").
   - O **Phone number ID** e o **WhatsApp Business Account ID** (WABA ID), mostrados
     nessa mesma tela.
5. Copie esses três valores pro seu `.env` (veja `.env.example`):
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
6. Em "API Setup" tem um campo pra adicionar **seu número pessoal** como destinatário
   de teste (ele manda um código por WhatsApp pra confirmar). Faça isso com o número
   que vai testar.

> Quando quiser sair do modo teste (mandar sem limite de 5 números, começar a cobrar
> depois do free tier), é preciso verificar a empresa na Meta — isso não bloqueia o
> desenvolvimento, só é necessário pra produção de verdade.

## 2. Escolher um `WHATSAPP_VERIFY_TOKEN`

É só uma senha que você mesmo inventa (ex: `sofia-verify-2026`). Vai usar o mesmo
valor no `.env` e no painel da Meta, passo 4 abaixo.

## 3. Pegar uma chave da Anthropic

Crie uma conta/chave em [console.anthropic.com](https://console.anthropic.com) →
"API Keys" → "Create Key". Cole em `ANTHROPIC_API_KEY` no `.env`. Isso é cobrado por
uso (por token gerado) — pro volume de 1 sugestão por dia, o custo é bem baixo.

## 4. Rodar localmente (opcional, pra testar antes de subir)

```bash
npm install
cp .env.example .env
# edite o .env com os valores dos passos 1–3
npm run dev
```

Isso sobe um servidor local, mas a Meta precisa de uma URL pública pra mandar os
webhooks — pra testar de verdade sem já subir pra produção, dá pra usar algo como
`ngrok http 3000` pra expor seu localhost temporariamente. Se preferir, pule direto
pro passo 5 (deploy) e teste já em produção.

## 5. Deploy no Railway (sugestão de hospedagem simples)

1. Crie uma conta em [railway.app](https://railway.app) (dá pra entrar com GitHub).
2. Suba este projeto pra um repositório no GitHub (ou use `railway up` direto da sua
   máquina, sem precisar do GitHub).
3. No Railway: "New Project" → "Deploy from GitHub repo" → selecione o repositório.
4. Em "Variables", adicione todas as chaves do `.env.example` com os valores reais.
5. Adicione também `TZ=America/Sao_Paulo` (pra o agendador disparar nos horários
   certos, no seu fuso).
6. Depois do deploy, o Railway te dá uma URL pública tipo
   `https://sofia-production.up.railway.app`.

## 6. Configurar o webhook no painel da Meta

1. No app da Meta, vá em WhatsApp → "Configuration".
2. Em "Webhook", clique em "Edit" e preencha:
   - **Callback URL**: `https://<sua-url-do-railway>/webhook`
   - **Verify token**: o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN`
3. Clique em "Verify and save" — se dermos `200` corretamente (o código já faz isso),
   confirma na hora.
4. Em "Webhook fields", marque **messages** pra começar a receber as mensagens
   recebidas nesse número.

## 7. Testar

- Mande um "oi" pro número de teste, do seu WhatsApp (o número que você verificou no
  passo 1.6). Hoje isso só funciona se já existir uma `pendingSuggestion` no
  `db.json` — pra testar rapidinho, edite `server/data/db.json` manualmente com um
  texto de exemplo em `pendingSuggestion.text`, ou espere o agendador das 8h rodar.
- Pra testar o agendador sem esperar até às 8h, chame a função `generateSuggestion`
  manualmente (ex: um script `node -e "..."` ou um endpoint temporário) — ainda não
  criei um jeito fácil de disparar isso manualmente; posso adicionar se for útil.

## Transcrição de áudio

`server/lib/transcribe.js` está vazio de propósito. Opções, do mais simples ao mais
robusto:

- **API do Whisper da OpenAI** (`whisper-1` ou `gpt-4o-transcribe`) — paga por
  minuto, ótima qualidade em português, fácil de integrar (poucas linhas).
- **Deepgram** ou **AssemblyAI** — alternativas pagas, também boas em português.
- **Self-hosted** (rodar Whisper você mesmo no servidor) — mais barato em volume alto,
  mas dá mais trabalho de infraestrutura; não recomendo pra começar.

Me diga qual prefere que eu implemento a função.

## Próximos passos (na ordem que sugiro)

1. Você faz os passos 1–3 (contas/chaves) e me manda confirmação (não precisa me
   mandar as chaves aqui no chat — só confirmar que já tem).
2. Eu (ou você) faz o deploy inicial e testamos o echo básico (mandar "oi", receber
   resposta).
3. Implementamos a transcrição de áudio de verdade.
4. Implementamos envio de imagem/carrossel (hoje só manda texto).
5. Preenchimento do calendário mensal (a parte de pesquisa de tendências que já está
   na spec).
