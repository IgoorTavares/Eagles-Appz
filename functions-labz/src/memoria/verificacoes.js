// Verificações de conteúdo do Memory Engine, num lugar só (Fase 3B):
//  - normalização e similaridade de textos (sem IA);
//  - duplicidade e conflito por "chave" entre memórias vigentes;
//  - sinais de instrução escondida (prompt injection) no texto.
// Antes estavam repetidas em correcoes.js e auditor.js; os dois passam a usar
// estas funções, com o mesmo comportamento.

const crypto = require('node:crypto');

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (t) => new Set(normalizar(t).split(' ').filter((p) => p.length >= 3));
function similaridade(a, b) {
  const A = palavras(a), B = palavras(b);
  if (!A.size || !B.size) return 0;
  let comum = 0;
  A.forEach((p) => { if (B.has(p)) comum++; });
  return comum / (A.size + B.size - comum);
}

const LIMIAR_DUPLICIDADE = 0.8;

// Um texto novo contra as memórias vigentes do mesmo escopo/alvo.
//  duplicados: conteúdo muito parecido; conflitos: mesma chave com outro conteúdo.
function analisarNovoTexto(vigentes, texto, chave, { ignorarId } = {}) {
  const outras = vigentes.filter((m) => m.id !== ignorarId && m.vigente);
  const duplicados = outras
    .map((m) => ({ id: m.id, similaridade: similaridade(texto, m.vigente.conteudo) }))
    .filter((x) => x.similaridade >= LIMIAR_DUPLICIDADE);
  const conflitos = chave ? outras.filter((m) => m.chave === chave && normalizar(m.vigente.conteudo) !== normalizar(texto)).map((m) => m.id) : [];
  return { duplicados, conflitos };
}

// Conjunto de memórias vigentes (auditor): pares parecidos e chaves repetidas.
function analisarConjunto(vigentes) {
  const duplicadas = [];
  for (let i = 0; i < vigentes.length; i++) {
    for (let j = i + 1; j < vigentes.length; j++) {
      const s = similaridade(vigentes[i].vigente.conteudo, vigentes[j].vigente.conteudo);
      if (s >= LIMIAR_DUPLICIDADE) duplicadas.push({ a: vigentes[i].id, b: vigentes[j].id, similaridade: Math.round(s * 100) / 100 });
    }
  }
  const porChave = {};
  vigentes.filter((m) => m.chave).forEach((m) => { (porChave[m.chave] = porChave[m.chave] || []).push(m.id); });
  const conflitos = Object.entries(porChave).filter(([, ids]) => ids.length > 1).map(([chave, ids]) => ({ chave, ids }));
  return { duplicadas, conflitos };
}

// Sinais de tentativa de "dar ordens" ao sistema dentro de um texto que vai
// virar memória (prompt injection). Não bloqueia sozinho: obriga o Super
// Admin a confirmar que leu antes de aprovar.
const SINAIS_INJECAO = [
  /ignore (as|todas as|the|all)? ?(instru|regra|previous|instructions)/i,
  /desconsidere (as|todas)/i,
  /(system|sistema) ?prompt/i,
  /voc[eê] agora [eé]/i,
  /(revele|mostre|envie).{0,30}(chave|senha|token|segredo|api key)/i,
  /(aprove|aprovar) (automaticamente|sem)/i,
  /<\/?(script|system|instructions?)>/i,
];
const sinaisDeInjecao = (texto) => SINAIS_INJECAO.filter((r) => r.test(String(texto || ''))).map((r) => r.source);

// Assinatura de uma situação de duplicidade/conflito: a proposta (memória,
// versão e conteúdo) + cada memória envolvida com a versão vigente dela.
// Se qualquer coisa mudar, a assinatura muda e a confirmação antiga não vale.
function assinaturaConflitos({ memoria, versao, conteudo, itens }) {
  const dados = { memoria, versao, conteudo: crypto.createHash('sha256').update(String(conteudo), 'utf8').digest('hex'), itens };
  return crypto.createHash('sha256').update(JSON.stringify(dados), 'utf8').digest('hex');
}

module.exports = { assinaturaConflitos, normalizar, similaridade, LIMIAR_DUPLICIDADE, analisarNovoTexto, analisarConjunto, sinaisDeInjecao, SINAIS_INJECAO };
