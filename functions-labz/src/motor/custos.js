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
const vazio = () => ({ tokens: 0, custoSimulado: 0, porEtapa: {}, unidade: UNIDADE, simulado: true });

// Cabe mais "estimativa" tokens? (antes de chamar o adaptador)
function verificarAntes(exe, estimativaTokens) {
  const lim = limitesDe(exe);
  const c = exe.custos || vazio();
  const tokens = c.tokens + estimativaTokens;
  if (tokens > lim.tokens) return { permitido: false, motivo: 'limite-de-tokens', consumo: c.tokens, estimativa: estimativaTokens, limite: lim.tokens };
  if (c.custoSimulado + custoDe(estimativaTokens) > lim.custoSimulado) return { permitido: false, motivo: 'limite-de-custo-simulado', consumo: c.custoSimulado, limite: lim.custoSimulado };
  return { permitido: true };
}

// Soma o uso SIMULADO de uma etapa (devolve um objeto novo).
function somar(custos, etapaId, uso) {
  const c = JSON.parse(JSON.stringify(custos || vazio()));
  const tokens = (uso.tokensEntrada || 0) + (uso.tokensSaida || 0);
  c.tokens += tokens;
  c.custoSimulado = Math.round((c.custoSimulado + custoDe(tokens)) * 10000) / 10000;
  const pe = c.porEtapa[etapaId] || { tokens: 0, custoSimulado: 0, chamadas: 0 };
  pe.tokens += tokens; pe.custoSimulado = Math.round((pe.custoSimulado + custoDe(tokens)) * 10000) / 10000; pe.chamadas += 1;
  c.porEtapa[etapaId] = pe;
  return c;
}

module.exports = { ESQUEMA_LIMITES, verificarAntes, somar, limitesDe, custoDe, vazio, UNIDADE, PADRAO, TAXA_POR_MIL_TOKENS };
