// Índice de busca das memórias (Fase 3C). Sem IA e sem nada pago.
//  - os termos são calculados SÓ da versão aprovada que virou vigente, na
//    MESMA transação que a torna vigente (aprovação, rollback, tarefa): o que
//    está no índice é sempre o que está valendo;
//  - ficam no próprio documento da memória (termos, aprovadaEm, indiceVersao),
//    dentro da coleção da empresa/agente/tarefa: não existe índice que misture
//    clientes;
//  - pendentes, rascunhos, em revisão e rejeitadas nunca entram (não viram
//    vigentes); arquivar troca o status e a busca filtra status == 'ativa'.
const { normalizar } = require('./verificacoes');

const INDICE_VERSAO = 1;
const MAX_TERMOS_MEMORIA = 40;
const MAX_TERMOS_CONSULTA = 30; // limite do array-contains-any do Firestore

// Palavras vazias do português (e algumas do inglês) que não ajudam a achar nada.
const PALAVRAS_VAZIAS = new Set(('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos as os ' +
  'mais menos muito muita muitos muitas como mas ou nao sim sua seu suas seus ele ela eles elas isso isto esse essa este esta ' +
  'aquele aquela tem ter ser sao foi era sempre nunca quando onde qual quais the and for with from that this are was').split(' '));

// "fotos" → "foto", "legendas" → "legenda" (só o plural simples; determinístico)
const raiz = (p) => (p.length > 4 && p.endsWith('s') && !p.endsWith('ss') ? p.slice(0, -1) : p);

function palavrasDe(texto) {
  return normalizar(texto).split(' ').filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)).map(raiz);
}

// Termos de uma versão: título, tags, categoria e chave primeiro; depois as
// palavras do conteúdo mais frequentes (empate: ordem alfabética). Até 40.
function termosDaVersao({ titulo, conteudo, tags = [], categoria, chave }) {
  const prioridade = [];
  [categoria, ...(chave ? chave.split('-') : []), titulo, ...tags].forEach((t) => palavrasDe(t || '').forEach((p) => prioridade.push(p)));
  const freq = new Map();
  palavrasDe(conteudo).forEach((p) => freq.set(p, (freq.get(p) || 0) + 1));
  const doConteudo = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  const out = [];
  [...prioridade, ...doConteudo].forEach((p) => { if (!out.includes(p) && out.length < MAX_TERMOS_MEMORIA) out.push(p); });
  return out;
}

// Termos de uma consulta: sem repetição, até 30; quando passa de 30, ficam as
// palavras mais longas (em geral as mais específicas), empate alfabético.
function termosDaConsulta(texto) {
  const unicas = [...new Set(palavrasDe(texto))];
  if (unicas.length <= MAX_TERMOS_CONSULTA) return unicas;
  return unicas.slice().sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, MAX_TERMOS_CONSULTA);
}

// Campos de índice gravados junto com a vigente (memória base + versão).
function camposDeIndice(memoria, versao, agora) {
  return {
    termos: termosDaVersao({ titulo: versao.titulo, conteudo: versao.conteudo, tags: versao.tags || [], categoria: memoria.categoria, chave: memoria.chave }),
    aprovadaEm: (versao.aprovacao && versao.aprovacao.em) || agora,
    indiceVersao: INDICE_VERSAO,
  };
}

module.exports = { termosDaVersao, termosDaConsulta, camposDeIndice, palavrasDe, INDICE_VERSAO, MAX_TERMOS_MEMORIA, MAX_TERMOS_CONSULTA };
