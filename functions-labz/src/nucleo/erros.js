// Erro com código estável. Na Fase 2 o código vira o HttpsError do onCall
// (unauthenticated, permission-denied, invalid-argument, not-found, failed-precondition).
class ErroLabz extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroLabz';
    this.codigo = codigo;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
}

const erro = (codigo, mensagem, detalhes) => new ErroLabz(codigo, mensagem, detalhes);

module.exports = { ErroLabz, erro };
