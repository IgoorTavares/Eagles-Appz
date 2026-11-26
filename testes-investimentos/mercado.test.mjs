// Etapa 06 — Market Engine: adaptadores, normalização, estados, cache, falhas, indicadores, rankings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const K = require('../inv/inv-mercado.js');
const ativos = require('./catalogo-teste/ativos.json').itens;
const REF = '2026-11-25';
const acao = ativos.find((a) => a.assetId === 'BR:B3:ZZTA3');
const us = ativos.find((a) => a.pais === 'US');

test('simulador: determinístico, passado não muda com o dia de referência, sempre "simulado"', () => {
  const s1 = K.criarSimulador({ dataRef: REF }), s2 = K.criarSimulador({ dataRef: '2026-11-27' });
  const h1 = s1.historico(acao), h2 = s2.historico(acao);
  assert.deepEqual(h1, h2.slice(0, h1.length));
  assert.ok(h1.every((p) => p.minima <= Math.min(p.abertura, p.fechamento) && p.maxima >= Math.max(p.abertura, p.fechamento)));
  const m = K.criarMotor({ adaptadores: { simulador: s1 } });
  const q = m.cotacao(acao);
  assert.equal(q.estado, 'simulado'); assert.equal(q.real, false); assert.equal(q.fonte, 'simulador');
  assert.equal(q.data, h1[h1.length - 1].data);
});

test('sem simulador e sem fonte: "indisponível", nunca um preço inventado', () => {
  const m = K.criarMotor({ adaptadores: { simulador: K.criarSimulador({ dataRef: REF }) }, simulador: false });
  const q = m.cotacao(acao); assert.equal(q.estado, 'indisponivel'); assert.equal(q.preco, null);
  assert.equal(m.historico(acao, '1A').pontos.length, 0);
});

test('prioridade: fonte real > manual > simulador; provedores desligados não são chamados', () => {
  let chamadas = 0;
  const falso = { cotacao: () => { chamadas++; return { preco: 10, fechamentoAnterior: 9, data: REF, horario: REF + 'T10:15:00', estado: 'atrasado' }; }, historico: () => null };
  const manual = K.criarManual({ 'BR:B3:ZZTA3': { preco: 12.5, data: '2026-11-24' } });
  const sim = K.criarSimulador({ dataRef: REF });
  const desligado = K.criarMotor({ adaptadores: { servidor: falso, manual, simulador: sim } });
  assert.equal(desligado.cotacao(acao).estado, 'manual'); assert.equal(chamadas, 0, 'servidor desligado (D-10) não é chamado');
  assert.equal(desligado.cotacao(us).estado, 'simulado');
  const ligado = K.criarMotor({ adaptadores: { servidor: falso, manual, simulador: sim }, ligados: { servidor: true } });
  const q = ligado.cotacao(acao); assert.equal(q.estado, 'atrasado'); assert.equal(q.real, true); assert.equal(q.variacaoPct, 11.1111);
});

test('cache em memória respeita a licença, limite diário e falha do provedor caem para o próximo', () => {
  let t = 0, chamadas = 0;
  const falso = { cotacao: () => { chamadas++; return { preco: 10, data: REF, horario: REF + 'T10:00:00' }; }, historico: () => null };
  const m = K.criarMotor({ adaptadores: { servidor: falso, simulador: K.criarSimulador({ dataRef: REF }) }, ligados: { servidor: true }, limites: { servidor: 2 }, agora: () => t });
  m.cotacao(acao); m.cotacao(acao); assert.equal(chamadas, 1, 'segunda vez veio do cache');
  t += 901e3; m.cotacao(acao); assert.equal(chamadas, 2, 'cache expirou (900 s)');
  t += 901e3; const q = m.cotacao(acao); assert.equal(chamadas, 2, 'limite diário: não chama mais'); assert.equal(q.estado, 'simulado'); assert.ok(q.avisos[0].includes('limite'));
  const quebrado = { cotacao: () => { throw new Error('fora do ar'); }, historico: () => { throw new Error('x'); } };
  const m2 = K.criarMotor({ adaptadores: { servidor: quebrado, simulador: K.criarSimulador({ dataRef: REF }) }, ligados: { servidor: true } });
  const q2 = m2.cotacao(acao); assert.equal(q2.estado, 'simulado'); assert.equal(m2.falhas().servidor, 1);
  assert.equal(m2.historico(acao, '1M').estado, 'simulado');
});

test('cache global (servidor): documento incompleto é descartado; id seguro', () => {
  assert.equal(K.idCacheGlobal('BR:B3:PETR4'), 'BR_B3_PETR4');
  assert.equal(K.normalizarDoServidor({ preco: 10, estado: 'atrasado', fonte: 'x' }), null);
  assert.equal(K.normalizarDoServidor({ preco: 10, estado: 'inventado', fonte: 'x', horario: REF }), null);
  assert.equal(K.normalizarDoServidor({ preco: 10, estado: 'atrasado', fonte: 'x', horario: REF + 'T10:00' }).preco, 10);
});

test('indicadores técnicos conferidos à mão', () => {
  assert.deepEqual(K.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(K.ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.equal(K.rsi([1, 2, 3, 4, 5, 6], 3)[3], 100);
  const v = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 3));
  const r = K.rsi(v, 14).filter((x) => x != null); assert.ok(r.every((x) => x >= 0 && x <= 100));
  const b = K.bollinger(v, 20); assert.ok(b.superior[30] > b.media[30] && b.inferior[30] < b.media[30]);
  const md = K.macd(v); assert.equal(md.histograma[59], Math.round((md.linha[59] - md.sinal[59]) * 1e4) / 1e4);
  assert.equal(K.retorno([{ fechamento: 10 }, { fechamento: 12 }]), 20);
});

test('períodos, comparação rebaseada, rankings, mapa de calor e radar', () => {
  const sim = K.criarSimulador({ dataRef: REF }); const m = K.criarMotor({ adaptadores: { simulador: sim } });
  assert.equal(m.historico(acao, '1M').pontos.length, 22);
  assert.ok(m.historico(acao, 'YTD').pontos[1].data.startsWith('2026'));
  const c = K.comparar([{ assetId: 'a', rotulo: 'A', pontos: m.historico(acao, '3M').pontos }, { assetId: 'b', rotulo: 'B', pontos: m.historico(K.INDICES.BR[0], '3M').pontos }]);
  assert.equal(c.series[0].valores[0], 0); assert.equal(c.series[1].valores[0], 0);
  const br = ativos.filter((a) => a.pais === 'BR' && a.situacao === 'ativo');
  const cot = m.cotacoes(br); const r = K.rankings(cot, 3);
  assert.ok(r.altas[0].variacaoPct >= r.altas[1].variacaoPct && r.baixas[0].variacaoPct <= r.baixas[1].variacaoPct);
  assert.deepEqual(r.estados, ['simulado']);
  const mc = K.mapaCalor(cot, br); assert.ok(mc.length > 0 && mc.every((s) => s.itens.length));
  assert.ok(Array.isArray(K.radar(br, m)));
});

test('macro: juros sem ruído diário e valor de referência do simulador; tudo marcado simulado', () => {
  const sim = K.criarSimulador({ dataRef: REF }); const m = K.criarMotor({ adaptadores: { simulador: sim } });
  const selic = K.MACRO.BR.find((x) => x.ticker === 'SELIC');
  assert.equal(m.cotacao(selic).preco, selic._base); assert.equal(m.cotacao(selic).estado, 'simulado');
  const p = m.historico(selic, '1M').pontos; assert.ok(p.every((x) => x.abertura === x.fechamento));
});

test('desempenho: 1.000 ativos com 6 anos de histórico simulado', () => {
  const sim = K.criarSimulador({ dataRef: REF }); const m = K.criarMotor({ adaptadores: { simulador: sim } });
  const muitos = Array.from({ length: 1000 }, (_, i) => ({ assetId: 'BR:B3:ZZT' + i, ticker: 'ZZT' + i, pais: 'BR', classe: 'acao', moeda: 'BRL' }));
  const t0 = Date.now(); const cot = m.cotacoes(muitos); K.rankings(cot); const ms = Date.now() - t0;
  assert.ok(ms < 3000, ms + ' ms');
});
