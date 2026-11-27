/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — Market Engine (Etapa 06)
   Funções PURAS (sem tela, sem banco): rodam no navegador (window.INVEST.mercado)
   e no Node (require), para os testes.
   - Um ADAPTADOR independente por provedor, todos com o mesmo contrato.
   - Normalização: toda cotação sai no mesmo formato, com FONTE, HORÁRIO e ESTADO.
   - Estados: tempo-real · atrasado · fechamento · manual · simulado · indisponível.
   - Nenhum provedor externo está ligado: os que exigem chave, licença ou servidor
     ficam DESLIGADOS (D-06 / D-10) e respondem "indisponível". Nada de rede aqui.
   - O SIMULADOR gera números FICTÍCIOS e determinísticos para demonstração; tudo o
     que ele devolve sai com estado "simulado" e nunca é apresentado como real.
   - Dado de mercado NUNCA é gravado por empresa: o cache é só em memória (e, no
     futuro, um cache GLOBAL gravado apenas pelo servidor: inv_mercado/{id}).
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.mercado = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ---------- estados do dado (ordem = confiabilidade, do maior para o menor) ----------
  const ESTADOS = {
    'tempo-real': { rotulo: 'Tempo real', real: true },
    atrasado: { rotulo: 'Atrasado', real: true },
    fechamento: { rotulo: 'Fechamento', real: true },
    historico: { rotulo: 'Histórico', real: true },
    desatualizado: { rotulo: 'Desatualizado', real: true }, // dado real, mas mais velho que o prazo da série (Etapa 11)
    manual: { rotulo: 'Manual', real: false },
    simulado: { rotulo: 'Demonstração (simulado)', real: false },
    indisponivel: { rotulo: 'Indisponível', real: false },
  };

  // ---------- índices e indicadores acompanhados ----------
  // Os NOMES são fatos públicos; os VALORES só vêm de um provedor (hoje, só do simulador).
  // base = ordem de grandeza usada SÓ pelo simulador (fictício).
  const I = (pais, codigo, nome, grupo, base, vol) => ({ assetId: `${pais}:INDICE:${codigo}`, pais, bolsa: 'INDICE', ticker: codigo, nome, classe: 'indice', moeda: pais === 'BR' ? 'BRL' : 'USD', setor: 'Índice', segmento: grupo, _base: base, _vol: vol || 0.012 });
  const INDICES = {
    BR: [
      I('BR', 'IBOV', 'Ibovespa', 'Amplo', 128000), I('BR', 'IBXX', 'IBrX 100', 'Amplo', 54000), I('BR', 'IFIX', 'IFIX — Fundos imobiliários', 'Imobiliário', 3300, 0.006),
      I('BR', 'SMLL', 'Small Caps (SMLL)', 'Small caps', 2100, 0.015), I('BR', 'IDIV', 'Dividendos (IDIV)', 'Dividendos', 9100),
      I('BR', 'IFNC', 'Financeiro (IFNC)', 'Setorial', 11500), I('BR', 'IMAT', 'Materiais básicos (IMAT)', 'Setorial', 5200, 0.016),
      I('BR', 'IEEX', 'Energia elétrica (IEE)', 'Setorial', 98000, 0.009), I('BR', 'ICON', 'Consumo (ICON)', 'Setorial', 4300, 0.014),
      I('BR', 'IMOB', 'Imobiliário (IMOB)', 'Setorial', 900, 0.018), I('BR', 'UTIL', 'Utilidade pública (UTIL)', 'Setorial', 10500, 0.010),
    ],
    US: [
      I('US', 'SPX', 'S&P 500', 'Amplo', 5400, 0.010), I('US', 'IXIC', 'Nasdaq Composite', 'Amplo', 17200, 0.013), I('US', 'NDX', 'Nasdaq 100', 'Amplo', 19100, 0.013),
      I('US', 'DJI', 'Dow Jones Industrial Average', 'Amplo', 40100, 0.009), I('US', 'RUT', 'Russell 2000', 'Small caps', 2150, 0.015),
      I('US', 'S5INFT', 'S&P 500 — Tecnologia', 'Setorial', 4300, 0.015), I('US', 'S5FINL', 'S&P 500 — Financeiro', 'Setorial', 720, 0.011),
      I('US', 'S5HLTH', 'S&P 500 — Saúde', 'Setorial', 1650, 0.009), I('US', 'S5ENRS', 'S&P 500 — Energia', 'Setorial', 690, 0.015),
      I('US', 'S5COND', 'S&P 500 — Consumo discricionário', 'Setorial', 1500, 0.013), I('US', 'S5INDU', 'S&P 500 — Indústria', 'Setorial', 1100, 0.011),
      I('US', 'S5UTIL', 'S&P 500 — Utilidades', 'Setorial', 380, 0.009), I('US', 'S5RLST', 'S&P 500 — Imobiliário', 'Setorial', 260, 0.012),
    ],
  };
  // indicadores econômicos (valor em % a.a., % em 12 meses ou cotação); unidade diz como mostrar
  const X = (pais, codigo, nome, unidade, base, vol, grupo) => ({ assetId: `${pais}:MACRO:${codigo}`, pais, bolsa: 'MACRO', ticker: codigo, nome, classe: 'macro', unidade, moeda: unidade === 'BRL' ? 'BRL' : unidade === 'USD' ? 'USD' : '', setor: 'Indicador econômico', segmento: grupo, _base: base, _vol: vol, _macro: true });
  const MACRO = {
    BR: [
      X('BR', 'SELIC', 'Taxa Selic (meta)', '%aa', 14.25, 0, 'Juros'), X('BR', 'CDI', 'CDI', '%aa', 14.15, 0, 'Juros'),
      X('BR', 'IPCA12M', 'IPCA — 12 meses', '%', 4.6, 0.02, 'Inflação'), X('BR', 'USDBRL', 'Dólar comercial (USD/BRL)', 'BRL', 5.45, 0.008, 'Câmbio'),
      X('BR', 'EURBRL', 'Euro (EUR/BRL)', 'BRL', 6.05, 0.008, 'Câmbio'),
      // Etapa 11: séries reais do Banco Central (SGS)
      X('BR', 'SELICEF', 'Taxa Selic efetiva (base 252)', '%aa', 14.15, 0, 'Juros'), X('BR', 'IPCA', 'IPCA — variação no mês', '%am', 0.4, 0.05, 'Inflação'),
      X('BR', 'IGPM', 'IGP-M — variação no mês', '%am', 0.5, 0.05, 'Inflação'), X('BR', 'DESEMPREGO', 'Taxa de desocupação (PNAD)', '%', 6, 0.01, 'Atividade'),
      X('BR', 'PIBMENSAL', 'PIB mensal — valores correntes (R$ milhões)', 'BRL_MI', 1100000, 0.01, 'Atividade'),
    ],
    US: [
      X('US', 'FEDFUNDS', 'Fed Funds — taxa efetiva', '%aa', 4.50, 0, 'Juros'), X('US', 'CPI12M', 'Inflação ao consumidor (CPI) — 12 meses', '%', 2.9, 0.02, 'Inflação'),
      X('US', 'CORECPI12M', 'Núcleo do CPI — 12 meses', '%', 2.8, 0.02, 'Inflação'), X('US', 'PCE12M', 'Consumo das famílias (PCE) — 12 meses', '%', 5, 0.02, 'Atividade'),
      X('US', 'UNRATE', 'Taxa de desemprego', '%', 4.1, 0.01, 'Emprego'), X('US', 'PAYROLL', 'Empregos criados no mês (payroll)', 'MIL', 150, 0.2, 'Emprego'),
      X('US', 'GDPREAL', 'PIB real — trimestre anualizado', '%', 2, 0.05, 'Atividade'), X('US', 'INDPRO12M', 'Produção industrial — 12 meses', '%', 1, 0.05, 'Atividade'),
      X('US', 'RENDA12M', 'Renda disponível real — 12 meses', '%', 1.5, 0.05, 'Atividade'), X('US', 'HOUST', 'Novas moradias iniciadas (anualizado)', 'MIL', 1300, 0.02, 'Atividade'),
      X('US', 'M212M', 'Oferta monetária M2 — 12 meses', '%', 4, 0.02, 'Juros'),
      X('US', 'UST2Y', 'Treasury 2 anos (taxa)', '%aa', 4.1, 0.015, 'Treasuries'), X('US', 'UST10Y', 'Treasury 10 anos (taxa)', '%aa', 4.3, 0.012, 'Treasuries'),
      X('US', 'UST30Y', 'Treasury 30 anos (taxa)', '%aa', 4.6, 0.010, 'Treasuries'),
      X('US', 'UST3M', 'Treasury 3 meses (taxa)', '%aa', 4.3, 0.010, 'Treasuries'), X('US', 'UST5Y', 'Treasury 5 anos (taxa)', '%aa', 4.2, 0.012, 'Treasuries'),
    ],
  };

  // ---------- provedores (Etapa 06: só o simulador e o manual estão ligados) ----------
  // cachePermitidoSeg: quanto tempo a licença permite guardar (0 = não guardar). credencial: exige chave (só no servidor).
  const PROVEDORES = {
    servidor: { nome: 'EAGLES DATA ENGINE — cache global no servidor (inv_mercado)', estado: 'atrasado', mercados: ['BR', 'US'], credencial: false, servidor: true, licenca: 'Depende do provedor contratado pelo servidor', ligado: false, motivo: 'Depende do servidor (D-10)', cachePermitidoSeg: 900 },
    b3: { nome: 'B3 — market data', estado: 'atrasado', mercados: ['BR'], credencial: true, servidor: true, licenca: 'Política comercial de market data da B3 (D-06)', ligado: false, motivo: 'Licença por escrito pendente (D-06)', cachePermitidoSeg: 0 },
    // Etapa 11: dados REAIS aprovados (ODbL), lidos pelo carregador de inv-dados.js; ligados quando o retrato existe
    bcb: { nome: 'Banco Central do Brasil — SGS e PTAX (Selic, CDI, IPCA, câmbio)', estado: 'fechamento', mercados: ['BR'], credencial: false, servidor: false, licenca: 'ODbL (dados abertos do Banco Central) — atribuição obrigatória', ligado: false, motivo: 'Liga quando os dados do Banco Central carregam', cachePermitidoSeg: 3600 },
    tesouro: { nome: 'Tesouro Transparente — preços e taxas do Tesouro Direto', estado: 'fechamento', mercados: ['BR'], credencial: false, servidor: false, licenca: 'ODbL (Tesouro Transparente) — atribuição obrigatória', ligado: false, motivo: 'Liga quando o arquivo de preços do Tesouro carrega', cachePermitidoSeg: 3600 },
    ust: { nome: 'U.S. Department of the Treasury — curva diária de juros', estado: 'fechamento', mercados: ['US'], credencial: false, servidor: false, licenca: 'Obra do governo federal dos EUA (17 U.S.C. §105) — citar a fonte', ligado: false, motivo: 'Liga quando a curva do Tesouro dos EUA carrega', cachePermitidoSeg: 3600 },
    fred: { nome: 'FRED (St. Louis Fed) — juros, inflação e Treasuries', estado: 'fechamento', mercados: ['US'], credencial: true, servidor: true, licenca: 'Termos do FRED; chave gratuita só no servidor', ligado: false, motivo: 'Chave só no servidor (D-10)', cachePermitidoSeg: 86400 },
    eua: { nome: 'Provedor de cotações dos EUA (a escolher)', estado: 'atrasado', mercados: ['US'], credencial: true, servidor: true, licenca: 'Plano e licença a contratar (orçamento atual R$ 0)', ligado: false, motivo: 'Sem provedor contratado (D-10)', cachePermitidoSeg: 0 },
    // v160: cota OFICIAL de fundos abertos (CVM Informe Diário, D-1), lida do eagles-dados; nunca "tempo real"
    fundos: { nome: 'CVM — cota oficial de fundos abertos (Informe Diário)', estado: 'fechamento', mercados: ['BR'], credencial: false, servidor: false, licenca: 'ODbL (dados abertos da CVM) — atribuição obrigatória', ligado: false, motivo: 'Liga quando o índice de fundos do eagles-dados carrega', cachePermitidoSeg: 3600 },
    manual: { nome: 'Preço informado pela empresa', estado: 'manual', mercados: ['BR', 'US'], credencial: false, servidor: false, licenca: 'Cadastro interno da empresa', ligado: true, cachePermitidoSeg: 0 },
    simulador: { nome: 'Simulador de demonstração (números fictícios)', estado: 'simulado', mercados: ['BR', 'US', 'CRYPTO'], credencial: false, servidor: false, licenca: 'Sem valor real', ligado: true, cachePermitidoSeg: 86400 },
  };
  const ORDEM = ['servidor', 'b3', 'bcb', 'tesouro', 'fundos', 'ust', 'fred', 'eua', 'manual', 'simulador'];

  // ---------- utilidades numéricas ----------
  const r2 = (n) => Math.round(n * 100) / 100;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  function semente(s) { return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (txt) => { let h = 2166136261; for (const ch of String(txt)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const normal = (rnd) => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const isoUTC = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  // pregões (seg–sex) entre duas datas AAAA-MM-DD (feriados não são considerados no simulador)
  function diasUteis(ini, fim) {
    const out = []; const d = new Date(ini + 'T12:00:00Z'); const f = new Date(fim + 'T12:00:00Z');
    while (d <= f) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(isoUTC(d)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  const PERIODOS = { '1M': 21, '3M': 63, '6M': 126, 'YTD': 'ytd', '1A': 252, '2A': 504, '5A': 1260, 'MAX': Infinity };

  // ---------- SIMULADOR (adaptador "simulador") ----------
  // Série diária determinística por ativo desde INICIO até a data de referência: o passado NÃO muda de um dia para o outro.
  const INICIO = '2021-01-04';
  const ANCORA = '2026-11-20'; // data fixa em que o simulador encosta na ordem de grandeza de referência
  function criarSimulador(op = {}) {
    const dataRef = op.dataRef; // AAAA-MM-DD (data local de "hoje")
    const dias = diasUteis(INICIO, dataRef);
    const cache = new Map();
    const baseDe = (a) => {
      if (a._base) return a._base;
      const h = hash(a.assetId);
      if (a.classe === 'fii') return 6 + (h % 15000) / 100;        // 6 a 156
      if (a.classe === 'tesouro') return 900 + (h % 1400000) / 100; // PU fictício
      if (a.classe === 'bdr') return 20 + (h % 9000) / 100;
      if (a.pais === 'US') return 15 + (h % 40000) / 100;
      return 4 + (h % 9600) / 100;                                 // ações BR: 4 a 100
    };
    const volDe = (a) => (a._vol != null ? a._vol : a.classe === 'fii' ? 0.008 : a.classe === 'tesouro' ? 0.002 : 0.018 + (hash(a.assetId + 'v') % 120) / 10000);
    function serie(a) {
      if (cache.has(a.assetId)) return cache.get(a.assetId);
      const rnd = semente(hash(a.assetId + '|serie'));
      const vol = volDe(a); const deriva = ((hash(a.assetId + 'd') % 60) - 25) / 1e5; // leve tendência por ativo
      let preco = baseDe(a) * (0.7 + rnd() * 0.5);
      const volBase = a.classe === 'indice' || a._macro ? 0 : Math.round(2e5 + (hash(a.assetId + 'q') % 5000) * 400);
      const out = new Array(dias.length);
      for (let i = 0; i < dias.length; i++) {
        let ab, fe, mx, mn;
        if (a._macro && !a._vol) { // juros de referência: degraus raros (reuniões), sem ruído diário
          if (i % 30 === 0 && i) preco = Math.max(0.25, preco + (rnd() < 0.5 ? -0.25 : 0.25) * (rnd() < 0.5 ? 1 : 0));
          ab = fe = mx = mn = preco;
        } else {
          const ret = deriva + vol * normal(rnd);
          ab = preco * (1 + vol * 0.3 * normal(rnd));
          fe = Math.max(0.01, preco * Math.exp(ret));
          mx = Math.max(ab, fe) * (1 + Math.abs(vol * 0.5 * normal(rnd)));
          mn = Math.min(ab, fe) * (1 - Math.abs(vol * 0.5 * normal(rnd)));
          preco = fe;
        }
        const casas = a._macro ? 4 : 2; const arr = casas === 4 ? r4 : r2;
        out[i] = { data: dias[i], abertura: arr(ab), maxima: arr(mx), minima: arr(mn), fechamento: arr(fe), volume: volBase ? Math.round(volBase * Math.exp(0.45 * normal(rnd))) : 0 };
      }
      if (a._macro && !a._vol) { const alvo = a._base; const fim = out[out.length - 1].fechamento; const d = alvo - fim; out.forEach((p) => { p.abertura = p.fechamento = p.maxima = p.minima = r4(Math.max(0.25, p.fechamento + d)); }); }
      else if (out.length) { // ancora o fechamento de uma DATA FIXA (o passado não muda de um dia para o outro) perto da ordem de grandeza de referência (evita números absurdos depois de anos de passeio aleatório)
        const alvo = baseDe(a) * (a._base ? 1 : 0.85 + (hash(a.assetId + 'a') % 30) / 100); const ia = out.findIndex((p) => p.data >= ANCORA); const f = alvo / out[ia >= 0 ? ia : out.length - 1].fechamento; const arr = a._macro ? r4 : r2;
        out.forEach((p) => { p.abertura = arr(p.abertura * f); p.maxima = arr(p.maxima * f); p.minima = arr(p.minima * f); p.fechamento = arr(p.fechamento * f); });
      }
      cache.set(a.assetId, out);
      return out;
    }
    return {
      id: 'simulador',
      cotacao(a) {
        const s = serie(a); if (!s.length) return null;
        const u = s[s.length - 1], p = s[s.length - 2] || u;
        return { preco: u.fechamento, abertura: u.abertura, maxima: u.maxima, minima: u.minima, volume: u.volume, fechamentoAnterior: p.fechamento, data: u.data, horario: `${u.data}T18:00:00` };
      },
      historico(a) { return serie(a); },
    };
  }

  // ---------- adaptador "manual": preços que a empresa informou ----------
  // precos: { assetId: { preco, data:'AAAA-MM-DD', moeda } } (vem de tenants/{t}/inv_precos/manual, 1 leitura)
  function criarManual(precos) {
    return {
      id: 'manual',
      cotacao(a) { const p = precos && precos[a.assetId]; if (!p || !(p.preco > 0)) return null; return { preco: +p.preco, data: p.data, horario: `${p.data}T00:00:00` }; },
      historico() { return null; }, // preço manual não tem histórico
    };
  }

  // ---------- adaptador "servidor" (contrato do cache GLOBAL; desligado até o D-10) ----------
  // Lê inv_mercado/{assetId com ":" trocado por "_"}; quem grava é SÓ o servidor (regra: write false).
  function idCacheGlobal(assetId) { return String(assetId).replace(/:/g, '_').replace(/[^A-Z0-9_.\-]/gi, ''); }
  function normalizarDoServidor(doc) {
    if (!doc || !(doc.preco > 0) || !ESTADOS[doc.estado] || !doc.fonte || !doc.horario) return null; // incompleto = descartado
    return { preco: +doc.preco, abertura: doc.abertura, maxima: doc.maxima, minima: doc.minima, volume: doc.volume, fechamentoAnterior: doc.fechamentoAnterior, data: String(doc.horario).slice(0, 10), horario: doc.horario, estado: doc.estado, fonteOriginal: doc.fonte };
  }

  // ---------- normalização (formato único de cotação) ----------
  function normalizar(a, bruto, provedorId) {
    const P = PROVEDORES[provedorId] || {};
    const estado = bruto.estado && ESTADOS[bruto.estado] ? bruto.estado : P.estado;
    const ant = bruto.fechamentoAnterior;
    const variacao = ant > 0 ? bruto.preco - ant : null;
    return {
      assetId: a.assetId, ticker: a.ticker, nome: a.nome, classe: a.classe, pais: a.pais, moeda: a.moeda || '', unidade: a.unidade || '',
      preco: bruto.preco, abertura: bruto.abertura ?? null, maxima: bruto.maxima ?? null, minima: bruto.minima ?? null, volume: bruto.volume ?? null,
      fechamentoAnterior: ant ?? null, variacao: variacao == null ? null : r4(variacao), variacaoPct: variacao == null ? null : r4((variacao / ant) * 100),
      data: bruto.data, horario: bruto.horario, estado, fonte: provedorId, fonteNome: P.nome || provedorId, real: !!(ESTADOS[estado] || {}).real,
      tipoPreco: bruto.tipoPreco || null, detalhe: bruto.detalhe || null, precoDec: bruto.precoDec || null, // v160: cota de fundo em texto decimal (até 12 casas) // Tesouro: qual PU é o preço (venda = resgate bruto; base = referência)
    };
  }
  const indisponivel = (a, motivo) => ({ assetId: a.assetId, ticker: a.ticker, nome: a.nome, classe: a.classe, pais: a.pais, moeda: a.moeda || '', preco: null, estado: 'indisponivel', fonte: null, real: false, motivo: motivo || 'Sem fonte autorizada para este ativo.' });

  // ---------- o MOTOR: escolhe o provedor, guarda em cache (memória), mede o uso e trata falhas ----------
  // op: { adaptadores: {id: adaptador}, ligados: {id: bool}, simulador: bool, limites: {id: chamadasPorDia}, agora: () => ms }
  function criarMotor(op = {}) {
    const ad = op.adaptadores || {};
    const agora = op.agora || (() => Date.now());
    const cache = new Map(); // chave → { ate, valor }
    const uso = {}; const falhas = {};
    const limites = Object.assign({ servidor: 2000, b3: 0, bcb: 2000, tesouro: 5000, fundos: 20000, ust: 2000, fred: 200, eua: 0 }, op.limites || {}); // bcb/tesouro/ust leem do retrato em memória (sem rede por consulta)
    const ligado = (id) => {
      const P = PROVEDORES[id]; if (!P || !ad[id]) return false;
      if (id === 'simulador') return op.simulador !== false;
      return op.ligados && id in op.ligados ? !!op.ligados[id] : !!P.ligado;
    };
    const atende = (id, a) => (PROVEDORES[id].mercados || []).includes(a.pais);
    const conta = (id) => { uso[id] = (uso[id] || 0) + 1; };
    const estourou = (id) => limites[id] != null && id !== 'manual' && id !== 'simulador' && (uso[id] || 0) >= limites[id];
    function doCache(k) { const c = cache.get(k); if (c && c.ate > agora()) return c.valor; cache.delete(k); return undefined; }
    function guardar(k, id, v) { const seg = PROVEDORES[id].cachePermitidoSeg || 0; if (seg > 0) cache.set(k, { ate: agora() + seg * 1000, valor: v }); }

    function cotacao(a) {
      if (!a || !a.assetId) return null;
      const avisos = [];
      for (const id of ORDEM) {
        if (!ligado(id) || !atende(id, a)) continue;
        const k = `q|${id}|${a.assetId}`;
        const c = doCache(k); if (c !== undefined) { if (c) return c; continue; }
        if (estourou(id)) { avisos.push(`${id}: limite diário de consultas atingido`); continue; }
        try {
          if (id !== 'manual' && id !== 'simulador') conta(id);
          const bruto = ad[id].cotacao(a);
          const v = bruto && bruto.preco > 0 ? normalizar(a, bruto, id) : null;
          guardar(k, id, v);
          if (v) { if (avisos.length) v.avisos = avisos; return v; }
        } catch (e) { falhas[id] = (falhas[id] || 0) + 1; avisos.push(`${id}: falhou (${e && e.message ? e.message : 'erro'})`); }
      }
      const x = indisponivel(a); if (avisos.length) x.avisos = avisos; return x;
    }
    function historico(a, periodo) {
      for (const id of ORDEM) {
        if (!ligado(id) || !atende(id, a) || id === 'manual') continue;
        try {
          if (id !== 'simulador') { if (estourou(id)) continue; conta(id); }
          const s = ad[id].historico(a);
          if (s && s.length) return { estado: PROVEDORES[id].estado, fonte: id, fonteNome: PROVEDORES[id].nome, pontos: recortar(s, periodo) };
        } catch (e) { falhas[id] = (falhas[id] || 0) + 1; }
      }
      return { estado: 'indisponivel', fonte: null, pontos: [] };
    }
    return {
      cotacao, historico, cotacoes: (lista) => lista.map(cotacao),
      uso: () => Object.assign({}, uso), falhas: () => Object.assign({}, falhas), limpar: () => cache.clear(),
      provedores: () => ORDEM.map((id) => Object.assign({ id, ativo: ligado(id), usoHoje: uso[id] || 0, falhas: falhas[id] || 0 }, PROVEDORES[id])),
    };
  }
  function recortar(s, periodo) {
    const n = PERIODOS[periodo] ?? PERIODOS['1A'];
    if (n === 'ytd') { const ano = s[s.length - 1].data.slice(0, 4); const i = s.findIndex((p) => p.data.slice(0, 4) === ano); return s.slice(Math.max(0, i - 1)); }
    return n === Infinity ? s.slice() : s.slice(Math.max(0, s.length - n - 1));
  }

  // ---------- indicadores técnicos (sobre fechamentos) ----------
  function sma(v, n) { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = r4(s / n); } return o; }
  function ema(v, n) { const o = new Array(v.length).fill(null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < v.length; i++) { if (i === n - 1) { e = v.slice(0, n).reduce((a, b) => a + b, 0) / n; o[i] = r4(e); } else if (i >= n) { e = v[i] * k + e * (1 - k); o[i] = r4(e); } } return o; }
  function rsi(v, n = 14) { // Wilder
    const o = new Array(v.length).fill(null); if (v.length <= n) return o;
    let g = 0, p = 0; for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else p -= d; }
    g /= n; p /= n; o[n] = p === 0 ? 100 : r2(100 - 100 / (1 + g / p));
    for (let i = n + 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; p = (p * (n - 1) + Math.max(-d, 0)) / n; o[i] = p === 0 ? 100 : r2(100 - 100 / (1 + g / p)); }
    return o;
  }
  function macd(v, r = 12, l = 26, s = 9) {
    const a = ema(v, r), b = ema(v, l); const linha = v.map((_, i) => (a[i] != null && b[i] != null ? r4(a[i] - b[i]) : null));
    const ini = linha.findIndex((x) => x != null); const sinal = new Array(v.length).fill(null);
    if (ini >= 0) { const e = ema(linha.slice(ini), s); e.forEach((x, i) => { sinal[ini + i] = x; }); }
    return { linha, sinal, histograma: linha.map((x, i) => (x != null && sinal[i] != null ? r4(x - sinal[i]) : null)) };
  }
  function bollinger(v, n = 20, k = 2) {
    const m = sma(v, n); const sup = new Array(v.length).fill(null), inf = new Array(v.length).fill(null);
    for (let i = n - 1; i < v.length; i++) { const f = v.slice(i - n + 1, i + 1); const dp = Math.sqrt(f.reduce((s, x) => s + (x - m[i]) ** 2, 0) / n); sup[i] = r4(m[i] + k * dp); inf[i] = r4(m[i] - k * dp); }
    return { media: m, superior: sup, inferior: inf };
  }
  const retorno = (pontos) => (pontos && pontos.length > 1 && pontos[0].fechamento > 0 ? r4((pontos[pontos.length - 1].fechamento / pontos[0].fechamento - 1) * 100) : null);
  // comparação: séries rebaseadas em 0% no primeiro dia comum
  function comparar(series) {
    const datas = series.map((s) => new Set(s.pontos.map((p) => p.data)));
    const comuns = series.length ? series[0].pontos.map((p) => p.data).filter((d) => datas.every((x) => x.has(d))) : [];
    return { datas: comuns, series: series.map((s) => { const m = new Map(s.pontos.map((p) => [p.data, p.fechamento])); const b = m.get(comuns[0]); return { assetId: s.assetId, rotulo: s.rotulo, valores: comuns.map((d) => (b > 0 ? r2((m.get(d) / b - 1) * 100) : null)) }; }) };
  }

  // ---------- rankings, mapa de calor e radar ----------
  function rankings(cot, n = 10) {
    const ok = cot.filter((q) => q && q.preco != null && q.variacaoPct != null);
    const vol = ok.filter((q) => q.volume > 0).map((q) => Object.assign({ financeiro: r2(q.volume * q.preco) }, q));
    return {
      altas: ok.slice().sort((a, b) => b.variacaoPct - a.variacaoPct || a.ticker.localeCompare(b.ticker)).slice(0, n),
      baixas: ok.slice().sort((a, b) => a.variacaoPct - b.variacaoPct || a.ticker.localeCompare(b.ticker)).slice(0, n),
      volume: vol.sort((a, b) => b.financeiro - a.financeiro || a.ticker.localeCompare(b.ticker)).slice(0, n),
      estados: [...new Set(ok.map((q) => q.estado))],
    };
  }
  // agrupa por setor: variação média ponderada pelo volume financeiro (ou simples, sem volume)
  function mapaCalor(cot, ativos, maxPorSetor = 12) {
    const porId = new Map(ativos.map((a) => [a.assetId, a]));
    const g = new Map();
    for (const q of cot) {
      if (!q || q.variacaoPct == null) continue;
      const a = porId.get(q.assetId) || {}; const setor = a.setor || 'Sem setor';
      if (!g.has(setor)) g.set(setor, []); g.get(setor).push(Object.assign({ peso: q.volume > 0 ? q.volume * q.preco : 1 }, q));
    }
    return [...g.entries()].map(([setor, itens]) => {
      const pt = itens.reduce((s, x) => s + x.peso, 0);
      itens.sort((a, b) => b.peso - a.peso);
      return { setor, variacaoPct: r2(itens.reduce((s, x) => s + x.variacaoPct * x.peso, 0) / pt), peso: pt, qtd: itens.length, itens: itens.slice(0, maxPorSetor) };
    }).sort((a, b) => b.peso - a.peso);
  }
  // sinais objetivos, por regra (sem recomendação de compra ou venda)
  function radar(ativos, motor, op = {}) {
    const out = [];
    for (const a of ativos) {
      const h = motor.historico(a, '6M'); if (h.pontos.length < 60) continue;
      const f = h.pontos.map((p) => p.fechamento); const v = h.pontos.map((p) => p.volume || 0); const n = f.length - 1;
      const m20 = sma(f, 20), m50 = sma(f, 50); const r = rsi(f, 14);
      const sinais = [];
      if (m20[n - 1] != null && m50[n - 1] != null) {
        if (m20[n - 1] <= m50[n - 1] && m20[n] > m50[n]) sinais.push({ tipo: 'cruzamento-alta', texto: 'Média de 20 dias cruzou acima da de 50' });
        if (m20[n - 1] >= m50[n - 1] && m20[n] < m50[n]) sinais.push({ tipo: 'cruzamento-baixa', texto: 'Média de 20 dias cruzou abaixo da de 50' });
      }
      if (r[n] != null && r[n] >= 70) sinais.push({ tipo: 'ifr-alto', texto: `IFR(14) em ${r[n]} (acima de 70)` });
      if (r[n] != null && r[n] <= 30) sinais.push({ tipo: 'ifr-baixo', texto: `IFR(14) em ${r[n]} (abaixo de 30)` });
      const mv = v.slice(n - 20, n).reduce((s, x) => s + x, 0) / 20;
      if (mv > 0 && v[n] > 2 * mv) sinais.push({ tipo: 'volume', texto: `Volume ${Math.round(v[n] / mv * 10) / 10}× a média de 20 dias` });
      const max52 = Math.max(...h.pontos.map((p) => p.maxima)); const min52 = Math.min(...h.pontos.map((p) => p.minima));
      if (f[n] >= max52 * 0.995) sinais.push({ tipo: 'maxima', texto: 'Perto da máxima dos últimos 6 meses' });
      if (f[n] <= min52 * 1.005) sinais.push({ tipo: 'minima', texto: 'Perto da mínima dos últimos 6 meses' });
      if (sinais.length) out.push({ assetId: a.assetId, ticker: a.ticker, nome: a.nome, estado: h.estado, sinais, volume: v[n] * f[n] });
    }
    out.sort((x, y) => y.sinais.length - x.sinais.length || y.volume - x.volume || x.ticker.localeCompare(y.ticker));
    return op.limite ? out.slice(0, op.limite) : out;
  }

  return { ESTADOS, INDICES, MACRO, PROVEDORES, ORDEM, PERIODOS, INICIO, diasUteis, criarSimulador, criarManual, criarMotor, idCacheGlobal, normalizarDoServidor, normalizar, indisponivel, recortar, sma, ema, rsi, macd, bollinger, retorno, comparar, rankings, mapaCalor, radar, hash };
});
