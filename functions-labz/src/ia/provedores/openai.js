// Adaptador da OpenAI (formato Chat Completions). SÓ o contrato: monta a
// requisição e entende a resposta. Não chama nada (o transporte é injetado e,
// na Fase 4B, só existe o simulado). A chave NÃO entra na requisição montada:
// quem a coloca é o transporte real, que ainda não existe.
const { ErroProvedor, usoInformado, classificarStatus } = require('../contrato');

const id = 'openai';
const FIM = { stop: 'completa', length: 'incompleta', content_filter: 'filtrada' };

function montarRequisicao(s) {
  const corpo = {
    model: s.modelo,
    messages: [{ role: 'system', content: s.sistema }, { role: 'user', content: s.dados }],
    max_completion_tokens: s.maxTokensSaida,
  };
  if (s.formatoJson) corpo.response_format = { type: 'json_object' };
  if (s.temperatura !== undefined) corpo.temperature = s.temperatura;
  return { provedor: id, metodo: 'POST', rota: '/v1/chat/completions', corpo };
}

function normalizarResposta(corpo) {
  const escolha = corpo && Array.isArray(corpo.choices) ? corpo.choices[0] : null;
  const msg = escolha && escolha.message;
  if (!msg || typeof msg !== 'object') throw new ErroProvedor('resposta-malformada', 'openai: resposta sem choices[0].message', { provedor: id });
  const u = corpo.usage || {};
  const uso = usoInformado(u.prompt_tokens, u.completion_tokens);
  if (typeof msg.refusal === 'string' && msg.refusal) return { provedor: id, modelo: corpo.model || null, idResposta: corpo.id || null, texto: '', fim: 'recusada', motivoFimOriginal: 'refusal', uso };
  if (typeof msg.content !== 'string') throw new ErroProvedor('resposta-malformada', 'openai: message.content ausente', { provedor: id, uso });
  const fim = FIM[escolha.finish_reason] || (escolha.finish_reason ? 'incompleta' : 'completa');
  return { provedor: id, modelo: corpo.model || null, idResposta: corpo.id || null, texto: msg.content, fim, motivoFimOriginal: escolha.finish_reason || null, uso };
}

function classificarErro({ status, corpo, cabecalhos }) {
  const m = corpo && corpo.error && corpo.error.message;
  return classificarStatus(id, status, m, cabecalhos);
}

// Só para o simulador: o que o "modelo" leria.
const extrairTextos = (req) => ({ sistema: req.corpo.messages[0].content, dados: req.corpo.messages[1].content });

module.exports = { id, montarRequisicao, normalizarResposta, classificarErro, extrairTextos };
