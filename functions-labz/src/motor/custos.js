// Cost Controller da Fase 4A. NENHUMA API paga é chamada e nenhum custo real
// existe: os valores são SIMULADOS, numa "unidade simulada" que NÃO é preço de
// provedor nenhum. Serve para testar limites e bloqueios antes dos modelos reais.
const UNIDADE = 'unidade simulada (não é preço de provedor)';
const TAXA_POR_MIL_TOKENS = 0.1; // fictícia, só para o teste dos limites
const PADRAO = Object.freeze({ tokens: 200000, custoSimulado: 50, etapas: 8 });

// Mesmo esquema da criação da execução (execucao/servico.js).
const ESQUEMA_LIMITES = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    tokens: { tipo: 'inteiro', min: 100, max: 5000000 },
    custoSimulado: { tipo: 'numero', min: 0, max: 100000 },
    etapas: { tipo: 'inteiro', min: 1, max: 8 },
  },
};
const limitesDe = (exe) => Object.assign({}, PADRAO, exe.limites || {});
const custoDe = (tokens) => Math.round((tokens / 1000) * TAXA_POR_MIL_TOKENS * 10000) / 10000;
// Fase 4B: separa tokens simulados, uso informado pelo provedor, estimativas,
// custo estimado (só com preço cadastrado), custo desconhecido (nunca zero) e
// custo confirmado (só da fatura; não existe nesta fase).
const vazio = () => ({
  tokens: 0, custoSimulado: 0, porEtapa: {}, unidade: UNIDADE, simulado: true,
  usoInformado: { tokensEntrada: 0, tokensSaida: 0 }, tokensEstimados: 0, tokensSimulados: 0,
  custoEstimado: null, custoDesconhecido: 0, custoConfirmado: null, cobrancaReal: false,
  porAgente: {}, porProvedor: {},
});

// Cabe mais "estimativa" tokens? (antes de chamar o adaptador)
function verificarAntes(exe, estimativaTokens) {
  const lim = limitesDe(exe);
  const c = exe.custos || vazio();
  const tokens = c.tokens + estimativaTokens;
  if (tokens > lim.tokens) return { permitido: false, motivo: 'limite-de-tokens', consumo: c.tokens, estimativa: estimativaTokens, limite: lim.tokens };
  if (c.custoSimulado + custoDe(estimativaTokens) > lim.custoSimulado) return { permitido: false, motivo: 'limite-de-custo-simulado', consumo: c.custoSimulado, limite: lim.custoSimulado };
  return { permitido: true };
}

// Soma o uso de uma chamada (devolve um objeto novo).
// uso.fonte: 'provedor' | 'provedor-simulado' | 'estimado' | (sem fonte = adaptador simulado da 4A)
// info (Fase 4B, opcional): { agenteId, provedor, custo: { tipo: 'estimado'|'desconhecido'|'sem-cobranca', valor, moeda } }
function somar(custos, etapaId, uso, info = {}) {
  const c = Object.assign(vazio(), JSON.parse(JSON.stringify(custos || {})));
  const tokens = (uso.tokensEntrada || 0) + (uso.tokensSaida || 0);
  const fonte = uso.fonte || 'simulado';
  if (fonte === 'provedor' || fonte === 'provedor-simulado') { c.usoInformado.tokensEntrada += uso.tokensEntrada || 0; c.usoInformado.tokensSaida += uso.tokensSaida || 0; }
  if (fonte === 'estimado') c.tokensEstimados += tokens;
  if (fonte !== 'provedor') c.tokensSimulados += tokens; // nesta fase, todo uso é de simulação
  const custo = info.custo || null;
  if (custo && custo.tipo === 'desconhecido') c.custoDesconhecido += 1;
  if (custo && custo.tipo === 'estimado') c.custoEstimado = { valor: Math.round(((c.custoEstimado ? c.custoEstimado.valor : 0) + custo.valor) * 1e6) / 1e6, moeda: custo.moeda };
  const por = (mapa, k) => { if (!k) return; const x = mapa[k] || { tokens: 0, chamadas: 0 }; x.tokens += tokens; x.chamadas += 1; mapa[k] = x; };
  por(c.porAgente, info.agenteId);
  por(c.porProvedor, info.provedor);
  c.tokens += tokens;
  c.custoSimulado = Math.round((c.custoSimulado + custoDe(tokens)) * 10000) / 10000;
  const pe = c.porEtapa[etapaId] || { tokens: 0, custoSimulado: 0, chamadas: 0 };
  pe.tokens += tokens; pe.custoSimulado = Math.round((pe.custoSimulado + custoDe(tokens)) * 10000) / 10000; pe.chamadas += 1;
  c.porEtapa[etapaId] = pe;
  return c;
}

module.exports = { ESQUEMA_LIMITES, verificarAntes, somar, limitesDe, custoDe, vazio, UNIDADE, PADRAO, TAXA_POR_MIL_TOKENS };
