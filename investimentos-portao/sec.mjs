// Investimentos · EAGLES DATA ENGINE — SEC EDGAR (obra do governo dos EUA; acesso automático exige identificação)
// O contato do robô vem SÓ da variável de ambiente SEC_CONTACT_EMAIL (segredo do GitHub). Ele nunca é gravado em arquivo,
// tela, JSON publicado ou registro: os erros são mascarados antes de qualquer saída.
// Fair Access da SEC: até 10 requisições por segundo; aqui, no máximo 4 por segundo.
export const LISTA_FUNDAMENTOS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'V', 'MA', 'JNJ', 'WMT', 'PG', 'XOM', 'CVX', 'UNH', 'HD', 'KO', 'PEP',
  'COST', 'DIS', 'NFLX', 'INTC', 'CSCO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'AVGO', 'QCOM', 'TXN', 'IBM', 'PFE', 'MRK', 'ABBV', 'LLY', 'TMO', 'BAC', 'WFC', 'C', 'GS', 'MS', 'NKE', 'MCD', 'CAT', 'BA', 'GE', 'T', 'VZ'];
const TAGS = {
  receita: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  lucro: ['NetIncomeLoss', 'ProfitLoss'],
  pl: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  ativo: ['Assets'], passivo: ['Liabilities'],
  divida: ['LongTermDebt', 'LongTermDebtNoncurrent'],
  fco: ['NetCashProvidedByUsedInOperatingActivities'],
};
const FLUXO = new Set(['receita', 'lucro', 'fco']); // itens de período (precisam de ~12 meses); os demais são posição na data

export function cabecalhoSec(email) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('SEC: contato do robô não configurado (SEC_CONTACT_EMAIL)'), { code: 'sem-credencial' });
  return { 'User-Agent': `EaglesLabz ${email}`, 'Accept-Encoding': 'gzip, deflate' };
}
export const mascarar = (txt, email) => String(txt || '').split(email || '\u0000').join('[contato]').replace(/[^@\s]+@[^@\s]+\.[a-z]{2,}/gi, '[contato]');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// companyfacts → períodos ANUAIS (10-K, FY, ~12 meses) e TRIMESTRAIS (10-Q, Q1–Q3, ~3 meses), sem misturar formulários.
// - moeda: USD quando a empresa reporta em USD; senão a moeda reportada (estrangeiras), registrada em "moeda" (nunca convertida aqui);
// - revisões: para o mesmo período vale o número do arquivamento MAIS NOVO ("filed"); quantas versões diferentes existiram fica em "revisoes";
// - indicadores só com os dois lados presentes; fundamentos NÃO são cotação (nada de preço aqui).
function moedaDe(g) { for (const tags of Object.values(TAGS)) for (const t of tags) { const u = g[t] && g[t].units; if (u) { if (u.USD) return 'USD'; const k = Object.keys(u).find((x) => /^[A-Z]{3}$/.test(x)); if (k) return k; } } return 'USD'; }
export function periodosDeFacts(facts, op = {}) {
  const g = (facts && facts.facts && facts.facts['us-gaap']) || {};
  const moeda = moedaDe(g); const trimestral = !!op.trimestral;
  const porPer = new Map();
  for (const [campo, tags] of Object.entries(TAGS)) {
    for (const tag of tags) {
      const u = g[tag] && g[tag].units && g[tag].units[moeda]; if (!u) continue;
      for (const f of u) {
        const okForm = trimestral ? (f.form === '10-Q' || f.form === '10-Q/A') && /^Q[1-3]$/.test(f.fp || '') : (f.form === '10-K' || f.form === '10-K/A') && f.fp === 'FY';
        if (!okForm || !f.end || !Number.isFinite(f.val)) continue;
        if (FLUXO.has(campo)) { if (!f.start) continue; const d = (Date.parse(f.end) - Date.parse(f.start)) / 86400000; if (trimestral ? (d < 80 || d > 100) : (d < 350 || d > 380)) continue; }
        else if (f.start) continue;
        const chave = trimestral ? f.end : f.end.slice(0, 4);
        if (!porPer.has(chave)) porPer.set(chave, { ano: f.end.slice(0, 4), fim: f.end, periodo: trimestral ? (f.fp || '') : 'FY', vals: {} });
        const x = porPer.get(chave); const atual = x.vals[campo];
        if (atual && atual.tag !== tag) continue; // não mistura tags no mesmo campo
        if (!atual) x.vals[campo] = { val: f.val, filed: f.filed || '', tag, versoes: new Set([f.val]) };
        else { atual.versoes.add(f.val); if ((f.filed || '') > atual.filed) { atual.val = f.val; atual.filed = f.filed || ''; } }
      }
      if ([...porPer.values()].some((x) => x.vals[campo])) break; // usa a primeira tag que a empresa reporta
    }
  }
  const lista = [...porPer.values()].sort((a, b) => (a.fim < b.fim ? -1 : 1)).map((x) => {
    const o = { ano: x.ano, fim: x.fim, periodo: x.periodo, moeda };
    let rev = 0; for (const c of Object.keys(TAGS)) { const v = x.vals[c]; o[c] = v ? v.val : null; if (v && v.versoes.size > 1) rev++; }
    o.revisoes = rev; return o;
  });
  const div = (a, b) => (a != null && b != null && b !== 0 ? Math.round((a / b) * 10000) / 100 : null);
  lista.forEach((o, i) => {
    const ant = trimestral ? null : (lista[i - 1] && Number(lista[i - 1].ano) === Number(o.ano) - 1 ? lista[i - 1] : null);
    o.margemLiquida = o.receita > 0 ? div(o.lucro, o.receita) : null;
    o.roe = ant && o.pl != null && ant.pl != null && o.pl + ant.pl > 0 ? div(o.lucro, (o.pl + ant.pl) / 2) : null;
    o.crescReceita = ant && ant.receita > 0 && o.receita != null ? div(o.receita - ant.receita, ant.receita) : null;
    o.crescLucro = ant && ant.lucro > 0 && o.lucro != null ? div(o.lucro - ant.lucro, ant.lucro) : null;
  });
  return lista.slice(trimestral ? -6 : -4);
}
// compatível com a v159 (só anual, sem os campos novos)
export function fundamentosDeFacts(facts) { return periodosDeFacts(facts).map((o) => { const x = Object.assign({}, o); delete x.periodo; delete x.moeda; delete x.revisoes; return x; }); }

// controle de consultas: no máximo "limite" empresas por execução (as demais ficam com o dado anterior, que o robô mantém)
export async function coletarSec({ fetch, email, tickers = LISTA_FUNDAMENTOS, coleta = new Date().toISOString(), limite = 60, anterior = null }) {
  const H = cabecalhoSec(email);
  const r = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', { headers: H });
  if (!r.ok) throw new Error('SEC tickers: HTTP ' + r.status);
  const textoTickers = await r.text();
  const j = JSON.parse(textoTickers);
  const ix = Object.fromEntries(j.fields.map((f, i) => [f, i]));
  const porTicker = new Map(j.data.map((l) => [String(l[ix.ticker]).toUpperCase(), { cik: l[ix.cik], nome: l[ix.name], bolsa: l[ix.exchange] }]));
  const empresas = {}; const erros = {};
  let feitas = 0;
  for (const t of tickers) {
    const e = porTicker.get(t.toUpperCase()); if (!e) { erros[t] = 'ticker não encontrado no arquivo da SEC'; continue; }
    if (feitas >= limite) { const ant = anterior && anterior.empresas && anterior.empresas[String(e.cik)]; if (ant) empresas[String(e.cik)] = ant; continue; }
    feitas++;
    await espera(260);
    try {
      const rf = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(e.cik).padStart(10, '0')}.json`, { headers: H });
      if (!rf.ok) throw new Error('HTTP ' + rf.status);
      const fj = await rf.json(); const anual = fundamentosDeFacts(fj); const per = periodosDeFacts(fj); const tri = periodosDeFacts(fj, { trimestral: true });
      if (anual.length) empresas[String(e.cik)] = { ticker: t.replace('-', '.'), nome: e.nome, cik: e.cik, bolsa: e.bolsa, moeda: per.length ? per[per.length - 1].moeda : 'USD', anual, trimestral: tri, revisoes: per.reduce((a, x) => a + x.revisoes, 0) };
    } catch (err) { erros[t] = mascarar(err.message, email).slice(0, 120); }
  }
  return { textoTickers, fundamentos: { formato: 'eagles-inv-fundamentos-us-v1', fonte: 'sec_edgar', atribuicao: 'Source: U.S. Securities and Exchange Commission — EDGAR (XBRL company facts)', licenca: 'Obra do governo federal dos EUA (domínio público)', transformacoes: 'Valores anuais dos formulários 10-K (exercício de ~12 meses); margem, ROE (PL médio) e crescimento calculados pelo Eagles Labz', coleta, empresas }, erros };
}
