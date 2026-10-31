// Fase 4B: contrato COMUM dos adaptadores de modelos de IA (OpenAI, Anthropic,
// Google Gemini e o provedor "simulado"). Nesta fase NENHUMA chamada real é
// feita: o transporte é sempre o simulado (ia/transporte.js) e o transporte
// real não existe. Os formatos de cada provedor foram escritos a partir da
// documentação pública e precisam ser conferidos na documentação oficial
// antes de ligar um modelo de verdade (Fase 6).
//
// Fluxo de uma chamada (ia/adaptador-modelos.js):
//   solicitação NEUTRA { modelo, sistema, dados, maxTokensSaida, temperatura, formatoJson }
//   → provedor.montarRequisicao → transporte.enviar (com timeout e cancelamento)
//   → status ≠ 200: provedor.classificarErro → ErroProvedor
//   → provedor.normalizarResposta → RESPOSTA NORMALIZADA (abaixo)
const { mensagemSegura } = require('./credenciais');

const PROVEDORES = ['openai', 'anthropic', 'google'];
const PROVEDOR_SIMULADO = 'simulado';
const TODOS_PROVEDORES = [...PROVEDORES, PROVEDOR_SIMULADO];

// O que cada ADAPTADOR sabe fazer. Os provedores NÃO são iguais: o lugar das
// instruções de sistema, o modo JSON, os nomes do uso e os motivos de fim mudam.
const RECURSOS_PROVEDOR = Object.freeze({
  openai: Object.freeze({ instrucoesDeSistema: 'mensagem role=system', saidaJson: 'response_format json_object', usoInformado: 'usage.prompt_tokens / completion_tokens', cancelamento: 'só do lado do cliente (abortar a requisição)', limiteRequisicoes: 'HTTP 429 + retry-after' }),
  anthropic: Object.freeze({ instrucoesDeSistema: 'campo system', saidaJson: 'por instrução no sistema (sem modo JSON assumido)', usoInformado: 'usage.input_tokens / output_tokens', cancelamento: 'só do lado do cliente (abortar a requisição)', limiteRequisicoes: 'HTTP 429 + retry-after; 529 = sobrecarga' }),
  google: Object.freeze({ instrucoesDeSistema: 'systemInstruction', saidaJson: 'generationConfig.responseMimeType application/json', usoInformado: 'usageMetadata.promptTokenCount / candidatesTokenCount', cancelamento: 'só do lado do cliente (abortar a requisição)', limiteRequisicoes: 'HTTP 429 RESOURCE_EXHAUSTED' }),
  simulado: Object.freeze({ instrucoesDeSistema: 'campo sistema', saidaJson: 'sempre JSON', usoInformado: 'uso.entrada / saida (simulado)', cancelamento: 'simulado', limiteRequisicoes: 'simulado' }),
});

// Resposta normalizada (igual para todos os provedores).
//  fim: 'completa' | 'incompleta' (limite de tokens) | 'recusada' | 'filtrada'
//  uso: { tokensEntrada, tokensSaida } informado pelo provedor, ou null (não informado)
const FINS = ['completa', 'incompleta', 'recusada', 'filtrada'];

// Erros: tipo estável. Transitórios podem ser tentados de novo (com espera);
// "revisáveis" são respostas que chegaram mas não servem (vão para o controle de
// qualidade/revisão); os demais são definitivos.
const TIPOS_ERRO = ['timeout', 'limite-requisicoes', 'indisponivel', 'cancelado', 'credencial', 'requisicao-invalida', 'resposta-malformada', 'resposta-incompleta', 'recusada', 'configuracao-invalida', 'nao-autorizado'];
const TRANSITORIOS = ['timeout', 'limite-requisicoes', 'indisponivel'];
const REVISAVEIS = ['resposta-malformada', 'resposta-incompleta', 'recusada'];

class ErroProvedor extends Error {
  constructor(tipo, mensagem, extras = {}) {
    super(mensagemSegura(mensagem, 300));
    this.name = 'ErroProvedor';
    this.tipo = TIPOS_ERRO.includes(tipo) ? tipo : 'indisponivel';
    this.provedor = extras.provedor || null;
    this.status = extras.status || null;
    this.esperaMs = Number.isFinite(extras.esperaMs) && extras.esperaMs > 0 ? Math.min(extras.esperaMs, 60 * 60 * 1000) : null;
    this.uso = extras.uso || null; // uso informado mesmo numa resposta que não serve (custo!)
    this.transitorio = TRANSITORIOS.includes(this.tipo);
    this.revisavel = REVISAVEIS.includes(this.tipo);
    this.cancelado = this.tipo === 'cancelado';
  }
}

// Uso informado pelo provedor: só inteiros ≥ 0; senão é "não informado" (null), nunca zero.
function usoInformado(entrada, saida) {
  return Number.isInteger(entrada) && entrada >= 0 && Number.isInteger(saida) && saida >= 0 ? { tokensEntrada: entrada, tokensSaida: saida } : null;
}

// Espera pedida pelo provedor (cabeçalho retry-after, em segundos).
function esperaDoCabecalho(cabecalhos) {
  const v = cabecalhos && (cabecalhos['retry-after'] || cabecalhos['Retry-After']);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

// Classificação comum por status HTTP (cada provedor ajusta o que for dele).
function classificarStatus(provedor, status, mensagem, cabecalhos) {
  const m = `${provedor}: ${mensagem || `HTTP ${status}`}`;
  if (status === 429) return new ErroProvedor('limite-requisicoes', m, { provedor, status, esperaMs: esperaDoCabecalho(cabecalhos) });
  if (status === 408 || status === 504) return new ErroProvedor('timeout', m, { provedor, status });
  if (status === 401 || status === 403) return new ErroProvedor('credencial', `${provedor}: credencial recusada (HTTP ${status})`, { provedor, status });
  if (status >= 500) return new ErroProvedor('indisponivel', m, { provedor, status, esperaMs: esperaDoCabecalho(cabecalhos) });
  return new ErroProvedor('requisicao-invalida', m, { provedor, status });
}

module.exports = { PROVEDORES, PROVEDOR_SIMULADO, TODOS_PROVEDORES, RECURSOS_PROVEDOR, FINS, TIPOS_ERRO, TRANSITORIOS, REVISAVEIS, ErroProvedor, usoInformado, classificarStatus, esperaDoCabecalho };
