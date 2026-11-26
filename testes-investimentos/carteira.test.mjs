// Carteira (Etapas 07 + auditoria + Etapa 10): livro-razão com SALDO conferido, em ordem de data, estorno = reversão.
// As contas são conferidas à mão (centavos inteiros).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../inv/inv-carteira.js');
const A = 'BR:B3:ZZTA3', B = 'BR:B3:ZZTL11', U = 'US:NASDAQ:ZZTX';
const HOJE = '2026-11-26';

// monta a carteira como a tela faz: cada operação passa por prepararOperacao (mesma conta das regras do banco)
function montar(lista, carteira = {}) {
  const c = Object.assign({ caixaAutomatico: true, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' }, carteira);
  const ops = [];
  for (const x of lista) {
    const o = Object.assign({ moeda: 'BRL' }, x);
    const alvo = o.tipo === 'estorno' ? ops.find((y) => y.id === o.estorna) : null;
    const r = C.prepararOperacao(c, o, { hoje: HOJE, alvo });
    if (!r.ok) throw new Error(`${o.tipo} ${o.data}: ${r.erros.join('; ')}`);
    const n = ops.length + 1; ops.push(Object.assign({ id: String(n), seq: n }, r.gravar));
    c.saldo = r.saldo; c.ultimaData = r.ultimaData;
  }
  return { ops, carteira: c };
}
const tenta = (c, o, alvo) => C.prepararOperacao(c, Object.assign({ moeda: 'BRL' }, o), { hoje: HOJE, alvo });

test('preço médio, venda, lucro realizado, taxas e caixa (regra brasileira)', () => {
  const { ops, carteira } = montar([
    { tipo: 'aporte', data: '2026-01-02', valor: 5000 },
    { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10, taxas: 5 },   // custo 1.005,00
    { tipo: 'compra', data: '2026-02-05', assetId: A, qtd: 100, preco: 12, taxas: 5 },   // custo 1.205,00 → 2.210,00 / 200 = 11,05
    { tipo: 'venda', data: '2026-03-05', assetId: A, qtd: 50, preco: 15, taxas: 2.5 },   // líquido 747,50 − custo 552,50 = 195,00
  ]);
  const r = C.calcular(ops, { saldoCarteira: carteira.saldo });
  assert.equal(r.consistente, true);
  const p = r.posicoes[A];
  assert.equal(p.qtdE8, 150e8); assert.equal(p.custo, 165750); assert.equal(p.precoMedio, 11.05);
  assert.equal(r.lucroRealizado, 19500); assert.equal(r.taxas, 1250);
  assert.equal(r.caixa, 500000 - 100500 - 120500 + 74750); assert.equal(carteira.saldo.caixa, r.caixa);
  assert.equal(carteira.saldo.pos[A], 150e8);
});

test('aporte não é rentabilidade: compra sem caixa vira aporte implícito (gravado em "ai"); resultado = patrimônio − aportado', () => {
  const { ops, carteira } = montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 10, preco: 100 }]);
  assert.equal(ops[0].ai, 100000); assert.equal(carteira.saldo.caixa, 0);
  const r = C.calcular(ops);
  assert.equal(r.aportesImplicitos, 100000); assert.equal(r.aportado, 100000);
  const av = C.avaliar(r, () => ({ preco: 110, estado: 'manual' }), null, () => ({}));
  assert.equal(av.patrimonio, 110000); assert.equal(av.resultadoTotal, 10000);
  const sem = montar([{ tipo: 'aporte', data: '2026-01-01', valor: 5000 }, { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 10, preco: 100 }]);
  assert.equal(C.avaliar(C.calcular(sem.ops), () => ({ preco: 100, estado: 'manual' }), null, () => ({})).resultadoTotal, 0, 'aportar R$ 5.000 não gera ganho');
  // com o modo automático desligado, compra sem caixa é recusada
  assert.equal(tenta({ caixaAutomatico: false, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' }, { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1, preco: 1 }).ok, false);
});

test('proventos entram uma vez, líquidos do IR; repetição suspeita gera aviso', () => {
  const { ops } = montar([
    { tipo: 'compra', data: '2026-01-05', assetId: B, qtd: 10, preco: 100 },
    { tipo: 'rendimento', data: '2026-02-15', assetId: B, valor: 10 },
    { tipo: 'jcp', data: '2026-02-20', assetId: A, valor: 100, irRetido: 15 },
    { tipo: 'rendimento', data: '2026-02-20', assetId: B, valor: 10 },
    { tipo: 'rendimento', data: '2026-02-20', assetId: B, valor: 10 },
  ]);
  const r = C.calcular(ops);
  assert.equal(r.proventos, 1000 + 8500 + 1000 + 1000); assert.equal(r.irRetido, 1500); assert.equal(r.proventosPorTipo.jcp, 8500);
  assert.ok(r.avisos.some((a) => /repetido/.test(a.texto)));
});

test('estorno = REVERSÃO a partir de agora: compra estornada sai da posição e o dinheiro volta ao caixa; venda estornada desfaz o lucro', () => {
  const { ops, carteira } = montar([
    { tipo: 'aporte', data: '2026-01-02', valor: 2000 },
    { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10 },
    { tipo: 'venda', data: '2026-02-05', assetId: A, qtd: 40, preco: 12 },
    { tipo: 'estorno', data: '2026-02-06', estorna: '3' },                         // desfaz a venda
    { tipo: 'estorno', data: '2026-02-06', estorna: '2' },                         // agora dá para desfazer a compra
  ]);
  const r = C.calcular(ops, { saldoCarteira: carteira.saldo });
  assert.equal(r.consistente, true); assert.equal(r.estornadas, 2);
  assert.equal(r.posicoes[A].qtdE8, 0); assert.equal(r.lucroRealizado, 0); assert.equal(r.caixa, 200000);
  assert.equal(carteira.saldo.pos[A], 0); assert.equal(carteira.saldo.caixa, 200000);
});

test('estorno que quebraria o saldo é RECUSADO antes de gravar (não é detectado depois)', () => {
  const { ops, carteira } = montar([
    { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10 },
    { tipo: 'venda', data: '2026-03-01', assetId: A, qtd: 80, preco: 12 },
    { tipo: 'retirada', data: '2026-03-02', valor: 900 },
  ]);
  const e1 = tenta(carteira, { tipo: 'estorno', data: '2026-03-05', estorna: '1' }, ops[0]);
  assert.equal(e1.ok, false); assert.ok(/negativa/.test(e1.erros[0]), 'estornar a compra deixaria −80 ações');
  const e2 = tenta(carteira, { tipo: 'estorno', data: '2026-03-05', estorna: '2' }, ops[1]);
  assert.equal(e2.ok, false); assert.ok(/caixa negativo/.test(e2.erros[0]), 'estornar a venda tiraria do caixa um dinheiro que já foi retirado');
  assert.equal(tenta(carteira, { tipo: 'estorno', data: '2026-03-05', estorna: '99' }, null).ok, false);
  const desd = montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 10, preco: 10 }, { tipo: 'desdobramento', data: '2026-02-01', assetId: A, fator: 2 }]);
  assert.equal(tenta(desd.carteira, { tipo: 'estorno', data: '2026-02-02', estorna: '2' }, desd.ops[1]).ok, false, 'desdobramento não se estorna: lança-se o grupamento');
});

test('venda acima da posição, retirada acima do caixa e lançamento RETROATIVO são recusados antes de gravar', () => {
  const { carteira } = montar([{ tipo: 'aporte', data: '2026-01-02', valor: 100 }, { tipo: 'compra', data: '2026-03-01', assetId: A, qtd: 5, preco: 10 }]);
  assert.equal(tenta(carteira, { tipo: 'venda', data: '2026-03-02', assetId: A, qtd: 6, preco: 10 }).ok, false);
  assert.equal(tenta(carteira, { tipo: 'retirada', data: '2026-03-02', valor: 50.01 }).ok, false);
  assert.equal(tenta(carteira, { tipo: 'retirada', data: '2026-03-02', valor: 50 }).ok, true);
  const retro = tenta(carteira, { tipo: 'compra', data: '2026-02-01', assetId: A, qtd: 1, preco: 1 });
  assert.equal(retro.ok, false); assert.ok(/ordem de data/.test(retro.erros[0]));
  assert.equal(tenta(carteira, { tipo: 'compra', data: '2026-03-01', assetId: A, qtd: 1, preco: 1 }).ok, true, 'mesma data da última é permitida');
});

test('datas: calendário real (mês, dia, fevereiro e bissexto), viradas de mês e ano; nada no futuro', () => {
  for (const d of ['2024-02-29', '2000-02-29', '2026-01-31', '2026-04-30', '2025-12-31', '2026-01-01', '2026-11-26']) assert.equal(C.dataValida(d), true, d);
  for (const d of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-05', '26-01-05', '2026/01/05', '']) assert.equal(C.dataValida(d), false, d);
  assert.equal(C.validarOperacao({ tipo: 'aporte', data: '2026-11-27', valor: 1 }, HOJE).ok, false, 'amanhã');
  assert.equal(C.validarOperacao({ tipo: 'aporte', data: '2026-11-26', valor: 1 }, HOJE).ok, true, 'hoje');
});

test('desdobramento, grupamento e bonificação: quantidade e preço médio', () => {
  const d = C.calcular(montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10 }, { tipo: 'desdobramento', data: '2026-02-01', assetId: A, fator: 2 }]).ops);
  assert.equal(d.posicoes[A].qtdE8, 200e8); assert.equal(d.posicoes[A].precoMedio, 5);
  const g = C.calcular(montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10 }, { tipo: 'grupamento', data: '2026-02-01', assetId: A, fator: 10 }]).ops);
  assert.equal(g.posicoes[A].qtdE8, 10e8); assert.equal(g.posicoes[A].precoMedio, 100);
  const b = C.calcular(montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 100, preco: 10 }, { tipo: 'bonificacao', data: '2026-02-01', assetId: A, qtd: 10, valor: 50 }]).ops);
  assert.equal(b.posicoes[A].qtdE8, 110e8); assert.equal(b.posicoes[A].custo, 105000);
});

test('ativo em dólar: custo em BRL pelo câmbio da operação; câmbio simulado não avalia', () => {
  const { ops } = montar([{ tipo: 'compra', data: '2026-01-05', assetId: U, qtd: 10, preco: 100, moeda: 'USD', cambio: 5 }]);
  assert.equal(ops[0].dc, -500000);
  const r = C.calcular(ops);
  assert.equal(r.posicoes[U].custo, 100000); assert.equal(r.posicoes[U].custoBRL, 500000);
  const av = C.avaliar(r, () => ({ preco: 100, estado: 'manual' }), { preco: 5.5, estado: 'manual' }, () => ({ pais: 'US' }));
  assert.equal(av.patrimonio, 550000); assert.equal(av.efeitoCambial, 50000); assert.equal(av.exposicaoCambial, 100);
  assert.equal(C.avaliar(r, () => ({ preco: 100, estado: 'manual' }), { preco: 5.5, estado: 'simulado' }, () => ({})).situacao, 'indisponivel');
});

test('preço ou câmbio SIMULADO nunca avalia carteira real; sem preço = parcial ou indisponível com cobertura', () => {
  const r = C.calcular(montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 10, preco: 10 }, { tipo: 'compra', data: '2026-01-05', assetId: B, qtd: 10, preco: 80 }]).ops);
  assert.equal(C.avaliar(r, () => ({ preco: 50, estado: 'simulado' }), null, () => ({})).situacao, 'indisponivel');
  const parc = C.avaliar(r, (id) => (id === A ? { preco: 12, estado: 'manual' } : { preco: 99, estado: 'simulado' }), null, () => ({}));
  assert.equal(parc.situacao, 'parcial'); assert.equal(parc.patrimonio, 12000); assert.equal(parc.resultadoTotal, null);
  assert.deepEqual(parc.cobertura, { ativos: 1, de: 2, custoPct: 11.11 });
  assert.equal(C.avaliar(r, () => ({ preco: 10, estado: 'simulado' }), null, () => ({}), { aceitarSimulado: true }).situacao, 'completa', 'só a demonstração aceita simulado');
});

test('gravação direta com números que não fecham, estorno repetido e saldo divergente aparecem como inconsistência (defesa extra; as regras recusam antes)', () => {
  const { ops, carteira } = montar([{ tipo: 'aporte', data: '2026-01-02', valor: 100 }, { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1, preco: 10 }]);
  const adulterada = ops.map((o) => (o.id === '2' ? Object.assign({}, o, { dc: -1 }) : o));
  assert.equal(C.calcular(adulterada).consistente, false);
  const dup = ops.concat([{ id: '3', seq: 3, tipo: 'estorno', data: '2026-01-06', estorna: '2', dq: -1e8, dc: 1000, ai: 0, alvoAsset: A }, { id: '4', seq: 4, tipo: 'estorno', data: '2026-01-06', estorna: '2', dq: -1e8, dc: 1000, ai: 0, alvoAsset: A }]);
  assert.ok(C.calcular(dup).inconsistencias.some((i) => /repetido/.test(i.texto)));
  assert.equal(C.calcular(ops, { saldoCarteira: { caixa: carteira.saldo.caixa + 1, pos: carteira.saldo.pos } }).consistente, false);
});

test('precisão: decimais exatos e soma acumulada de 5.000 operações igual à conta em inteiros grandes', () => {
  assert.equal(C.paraE8(0.1) + C.paraE8(0.2), C.paraE8(0.3));
  assert.equal(C.paraCent(2.675), 268); assert.equal(C.paraCent(1.005), 100); // meio-par sobre o decimal digitado
  assert.equal(C.valorCentavos(C.paraE8(1e7), C.paraE8(1e7)), 1e16);
  let semente = 7; const rnd = () => (semente = (semente * 48271) % 2147483647) / 2147483647;
  const lista = [{ tipo: 'aporte', data: '2025-01-01', valor: 100000 }]; let exato = 10000000n;
  for (let i = 0; i < 4999; i++) {
    const qtd = Math.round(rnd() * 1000) / 100 + 0.01, preco = Math.round(rnd() * 10000) / 100 + 0.01;
    lista.push({ tipo: i % 2 ? 'venda' : 'compra', data: '2025-06-01', assetId: A, qtd: i % 2 ? Math.min(qtd, lista[lista.length - 1].qtd) : qtd, preco });
  }
  const { ops, carteira } = montar(lista);
  for (const o of ops) { if (o.tipo === 'aporte') continue; const b = BigInt(C.paraE8(o.qtd)) * BigInt(C.paraE8(o.preco)) * 100n; const E = 10n ** 16n; let q = b / E; const r = b % E; if (r * 2n > E || (r * 2n === E && q % 2n === 1n)) q += 1n; exato += o.tipo === 'compra' ? -q : q; }
  const r = C.calcular(ops, { saldoCarteira: carteira.saldo });
  assert.equal(r.consistente, true);
  assert.equal(BigInt(r.caixa) - BigInt(r.aportesImplicitos), exato, 'caixa = aporte − compras + vendas, centavo por centavo');
});

test('XIRR e TWR (aproximação Dietz) conferidos; distribuição soma 100%', () => {
  const x = C.xirr([{ data: '2025-01-01', valor: -1000 }, { data: '2026-01-01', valor: 1100 }]); assert.ok(Math.abs(x - 0.1) < 1e-6);
  assert.equal(Math.round(C.twr([{ base: 100, ganho: 10 }, { base: 220, ganho: -22 }]) * 1e6) / 1e6, -0.01);
  const { ops } = montar([{ tipo: 'compra', data: '2025-01-10', assetId: A, qtd: 10, preco: 10 }, { tipo: 'compra', data: '2025-06-10', assetId: A, qtd: 10, preco: 10 }, { tipo: 'aporte', data: '2025-09-10', valor: 500 }]);
  const ev = C.evolucao(ops, () => ({ preco: 10, estado: 'fechamento' }), () => ({ preco: 5, estado: 'fechamento' }), () => ({}), '2026-01-15');
  assert.ok(ev.suficiente); assert.ok(Math.abs(ev.twr) < 1e-9); assert.ok(ev.metodo.includes('aproximação'));
  const r = C.calcular(montar([{ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 10, preco: 30 }, { tipo: 'compra', data: '2026-01-05', assetId: B, qtd: 7, preco: 100 }]).ops);
  const av = C.avaliar(r, (id) => ({ preco: id === A ? 30 : 100, estado: 'manual' }), null, (id) => ({ classe: id === A ? 'acao' : 'fii' }));
  assert.equal(C.distribuir(av.itens, 'classe').reduce((s, d) => s + d.pct, 0), 100);
});

test('campos por tipo e limites', () => {
  assert.equal(C.validarOperacao({ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1e7 + 1, preco: 1 }).ok, false);
  assert.equal(C.validarOperacao({ tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1, preco: 1e7 + 1 }).ok, false);
  assert.equal(C.validarOperacao({ tipo: 'aporte', data: '2026-01-05', valor: 1e10 + 1 }).ok, false);
  assert.equal(C.validarOperacao({ tipo: 'compra', data: '2026-01-05', assetId: U, qtd: 1, preco: 1, moeda: 'USD' }).ok, false, 'USD sem câmbio');
  assert.equal(C.validarOperacao({ tipo: 'apagar', data: '2026-01-05' }).ok, false);
  assert.equal(C.validarOperacao({ tipo: 'jcp', data: '2026-01-05', assetId: A, valor: 10, irRetido: 11 }).ok, false);
  const g = C.prepararOperacao({ caixaAutomatico: true, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' }, { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1.123456789, preco: 10.5, moeda: 'BRL' }, { hoje: HOJE });
  assert.deepEqual(g.gravar, { tipo: 'compra', data: '2026-01-05', assetId: A, qtd: 1.12345679, preco: 10.5, moeda: 'BRL', dc: -1180, ai: 1180, dq: 112345679, qtdE8: 112345679 });
});
