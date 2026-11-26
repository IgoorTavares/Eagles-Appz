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

// companyfacts → anos fiscais (10-K, FY, ~12 meses) com indicadores só quando os dois lados existem
export function fundamentosDeFacts(facts) {
  const g = (facts && facts.facts && facts.facts['us-gaap']) || {};
  const porAno = new Map();
  for (const [campo, tags] of Object.entries(TAGS)) {
    for (const tag of tags) {
      const u = g[tag] && g[tag].units && g[tag].units.USD; if (!u) continue;
      for (const f of u) {
        if (f.form !== '10-K' || f.fp !== 'FY' || !f.end || !Number.isFinite(f.val)) continue;
        if (FLUXO.has(campo)) { if (!f.start) continue; const d = (Date.parse(f.end) - Date.parse(f.start)) / 86400000; if (d < 350 || d > 380) continue; }
        else if (f.start) continue;
        const ano = f.end.slice(0, 4); // ano do fim do exercício fiscal
        if (!porAno.has(ano)) porAno.set(ano, { ano, fim: f.end });
        const x = porAno.get(ano);
        if (x[campo] == null || (x['_' + campo] && x['_' + campo].filed < f.filed && x['_' + campo].tag === tag)) { if (x[campo] == null || x['_' + campo].tag === tag) { x[campo] = f.val; x['_' + campo] = { filed: f.filed, tag }; } }
      }
      if ([...porAno.values()].some((x) => x[campo] != null)) break; // usa a primeira tag que a empresa reporta (não mistura tags)
    }
  }
  const lista = [...porAno.values()].sort((a, b) => (a.ano < b.ano ? -1 : 1)).map((x) => ({ ano: x.ano, fim: x.fim, receita: x.receita ?? null, lucro: x.lucro ?? null, ativo: x.ativo ?? null, passivo: x.passivo ?? null, pl: x.pl ?? null, divida: x.divida ?? null, fco: x.fco ?? null }));
  const div = (a, b) => (a != null && b != null && b !== 0 ? Math.round((a / b) * 10000) / 100 : null);
  lista.forEach((o, i) => {
    const ant = lista[i - 1] && Number(lista[i - 1].ano) === Number(o.ano) - 1 ? lista[i - 1] : null;
    o.margemLiquida = o.receita > 0 ? div(o.lucro, o.receita) : null;
    o.roe = ant && o.pl != null && ant.pl != null && o.pl + ant.pl > 0 ? div(o.lucro, (o.pl + ant.pl) / 2) : null;
    o.crescReceita = ant && ant.receita > 0 && o.receita != null ? div(o.receita - ant.receita, ant.receita) : null;
    o.crescLucro = ant && ant.lucro > 0 && o.lucro != null ? div(o.lucro - ant.lucro, ant.lucro) : null;
  });
  return lista.slice(-4);
}

export async function coletarSec({ fetch, email, tickers = LISTA_FUNDAMENTOS, coleta = new Date().toISOString() }) {
  const H = cabecalhoSec(email);
  const r = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', { headers: H });
  if (!r.ok) throw new Error('SEC tickers: HTTP ' + r.status);
  const textoTickers = await r.text();
  const j = JSON.parse(textoTickers);
  const ix = Object.fromEntries(j.fields.map((f, i) => [f, i]));
  const porTicker = new Map(j.data.map((l) => [String(l[ix.ticker]).toUpperCase(), { cik: l[ix.cik], nome: l[ix.name], bolsa: l[ix.exchange] }]));
  const empresas = {}; const erros = {};
  for (const t of tickers) {
    const e = porTicker.get(t.toUpperCase()); if (!e) { erros[t] = 'ticker não encontrado no arquivo da SEC'; continue; }
    await espera(260);
    try {
      const rf = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(e.cik).padStart(10, '0')}.json`, { headers: H });
      if (!rf.ok) throw new Error('HTTP ' + rf.status);
      const anual = fundamentosDeFacts(await rf.json());
      if (anual.length) empresas[String(e.cik)] = { ticker: t.replace('-', '.'), nome: e.nome, cik: e.cik, anual };
    } catch (err) { erros[t] = mascarar(err.message, email).slice(0, 120); }
  }
  return { textoTickers, fundamentos: { formato: 'eagles-inv-fundamentos-us-v1', fonte: 'sec_edgar', atribuicao: 'Source: U.S. Securities and Exchange Commission — EDGAR (XBRL company facts)', licenca: 'Obra do governo federal dos EUA (domínio público)', transformacoes: 'Valores anuais dos formulários 10-K (exercício de ~12 meses); margem, ROE (PL médio) e crescimento calculados pelo Eagles Labz', coleta, empresas }, erros };
}
