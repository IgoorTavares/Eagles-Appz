// API interna da LABZ AI: uma única função chamável ("labzApi") recebe
// { acao, dados }. Para TODA ação, nesta ordem:
//   1. exigirSuperAdmin (token verificado + role + as duas listas + conta livre);
//   2. a ação precisa estar nesta lista fechada (qualquer outra é recusada);
//   3. tamanho e formato do pedido são conferidos;
//   4. o serviço valida os dados pelo esquema dele e grava a auditoria.
// A resposta nunca leva segredos: só o que o Super Admin já poderia ler.
// Este arquivo não depende do Firebase: o index.js só o "embrulha" no onCall.
const { exigirSuperAdmin } = require('../auth/super-admin');
const { erro, ErroLabz } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { statusProvedores } = require('../segredos/provedores');
const { AGENTES } = require('../agentes/catalogo');
const { FERRAMENTAS } = require('../ferramentas/catalogo');

const MAX_PEDIDO = 200 * 1024; // 200 KB
const REF_MEMORIA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    escopo: { tipo: 'texto', obrigatorio: true },
    alvo: { tipo: 'objeto', obrigatorio: true },
    memoriaId: { tipo: 'texto', obrigatorio: true, max: 80 },
  },
};
const ID = { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ };
const N = { tipo: 'inteiro', obrigatorio: true, min: 1 };
const obj = (campos) => ({ tipo: 'objeto', obrigatorio: true, extras: false, campos });
const CURSOR = { tipo: 'texto', padrao: /^[A-Za-z0-9_-]{1,80}$/ };
const MOTIVO = { tipo: 'texto', obrigatorio: true, min: 3, max: 500 };
const CONFIRMACAO_CONFLITOS = {
  tipo: 'objeto', extras: false,
  campos: { assinatura: { tipo: 'texto', obrigatorio: true, padrao: /^[0-9a-f]{64}$/ }, justificativa: MOTIVO },
};
const OPCOES_CRIACAO = { tipo: 'objeto', extras: false, campos: { rascunho: { tipo: 'booleano' }, confirmoSemDadosDeCliente: { tipo: 'booleano' } } };

// acao → [esquema dos dados, executor(servicos, ator, dados, ctx)]
const ACOES = {
  'sistema.status': [obj({}), async (s, ator, d, ctx) => ({
    provedores: statusProvedores(ctx.lerSegredo),
    agentes: AGENTES.map((a) => ({ id: a.id, nome: a.nome, modelo: a.modelo.provedor ? 'configurado' : 'a-configurar' })),
    ferramentas: FERRAMENTAS.map((f) => ({ id: f.id, disponibilidade: f.disponibilidade })),
    fila: 'persistente (labz_fila); trabalhador automático na Fase 4',
  })],

  'empresas.criar': [obj({ empresa: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.empresas.criar(a, d.empresa)],
  'empresas.alterar': [obj({ empresaId: ID, campos: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.empresas.alterar(a, d.empresaId, d.campos)],
  'empresas.vincular': [obj({ empresaId: ID, vinculo: { tipo: 'objeto', obrigatorio: true, nulo: true } }), (s, a, d) => s.empresas.vincular(a, d.empresaId, d.vinculo)],
  'empresas.arquivar': [obj({ empresaId: ID, motivo: { tipo: 'texto', max: 300 } }), (s, a, d) => s.empresas.arquivar(a, d.empresaId, d.motivo)],
  'empresas.reativar': [obj({ empresaId: ID }), (s, a, d) => s.empresas.reativar(a, d.empresaId)],
  'empresas.obter': [obj({ empresaId: ID }), (s, a, d) => s.empresas.obter(a, d.empresaId)],
  'empresas.listar': [obj({ status: { tipo: 'texto', valores: ['ativa', 'arquivada'] }, depoisDe: CURSOR, limite: { tipo: 'inteiro', min: 1, max: 100 } }), (s, a, d) => s.empresas.listarPagina(a, { status: d.status, depoisDe: d.depoisDe, limite: d.limite })],

  // Opções aceitas: só confirmações explícitas do Super Admin. Nunca agenteId
  // (agente não aprova nem decide; propostas de agentes chegam pela Fase 4).
  'memoria.criar': [obj({ memoria: { tipo: 'objeto', obrigatorio: true }, opcoes: OPCOES_CRIACAO }), (s, a, d) => s.memoria.criar(a, d.memoria, d.opcoes || {})],
  'memoria.novaVersao': [obj({ ref: REF_MEMORIA, conteudo: { tipo: 'objeto', obrigatorio: true }, opcoes: OPCOES_CRIACAO }), (s, a, d) => s.memoria.novaVersao(a, d.ref, d.conteudo, d.opcoes || {}).then((n) => ({ versao: n }))],
  'memoria.enviarParaAprovacao': [obj({ ref: REF_MEMORIA, versao: N }), (s, a, d) => s.memoria.enviarParaAprovacao(a, d.ref, d.versao)],
  'memoria.aprovar': [obj({
    ref: REF_MEMORIA, versao: N, justificativa: { tipo: 'texto', max: 500 },
    confirmoSinais: { tipo: 'booleano' }, confirmoSemDadosDeCliente: { tipo: 'booleano' }, confirmacaoConflitos: CONFIRMACAO_CONFLITOS,
  }), (s, a, d) => s.memoria.aprovarVersao(a, d.ref, d.versao, {
    justificativa: d.justificativa, confirmoSinais: d.confirmoSinais, confirmoSemDadosDeCliente: d.confirmoSemDadosDeCliente, confirmacaoConflitos: d.confirmacaoConflitos,
  })],
  'memoria.avaliarConflitos': [obj({ ref: REF_MEMORIA, versao: N }), (s, a, d) => s.memoria.avaliarConflitos(a, d.ref, d.versao)],
  'memoria.rejeitar': [obj({ ref: REF_MEMORIA, versao: N, motivo: MOTIVO }), (s, a, d) => s.memoria.rejeitarVersao(a, d.ref, d.versao, d.motivo)],
  'memoria.pedirRevisao': [obj({ ref: REF_MEMORIA, versao: N, motivo: MOTIVO }), (s, a, d) => s.memoria.pedirRevisao(a, d.ref, d.versao, d.motivo)],
  'memoria.voltarVersao': [obj({ ref: REF_MEMORIA, versao: N, motivo: { tipo: 'texto', max: 300 }, confirmoSemDadosDeCliente: { tipo: 'booleano' }, confirmacaoConflitos: CONFIRMACAO_CONFLITOS }),
    (s, a, d) => s.memoria.voltarVersao(a, d.ref, d.versao, { motivo: d.motivo, confirmoSemDadosDeCliente: d.confirmoSemDadosDeCliente, confirmacaoConflitos: d.confirmacaoConflitos })],
  'memoria.exportarMarkdown': [obj({ ref: REF_MEMORIA, versao: { tipo: 'inteiro', min: 1 } }), (s, a, d) => s.memoria.exportarMarkdown(a, d.ref, d.versao)],
  'memoria.arquivar': [obj({ ref: REF_MEMORIA, motivo: { tipo: 'texto', max: 300 } }), (s, a, d) => s.memoria.arquivar(a, d.ref, d.motivo)],
  'memoria.reativar': [obj({ ref: REF_MEMORIA, confirmacaoConflitos: CONFIRMACAO_CONFLITOS }), (s, a, d) => s.memoria.reativar(a, d.ref, { confirmacaoConflitos: d.confirmacaoConflitos })],
  'memoria.obter': [obj({ ref: REF_MEMORIA }), (s, a, d) => s.memoria.obter(d.ref)],
  'memoria.versoes': [obj({ ref: REF_MEMORIA }), (s, a, d) => s.memoria.versoes(d.ref)],
  // Listagem e auditoria por páginas (até 100); "proximo" continua de onde parou.
  'memoria.listar': [obj({ escopo: { tipo: 'texto', obrigatorio: true }, alvo: { tipo: 'objeto', obrigatorio: true }, status: { tipo: 'texto', valores: ['pendente', 'ativa', 'arquivada'] }, depoisDe: CURSOR, limite: { tipo: 'inteiro', min: 1, max: 100 } }),
    (s, a, d) => s.memoria.listarPagina(d.escopo, d.alvo, { status: d.status, depoisDe: d.depoisDe, limite: d.limite })],
  'memoria.auditar': [obj({ escopo: { tipo: 'texto', obrigatorio: true }, alvo: { tipo: 'objeto', obrigatorio: true }, depoisDe: CURSOR }), (s, a, d) => s.auditor.auditar(d.escopo, d.alvo, { depoisDe: d.depoisDe })],
  // Busca por metadados ou palavras-chave (NÃO semântica), limitada e com ranking determinístico.
  'memoria.buscar': [obj({ consulta: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.recuperador.buscar(a, d.consulta)],
  'memoria.reindexar': [obj({ escopo: { tipo: 'texto', obrigatorio: true }, alvo: { tipo: 'objeto', obrigatorio: true }, depoisDe: CURSOR }), (s, a, d) => s.memoria.reindexar(a, d.escopo, d.alvo, { depoisDe: d.depoisDe })],

  'correcoes.registrar': [obj({ correcao: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.correcoes.registrar(a, d.correcao)],
  'correcoes.aprovar': [obj({ aprendizadoId: ID, ajustes: { tipo: 'objeto' } }), (s, a, d) => s.correcoes.aprovar(a, d.aprendizadoId, d.ajustes || {})],
  'correcoes.rejeitar': [obj({ aprendizadoId: ID, motivo: { tipo: 'texto', max: 500 } }), (s, a, d) => s.correcoes.rejeitar(a, d.aprendizadoId, d.motivo).then(() => ({ ok: true }))],
  'correcoes.pendentes': [obj({ depoisDe: CURSOR }), (s, a, d) => s.correcoes.pendentesPagina({ depoisDe: d.depoisDe })],

  'skills.salvar': [obj({ agenteId: ID, arquivo: { tipo: 'texto', obrigatorio: true, max: 60 }, conteudo: { tipo: 'texto', obrigatorio: true } }), (s, a, d) => s.skills.salvarVersao(a, d.agenteId, d.arquivo, d.conteudo)],
  'skills.aprovar': [obj({ agenteId: ID, arquivo: { tipo: 'texto', obrigatorio: true, max: 60 }, versao: N }), (s, a, d) => s.skills.aprovarVersao(a, d.agenteId, d.arquivo, d.versao).then(() => ({ ok: true }))],
  'skills.voltarVersao': [obj({ agenteId: ID, arquivo: { tipo: 'texto', obrigatorio: true, max: 60 }, versao: N }), (s, a, d) => s.skills.voltarVersao(a, d.agenteId, d.arquivo, d.versao).then((n) => ({ versao: n }))],

  'contexto.previa': [obj({ agenteId: ID, empresaId: { tipo: 'texto', nulo: true, max: 80 }, tarefaId: { tipo: 'texto', nulo: true, max: 80 }, briefing: { tipo: 'texto', max: 20000 } }),
    (s, a, d) => s.contexto.montar({ agenteId: d.agenteId, empresaId: d.empresaId || null, tarefaId: d.tarefaId || null, briefing: d.briefing || '' }, a)],

  // Fase 3D: contexto por etapa (sem executar agente nenhum) e o plano do Estrategista
  'execucoes.prepararEtapa': [obj({ execucaoId: ID, etapa: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.preparacao.prepararEtapa(a, d.execucaoId, d.etapa)],
  'execucoes.planejarContextos': [obj({ execucaoId: ID, passos: { tipo: 'lista', obrigatorio: true, max: 8 } }), (s, a, d) => s.preparacao.planejarContextos(a, d.execucaoId, d.passos)],
  // Fase 4A: motor de execução (agentes SIMULADOS). O executor da fila não sai pela API.
  'execucoes.planejar': [obj({ execucaoId: ID, passos: { tipo: 'lista', max: 8 } }), (s, a, d) => s.motor.planejar(a, d.execucaoId, { passos: d.passos })],
  'execucoes.aprovacoes': [obj({ execucaoId: ID }), (s, a, d) => s.aprovacoes.pendentes(a, d.execucaoId)],
  'execucoes.decidirAprovacao': [obj({ execucaoId: ID, aprovacaoId: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ }, decisao: { tipo: 'texto', obrigatorio: true }, assinatura: { tipo: 'texto', obrigatorio: true }, justificativa: { tipo: 'texto', obrigatorio: true } }),
    (s, a, d) => s.motor.decidirAprovacao(a, d.execucaoId, d.aprovacaoId, { decisao: d.decisao, assinatura: d.assinatura, justificativa: d.justificativa })],
  'execucoes.retomar': [obj({ execucaoId: ID, limites: { tipo: 'objeto' } }), (s, a, d) => s.motor.retomar(a, d.execucaoId, { limites: d.limites })],
  'execucoes.diagnostico': [obj({ execucaoId: ID }), (s, a, d) => s.motor.diagnosticar(a, d.execucaoId)],
  'execucoes.criar': [obj({ execucao: { tipo: 'objeto', obrigatorio: true } }), (s, a, d) => s.execucoes.criar(a, d.execucao)],
  'execucoes.transicionar': [obj({ execucaoId: ID, para: { tipo: 'texto', obrigatorio: true }, motivo: { tipo: 'texto', max: 300 }, versaoEsperada: { tipo: 'inteiro', min: 1 } }),
    (s, a, d) => s.execucoes.transicionar(a, d.execucaoId, d.para, { motivo: d.motivo, versaoEsperada: d.versaoEsperada })],
  'execucoes.obter': [obj({ execucaoId: ID }), (s, a, d) => s.execucoes.obter(a, d.execucaoId)],
  'execucoes.listar': [obj({ estado: { tipo: 'texto', max: 30 }, empresaId: { tipo: 'texto', max: 80 }, depoisDe: CURSOR, limite: { tipo: 'inteiro', min: 1, max: 100 } }), (s, a, d) => s.execucoes.listarPagina(a, d)],

  'auditoria.listar': [obj({ tipo: { tipo: 'texto', max: 60 }, depoisDe: CURSOR, limite: { tipo: 'inteiro', min: 1, max: 100 } }),
    (s, a, d) => s.auditoria.listarPagina({ tipo: d.tipo, depoisDe: d.depoisDe, limite: d.limite })],
};

// ctx: { servicos, banco, uidsAutorizados, lerSegredo }
function criarApi(ctx) {
  return async function labzApi(request) {
    // 0. (servidor) confere de novo o token: assinatura, conta desativada e sessões revogadas
    if (request && request.auth && ctx.verificarToken) await ctx.verificarToken(request);
    const ator = await exigirSuperAdmin(request && request.auth, { banco: ctx.banco, uidsAutorizados: ctx.uidsAutorizados(), auditoria: ctx.servicos.auditoria });
    const pedido = (request && request.data) || {};
    if (typeof pedido !== 'object' || Array.isArray(pedido)) throw erro('invalido', 'Pedido inválido');
    if (JSON.stringify(pedido).length > MAX_PEDIDO) throw erro('invalido', 'Pedido grande demais');
    const entrada = ACOES[pedido.acao];
    if (!entrada || !Object.prototype.hasOwnProperty.call(ACOES, pedido.acao)) throw erro('invalido', 'Ação desconhecida');
    const [esquema, executar] = entrada;
    const dados = pedido.dados === undefined ? {} : pedido.dados;
    garantir(esquema, dados, `Dados de ${pedido.acao}`);
    const resultado = await executar(ctx.servicos, ator, dados, ctx);
    return { ok: true, resultado: resultado === undefined ? null : resultado };
  };
}

// ErroLabz → código do Firebase (HttpsError). Erro desconhecido vira
// "internal" com mensagem genérica (o detalhe fica só no log do servidor).
const MAPA_CODIGOS = {
  'nao-autenticado': 'unauthenticated', 'permissao-negada': 'permission-denied', isolamento: 'permission-denied',
  invalido: 'invalid-argument', 'nao-encontrado': 'not-found', conflito: 'already-exists',
  precondicao: 'failed-precondition', 'transicao-invalida': 'failed-precondition',
};
function traduzirErro(e) {
  if (e instanceof ErroLabz && MAPA_CODIGOS[e.codigo]) {
    // detalhes só onde o Super Admin precisa deles para agir: o que está inválido, a duplicidade/conflito
    // a decidir (com a assinatura) e o motivo de um bloqueio. Nunca em recusa de acesso.
    return { codigo: MAPA_CODIGOS[e.codigo], mensagem: e.message, detalhes: ['invalido', 'conflito', 'precondicao'].includes(e.codigo) ? e.detalhes : undefined };
  }
  return { codigo: 'internal', mensagem: 'Erro interno da LABZ AI.' };
}

module.exports = { criarApi, traduzirErro, ACOES, MAX_PEDIDO };
