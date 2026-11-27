/* =====================================================================
   Investimentos · Motor de RENDA FIXA (Etapa 12.5, v160) — biblioteca PURA, isolada e testável.
   Não grava nada, não busca nada: recebe o CONTRATO, os LOTES (aplicações e resgates) e as SÉRIES de índices
   (CDI, Selic, IPCA já publicadas) e devolve o saldo separado em todas as partes.
   Princípios:
   - dinheiro em CENTAVOS inteiros; fatores em ponto fixo (BigInt, 1e16); nada de float acumulando erro;
   - convenção e capitalização vêm do contrato (padrão: DU/252 exponencial, calendário nacional);
   - índice que falta NÃO é inventado: o cálculo para no último dia com índice e avisa; CDI zero ≠ CDI ausente;
   - índice negativo (deflação) é aplicado como veio (piso só se o contrato disser);
   - IPCA pela defasagem e aniversário do contrato; mês sem IPCA publicado não é projetado;
   - tributação por regras VERSIONADAS, para pessoa física e jurídica; isenção NUNCA presumida pelo nome do título;
   - liquidez diária não garante resgate pelo saldo calculado; marcação a mercado de crédito privado: indisponível.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.rendafixa = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSAO = '12.5';
  const S = 10n ** 16n; // escala dos fatores
  const UM = S;

  // ---------- aritmética exata ----------
  function divArred(a, b) { const neg = (a < 0n) !== (b < 0n); const A = a < 0n ? -a : a, B = b < 0n ? -b : b; let q = A / B; const r = A % B; if (r * 2n > B || (r * 2n === B && q % 2n === 1n)) q += 1n; return neg ? -q : q; }
  const mul = (a, b) => divArred(a * b, S);             // fator × fator (meio-par)
  const mulTrunc = (a, b) => (a * b) / S;               // truncado (convenção B3 para o fator acumulado do DI)
  const deNum = (x, casas) => { const f = 10 ** casas; return BigInt(Math.round(x * f)) * (S / BigInt(f)); };
  // potência fracionária: só aqui entra float (como na própria convenção: (1+i)^(1/252)), arredondada nas casas do contrato
  const potencia = (base, exp, casas = 16) => { const v = Math.pow(base, exp); if (!Number.isFinite(v)) throw new Error('potência inválida'); const s = v.toFixed(Math.min(casas, 16)); return BigInt(s.replace('.', '').replace(/^(-?)0+(?=\d)/, '$1')) * 10n ** BigInt(16 - Math.min(casas, 16)); };
  const centavos = (valorCent, fator) => Number(divArred(BigInt(valorCent) * fator, S));

  // ---------- calendário (nacional, versionado) ----------
  // Feriados nacionais usados pelo mercado (ANBIMA/B3): fixos + Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi.
  // 20/11 (Consciência Negra) é feriado nacional desde 2024 (Lei 14.759/2023). Conferido contra as datas do CDI (SGS 12).
  const CALENDARIOS = { 'BR-NACIONAL-v1': { fixos: ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'], desde: { '11-20': 2024 }, moveis: true, fonte: 'Feriados nacionais (Lei 662/1949, Lei 6.802/1980, Lei 10.607/2002, Lei 14.759/2023) + Carnaval, Sexta-feira Santa e Corpus Christi (mercado financeiro)' } };
  function pascoa(a) { const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451), mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1; return Date.UTC(a, mes - 1, dia); }
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ms = (d) => Date.parse(d + 'T00:00:00Z');
  const cacheFeriados = new Map();
  function feriados(ano, cal = 'BR-NACIONAL-v1', extras) {
    const k = cal + ano; if (!extras && cacheFeriados.has(k)) return cacheFeriados.get(k);
    const C = CALENDARIOS[cal]; if (!C) throw new Error('calendário desconhecido: ' + cal);
    const s = new Set(C.fixos.map((x) => `${ano}-${x}`)); for (const [d, desde] of Object.entries(C.desde || {})) if (ano >= desde) s.add(`${ano}-${d}`);
    if (C.moveis) { const p = pascoa(ano); for (const off of [-48, -47, -2, 60]) s.add(iso(p + off * 864e5)); }
    for (const e of extras || []) if (e.startsWith(String(ano))) s.add(e);
    if (!extras) cacheFeriados.set(k, s); return s;
  }
  function diaUtil(d, cal, extras) { const w = new Date(ms(d)).getUTCDay(); return w !== 0 && w !== 6 && !feriados(+d.slice(0, 4), cal, extras).has(d); }
  // dias úteis em (de, ate]: conta o dia final, não conta o inicial (convenção de juros)
  function diasUteis(de, ate, cal, extras) { if (ate <= de) return 0; let n = 0; for (let t = ms(de) + 864e5; t <= ms(ate); t += 864e5) if (diaUtil(iso(t), cal, extras)) n++; return n; }
  function listaDU(de, ate, cal, extras) { const out = []; for (let t = ms(de) + 864e5; t <= ms(ate); t += 864e5) { const d = iso(t); if (diaUtil(d, cal, extras)) out.push(d); } return out; }
  const diasCorridos = (de, ate) => Math.round((ms(ate) - ms(de)) / 864e5);

  // ---------- regras tributárias VERSIONADAS ----------
  // Cada versão vale por data (do resgate/evento). Propostas não convertidas em lei NÃO entram. Revisão obrigatória a cada lei nova.
  const TRIBUTOS = [{
    versao: 'BR-RF-2005.1', vigenciaInicio: '2005-01-01', vigenciaFim: null, conferidaEm: '2026-11-27',
    fontes: ['Lei 11.033/2004, art. 1º (tabela regressiva) e art. 3º (isenções de PF: LCI, LCA, CRI, CRA)', 'Lei 12.431/2011, art. 1º e 2º (debêntures incentivadas)', 'Decreto 6.306/2007, art. 32 e Anexo (IOF regressivo até 29 dias)', 'Lei 14.754/2023 não muda esta tabela para títulos de renda fixa de pessoa física'],
    irRegressivo: [[180, 22.5], [360, 20], [720, 17.5], [Infinity, 15]],
    iof: [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0], // % do rendimento, por dia corrido 1..30
    // isenções POSSÍVEIS por tipo (só valem com confirmação no contrato/nota): pessoa física
    isencaoPossivelPF: { LCI: 'Lei 11.033/2004, art. 3º, II', LCA: 'Lei 11.033/2004, art. 3º, IV', CRI: 'Lei 11.033/2004, art. 3º, II', CRA: 'Lei 11.033/2004, art. 3º, IV', DEBENTURE_INCENTIVADA: 'Lei 12.431/2011, art. 2º (alíquota zero para PF)' },
    aliquotaPJ: { DEBENTURE_INCENTIVADA: 15 }, // PJ: debênture incentivada a 15% (Lei 12.431, art. 2º, §1º); demais pela tabela, como ANTECIPAÇÃO
    observacaoPJ: 'Para pessoa jurídica o IR retido é antecipação do devido no regime da empresa (lucro real, presumido ou Simples); o resultado final depende da contabilidade. LCI/LCA/CRI/CRA não têm a isenção de PF.',
  }];
  function regraEm(data) { const r = TRIBUTOS.filter((t) => t.vigenciaInicio <= data && (!t.vigenciaFim || data <= t.vigenciaFim)).pop(); if (!r) throw new Error('sem regra tributária vigente em ' + data); return r; }
  function aliquotaIR(diasCorr, regra) { for (const [ate, al] of regra.irRegressivo) if (diasCorr <= ate) return al; return 15; }
  function percIOF(diasCorr, regra) { return diasCorr >= 30 ? 0 : diasCorr <= 0 ? 100 : regra.iof[diasCorr - 1]; }
  // tributação de UM lote: isenção só se o contrato confirmar (contrato.isencaoConfirmada === true)
  function tributacao(c, diasCorr, data, investidor) {
    const regra = regraEm(data); const t = c.tipo; const avisos = [];
    let ir = aliquotaIR(diasCorr, regra); let base = 'tabela regressiva (Lei 11.033/2004)'; let confirmada = true;
    if (investidor === 'PF' && regra.isencaoPossivelPF[t]) {
      if (c.isencaoConfirmada === true) { ir = 0; base = 'isento para PF (' + regra.isencaoPossivelPF[t] + '), confirmado no contrato'; }
      else { confirmada = false; avisos.push(`${t} pode ser isento de IR para pessoa física (${regra.isencaoPossivelPF[t]}), mas a isenção não foi confirmada no cadastro do título: o IR abaixo é a estimativa SEM isenção.`); }
    }
    if (investidor === 'PJ') { if (regra.aliquotaPJ[t] != null) { ir = regra.aliquotaPJ[t]; base = 'Lei 12.431/2011 (PJ)'; } avisos.push(regra.observacaoPJ); }
    return { aliquotaIR: ir, percIOF: percIOF(diasCorr, regra), base, confirmada, versao: regra.versao, avisos };
  }

  // ---------- séries (já publicadas; nada projetado) ----------
  // cdi/selic: { 'AAAA-MM-DD': taxa % a.a. base 252 } (SGS 4389 / 1178) ou % a.d. (SGS 12 / 11) com op.formato='ad'
  // ipca: { 'AAAA-MM': variação % no mês } (SGS 433)
  function fatorDiario(taxa, formato) {
    if (formato === 'ad') return deNum(taxa / 100, 16) ; // % ao dia já publicado (8 casas no SGS 12)
    return potencia(1 + taxa / 100, 1 / 252, 16) - UM; // TDI = (1 + DI)^(1/252) − 1
  }
  // fator acumulado de um índice diário (CDI/Selic) × percentual, com a convenção B3: TDI arredondado em 8 casas,
  // cada fator diário (1 + TDI × p) em 16 casas, produto truncado em 16. Para no primeiro dia útil SEM taxa.
  function fatorIndiceDiario(serie, de, ate, pct, op = {}) {
    const dias = listaDU(de, ate, op.calendario, op.feriadosExtras); let f = UM; let ultimo = de; const faltando = [];
    const p = deNum(pct / 100, 8);
    for (const d of dias) {
      // a taxa que remunera o dia útil d é a do dia útil ANTERIOR (publicada em d−1): convenção do DI
      const ref = op.taxaDoProprioDia ? d : diaUtilAnterior(d, op.calendario, op.feriadosExtras);
      if (!(ref in serie)) { faltando.push(ref); break; }
      const v = Number(serie[ref]); if (!Number.isFinite(v)) { faltando.push(ref); break; }
      let tdi = fatorDiario(v, op.formato); tdi = divArred(tdi, 10n ** 8n) * 10n ** 8n; // TDI em 8 casas
      const fd = UM + divArred(tdi * p, S); // 1 + TDI × p (16 casas)
      f = mulTrunc(f, fd); ultimo = d;
    }
    return { fator: f, ate: ultimo, completo: !faltando.length, faltando, dias: dias.length };
  }
  function diaUtilAnterior(d, cal, extras) { let t = ms(d) - 864e5; while (!diaUtil(iso(t), cal, extras)) t -= 864e5; return iso(t); }
  const fatorPre = (taxaAA, du) => potencia(1 + taxaAA / 100, du / 252, 16);

  // IPCA com defasagem e aniversário: VNA(t) = Π (1 + IPCA[mês do período − defasagem]) com pró-rata do período corrente
  // em dias úteis (padrão) ou corridos. Se o IPCA aplicável de um período ainda não foi publicado, PARA no aniversário anterior.
  function fatorIPCA(ipca, de, ate, c, op = {}) {
    const defas = Number.isInteger(c.ipcaDefasagem) ? c.ipcaDefasagem : 1; const dia = c.diaAniversario || +de.slice(8, 10);
    const aniv = (ano, mes) => { const ult = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ult)).padStart(2, '0')}`; };
    let f = UM; let cursor = de; let ano = +de.slice(0, 4), mes = +de.slice(5, 7); const avisos = []; let ate2 = ate; let completo = true;
    if (aniv(ano, mes) <= de) { mes++; if (mes > 12) { mes = 1; ano++; } }
    while (cursor < ate) {
      const prox = aniv(ano, mes);
      const ini = new Date(Date.UTC(+prox.slice(0, 4), +prox.slice(5, 7) - 2, 1)); // mês do período (o que termina neste aniversário)
      const ref = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() - defas, 1)); const chave = ref.toISOString().slice(0, 7);
      if (!(chave in ipca)) { completo = false; ate2 = cursor; avisos.push(`IPCA de ${chave} ainda não publicado: o valor atualizado vai até ${cursor} (o índice futuro não é projetado).`); break; }
      let v = Number(ipca[chave]); if (c.pisoIndiceZero && v < 0) v = 0;
      const fm = deNum(1 + v / 100, 10);
      if (prox <= ate) { f = mul(f, fm); cursor = prox; }
      else { // pró-rata do período corrente
        const tot = c.proRata === 'dc' ? diasCorridos(cursor, prox) : diasUteis(cursor, prox, op.calendario, op.feriadosExtras);
        const dec = c.proRata === 'dc' ? diasCorridos(cursor, ate) : diasUteis(cursor, ate, op.calendario, op.feriadosExtras);
        if (tot > 0 && dec > 0) f = mul(f, potencia(1 + v / 100, dec / tot, 16));
        cursor = ate;
      }
      mes++; if (mes > 12) { mes = 1; ano++; }
    }
    return { fator: f, ate: ate2, completo, avisos };
  }

  // ---------- fator do contrato entre duas datas ----------
  const INDEXADORES = ['PRE', 'CDI_PCT', 'CDI_SPREAD', 'SELIC_PCT', 'SELIC_SPREAD', 'IPCA_SPREAD'];
  function fatorContrato(c, series, de, ate, op = {}) {
    const cal = { calendario: c.calendario || 'BR-NACIONAL-v1', feriadosExtras: c.feriadosExtras, formato: op.formato };
    const conv = c.convencao || 'DU252';
    const prazo = (a, b) => (conv === 'DU252' ? diasUteis(a, b, cal.calendario, cal.feriadosExtras) / 252 : conv === 'DC365' ? diasCorridos(a, b) / 365 : diasCorridos(a, b) / 360);
    const jurosPre = (taxa, a, b) => (c.capitalizacao === 'linear' ? UM + deNum((taxa / 100) * prazo(a, b), 16) : potencia(1 + taxa / 100, prazo(a, b), 16));
    switch (c.indexador) {
      case 'PRE': return { fator: jurosPre(c.taxa, de, ate), ate, completo: true, avisos: [] };
      case 'CDI_PCT': case 'SELIC_PCT': { const s = series[c.indexador.startsWith('CDI') ? 'cdi' : 'selic'] || {}; const r = fatorIndiceDiario(s, de, ate, c.taxa, cal); return { fator: r.fator, ate: r.ate, completo: r.completo, avisos: r.completo ? [] : [`${c.indexador.startsWith('CDI') ? 'CDI' : 'Selic'} de ${r.faltando[0]} não disponível (ainda não publicado ou fora da série carregada): saldo calculado até ${r.ate}.`] }; }
      case 'CDI_SPREAD': case 'SELIC_SPREAD': { const s = series[c.indexador.startsWith('CDI') ? 'cdi' : 'selic'] || {}; const r = fatorIndiceDiario(s, de, ate, 100, cal); return { fator: mul(r.fator, jurosPre(c.taxa, de, r.ate)), ate: r.ate, completo: r.completo, avisos: r.completo ? [] : [`Índice de ${r.faltando[0]} não disponível (ainda não publicado ou fora da série carregada): saldo calculado até ${r.ate}.`] }; }
      case 'IPCA_SPREAD': { const r = fatorIPCA(series.ipca || {}, de, ate, c, cal); return { fator: mul(r.fator, jurosPre(c.taxa, de, r.ate)), ate: r.ate, completo: r.completo, avisos: r.avisos, fatorIndice: r.fator }; }
      default: throw new Error('indexador desconhecido: ' + c.indexador);
    }
  }

  // ---------- validação do contrato ----------
  const TIPOS = ['CDB', 'LCI', 'LCA', 'LC', 'LF', 'DEBENTURE', 'DEBENTURE_INCENTIVADA', 'CRI', 'CRA', 'OUTRO'];
  const CREDITO_PRIVADO = new Set(TIPOS);
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  function validarContrato(c) {
    const e = [];
    if (!c || typeof c !== 'object') return { ok: false, erros: ['contrato vazio'] };
    if (!TIPOS.includes(c.tipo)) e.push('tipo inválido');
    if (!INDEXADORES.includes(c.indexador)) e.push('indexador inválido');
    if (!(typeof c.taxa === 'number' && Number.isFinite(c.taxa))) e.push('taxa inválida');
    else if (/_PCT$/.test(c.indexador) ? !(c.taxa > 0 && c.taxa <= 300) : !(c.taxa > -10 && c.taxa <= 100)) e.push('taxa fora do limite');
    if (!DIA.test(c.emissao || '') || !DIA.test(c.vencimento || '') || c.vencimento <= c.emissao) e.push('datas de emissão/vencimento inválidas');
    if (c.carencia && (!DIA.test(c.carencia) || c.carencia > c.vencimento)) e.push('carência inválida');
    if (c.convencao && !['DU252', 'DC365', 'DC360'].includes(c.convencao)) e.push('convenção inválida');
    if (c.capitalizacao && !['exponencial', 'linear'].includes(c.capitalizacao)) e.push('capitalização inválida');
    if (c.liquidez && !['diaria', 'carencia', 'vencimento'].includes(c.liquidez)) e.push('liquidez inválida');
    if (c.indexador === 'IPCA_SPREAD' && c.ipcaDefasagem != null && !(Number.isInteger(c.ipcaDefasagem) && c.ipcaDefasagem >= 0 && c.ipcaDefasagem <= 3)) e.push('defasagem do IPCA inválida');
    for (const ev of c.eventos || []) if (!DIA.test(ev.data || '') || !['juros', 'amortizacao'].includes(ev.tipo) || (ev.tipo === 'amortizacao' && !(ev.percentual > 0 && ev.percentual <= 100))) { e.push('evento inválido'); break; }
    return { ok: !e.length, erros: e };
  }

  // ---------- posição de um título com vários lotes ----------
  // lotes: [{ id, data, valor (centavos) }] aplicações; resgates: [{ data, valor (centavos líquidos pedidos) ou fracao, regra: 'PEPS'|'proporcional' }]
  // Eventos do contrato (juros periódicos e amortizações) incorporam/pagam no dia; o "principal remanescente" cai com a amortização.
  function posicao(c, lotes, series, data, op = {}) {
    const v = validarContrato(c); if (!v.ok) throw new Error('contrato inválido: ' + v.erros.join('; '));
    const investidor = op.investidor === 'PJ' ? 'PJ' : 'PF'; const avisos = new Set(); let calcAte = data; let completo = true;
    const ate = data > c.vencimento ? c.vencimento : data;
    const eventos = (c.eventos || []).filter((x) => x.data <= ate).sort((a, b) => (a.data < b.data ? -1 : 1));
    const res = { contrato: { tipo: c.tipo, indexador: c.indexador, taxa: c.taxa, vencimento: c.vencimento }, data, investidor, lotes: [], capitalAplicado: 0, principalRemanescente: 0, saldoContratualBruto: 0, rendimento: 0, jurosPagos: 0, amortizacoesPagas: 0, iof: 0, ir: 0, taxas: 0, saldoLiquidoEstimado: 0, valorEstimadoResgate: null, marcacaoMercado: null, regras: [] };
    for (const l of [...lotes].sort((a, b) => (a.data < b.data ? -1 : 1))) {
      if (!DIA.test(l.data) || !(Number.isInteger(l.valor) && l.valor > 0)) throw new Error('lote inválido');
      if (l.data > ate) continue;
      let principal = l.valor; let principalOriginal = l.valor; let base = l.valor; let desde = l.data; let juros = 0, amort = 0;
      // atravessa os eventos: em cada um, atualiza a base até a data, paga juros (base − principal) e/ou amortiza
      for (const ev of eventos.filter((x) => x.data > l.data)) {
        const fx = fatorContrato(c, series, desde, ev.data, op); if (!fx.completo) { completo = false; fx.avisos.forEach((a) => avisos.add(a)); calcAte = fx.ate; break; }
        const atual = centavos(base, fx.fator); const vnaPrincipal = c.indexador === 'IPCA_SPREAD' ? centavos(principal, fatorContrato(Object.assign({}, c, { taxa: 0 }), series, desde, ev.data, op).fator) : principal;
        if (ev.tipo === 'juros') { const j = Math.max(0, atual - vnaPrincipal); juros += j; base = atual - j; principal = vnaPrincipal; }
        else { const a = Math.round((vnaPrincipal * ev.percentual) / 100 * (ev.sobre === 'original' ? principalOriginal / principal : 1)); amort += a; base = atual - a; principal = vnaPrincipal - a; }
        desde = ev.data;
      }
      let saldo = base; let indiceAte = ate;
      if (completo) { const fx = fatorContrato(c, series, desde, ate, op); fx.avisos.forEach((a) => avisos.add(a)); if (!fx.completo) { completo = false; calcAte = fx.ate < calcAte ? fx.ate : calcAte; } saldo = centavos(base, fx.fator); indiceAte = fx.ate; }
      const rendimento = saldo + juros + amort - l.valor;
      const dc = diasCorridos(l.data, indiceAte);
      const tr = tributacao(c, dc, indiceAte, investidor); tr.avisos.forEach((a) => avisos.add(a));
      const rendNaoPago = Math.max(0, saldo - principal);
      const iof = Math.round(rendNaoPago * tr.percIOF / 100);
      const ir = Math.round(Math.max(0, rendNaoPago - iof) * tr.aliquotaIR / 100);
      const taxaCust = c.taxaCustodiaAA ? Math.round(saldo * (c.taxaCustodiaAA / 100) * (dc / 365)) : 0;
      res.lotes.push({ id: l.id || l.data, data: l.data, capital: l.valor, principalRemanescente: principal, saldoBruto: saldo, rendimento, jurosPagos: juros, amortizacoes: amort, diasCorridos: dc, aliquotaIR: tr.aliquotaIR, percIOF: tr.percIOF, iof, ir, taxas: taxaCust, liquido: saldo - iof - ir - taxaCust, tributacaoConfirmada: tr.confirmada, regra: tr.versao, calculadoAte: indiceAte });
      if (!res.regras.includes(tr.versao)) res.regras.push(tr.versao);
      res.capitalAplicado += l.valor; res.principalRemanescente += principal; res.saldoContratualBruto += saldo; res.rendimento += rendimento; res.jurosPagos += juros; res.amortizacoesPagas += amort; res.iof += iof; res.ir += ir; res.taxas += taxaCust;
    }
    res.saldoLiquidoEstimado = res.saldoContratualBruto - res.iof - res.ir - res.taxas;
    res.calculadoAte = calcAte; res.completo = completo;
    // liquidez e resgate
    const venceu = data >= c.vencimento; const emCarencia = c.carencia && data < c.carencia;
    const liq = c.liquidez || (c.carencia ? 'carencia' : 'vencimento');
    if (venceu) res.valorEstimadoResgate = res.saldoLiquidoEstimado;
    else if (liq === 'vencimento' || emCarencia) { res.valorEstimadoResgate = null; avisos.add(emCarencia ? `Em carência até ${c.carencia}: o resgate antecipado não é permitido pelo contrato.` : 'Liquidez só no vencimento: antes disso, só por venda no mercado secundário, a preço que pode ser diferente do saldo.'); }
    else { res.valorEstimadoResgate = res.saldoLiquidoEstimado; avisos.add('Liquidez diária não garante resgate pelo valor calculado: depende do emissor e das condições do contrato; o valor é uma estimativa.'); }
    if (!completo) { res.valorEstimadoResgate = null; }
    res.marcacaoMercado = { valor: null, motivo: CREDITO_PRIVADO.has(c.tipo) ? 'Crédito privado: sem fonte autorizada de preço de mercado; o saldo mostrado é o da curva do contrato (não é preço de venda).' : 'Indisponível' };
    res.avisos = [...avisos];
    return res;
  }

  // resgate parcial: escolhe os lotes (PEPS = mais antigos primeiro; ou proporcional) até atingir o valor BRUTO pedido
  function planejarResgate(pos, valorBruto, regraLotes = 'PEPS') {
    if (!(Number.isInteger(valorBruto) && valorBruto > 0)) throw new Error('valor inválido');
    if (valorBruto > pos.saldoContratualBruto) throw new Error('valor acima do saldo');
    const lotes = pos.lotes.map((l) => Object.assign({}, l)); const out = []; let falta = valorBruto;
    const fatia = (l, bruto) => { const p = bruto / l.saldoBruto; const iof = Math.round(l.iof * p), ir = Math.round(l.ir * p), tx = Math.round(l.taxas * p); return { lote: l.id, bruto, rendimento: Math.round((l.saldoBruto - l.principalRemanescente) * p), iof, ir, taxas: tx, liquido: bruto - iof - ir - tx, aliquotaIR: l.aliquotaIR }; };
    if (regraLotes === 'proporcional') { let soma = 0; lotes.forEach((l, i) => { const b = i === lotes.length - 1 ? valorBruto - soma : Math.round(valorBruto * l.saldoBruto / pos.saldoContratualBruto); soma += b; if (b > 0) out.push(fatia(l, b)); }); }
    else for (const l of lotes.sort((a, b) => (a.data < b.data ? -1 : 1))) { if (falta <= 0) break; const b = Math.min(falta, l.saldoBruto); out.push(fatia(l, b)); falta -= b; }
    const t = out.reduce((a, x) => ({ bruto: a.bruto + x.bruto, iof: a.iof + x.iof, ir: a.ir + x.ir, taxas: a.taxas + x.taxas, liquido: a.liquido + x.liquido }), { bruto: 0, iof: 0, ir: 0, taxas: 0, liquido: 0 });
    return { regra: regraLotes, lotes: out, total: t };
  }

  return { VERSAO, CALENDARIOS, TRIBUTOS, TIPOS, INDEXADORES, pascoa: (a) => iso(pascoa(a)), feriados, diaUtil, diasUteis, listaDU, diasCorridos, regraEm, aliquotaIR, percIOF, tributacao, fatorIndiceDiario, fatorPre, fatorIPCA, fatorContrato, validarContrato, posicao, planejarResgate, fatorNum: (f) => Number(f) / 1e16 };
});
