// Ranking determinístico das memórias encontradas (Fase 3C). Transparente:
// cada resultado sai com a nota de cada critério. Pesos: CRITERIOS_RANKING
// (contratos/recuperacao.js) — cobertura 0,45 · categoria 0,25 · evidência 0,10
// · atualidade 0,10 · escopo 0,10.
//  - cobertura: fração dos termos da consulta que a memória tem;
//  - categoria (relevância dos metadados): prioridade da categoria (padrão
//    abaixo; prioridades por agente chegam na Fase 3D);
//  - evidência: só desempenho (até 3 evidências = nota cheia);
//  - atualidade: 1 / (1 + dias desde a aprovação / 90), com o relógio injetado;
//  - escopo (relação com o cliente e com o agente): cliente/desempenho >
//    tarefa > agente > global;
//  - estado de aprovação: é FILTRO, não nota (só entra a versão aprovada vigente).
// Mesmos dados + mesmos parâmetros = mesma ordem. Desempate: versão maior,
// depois id em ordem alfabética.
const { CRITERIOS_RANKING } = require('../contratos/recuperacao');

const PESO_ESCOPO = Object.freeze({ cliente: 1, desempenho: 1, tarefa: 0.9, agente: 0.7, global: 0.5 });
const PRIORIDADE_CATEGORIA = Object.freeze({
  marca: 1, 'design-system': 1, 'tom-de-voz': 1, 'correcao-pontual': 1,
  publico: 0.9, preferencia: 0.9, resultado: 0.9, experimento: 0.9,
  aprendizado: 0.8, metodologia: 0.8, qualidade: 0.8, tecnica: 0.8, campanha: 0.8,
  identidade: 0.7, historico: 0.7, referencia: 0.6, nota: 0.5,
});
const DIAS_MEIA_VIDA = 90;
const arred = (x) => Math.round(x * 1e6) / 1e6;

// item: { id, escopo, categoria, versao, termos, aprovadaEm, evidencias }
function pontuar(item, { termos = [], agora, prioridades = PRIORIDADE_CATEGORIA }) {
  const meus = new Set(item.termos || []);
  const acertos = termos.filter((t) => meus.has(t)).length;
  const dias = item.aprovadaEm && agora ? Math.max(0, (Date.parse(agora) - Date.parse(item.aprovadaEm)) / 864e5) : null;
  const criterios = {
    cobertura: termos.length ? arred(acertos / termos.length) : 0,
    categoria: prioridades[item.categoria] !== undefined ? prioridades[item.categoria] : 0.5,
    evidencia: item.escopo === 'desempenho' ? arred(Math.min(1, (item.evidencias || []).length / 3)) : 0,
    atualidade: dias === null ? 0 : arred(1 / (1 + dias / DIAS_MEIA_VIDA)),
    escopo: PESO_ESCOPO[item.escopo] || 0,
  };
  const p = CRITERIOS_RANKING.pesos;
  const pontuacao = arred(Object.keys(p).reduce((s, k) => s + p[k] * criterios[k], 0));
  return { pontuacao, criterios, acertos };
}

function desempate(a, b) {
  return b.pontuacao - a.pontuacao || (b.versao || 0) - (a.versao || 0) || String(a.id).localeCompare(String(b.id));
}

// Devolve uma cópia ordenada, cada item com { pontuacao, criterios }.
function ranquear(itens, ctx) {
  return itens.map((it) => Object.assign({}, it, pontuar(it, ctx))).sort(desempate);
}

module.exports = { ranquear, pontuar, desempate, PESO_ESCOPO, PRIORIDADE_CATEGORIA, DIAS_MEIA_VIDA };
