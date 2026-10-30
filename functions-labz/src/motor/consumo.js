// Fase 4B: controle de consumo ENTRE execuções (por dia, em UTC):
// limite global, por agente, por empresa (cliente) e por provedor.
// O limite de cada execução continua em motor/custos.js.
//
// Separação (nunca misturar):
//  - tokens: o que conta para os limites (uso informado pelo provedor; se não
//    veio, a ESTIMATIVA, marcada como estimada);
//  - custoEstimado: só existe com um PREÇO cadastrado pelo Super Admin
//    (labz_config/precos). NENHUM preço vem no código: não inventamos preços;
//  - custoDesconhecido: chamadas sem preço conhecido. NUNCA viram zero;
//  - custoConfirmado: só da fatura do provedor (não existe nesta fase: null);
//  - cobrancaReal: sempre false na Fase 4B (só simulação).
//
// Bloqueio PREVENTIVO: antes de cada chamada, reservar() confere todos os
// limites com (consumido + reservas em aberto + esta estimativa) numa
// transação; acima de qualquer limite, não chama. Se há limite de CUSTO e o
// preço é desconhecido, também não chama (não dá para garantir o limite).
// Depois da chamada, liquidar() troca a reserva pelo uso real.
// Reserva esquecida (processo caiu) vence sozinha (RESERVA_MS) e para de contar.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { TODOS_PROVEDORES, PROVEDOR_SIMULADO } = require('../ia/contrato');

const RESERVA_MS = 10 * 60 * 1000;
const PADRAO_LIMITES = Object.freeze({
  global: { tokensDia: 2000000, custoDia: null },
  porAgente: { tokensDia: null, custoDia: null },
  porEmpresa: { tokensDia: null, custoDia: null },
  porProvedor: { tokensDia: null, custoDia: null },
  excecoes: { agentes: {}, empresas: {}, provedores: {} },
});
const LIMITE = { tipo: 'objeto', extras: false, campos: { tokensDia: { tipo: 'inteiro', nulo: true, min: 1, max: 1e9 }, custoDia: { tipo: 'numero', nulo: true, min: 0, max: 1e7 } } };
const MAPA = { tipo: 'objeto' }; // chaves conferidas à parte
const ESQUEMA_LIMITES = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    global: LIMITE, porAgente: LIMITE, porEmpresa: LIMITE, porProvedor: LIMITE,
    excecoes: { tipo: 'objeto', extras: false, campos: { agentes: MAPA, empresas: MAPA, provedores: MAPA } },
  },
};
const PRECO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    entradaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    saidaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    moeda: { tipo: 'texto', obrigatorio: true, valores: ['USD', 'BRL'] },
    fonte: { tipo: 'texto', obrigatorio: true, min: 5, max: 300 }, // de onde o Super Admin tirou o preço
    conferidoEm: { tipo: 'texto', obrigatorio: true, padrao: /^\d{4}-\d{2}-\d{2}$/ },
  },
};
const CHAVE_PRECO = /^(openai|anthropic|google)\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SEG = /^[A-Za-z0-9_-]{1,80}$/;

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const vazioTotal = () => ({ tokens: 0, custo: 0, custoDesconhecido: 0, chamadas: 0, estimadas: 0 });

function criarConsumo({ banco, auditoria, relogio = relogioPadrao }) {
  const dia = () => relogio().slice(0, 10);
  const docDia = (d) => `${caminhos.colecoes.consumo}/${d}`;

  async function lerLimites(t) {
    const doc = await (t || banco).obter(caminhos.limitesConsumo());
    return Object.assign(JSON.parse(JSON.stringify(PADRAO_LIMITES)), doc ? doc.valor : {});
  }
  async function lerPrecos(t) {
    const doc = await (t || banco).obter(caminhos.precosModelos());
    return (doc && doc.itens) || {};
  }
  const limiteDe = (lim, secao, excecao, chave) => Object.assign({}, lim[secao], (lim.excecoes[excecao] || {})[chave] || {});

  // Preço de um provedor/modelo, ou null (desconhecido). O simulado não tem cobrança.
  function custoDe(precos, provedor, modelo, tokensEntrada, tokensSaida) {
    if (provedor === PROVEDOR_SIMULADO) return { tipo: 'sem-cobranca', valor: 0, moeda: null };
    const p = precos[`${provedor}/${modelo}`];
    if (!p) return { tipo: 'desconhecido', valor: null, moeda: null };
    return { tipo: 'estimado', valor: r6((tokensEntrada / 1e6) * p.entradaPorMilhao + (tokensSaida / 1e6) * p.saidaPorMilhao), moeda: p.moeda };
  }

  // Totais em aberto = consumido + reservas que ainda não venceram.
  function totais(doc, agoraMs) {
    const t = { global: Object.assign(vazioTotal(), doc.global), agentes: {}, empresas: {}, provedores: {} };
    ['agentes', 'empresas', 'provedores'].forEach((k) => Object.entries(doc[k] || {}).forEach(([c, v]) => { t[k][c] = Object.assign(vazioTotal(), v); }));
    Object.values(doc.reservas || {}).forEach((r) => {
      if (Date.parse(r.expiraEm) <= agoraMs) return;
      const soma = (x) => { x.tokens += r.tokens; x.custo = r6(x.custo + (r.custo || 0)); };
      soma(t.global);
      soma(t.agentes[r.agenteId] = t.agentes[r.agenteId] || vazioTotal());
      soma(t.empresas[r.empresa] = t.empresas[r.empresa] || vazioTotal());
      soma(t.provedores[r.provedor] = t.provedores[r.provedor] || vazioTotal());
    });
    return t;
  }

  return {
    PADRAO_LIMITES,

    // pedido: { execucaoId, etapaId, agenteId, empresaId, provedor, modelo, tokensEntrada, tokensSaida }
    // → { permitido: true, reservaId, custo } | { permitido: false, motivo, secao, chave, consumo, limite, estimativa }
    async reservar(p) {
      const tokens = p.tokensEntrada + p.tokensSaida;
      const empresa = p.empresaId || 'sem-empresa';
      let r;
      await banco.transacao(async (t) => {
        const d = dia();
        const agoraMs = Date.parse(relogio());
        const doc = (await t.obter(docDia(d))) || {};
        const lim = await lerLimites(t);
        const precos = await lerPrecos(t);
        const custo = custoDe(precos, p.provedor, p.modelo, p.tokensEntrada, p.tokensSaida);
        const tot = totais(doc, agoraMs);
        const checagens = [
          ['global', 'global', tot.global, lim.global],
          ['agente', p.agenteId, tot.agentes[p.agenteId] || vazioTotal(), limiteDe(lim, 'porAgente', 'agentes', p.agenteId)],
          ['empresa', empresa, tot.empresas[empresa] || vazioTotal(), limiteDe(lim, 'porEmpresa', 'empresas', empresa)],
          ['provedor', p.provedor, tot.provedores[p.provedor] || vazioTotal(), limiteDe(lim, 'porProvedor', 'provedores', p.provedor)],
        ];
        for (const [secao, chave, atual, l] of checagens) {
          if (l.tokensDia !== null && l.tokensDia !== undefined && atual.tokens + tokens > l.tokensDia) { r = { permitido: false, motivo: `limite-diario-de-tokens-${secao}`, secao, chave, consumo: atual.tokens, estimativa: tokens, limite: l.tokensDia }; return; }
          if (l.custoDia !== null && l.custoDia !== undefined) {
            if (custo.tipo === 'desconhecido') { r = { permitido: false, motivo: `custo-desconhecido-com-limite-${secao}`, secao, chave, limite: l.custoDia }; return; }
            if (atual.custo + custo.valor > l.custoDia) { r = { permitido: false, motivo: `limite-diario-de-custo-${secao}`, secao, chave, consumo: atual.custo, estimativa: custo.valor, limite: l.custoDia }; return; }
          }
        }
        const reservaId = novoId('rsv');
        const reservas = {};
        Object.entries(doc.reservas || {}).forEach(([k, v]) => { if (Date.parse(v.expiraEm) > agoraMs) reservas[k] = v; }); // limpa as vencidas
        reservas[reservaId] = { tokens, custo: custo.valor || 0, agenteId: p.agenteId, empresa, provedor: p.provedor, execucaoId: p.execucaoId, expiraEm: new Date(agoraMs + RESERVA_MS).toISOString() };
        await t.gravar(docDia(d), Object.assign({}, doc, { reservas, dia: d }));
        r = { permitido: true, reservaId, dia: d, custo };
      });
      if (!r.permitido) await auditoria.registrar('custo.bloqueio_preventivo', null, caminhos.tarefa(p.execucaoId), { motivo: r.motivo, secao: r.secao, etapa: p.etapaId || null });
      return r;
    },

    // Troca a reserva pelo uso real. uso: { tokensEntrada, tokensSaida, fonte } | null (chamada não aconteceu)
    // → { custo: { tipo, valor, moeda }, tokens }
    async liquidar(reserva, p, uso) {
      let out;
      await banco.transacao(async (t) => {
        const doc = (await t.obter(docDia(reserva.dia))) || {};
        const reservas = Object.assign({}, doc.reservas || {});
        const rs = reservas[reserva.reservaId];
        delete reservas[reserva.reservaId];
        const novo = Object.assign({}, doc, { reservas, dia: reserva.dia });
        if (uso) {
          const precos = await lerPrecos(t);
          const custo = custoDe(precos, p.provedor, p.modelo, uso.tokensEntrada, uso.tokensSaida);
          const tokens = uso.tokensEntrada + uso.tokensSaida;
          const empresa = p.empresaId || 'sem-empresa';
          const soma = (x) => {
            const v = Object.assign(vazioTotal(), x);
            v.tokens += tokens; v.chamadas += 1;
            if (uso.fonte === 'estimado') v.estimadas += 1;
            if (custo.tipo === 'desconhecido') v.custoDesconhecido += 1; else v.custo = r6(v.custo + custo.valor);
            return v;
          };
          novo.global = soma(doc.global);
          novo.agentes = Object.assign({}, doc.agentes, { [p.agenteId]: soma((doc.agentes || {})[p.agenteId]) });
          novo.empresas = Object.assign({}, doc.empresas, { [empresa]: soma((doc.empresas || {})[empresa]) });
          novo.provedores = Object.assign({}, doc.provedores, { [p.provedor]: soma((doc.provedores || {})[p.provedor]) });
          out = { custo, tokens, reservaExistia: !!rs };
        } else out = { custo: null, tokens: 0, reservaExistia: !!rs };
        await t.gravar(docDia(reserva.dia), novo);
      });
      return out;
    },

    async limites(ator) { exigirAtor(ator); return lerLimites(); },

    async definirLimites(ator, valor) {
      exigirAtor(ator);
      garantir(ESQUEMA_LIMITES, valor, 'Limites de consumo');
      const ex = valor.excecoes || {};
      const chaves = { agentes: /^0[1-8]-[a-z-]+$/, empresas: SEG, provedores: null };
      Object.entries(ex).forEach(([k, mapa]) => Object.entries(mapa || {}).forEach(([c, l]) => {
        if (k === 'provedores' ? !TODOS_PROVEDORES.includes(c) : !chaves[k].test(c)) throw erro('invalido', `Exceção de limite com chave inválida: ${k}.${c}`);
        garantir(LIMITE, l, `Exceção ${k}.${c}`);
      }));
      await banco.gravar(caminhos.limitesConsumo(), { valor, atualizadoEm: relogio(), atualizadoPor: ator.uid });
      await auditoria.registrar('custo.limites_definidos', ator, caminhos.limitesConsumo(), { secoes: Object.keys(valor) });
      return lerLimites();
    },

    // Preços SÓ do Super Admin, com a fonte. Sem preço = custo desconhecido.
    async definirPreco(ator, chave, preco) {
      exigirAtor(ator);
      if (!CHAVE_PRECO.test(String(chave))) throw erro('invalido', 'Chave de preço inválida (use provedor/modelo)');
      garantir(PRECO, preco, 'Preço');
      await banco.transacao(async (t) => {
        const doc = (await t.obter(caminhos.precosModelos())) || { itens: {} };
        const itens = Object.assign({}, doc.itens, { [chave]: Object.assign({}, preco, { definidoPor: ator.uid, definidoEm: relogio() }) });
        await t.gravar(caminhos.precosModelos(), { itens });
      });
      await auditoria.registrar('custo.preco_definido', ator, caminhos.precosModelos(), { chave });
      return { chave, preco };
    },

    async doDia(ator, d) {
      exigirAtor(ator);
      const alvo = d || dia();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo)) throw erro('invalido', 'Dia inválido (AAAA-MM-DD)');
      const doc = (await banco.obter(docDia(alvo))) || {};
      const tot = totais(doc, Date.parse(relogio()));
      const reservasAbertas = Object.values(doc.reservas || {}).filter((r) => Date.parse(r.expiraEm) > Date.parse(relogio())).length;
      return { dia: alvo, global: Object.assign(vazioTotal(), doc.global), agentes: doc.agentes || {}, empresas: doc.empresas || {}, provedores: doc.provedores || {}, emAberto: tot.global, reservasAbertas, custoConfirmado: null, cobrancaReal: false };
    },
  };
}

module.exports = { criarConsumo, PADRAO_LIMITES, RESERVA_MS, ESQUEMA_LIMITES };
