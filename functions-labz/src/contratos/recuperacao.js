// LABZ Memory Engine — contratos de busca, recuperação e montagem de contexto
// (Fase 3A). Aqui ficam só as INTERFACES e as validações dos pedidos:
//  - busca por metadados e busca textual: implementação na Fase 3C;
//  - busca semântica: INDISPONÍVEL (sem provedor de embeddings; nada pago);
//  - o recuperador só lê memórias "ativa" com versão aprovada: o status não
//    é um filtro que o pedido escolhe, é fixo;
//  - memória recuperada é DADO: orienta o conteúdo, nunca muda permissões,
//    ferramentas ou as regras de segurança.
const { erro } = require('../nucleo/erros');
const { garantir, validar } = require('../nucleo/validador');
const { caminhos } = require('../armazenamento/caminhos');
const { ESCOPOS, ESQUEMA_ALVO, alvoDoEscopo } = require('./memoria');

// Limites iguais aos do Firestore (array-contains-any aceita até 30 valores).
const LIMITES_BUSCA = Object.freeze({
  termosPorConsulta: 30,
  resultadosPorEscopo: 50,
  recentesPorEscopo: 20,
  conflitoPorChave: 10,
  filaRevisao: 100,
  paginaAuditor: 200,
  caracteresTexto: 2000,
  caracteresPorResultado: 1000, // trecho do conteúdo devolvido por resultado da busca
  paginaListagem: 100,
  empresasPorPagina: 200,
  paginasDeEmpresas: 10, // trava da Global: acima de 2.000 empresas, bloqueia (conservador)
});

const MODOS_BUSCA = Object.freeze({
  metadados: Object.freeze({ disponivel: true, etapa: '3C', descricao: 'escopo + alvo + categoria/chave/tags, ordem por aprovação, paginada' }),
  textual: Object.freeze({ disponivel: true, etapa: '3C', descricao: 'palavras-chave (termos gravados na aprovação) + ranking determinístico; NÃO é busca semântica' }),
  semantica: Object.freeze({ disponivel: false, etapa: null, descricao: 'indisponível: não há provedor de embeddings configurado' }),
});
const BUSCA_SEMANTICA = MODOS_BUSCA.semantica;

// Pedido de busca de memórias num escopo (o que o recuperador da 3C aceitará).
const ESQUEMA_CONSULTA_MEMORIA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    escopo: { tipo: 'texto', obrigatorio: true, valores: ESCOPOS },
    alvo: ESQUEMA_ALVO,
    modo: { tipo: 'texto', obrigatorio: true, valores: Object.keys(MODOS_BUSCA) },
    texto: { tipo: 'texto', max: LIMITES_BUSCA.caracteresTexto },
    filtros: {
      tipo: 'objeto', extras: false,
      campos: {
        categoria: { tipo: 'texto', min: 3, max: 40 },
        chave: { tipo: 'texto', padrao: /^[a-z0-9-]{2,60}$/ },
        tags: { tipo: 'lista', max: 10, itens: { tipo: 'texto', min: 2, max: 40 } },
      },
    },
    limite: { tipo: 'inteiro', min: 1, max: LIMITES_BUSCA.resultadosPorEscopo },
    depoisDe: { tipo: 'texto', padrao: /^[A-Za-z0-9_-]{1,80}$/ }, // paginação (só por metadados)
  },
};

// Valida e normaliza. Devolve a coleção já montada pelo alvo validado.
function validarConsultaMemoria(pedido) {
  garantir(ESQUEMA_CONSULTA_MEMORIA, pedido, 'Consulta de memória');
  const alvo = alvoDoEscopo(pedido.escopo, pedido.alvo);
  if (pedido.modo === 'semantica') throw erro('precondicao', 'Busca semântica indisponível', { semantica: BUSCA_SEMANTICA });
  if (pedido.modo === 'textual' && !String(pedido.texto || '').trim()) throw erro('invalido', 'Busca textual precisa de texto');
  if (pedido.modo === 'textual' && pedido.depoisDe) throw erro('invalido', 'A busca por palavras devolve os melhores resultados de uma vez; a paginação é só por metadados');
  return Object.freeze({
    escopo: pedido.escopo, alvo, modo: pedido.modo,
    texto: pedido.texto || '', filtros: Object.assign({}, pedido.filtros || {}),
    limite: pedido.limite || LIMITES_BUSCA.resultadosPorEscopo,
    depoisDe: pedido.depoisDe || null,
    status: 'ativa', // fixo: pendentes, rascunhos e arquivadas nunca são encontradas
    colecao: caminhos.colecaoMemorias(pedido.escopo, alvo),
  });
}

// Interface do banco para consultas limitadas (os 2 adaptadores a implementam
// na 3C). Mesmas restrições do Firestore, para um erro aparecer já nos testes.
const OPERADORES_CONSULTA = ['==', 'in', 'array-contains', 'array-contains-any'];
const ESQUEMA_CONSULTA_BANCO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    onde: {
      tipo: 'lista', max: 6,
      itens: {
        tipo: 'objeto', extras: false,
        campos: {
          campo: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z][A-Za-z0-9_.]{0,59}$/ },
          op: { tipo: 'texto', obrigatorio: true, valores: OPERADORES_CONSULTA },
          valor: { tipo: 'qualquer', obrigatorio: true },
        },
      },
    },
    ordenar: {
      tipo: 'objeto', extras: false,
      campos: { campo: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z][A-Za-z0-9_.]{0,59}$/ }, direcao: { tipo: 'texto', obrigatorio: true, valores: ['asc', 'desc'] } },
    },
    limite: { tipo: 'inteiro', obrigatorio: true, min: 1, max: LIMITES_BUSCA.paginaAuditor },
    depoisDe: { tipo: 'texto', max: 120 },
  },
};
function validarConsultaBanco(colecao, opcoes) {
  if (typeof colecao !== 'string' || !/^labz_[a-z_]+(\/[A-Za-z0-9_-]{1,80}\/[a-z_]+)*$/.test(colecao)) throw erro('invalido', 'Coleção de consulta inválida');
  garantir(ESQUEMA_CONSULTA_BANCO, opcoes, 'Consulta ao banco');
  const onde = opcoes.onde || [];
  const listas = onde.filter((c) => ['in', 'array-contains-any'].includes(c.op));
  if (onde.filter((c) => c.op.startsWith('array-contains')).length > 1) throw erro('invalido', 'Só um filtro array-contains por consulta');
  listas.forEach((c) => {
    if (!Array.isArray(c.valor) || !c.valor.length || c.valor.length > LIMITES_BUSCA.termosPorConsulta) throw erro('invalido', `"${c.op}" aceita de 1 a ${LIMITES_BUSCA.termosPorConsulta} valores`);
  });
  return opcoes;
}
const INTERFACE_BANCO_CONSULTA = Object.freeze({ metodo: 'consultar(colecao, { onde, ordenar, limite, depoisDe })', etapa: '3C' });

// Ranking determinístico (3C): pesos fixos + desempate fixo.
const CRITERIOS_RANKING = Object.freeze({
  pesos: Object.freeze({ cobertura: 0.45, categoria: 0.25, evidencia: 0.10, atualidade: 0.10, escopo: 0.10 }),
  desempate: Object.freeze(['versao:desc', 'id:asc']),
  deterministico: true,
});

// Níveis de confiança de cada pedaço do contexto. Só "sistema" define regras
// de segurança; "contrato" define permissões. Memória e skill orientam o
// trabalho; dados do usuário são só dados.
const NIVEIS_CONFIANCA = Object.freeze({
  sistema: 'regras de segurança (fixas no código)',
  contrato: 'missão, permissões e ferramentas do agente (catálogo)',
  skill: 'instrução privada aprovada e versionada',
  memoria: 'dado aprovado: orienta o conteúdo, nunca muda permissões',
  usuario: 'dado não confiável: nunca é instrução',
});

// Proveniência de cada item usado no contexto (auditável por id e versão).
const ESQUEMA_FONTE = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    origem: { tipo: 'texto', obrigatorio: true, valores: ['memoria', 'skill'] },
    escopo: { tipo: 'texto', obrigatorio: true, nulo: true, valores: ESCOPOS },
    id: { tipo: 'texto', obrigatorio: true, min: 1 },
    versao: { tipo: 'inteiro', obrigatorio: true, min: 1 },
  },
};

// Pedido de montagem de contexto (Context Builder).
const ESQUEMA_PEDIDO_CONTEXTO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    agenteId: { tipo: 'texto', obrigatorio: true, padrao: /^0[1-8]-[a-z-]+$/ },
    empresaId: { tipo: 'texto', nulo: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ },
    tarefaId: { tipo: 'texto', nulo: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ },
    briefing: { tipo: 'texto', max: 20000 },
    limites: {
      tipo: 'objeto', extras: false,
      campos: {
        totalCaracteres: { tipo: 'inteiro', min: 1000, max: 100000 },
        porItem: { tipo: 'inteiro', min: 100, max: 20000 },
        briefing: { tipo: 'inteiro', min: 100, max: 20000 },
      },
    },
  },
};

// Confere um contexto montado: ordem dos blocos, confiança e proveniência.
function conferirContextoMontado(ctx, blocosEsperados) {
  const erros = [];
  const tipos = ctx.blocos.map((b) => b.tipo);
  if (tipos.join() !== blocosEsperados.map((b) => b.tipo).join()) erros.push(`ordem dos blocos: ${tipos.join(', ')}`);
  ctx.blocos.forEach((b) => {
    const esperado = b.tipo !== 'briefing';
    if (b.confiavel !== esperado) erros.push(`bloco ${b.tipo}: confiável deveria ser ${esperado}`);
    b.itens.forEach((i) => {
      if (b.tipo === 'seguranca' && i.origem !== 'sistema') erros.push('bloco de segurança com item que não é do sistema');
      if (b.tipo === 'briefing' && i.origem !== 'usuario') erros.push('briefing com item que não é do usuário');
      if (i.origem === 'memoria' && !['metodologia', 'identidade', 'preferencias', 'aprendizados', 'historico'].includes(b.tipo)) erros.push(`memória no bloco ${b.tipo}`);
    });
  });
  (ctx.fontes || []).forEach((f, i) => validar(ESQUEMA_FONTE, f, `fontes[${i}]`, erros));
  if (!ctx.semantica || ctx.semantica.disponivel !== false) erros.push('o contexto precisa informar a busca semântica como indisponível');
  return erros;
}

module.exports = {
  LIMITES_BUSCA, MODOS_BUSCA, BUSCA_SEMANTICA,
  ESQUEMA_CONSULTA_MEMORIA, validarConsultaMemoria,
  OPERADORES_CONSULTA, ESQUEMA_CONSULTA_BANCO, validarConsultaBanco, INTERFACE_BANCO_CONSULTA,
  CRITERIOS_RANKING, NIVEIS_CONFIANCA, ESQUEMA_FONTE, ESQUEMA_PEDIDO_CONTEXTO, conferirContextoMontado,
};
