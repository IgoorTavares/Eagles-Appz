// Etapa 09 — Projeções: conferência matemática (fórmula fechada e casos feitos à mão).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../inv/inv-projecoes.js');
const base = { patrimonioInicial: 10000, aporteMensal: 1000, meses: 120, valorizacaoAnual: 0.1, dyAnual: 0, inflacaoAnual: 0, taxaAdmAnual: 0, aliquotaIRProventos: 0, aliquotaIRGanho: 0, reinvestir: true };
const perto = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('juros compostos com aportes = fórmula fechada (VF)', () => {
  const r = P.projetar(base); const i = P.mensal(0.1);
  perto(r.nominal, P.c2(P.valorFuturo(10000, 1000, i, 120)));
  assert.equal(r.aportado, 130000); perto(r.ganho, r.nominal - 130000);
  perto(P.mensal(0.1), Math.pow(1.1, 1 / 12) - 1, 1e-15);
});

test('taxa zero: patrimônio = aportes; inflação reduz o valor real exatamente', () => {
  const r = P.projetar(Object.assign({}, base, { valorizacaoAnual: 0, inflacaoAnual: 0.1, meses: 12 }));
  assert.equal(r.nominal, 22000); perto(r.real, 22000 / 1.1);
});

test('proventos: reinvestidos crescem o patrimônio; não reinvestidos viram renda e o total (patrimônio + renda) é igual sem IR', () => {
  const a = P.projetar(Object.assign({}, base, { valorizacaoAnual: 0, dyAnual: 0.06, aporteMensal: 0, meses: 12 }));
  perto(a.nominal, 10600, 0.01);
  const b = P.projetar(Object.assign({}, base, { valorizacaoAnual: 0, dyAnual: 0.06, aporteMensal: 0, meses: 12, reinvestir: false }));
  assert.equal(b.nominal, 10000); perto(b.rendaRetirada, 10000 * 12 * P.mensal(0.06), 0.01);
  const c = P.projetar(Object.assign({}, base, { valorizacaoAnual: 0, dyAnual: 0.06, aporteMensal: 0, meses: 12, reinvestir: false, aliquotaIRProventos: 0.15 }));
  perto(c.rendaRetirada, b.rendaRetirada * 0.85); perto(c.irProventos, b.rendaRetirada * 0.15);
});

test('custos e impostos: taxa anual sobre o patrimônio, custo de entrada e IR sobre o ganho no fim', () => {
  const r = P.projetar(Object.assign({}, base, { aporteMensal: 0, meses: 12, taxaAdmAnual: 0.01, valorizacaoAnual: 0 }));
  perto(r.nominal, 10000 * Math.pow(1 - P.mensal(0.01), 12)); // custo mensal composto
  const e = P.projetar(Object.assign({}, base, { valorizacaoAnual: 0, meses: 1, custoAporte: 0.01 }));
  assert.equal(e.nominal, 10990); assert.equal(e.custos, 10);
  const g = P.projetar(Object.assign({}, base, { aporteMensal: 0, meses: 12, aliquotaIRGanho: 0.15 }));
  perto(g.irGanho, 1000 * 0.15); perto(g.liquido, 11000 - 150);
});

test('aporte reajustado a cada 12 meses e aportes extraordinários (inclusive retirada)', () => {
  const r = P.projetar(Object.assign({}, base, { patrimonioInicial: 0, valorizacaoAnual: 0, meses: 24, reajusteAnualAporte: 0.1, aportesExtras: [{ mes: 6, valor: 5000 }, { mes: 20, valor: -2000 }] }));
  assert.equal(r.aportado, 12000 + 13200 + 5000 - 2000); assert.equal(r.nominal, r.aportado);
  const z = P.projetar(Object.assign({}, base, { patrimonioInicial: 100, aporteMensal: 0, valorizacaoAnual: 0, meses: 2, aportesExtras: [{ mes: 1, valor: -500 }] }));
  assert.equal(z.nominal, 0); assert.equal(z.zerou, true);
});

test('metas: tempo até o patrimônio (nominal e real) e patrimônio para uma renda', () => {
  const k = P.mesesParaMeta(130000, Object.assign({}, base, { valorizacaoAnual: 0 })); assert.equal(k, 120);
  assert.equal(P.mesesParaMeta(1e12, Object.assign({}, base, { valorizacaoAnual: 0, aporteMensal: 1 })), null);
  const kr = P.mesesParaMeta(130000, Object.assign({}, base, { valorizacaoAnual: 0.05, inflacaoAnual: 0.05 }), { real: true }); assert.ok(kr > 120 && kr < 1200, String(kr));
  // sem rendimento e com inflação, o valor REAL nunca chega a 130 mil (o máximo fica perto de 94 mil): a meta real é inalcançável
  assert.equal(P.mesesParaMeta(130000, Object.assign({}, base, { valorizacaoAnual: 0, inflacaoAnual: 0.05 }), { real: true }), null);
  perto(P.patrimonioParaRenda(1000, { dyAnual: 0.12 }), 1000 / P.mensal(0.12));
  perto(P.patrimonioParaRenda(1000, { dyAnual: 0.12, aliquotaIRProventos: 0.15 }), 1000 / (P.mensal(0.12) * 0.85));
  perto(P.patrimonioParaRenda(1000, {}, { taxaRetiradaAnual: 0.04 }), 1000 / P.mensal(0.04));
  assert.equal(P.patrimonioParaRenda(1000, { dyAnual: 0 }), null);
});

test('cenários e comparação de estratégias', () => {
  const c = P.cenarios(base, { pessimista: 0.04, moderado: 0.08, otimista: 0.12 });
  assert.deepEqual(c.map((x) => x.cenario), ['pessimista', 'moderado', 'otimista']);
  assert.ok(c[0].nominal < c[1].nominal && c[1].nominal < c[2].nominal);
  const e = P.compararEstrategias([{ nome: 'A', premissas: Object.assign({}, base, { meses: 60 }) }, { nome: 'B', premissas: Object.assign({}, base, { aporteMensal: 2000, meses: 120 }) }]);
  assert.equal(e[0].meses, 120, 'comparadas no mesmo prazo'); assert.ok(e[1].nominal > e[0].nominal);
});

test('projeção por classe: soma das partes', () => {
  const r = P.porClasse([{ chave: 'acao', valor: 6000, valorizacaoAnual: 0.12 }, { chave: 'fii', valor: 4000, valorizacaoAnual: 0.02, dyAnual: 0.08 }], { meses: 12, inflacaoAnual: 0 });
  perto(r.total.nominal, r.linhas[0].nominal + r.linhas[1].nominal); perto(r.linhas[0].nominal, 6720);
});

test('rebalanceamento simulado: completo (compras e vendas) e só com aporte; alvo precisa somar 100%', () => {
  const it = [{ chave: 'acao', valor: 7000 }, { chave: 'fii', valor: 3000 }];
  const c = P.rebalancear(it, { acao: 50, fii: 50 }, 0);
  assert.deepEqual(c.ordens.map((o) => o.ordem), [-2000, 2000]);
  const s = P.rebalancear(it, { acao: 50, fii: 50 }, 1000, { somenteCompras: true });
  assert.deepEqual(s.ordens.map((o) => o.ordem), [0, 1000]); assert.equal(s.ordens.reduce((t, o) => t + o.ordem, 0), 1000);
  const t = P.rebalancear(it, { acao: 50, fii: 50, rf: 0 }, 3333.33, { somenteCompras: true });
  assert.equal(P.c2(t.ordens.reduce((x, o) => x + o.ordem, 0)), 3333.33, 'arredondamento fecha com o aporte');
  assert.equal(P.rebalancear(it, { acao: 60, fii: 30 }).ok, false);
});

test('validação das premissas e dos cenários salvos', () => {
  assert.throws(() => P.projetar(Object.assign({}, base, { meses: 0 })));
  assert.throws(() => P.projetar(Object.assign({}, base, { valorizacaoAnual: 5 })));
  assert.equal(P.validar(Object.assign({}, base, { aporteMensal: NaN })).ok, false);
  assert.equal(P.cenarioValido({ id: 'c1', nome: 'Aposentar', premissas: base }), true);
  assert.equal(P.cenarioValido({ id: 'c1', nome: '', premissas: base }), false);
  assert.equal(P.cenarioValido({ id: 'c1', nome: 'x', premissas: Object.assign({}, base, { meses: 5000 }) }), false);
});
