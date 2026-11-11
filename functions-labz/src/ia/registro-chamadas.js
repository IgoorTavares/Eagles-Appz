// R1 (plano, seções 6.2, 13.4 e 13.7): REGISTRO das chamadas a provedores que cobram.
// Para cada etapa (e para o planejamento) há um documento com a lista das chamadas pagas:
//   labz_tarefas/{execucao}/labz_chamadas/{etapa} = { chamadas: [{ n, chave, estado, ... }] }
// A chave única de cada chamada é "execucao:etapa:n". Ela é gravada ANTES de chamar o provedor.
// Estados: em-andamento → concluida | invalida (respondeu, mas a resposta não serviu) |
//          erro (o provedor recusou o pedido com um corpo de erro: sem cobrança) |
//          desconhecido (sem resposta: pode ter sido processada e cobrada).
// Regras:
//  - uma chamada "em-andamento" que ficou para trás (o worker caiu depois de enviar) ou
//    "desconhecido" BLOQUEIA nova chamada daquela etapa, até o Super Admin decidir (retomar);
//  - no máximo MAX_CHAMADAS_PAGAS por etapa (1 + 2 repetições), contando todas.
// Só metadados (provedor, modelo, estado, tipo do erro, tokens, request-id); nunca texto.
const { caminhos } = require('../armazenamento/caminhos');
const { relogioPadrao } = require('../nucleo/ids');

const MAX_CHAMADAS_PAGAS = 3;
const PENDENTES = ['em-andamento', 'desconhecido'];

function criarRegistroChamadas({ banco, relogio = relogioPadrao }) {
  const caminho = (execId, etapaId) => caminhos.chamadasEtapa(execId, etapaId);
  const aberta = (c) => PENDENTES.includes(c.estado) && !c.liberadaEm;

  return {
    MAX_CHAMADAS_PAGAS,

    // Antes de chamar: grava "em-andamento" com a chave única, ou devolve o bloqueio.
    // reserva: { dia, reservaId, tokens, custo } (para contar o custo provável se o worker cair)
    async abrir({ execucaoId, etapaId, agenteId, provedor, modelo, reserva }) {
      let r;
      await banco.transacao(async (t) => {
        const doc = (await t.obter(caminho(execucaoId, etapaId))) || { chamadas: [] };
        const lista = Array.isArray(doc.chamadas) ? doc.chamadas : [];
        const pendente = lista.find(aberta);
        if (pendente) { r = { bloqueio: 'resultado-desconhecido', chamada: { n: pendente.n, estado: pendente.estado, chave: pendente.chave, reserva: pendente.reserva || null } }; return; }
        const pagas = lista.filter((c) => !c.liberadaEm).length; // a decisão do Super Admin (retomar) zera a contagem
        if (pagas >= MAX_CHAMADAS_PAGAS) { r = { bloqueio: 'limite-de-chamadas-pagas', feitas: pagas, limite: MAX_CHAMADAS_PAGAS }; return; }
        const n = lista.length + 1;
        const chave = `${execucaoId}:${etapaId}:${n}`;
        const nova = { n, chave, estado: 'em-andamento', agenteId, provedor, modelo, inicio: relogio(), reserva: reserva ? { dia: reserva.dia, reservaId: reserva.reservaId, tokens: reserva.tokens || 0, custo: reserva.custo || null } : null };
        await t.gravar(caminho(execucaoId, etapaId), { execucaoId, etapaId, chamadas: lista.concat([nova]) });
        r = { n, chave };
      });
      return r;
    },

    // Depois da chamada: fecha a chamada n com o estado e os metadados (sem texto).
    async fechar({ execucaoId, etapaId, n }, estado, extras = {}) {
      await banco.transacao(async (t) => {
        const doc = await t.obter(caminho(execucaoId, etapaId));
        if (!doc || !Array.isArray(doc.chamadas)) return;
        const chamadas = doc.chamadas.map((c) => (c.n === n ? Object.assign({}, c, {
          estado, fim: relogio(), tipoErro: extras.tipoErro || null, tokens: Number.isInteger(extras.tokens) ? extras.tokens : null,
          requestId: extras.requestId ? String(extras.requestId).slice(0, 80) : null, custo: extras.custo || null,
        }) : c));
        await t.gravar(caminho(execucaoId, etapaId), Object.assign({}, doc, { chamadas }));
      });
    },

    // O Super Admin decidiu (retomar): as chamadas desconhecidas daquelas etapas deixam de bloquear e a
    // contagem de chamadas pagas da etapa recomeça. O custo provável continua contado (nada é apagado).
    async liberar(execucaoId, etapaIds, ator) {
      let liberadas = 0;
      for (const etapaId of etapaIds) {
        await banco.transacao(async (t) => {
          const doc = await t.obter(caminho(execucaoId, etapaId));
          if (!doc || !Array.isArray(doc.chamadas) || !doc.chamadas.some((c) => !c.liberadaEm)) return;
          const quem = ator && ator.uid ? ator.uid : null;
          const chamadas = doc.chamadas.map((c) => {
            if (c.liberadaEm) return c;
            if (aberta(c)) { liberadas += 1; return Object.assign({}, c, { estado: 'desconhecido', liberadaEm: relogio(), liberadaPor: quem }); }
            return Object.assign({}, c, { liberadaEm: relogio(), liberadaPor: quem });
          });
          await t.gravar(caminho(execucaoId, etapaId), Object.assign({}, doc, { chamadas }));
        });
      }
      return liberadas;
    },

    async listar(execucaoId, etapaId) {
      const doc = await banco.obter(caminho(execucaoId, etapaId));
      return doc && Array.isArray(doc.chamadas) ? doc.chamadas : [];
    },
  };
}

// Resultado DESCONHECIDO: o pedido saiu e não houve resposta do provedor (nada de corpo de erro).
// Tempo esgotado, queda de conexão, cancelamento no meio, fluxo cortado ou processo caído.
const resultadoDesconhecido = (e) => !!(e && (e.interrupcao || ((e.tipo === 'timeout' || e.tipo === 'indisponivel' || e.tipo === 'cancelado') && !e.comCorpo)));

module.exports = { criarRegistroChamadas, resultadoDesconhecido, MAX_CHAMADAS_PAGAS };
