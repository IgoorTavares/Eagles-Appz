// Etapa 11.18 — FRED, SEC, brapi, validação dos arquivos do robô (Opção B) e camada de dados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { medir, lerCsvFred, coletarFred } from '../investimentos-portao/fred.mjs';
import { fundamentosDeFacts, cabecalhoSec, mascarar } from '../investimentos-portao/sec.mjs';
import { brapiLiberada, lerCotacoesBrapi, coletarBrapi, mascararToken } from '../investimentos-portao/brapi.mjs';
import { validarArquivo, gravarValidado, manifesto } from '../investimentos-portao/robo-dados.mjs';
const D = createRequire(import.meta.url)('../inv/inv-dados.js');

test('FRED: inflação é calculada do índice (12 meses e mês), compara pela DATA e não pela posição (mês faltando)', () => {
  const csv = 'observation_date,CPIAUCSL\n2025-01-01,100\n2025-02-01,101\n2025-03-01,\n2025-04-01,102\n2026-01-01,103\n2026-02-01,104.04\n2026-04-01,104.04\n';
  const pts = lerCsvFred(csv, 'CPIAUCSL');
  assert.equal(pts.length, 6, 'linha em branco ignorada (nunca vira zero)');
  const a12 = medir(pts, 'var12m');
  assert.deepEqual(a12, [{ data: '2026-01-01', valor: 3 }, { data: '2026-02-01', valor: 3.01 }, { data: '2026-04-01', valor: 2 }]);
  assert.deepEqual(medir(pts, 'varMes').find((p) => p.data === '2026-02-01'), { data: '2026-02-01', valor: 1.01 });
  assert.equal(medir(pts, 'varMes').find((p) => p.data === '2026-04-01'), undefined, 'sem o mês anterior, sem variação (não inventa)');
  assert.ok(!a12.some((p) => p.valor > 50), 'o nível do índice nunca aparece como taxa');
});

test('FRED: arquivo real do robô vira indicadores dos EUA com fonte, data e atribuição; nada no futuro', () => {
  const j = JSON.parse(readFileSync(new URL('../inv/dados/macro-us.json', import.meta.url), 'utf8'));
  const r = D.lerMacroUS(j, '2026-11-26');
  assert.ok(r && r.itens.CPI12M && r.itens.FEDFUNDS && r.itens.UNRATE);
  assert.ok(r.itens.CPI12M.valor > 0 && r.itens.CPI12M.valor < 20, 'CPI em % de 12 meses, não o nível do índice');
  assert.match(r.itens.CPI12M.atribuicao, /via FRED/);
  const ret = D.montarRetrato({ sgs: {}, macroUS: r }, { hoje: '2026-11-26' });
  assert.equal(ret.registros['US:MACRO:CPI12M'].fonte, 'fred');
  assert.equal(D.lerMacroUS(j, '2020-01-01'), null, 'dados com data depois de "hoje" são descartados');
  assert.equal(D.lerMacroUS({ formato: 'outro', series: {} }, '2026-11-26'), null);
});

test('FRED: com chave usa a API e a chave nunca aparece nos erros', async () => {
  const visto = [];
  const r = await coletarFred({ fetch: async (u) => { visto.push(u); return { ok: false, status: 500 }; }, chave: 'CHAVE-SECRETA-123', hoje: '2026-11-26' });
  assert.ok(visto[0].startsWith('https://api.stlouisfed.org/'));
  assert.ok(!JSON.stringify(r).includes('CHAVE-SECRETA-123'));
});

test('SEC: identificação obrigatória; fundamentos só do 10-K anual; indicadores só com os dois lados; e-mail mascarado', () => {
  assert.throws(() => cabecalhoSec(''), /SEC_CONTACT_EMAIL/);
  assert.equal(mascarar('falhou para fulano@exemplo.com', 'fulano@exemplo.com'), 'falhou para [contato]');
  const f = (val, end, start, form = '10-K', fp = 'FY', filed = '2026-02-01') => ({ val, end, start, form, fp, filed });
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [f(100, '2024-12-31', '2024-01-01'), f(120, '2025-12-31', '2025-01-01'), f(30, '2025-09-30', '2025-07-01', '10-Q', 'Q3')] } },
    NetIncomeLoss: { units: { USD: [f(10, '2024-12-31', '2024-01-01'), f(18, '2025-12-31', '2025-01-01')] } },
    StockholdersEquity: { units: { USD: [f(50, '2024-12-31'), f(70, '2025-12-31')] } },
    Assets: { units: { USD: [f(200, '2025-12-31')] } },
  } } };
  const a = fundamentosDeFacts(facts);
  assert.deepEqual(a.map((x) => x.ano), ['2024', '2025']);
  const y = a[1];
  assert.equal(y.receita, 120, 'trimestre (10-Q) não entra no anual');
  assert.equal(y.margemLiquida, 15); assert.equal(y.roe, 30); assert.equal(y.crescReceita, 20); assert.equal(y.crescLucro, 80);
  assert.equal(y.divida, null, 'sem a conta: null, nunca zero'); assert.equal(a[0].roe, null, 'sem o ano anterior: sem ROE');
});

test('brapi: preparada e DESLIGADA sem autorização comercial; token nunca aparece', async () => {
  assert.equal(brapiLiberada({}).ok, false);
  assert.equal(brapiLiberada({ BRAPI_TOKEN: 'x' }).ok, false, 'só o token não basta: precisa da autorização comercial');
  assert.equal(brapiLiberada({ BRAPI_TOKEN: 'x', BRAPI_USO_AUTORIZADO: 'sim' }).ok, true);
  let chamou = false;
  const r = await coletarBrapi({ fetch: async () => { chamou = true; }, env: { BRAPI_TOKEN: 'segredo' }, tickers: ['PETR4'] });
  assert.equal(r.desligada, true); assert.equal(chamou, false, 'desligada não faz nenhuma requisição');
  assert.deepEqual(lerCotacoesBrapi({ results: [{ symbol: 'PETR4', regularMarketPrice: 42.4, currency: 'BRL' }, { symbol: 'VALE3', regularMarketPrice: 0 }, { symbol: '<x>', regularMarketPrice: 9 }] }), { PETR4: { preco: 42.4, moeda: 'BRL', horario: null, estado: 'atrasado' } });
  assert.equal(mascararToken('erro token=abc segredo', 'segredo'), 'erro token=*** ***');
});

test('Opção B: só arquivo válido substitui o anterior (formato, anti-vazio, conteúdo malicioso, data futura, credencial)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eagles-dados-'));
  const bom = JSON.parse(readFileSync(new URL('../inv/dados/macro-us.json', import.meta.url), 'utf8'));
  assert.equal(gravarValidado(dir, 'macro-us.json', bom, { hoje: '2026-11-26' }).ok, true);
  const antes = readFileSync(join(dir, 'macro-us.json'), 'utf8');
  for (const [ruim, motivo] of [[{ formato: 'eagles-inv-macro-us-v1', series: {} }, /anti-vazio/], [Object.assign({}, bom, { formato: 'x' }), /formato/],
    [Object.assign({}, bom, { nota: '<script>alert(1)</script>' }), /suspeito/], [Object.assign({}, bom, { nota: 'javascript:alert(1)' }), /suspeito/],
    [Object.assign({}, bom, { series: Object.assign({}, bom.series, { X: { dataRef: '2099-01-01' } }) }), /futuro/], [Object.assign({}, bom, { u: 'x?api_key=abc' }), /credencial/]]) {
    const g = gravarValidado(dir, 'macro-us.json', ruim, { hoje: '2026-11-26' });
    assert.equal(g.ok, false); assert.match(g.erro, motivo); assert.equal(g.mantido, true);
    assert.equal(readFileSync(join(dir, 'macro-us.json'), 'utf8'), antes, 'o último arquivo válido continua');
  }
  assert.equal(validarArquivo('index.html', {}).ok, false, 'nada fora da lista de dados (nunca código)');
  assert.ok(!existsSync(join(dir, 'macro-us.json.tmp')), 'gravação atômica não deixa sobra');
  const m = manifesto(dir, '2026-11-26T20:00:00.000Z');
  assert.equal(m.formato, 'eagles-inv-manifesto-v1'); assert.match(m.arquivos['macro-us.json'].sha256, /^[0-9a-f]{64}$/);
});

test('status do robô: credenciais só como "configurada"/"ausente"; nenhum valor de segredo nos arquivos publicados', () => {
  const st = JSON.parse(readFileSync(new URL('../inv/dados/status.json', import.meta.url), 'utf8'));
  assert.equal(st.formato, 'eagles-inv-status-v1');
  for (const v of Object.values(st.credenciais)) assert.ok(['configurada', 'ausente'].includes(v));
  const dir = new URL('../inv/dados/', import.meta.url);
  for (const f of ['tesouro.json', 'noticias.json', 'macro-us.json', 'fundamentos-br.json', 'fundamentos-us.json', 'catalogo-us.json', 'status.json', 'manifesto.json']) {
    const t = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/api_key=|token=|Bearer |@[a-z0-9-]+\.(com|br|org)\b/i.test(t.replace(/"link":"[^"]*"/g, '')), f + ' sem credencial nem e-mail');
  }
});

test('fundamentos da CVM: arquivo real só com consolidadas, sem P/L, null nunca vira zero', () => {
  const j = JSON.parse(readFileSync(new URL('../inv/dados/fundamentos-br.json', import.meta.url), 'utf8'));
  assert.equal(j.formato, 'eagles-inv-fundamentos-br-v1'); assert.equal(j.licenca, 'ODbL'); assert.match(j.atribuicao, /CVM/);
  const petro = j.empresas['33000167000101'];
  assert.ok(petro && petro.anual.length >= 2, 'Petrobras com anos');
  const u = petro.anual[petro.anual.length - 1];
  assert.ok(u.receita > 1e11 && u.lucro > 1e10, 'valores em reais (escala MIL × 1000)');
  assert.ok(!/"(pl|pvp|precoLucro)"/i.test(JSON.stringify(j).replace(/"pl":/g, '')), 'sem P/L nem P/VP');
  for (const e of Object.values(j.empresas)) for (const a of e.anual) for (const k of ['receita', 'lucro', 'divida']) assert.ok(a[k] === null || Number.isFinite(a[k]));
});
