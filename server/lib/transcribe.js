// Transcrição de áudio (o Bruno mandando feedback por áudio no WhatsApp).
//
// NA V1 ISSO É UM STUB: não transcreve de verdade ainda. Ver a seção "Transcrição de
// áudio" no README pra escolher um provedor (ex: API do Whisper da OpenAI, Deepgram,
// Google Speech-to-Text) e completar esta função. Sem isso, mensagens de áudio do
// Bruno não são entendidas pela Sofia.
//
// audioId = o media id que a Meta manda no webhook quando chega um áudio.
async function transcribeAudio(audioId) {
  throw new Error(
    "transcribeAudio() ainda não está implementado — escolha um provedor de " +
      "speech-to-text e implemente aqui (ver README > Transcrição de áudio)."
  );
}

module.exports = { transcribeAudio };
