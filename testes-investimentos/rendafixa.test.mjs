// Etapa 12.5 — motor de renda fixa: precisão, convenções, índices reais (BCB SGS), tributação versionada, lotes, liquidez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../inv/inv-rendafixa.js');
const sgs = (n) => JSON.parse(readFileSync(new URL('./respostas-reais/rf/sgs' + n + '.json', import.meta.url), 'utf8'));
const br = (s) => `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
const porDia = (j) => Object.fromEntries(j.map((x) => [br(x.data), Number(x.valor)]));
const porMes = (j) => Object.fromEntries(j.map((x) => [br(x.data).slice(0, 7), Number(x.valor)]));
const CDI_AA = porDia(sgs(4389)); const CDI_AD = porDia(sgs(12)); const IPCA = porMes(sgs(433));
const base = { tipo: 'CDB', emissao: '2025-01-02', vencimento: '2028-01-03', liquidez: 'diaria' };

test('calendário: idêntico aos dias úteis do CDI publicados pelo Banco Central (2024–2026) e feriados móveis corretos', () => {
  const ds = new Set(sgs(12).map((x) => br(x.data))); const meu = R.listaDU('2023-12-31', '2026-11-25');
  assert.deepEqual(meu, [...ds].sort(), 'mesmos 729 dias úteis');
  assert.equal(R.pascoa(2026), '2026-04-05'); assert.ok(R.feriados(2026).has('2026-02-16') && R.feriados(2026).has('2026-06-04'));
  assert.equal(R.feriados(2023).has('2023-11-20'), false, '20/11 só é nacional a partir de 2024'); assert.ok(R.feriados(2024).has('2024-11-20'));
  assert.equal(R.diasUteis('2026-11-20', '2026-11-23'), 1, 'sexta 20/11 feriado: só a segunda conta');
});

test('fonte → motor: o CDI acumulado de cada mês pelo motor bate com o CDI acumulado no mês publicado (SGS 4391)', () => {
  const mensal = porMes(sgs(4391)); let conferidos = 0;
  for (const mes of ['2025-01', '2025-06', '2025-12', '2026-03', '2026-08', '2026-10']) {
    const dias = Object.keys(CDI_AD).filter((d) => d.startsWith(mes)).sort(); if (!dias.length || !(mes in mensal)) continue;
    const antes = Object.keys(CDI_AD).filter((d) => d < dias[0]).sort().pop();
    const r = R.fatorIndiceDiario(CDI_AD, antes, dias[dias.length - 1], 100, { formato: 'ad', taxaDoProprioDia: true });
    assert.equal(r.completo, true);
    const acum = Math.round((R.fatorNum(r.fator) - 1) * 10000) / 100;
    assert.ok(Math.abs(acum - mensal[mes]) <= 0.01, `${mes}: motor ${acum}% × BCB ${mensal[mes]}%`); conferidos++;
  }
  assert.ok(conferidos >= 5);
});

test('prefixado: 12% a.a. em 252 dias úteis = exatamente 12%; linear e DC/365 pelo contrato', () => {
  const de = '2025-01-02'; const du = R.listaDU(de, '2026-12-31'); const ate = du[251];
  const c = Object.assign({}, base, { indexador: 'PRE', taxa: 12 });
  const p = R.posicao(c, [{ data: de, valor: 1000000 }], {}, ate);
  assert.equal(p.saldoContratualBruto, 1120000);
  const lin = R.posicao(Object.assign({}, c, { capitalizacao: 'linear', convencao: 'DC360' }), [{ data: de, valor: 1000000 }], {}, '2025-07-01');
  assert.equal(lin.saldoContratualBruto, 1000000 + Math.round(1000000 * 0.12 * R.diasCorridos(de, '2025-07-01') / 360));
});

test('% do CDI com a convenção B3 (TDI em 8 casas, fator truncado em 16) e CDI + spread', () => {
  const c = Object.assign({}, base, { indexador: 'CDI_PCT', taxa: 100 });
  const p = R.posicao(c, [{ data: '2026-01-02', valor: 10000000 }], { cdi: CDI_AA }, '2026-11-25');
  // referência independente: produto em float de (1 + TDI_k) com a taxa do dia útil anterior
  const dias = R.listaDU('2026-01-02', '2026-11-25'); let f = 1;
  for (const d of dias) { const ant = Object.keys(CDI_AA).filter((x) => x < d).sort().pop(); f *= 1 + Math.round((Math.pow(1 + CDI_AA[ant] / 100, 1 / 252) - 1) * 1e8) / 1e8; }
  assert.ok(Math.abs(p.saldoContratualBruto - Math.round(10000000 * f)) <= 1, `${p.saldoContratualBruto} × ${Math.round(10000000 * f)}`);
  const c110 = R.posicao(Object.assign({}, c, { taxa: 110 }), [{ data: '2026-01-02', valor: 10000000 }], { cdi: CDI_AA }, '2026-11-25');
  assert.ok(c110.saldoContratualBruto > p.saldoContratualBruto);
  const sp = R.posicao(Object.assign({}, c, { indexador: 'CDI_SPREAD', taxa: 2 }), [{ data: '2026-01-02', valor: 10000000 }], { cdi: CDI_AA }, '2026-11-25');
  const fsp = f * Math.pow(1.02, dias.length / 252); assert.ok(Math.abs(sp.saldoContratualBruto - Math.round(10000000 * fsp)) <= 2);
});

test('CDI zero ≠ CDI ausente: zero rende nada naquele dia; ausente para o cálculo e avisa (nunca inventa)', () => {
  const s = { '2026-11-02': 13.65, '2026-11-03': 0, '2026-11-04': 13.65 }; // 02/11 feriado: a taxa vem de 30/10
  const r0 = R.fatorIndiceDiario(Object.assign({ '2026-10-30': 13.65 }, s), '2026-11-03', '2026-11-04', 100);
  assert.equal(r0.completo, true); assert.equal(r0.fator, 10n ** 16n, 'a taxa de 03/11 é zero: o dia 04/11 rende zero');
  const c = Object.assign({}, base, { indexador: 'CDI_PCT', taxa: 100 });
  const p = R.posicao(c, [{ data: '2026-11-10', valor: 100000 }], { cdi: { '2026-11-10': 13.65, '2026-11-11': 13.65 } }, '2026-11-25');
  assert.equal(p.completo, false); assert.equal(p.calculadoAte, '2026-11-12'); assert.equal(p.valorEstimadoResgate, null);
  assert.ok(p.avisos.some((a) => /não disponível \(ainda não publicado/.test(a)));
});

test('IPCA + taxa: defasagem e aniversário do contrato; deflação aplicada; mês sem IPCA publicado não é projetado', () => {
  const c = Object.assign({}, base, { tipo: 'DEBENTURE', indexador: 'IPCA_SPREAD', taxa: 6, ipcaDefasagem: 1, diaAniversario: 15, liquidez: 'vencimento' });
  const p = R.posicao(c, [{ data: '2026-01-15', valor: 1000000 }], { ipca: IPCA }, '2026-07-15');
  // fator do índice = IPCA de dez/2025 … mai/2026 (defasagem 1)
  let fi = 1; for (const m of ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) fi *= 1 + IPCA[m] / 100;
  const du = R.diasUteis('2026-01-15', '2026-07-15');
  assert.ok(Math.abs(p.saldoContratualBruto - Math.round(1000000 * fi * Math.pow(1.06, du / 252))) <= 1, `${p.saldoContratualBruto}`);
  const defl = R.fatorIPCA({ '2026-05': -0.5 }, '2026-06-15', '2026-07-15', { ipcaDefasagem: 1, diaAniversario: 15 });
  assert.ok(R.fatorNum(defl.fator) < 1, 'IPCA negativo reduz o valor (sem piso no contrato)');
  assert.equal(R.fatorNum(R.fatorIPCA({ '2026-05': -0.5 }, '2026-06-15', '2026-07-15', { ipcaDefasagem: 1, diaAniversario: 15, pisoIndiceZero: true }).fator), 1);
  const fut = R.posicao(c, [{ data: '2026-01-15', valor: 1000000 }], { ipca: IPCA }, '2027-03-10');
  assert.equal(fut.completo, false); assert.ok(fut.avisos.some((a) => /não publicado/.test(a)));
  assert.equal(fut.marcacaoMercado.valor, null); assert.match(fut.marcacaoMercado.motivo, /Crédito privado/);
});

test('IR regressivo nos limites de dias (180/181, 360/361, 720/721) e IOF dia a dia até 30', () => {
  const r = R.regraEm('2026-11-27');
  for (const [d, al] of [[1, 22.5], [180, 22.5], [181, 20], [360, 20], [361, 17.5], [720, 17.5], [721, 15], [5000, 15]]) assert.equal(R.aliquotaIR(d, r), al, 'dia ' + d);
  assert.equal(R.percIOF(1, r), 96); assert.equal(R.percIOF(29, r), 3); assert.equal(R.percIOF(30, r), 0); assert.equal(R.percIOF(10, r), 66);
  const c = Object.assign({}, base, { indexador: 'PRE', taxa: 12 });
  const p = R.posicao(c, [{ data: '2026-11-10', valor: 1000000 }], {}, '2026-11-20');
  const l = p.lotes[0]; assert.equal(l.percIOF, 66); const rend = l.saldoBruto - 1000000;
  assert.equal(l.iof, Math.round(rend * 0.66)); assert.equal(l.ir, Math.round((rend - l.iof) * 0.225), 'IR sobre o rendimento depois do IOF');
  assert.equal(p.saldoLiquidoEstimado, l.saldoBruto - l.iof - l.ir);
});

test('isenção nunca pelo nome: LCI sem confirmação é estimada COM IR e avisa; confirmada → 0 para PF; PJ paga', () => {
  const c = Object.assign({}, base, { tipo: 'LCI', indexador: 'PRE', taxa: 10 });
  const sem = R.posicao(c, [{ data: '2025-01-02', valor: 1000000 }], {}, '2026-06-01');
  assert.ok(sem.ir > 0); assert.equal(sem.lotes[0].tributacaoConfirmada, false); assert.ok(sem.avisos.some((a) => /não foi confirmada/.test(a)));
  const com = R.posicao(Object.assign({}, c, { isencaoConfirmada: true }), [{ data: '2025-01-02', valor: 1000000 }], {}, '2026-06-01');
  assert.equal(com.ir, 0);
  const pj = R.posicao(Object.assign({}, c, { isencaoConfirmada: true }), [{ data: '2025-01-02', valor: 1000000 }], {}, '2026-06-01', { investidor: 'PJ' });
  assert.ok(pj.ir > 0, 'a isenção de LCI é só de pessoa física'); assert.ok(pj.avisos.some((a) => /antecipação/.test(a)));
  const deb = R.posicao(Object.assign({}, base, { tipo: 'DEBENTURE_INCENTIVADA', indexador: 'PRE', taxa: 10, isencaoConfirmada: true }), [{ data: '2025-01-02', valor: 1000000 }], {}, '2026-06-01', { investidor: 'PJ' });
  assert.equal(deb.lotes[0].aliquotaIR, 15);
  assert.equal(sem.regras[0], 'BR-RF-2005.1'); assert.throws(() => R.regraEm('2004-12-31'), /sem regra/);
});

test('lotes e resgate parcial: cada lote com seu prazo de IR; PEPS resgata o mais antigo primeiro; proporcional divide', () => {
  const c = Object.assign({}, base, { indexador: 'PRE', taxa: 12 });
  const p = R.posicao(c, [{ id: 'A', data: '2025-01-02', valor: 1000000 }, { id: 'B', data: '2026-10-01', valor: 1000000 }], {}, '2026-11-20');
  assert.equal(p.lotes[0].aliquotaIR, 17.5); assert.equal(p.lotes[1].aliquotaIR, 22.5);
  const r = R.planejarResgate(p, 1300000, 'PEPS'); // o lote A sozinho vale ~1,24 mi: o resto sai do B
  assert.equal(r.lotes[0].lote, 'A'); assert.equal(r.lotes[0].bruto, p.lotes[0].saldoBruto); assert.equal(r.lotes[1].lote, 'B');
  assert.equal(r.total.bruto, 1300000); assert.equal(r.lotes[1].bruto, 1300000 - p.lotes[0].saldoBruto); assert.equal(r.total.liquido, r.total.bruto - r.total.iof - r.total.ir - r.total.taxas);
  const pr = R.planejarResgate(p, 1000000, 'proporcional'); assert.equal(pr.lotes.length, 2); assert.equal(pr.total.bruto, 1000000);
  assert.throws(() => R.planejarResgate(p, p.saldoContratualBruto + 1), /acima/);
});

test('juros periódicos e amortização: principal remanescente cai; juros pagos saem do saldo; nada some', () => {
  const c = Object.assign({}, base, { tipo: 'DEBENTURE', indexador: 'PRE', taxa: 12, liquidez: 'vencimento', eventos: [{ data: '2025-07-01', tipo: 'juros' }, { data: '2026-01-02', tipo: 'juros' }, { data: '2026-01-02', tipo: 'amortizacao', percentual: 50 }] });
  const p = R.posicao(c, [{ data: '2025-01-02', valor: 1000000 }], {}, '2026-03-02');
  assert.equal(p.principalRemanescente, 500000); assert.equal(p.amortizacoesPagas, 500000); assert.ok(p.jurosPagos > 100000);
  assert.equal(p.rendimento, p.saldoContratualBruto + p.jurosPagos + p.amortizacoesPagas - p.capitalAplicado);
  assert.equal(p.valorEstimadoResgate, null); assert.ok(p.avisos.some((a) => /só no vencimento/.test(a)));
});

test('liquidez: carência bloqueia o resgate; liquidez diária avisa que o valor é estimativa; vencido = saldo líquido', () => {
  const c = Object.assign({}, base, { tipo: 'LCA', indexador: 'PRE', taxa: 10, carencia: '2026-12-01', liquidez: 'carencia' });
  const p = R.posicao(c, [{ data: '2026-01-02', valor: 100000 }], {}, '2026-11-20'); assert.equal(p.valorEstimadoResgate, null); assert.ok(p.avisos.some((a) => /carência/.test(a)));
  const d = R.posicao(Object.assign({}, base, { indexador: 'PRE', taxa: 10 }), [{ data: '2026-01-02', valor: 100000 }], {}, '2026-11-20'); assert.ok(d.avisos.some((a) => /não garante/.test(a)));
  const v = R.posicao(Object.assign({}, base, { indexador: 'PRE', taxa: 10, vencimento: '2026-06-01' }), [{ data: '2026-01-02', valor: 100000 }], {}, '2026-11-20');
  assert.equal(v.valorEstimadoResgate, v.saldoLiquidoEstimado); assert.equal(v.lotes[0].calculadoAte, '2026-06-01', 'não rende depois do vencimento');
});

test('validação do contrato: recusa tipo, indexador, taxa, datas e eventos inválidos', () => {
  for (const ruim of [{ tipo: 'XYZ' }, { indexador: 'IGPM' }, { taxa: NaN }, { taxa: 500, indexador: 'CDI_PCT' }, { vencimento: '2024-01-01' }, { carencia: '2030-01-01' }, { eventos: [{ data: 'x', tipo: 'juros' }] }])
    assert.equal(R.validarContrato(Object.assign({}, base, { indexador: 'PRE', taxa: 10 }, ruim)).ok, false, JSON.stringify(ruim));
  assert.equal(R.validarContrato(Object.assign({}, base, { indexador: 'PRE', taxa: 10 })).ok, true);
});
