// Adaptador da Anthropic (formato Messages). SÓ o contrato (ver openai.js).
// Diferenças: instruções de sistema no campo "system"; max_tokens obrigatório;
// sem modo JSON assumido (o formato é pedido nas instruções); 529 = sobrecarga.
const { ErroProvedor, usoInformado, classificarStatus } = require('../contrato');

const id = 'anthropic';
const FIM = { end_turn: 'completa', stop_sequence: 'completa', max_tokens: 'incompleta', refusal: 'recusada' };

function montarRequisicao(s) {
  const corpo = {
    model: s.modelo,
    system: s.sistema,
    messages: [{ role: 'user', content: s.dados }],
    max_tokens: s.maxTokensSaida,
  };
  if (s.temperatura !== undefined) corpo.temperature = Math.min(s.temperatura, 1); // a faixa da Anthropic é 0–1
  return { provedor: id, metodo: 'POST', rota: '/v1/messages', corpo };
}

function normalizarResposta(corpo) {
  if (!corpo || !Array.isArray(corpo.content)) throw new ErroProvedor('resposta-malformada', 'anthropic: resposta sem content', { provedor: id });
  const u = corpo.usage || {};
  const uso = usoInformado(u.input_tokens, u.output_tokens);
  const textos = corpo.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  const fim = FIM[corpo.stop_reason] || 'incompleta'; // tool_use, pause_turn etc.: esta fase não usa ferramentas do provedor
  if (!textos.length && fim === 'completa') throw new ErroProvedor('resposta-malformada', 'anthropic: nenhum bloco de texto', { provedor: id, uso });
  return { provedor: id, modelo: corpo.model || null, idResposta: corpo.id || null, texto: textos.join(''), fim, motivoFimOriginal: corpo.stop_reason || null, uso };
}

function classificarErro({ status, corpo, cabecalhos }) {
  const m = corpo && corpo.error && corpo.error.message;
  if (status === 529) return new ErroProvedor('indisponivel', `anthropic: sobrecarga (${m || 'HTTP 529'})`, { provedor: id, status });
  return classificarStatus(id, status, m, cabecalhos);
}

const extrairTextos = (req) => ({ sistema: req.corpo.system, dados: req.corpo.messages[0].content });

module.exports = { id, montarRequisicao, normalizarResposta, classificarErro, extrairTextos };
