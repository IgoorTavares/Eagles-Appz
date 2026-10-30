// Approval Manager das AÇÕES (Fase 4A). Quando um agente propõe uma ação que
// exige decisão humana (ex.: publicar), a etapa espera um pedido de aprovação:
//  - fica em labz_tarefas/{execucao}/labz_aprovacoes/{id}, dentro da execução;
//  - o id e a ASSINATURA prendem o pedido à execução, à etapa, ao agente, à ação
//    exata (ferramenta, operação e parâmetros) e à tentativa da etapa: se a
//    etapa roda de novo e a ação muda, o pedido antigo fica desatualizado;
//  - só o Super Admin decide (exigirAtor recusa o ATOR_SISTEMA e qualquer agente);
//  - a recusa impede a ação; nada externo é executado nem depois de aprovado (4A);
//  - toda decisão vai para a auditoria (sem os parâmetros da ação).
const crypto = require('node:crypto');
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { relogioPadrao } = require('../nucleo/ids');
const { hashAcao } = require('./ferramentas-simuladas');

const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x), 'utf8').digest('hex');
const ESQUEMA_DECISAO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    decisao: { tipo: 'texto', obrigatorio: true, valores: ['aprovar', 'recusar'] },
    assinatura: { tipo: 'texto', obrigatorio: true, padrao: /^[0-9a-f]{64}$/ },
    justificativa: { tipo: 'texto', obrigatorio: true, min: 3, max: 500 },
  },
};

function criarAprovacoes({ banco, auditoria, relogio = relogioPadrao }) {
  // Cria (ou reaproveita) o pedido de aprovação de uma ação. t: transação aberta.
  async function solicitar(t, execucaoId, etapa, acao) {
    const h = hashAcao(acao);
    const id = `apv_${etapa.id}_${etapa.tentativas}_${h.slice(0, 12)}`;
    const caminho = caminhos.aprovacaoExecucao(execucaoId, id);
    const existente = await t.obter(caminho);
    if (existente) return Object.assign({ id }, existente);
    const pedido = {
      execucaoId, etapaId: etapa.id, agenteId: etapa.agenteId, tentativaEtapa: etapa.tentativas,
      ferramentaId: acao.ferramentaId, operacao: acao.operacao, acaoHash: h,
      assinatura: sha({ execucaoId, etapaId: etapa.id, agenteId: etapa.agenteId, tentativa: etapa.tentativas, acao: h }),
      status: 'pendente', criadoEm: relogio(), decisao: null,
    };
    await t.gravar(caminho, pedido);
    return Object.assign({ id }, pedido);
  }

  return {
    solicitar,

    async pendentes(ator, execucaoId) {
      exigirAtor(ator);
      return banco.consultar(caminhos.aprovacoesExecucao(execucaoId), { onde: [{ campo: 'status', op: '==', valor: 'pendente' }], ordenar: { campo: 'id', direcao: 'asc' }, limite: 20 });
    },

    // Só o Super Admin. A assinatura tem de ser a do pedido ATUAL da etapa.
    // Devolve { pedido, restantes } (restantes = pedidos ainda pendentes da etapa).
    async decidir(ator, execucaoId, aprovacaoId, dados) {
      exigirAtor(ator);
      garantir(ESQUEMA_DECISAO, dados, 'Decisão');
      let resultado;
      await banco.transacao(async (t) => {
        const exe = await t.obter(caminhos.tarefa(execucaoId));
        if (!exe) throw erro('nao-encontrado', 'Execução não encontrada');
        const p = await t.obter(caminhos.aprovacaoExecucao(execucaoId, aprovacaoId));
        if (!p) throw erro('nao-encontrado', 'Pedido de aprovação não encontrado');
        if (p.status !== 'pendente') throw erro('precondicao', `Pedido já ${p.status}`);
        if (p.assinatura !== dados.assinatura) throw erro('conflito', 'Assinatura não confere com este pedido', { motivo: 'assinatura-invalida' });
        const etapa = (exe.etapas || []).find((e) => e.id === p.etapaId);
        if (!etapa || etapa.status !== 'aguardando_aprovacao' || !etapa.aprovacoes.includes(aprovacaoId) || etapa.tentativas !== p.tentativaEtapa) {
          throw erro('conflito', 'Este pedido ficou desatualizado: a etapa mudou depois dele', { motivo: 'aprovacao-desatualizada' });
        }
        const decisao = { por: ator.uid, em: relogio(), motivo: dados.justificativa.trim() };
        await t.atualizar(caminhos.aprovacaoExecucao(execucaoId, aprovacaoId), { status: dados.decisao === 'aprovar' ? 'aprovada' : 'recusada', decisao });
        resultado = { pedido: Object.assign({ id: aprovacaoId }, p, { status: dados.decisao === 'aprovar' ? 'aprovada' : 'recusada', decisao }), etapa, exe };
      }).catch(async (e) => {
        if (e.detalhes && e.detalhes.motivo === 'aprovacao-desatualizada') await auditoria.registrar('execucao.aprovacao_desatualizada', ator, caminhos.tarefa(execucaoId), { aprovacao: aprovacaoId });
        throw e;
      });
      await auditoria.registrar('execucao.aprovacao_decidida', ator, caminhos.tarefa(execucaoId), { aprovacao: aprovacaoId, etapa: resultado.pedido.etapaId, ferramenta: resultado.pedido.ferramentaId, decisao: dados.decisao });
      const outras = [];
      for (const id of resultado.etapa.aprovacoes) {
        if (id === aprovacaoId) continue;
        const o = await banco.obter(caminhos.aprovacaoExecucao(execucaoId, id));
        if (o && o.status === 'pendente') outras.push(id);
      }
      return { pedido: resultado.pedido, restantes: outras };
    },
  };
}

module.exports = { criarAprovacoes };
