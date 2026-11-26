// Investimentos · EAGLES DATA ENGINE — adaptador da brapi (PREPARADO, DESLIGADO EM PRODUÇÃO)
// Licença (lida em 26/11/2026): o plano gratuito é "para validar a integração com dados e ativos de teste"; uso comercial só nos
// planos pagos (FAQ). Por isso este adaptador SÓ roda quando as DUAS condições existem no GitHub:
//   1) o segredo BRAPI_TOKEN; 2) a variável BRAPI_USO_AUTORIZADO = "sim" (só depois da autorização comercial por escrito da brapi).
// Mesmo ligado, o resultado é marcado "atrasado" e nunca "tempo real". O token nunca vai para arquivo, tela ou registro.
export function brapiLiberada(env = process.env) {
  if (!env.BRAPI_TOKEN) return { ok: false, motivo: 'credencial ausente (BRAPI_TOKEN)' };
  if (String(env.BRAPI_USO_AUTORIZADO || '').toLowerCase() !== 'sim') return { ok: false, motivo: 'uso comercial não autorizado pela brapi (BRAPI_USO_AUTORIZADO ≠ sim)' };
  return { ok: true };
}
export const mascararToken = (txt, token) => String(txt || '').split(token || '\u0000').join('***').replace(/token=[^&\s]+/gi, 'token=***');
// resposta /api/quote/{tickers} → { TICKER: { preco, moeda, horario } } (só números válidos; nada vira zero)
export function lerCotacoesBrapi(j) {
  if (!j || !Array.isArray(j.results)) throw new Error('brapi: resposta inesperada');
  const out = {};
  for (const r of j.results) {
    const tk = String((r && r.symbol) || '').toUpperCase(); const p = Number(r && r.regularMarketPrice);
    if (!/^[A-Z][A-Z0-9]{3}\d{1,2}[A-Z]?$/.test(tk) || !(p > 0)) continue;
    const t = r.regularMarketTime ? new Date(r.regularMarketTime) : null;
    out[tk] = { preco: p, moeda: r.currency === 'BRL' ? 'BRL' : null, horario: t && !isNaN(t) ? t.toISOString() : null, estado: 'atrasado' };
  }
  return out;
}
export async function coletarBrapi({ fetch, env = process.env, tickers = [] }) {
  const lib = brapiLiberada(env); if (!lib.ok) return { desligada: true, motivo: lib.motivo, cotacoes: {} };
  const token = env.BRAPI_TOKEN; const cotacoes = {}; const erros = {};
  for (const tk of tickers.slice(0, 50)) { // plano gratuito: 1 ativo por requisição; limite mensal baixo
    try { const r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(tk)}`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error('HTTP ' + r.status); Object.assign(cotacoes, lerCotacoesBrapi(await r.json())); }
    catch (e) { erros[tk] = mascararToken(e.message, token).slice(0, 120); }
  }
  return { desligada: false, cotacoes, erros };
}
