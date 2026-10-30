// Memory Retriever (Fase 3C): encontra memórias SEM ler coleções inteiras.
// Regras:
//  - uma coleção por consulta, montada pelo alvo validado (empresa, agente ou
//    tarefa): não existe consulta que misture clientes (nem collectionGroup);
//  - os filtros de segurança vão NA CONSULTA ao banco: status == 'ativa'
//    (só memória com versão aprovada vigente) + o caminho do alvo;
//  - toda consulta tem limite (até 50 candidatos por escopo);
//  - palavras-chave usam os termos gravados na aprovação (indice.js) e o
//    ranking determinístico (ranqueador.js). NÃO é busca semântica, que
//    continua indisponível;
//  - devolve métricas de custo (consultas e documentos lidos), nunca conteúdo
//    em log.
// A verificação de conflitos na APROVAÇÃO (Fase 3B) não usa este módulo: ela
// lê a coleção dentro da transação, para não deixar escapar nenhum conflito.
const { exigirAtor } = require('../auth/super-admin');
const { validarConsultaMemoria, LIMITES_BUSCA, BUSCA_SEMANTICA } = require('../contratos/recuperacao');
const { memoriaVigente, alvoDoEscopo } = require('../contratos/memoria');
const { caminhos } = require('../armazenamento/caminhos');
const { relogioPadrao } = require('../nucleo/ids');
const { termosDaConsulta, palavrasDe, MAX_TERMOS_CONSULTA } = require('./indice');
const { ranquear } = require('./ranqueador');

const ORDEM = { campo: 'aprovadaEm', direcao: 'desc' };

// Índices compostos que as consultas acima precisam no Firestore real (D5:
// declarados aqui, NÃO publicados; firestore.indexes.json não muda sem
// autorização). Formato do firestore.indexes.json. "labz_memorias" cobre as
// subcoleções de empresa, agente e tarefa (mesmo nome de coleção).
const COMBINACOES = [
  [], ['categoria'], ['chave'], ['categoria', 'chave'],
];
const GRUPOS = ['labz_memorias', 'labz_desempenho', 'labz_memoria_global'];
const INDICES_NECESSARIOS = Object.freeze([
  ...GRUPOS.flatMap((g) => COMBINACOES.flatMap((extras) => [false, true].map((comTermos) => ({
    collectionGroup: g, queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      ...extras.map((f) => ({ fieldPath: f, order: 'ASCENDING' })),
      ...(comTermos ? [{ fieldPath: 'termos', arrayConfig: 'CONTAINS' }] : []),
      { fieldPath: 'aprovadaEm', order: 'DESCENDING' },
    ],
  })))),
  { collectionGroup: 'labz_aprendizados', queryScope: 'COLLECTION', fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'criadaEm', order: 'ASCENDING' }] },
]);

// O índice composto que UMA consulta precisa (null = o Firestore resolve sozinho).
function indiceDaConsulta(colecao, opcoes) {
  const onde = opcoes.onde || [];
  const iguais = onde.filter((c) => c.op === '==' || c.op === 'in').map((c) => c.campo);
  const contem = onde.filter((c) => c.op.startsWith('array-contains')).map((c) => c.campo);
  const ordem = opcoes.ordenar && opcoes.ordenar.campo !== 'id' ? [opcoes.ordenar] : [];
  const campos = new Set([...iguais, ...contem, ...ordem.map((o) => o.campo)]);
  if (campos.size <= 1) return null; // um campo só: índice automático
  const grupo = colecao.split('/').pop();
  const status = iguais.includes('status') ? ['status'] : [];
  return {
    collectionGroup: grupo, queryScope: 'COLLECTION',
    fields: [
      ...status.map((f) => ({ fieldPath: f, order: 'ASCENDING' })),
      ...iguais.filter((f) => f !== 'status').sort().map((f) => ({ fieldPath: f, order: 'ASCENDING' })),
      ...contem.map((f) => ({ fieldPath: f, arrayConfig: 'CONTAINS' })),
      ...ordem.map((o) => ({ fieldPath: o.campo, order: o.direcao === 'desc' ? 'DESCENDING' : 'ASCENDING' })),
    ],
  };
}
const indiceDeclarado = (ind) => !ind || INDICES_NECESSARIOS.some((x) => JSON.stringify(x) === JSON.stringify(ind));

// Resultado público de uma memória (trecho limitado; sem campos internos).
function comoResultado(m, escopo) {
  const v = m.vigente;
  return {
    escopo, alvo: m.alvo, id: m.id, versao: m.versaoVigente, categoria: m.categoria, chave: m.chave || null,
    titulo: v.titulo, tags: v.tags || [], trecho: String(v.conteudo).slice(0, LIMITES_BUSCA.caracteresPorResultado),
    cortado: String(v.conteudo).length > LIMITES_BUSCA.caracteresPorResultado, aprovadaEm: m.aprovadaEm || null,
    pontuacao: m.pontuacao, criterios: m.criterios,
  };
}

function criarRecuperador({ banco, relogio = relogioPadrao, auditoria }) {
  // Termos "específicos" (F2, Fase 3E): quando a consulta por palavras lota o
  // limite, os termos que aparecem em menos da metade dos candidatos são os que
  // a palavra comum "abafou". Ordem: mais raros, depois mais longos, depois
  // alfabética (determinístico). Até 10.
  function termosEspecificos(termos, docs) {
    const conta = (t) => docs.filter((m) => (m.termos || []).includes(t)).length;
    return termos.map((t) => ({ t, n: conta(t) })).filter((x) => x.n < docs.length / 2)
      .sort((a, b) => a.n - b.n || b.t.length - a.t.length || a.t.localeCompare(b.t)).slice(0, 10).map((x) => x.t);
  }

  // Monta e executa a consulta limitada (por palavras: no máximo 2 consultas,
  // a principal e uma complementar só com os termos específicos).
  async function consultarEscopo(q, termos, metricas) {
    const r = await consultarUma(q, termos, metricas);
    if (!termos.length || r.brutos.length < r.limite) return r; // não lotou: já veio tudo o que casa
    const especificos = termosEspecificos(termos, r.brutos);
    if (!especificos.length || especificos.length === termos.length) return r;
    const extra = await consultarUma(q, especificos, metricas);
    metricas.consultaComplementar = true;
    const vistos = new Map(r.docs.map((m) => [m.id, m]));
    extra.docs.forEach((m) => { if (!vistos.has(m.id)) vistos.set(m.id, m); });
    return { docs: [...vistos.values()], limite: r.limite, brutos: r.brutos };
  }

  // UMA consulta limitada (termos: os usados no banco nesta consulta).
  async function consultarUma(q, termos, metricas) {
    const onde = [{ campo: 'status', op: '==', valor: 'ativa' }];
    if (q.filtros.categoria) onde.push({ campo: 'categoria', op: '==', valor: q.filtros.categoria });
    if (q.filtros.chave) onde.push({ campo: 'chave', op: '==', valor: q.filtros.chave });
    const tags = [...new Set((q.filtros.tags || []).flatMap((t) => palavrasDe(t)))].slice(0, MAX_TERMOS_CONSULTA);
    if (termos.length) onde.push({ campo: 'termos', op: 'array-contains-any', valor: termos });
    else if (tags.length) onde.push({ campo: 'termos', op: 'array-contains-any', valor: tags });
    const limite = termos.length ? LIMITES_BUSCA.resultadosPorEscopo : q.limite;
    const opcoes = { onde, ordenar: ORDEM, limite };
    if (q.depoisDe) opcoes.depoisDe = q.depoisDe;
    const docs = await banco.consultar(q.colecao, opcoes);
    metricas.consultas++;
    metricas.documentosLidos += docs.length;
    if (docs.length === limite) metricas.limiteAtingido = true;
    const agora = relogio();
    // validade (tarefa expirada) e, na busca por palavras com tags, as tags
    return { docs: docs.filter((m) => memoriaVigente(m, agora) && (!termos.length || !tags.length || tags.some((t) => (m.termos || []).includes(t)))), limite, brutos: docs };
  }

  const novaMetrica = () => ({ consultas: 0, documentosLidos: 0, limiteAtingido: false });

  async function executar(q, { prioridades } = {}) {
    const metricas = novaMetrica();
    const termos = q.modo === 'textual' ? termosDaConsulta(q.texto) : [];
    if (q.modo === 'textual' && !termos.length) {
      return { itens: [], proximo: null, termos, metricas, semantica: BUSCA_SEMANTICA, aviso: 'o texto só tem palavras muito comuns: nada para buscar' };
    }
    const { docs, limite } = await consultarEscopo(q, termos, metricas);
    let ordenados = docs.map((m) => Object.assign({}, m, { escopo: q.escopo, versao: m.versaoVigente, evidencias: m.vigente.evidencias }));
    if (termos.length) ordenados = ranquear(ordenados, { termos, agora: relogio(), prioridades });
    const itens = ordenados.slice(0, q.limite).map((m) => comoResultado(m, q.escopo));
    // paginação só por metadados: o cursor é o último documento lido
    const proximo = !termos.length && docs.length === limite && docs.length ? docs[docs.length - 1].id : null;
    metricas.retornados = itens.length;
    // completa = nenhuma consulta lotou o limite (veio tudo o que casa). Se lotou,
    // é uma SELEÇÃO limitada de candidatos, e o resultado diz isso.
    const completa = !metricas.limiteAtingido;
    return { itens, proximo, termos, metricas, completa, semantica: BUSCA_SEMANTICA, ...(completa ? {} : { aviso: 'seleção limitada: há mais memórias que casam com estas palavras do que o limite de leitura' }) };
  }

  return {
    INDICES_NECESSARIOS,

    // Busca SEM ator, só para a porta de memória do agente (memoria-agente.js),
    // que já fixou o escopo e o alvo pela execução e pelo contrato. Nunca sai pela API.
    // prioridades: as do agente (ranking); mesmas regras e limites da busca.
    async buscarParaAgente(pedido, { prioridades } = {}) {
      return executar(validarConsultaMemoria(pedido), { prioridades });
    },

    // Busca pedida pelo Super Admin (API). pedido: ESQUEMA_CONSULTA_MEMORIA.
    async buscar(ator, pedido) {
      exigirAtor(ator);
      const q = validarConsultaMemoria(pedido);
      const r = await executar(q);
      // custo da leitura, sem o texto pesquisado nem o conteúdo
      if (auditoria) {
        await auditoria.registrar('memoria.busca_realizada', ator, q.colecao, {
          modo: q.modo, termos: r.termos.length, filtros: Object.keys(q.filtros).sort(), limite: q.limite,
          consultas: r.metricas.consultas, documentosLidos: r.metricas.documentosLidos, retornados: r.itens.length, limiteAtingido: r.metricas.limiteAtingido,
        });
      }
      return r;
    },

    // Para o Context Builder: palavras do briefing (até 50) + as mais recentes
    // (até 20), sem repetição. Devolve os documentos completos (vigentes).
    async paraContexto(escopo, alvo, briefing) {
      const a = alvoDoEscopo(escopo, alvo);
      const colecao = caminhos.colecaoMemorias(escopo, a);
      const metricas = novaMetrica();
      const termos = termosDaConsulta(briefing || '');
      const base = { escopo, alvo: a, colecao, filtros: {}, depoisDe: null };
      const porPalavras = termos.length ? (await consultarEscopo(Object.assign({}, base, { limite: LIMITES_BUSCA.resultadosPorEscopo }), termos, metricas)).docs : [];
      const recentes = (await consultarEscopo(Object.assign({}, base, { limite: LIMITES_BUSCA.recentesPorEscopo }), [], metricas)).docs;
      const vistos = new Map();
      [...porPalavras, ...recentes].forEach((m) => { if (!vistos.has(m.id)) vistos.set(m.id, m); });
      return { memorias: [...vistos.values()], termos, metricas };
    },

    // Candidatos a duplicidade/conflito de um texto (AVISO na criação e nas
    // correções; a decisão de verdade é na aprovação, que confere tudo).
    async parecidas(escopo, alvo, texto, chave) {
      const a = alvoDoEscopo(escopo, alvo);
      const colecao = caminhos.colecaoMemorias(escopo, a);
      const metricas = novaMetrica();
      const termos = termosDaConsulta(texto);
      const base = { escopo, alvo: a, colecao, depoisDe: null };
      const lotes = [];
      if (termos.length) lotes.push((await consultarEscopo(Object.assign({}, base, { filtros: {}, limite: LIMITES_BUSCA.resultadosPorEscopo }), termos, metricas)).docs);
      if (chave) lotes.push((await consultarEscopo(Object.assign({}, base, { filtros: { chave }, limite: LIMITES_BUSCA.conflitoPorChave }), [], metricas)).docs);
      const vistos = new Map();
      lotes.flat().forEach((m) => { if (!vistos.has(m.id)) vistos.set(m.id, m); });
      return { memorias: [...vistos.values()], metricas };
    },
  };
}

module.exports = { criarRecuperador, INDICES_NECESSARIOS, indiceDaConsulta, indiceDeclarado };
