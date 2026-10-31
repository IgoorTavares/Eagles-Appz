// Fase 4C.2 (passo 5): RELATÓRIO de uma tarefa (execução) para o Super Admin.
// Monta tudo a partir do que já existe: a execução (plano, etapas, histórico,
// custos, diagnóstico, invalidações, retomada), o Registro de Entregas (entregas,
// versões, insumos, decisões) e os pedidos de aprovação de ações. Não é outro
// sistema de auditoria: não grava nada e não lê a trilha de eventos.
// SEM conteúdo: nada de objetivo, briefing, texto de documento, prompt ou credencial.
// Só ids, tipos, versões, hashes, estados, motivos e números.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { erro } = require('../nucleo/erros');
const { CONSUMO } = require('../contratos/documentos');

const LIMITE_ENTREGAS = 100;
const LIMITE_APROVACOES = 50;
const MOTIVOS_FALHA = /falh|interromp|tentativa|bloque|revis|limite|cancel|retomad|dependencia|integridade|qualidade/i;

function criarRelatorios({ banco }) {
  return {
    async daTarefa(ator, execucaoId) {
      exigirAtor(ator);
      const exe = await banco.obter(caminhos.tarefa(execucaoId));
      if (!exe) throw erro('nao-encontrado', 'Execução não encontrada');
      const etapas = exe.etapas || [];
      const ents = await banco.consultar(caminhos.colecoes.entregas, { onde: [{ campo: 'execucaoId', op: '==', valor: execucaoId }], ordenar: { campo: 'id', direcao: 'asc' }, limite: LIMITE_ENTREGAS });
      const documentos = [];
      for (const e of ents) {
        const v = await banco.obter(caminhos.versaoEntrega(e.id, e.versaoAtual));
        documentos.push({
          entregaId: e.id, etapaId: e.etapaId, agenteId: e.agenteId, documento: e.documento || null, tipo: e.tipo,
          versaoAtual: e.versaoAtual, versaoAprovada: e.versaoAprovada || null, estado: e.estadoAtual, hash: e.hashAtual,
          sensivel: !!(e.documento && CONSUMO[e.documento] && CONSUMO[e.documento].sensivel),
          insumos: (v && v.insumos ? v.insumos : []).map((i) => ({ entregaId: i.entregaId, versao: i.versao, hash: i.hash, etapaProdutora: i.etapaProdutora, autorizacao: i.autorizacao })),
          decisao: v && v.decisao ? { tipo: v.decisao.tipo, por: v.decisao.por, em: v.decisao.em, tipoAprovacao: v.decisao.tipoAprovacao || null } : null,
        });
      }
      const pedidos = await banco.consultar(caminhos.aprovacoesExecucao(execucaoId), { ordenar: { campo: 'id', direcao: 'asc' }, limite: LIMITE_APROVACOES });
      const acoes = pedidos.map((p) => ({ aprovacaoId: p.id, etapaId: p.etapaId, ferramentaId: p.ferramentaId, operacao: p.operacao, risco: p.risco || null, situacao: p.status, decisao: p.decisao ? { por: p.decisao.por, em: p.decisao.em } : null }));
      const historico = exe.historico || [];
      const falhas = historico.filter((h) => h.motivo && MOTIVOS_FALHA.test(h.motivo)).map((h) => ({ de: h.de, para: h.para, em: h.em, motivo: String(h.motivo).slice(0, 120) }));
      const consolidada = documentos.find((d) => d.documento === 'consolidacao-final') || documentos.find((d) => d.etapaId === 'consolidacao') || null;
      const c = exe.custos || {};
      return {
        tarefaId: execucaoId, empresaId: exe.empresaId || null,
        tipoProjeto: { modo: exe.modo, comDocumentos: etapas.some((x) => x.documento), documentos: [...new Set(etapas.map((x) => x.documento).filter(Boolean))] },
        agentes: (exe.plano && exe.plano.agentes) || [...new Set(etapas.map((x) => x.agenteId))],
        etapasPlanejadas: etapas.map((x) => ({ id: x.id, agenteId: x.agenteId, documento: x.documento || null, dependeDe: x.dependeDe })),
        etapasExecutadas: etapas.filter((x) => x.status === 'concluida').map((x) => ({ id: x.id, tentativas: x.tentativas, revisoes: (x.revisoes || []).length, entrega: x.resultado && x.resultado.entrega ? x.resultado.entrega : null })),
        documentos,
        dependencias: etapas.flatMap((x) => (x.dependeDe || []).map((d) => ({ de: d, para: x.id }))),
        aprovacoes: {
          pendentes: [
            ...documentos.filter((d) => ['rascunho', 'em-revisao'].includes(d.estado) && (d.sensivel || d.documento === 'consolidacao-final')).map((d) => ({ tipo: 'entrega', entregaId: d.entregaId, versao: d.versaoAtual, documento: d.documento })),
            ...acoes.filter((a) => a.situacao === 'pendente').map((a) => ({ tipo: 'acao', aprovacaoId: a.aprovacaoId, ferramentaId: a.ferramentaId, risco: a.risco ? a.risco.nivel : null })),
          ],
          concedidas: [
            ...documentos.filter((d) => d.versaoAprovada).map((d) => ({ tipo: 'entrega', entregaId: d.entregaId, versao: d.versaoAprovada })),
            ...acoes.filter((a) => a.situacao === 'aprovada').map((a) => ({ tipo: 'acao', aprovacaoId: a.aprovacaoId, ferramentaId: a.ferramentaId })),
          ],
          rejeicoes: [
            ...documentos.filter((d) => ['rejeitada', 'precisa-revisao'].includes(d.estado)).map((d) => ({ tipo: 'entrega', entregaId: d.entregaId, versao: d.versaoAtual, estado: d.estado })),
            ...acoes.filter((a) => a.situacao === 'recusada').map((a) => ({ tipo: 'acao', aprovacaoId: a.aprovacaoId, ferramentaId: a.ferramentaId })),
          ],
          acoes,
        },
        revisoes: { internas: exe.revisoesInternas || 0, porEtapa: etapas.filter((x) => (x.revisoes || []).length).map((x) => ({ etapa: x.id, quantidade: x.revisoes.length, motivos: x.revisoes.map((r) => String(r.motivo).slice(0, 60)) })) },
        estado: exe.estado, diagnostico: exe.diagnostico ? { motivo: exe.diagnostico.motivo, etapa: exe.diagnostico.etapa || null, dependencia: exe.diagnostico.dependencia || null } : null,
        consumo: { tokens: c.tokens || 0, custoSimulado: c.custoSimulado || 0, unidade: c.unidade || null, custoDesconhecido: c.custoDesconhecido || 0, custoEstimado: c.custoEstimado || null, custoConfirmado: null, cobrancaReal: false, porAgente: c.porAgente || {} },
        falhasERecuperacoes: { transicoes: falhas, invalidacoes: (exe.invalidacoes || []).map((i) => ({ entregaId: i.entregaId, versao: i.versao, dependentes: i.dependentes, decisao: i.decisao })), retomada: exe.retomada || null },
        entregaConsolidada: consolidada ? { entregaId: consolidada.entregaId, versao: consolidada.versaoAtual, hash: consolidada.hash, estado: consolidada.estado, insumos: consolidada.insumos.length } : null,
        limites: { entregas: LIMITE_ENTREGAS, aprovacoes: LIMITE_APROVACOES },
      };
    },
  };
}

module.exports = { criarRelatorios };
