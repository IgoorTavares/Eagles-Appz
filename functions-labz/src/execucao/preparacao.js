// Preparação do contexto de cada etapa de uma execução (Fase 3D). É o ponto
// de integração com a orquestração que JÁ existe (execuções persistentes);
// não executa agente nenhum: o trabalhador e os modelos chegam na Fase 4.
//  - prepararEtapa: monta, pelo Context Builder, o contexto de UM agente para
//    a etapa (empresa e tarefa vêm da execução; o agente precisa fazer parte dela);
//  - planejarContextos: o Estrategista (modo orquestrado) define quais agentes
//    participam e cada um recebe o SEU contexto, montado separadamente: nenhum
//    agente herda memória de agente de outro, nem de outra empresa;
//  - na execução fica gravado só o resumo (agente, ids/versões das fontes,
//    quando); a auditoria também não leva conteúdo.
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtorOuSistema } = require('../auth/super-admin');
const { relogioPadrao } = require('../nucleo/ids');
const { FINAIS } = require('../contratos/execucao');
const { obterAgente } = require('../agentes/catalogo');
const { agenteNaExecucao } = require('../agentes/memoria-agente');

const MAX_PREPARACOES = 50;
const ESQUEMA_ETAPA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    agenteId: { tipo: 'texto', obrigatorio: true, padrao: /^0[1-8]-[a-z-]+$/ },
    briefing: { tipo: 'texto', max: 20000 },
  },
};
const ESQUEMA_PLANO = { tipo: 'lista', obrigatorio: true, min: 1, max: 8, itens: ESQUEMA_ETAPA };

// deps: { banco, contexto, auditoria, relogio? }
function criarPreparacao({ banco, contexto, auditoria, relogio = relogioPadrao }) {
  async function lerAberta(execucaoId) {
    const exe = await banco.obter(caminhos.tarefa(execucaoId));
    if (!exe) throw erro('nao-encontrado', 'Execução não encontrada');
    if (FINAIS.includes(exe.estado)) throw erro('precondicao', `Execução ${exe.estado}: não recebe mais trabalho`);
    return exe;
  }

  async function prepararEtapa(ator, execucaoId, etapa) {
    exigirAtorOuSistema(ator);
    garantir(ESQUEMA_ETAPA, etapa, 'Etapa');
    const exe = await lerAberta(execucaoId);
    const agente = obterAgente(etapa.agenteId);
    if (!agente) throw erro('nao-encontrado', 'Agente desconhecido');
    if (!agenteNaExecucao(exe, etapa.agenteId)) throw erro('permissao-negada', `O agente ${agente.nome} não faz parte desta execução`);
    const ctx = await contexto.montar({
      agenteId: etapa.agenteId, empresaId: exe.empresaId || null, tarefaId: execucaoId,
      briefing: etapa.briefing !== undefined ? etapa.briefing : String(exe.objetivo || '').slice(0, 20000),
    }, ator);
    const resumo = { agenteId: etapa.agenteId, em: relogio(), por: ator.uid, fontes: ctx.fontes.map((f) => `${f.origem}:${f.escopo || '-'}:${f.id}@${f.versao}`), caracteres: ctx.caracteres };
    await banco.transacao(async (t) => {
      const atual = await t.obter(caminhos.tarefa(execucaoId));
      await t.atualizar(caminhos.tarefa(execucaoId), { preparacoes: (atual.preparacoes || []).concat([resumo]).slice(-MAX_PREPARACOES) });
    });
    await auditoria.registrar('execucao.contexto_preparado', ator, caminhos.tarefa(execucaoId), { agente: etapa.agenteId, fontes: resumo.fontes.length, caracteres: ctx.caracteres });
    return ctx;
  }

  return {
    prepararEtapa,

    // O Estrategista distribui: define os agentes do plano e monta um contexto
    // POR agente (cada um só com o que o contrato dele permite).
    async planejarContextos(ator, execucaoId, passos) {
      exigirAtorOuSistema(ator);
      garantir(ESQUEMA_PLANO, passos, 'Plano');
      const exe = await lerAberta(execucaoId);
      if (exe.modo !== 'orquestrado') throw erro('precondicao', 'Só execução orquestrada tem plano do Estrategista');
      const estrategista = obterAgente('08-estrategista');
      if (!estrategista.permissoes.podeDelegar) throw erro('permissao-negada', 'O Estrategista não pode delegar');
      const ids = passos.map((p) => p.agenteId);
      ids.forEach((id) => { if (!obterAgente(id)) throw erro('nao-encontrado', `Agente desconhecido: ${id}`); });
      if (new Set(ids).size !== ids.length) throw erro('invalido', 'Cada agente aparece uma vez no plano');
      await banco.transacao(async (t) => {
        await t.atualizar(caminhos.tarefa(execucaoId), { plano: { agentes: ids, definidoPor: ator.uid, definidoEm: relogio() } });
      });
      await auditoria.registrar('execucao.plano_definido', ator, caminhos.tarefa(execucaoId), { agentes: ids });
      const contextos = [];
      for (const p of passos) contextos.push({ agenteId: p.agenteId, contexto: await prepararEtapa(ator, execucaoId, p) });
      return contextos;
    },
  };
}

module.exports = { criarPreparacao, ESQUEMA_ETAPA };
