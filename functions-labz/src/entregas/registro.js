// Fase 4C.1: REGISTRO DE ENTREGAS (o que os 8 agentes produzem), sobre o que
// já existe: banco e transações, caminhos (isolamento pelo caminho), auditoria
// sem conteúdo, Super Admin (exigirAtor) e o ator do sistema (motor/agentes).
//
//  labz_entregas/{id}                      metadados + versão atual + versão aprovada
//  labz_entregas/{id}/labz_versoes_entrega/{n}  versão IMUTÁVEL (conteúdo, hash, origem)
//  labz_tarefas/{execucao}/labz_conteudos/{sha256}  o conteúdo (armazenamento.js)
//
// Regras:
//  - empresa, execução, etapa e agente vêm da EXECUÇÃO no banco, nunca do pedido
//    nem do modelo; o id da entrega é do backend (novoId, ou determinístico por etapa);
//  - mudar = criar versão NOVA; uma versão nunca é reescrita nem apagada (o único
//    campo que muda numa versão é a decisão: rascunho → em-revisao → aprovada |
//    rejeitada | precisa-revisao). Não existe operação de apagar;
//  - aprovar, rejeitar, pedir revisão e restaurar: SÓ o Super Admin, presos à
//    versão EXATA (número + hash). Versão nova NÃO herda aprovação;
//  - o agente (ator do sistema) só registra a entrega da PRÓPRIA etapa (pelo motor,
//    com o crachá do executor) e pode propor revisão das entregas dele;
//  - consultas limitadas e paginadas, com o cursor preso ao filtro.
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor, exigirAtorOuSistema, ATOR_SISTEMA } = require('../auth/super-admin');
const { obterAgente } = require('../agentes/catalogo');
const { agenteNaExecucao } = require('../agentes/memoria-agente');
const { FINAIS } = require('../contratos/execucao');
const C = require('../contratos/entrega');
const arm = require('./armazenamento');

const PAGINA = 100;
const SEG = /^[A-Za-z0-9_-]{1,80}$/;
// Tipo de cada entrega de TEXTO de etapa (imagens, carrosséis e pacotes reais vêm nas próximas etapas da 4C)
const TIPO_DO_AGENTE = Object.freeze({
  '01-guia-marca': 'documento', '02-designer': 'documento', '03-carrosseis': 'roteiro', '04-roteirista': 'roteiro',
  '05-dev-web': 'documento', '06-engenheiro': 'relatorio', '07-trafego': 'planejamento', '08-estrategista': 'relatorio',
});
const ESQUEMA_DECISAO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    decisao: { tipo: 'texto', obrigatorio: true, valores: ['aprovar', 'rejeitar', 'pedir-revisao'] },
    versao: { tipo: 'inteiro', obrigatorio: true, min: 1 },
    hash: { tipo: 'texto', obrigatorio: true, padrao: /^[0-9a-f]{64}$/ },
    motivo: { tipo: 'texto', min: 3, max: 500 },
  },
};
const PARA = { aprovar: 'aprovada', rejeitar: 'rejeitada', 'pedir-revisao': 'precisa-revisao' };
const curto = (h) => String(h || '').slice(0, 12);

function idDaEtapa(execucaoId, etapaId) {
  const id = `ent_${execucaoId}_${etapaId}`;
  return SEG.test(id) ? id : `ent_${arm.sha256(`${execucaoId}/${etapaId}`).slice(0, 40)}`;
}

function criarEntregas({ banco, auditoria, relogio = relogioPadrao }) {
  const ev = (tipo, ator, id, detalhes) => auditoria.registrar(`entrega.${tipo}`, ator, caminhos.entrega(id), detalhes);

  async function lerExecucao(leitor, execucaoId) {
    const exe = await leitor.obter(caminhos.tarefa(execucaoId));
    if (!exe) throw erro('nao-encontrado', 'Execução não encontrada');
    return Object.assign({ id: execucaoId }, exe);
  }
  async function lerEntrega(leitor, id) {
    if (typeof id !== 'string' || !SEG.test(id)) throw erro('invalido', 'Id de entrega inválido');
    const e = await leitor.obter(caminhos.entrega(id));
    if (!e) throw erro('nao-encontrado', 'Entrega não encontrada');
    return Object.assign({ id }, e);
  }
  async function lerVersao(leitor, id, n) {
    if (!Number.isInteger(n) || n < 1) throw erro('invalido', 'Versão inválida');
    const v = await leitor.obter(caminhos.versaoEntrega(id, n));
    if (!v) throw erro('nao-encontrado', 'Versão não encontrada');
    return v;
  }

  // Cria a versão n+1 (nunca sobrescreve). conteudo já validado; ref opcional (restauração).
  async function gravarVersao(t, entrega, { conteudo, preparado, ref, origem, ator, estado }) {
    const n = (entrega.ultimaVersao || 0) + 1;
    if (await t.obter(caminhos.versaoEntrega(entrega.id, n))) throw erro('conflito', 'Esta versão já existe: outra gravação chegou antes', { motivo: 'versao-concorrente' });
    const agora = relogio();
    const referencia = ref || await arm.gravarConteudo(t, entrega.execucaoId, preparado, agora);
    const versao = {
      n, estado, formato: conteudo.formato, nome: conteudo.nome, descricao: conteudo.descricao || null,
      conteudoRef: referencia, hash: referencia.hash, tamanho: referencia.tamanho,
      arquivoReal: preparado ? preparado.arquivoReal : conteudo.arquivoReal, metadados: preparado ? preparado.metadados : conteudo.metadados,
      origem, criadoEm: agora, criadoPor: ator.uid, decisao: null, enviadaEm: estado === 'em-revisao' ? agora : null,
    };
    await t.gravar(caminhos.versaoEntrega(entrega.id, n), versao);
    const base = { versaoAtual: n, ultimaVersao: n, estadoAtual: estado, hashAtual: referencia.hash, nome: conteudo.nome, atualizadoEm: agora, atualizadoPor: ator.uid };
    return { n, versao, base };
  }

  function validarConteudo(tipo, conteudo) {
    garantir(C.ESQUEMA_CONTEUDO, conteudo, 'Conteúdo da entrega');
    C.exigirTipoFormato(tipo, conteudo.formato);
    const nome = C.validarNome(conteudo.nome, conteudo.formato);
    return Object.assign({}, conteudo, { nome });
  }

  // ---------- Super Admin: criar e versionar manualmente ----------
  async function criar(ator, dados) {
    exigirAtor(ator);
    garantir(C.ESQUEMA_NOVA_ENTREGA, dados, 'Entrega');
    const conteudo = validarConteudo(dados.tipo, dados.conteudo);
    const preparado = arm.prepararConteudo(conteudo);
    const id = novoId('ent');
    let r;
    await banco.transacao(async (t) => {
      const exe = await lerExecucao(t, dados.execucaoId);
      let agenteId = dados.agenteId || null;
      if (dados.etapaId) {
        const etapa = (exe.etapas || []).find((x) => x.id === dados.etapaId);
        if (!etapa) throw erro('invalido', 'A etapa não existe nesta execução');
        if (agenteId && agenteId !== etapa.agenteId) throw erro('invalido', 'O agente não é o da etapa');
        agenteId = etapa.agenteId;
      } else if (agenteId && (!obterAgente(agenteId) || !agenteNaExecucao(exe, agenteId))) throw erro('invalido', 'O agente não faz parte desta execução');
      const agora = relogio();
      const entrega = {
        id, empresaId: exe.empresaId || null, execucaoId: exe.id, tarefaId: exe.id, etapaId: dados.etapaId || null, agenteId, tipo: dados.tipo,
        exigeAprovacao: true, versaoAprovada: null, aprovacao: null, criadoEm: agora, criadoPor: ator.uid, origem: 'super-admin', ultimaVersao: 0,
      };
      const g = await gravarVersao(t, entrega, { conteudo, preparado, origem: { tipo: 'super-admin' }, ator, estado: 'rascunho' });
      const doc = Object.assign({}, entrega, g.base);
      delete doc.id;
      await t.gravar(caminhos.entrega(id), doc);
      r = Object.assign({ id }, doc);
    });
    await ev('criada', ator, id, { tipo: dados.tipo, formato: conteudo.formato, versao: 1, tamanho: preparado.tamanho, hash: curto(preparado.hash), execucao: dados.execucaoId, origem: 'super-admin' });
    return r;
  }

  async function novaVersao(ator, entregaId, conteudoBruto, { versaoBase } = {}) {
    exigirAtor(ator);
    let r;
    await banco.transacao(async (t) => {
      const e = await lerEntrega(t, entregaId);
      if (versaoBase !== undefined && versaoBase !== e.ultimaVersao) throw erro('conflito', 'A entrega mudou: há uma versão mais nova', { motivo: 'versao-desatualizada', ultimaVersao: e.ultimaVersao });
      const conteudo = validarConteudo(e.tipo, conteudoBruto);
      const preparado = arm.prepararConteudo(conteudo);
      const g = await gravarVersao(t, e, { conteudo, preparado, origem: { tipo: 'super-admin', versaoBase: e.ultimaVersao }, ator, estado: 'rascunho' });
      await t.atualizar(caminhos.entrega(entregaId), g.base);
      r = { entregaId, versao: g.n, hash: g.versao.hash, estado: 'rascunho', versaoAprovada: e.versaoAprovada };
    });
    await ev('versao_criada', ator, entregaId, { versao: r.versao, hash: curto(r.hash), origem: 'super-admin' });
    return r;
  }

  // ---------- Motor: entrega da etapa, NA transação do executor (crachá já conferido) ----------
  // exe: a execução lida na transação (RUNNING, crachá certo). Nada vem do modelo além do texto.
  // Idempotente: a mesma etapa/tentativa (ou o mesmo conteúdo) não gera versão duplicada.
  async function registrarDaEtapa(t, { exe, etapa, tentativa, texto, final }) {
    if (exe.estado !== 'RUNNING' || FINAIS.includes(exe.estado)) throw erro('conflito', 'A execução não está em andamento', { motivo: 'execucao-parou' });
    if (!obterAgente(etapa.agenteId) || !agenteNaExecucao(exe, etapa.agenteId)) throw erro('permissao-negada', 'O agente não faz parte desta execução');
    const tipo = TIPO_DO_AGENTE[etapa.agenteId];
    const conteudo = { formato: 'texto', nome: `${etapa.id}.txt`, descricao: final ? 'Entrega consolidada da execução' : `Resultado da etapa ${etapa.id}`, texto };
    const preparado = arm.prepararConteudo(conteudo);
    const chave = `${etapa.id}:${tentativa}:${(etapa.revisoes || []).length}`;
    const id = idDaEtapa(exe.id, etapa.id);
    const atual = await t.obter(caminhos.entrega(id));
    const estado = final ? 'em-revisao' : 'rascunho';
    const origem = { tipo: 'etapa', etapaId: etapa.id, tentativa, chave };
    if (atual) {
      if (atual.execucaoId !== exe.id || atual.etapaId !== etapa.id || atual.agenteId !== etapa.agenteId) throw erro('isolamento', 'Entrega de outra execução, etapa ou agente');
      const ultima = await t.obter(caminhos.versaoEntrega(id, atual.ultimaVersao));
      if (ultima && (ultima.origem.chave === chave || ultima.hash === preparado.hash)) return { entregaId: id, versao: atual.ultimaVersao, hash: ultima.hash, nova: false, duplicada: true };
      const g = await gravarVersao(t, Object.assign({ id }, atual), { conteudo, preparado, origem, ator: ATOR_SISTEMA, estado });
      await t.atualizar(caminhos.entrega(id), g.base);
      return { entregaId: id, versao: g.n, hash: g.versao.hash, nova: true, tipo, tamanho: preparado.tamanho };
    }
    const agora = relogio();
    const entrega = {
      id, empresaId: exe.empresaId || null, execucaoId: exe.id, tarefaId: exe.id, etapaId: etapa.id, agenteId: etapa.agenteId, tipo,
      exigeAprovacao: true, versaoAprovada: null, aprovacao: null, criadoEm: agora, criadoPor: ATOR_SISTEMA.uid, origem: 'etapa', ultimaVersao: 0,
    };
    const g = await gravarVersao(t, entrega, { conteudo, preparado, origem, ator: ATOR_SISTEMA, estado });
    const doc = Object.assign({}, entrega, g.base);
    delete doc.id;
    await t.gravar(caminhos.entrega(id), doc);
    return { entregaId: id, versao: 1, hash: g.versao.hash, nova: true, tipo, tamanho: preparado.tamanho };
  }

  // ---------- Estados ----------
  // Enviar para revisão: Super Admin, ou o agente DONO da entrega (pelo motor/porta).
  async function enviarParaRevisao(ator, entregaId, n, { agenteId } = {}) {
    exigirAtorOuSistema(ator);
    await banco.transacao(async (t) => {
      const e = await lerEntrega(t, entregaId);
      if (ator === ATOR_SISTEMA && (!agenteId || agenteId !== e.agenteId)) throw erro('permissao-negada', 'Só o agente responsável propõe a revisão da entrega');
      if (n !== e.versaoAtual) throw erro('conflito', 'Só a versão atual vai para revisão', { motivo: 'versao-desatualizada', versaoAtual: e.versaoAtual });
      const v = await lerVersao(t, entregaId, n);
      if (!C.transicaoPermitida(v.estado, 'em-revisao')) throw erro('precondicao', `Uma versão ${v.estado} não vai para revisão`);
      const agora = relogio();
      await t.atualizar(caminhos.versaoEntrega(entregaId, n), { estado: 'em-revisao', enviadaEm: agora });
      await t.atualizar(caminhos.entrega(entregaId), { estadoAtual: 'em-revisao', atualizadoEm: agora, atualizadoPor: ator.uid });
    });
    await ev('enviada_para_revisao', ator, entregaId, { versao: n, por: ator === ATOR_SISTEMA ? 'agente' : 'super-admin' });
    return { entregaId, versao: n, estado: 'em-revisao' };
  }

  // Aprovar / rejeitar / pedir revisão: SÓ o Super Admin, na versão ATUAL e com o hash dela.
  async function decidir(ator, entregaId, dados) {
    exigirAtor(ator);
    garantir(ESQUEMA_DECISAO, dados, 'Decisão');
    if (dados.decisao !== 'aprovar' && !dados.motivo) throw erro('invalido', 'Rejeitar ou pedir revisão exige o motivo');
    const para = PARA[dados.decisao];
    let r;
    await banco.transacao(async (t) => {
      const e = await lerEntrega(t, entregaId);
      if (dados.versao !== e.versaoAtual) throw erro('conflito', 'Esta não é a versão atual: decida sobre a versão mais nova', { motivo: 'versao-desatualizada', versaoAtual: e.versaoAtual });
      const v = await lerVersao(t, entregaId, dados.versao);
      if (v.hash !== dados.hash) throw erro('conflito', 'O hash não confere com esta versão', { motivo: 'hash-diferente' });
      if (!C.transicaoPermitida(v.estado, para)) throw erro('precondicao', `Uma versão ${v.estado} não pode ser ${para}`);
      await arm.lerConteudo(t, v.conteudoRef, e.execucaoId); // integridade conferida ANTES de decidir
      const decisao = { tipo: para, por: ator.uid, em: relogio(), hash: v.hash, motivo: dados.motivo ? dados.motivo.trim() : null };
      await t.atualizar(caminhos.versaoEntrega(entregaId, dados.versao), { estado: para, decisao });
      const base = { estadoAtual: para, atualizadoEm: decisao.em, atualizadoPor: ator.uid };
      if (para === 'aprovada') Object.assign(base, { versaoAprovada: dados.versao, aprovacao: { versao: dados.versao, hash: v.hash, por: ator.uid, em: decisao.em } });
      await t.atualizar(caminhos.entrega(entregaId), base);
      r = { entregaId, versao: dados.versao, estado: para, hash: v.hash };
    }).catch(async (e) => {
      if (e.codigo === 'integridade') await ev('integridade_falhou', ator, entregaId, { versao: dados.versao });
      throw e;
    });
    await ev('decidida', ator, entregaId, { versao: dados.versao, decisao: para });
    return r;
  }

  // Recuperar uma versão anterior = versão NOVA com o mesmo conteúdo (sem herdar a aprovação).
  async function restaurar(ator, entregaId, n, motivo) {
    exigirAtor(ator);
    if (typeof motivo !== 'string' || motivo.trim().length < 3) throw erro('invalido', 'Restaurar exige o motivo');
    let r;
    await banco.transacao(async (t) => {
      const e = await lerEntrega(t, entregaId);
      const v = await lerVersao(t, entregaId, n);
      await arm.lerConteudo(t, v.conteudoRef, e.execucaoId); // só restaura conteúdo íntegro
      const conteudo = { formato: v.formato, nome: v.nome, descricao: v.descricao, arquivoReal: v.arquivoReal, metadados: v.metadados };
      const g = await gravarVersao(t, e, { conteudo, ref: v.conteudoRef, origem: { tipo: 'restauracao', deVersao: n, motivo: motivo.trim().slice(0, 300) }, ator, estado: 'rascunho' });
      await t.atualizar(caminhos.entrega(entregaId), g.base);
      r = { entregaId, versao: g.n, deVersao: n, hash: v.hash, estado: 'rascunho' };
    });
    await ev('restaurada', ator, entregaId, { versao: r.versao, deVersao: n });
    return r;
  }

  // ---------- Consultas (Super Admin) ----------
  async function obter(ator, entregaId) { exigirAtor(ator); return lerEntrega(banco, entregaId); }

  async function versoes(ator, entregaId, { depoisDe, limite } = {}) {
    exigirAtor(ator);
    await lerEntrega(banco, entregaId);
    const lim = Math.min(Math.max(1, limite || 50), PAGINA);
    const op = { ordenar: { campo: 'n', direcao: 'asc' }, limite: lim };
    if (depoisDe !== undefined && depoisDe !== null) op.depoisDe = String(depoisDe);
    const itens = await banco.consultar(caminhos.versoesEntrega(entregaId), op);
    return { itens, proximo: itens.length === lim ? String(itens[itens.length - 1].n) : null };
  }

  async function lerConteudoVersao(ator, entregaId, n) {
    exigirAtor(ator);
    const e = await lerEntrega(banco, entregaId);
    const v = await lerVersao(banco, entregaId, n);
    try {
      const c = await arm.lerConteudo(banco, v.conteudoRef, e.execucaoId);
      return Object.assign({ entregaId, versao: n, formato: v.formato, arquivoReal: v.arquivoReal }, c);
    } catch (er) {
      if (er.codigo === 'integridade') await ev('integridade_falhou', ator, entregaId, { versao: n });
      throw er;
    }
  }

  // Por empresa, execução, agente ou estado (ex.: "em-revisao" = aguardando aprovação).
  // Só igualdades + ordem por id; até 100 por página; cursor preso aos filtros.
  async function listar(ator, { empresaId, execucaoId, agenteId, estado, depoisDe, limite } = {}) {
    exigirAtor(ator);
    if (!empresaId && !execucaoId && !agenteId && !estado) throw erro('invalido', 'Informe empresa, execução, agente ou estado');
    const onde = [];
    if (empresaId) onde.push({ campo: 'empresaId', op: '==', valor: String(empresaId) });
    if (execucaoId) onde.push({ campo: 'execucaoId', op: '==', valor: String(execucaoId) });
    if (agenteId) onde.push({ campo: 'agenteId', op: '==', valor: String(agenteId) });
    if (estado) {
      if (!C.ESTADOS.includes(estado)) throw erro('invalido', 'Estado inválido');
      onde.push({ campo: 'estadoAtual', op: '==', valor: estado });
    }
    const lim = Math.min(Math.max(1, limite || PAGINA), PAGINA);
    const op = { onde, ordenar: { campo: 'id', direcao: 'asc' }, limite: lim, cursorMesmoFiltro: ['empresaId', 'execucaoId', 'agenteId', 'estadoAtual'] };
    if (depoisDe) op.depoisDe = depoisDe;
    const itens = await banco.consultar(caminhos.colecoes.entregas, op);
    return { itens, proximo: itens.length === lim ? itens[itens.length - 1].id : null };
  }

  // ---------- Porta do agente (uso interno; não sai pela API) ----------
  // Só as entregas da PRÓPRIA execução; ler confere o hash; propor revisão só das dele.
  function abrirParaAgente(agenteId, execucaoId) {
    const exigir = async () => {
      const exe = await lerExecucao(banco, execucaoId);
      if (FINAIS.includes(exe.estado)) throw erro('precondicao', 'Execução encerrada');
      if (!obterAgente(agenteId) || !agenteNaExecucao(exe, agenteId)) throw erro('permissao-negada', 'O agente não faz parte desta execução');
      return exe;
    };
    const daExecucao = async (entregaId) => {
      const exe = await exigir();
      const e = await lerEntrega(banco, entregaId);
      if (e.execucaoId !== exe.id || (e.empresaId || null) !== (exe.empresaId || null)) {
        await ev('acesso_negado', ATOR_SISTEMA, entregaId, { agente: agenteId, motivo: 'outra-execucao' });
        throw erro('isolamento', 'Entrega de outra execução ou de outro cliente');
      }
      return e;
    };
    return Object.freeze({
      agenteId, execucaoId,
      async listar() {
        await exigir();
        const itens = await banco.consultar(caminhos.colecoes.entregas, { onde: [{ campo: 'execucaoId', op: '==', valor: execucaoId }], ordenar: { campo: 'id', direcao: 'asc' }, limite: 50 });
        return itens.map((e) => ({ id: e.id, tipo: e.tipo, etapaId: e.etapaId, agenteId: e.agenteId, versaoAtual: e.versaoAtual, estadoAtual: e.estadoAtual }));
      },
      async ler(entregaId) {
        const e = await daExecucao(entregaId);
        const v = await lerVersao(banco, entregaId, e.versaoAtual);
        return Object.assign({ entregaId, versao: e.versaoAtual, formato: v.formato }, await arm.lerConteudo(banco, v.conteudoRef, e.execucaoId));
      },
      async proporRevisao(entregaId) {
        const e = await daExecucao(entregaId);
        return enviarParaRevisao(ATOR_SISTEMA, entregaId, e.versaoAtual, { agenteId });
      },
    });
  }

  return { criar, novaVersao, registrarDaEtapa, enviarParaRevisao, decidir, restaurar, obter, versoes, lerConteudo: lerConteudoVersao, listar, abrirParaAgente, idDaEtapa };
}

module.exports = { criarEntregas, idDaEtapa, TIPO_DO_AGENTE };
