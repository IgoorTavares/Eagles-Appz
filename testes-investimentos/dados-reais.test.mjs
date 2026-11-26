// Etapa 11 — camada de dados REAIS (inv/inv-dados.js) e robô (investimentos-portao/robo-dados.mjs).
// Usa RESPOSTAS REAIS guardadas em testes-investimentos/respostas-reais/ (coletadas das fontes oficiais; ver coletado-em.txt).
// Roda sem rede: o que se prova aqui é que a leitura dessas respostas reais é exata e segura.
// Uso: node --test testes-investimentos/dados-reais.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tesouroDoCsv } from '../investimentos-portao/robo-dados.mjs';
const req = createRequire(import.meta.url);
const D = req('../inv/inv-dados.js');
const K = req('../inv/inv-mercado.js');
const R = (f) => readFileSync(new URL('./respostas-reais/' + f, import.meta.url), 'utf8');
const HOJE = '2026-11-26';

test('SGS (Meta Selic): corta as datas FUTURAS que a série publica e fica com o valor vigente até hoje', () => {
  const bruto = JSON.parse(R('sgs-432-meta-selic.json'));
  assert.ok(bruto.some((p) => D.brParaIso(p.data) > HOJE), 'a resposta real traz datas futuras (motivo do corte)');
  const pts = D.lerSGS(bruto, HOJE);
  assert.ok(pts.length > 0 && pts.every((p) => p.data <= HOJE));
  const ult = pts[pts.length - 1];
  const original = bruto.filter((p) => D.brParaIso(p.data) === ult.data)[0];
  assert.equal(ult.valor, Number(original.valor), 'mesmo número da resposta oficial');
  assert.ok(pts.every((p, i) => i === 0 || pts[i - 1].data < p.data), 'ordenado e sem datas repetidas');
});

test('SGS (CDI e IPCA 12 meses): números exatos, unidades certas, datas válidas', () => {
  const cdi = D.lerSGS(JSON.parse(R('sgs-4389-cdi.json')), HOJE);
  const bru = JSON.parse(R('sgs-4389-cdi.json'));
  assert.equal(cdi[cdi.length - 1].valor, Number(bru.filter((p) => D.brParaIso(p.data) <= HOJE).pop().valor));
  assert.ok(cdi.every((p) => p.valor > 0 && p.valor < 100), 'CDI em % ao ano');
  const ipca = D.lerSGS(JSON.parse(R('sgs-13522-ipca12m.json')), HOJE);
  assert.ok(ipca.every((p) => p.data.endsWith('-01')), 'série mensal: dia 01 de cada mês');
  assert.equal(D.SERIES_BCB.CDI.unidade, '%aa'); assert.equal(D.SERIES_BCB.IPCA.unidade, '%am'); assert.equal(D.SERIES_BCB.IPCA12M.unidade, '%');
  assert.equal(D.SERIES_BCB.SELIC.sgs, 432); assert.equal(D.SERIES_BCB.CDI.sgs, 4389); assert.equal(D.SERIES_BCB.IPCA12M.sgs, 13522); assert.equal(D.SERIES_BCB.USDBRL.sgs, 1);
  assert.throws(() => D.lerSGS({ erro: 'x' }, HOJE)); // resposta inesperada não vira número
  assert.deepEqual(D.lerSGS([{ data: '31/02/2026', valor: '1' }, { data: '01/01/2026', valor: 'abc' }, { data: '02/01/2026', valor: '' }], HOJE), [], 'data impossível e valor inválido são descartados');
});

test('PTAX: último boletim até hoje, compra e venda da resposta oficial', () => {
  const j = JSON.parse(R('ptax.json'));
  const p = D.lerPTAX(j, HOJE);
  const ult = j.value.filter((x) => x.dataHoraCotacao.slice(0, 10) <= HOJE).sort((a, b) => (a.dataHoraCotacao < b.dataHoraCotacao ? -1 : 1)).pop();
  assert.equal(p.venda, ult.cotacaoVenda); assert.equal(p.compra, ult.cotacaoCompra); assert.equal(p.data, ult.dataHoraCotacao.slice(0, 10));
  assert.ok(p.venda > p.compra, 'venda acima da compra');
});

test('Focus: expectativas por indicador e ano, com data e respondentes (marcadas como EXPECTATIVA)', () => {
  const j = JSON.parse(R('focus.json'));
  const f = D.lerFocus(j);
  assert.ok(f.IPCA && f.Selic);
  const anos = Object.keys(f.IPCA); assert.ok(anos.length >= 1 && anos.every((a) => /^\d{4}$/.test(a)));
  for (const a of anos) {
    const x = f.IPCA[a]; const mais = j.value.filter((v) => v.Indicador === 'IPCA' && v.DataReferencia === a).sort((p, q) => (p.Data < q.Data ? 1 : -1))[0];
    assert.equal(x.mediana, mais.Mediana); assert.equal(x.data, mais.Data.slice(0, 10)); assert.ok(x.respondentes > 0);
  }
  const ret = D.montarRetrato({ focus: f }, { hoje: HOJE });
  assert.equal(ret.registros['BR:FOCUS'].tipo, 'expectativa');
});

test('Curva diária do Tesouro dos EUA: taxa de 10 anos igual à linha do CSV oficial', () => {
  const csv = R('ust-2026.csv');
  const c = D.lerCurvaUST(csv, HOJE);
  const linha = csv.split('\n')[1].split(','); // linha mais recente
  const ult = c[c.length - 1];
  assert.equal(ult.data, D.usParaIso(linha[0]));
  const cab = csv.split('\n')[0].split(',').map((x) => x.replace(/"/g, ''));
  assert.equal(ult.taxas['10 Yr'], Number(linha[cab.indexOf('10 Yr')]));
  assert.throws(() => D.lerCurvaUST('a,b\n1,2', HOJE), /colunas inesperadas/);
});

test('Tesouro Direto (robô): preço e taxa de cada título iguais às linhas do CSV oficial; só títulos em oferta na data mais recente', () => {
  const csv = R('tesouro-amostra.csv');
  const t = tesouroDoCsv(csv, { hoje: HOJE, coleta: '2026-11-26T12:00:00Z' });
  assert.equal(t.dataBase, '2026-11-19');
  const linha = csv.split('\n').find((l) => l.startsWith('Tesouro Selic;01/03/2029;19/11/2026'));
  const c = linha.split(';');
  const x = t.titulos['SELIC-2029'];
  assert.equal(x.puBase, Number(c[7].replace(',', '.'))); assert.equal(x.puCompra, Number(c[5].replace(',', '.'))); assert.equal(x.taxaCompra, Number(c[3].replace(',', '.')));
  assert.equal(x.historico.length, 2, 'duas datas na amostra (18 e 19/11)'); assert.deepEqual(x.historico.map((h) => h[0]), ['2026-11-18', '2026-11-19']);
  assert.ok(Object.values(t.titulos).every((y) => y.disponivel && y.puBase > 0));
  assert.match(t.licenca, /ODbL/); assert.match(t.atribuicao, /Tesouro Nacional/);
  assert.throws(() => tesouroDoCsv('a;b\n1;2', {}), /colunas/);
});

test('Notícias reais (Fed): título original, link https e data; feed malicioso não passa HTML, script nem link perigoso', () => {
  const itens = D.lerFeed(R('fed-press.xml'), 'noticias_fed', 50);
  assert.ok(itens.length >= 5);
  assert.ok(itens.every((n) => /^https:\/\/www\.federalreserve\.gov\//.test(n.link) && !/[<>]/.test(n.titulo) && !Number.isNaN(Date.parse(n.data))));
  const mau = `<rss><channel>
    <item><title><![CDATA[<script>alert(1)</script>Juros <b>sobem</b>]]></title><link>javascript:alert(1)</link><pubDate>Wed, 25 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Ok &lt;img src=x onerror=alert(1)&gt;</title><link>https://exemplo.gov/a"onmouseover="x</link><pubDate>Wed, 25 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Válida</title><link>https://www.federalreserve.gov/x.htm</link><pubDate>Wed, 25 Nov 2026 11:00:00 GMT</pubDate></item>
    <item><title>Sem data</title><link>https://www.federalreserve.gov/y.htm</link></item></channel></rss>`;
  const r = D.lerFeed(mau, 'noticias_fed');
  assert.equal(r.length, 1, 'só a notícia válida: link javascript:, link com aspas e item sem data ficam de fora'); assert.equal(r[0].titulo, 'Válida');
  assert.equal(D.limparTexto('<script>x</script>Título'), 'x Título'); // tags viram texto puro (a tela ainda escapa tudo)
  assert.equal(D.linkSeguro('javascript:alert(1)'), ''); assert.equal(D.linkSeguro('http://inseguro.gov/x'), '');
});

test('estado pela idade: fechamento dentro do prazo da série; desatualizado depois (o número continua real, com a data)', () => {
  assert.equal(D.estadoPelaIdade('2026-11-25', HOJE, 7), 'fechamento');
  assert.equal(D.estadoPelaIdade('2026-11-01', HOJE, 7), 'desatualizado');
  assert.equal(D.estadoPelaIdade(null, HOJE, 7), 'indisponivel');
  assert.ok(K.ESTADOS.desatualizado.real && K.ESTADOS.historico.real && !K.ESTADOS.manual.real && !K.ESTADOS.simulado.real && !K.ESTADOS.indisponivel.real);
  for (const e of ['tempo-real', 'atrasado', 'fechamento', 'historico', 'manual', 'desatualizado', 'indisponivel', 'simulado']) assert.ok(K.ESTADOS[e], 'estado obrigatório: ' + e);
});

test('registro padronizado tem todos os campos exigidos; adaptadores nunca inventam valor', () => {
  const sgs = { SELIC: D.lerSGS(JSON.parse(R('sgs-432-meta-selic.json')), HOJE), CDI: D.lerSGS(JSON.parse(R('sgs-4389-cdi.json')), HOJE) };
  const ret = D.montarRetrato({ sgs, ptax: D.lerPTAX(JSON.parse(R('ptax.json')), HOJE), ust: D.lerCurvaUST(R('ust-2026.csv'), HOJE) }, { hoje: HOJE, coleta: '2026-11-26T15:00:00Z' });
  const r = ret.registros['BR:MACRO:SELIC'];
  for (const k of ['id', 'ticker', 'nome', 'classe', 'mercado', 'bolsa', 'moeda', 'valor', 'unidade', 'fonte', 'dataRef', 'dataColeta', 'frequencia', 'estado', 'licenca', 'versao']) assert.ok(k in r, 'campo: ' + k);
  assert.match(r.licenca, /ODbL/); assert.equal(r.serie, 'SGS 432'); assert.equal(r.dataColeta, '2026-11-26T15:00:00Z');
  const ar = D.criarAdaptadorRetrato(ret);
  assert.equal(ar.cotacao({ assetId: 'BR:MACRO:IPCA12M' }), null, 'série não carregada: nada (não inventa)');
  assert.equal(ar.cotacao({ assetId: 'BR:MACRO:USDBRL' }).preco, ret.registros['BR:MACRO:PTAX'].valor, 'o dólar do sistema é a PTAX');
  const at = D.criarAdaptadorTesouro(tesouroDoCsv(R('tesouro-amostra.csv'), { hoje: HOJE }), HOJE);
  assert.equal(at.cotacao({ classe: 'acao', ticker: 'PETR4' }), null, 'o adaptador do Tesouro só responde por títulos do Tesouro');
  assert.equal(at.cotacao({ classe: 'tesouro', ticker: 'NAO-EXISTE' }), null);
  // motor: com o dado real ligado, Selic e Tesouro saem reais; índice de bolsa sem fonte fica indisponível (nunca simulado no motor real)
  const M = K.criarMotor({ adaptadores: { bcb: ar, ust: ar, tesouro: at, manual: K.criarManual({}) }, ligados: { bcb: true, ust: true, tesouro: true }, simulador: false });
  const sel = M.cotacao(K.MACRO.BR.find((x) => x.ticker === 'SELIC')); assert.equal(sel.preco, r.valor); assert.ok(sel.real); assert.equal(sel.fonte, 'bcb');
  const t29 = M.cotacao({ assetId: 'BR:TESOURO:SELIC-2029', ticker: 'SELIC-2029', classe: 'tesouro', pais: 'BR', moeda: 'BRL' }); assert.ok(t29.real && t29.preco > 0 && t29.fonte === 'tesouro');
  const ibov = M.cotacao(K.INDICES.BR[0]); assert.equal(ibov.estado, 'indisponivel'); assert.equal(ibov.preco, null);
  const ust = M.cotacao(K.MACRO.US.find((x) => x.ticker === 'UST10Y')); assert.ok(ust.real && ust.fonte === 'ust');
});

test('carregador: deduplica pedidos iguais, usa cache com prazo, isola falhas e respeita o tempo-limite', async () => {
  let agora = Date.parse('2026-11-26T12:00:00Z'); const chamadas = [];
  const mem = new Map(); const arm = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
  const resposta = (corpo, ok = true, status = 200) => ({ ok, status, json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo), text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
  const fake = async (url, op) => {
    chamadas.push(url);
    if (/sgs\.432\//.test(url)) return resposta(R('sgs-432-meta-selic.json'));
    if (/sgs\.4389\//.test(url)) return resposta('{"quebrado":'.slice(0, 5), true); // JSON inválido: erro só desta série
    if (/sgs\./.test(url)) return resposta([], false, 500);                       // fora do ar
    if (/PTAX/.test(url)) return new Promise((_, nao) => { op.signal.addEventListener('abort', () => nao(Object.assign(new Error('abortado'), { name: 'AbortError' }))); }); // nunca responde
    if (/Expectativas/.test(url)) return resposta(R('focus.json'));
    if (/treasury/.test(url)) return resposta(R('ust-2026.csv'));
    if (/tesouro\.json/.test(url)) return resposta(tesouroDoCsv(R('tesouro-amostra.csv'), { hoje: HOJE }));
    if (/noticias\.json/.test(url)) return resposta({ itens: D.lerFeed(R('fed-press.xml'), 'noticias_fed') });
    return resposta('', false, 404);
  };
  const c = D.criarCarregador({ fetch: fake, armazenamento: arm, agora: () => agora, hoje: HOJE, timeoutMs: 300 });
  const [a, b] = await Promise.all([c.carregarTudo(), c.carregarTudo()]);
  const n1 = chamadas.length;
  assert.equal(chamadas.filter((u) => /sgs\.432\//.test(u)).length, 1, 'duas telas pedindo ao mesmo tempo = uma requisição');
  assert.ok(a.registros['BR:MACRO:SELIC'] && b.registros['BR:MACRO:SELIC']);
  assert.ok(a.registros['US:MACRO:UST10Y'] && a.registros['BR:FOCUS'] && a.tesouro && a.noticias, 'as outras fontes funcionam mesmo com falhas');
  assert.equal(a.registros['BR:MACRO:CDI'], undefined, 'JSON inválido não vira número'); assert.equal(a.registros['BR:MACRO:PTAX'], undefined, 'sem resposta no prazo: indisponível');
  const st = c.status();
  assert.match(st.bcb_ptax.ultimoErro, /sem resposta/); assert.ok(st.bcb_sgs.erros >= 8);
  await c.carregarTudo();
  assert.ok(chamadas.length - n1 < n1, 'o que deu certo vem do cache na 2ª carga');
  assert.ok(c.status().bcb_sgs.doCache >= 1);
  agora += 7 * 3600 * 1000; const n2 = chamadas.length; await c.carregarTudo();
  assert.ok(chamadas.slice(n2).some((u) => /sgs\.432\//.test(u)), 'passado o prazo (6 h), busca de novo');
  // fonte desligada pelo Super Admin nesta sessão não é chamada
  const c2 = D.criarCarregador({ fetch: fake, armazenamento: null, hoje: HOJE, timeoutMs: 300, desligadas: { ust_curva: true } });
  const n3 = chamadas.length; const r2 = await c2.carregarTudo();
  assert.ok(!chamadas.slice(n3).some((u) => /treasury/.test(u))); assert.equal(r2.registros['US:MACRO:UST10Y'], undefined);
});

test('central de licenças: só liga o que tem licença aprovada e integração; nada pago, nada com chave no navegador', () => {
  const ligadas = Object.keys(D.FONTES).filter(D.ligada).sort();
  assert.deepEqual(ligadas, ['bcb_focus', 'bcb_ptax', 'bcb_sgs', 'cvm', 'fred', 'noticias_fed', 'sec_edgar', 'tesouro_direto', 'tradingview', 'ust_curva']);
  for (const id of ligadas) { const F = D.FONTES[id]; assert.ok(F.evidencia && F.licenca && F.atribuicao, 'evidência e atribuição: ' + id); assert.equal(F.chave, false); assert.equal(F.custo, 'R$ 0'); }
  for (const id of ['ibge', 'bls', 'noticias_bcb', 'coinbase', 'kraken', 'mercado_bitcoin']) assert.equal(D.FONTES[id].estado, 'aguardando', id);
  for (const id of ['b3', 'brapi', 'google_finance']) assert.equal(D.FONTES[id].estado, 'incompativel', id); // brapi grátis = só teste; Google proíbe copiar
  for (const id of ['coingecko', 'binance']) assert.equal(D.FONTES[id].estado, 'indisponivel', id);
  assert.equal(D.FONTES.tradingview.modo, 'incorporado'); // gráfico desenhado pelo TradingView; o sistema não lê os números
  assert.ok(Object.values(D.FONTES).every((F) => F.estado === 'aprovada' || F.estado === 'aprovada-condicoes' || F.motivo), 'toda fonte desligada diz o motivo');
  const fonte = readFileSync(new URL('../inv/inv-dados.js', import.meta.url), 'utf8');
  assert.ok(!/api[_-]?key|token=|Bearer |x-api-key|openai|anthropic|gemini|x\.ai/i.test(fonte), 'nenhuma chave nem IA na camada de dados');
});

test('Google Finance só como link; TradingView numa janela isolada, sem script de terceiros na página e sem código malicioso', () => {
  const M = createRequire(import.meta.url)('../inv/inv-motor.js');
  const petr = { assetId: 'BR:B3:PETR4', ticker: 'PETR4', nome: 'PETROBRAS', bolsa: 'B3', classe: 'acao', pais: 'BR', ids: {} };
  M.definirConfirmadosTV(null);
  assert.equal(M.linkGoogleFinance(petr), null, 'sem confirmação, nenhum link "no chute"');
  assert.deepEqual(M.opcoesTradingView(petr), [], 'sem confirmação, nenhum gráfico "no chute"');
  const conf = JSON.parse(readFileSync(new URL('../inv/catalogo/tradingview.json', import.meta.url), 'utf8'));
  assert.ok(M.definirConfirmadosTV(conf) > 600, 'símbolos confirmados carregados');
  assert.equal(M.linkGoogleFinance(petr), 'https://www.google.com/finance/quote/PETR4:BVMF?hl=pt');
  assert.equal(M.linksExternos(petr)[0].id, 'google-finance');
  assert.equal(M.simboloTradingView(petr), 'BMFBOVESPA:PETR4');
  assert.equal(M.opcoesTradingView(petr)[0].atraso, '15min');
  assert.equal(M.linkGoogleFinance({ assetId: 'US:NYSE:BRK.B', ticker: 'BRK.B', bolsa: 'NYSE', classe: 'acao', pais: 'US' }), 'https://www.google.com/finance/quote/BRK.B:NYSE?hl=pt');
  for (const ruim of ['"><script>', "PETR4'", 'a b', '../x', 'javascript:1']) { assert.equal(M.simboloTradingView({ assetId: 'BR:B3:' + ruim, ticker: ruim, bolsa: 'B3', classe: 'acao' }), null, ruim); assert.equal(M.linkGoogleFinance({ assetId: 'BR:B3:' + ruim, ticker: ruim, bolsa: 'B3', classe: 'acao' }), null, ruim); assert.equal(M.urlGraficoTradingView(ruim), null, ruim); }
  // arquivo de confirmações adulterado: símbolo malicioso é ignorado
  assert.equal(M.definirConfirmadosTV({ formato: 'eagles-inv-tradingview-v1', itens: { 'BR:B3:XXXX3': { s: 'X:"><img onerror=1>', atraso: '15min' } } }), 0);
  M.definirConfirmadosTV(conf);
  assert.equal(M.simboloTradingView({ assetId: 'BR:TESOURO:SELIC-2029', ticker: 'SELIC-2029', bolsa: 'TESOURO', classe: 'tesouro' }), null);
  // referências confirmadas (cripto com bolsa e par; índices oficiais exclusivos do site do TradingView ficam de fora)
  assert.deepEqual(M.opcoesTradingView({ assetId: 'CRYPTO:-:BTC' }).map((o) => o.par), ['BTC/BRL', 'BTC/USD', 'BTC/USDT']);
  assert.ok(M.opcoesTradingView({ assetId: 'CRYPTO:-:BTC' }).every((o) => o.atraso === 'indicativo' && o.fonte));
  assert.ok(!JSON.stringify(M.TV_REF).includes('SP:SPX') && !JSON.stringify(M.TV_REF).includes('NASDAQ:IXIC'));
  assert.ok(!Object.values(M.TV_ATRASO).some((t) => /tempo real/i.test(t)), 'nenhum rótulo diz "tempo real"');
  const u = M.urlGraficoTradingView(M.simboloTradingView(petr), { tema: 'dark', fundo: '#101418' });
  assert.ok(u.startsWith('https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=br#'));
  const cfg = JSON.parse(decodeURIComponent(u.split('#')[1]));
  assert.equal(cfg.symbol, 'BMFBOVESPA:PETR4'); assert.equal(cfg.theme, 'dark'); assert.equal(cfg.allow_symbol_change, false); assert.equal(cfg.backgroundColor, '#101418');
  assert.ok(!/tenant|uid|carteira|email|utm_|page-uri/i.test(decodeURIComponent(u)), 'nenhum identificador privado no endereço do gráfico');
  const bib = readFileSync(new URL('../inv/inv-biblioteca.js', import.meta.url), 'utf8');
  assert.ok(!/s3\.tradingview\.com|embed-widget-[a-z-]+\.js/.test(bib), 'nenhum script do TradingView carregado na nossa página');
  assert.ok(/setAttribute\('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'\)/.test(bib), 'janela isolada (sandbox sem allow-top-navigation, sem allow-forms)');
  assert.ok(/referrerPolicy = 'no-referrer'/.test(bib), 'sem referenciador');
  assert.ok(/por TradingView/.test(bib), 'atribuição visível');
});
