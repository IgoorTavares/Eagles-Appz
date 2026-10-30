// Registro dos adaptadores de provedor (mesma interface:
// montarRequisicao, normalizarResposta, classificarErro, extrairTextos).
const ADAPTADORES = Object.freeze({
  openai: require('./openai'),
  anthropic: require('./anthropic'),
  google: require('./google'),
  simulado: require('./simulado'),
});
const adaptadorDoProvedor = (p) => (Object.prototype.hasOwnProperty.call(ADAPTADORES, p) ? ADAPTADORES[p] : null);

module.exports = { ADAPTADORES, adaptadorDoProvedor };
