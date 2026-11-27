// Investimentos · EAGLES DATA ENGINE — robô de dados (Etapa 11)
// Gera os arquivos que o site serve em inv/dados/ a partir de fontes oficiais APROVADAS que não abrem direto no
// navegador (sem CORS ou grandes demais). Não usa chave, não usa IA, não inventa nada: se uma fonte falhar, o
// arquivo anterior é mantido e o erro é registrado (uma fonte fora do ar não derruba as outras).
//
// Uso:  node investimentos-portao/robo-dados.mjs --saida inv/dados [--tesouro-csv arquivo.csv] [--hoje AAAA-MM-DD]
//       (no GitHub Actions roda sem opções; aqui no ambiente local, com NODE_USE_ENV_PROXY=1 se houver proxy)
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { lerCsv, tickerTesouro } from './adaptadores.mjs';
import { coletarFred } from './fred.mjs';
import { fundamentosCVM } from './fundamentos-cvm.mjs';
import { coletarSec, mascarar } from './sec.mjs';
import { coletarBrapi, brapiLiberada } from './brapi.mjs';
import { coletarEnergia, coletarCambio, coletarMacroInt } from './fontes-internacionais.mjs';
import { gerarFundos, gerarFII } from './fundos-cvm.mjs';
import { publicar as publicarSnapshot, reter } from './eagles-dados.mjs';

const D = createRequire(import.meta.url)('../inv/inv-dados.js');
const SN = createRequire(import.meta.url)('../inv/inv-snapshot.js'); // v160: a MESMA validação do navegador (inv/inv-snapshot.js)
const UA = 'EaglesLabz-DataEngine/11 (robo de dados; eagleslabz.com.br)';
const TESOURO_CSV = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';
// só fontes de notícia APROVADAS e com as condições cumpridas (SEC aguarda o e-mail de contato do robô; BC aguarda os termos)
export const FEEDS = [{ fonte: 'noticias_fed', url: 'https://www.federalreserve.gov/feeds/press_all.xml', categoria: 'EUA · Federal Reserve', pais: 'US' }];
const HIST_PONTOS = 260; // ~1 ano de pregões por título

const dataBr = (s) => D.brParaIso(s);
const num = (s) => { const n = Number(String(s || '').trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// ---------- Tesouro Direto: CSV oficial → títulos em oferta na data mais recente + histórico do PU base ----------
export function tesouroDoCsv(texto, op = {}) {
  const regs = lerCsv(texto, ';');
  const col = ['Tipo Titulo', 'Data Vencimento', 'Data Base', 'Taxa Compra Manha', 'Taxa Venda Manha', 'PU Compra Manha', 'PU Venda Manha', 'PU Base Manha'];
  if (!regs.length || col.some((c) => !(c in regs[0]))) throw new Error('Tesouro: colunas esperadas não encontradas');
  const hoje = op.hoje || '9999-12-31';
  const linhas = [];
  for (const r of regs) {
    const base = dataBr(r['Data Base']); const venc = dataBr(r['Data Vencimento']);
    if (!base || !venc || base > hoje) continue;
    const t = tickerTesouro(r['Tipo Titulo'], venc); if (!t) continue;
    linhas.push({ base, venc, ticker: t.ticker, indexador: t.indexador, nome: `${String(r['Tipo Titulo']).trim()} ${venc.slice(0, 4)}`,
      taxaCompra: num(r['Taxa Compra Manha']), taxaVenda: num(r['Taxa Venda Manha']), puCompra: num(r['PU Compra Manha']), puVenda: num(r['PU Venda Manha']), puBase: num(r['PU Base Manha']) });
  }
  if (!linhas.length) throw new Error('Tesouro: nenhuma linha válida');
  const dataBase = linhas.reduce((m, l) => (l.base > m ? l.base : m), '');
  const titulos = {};
  for (const l of linhas.filter((x) => x.base === dataBase)) {
    if (!(l.puBase > 0)) continue; // sem preço válido: fica de fora (não inventamos)
    titulos[l.ticker] = { nome: l.nome, vencimento: l.venc, indexador: l.indexador, disponivel: true, puCompra: l.puCompra > 0 ? l.puCompra : null, puVenda: l.puVenda > 0 ? l.puVenda : null, puBase: l.puBase, taxaCompra: l.taxaCompra, taxaVenda: l.taxaVenda, historico: [] };
  }
  const porTicker = new Map();
  for (const l of linhas) if (titulos[l.ticker] && l.puBase > 0) { if (!porTicker.has(l.ticker)) porTicker.set(l.ticker, new Map()); porTicker.get(l.ticker).set(l.base, l.puBase); }
  for (const [tk, m] of porTicker) titulos[tk].historico = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-HIST_PONTOS);
  return { formato: 'eagles-inv-tesouro-v1', fonte: 'tesouro_direto', atribuicao: D.FONTES.tesouro_direto.atribuicao, licenca: D.FONTES.tesouro_direto.licenca, dataBase, coleta: op.coleta || new Date().toISOString(), titulos };
}

// ---------- validação de cada arquivo ANTES de substituir o anterior (Opção B: só dados, nunca código) ----------
// formato, tamanho, datas (nada no futuro), conteúdo malicioso e "anti-vazio": um arquivo inválido NUNCA substitui o último válido.
export const ARQUIVOS = {
  'tesouro.json': { formato: 'eagles-inv-tesouro-v1', max: 2.5e6, min: (o) => Object.keys(o.titulos || {}).length >= 10 },
  'noticias.json': { formato: 'eagles-inv-noticias-v1', max: 4e5, min: (o) => Array.isArray(o.itens) && o.itens.length >= 1 },
  'macro-us.json': { formato: 'eagles-inv-macro-us-v1', max: 5e5, min: (o) => Object.keys(o.series || {}).length >= 5 },
  'fundamentos-br.json': { formato: 'eagles-inv-fundamentos-br-v1', max: 3e6, min: (o) => Object.keys(o.empresas || {}).length >= 100 },
  'fundamentos-us.json': { formato: 'eagles-inv-fundamentos-us-v1', max: 2e6, min: (o) => o.indisponivel || Object.keys(o.empresas || {}).length >= 10 },
  'catalogo-us.json': { formato: 'eagles-inv-catalogo-us-v1', max: 2e6, min: (o) => o.indisponivel || (Array.isArray(o.itens) && o.itens.length >= 1000) },
  // v160: pequenos, servidos junto com o site (como os da v159)
  'energia.json': { formato: 'eagles-inv-energia-v1' }, 'cambio-int.json': { formato: 'eagles-inv-cambio-int-v1' }, 'macro-int.json': { formato: 'eagles-inv-macro-int-v1' },
};
// v160: fundos (índice + 128 arquivos de histórico) e FII mensal são grandes demais para o site: vão SÓ para o eagles-dados (--snapshots)
// v160: a validação é a do módulo compartilhado (formato, tamanho, anti-vazio, competência, datas, script, credencial,
// e-mail, campo privado e links só de domínios autorizados); só arquivos da lista entram.
export function validarArquivo(nome, obj, op = {}) {
  if (!ARQUIVOS[nome] && !/^fundos-|^fii-mensal/.test(nome)) return { ok: false, erros: ['arquivo fora da lista'] };
  const v = SN.validarConteudo(nome, obj, op); return { ok: v.ok, erros: v.erros, competencia: v.competencia };
}
// grava de forma atômica (arquivo temporário + troca), só se válido; senão mantém o anterior
export function gravarValidado(saida, nome, obj, op = {}) {
  const v = validarArquivo(nome, obj, op);
  const arq = join(saida, nome);
  if (!v.ok) return { ok: false, erro: v.erros.join('; '), mantido: existsSync(arq) };
  const tmp = arq + '.tmp'; writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, arq);
  return { ok: true };
}
export function manifesto(saida, coleta) {
  const arquivos = {};
  for (const nome of Object.keys(ARQUIVOS)) {
    const arq = join(saida, nome); if (!existsSync(arq)) continue;
    const b = readFileSync(arq); let fmt = null; try { fmt = JSON.parse(b).formato; } catch (e) { fmt = null; }
    arquivos[nome] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length, formato: fmt, modificado: statSync(arq).mtime.toISOString() };
  }
  return { formato: 'eagles-inv-manifesto-v1', versao: coleta.replace(/\D/g, '').slice(0, 14), coleta, arquivos };
}

async function baixar(url, tipo) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: tipo === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}
function gravar(arq, obj) { writeFileSync(arq, JSON.stringify(obj)); }

const SEGREDOS = ['FRED_API_KEY', 'SEC_CONTACT_EMAIL', 'BLS_API_KEY', 'BRAPI_TOKEN'];
async function principal() {
  const args = process.argv.slice(2); const pega = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const saida = pega('--saida') || 'inv/dados'; mkdirSync(saida, { recursive: true });
  const hoje = pega('--hoje') || new Date().toISOString().slice(0, 10);
  const coleta = new Date().toISOString();
  const so = (pega('--so') || 'tesouro,noticias,fred,cvm,sec,brapi,eia,cambio,worldbank,fundos,fii').split(',');
  const env = process.env; const emailSec = env.SEC_CONTACT_EMAIL || '';
  const limpa = (e) => mascarar(String((e && e.message) || e), emailSec).replace(/api_key=[^&\s]+/g, 'api_key=***').slice(0, 200);
  const relatorio = { coleta, hoje, fontes: {} };
  const reg = (id, r) => { relatorio.fontes[id] = Object.assign({ quando: coleta }, r); };
  // Tesouro Direto
  if (so.includes('tesouro')) try {
    const csv = pega('--tesouro-csv') ? readFileSync(pega('--tesouro-csv'), 'utf8') : await baixar(TESOURO_CSV, 'text');
    const t = tesouroDoCsv(csv, { hoje, coleta });
    const g = gravarValidado(saida, 'tesouro.json', t, { hoje });
    reg('tesouro_direto', g.ok ? { ok: true, dataBase: t.dataBase, registros: Object.keys(t.titulos).length } : { ok: false, erro: g.erro, mantido: g.mantido });
  } catch (e) { reg('tesouro_direto', { ok: false, erro: limpa(e), mantido: existsSync(join(saida, 'tesouro.json')) }); }
  // Notícias (título original, link e data; sem copiar o texto da matéria)
  if (so.includes('noticias')) {
    const itens = [];
    for (const f of FEEDS) {
      try { const xml = await baixar(f.url, 'text'); const lidos = D.lerFeed(xml, f.fonte, 40).map((x) => Object.assign(x, { categoria: f.categoria, pais: f.pais })); itens.push(...lidos); reg(f.fonte, { ok: true, registros: lidos.length }); }
      catch (e) { reg(f.fonte, { ok: false, erro: limpa(e) }); }
    }
    if (itens.length) {
      const vistos = new Set(); const unicos = itens.filter((x) => (vistos.has(x.link) ? false : (vistos.add(x.link), true)));
      unicos.sort((a, b) => (a.data < b.data ? 1 : -1));
      const g = gravarValidado(saida, 'noticias.json', { formato: 'eagles-inv-noticias-v1', coleta, itens: unicos.slice(0, 60), fontes: FEEDS.map((f) => ({ id: f.fonte, nome: D.FONTES[f.fonte].nome, atribuicao: D.FONTES[f.fonte].atribuicao, licenca: D.FONTES[f.fonte].licenca })) }, { hoje });
      if (!g.ok) reg('noticias_fed', { ok: false, erro: g.erro, mantido: g.mantido });
    }
  }
  // FRED (indicadores dos EUA): API com FRED_API_KEY, senão o download oficial fredgraph.csv
  if (so.includes('fred')) try {
    const r = await coletarFred({ fetch: (u) => fetch(u, { signal: AbortSignal.timeout(60000) }), chave: env.FRED_API_KEY || '', hoje });
    const g = gravarValidado(saida, 'macro-us.json', { formato: 'eagles-inv-macro-us-v1', fonte: 'fred', coleta, origem: env.FRED_API_KEY ? 'api' : 'fredgraph.csv', series: r.series, erros: r.erros }, { hoje });
    reg('fred', g.ok ? { ok: true, registros: Object.keys(r.series).length, falhas: Object.keys(r.erros).length, origem: env.FRED_API_KEY ? 'API (chave)' : 'download sem chave' } : { ok: false, erro: g.erro, mantido: g.mantido });
  } catch (e) { reg('fred', { ok: false, erro: limpa(e), mantido: existsSync(join(saida, 'macro-us.json')) }); }
  // CVM — fundamentos (DFP dos 2 últimos anos + ITR do ano)
  if (so.includes('cvm')) try {
    const ano = Number(hoje.slice(0, 4)); const dir = pega('--cvm-dir');
    const zip = async (tipo, a) => { const nome = `${tipo}_cia_aberta_${a}.zip`; if (dir && existsSync(join(dir, nome))) return readFileSync(join(dir, nome)); const r = await fetch(`https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/${tipo.toUpperCase()}/DADOS/${nome}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) }); if (!r.ok) throw new Error(`HTTP ${r.status} em ${nome}`); return Buffer.from(await r.arrayBuffer()); };
    const dfps = []; for (const a of [ano - 2, ano - 1]) { try { dfps.push(await zip('dfp', a)); } catch (e) { /* ano ainda sem DFP: segue com o que existe */ } }
    const itrs = []; try { itrs.push(await zip('itr', ano)); } catch (e) { try { itrs.push(await zip('itr', ano - 1)); } catch (e2) { /* sem ITR */ } }
    if (!dfps.length) throw new Error('nenhuma DFP disponível');
    const f = fundamentosCVM({ dfps, itrs, coleta });
    const g = gravarValidado(saida, 'fundamentos-br.json', f, { hoje });
    reg('cvm_fundamentos', g.ok ? { ok: true, registros: Object.keys(f.empresas).length } : { ok: false, erro: g.erro, mantido: g.mantido });
  } catch (e) { reg('cvm_fundamentos', { ok: false, erro: limpa(e), mantido: existsSync(join(saida, 'fundamentos-br.json')) }); }
  // SEC — catálogo dos EUA e fundamentos (só com o contato do robô; o e-mail nunca vai para arquivo nem registro)
  if (so.includes('sec')) {
    if (!emailSec) {
      reg('sec_edgar', { ok: false, erro: 'credencial ausente (SEC_CONTACT_EMAIL)', mantido: existsSync(join(saida, 'catalogo-us.json')) });
      for (const [nome, formato] of [['catalogo-us.json', 'eagles-inv-catalogo-us-v1'], ['fundamentos-us.json', 'eagles-inv-fundamentos-us-v1']]) if (!existsSync(join(saida, nome))) gravarValidado(saida, nome, { formato, coleta, indisponivel: 'Aguardando o segredo SEC_CONTACT_EMAIL no GitHub', itens: [], empresas: {} }, { hoje });
    } else try {
      const r = await coletarSec({ fetch: (u, o) => fetch(u, Object.assign({ signal: AbortSignal.timeout(60000) }, o)), email: emailSec, coleta });
      const j = JSON.parse(r.textoTickers); const ix = Object.fromEntries(j.fields.map((f, i) => [f, i]));
      const itens = j.data.filter((l) => ['Nasdaq', 'NYSE', 'CBOE'].includes(l[ix.exchange])).map((l) => ({ ticker: l[ix.ticker], nome: l[ix.name], bolsa: l[ix.exchange], cik: l[ix.cik] }));
      const g1 = gravarValidado(saida, 'catalogo-us.json', { formato: 'eagles-inv-catalogo-us-v1', fonte: 'sec_edgar', atribuicao: 'Source: U.S. Securities and Exchange Commission — EDGAR (company_tickers_exchange.json)', coleta, itens }, { hoje });
      const g2 = gravarValidado(saida, 'fundamentos-us.json', r.fundamentos, { hoje });
      reg('sec_edgar', g1.ok && g2.ok ? { ok: true, registros: itens.length, fundamentos: Object.keys(r.fundamentos.empresas).length, falhas: Object.keys(r.erros).length } : { ok: false, erro: [g1.erro, g2.erro].filter(Boolean).join(' | '), mantido: true });
    } catch (e) { reg('sec_edgar', { ok: false, erro: limpa(e), mantido: existsSync(join(saida, 'catalogo-us.json')) }); }
  }
  // brapi — preparada e DESLIGADA (licença comercial pendente); nunca publica nada sem autorização
  if (so.includes('brapi')) { const lib = brapiLiberada(env); reg('brapi', lib.ok ? Object.assign({ ok: true }, await coletarBrapi({ fetch, env, tickers: ['PETR4'] }).then((x) => ({ registros: Object.keys(x.cotacoes).length, publicado: false }))) : { ok: false, desligada: true, erro: lib.motivo }); }
  // v160 — energia (EIA via FRED), câmbio internacional (BCE, Fed H.10, Banco do Canadá) e macro internacional (Banco Mundial)
  const net = (u, o) => fetch(u, Object.assign({ headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) }, o));
  for (const [id, nome, fn] of [['eia_fred', 'energia.json', coletarEnergia], ['cambio_int', 'cambio-int.json', coletarCambio], ['worldbank', 'macro-int.json', coletarMacroInt]]) {
    if (!so.includes(id.split('_')[0]) && !so.includes(id)) continue;
    try { const o = Object.assign(await fn({ fetch: net, hoje }), { coleta }); const g = gravarValidado(saida, nome, o, { hoje });
      reg(id, g.ok ? { ok: true, registros: Object.keys(o.series || o.pares || o.paises || {}).length, falhas: Object.keys(o.erros || {}).length } : { ok: false, erro: g.erro, mantido: g.mantido });
    } catch (e) { reg(id, { ok: false, erro: limpa(e), mantido: existsSync(join(saida, nome)) }); }
  }
  // v160 — fundos (CVM Cadastro + Informe Diário) e FII (Informe Mensal): SÓ para o repositório de dados (eagles-dados)
  const repoDados = pega('--snapshots');
  if (repoDados && (so.includes('fundos') || so.includes('fii'))) {
    const entradas = {}; const dirF = pega('--cvm-fundos-dir');
    const baixarZip = async (rel) => { const nome = rel.split('/').pop(); if (dirF && existsSync(join(dirF, nome))) return readFileSync(join(dirF, nome)); const r = await fetch('https://dados.cvm.gov.br/dados/' + rel, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) }); if (!r.ok) throw new Error(`HTTP ${r.status} em ${nome}`); return Buffer.from(await r.arrayBuffer()); };
    let cat = null; try { cat = JSON.parse(readFileSync(new URL('../inv/catalogo/ativos.json', import.meta.url), 'utf8')); } catch (e) { cat = { itens: [] }; }
    if (so.includes('fundos')) try {
      const meses = []; const d0 = new Date(hoje + 'T12:00:00Z'); for (let i = 12; i >= 0; i--) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); meses.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
      const zips = []; for (const m of meses) { try { zips.push(await baixarZip(`FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${m}.zip`)); } catch (e) { if (m === meses[meses.length - 1] || m === meses[meses.length - 2]) throw e; } }
      const r = gerarFundos({ cadastroZip: await baixarZip('FI/CAD/DADOS/registro_fundo_classe.zip'), informesZip: zips, hoje, coleta, catalogo: cat });
      entradas['fundos-indice.json'] = { obj: r.indice }; for (const [n, o] of Object.entries(r.shards)) entradas[n] = { obj: o };
    } catch (e) { entradas['fundos-indice.json'] = { erro: limpa(e) }; }
    if (so.includes('fii')) try {
      const a = +hoje.slice(0, 4); const zips = []; for (const ano of [a - 1, a]) { try { zips.push(await baixarZip(`FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${ano}.zip`)); } catch (e) { if (ano === a) throw e; } }
      entradas['fii-mensal.json'] = { obj: gerarFII({ zips, hoje, coleta, catalogo: cat }) };
    } catch (e) { entradas['fii-mensal.json'] = { erro: limpa(e) }; }
    // os arquivos pequenos também entram no snapshot (o eagles-dados tem o conjunto completo)
    for (const n of Object.keys(ARQUIVOS)) if (existsSync(join(saida, n))) { try { entradas[n] = { obj: JSON.parse(readFileSync(join(saida, n), 'utf8')) }; } catch (e) { entradas[n] = { erro: 'ilegível' }; } }
    try { const p = publicarSnapshot(repoDados, entradas, { agora: coleta, hoje }); const ret = reter(repoDados, Number(pega('--reter')) || 7);
      const falhas = Object.entries(p.relatorio).filter(([, x]) => !x.ok); reg('eagles_dados', { ok: true, sequencia: p.sequencia, arquivos: Object.keys(p.relatorio).length, falhas: falhas.length, retencao: ret.snapshotsApagados.length });
      for (const [n, x] of falhas) reg('eagles_dados:' + n, { ok: false, erro: x.erro, mantido: x.mantido });
    } catch (e) { reg('eagles_dados', { ok: false, erro: limpa(e) }); }
  }
  // status (sem valores de segredo: só "configurada"/"ausente") + histórico de falhas + manifesto (sha256 de cada arquivo)
  let anterior = null; try { anterior = JSON.parse(readFileSync(join(saida, 'status.json'), 'utf8')); } catch (e) { anterior = null; }
  const falhasAgora = Object.entries(relatorio.fontes).filter(([, x]) => !x.ok && !x.desligada).map(([id, x]) => ({ fonte: id, quando: coleta, erro: x.erro, mantido: !!x.mantido }));
  const historicoFalhas = falhasAgora.concat((anterior && Array.isArray(anterior.historicoFalhas) ? anterior.historicoFalhas : [])).slice(0, 40);
  const fontesStatus = Object.assign({}, anterior && anterior.fontes, relatorio.fontes);
  for (const [id, x] of Object.entries(relatorio.fontes)) if (x.ok) fontesStatus[id].ultimaOk = coleta; else if (anterior && anterior.fontes && anterior.fontes[id] && anterior.fontes[id].ultimaOk) fontesStatus[id].ultimaOk = anterior.fontes[id].ultimaOk;
  const status = { formato: 'eagles-inv-status-v1', coleta, hoje, fontes: fontesStatus, credenciais: Object.fromEntries(SEGREDOS.map((k) => [k, env[k] ? 'configurada' : 'ausente'])), historicoFalhas };
  writeFileSync(join(saida, 'status.json.tmp'), JSON.stringify(status)); renameSync(join(saida, 'status.json.tmp'), join(saida, 'status.json'));
  const man = manifesto(saida, coleta); writeFileSync(join(saida, 'manifesto.json.tmp'), JSON.stringify(man)); renameSync(join(saida, 'manifesto.json.tmp'), join(saida, 'manifesto.json'));
  const txt = JSON.stringify(relatorio, null, 1);
  console.log(emailSec ? txt.split(emailSec).join('[contato]') : txt);
  if (Object.values(relatorio.fontes).every((x) => !x.ok)) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) principal();
