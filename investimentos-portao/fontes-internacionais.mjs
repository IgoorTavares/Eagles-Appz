// Investimentos · EAGLES DATA ENGINE — energia, câmbio internacional e macro internacional (Etapas 12.7, 12.8 e 12.9, v160)
// Cada série/indicador com a licença conferida INDIVIDUALMENTE (evidências em v160-entrega/evidencias):
//  - EIA via FRED: WTI (DCOILWTICO) e Brent (DCOILBRENTEU) "Public Domain: Citation Requested" → LIGADOS.
//    Gás Henry Hub (DHHNGSP): a EIA diz "Spot Price: Refinitiv, an LSEG business" → DESLIGADO até confirmação escrita.
//  - Fed H.10 via FRED (DEX*): "Public Domain: Citation Requested".
//  - BCE (EXR, 14h15 CET): reutilização gratuita, inclusive comercial, citando a fonte.
//  - Banco do Canadá (Valet): uso, cópia e distribuição livres com atribuição.
//  - Banco Mundial (WDI): CC BY 4.0, conferido no metadado de CADA indicador (License_Type); outro tipo → recusado.
// Nada aqui é preço executável nem contrato futuro: são referências (spot/média/oficial) com unidade, moeda, data e fonte.
import { lerCsvFred } from './fred.mjs';

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ultimos = (pts, n) => pts.slice(-n).map((p) => [p.data, r6(p.valor)]);

// ---------- 12.7 energia ----------
export const ENERGIA = {
  DCOILWTICO: { id: 'WTI', nome: 'Petróleo WTI (Cushing, Oklahoma) — preço à vista', unidade: 'US$/barril', moeda: 'USD', ligada: true },
  DCOILBRENTEU: { id: 'BRENT', nome: 'Petróleo Brent (Europa) — preço à vista', unidade: 'US$/barril', moeda: 'USD', ligada: true },
  DHHNGSP: { id: 'GAS_HH', nome: 'Gás natural Henry Hub — preço à vista', unidade: 'US$/milhão de BTU', moeda: 'USD', ligada: false, motivo: 'Licença pendente: a EIA atribui o preço à vista à Refinitiv (LSEG); aguardando confirmação por escrito da EIA' },
};
export async function coletarEnergia({ fetch, hoje, desde = '2024-01-01' }) {
  const series = {}; const erros = {}; const desligadas = {};
  for (const [sid, S] of Object.entries(ENERGIA)) {
    if (!S.ligada) { desligadas[S.id] = S.motivo; continue; }
    try {
      const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${sid}&cosd=${desde}`); if (!r.ok) throw new Error('HTTP ' + r.status);
      const pts = lerCsvFred(await r.text(), sid).filter((p) => p.data <= hoje && p.valor > -1000 && p.valor < 10000);
      if (!pts.length) throw new Error('sem dados');
      const u = pts[pts.length - 1];
      series[S.id] = { serie: sid, nome: S.nome, unidade: S.unidade, moeda: S.moeda, valor: r6(u.valor), dataRef: u.data, frequencia: 'diária (dias úteis)', tipoReferencia: 'preço à vista (spot) de referência — NÃO é contrato futuro nem preço executável',
        historico: ultimos(pts, 260), atribuicao: 'Fonte: U.S. Energy Information Administration via FRED®', licenca: 'Domínio público (EIA; FRED "Public Domain: Citation Requested")' };
    } catch (e) { erros[S.id] = String(e.message || e).slice(0, 160); }
  }
  return { formato: 'eagles-inv-energia-v1', fonte: 'eia_fred', atribuicao: 'Fonte: U.S. Energy Information Administration via FRED®', licenca: 'Domínio público (citação solicitada)', series, erros, desligadas };
}

// ---------- 12.8 câmbio internacional ----------
// par = { base, cotada, valor } → "valor" unidades da moeda COTADA por 1 unidade da BASE (ex.: base USD, cotada BRL, 5,74)
export const H10 = { // FRED (Fed H.10, taxa de compra ao meio-dia em Nova York para transferências)
  DEXBZUS: ['USD', 'BRL'], DEXUSEU: ['EUR', 'USD'], DEXUSUK: ['GBP', 'USD'], DEXJPUS: ['USD', 'JPY'], DEXCAUS: ['USD', 'CAD'], DEXCHUS: ['USD', 'CNY'], DEXMXUS: ['USD', 'MXN'], DEXSZUS: ['USD', 'CHF'],
};
export const BCE_MOEDAS = ['USD', 'BRL', 'GBP', 'JPY', 'CAD', 'CHF', 'CNY']; // por 1 EUR
export const BOC = { FXUSDCAD: ['USD', 'CAD'], FXBRLCAD: ['BRL', 'CAD'], FXEURCAD: ['EUR', 'CAD'] }; // CAD por 1 unidade
export function lerBCE(csv, hoje) {
  const l = String(csv || '').trim().split(/\r?\n/); const cab = l[0].split(','); const ix = Object.fromEntries(cab.map((c, i) => [c, i]));
  for (const c of ['CURRENCY', 'CURRENCY_DENOM', 'TIME_PERIOD', 'OBS_VALUE', 'EXR_TYPE']) if (!(c in ix)) throw new Error('BCE: coluna ausente ' + c);
  const por = {};
  for (const x of l.slice(1)) { const c = x.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, '')); if (c[ix.EXR_TYPE] !== 'SP00' || c[ix.CURRENCY_DENOM] !== 'EUR') continue; const d = c[ix.TIME_PERIOD]; const v = Number(c[ix.OBS_VALUE]); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hoje || !(v > 0)) continue; (por[c[ix.CURRENCY]] = por[c[ix.CURRENCY]] || []).push({ data: d, valor: v }); }
  return por;
}
export function lerBOC(j, hoje) {
  if (!j || !Array.isArray(j.observations)) throw new Error('Banco do Canadá: resposta inesperada');
  const por = {};
  for (const o of j.observations) { const d = o.d; if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hoje) continue; for (const k of Object.keys(BOC)) { const v = o[k] && Number(o[k].v); if (v > 0) (por[k] = por[k] || []).push({ data: d, valor: v }); } }
  return por;
}
const par = (base, cotada, pts, extra) => { const s = pts.sort((a, b) => (a.data < b.data ? -1 : 1)); const u = s[s.length - 1]; return Object.assign({ base, cotada, valor: r6(u.valor), dataRef: u.data, historico: ultimos(s, 120) }, extra); };
// conversão cruzada e direção: confere a mesma taxa por dois caminhos na MESMA data
export function conferir(pares) {
  const v = (k, d) => { const p = pares[k]; if (!p) return null; const h = p.historico.find((x) => x[0] === d); return h ? h[1] : null; };
  const out = [];
  const datas = (k) => (pares[k] ? pares[k].historico.map((x) => x[0]) : []);
  // 1) EUR→BRL: BCE direto × (EUR→USD do H.10) × (USD→BRL do H.10)
  const d1 = datas('EURBRL:bce').filter((d) => datas('EURUSD:h10').includes(d) && datas('USDBRL:h10').includes(d)).pop();
  if (d1) { const direto = v('EURBRL:bce', d1), cruz = v('EURUSD:h10', d1) * v('USDBRL:h10', d1); out.push({ teste: 'EUR→BRL: BCE × (H.10 EUR→USD × USD→BRL)', data: d1, direto, cruzado: r6(cruz), difPct: r6(Math.abs(cruz / direto - 1) * 100), ok: Math.abs(cruz / direto - 1) < 0.02 }); }
  // 2) USD→BRL: H.10 direto × Banco do Canadá (CAD por USD ÷ CAD por BRL)
  const d2 = datas('USDBRL:h10').filter((d) => datas('USDCAD:boc').includes(d) && datas('BRLCAD:boc').includes(d)).pop();
  if (d2) { const direto = v('USDBRL:h10', d2), cruz = v('USDCAD:boc', d2) / v('BRLCAD:boc', d2); out.push({ teste: 'USD→BRL: H.10 × (BoC CAD/USD ÷ CAD/BRL)', data: d2, direto, cruzado: r6(cruz), difPct: r6(Math.abs(cruz / direto - 1) * 100), ok: Math.abs(cruz / direto - 1) < 0.02 }); }
  // 3) direção: EUR→USD do BCE e do H.10 são o MESMO sentido (>1 hoje); um par invertido daria ~0,9
  const d3 = datas('EURUSD:bce').filter((d) => datas('EURUSD:h10').includes(d)).pop();
  if (d3) { const a = v('EURUSD:bce', d3), b = v('EURUSD:h10', d3); out.push({ teste: 'Direção EUR→USD: BCE × H.10', data: d3, direto: a, cruzado: b, difPct: r6(Math.abs(b / a - 1) * 100), ok: Math.abs(b / a - 1) < 0.02 }); }
  return out;
}
export async function coletarCambio({ fetch, hoje, desde = '2026-01-01' }) {
  const pares = {}; const erros = {};
  try { const r = await fetch(`https://data-api.ecb.europa.eu/service/data/EXR/D.${BCE_MOEDAS.join('+')}.EUR.SP00.A?startPeriod=${desde}&format=csvdata`); if (!r.ok) throw new Error('HTTP ' + r.status); const por = lerBCE(await r.text(), hoje);
    for (const m of BCE_MOEDAS) if (por[m] && por[m].length) pares[`EUR${m}:bce`] = par('EUR', m, por[m], { fonte: 'bce', tipo: 'referencia', tipoTexto: 'taxa de referência do BCE (14h15, horário da Europa Central) — informativa, não é taxa de negociação', atribuicao: 'Fonte: Banco Central Europeu (BCE) — taxas de referência do euro' });
  } catch (e) { erros.bce = String(e.message || e).slice(0, 160); }
  for (const [sid, [b, c]] of Object.entries(H10)) {
    try { const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${sid}&cosd=${desde}`); if (!r.ok) throw new Error('HTTP ' + r.status); const pts = lerCsvFred(await r.text(), sid).filter((p) => p.data <= hoje && p.valor > 0); if (!pts.length) throw new Error('sem dados');
      pares[`${b}${c}:h10`] = par(b, c, pts, { fonte: 'fed_h10', serie: sid, tipo: 'compra', tipoTexto: 'taxa de COMPRA ao meio-dia em Nova York (cabo) — referência do Fed, não é taxa executável', atribuicao: 'Fonte: Board of Governors of the Federal Reserve System (H.10) via FRED®' });
    } catch (e) { erros[sid] = String(e.message || e).slice(0, 160); }
  }
  try { const r = await fetch(`https://www.bankofcanada.ca/valet/observations/${Object.keys(BOC).join(',')}/json?start_date=${desde}`); if (!r.ok) throw new Error('HTTP ' + r.status); const por = lerBOC(await r.json(), hoje);
    for (const [k, [b, c]] of Object.entries(BOC)) if (por[k] && por[k].length) pares[`${b}${c}:boc`] = par(b, c, por[k], { fonte: 'boc', serie: k, tipo: 'media', tipoTexto: 'média diária indicativa do Banco do Canadá — não é taxa de negociação', atribuicao: 'Fonte: Bank of Canada' });
  } catch (e) { erros.boc = String(e.message || e).slice(0, 160); }
  return { formato: 'eagles-inv-cambio-int-v1', fonte: 'cambio_int', atribuicao: 'Fontes: Banco Central Europeu; Board of Governors of the Federal Reserve System (H.10) via FRED®; Bank of Canada', licenca: 'BCE: reutilização gratuita com citação da fonte; Fed H.10: domínio público; Banco do Canadá: uso livre com atribuição',
    nota: 'A referência oficial brasileira continua sendo a PTAX do Banco Central do Brasil. Compra, venda, referência e média NÃO se misturam: cada par diz o tipo.', pares, conferencias: conferir(pares), erros };
}

// ---------- 12.9 macro internacional (Banco Mundial, WDI) ----------
export const WDI = {
  'NY.GDP.MKTP.CD': { id: 'PIB_USD', nome: 'PIB (US$ correntes)', unidade: 'US$' },
  'NY.GDP.MKTP.KD.ZG': { id: 'PIB_CRESC', nome: 'Crescimento do PIB real', unidade: '% no ano' },
  'NY.GDP.PCAP.CD': { id: 'PIB_PC', nome: 'PIB per capita (US$ correntes)', unidade: 'US$' },
  'FP.CPI.TOTL.ZG': { id: 'INFLACAO', nome: 'Inflação ao consumidor', unidade: '% no ano' },
  'SP.POP.TOTL': { id: 'POPULACAO', nome: 'População total', unidade: 'pessoas' },
  'GC.DOD.TOTL.GD.ZS': { id: 'DIVIDA', nome: 'Dívida do governo central', unidade: '% do PIB' },
  'SL.UEM.TOTL.ZS': { id: 'DESEMPREGO', nome: 'Desemprego (estimativa modelada da OIT)', unidade: '% da força de trabalho' },
  'BN.CAB.XOKA.GD.ZS': { id: 'CONTA_CORRENTE', nome: 'Saldo em conta corrente', unidade: '% do PIB' },
};
export const PAISES = { BRA: 'Brasil', USA: 'Estados Unidos', CHN: 'China', EMU: 'Zona do euro', JPN: 'Japão', DEU: 'Alemanha', GBR: 'Reino Unido', IND: 'Índia', MEX: 'México', ARG: 'Argentina', CAN: 'Canadá', CHL: 'Chile' };
export function licencaIndicador(meta) {
  try { const m = meta.source[0].concept[0].variable[0].metatype; const g = (k) => (m.find((x) => x.id === k) || {}).value || ''; return { tipo: g('License_Type'), url: g('License_URL'), fonteOriginal: g('Source').replace(/,?\s*(uri|publisher):\s*[^,;]*/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200), periodicidade: g('Periodicity') || 'Anual' }; } catch (e) { return null; }
}
export async function coletarMacroInt({ fetch, hoje }) {
  const paises = {}; const erros = {}; const licencas = {}; const recusados = {};
  for (const [ind, M] of Object.entries(WDI)) {
    try {
      const rm = await fetch(`https://api.worldbank.org/v2/sources/2/series/${ind}/metadata?format=json`); if (!rm.ok) throw new Error('metadado HTTP ' + rm.status);
      const lic = licencaIndicador(await rm.json()); if (!lic || !/^CC BY-?4\.0$/i.test(lic.tipo)) { recusados[M.id] = 'licença do indicador não é CC BY 4.0: ' + (lic ? lic.tipo : '?'); continue; }
      licencas[M.id] = { indicador: ind, licenca: 'CC BY 4.0', url: lic.url, fonteOriginal: lic.fonteOriginal };
      const r = await fetch(`https://api.worldbank.org/v2/country/${Object.keys(PAISES).join(';')}/indicator/${ind}?format=json&mrv=6&per_page=500`); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (!Array.isArray(j) || !Array.isArray(j[1])) throw new Error('resposta inesperada');
      const atualizado = String((j[0] && j[0].lastupdated) || '').slice(0, 10);
      for (const o of j[1]) {
        const p = o.countryiso3code; if (!PAISES[p] || o.value == null || !/^\d{4}$/.test(o.date) || !Number.isFinite(o.value)) continue;
        const P = (paises[p] = paises[p] || { nome: PAISES[p], indicadores: {} });
        const I = (P.indicadores[M.id] = P.indicadores[M.id] || { nome: M.nome, unidade: M.unidade, periodicidade: 'anual', serie: [], revisao: atualizado });
        I.serie.push([o.date, r6(o.value)]);
      }
    } catch (e) { erros[M.id] = String(e.message || e).slice(0, 160); }
  }
  for (const P of Object.values(paises)) for (const I of Object.values(P.indicadores)) { I.serie.sort((a, b) => (a[0] < b[0] ? -1 : 1)); const u = I.serie[I.serie.length - 1]; I.ano = u[0]; I.valor = u[1]; }
  return { formato: 'eagles-inv-macro-int-v1', fonte: 'worldbank', atribuicao: 'Fonte: Banco Mundial — World Development Indicators (CC BY 4.0)', licenca: 'CC BY 4.0 (conferida no metadado de cada indicador)', nota: 'Indicadores ANUAIS, revisados pela fonte; não são dados em tempo real.', licencas, recusados, paises, erros };
}
