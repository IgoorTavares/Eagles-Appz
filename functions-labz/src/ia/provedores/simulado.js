// "Provedor" simulado: formato próprio e mínimo, para quando o agente ainda não
// tem modelo configurado (o padrão). Nunca sai da máquina e não custa nada.
const { ErroProvedor, usoInformado, classificarStatus } = require('../contrato');

const id = 'simulado';

function montarRequisicao(s) {
  return { provedor: id, metodo: 'LOCAL', rota: 'simulado', corpo: { modelo: s.modelo, sistema: s.sistema, dados: s.dados, maxTokensSaida: s.maxTokensSaida } };
}

function normalizarResposta(corpo) {
  if (!corpo || typeof corpo.texto !== 'string') throw new ErroProvedor('resposta-malformada', 'simulado: resposta sem texto', { provedor: id });
  const uso = corpo.uso ? usoInformado(corpo.uso.entrada, corpo.uso.saida) : null;
  return { provedor: id, modelo: corpo.modelo || null, idResposta: corpo.id || null, texto: corpo.texto, fim: corpo.fim || 'completa', motivoFimOriginal: corpo.fim || null, uso };
}

const classificarErro = ({ status, corpo, cabecalhos }) => classificarStatus(id, status, corpo && corpo.erro, cabecalhos);
const extrairTextos = (req) => ({ sistema: req.corpo.sistema, dados: req.corpo.dados });

module.exports = { id, montarRequisicao, normalizarResposta, classificarErro, extrairTextos };
