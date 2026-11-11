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
// R1: provedores que COBRAM nesta fase (os da lista fechada do transporte real). Sem preço cadastrado,
// a chamada não sai (plano, seção 6.1: "sem preço cadastrado ou sem saldo, não chama").
const PROVEDORES_COBRADOS = Object.freeze(['anthropic']);
const PADRAO_LIMITES = Object.freeze({
  global: { tokensDia: 2000000, custoDia: null },
  // R1 (D2: US$ 10/mês na conta do provedor): limite do MÊS (UTC), só global. Proposta: custoMes 9.
  mensal: { tokensMes: null, custoMes: null },
  porAgente: { tokensDia: null, custoDia: null },
  porEmpresa: { tokensDia: null, custoDia: null },
  porProvedor: { tokensDia: null, custoDia: null },
  excecoes: { agentes: {}, empresas: {}, provedores: {} },
});
const LIMITE = { tipo: 'objeto', extras: false, campos: { tokensDia: { tipo: 'inteiro', nulo: true, min: 1, max: 1e9 }, custoDia: { tipo: 'numero', nulo: true, min: 0, max: 1e7 } } };
const MAPA = { tipo: 'objeto' }; // chaves conferidas à parte
const LIMITE_MES = { tipo: 'objeto', extras: false, campos: { tokensMes: { tipo: 'inteiro', nulo: true, min: 1, max: 1e10 }, custoMes: { tipo: 'numero', nulo: true, min: 0, max: 1e8 } } };
const ESQUEMA_LIMITES = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    global: LIMITE, mensal: LIMITE_MES, porAgente: LIMITE, porEmpresa: LIMITE, porProvedor: LIMITE,
    excecoes: { tipo: 'objeto', extras: false, campos: { agentes: MAPA, empresas: MAPA, provedores: MAPA } },
  },
};
// R1: preço de cache (gravação e leitura) e faixa de pedido longo (ex.: Haiku acima de 100 mil tokens)
const FAIXA = {
  tipo: 'objeto', extras: false,
  campos: {
    acimaDeTokens: { tipo: 'inteiro', obrigatorio: true, min: 1, max: 1e8 },
    entradaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    saidaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    cacheEscritaPorMilhao: { tipo: 'numero', min: 0, max: 100000 },
    cacheLeituraPorMilhao: { tipo: 'numero', min: 0, max: 100000 },
  },
};
const PRECO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    entradaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    saidaPorMilhao: { tipo: 'numero', obrigatorio: true, min: 0, max: 100000 },
    cacheEscritaPorMilhao: { tipo: 'numero', min: 0, max: 100000 },
    cacheLeituraPorMilhao: { tipo: 'numero', min: 0, max: 100000 },
    longo: FAIXA,
    moeda: { tipo: 'texto', obrigatorio: true, valores: ['USD', 'BRL'] },
    fonte: { tipo: 'texto', obrigatorio: true, min: 5, max: 300 }, // de onde o Super Admin tirou o preço
    conferidoEm: { tipo: 'texto', obrigatorio: true, padrao: /^\d{4}-\d{2}-\d{2}$/ },
  },
};
const CHAVE_PRECO = /^(openai|anthropic|google)\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SEG = /^[A-Za-z0-9_-]{1,80}$/;

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const PRECO_VENCE_DIAS = 30; // R1: preço conferido há mais de 30 dias gera aviso (não bloqueia)

// Faixa de preço que vale para um pedido com "promptTokens" de entrada (entrada + cache).
function faixaDe(p, promptTokens) {
  return p.longo && promptTokens > p.longo.acimaDeTokens ? Object.assign({}, p, p.longo) : p;
}
// Custo REAL de um uso informado (cada tipo de token com o seu preço). Sem preço de cache e com
// tokens de cache → desconhecido (não inventa: a gravação de cache custa MAIS que a entrada).
function custoDoUso(p, uso) {
  const ce = uso.cacheEscrita || 0;
  const cl = uso.cacheLeitura || 0;
  const f = faixaDe(p, uso.tokensEntrada + ce + cl);
  if ((ce && f.cacheEscritaPorMilhao === undefined) || (cl && f.cacheLeituraPorMilhao === undefined)) return null;
  return r6((uso.tokensEntrada / 1e6) * f.entradaPorMilhao + (ce / 1e6) * (f.cacheEscritaPorMilhao || 0) + (cl / 1e6) * (f.cacheLeituraPorMilhao || 0) + (uso.tokensSaida / 1e6) * f.saidaPorMilhao);
}
// Custo MÁXIMO de uma chamada (para a reserva): toda a entrada pelo preço mais alto possível
// (gravação de cache, se for mais cara) e a saída inteira até o teto (max_tokens, que o provedor
// não ultrapassa). Com a entrada CONTADA pela API, é um teto real, não um palpite.
function custoMaximo(p, tokensEntrada, tokensSaida) {
  const f = faixaDe(p, tokensEntrada);
  const precoEntrada = Math.max(f.entradaPorMilhao, f.cacheEscritaPorMilhao || 0);
  return r6((tokensEntrada / 1e6) * precoEntrada + (tokensSaida / 1e6) * f.saidaPorMilhao);
}
const tokensDoUso = (uso) => uso.tokensEntrada + uso.tokensSaida + (uso.cacheEscrita || 0) + (uso.cacheLeitura || 0);
const vazioTotal = () => ({ tokens: 0, custo: 0, custoDesconhecido: 0, chamadas: 0, estimadas: 0, provaveis: 0 });

function criarConsumo({ banco, auditoria, relogio = relogioPadrao }) {
  const dia = () => relogio().slice(0, 10);
  const docDia = (d) => `${caminhos.colecoes.consumo}/${d}`;
  // R1: totais do mês (UTC) num documento à parte: labz_consumo/mes-AAAA-MM
  const docMes = (d) => `${caminhos.colecoes.consumo}/mes-${d.slice(0, 7)}`;
  async function somarMes(t, d, soma) {
    const m = (await t.obter(docMes(d))) || {};
    await t.gravar(docMes(d), Object.assign({}, m, { mes: d.slice(0, 7), global: soma(m.global) }));
  }

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
  //  modo 'maximo': o teto da chamada (reserva); modo 'uso': o custo do uso informado (liquidação).
  function custoDe(precos, provedor, modelo, tokensEntrada, tokensSaida, { modo = 'maximo', uso = null } = {}) {
    if (provedor === PROVEDOR_SIMULADO) return { tipo: 'sem-cobranca', valor: 0, moeda: null };
    const p = precos[`${provedor}/${modelo}`];
    if (!p) return { tipo: 'desconhecido', valor: null, moeda: null };
    const valor = modo === 'uso' ? custoDoUso(p, uso || { tokensEntrada, tokensSaida }) : custoMaximo(p, tokensEntrada, tokensSaida);
    if (valor === null) return { tipo: 'desconhecido', valor: null, moeda: null };
    return { tipo: 'estimado', valor, moeda: p.moeda };
  }
  // R1: preço conferido há mais de 30 dias → aviso (a conferência é refeita antes de ligar um agente)
  function precoVencido(precos, provedor, modelo) {
    const p = precos[`${provedor}/${modelo}`];
    if (!p || !p.conferidoEm) return false;
    return Date.parse(relogio()) - Date.parse(`${p.conferidoEm}T00:00:00Z`) > PRECO_VENCE_DIAS * 24 * 3600 * 1000;
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
        if (PROVEDORES_COBRADOS.includes(p.provedor) && custo.tipo === 'desconhecido') { r = { permitido: false, motivo: 'preco-nao-cadastrado', secao: 'provedor', chave: p.provedor }; return; }
        // mês: consumido no mês + reservas em aberto de hoje + esta chamada
        const mes = (await t.obter(docMes(d))) || {};
        const totMes = Object.assign(vazioTotal(), mes.global);
        const lm = lim.mensal || {};
        const abertoHoje = { tokens: tot.global.tokens - Object.assign(vazioTotal(), doc.global).tokens, custo: r6(tot.global.custo - Object.assign(vazioTotal(), doc.global).custo) };
        if (lm.tokensMes !== null && lm.tokensMes !== undefined && totMes.tokens + abertoHoje.tokens + tokens > lm.tokensMes) { r = { permitido: false, motivo: 'limite-mensal-de-tokens', secao: 'mensal', chave: d.slice(0, 7), consumo: totMes.tokens, estimativa: tokens, limite: lm.tokensMes }; return; }
        if (lm.custoMes !== null && lm.custoMes !== undefined) {
          if (custo.tipo === 'desconhecido') { r = { permitido: false, motivo: 'custo-desconhecido-com-limite-mensal', secao: 'mensal', chave: d.slice(0, 7), limite: lm.custoMes }; return; }
          if (totMes.custo + abertoHoje.custo + custo.valor > lm.custoMes) { r = { permitido: false, motivo: 'limite-mensal-de-custo', secao: 'mensal', chave: d.slice(0, 7), consumo: totMes.custo, estimativa: custo.valor, limite: lm.custoMes }; return; }
        }
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
        r = { permitido: true, reservaId, dia: d, custo, tokens, avisos: precoVencido(precos, p.provedor, p.modelo) ? ['preco-vencido'] : [] };
      });
      if (!r.permitido) await auditoria.registrar('custo.bloqueio_preventivo', null, caminhos.tarefa(p.execucaoId), { motivo: r.motivo, secao: r.secao, etapa: p.etapaId || null });
      else if (r.avisos.length) await auditoria.registrar('custo.preco_vencido', null, caminhos.tarefa(p.execucaoId), { provedor: p.provedor, modelo: String(p.modelo).slice(0, 60) });
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
          const custo = custoDe(precos, p.provedor, p.modelo, uso.tokensEntrada, uso.tokensSaida, { modo: 'uso', uso });
          const tokens = tokensDoUso(uso);
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
          await somarMes(t, reserva.dia, soma);
          out = { custo, tokens, reservaExistia: !!rs };
        } else out = { custo: null, tokens: 0, reservaExistia: !!rs };
        await t.gravar(docDia(reserva.dia), novo);
      });
      return out;
    },

    // R1 (plano, seção 13.4): resultado DESCONHECIDO (tempo esgotado, queda de conexão, fluxo
    // interrompido, worker caiu depois de enviar): a chamada pode ter sido processada e cobrada.
    // Conta a RESERVA INTEIRA (o máximo possível) como "custo provável"; se veio uso parcial,
    // vale o maior dos dois. Nunca vira zero. Ajuste só pelo número do painel do provedor.
    async liquidarDesconhecido(reserva, p, usoParcial) {
      let out;
      await banco.transacao(async (t) => {
        const doc = (await t.obter(docDia(reserva.dia))) || {};
        const reservas = Object.assign({}, doc.reservas || {});
        const rs = reservas[reserva.reservaId];
        delete reservas[reserva.reservaId];
        const precos = await lerPrecos(t);
        const tokensReserva = rs ? rs.tokens : (reserva.tokens || 0);
        const custoReserva = rs ? (rs.custo || 0) : ((reserva.custo && reserva.custo.valor) || 0);
        const parcial = usoParcial ? custoDe(precos, p.provedor, p.modelo, usoParcial.tokensEntrada, usoParcial.tokensSaida, { modo: 'uso', uso: usoParcial }) : null;
        const tokens = Math.max(tokensReserva, usoParcial ? tokensDoUso(usoParcial) : 0);
        const custoValor = Math.max(custoReserva, parcial && parcial.valor !== null ? parcial.valor : 0);
        const conhecido = !!precos[`${p.provedor}/${p.modelo}`] || p.provedor === PROVEDOR_SIMULADO;
        const empresa = p.empresaId || 'sem-empresa';
        const soma = (x) => {
          const v = Object.assign(vazioTotal(), x);
          v.tokens += tokens; v.chamadas += 1; v.provaveis += 1;
          if (!conhecido) v.custoDesconhecido += 1; else v.custo = r6(v.custo + custoValor);
          return v;
        };
        const novo = Object.assign({}, doc, { reservas, dia: reserva.dia });
        novo.global = soma(doc.global);
        novo.agentes = Object.assign({}, doc.agentes, { [p.agenteId]: soma((doc.agentes || {})[p.agenteId]) });
        novo.empresas = Object.assign({}, doc.empresas, { [empresa]: soma((doc.empresas || {})[empresa]) });
        novo.provedores = Object.assign({}, doc.provedores, { [p.provedor]: soma((doc.provedores || {})[p.provedor]) });
        await t.gravar(docDia(reserva.dia), novo);
        await somarMes(t, reserva.dia, soma);
        out = { custo: { tipo: conhecido ? 'provavel' : 'desconhecido', valor: conhecido ? custoValor : null, moeda: conhecido && precos[`${p.provedor}/${p.modelo}`] ? precos[`${p.provedor}/${p.modelo}`].moeda : null }, tokens, reservaExistia: !!rs };
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
      // R1: a Anthropic grava cache em toda chamada (instruções fixas): sem o preço do cache, o custo não fecha
      if (String(chave).startsWith('anthropic/') && (preco.cacheEscritaPorMilhao === undefined || preco.cacheLeituraPorMilhao === undefined)) throw erro('invalido', 'Preço da Anthropic precisa dos preços de cache (gravação e leitura)');
      await banco.transacao(async (t) => {
        const doc = (await t.obter(caminhos.precosModelos())) || { itens: {} };
        const itens = Object.assign({}, doc.itens, { [chave]: Object.assign({}, preco, { definidoPor: ator.uid, definidoEm: relogio() }) });
        await t.gravar(caminhos.precosModelos(), { itens });
      });
      await auditoria.registrar('custo.preco_definido', ator, caminhos.precosModelos(), { chave });
      return { chave, preco };
    },

    // R1: totais do mês (AAAA-MM; padrão: o mês atual, UTC)
    async doMes(ator, m) {
      exigirAtor(ator);
      const alvo = m || dia().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(alvo)) throw erro('invalido', 'Mês inválido (AAAA-MM)');
      const doc = (await banco.obter(`${caminhos.colecoes.consumo}/mes-${alvo}`)) || {};
      return { mes: alvo, global: Object.assign(vazioTotal(), doc.global), custoConfirmado: null, cobrancaReal: false };
    },

    async doDia(ator, d) {
      exigirAtor(ator);
      const alvo = d || dia();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo)) throw erro('invalido', 'Dia inválido (AAAA-MM-DD)');
      const doc = (await banco.obter(docDia(alvo))) || {};
      const tot = totais(doc, Date.parse(relogio()));
      const reservasAbertas = Object.values(doc.reservas || {}).filter((r) => Date.parse(r.expiraEm) > Date.parse(relogio())).length;
      const mes = (await banco.obter(docMes(alvo))) || {};
      return { dia: alvo, mes: { mes: alvo.slice(0, 7), global: Object.assign(vazioTotal(), mes.global) }, global: Object.assign(vazioTotal(), doc.global), agentes: doc.agentes || {}, empresas: doc.empresas || {}, provedores: doc.provedores || {}, emAberto: tot.global, reservasAbertas, custoConfirmado: null, cobrancaReal: false };
    },
  };
}

module.exports = { criarConsumo, PADRAO_LIMITES, PROVEDORES_COBRADOS, RESERVA_MS, ESQUEMA_LIMITES, PRECO_VENCE_DIAS, custoMaximo, custoDoUso };
