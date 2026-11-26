// Investimentos · EAGLES DATA ENGINE — indicadores dos EUA via FRED (Federal Reserve Bank of St. Louis)
// Só séries marcadas no FRED como "Public Domain: Citation Requested" (conferido em 26/11/2026 na página de cada série).
// Citação exigida: "Fonte: <órgão> via FRED". Nada de endosso, nada de treino de IA (termos do FRED).
// Com FRED_API_KEY (segredo do GitHub) usa a API oficial; sem a chave, o download oficial fredgraph.csv.
// O nível de um índice de preços NUNCA é mostrado como taxa: a inflação é calculada (mês e 12 meses).
export const SERIES = {
  FEDFUNDS: { nome: 'Fed Funds — taxa efetiva (mensal)', orgao: 'Board of Governors of the Federal Reserve System', medida: 'nivel', unidade: '%aa', freq: 'mensal' },
  DFF: { nome: 'Fed Funds — taxa efetiva diária', orgao: 'Board of Governors of the Federal Reserve System', medida: 'nivel', unidade: '%aa', freq: 'diária' },
  CPIAUCSL: { nome: 'Inflação ao consumidor (CPI) — 12 meses', orgao: 'U.S. Bureau of Labor Statistics', medida: 'var12m', unidade: '%', freq: 'mensal', extra: 'varMes' },
  CPILFESL: { nome: 'Núcleo da inflação (CPI sem alimentos e energia) — 12 meses', orgao: 'U.S. Bureau of Labor Statistics', medida: 'var12m', unidade: '%', freq: 'mensal', extra: 'varMes' },
  UNRATE: { nome: 'Taxa de desemprego', orgao: 'U.S. Bureau of Labor Statistics', medida: 'nivel', unidade: '%', freq: 'mensal' },
  PAYEMS: { nome: 'Empregos criados no mês (payroll, mil)', orgao: 'U.S. Bureau of Labor Statistics', medida: 'difMes', unidade: 'MIL', freq: 'mensal' },
  GDP: { nome: 'PIB nominal — 12 meses', orgao: 'U.S. Bureau of Economic Analysis', medida: 'var4t', unidade: '%', freq: 'trimestral' },
  GDPC1: { nome: 'PIB real — trimestre anualizado', orgao: 'U.S. Bureau of Economic Analysis', medida: 'varTriAnual', unidade: '%', freq: 'trimestral', extra: 'var4t' },
  INDPRO: { nome: 'Produção industrial — 12 meses', orgao: 'Board of Governors of the Federal Reserve System', medida: 'var12m', unidade: '%', freq: 'mensal' },
  PCE: { nome: 'Consumo das famílias (PCE nominal) — 12 meses', orgao: 'U.S. Bureau of Economic Analysis', medida: 'var12m', unidade: '%', freq: 'mensal' },
  DSPIC96: { nome: 'Renda disponível real — 12 meses', orgao: 'U.S. Bureau of Economic Analysis', medida: 'var12m', unidade: '%', freq: 'mensal' },
  HOUST: { nome: 'Novas moradias iniciadas (mil, anualizado)', orgao: 'U.S. Department of Housing and Urban Development', medida: 'nivel', unidade: 'MIL', freq: 'mensal' },
  M2SL: { nome: 'Oferta monetária M2 — 12 meses', orgao: 'Board of Governors of the Federal Reserve System', medida: 'var12m', unidade: '%', freq: 'mensal' },
};
// Treasuries (DGS2/DGS10/DGS30) NÃO são buscadas aqui: já vêm direto do Tesouro dos EUA (sem duplicar).

const r2 = (n) => Math.round(n * 100) / 100;
export function lerCsvFred(texto, id) {
  const l = String(texto || '').trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),/i.test(l[0]) || !l[0].toUpperCase().includes(id)) throw new Error(`FRED ${id}: cabeçalho inesperado`);
  return l.slice(1).map((x) => x.split(',')).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0]) && c[1] !== '.' && c[1] !== '' && Number.isFinite(Number(c[1]))).map((c) => ({ data: c[0], valor: Number(c[1]) }));
}
export function lerApiFred(json, id) {
  if (!json || !Array.isArray(json.observations)) throw new Error(`FRED ${id}: resposta da API inesperada`);
  return json.observations.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.value !== '.' && Number.isFinite(Number(o.value))).map((o) => ({ data: o.date, valor: Number(o.value) }));
}
// transforma a série bruta na MEDIDA exibida (sempre com a data do período correspondente)
export function medir(pontos, medida) {
  // compara SEMPRE com a mesma data N meses antes (procura pela data, não pela posição: há meses sem publicação)
  const porData = new Map(pontos.map((p) => [p.data, p.valor]));
  const antes = (d, meses) => { const a = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - meses; const dt = new Date(Date.UTC(a, m - 1, 1)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${d.slice(8, 10)}`; };
  const out = [];
  for (const p of pontos) {
    let v = null;
    const b = (n) => porData.get(antes(p.data, n));
    if (medida === 'nivel') v = p.valor;
    else if (medida === 'var12m' || medida === 'var4t') { const a = b(12); if (a > 0) v = r2((p.valor / a - 1) * 100); }
    else if (medida === 'varMes') { const a = b(1); if (a > 0) v = r2((p.valor / a - 1) * 100); }
    else if (medida === 'difMes') { const a = b(1); if (a != null) v = r2(p.valor - a); }
    else if (medida === 'varTriAnual') { const a = b(3); if (a > 0) v = r2((Math.pow(p.valor / a, 4) - 1) * 100); }
    if (v !== null) out.push({ data: p.data, valor: v });
  }
  return out;
}
const mesesEntre = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export async function coletarFred({ fetch, chave = '', hoje, desde = '2015-01-01' }) {
  const series = {}; const erros = {};
  for (const [id, S] of Object.entries(SERIES)) {
    try {
      let pts;
      if (chave) {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(chave)}&file_type=json&observation_start=${desde}`;
        const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
        pts = lerApiFred(await r.json(), id);
      } else {
        const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${desde}`); if (!r.ok) throw new Error('HTTP ' + r.status);
        pts = lerCsvFred(await r.text(), id);
      }
      pts = pts.filter((p) => p.data >= desde && (!hoje || p.data <= hoje));
      const med = medir(pts, S.medida);
      if (!med.length) throw new Error('sem dados suficientes para a medida');
      const ult = med[med.length - 1];
      const extra = S.extra ? (medir(pts, S.extra).pop() || null) : null;
      series[id] = { id, nome: S.nome, unidade: S.unidade, frequencia: S.freq, medida: S.medida, valor: ult.valor, dataRef: ult.data, extra: extra ? { medida: S.extra, valor: extra.valor, dataRef: extra.data } : null,
        historico: med.slice(-60), atribuicao: `Fonte: ${S.orgao} via FRED®`, origem: chave ? 'api' : 'fredgraph.csv' };
    } catch (e) { erros[id] = String(e.message || e).replace(/api_key=[^&\s]+/g, 'api_key=***').slice(0, 160); }
  }
  return { series, erros };
}
