// Adaptador da Anthropic (API Messages). R1: atualizado para os modelos atuais (plano, seção 5).
//  - SEM temperature/top_p/top_k: os modelos atuais recusam (400). A "temperatura" do contrato comum
//    é ignorada aqui de propósito (um teste garante que nunca vai no corpo).
//  - esforço em output_config.effort (low/medium/high); o pensamento fica no modo adaptativo padrão
//    (nada de thinking "disabled" nem orçamento de pensamento: dão 400 nesses modelos).
//  - saída estruturada por output_config.format (esquema JSON) quando a etapa pede um documento.
//  - sem "prefill" e sem forçar ferramenta (tool_choice any/tool dá 400).
//  - instruções fixas no campo system com cache_control (cache de prompt).
//  - recusa (stop_reason "refusal") → fim "recusada" guardando SÓ a categoria (stop_details.category).
//  - uso: entrada, gravação e leitura de cache e saída, separados (cada um com o seu preço).
//  - cabeçalhos: anthropic-version fixo; a chave (x-api-key) é posta pelo TRANSPORTE, nunca aqui.
//  - também monta as chamadas SEM CUSTO: consulta do modelo (GET /v1/models/{id}) e contagem de
//    tokens (POST /v1/messages/count_tokens), usadas antes de qualquer chamada paga (seção 13.2).
// Conferir a página oficial da API antes de ligar (R2): nomes de campos e versão podem mudar.
const { ErroProvedor, usoInformado, classificarStatus } = require('../contrato');

const id = 'anthropic';
const VERSAO_API = '2023-06-01';
const FIM = { end_turn: 'completa', stop_sequence: 'completa', max_tokens: 'incompleta', refusal: 'recusada', pause_turn: 'incompleta', tool_use: 'incompleta' };
const ESFORCO_PADRAO = 'medium';

function cabecalhos() { return { 'content-type': 'application/json', 'anthropic-version': VERSAO_API }; }

function corpoBase(s) {
  const corpo = {
    model: s.modelo,
    system: [{ type: 'text', text: String(s.sistema || ''), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: String(s.dados || '') }],
  };
  const output = { effort: s.esforco || ESFORCO_PADRAO };
  if (s.esquemaJson) output.format = { type: 'json_schema', schema: s.esquemaJson };
  corpo.output_config = output;
  return corpo;
}

// s: { modelo, sistema, dados, maxTokensSaida, esforco?, esquemaJson?, temperatura? (ignorada) }
function montarRequisicao(s) {
  const corpo = Object.assign(corpoBase(s), { max_tokens: s.maxTokensSaida });
  return { provedor: id, metodo: 'POST', rota: '/v1/messages', cabecalhos: cabecalhos(), corpo };
}

// Contagem exata da entrada (sem custo, segundo a documentação): mesmo corpo, sem max_tokens.
function montarContagem(s) {
  return { provedor: id, metodo: 'POST', rota: '/v1/messages/count_tokens', cabecalhos: cabecalhos(), corpo: corpoBase(s) };
}
function normalizarContagem(corpo) {
  const n = corpo && corpo.input_tokens;
  if (!Number.isInteger(n) || n < 0) throw new ErroProvedor('resposta-malformada', 'anthropic: contagem de tokens sem input_tokens', { provedor: id });
  return n;
}

// Consulta do modelo (sem custo): existe e está liberado para a conta? Limites e recursos.
function montarConsultaModelo(modelo) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(String(modelo))) throw new ErroProvedor('configuracao-invalida', 'anthropic: ID de modelo inválido', { provedor: id });
  return { provedor: id, metodo: 'GET', rota: `/v1/models/${modelo}`, cabecalhos: cabecalhos(), corpo: null };
}
function normalizarModelo(corpo) {
  if (!corpo || typeof corpo.id !== 'string') throw new ErroProvedor('resposta-malformada', 'anthropic: consulta de modelo sem id', { provedor: id });
  return {
    id: corpo.id,
    maxEntrada: Number.isInteger(corpo.max_input_tokens) ? corpo.max_input_tokens : null,
    maxSaida: Number.isInteger(corpo.max_tokens) ? corpo.max_tokens : null,
    capacidades: corpo.capabilities && typeof corpo.capabilities === 'object' ? corpo.capabilities : null,
  };
}

function normalizarResposta(corpo, cab) {
  if (!corpo || !Array.isArray(corpo.content)) throw new ErroProvedor('resposta-malformada', 'anthropic: resposta sem content', { provedor: id });
  const u = corpo.usage || {};
  const uso = usoInformado(u.input_tokens, u.output_tokens);
  if (uso && (Number.isInteger(u.cache_creation_input_tokens) || Number.isInteger(u.cache_read_input_tokens))) {
    uso.cacheEscrita = Number.isInteger(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0;
    uso.cacheLeitura = Number.isInteger(u.cache_read_input_tokens) ? u.cache_read_input_tokens : 0;
  }
  const textos = corpo.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  const fim = FIM[corpo.stop_reason] || 'incompleta';
  if (!textos.length && fim === 'completa') throw new ErroProvedor('resposta-malformada', 'anthropic: nenhum bloco de texto', { provedor: id, uso });
  const categoria = fim === 'recusada' && corpo.stop_details && typeof corpo.stop_details.category === 'string' ? corpo.stop_details.category.slice(0, 40) : null;
  const requestId = cab && (cab['request-id'] || cab['Request-Id']) ? String(cab['request-id'] || cab['Request-Id']).slice(0, 80) : null;
  return { provedor: id, modelo: corpo.model || null, idResposta: corpo.id || null, requestId, texto: textos.join(''), fim, motivoFimOriginal: corpo.stop_reason || null, categoriaRecusa: categoria, uso };
}

function classificarErro({ status, corpo, cabecalhos: cab }) {
  const m = corpo && corpo.error && corpo.error.message;
  const tipo = corpo && corpo.error && corpo.error.type;
  if (status === 529) return new ErroProvedor('indisponivel', `anthropic: sobrecarga (${m || 'HTTP 529'})`, { provedor: id, status, esperaMs: null, comCorpo: !!corpo });
  // modelo inexistente ou retirado: definitivo (o agente volta para o simulado; nada de repetir)
  if (status === 404 || (status === 400 && /model/i.test(String(m || '')) && /not.?found|does not exist|retired|deprecated/i.test(String(m || '')))) {
    return new ErroProvedor('modelo-indisponivel', `anthropic: modelo indisponível (${m || `HTTP ${status}`})`, { provedor: id, status, comCorpo: !!corpo });
  }
  const e = classificarStatus(id, status, tipo ? `${tipo}: ${m || ''}` : m, cab);
  e.comCorpo = !!corpo;
  return e;
}

const extrairTextos = (req) => ({ sistema: req.corpo.system.map((b) => b.text).join('\n'), dados: req.corpo.messages[0].content });

module.exports = { id, VERSAO_API, montarRequisicao, montarContagem, normalizarContagem, montarConsultaModelo, normalizarModelo, normalizarResposta, classificarErro, extrairTextos };
