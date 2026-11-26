// Etapa 08 — News Engine, Search Engine, Analytics Engine e AI Engine (desligado), sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const N = require('../inv/inv-noticias.js'), AN = require('../inv/inv-analise.js'), IA = require('../inv/inv-ia.js'), CT = require('../inv/inv-carteira.js');
const XML = readFileSync(new URL('./noticias-teste.xml', import.meta.url), 'utf8');
const FAV = [{ assetId: 'BR:B3:ZZTA3', ticker: 'ZZTA3', nomeCurto: 'ZZT Alfa' }];

test('RSS e Atom: título, link original, data e resumo curto; sem HTML; sem link = fora', () => {
  const rss = '<rss><channel><item><title>A &amp; B</title><link>https://ex.invalid/a?utm=1</link><pubDate>Tue, 25 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>Texto <img src=x onerror=alert(1)> longo ' + 'palavra '.repeat(80) + '</p>]]></description></item><item><title>Sem link</title></item><item><title>JS</title><link>javascript:alert(1)</link></item></channel></rss>';
  const l = N.lerFeed(rss, 'teste');
  assert.equal(l.length, 1); assert.equal(l[0].titulo, 'A & B'); assert.equal(l[0].data, '2026-11-25T10:00:00.000Z');
  assert.ok(l[0].resumo.length <= N.RESUMO_MAX + 1 && l[0].resumo.endsWith('…')); assert.ok(!/[<>]/.test(l[0].resumo));
  const atom = '<feed><entry><title type="html">Atom &lt;b&gt;x&lt;/b&gt;</title><link href="https://ex.invalid/b"/><updated>2026-11-24T08:00:00Z</updated><summary>Resumo</summary></entry></feed>';
  const a = N.lerFeed(atom, 'teste'); assert.equal(a[0].link, 'https://ex.invalid/b'); assert.equal(a[0].titulo, 'Atom x');
});

test('classificação, favoritos, duplicadas e fontes desligadas', () => {
  const r = N.processar({ teste: XML, bcb: XML, inventada: XML }, FAV);
  assert.equal(r.itens.length, 10); assert.equal(r.removidas, 1);
  assert.ok(r.erros.some((e) => /bcb: fonte desligada/.test(e)) && r.erros.some((e) => /inventada/.test(e)));
  const t = (s) => r.itens.find((n) => n.titulo.includes(s));
  assert.ok(t('Copom').categorias.includes('juros')); assert.ok(t('IPCA').categorias.includes('inflacao'));
  assert.ok(t('Dólar').categorias.includes('cambio')); assert.ok(t('Bitcoin').categorias.includes('cripto'));
  assert.deepEqual(t('ZZT Alfa').ativos, ['BR:B3:ZZTA3']); assert.ok(t('ZZT Alfa').categorias.includes('favoritos'));
  assert.ok(r.itens.every((n) => /^https:\/\//.test(n.link) && n.resumo.length <= N.RESUMO_MAX + 1));
  for (const [k] of N.CATEGORIAS) assert.ok(N.NOME_CAT[k]);
  assert.ok(Object.entries(N.FONTES).every(([k, f]) => (k === 'teste') === f.ligada), 'só a fonte de teste está ligada');
});

test('pesquisa: links manuais não são motor automático; motor automático desligado', () => {
  assert.equal(N.PESQUISA.links.automatico, false); assert.equal(N.PESQUISA.googleCse.ligado, false);
  assert.equal(N.pesquisarAutomatico('x').estado, 'indisponivel');
});

test('insights por regra: concentração, setor, câmbio, benchmark e proventos', () => {
  const A = 'BR:B3:ZZTA3', B = 'BR:B3:ZZTL11', U = 'US:NASDAQ:ZZTX';
  const ops = [{ id: '1', tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10, moeda: 'BRL' }, { id: '2', tipo: 'compra', data: '2026-01-05', assetId: B, qtd: 1, preco: 100, moeda: 'BRL' },
    { id: '3', tipo: 'compra', data: '2026-01-05', assetId: U, qtd: 1, preco: 100, moeda: 'USD', cambio: 5 }, { id: '4', tipo: 'rendimento', data: '2026-02-01', assetId: B, valor: 10, moeda: 'BRL' }];
  // Etapa 10: as operações passam pela mesma preparação da tela (efeito gravado e saldo conferido)
  const cart = { caixaAutomatico: true, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' }; const gravadas = [];
  for (const o of ops) { const r = CT.prepararOperacao(cart, o, {}); assert.ok(r.ok, String(r.erros)); gravadas.push(Object.assign({ id: o.id, seq: +o.id }, r.gravar)); cart.saldo = r.saldo; cart.ultimaData = r.ultimaData; }
  const base = CT.calcular(gravadas);
  const av = CT.avaliar(base, () => ({ preco: 10 * 1, estado: 'manual' }), { preco: 5, estado: 'manual' }, (id) => ({ ticker: id.split(':')[2], setor: id === B ? 'Fundos imobiliários' : 'Bancos', classe: 'acao' }));
  const ins = AN.insightsCarteira(av, base, { twr: 0.05 }, { cdiPeriodoPct: 10, ibovRet: 3 }, { cotacoes: { [A]: { variacaoPct: -4 } } });
  const tipos = ins.map((i) => i.tipo);
  for (const t of ['concentracao', 'diversificacao', 'setor', 'benchmark', 'proventos', 'movimento']) assert.ok(tipos.includes(t), t);
  assert.ok(ins.every((i) => i.regra && i.estado.includes('manual')));
  // auditoria: com preços simulados a carteira real não é avaliada e nenhum insight de valor é produzido
  const avSim = CT.avaliar(base, () => ({ preco: 10, estado: 'simulado' }), { preco: 5, estado: 'simulado' }, () => ({}));
  const insSim = AN.insightsCarteira(avSim, base, { twr: null }, {}, {});
  assert.deepEqual(insSim.map((i) => i.tipo), ['dados']); assert.ok(insSim[0].titulo.includes('sem avaliação'));
  assert.ok(ins.find((i) => i.tipo === 'benchmark').titulo.includes('CDI'));
  const ind = AN.insightsIndicadores({ SELIC: { preco: 14.25, estado: 'simulado' }, IPCA12M: { preco: 4.6, estado: 'simulado' } });
  assert.ok(ind.find((i) => /Juro real/.test(i.titulo)).titulo.includes('9,23')); // (1,1425 ÷ 1,046) − 1 = 9,2256%
});

test('alertas: acima, abaixo, variação; inválidos recusados', () => {
  const q = { 'BR:B3:A1': { preco: 50, variacaoPct: -3.5, estado: 'simulado' } };
  const r = AN.avaliarAlertas([{ assetId: 'BR:B3:A1', tipo: 'acima', valor: 40 }, { assetId: 'BR:B3:A1', tipo: 'abaixo', valor: 40 }, { assetId: 'BR:B3:A1', tipo: 'variacao', valor: 3 }, { assetId: 'BR:B3:X', tipo: 'acima', valor: 1 }], (id) => q[id]);
  assert.deepEqual(r.map((x) => x.disparou), [true, false, true, false]);
  assert.equal(AN.validarAlerta({ assetId: '<x>', tipo: 'acima', valor: 1 }), false);
  assert.equal(AN.validarAlerta({ assetId: 'BR:B3:A1', tipo: 'apagar', valor: 1 }), false);
});

test('boletins por regra trazem fontes e marcam simulado', () => {
  const b = AN.boletim('fechamento', { indices: [{ nome: 'Ibovespa', preco: 1, variacaoPct: 1.2, estado: 'simulado', fonteNome: 'Simulador' }], macro: [{ nome: 'Selic', preco: 14.25, unidade: '%aa', estado: 'simulado', fonteNome: 'Simulador' }], altas: [], baixas: [] });
  assert.equal(b.simulado, true); assert.deepEqual(b.fontes, ['Simulador']); assert.ok(b.linhas[0].startsWith('No fechamento'));
  assert.equal(AN.tipoBoletimAgora(9), 'abertura'); assert.equal(AN.tipoBoletimAgora(13), 'intradiario'); assert.equal(AN.tipoBoletimAgora(18), 'fechamento');
});

test('IA: desligada, sem chave, e o filtro de privacidade não deixa sair dado da carteira sem autorização', async () => {
  assert.ok(Object.values(IA.PROVEDORES).every((p) => !p.ligado));
  assert.equal((await IA.gerar('materia', 'claude')).estado, 'indisponivel');
  const dados = { mercado: [{ nome: 'Ibovespa', variacaoPct: 1, estado: 'simulado', preco: 1 }], noticias: [{ titulo: 't', resumo: 'r', link: 'https://x.invalid', fonte: 'teste' }],
    carteira: { patrimonio: 123456, posicoes: [{ ticker: 'ZZTA3', qtd: 100 }], corretoras: ['XP'], distribuicao: [{ rotulo: 'Ações', pct: 100 }], rentabilidadePct: 5 } };
  const sem = IA.prepararContexto(dados); assert.equal(sem.carteira, undefined);
  const com = IA.prepararContexto(dados, { carteira: true }); const txt = JSON.stringify(com);
  assert.ok(!/123456|ZZTA3|XP|qtd|posicoes/.test(txt), 'só porcentagens: ' + txt);
  assert.equal(IA.validarResposta({ texto: 'x', fontes: [] }), false); assert.equal(IA.validarResposta({ texto: 'x', fontes: ['https://a'] }), true);
});

test('nenhum arquivo do módulo chama rede externa, usa chave ou guarda segredo', () => {
  const dir = new URL('../inv/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/api[_-]?key\s*[:=]\s*['"][^'"]{8,}|sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9]{10,}/i.test(s), f + ': parece ter uma chave');
    for (const m of s.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)) assert.ok(!/^https?:/.test(m[1]), f + ' chama endereço externo: ' + m[1]);
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(s), f);
  }
});
