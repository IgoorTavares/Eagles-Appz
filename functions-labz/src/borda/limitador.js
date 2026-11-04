// LABZ AI — Fase S3: LIMITE DE PEDIDOS por usuário na API (labz-api), guardado no próprio banco
// (vale para todas as instâncias da Edge Function ao mesmo tempo, porque é uma transação).
//   - porMinuto: pedidos de qualquer ação por UID a cada minuto;
//   - tarefasPorHora: pedidos que CRIAM execução (custam mais) por UID a cada hora.
// Os limites de CONSUMO (tokens/custo por dia, agente, empresa e provedor) continuam os de sempre.
const { erro } = require('../nucleo/erros');
const { relogioPadrao } = require('../nucleo/ids');

const ACOES_DE_TAREFA = ['execucoes.pedido', 'execucoes.criar'];
const PADRAO = { porMinuto: 60, tarefasPorHora: 20 };
const RE_UID = /^[A-Za-z0-9_-]{1,128}$/;

function criarLimitador({ banco, relogio = relogioPadrao, limites = {} } = {}) {
  const cfg = Object.assign({}, PADRAO, limites);
  return {
    limites: Object.freeze(Object.assign({}, cfg)),
    async verificar(uid, acao) {
      if (!RE_UID.test(String(uid || ''))) throw erro('nao-autenticado', 'Login inválido.');
      const agora = relogio();
      const minuto = agora.slice(0, 16); // AAAA-MM-DDTHH:MM
      const hora = agora.slice(0, 13); // AAAA-MM-DDTHH
      const tarefa = ACOES_DE_TAREFA.includes(acao);
      await banco.transacao(async (t) => {
        const c = `labz_limites/${uid}`;
        const d = (await t.obter(c)) || {};
        const nMin = d.minuto === minuto ? d.nMinuto || 0 : 0;
        const nHora = d.hora === hora ? d.nTarefasHora || 0 : 0;
        if (nMin + 1 > cfg.porMinuto) throw erro('limite-excedido', 'Muitos pedidos em pouco tempo. Espere um minuto.');
        if (tarefa && nHora + 1 > cfg.tarefasPorHora) throw erro('limite-excedido', 'Limite de tarefas novas por hora atingido.');
        await t.gravar(c, { minuto, nMinuto: nMin + 1, hora, nTarefasHora: nHora + (tarefa ? 1 : 0), atualizadoEm: agora });
      });
    },
  };
}

module.exports = { criarLimitador, ACOES_DE_TAREFA };
