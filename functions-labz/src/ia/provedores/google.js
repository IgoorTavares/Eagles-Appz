// Adaptador do Google Gemini (formato generateContent). SÓ o contrato (ver openai.js).
// Diferenças: o modelo vai na ROTA (por isso o nome do modelo é validado com
// rigor na configuração); instruções em systemInstruction; o bloqueio pode vir
// em promptFeedback (sem candidatos).
const { ErroProvedor, usoInformado, classificarStatus } = require('../contrato');

const id = 'google';
const FIM = { STOP: 'completa', MAX_TOKENS: 'incompleta', SAFETY: 'filtrada', RECITATION: 'filtrada', BLOCKLIST: 'filtrada', PROHIBITED_CONTENT: 'filtrada', SPII: 'filtrada' };
const MODELO_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function montarRequisicao(s) {
  if (!MODELO_SEGURO.test(String(s.modelo))) throw new ErroProvedor('configuracao-invalida', 'google: nome de modelo inválido', { provedor: id });
  const generationConfig = { maxOutputTokens: s.maxTokensSaida };
  if (s.formatoJson) generationConfig.responseMimeType = 'application/json';
  if (s.temperatura !== undefined) generationConfig.temperature = s.temperatura;
  const corpo = {
    systemInstruction: { parts: [{ text: s.sistema }] },
    contents: [{ role: 'user', parts: [{ text: s.dados }] }],
    generationConfig,
  };
  return { provedor: id, metodo: 'POST', rota: `/v1beta/models/${s.modelo}:generateContent`, corpo };
}

function normalizarResposta(corpo) {
  if (!corpo || typeof corpo !== 'object') throw new ErroProvedor('resposta-malformada', 'google: resposta vazia', { provedor: id });
  const m = corpo.usageMetadata || {};
  const uso = usoInformado(m.promptTokenCount, m.candidatesTokenCount === undefined && m.promptTokenCount !== undefined ? 0 : m.candidatesTokenCount);
  if (!Array.isArray(corpo.candidates) || !corpo.candidates.length) {
    if (corpo.promptFeedback && corpo.promptFeedback.blockReason) return { provedor: id, modelo: corpo.modelVersion || null, idResposta: corpo.responseId || null, texto: '', fim: 'filtrada', motivoFimOriginal: corpo.promptFeedback.blockReason, uso };
    throw new ErroProvedor('resposta-malformada', 'google: resposta sem candidates', { provedor: id, uso });
  }
  const c = corpo.candidates[0];
  const partes = c && c.content && Array.isArray(c.content.parts) ? c.content.parts : null;
  const fim = FIM[c.finishReason] || (c.finishReason ? 'incompleta' : 'completa');
  if (!partes && fim === 'completa') throw new ErroProvedor('resposta-malformada', 'google: candidato sem content.parts', { provedor: id, uso });
  const texto = (partes || []).filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('');
  return { provedor: id, modelo: corpo.modelVersion || null, idResposta: corpo.responseId || null, texto, fim, motivoFimOriginal: c.finishReason || null, uso };
}

function classificarErro({ status, corpo, cabecalhos }) {
  const m = corpo && corpo.error && corpo.error.message;
  return classificarStatus(id, status, m, cabecalhos);
}

const extrairTextos = (req) => ({ sistema: req.corpo.systemInstruction.parts[0].text, dados: req.corpo.contents[0].parts[0].text });

module.exports = { id, montarRequisicao, normalizarResposta, classificarErro, extrairTextos };
