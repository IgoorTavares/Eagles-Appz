// Etapas 12.3 e 12.4 — fundos (CVM Cadastro + Informe Diário) e FII (Informe Mensal), com recortes REAIS dos arquivos
// oficiais da CVM (investimentos-portao/fixtures-fundos/, linhas copiadas sem alteração dos CSVs de 26/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gerarFundos, gerarFII } from '../investimentos-portao/fundos-cvm.mjs';
import { lerZip } from '../investimentos-portao/importar.mjs';
const req = createRequire(import.meta.url);
const F = req('../inv/inv-fundos.js'); const S = req('../inv/inv-snapshot.js');
const fx = (n) => readFileSync(new URL('../investimentos-portao/fixtures-fundos/' + n, import.meta.url));
const HOJE = '2026-11-27';
const R = gerarFundos({ cadastroZip: fx('registro_fundo_classe.zip'), informesZip: ['inf_diario_fi_202511.zip', 'inf_diario_fi_202610.zip', 'inf_diario_fi_202611.zip'].map(fx), hoje: HOJE, coleta: '2026-11-27T03:00:00.000Z', catalogo: { itens: [] } });
const item = (id) => R.indice.itens.map(F.deLinha).find((x) => x.assetId === id);
const hist = (id) => R.shards[F.arqShard(id)].fundos[id];
// linhas originais do CSV (para comparar fonte → motor)
function csvLinhas(zip, cnpjFmt) { const [, b] = [...lerZip(fx(zip))][0]; return b.toString('latin1').split(/\r?\n/).filter((l) => l.includes(';' + cnpjFmt + ';')).map((l) => l.split(';')); }

test('identidade: classe e subclasse são investimentos distintos; o id cabe na regra atual das operações', () => {
  const a = F.idFundo('00.832.435/0001-00', ''); const b = F.idFundo('00832435000100', 'cfkon1794851758');
  assert.equal(a, 'BR:FUNDO:00832435000100'); assert.equal(b, 'BR:FUNDO:00832435000100.CFKON1794851758');
  for (const id of [a, b]) { assert.ok(id.length <= 40); assert.match(id, /^[A-Z]+:[A-Z0-9-]+:[A-Z0-9.-]+$/); }
  assert.equal(F.idFundo('123', ''), null); assert.equal(F.idFundo('00832435000100', 'x<y'), null);
  assert.deepEqual(F.partes(b), { cnpj: '00832435000100', sub: 'CFKON1794851758' });
  assert.ok(item(a) && item(b), 'as duas chaves estão no índice');
  assert.equal(item(a).agregado, true); assert.equal(item(b).agregado, false);
  assert.equal(F.natureza(item(a)).avalia, false, 'a linha da classe que soma as subclasses não avalia carteira');
  assert.notEqual(F.ultima(hist(a))[1], F.ultima(hist(b))[1], 'cada uma com a sua cota');
  assert.equal(F.shard(b), F.shard(b)); assert.match(F.arqShard(b), /^fundos-h-\d{3}\.json$/); assert.ok(S.esquema(F.arqShard(b)));
});

test('precisão decimal: a cota é guardada como o texto da CVM e as contas não passam por ponto flutuante', () => {
  assert.equal(F.normCota('45.360755300000'), '45.3607553'); assert.equal(F.normCota('1.5E-3'), null); assert.equal(F.normCota('abc'), null);
  assert.equal(F.decTxt(F.dec('123456789012345.123456789012')), '123456789012345.123456789012', '27 dígitos preservados (o float perderia)');
  assert.equal(F.valorCentavos(100000000n * 1000n, '45.3607553'), 4536076, '1000 cotas × 45,3607553 = R$ 45.360,76 (meio-par)');
  assert.equal(F.valorCentavos(1n, '1.000000000001'), 0);
  assert.equal(F.rent('100', '101.5'), 0.015); assert.equal(F.rent('0', '1'), null, 'cota zero não gera rentabilidade');
  // fonte → motor: a última cota do fundo geral é exatamente a do CSV
  const linhas = csvLinhas('inf_diario_fi_202611.zip', '00.068.305/0001-35'); const u = linhas[linhas.length - 1];
  assert.equal(F.ultima(hist('BR:FUNDO:00068305000135'))[1], F.normCota(u[5])); assert.equal(F.ultima(hist('BR:FUNDO:00068305000135'))[0], u[3]);
});

test('não presume: cota zero e negativa ficam fora; fundo sem cota recente marcado; situação, exclusivo e público vêm do cadastro', () => {
  const zero = item('BR:FUNDO:01823373000125'); const neg = item('BR:FUNDO:09613232000190');
  for (const x of [zero, neg].filter(Boolean)) { const h = hist(x.assetId); assert.ok(!F.serie(h).some((p) => !(Number(p[1]) > 0)), 'nenhuma cota ≤ 0 na série'); }
  assert.ok(R.indice.contagem.semCotaValida >= 1);
  const liq = item('BR:FUNDO:02143193000165'); assert.equal(liq.situacao, 'Em Liquidação'); assert.match(F.disponibilidade(liq).join(), /Liquidação/);
  const exc = item('BR:FUNDO:00822055000187'); assert.match(F.disponibilidade(exc).join(), /exclusivo/i); assert.match(F.disponibilidade(exc).join(), /profissionais/);
  assert.equal(item('BR:FUNDO:00068305000135').publico, 'Público Geral');
  assert.equal(R.indice.dataBase <= R.indice.competencia, true); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(R.indice.dataBase));
});

test('aberto × fechado × listado: só fundo aberto e não listado avalia carteira; "ETF" no nome NÃO torna o fundo listado', async () => {
  const fechado = item('BR:FUNDO:00083181000167'); assert.equal(fechado.condominio, 'Fechado'); assert.equal(F.natureza(fechado).avalia, false); assert.match(F.natureza(fechado).motivo, /fechado/i);
  const alocacaoEtf = item('BR:FUNDO:06251554000148'); assert.match(alocacaoEtf.nome, /ETF/); assert.equal(alocacaoEtf.listado, false, 'fundo aberto que compra ETFs não é ETF');
  assert.equal(F.natureza({ tipo: 'FIIM', condominio: 'Aberto' }).listado, true); assert.match(F.natureza({ tipo: 'FIIM', condominio: 'Aberto' }).motivo, /ETF/);
  assert.equal(F.natureza({ tipo: 'FII', condominio: 'Fechado' }).avalia, false);
  const ad = F.criarAdaptador(R.indice, async (arq) => R.shards[arq], HOJE);
  const q = await ad.cotacao({ assetId: 'BR:FUNDO:00068305000135', classe: 'fundo' });
  assert.equal(q.tipoPreco, 'cota-oficial'); assert.equal(q.precoDec, F.ultima(hist('BR:FUNDO:00068305000135'))[1]); assert.notEqual(q.estado, 'tempo-real'); assert.match(q.detalhe.aviso, /bruta de IR/);
  const qf = await ad.cotacao({ assetId: 'BR:FUNDO:00083181000167', classe: 'fundo' }); assert.equal(qf.preco, null); assert.equal(qf.estado, 'indisponivel'); assert.equal(qf.referencia.tipo, 'valor-patrimonial');
  const qa = await ad.cotacao({ assetId: 'BR:FUNDO:00832435000100', classe: 'fundo' }); assert.equal(qa.preco, null);
  assert.ok((await ad.historico({ assetId: 'BR:FUNDO:00068305000135' })).length > 20);
});

test('rentabilidade (mês, ano, 12 meses) pela cota, comparada com o cálculo direto das linhas do CSV', () => {
  const h = hist('BR:FUNDO:00068305000135'); const r = F.rentabilidades(h);
  const nov = csvLinhas('inf_diario_fi_202611.zip', '00.068.305/0001-35'); const out = csvLinhas('inf_diario_fi_202610.zip', '00.068.305/0001-35'); const nov25 = csvLinhas('inf_diario_fi_202511.zip', '00.068.305/0001-35');
  const ult = nov[nov.length - 1]; const fimOut = out[out.length - 1];
  assert.equal(r.mes.de, fimOut[3]);
  const esperado = Number(((F.dec(ult[5]) - F.dec(fimOut[5])) * 10n ** 15n) / F.dec(fimOut[5])) / 1e15;
  assert.ok(Math.abs(r.mes.valor - esperado) < 1e-12, `mês: ${r.mes.valor} × ${esperado}`);
  const base12 = nov25.filter((l) => l[3] <= '2025-11-' + ult[3].slice(8, 10)).pop();
  assert.equal(r.m12.de, base12[3]); assert.equal(h.a.m12[1], F.normCota(base12[5]));
  assert.ok(Math.abs(r.m12.valor - Number(((F.dec(ult[5]) - F.dec(base12[5])) * 10n ** 15n) / F.dec(base12[5])) / 1e15) < 1e-12);
  assert.equal(r.ano, null, 'sem a cota de 31/12 do ano anterior no recorte: não inventa');
  assert.ok(F.meses(h).some((m) => m.captacao >= 0 && m.cotistas >= 0));
});

test('pesquisa por nome (sem acento), CNPJ (com ou sem pontuação, parcial) e código da subclasse', () => {
  assert.equal(F.pesquisar(R.indice, 'caixa empreender')[0].assetId, 'BR:FUNDO:00068305000135');
  assert.equal(F.pesquisar(R.indice, '00.068.305/0001-35')[0].assetId, 'BR:FUNDO:00068305000135');
  assert.equal(F.pesquisar(R.indice, '0006830')[0].assetId, 'BR:FUNDO:00068305000135');
  assert.equal(F.pesquisar(R.indice, 'cfkon1794851758')[0].assetId, 'BR:FUNDO:00832435000100.CFKON1794851758');
  assert.equal(F.pesquisar(R.indice, 'itau institucional referenciado').length, 3, 'a classe e as DUAS subclasses aparecem (são investimentos diferentes)');
  assert.deepEqual(F.pesquisar(R.indice, ''), []);
});

test('arquivos gerados passam no esquema do eagles-dados (licença ODbL, atribuição, competência, sem dado privado)', () => {
  const v = S.validarConteudo('fundos-indice.json', Object.assign({}, R.indice, { itens: R.indice.itens.concat(Array.from({ length: 1000 }, (_, i) => ['BR:FUNDO:' + String(i).padStart(14, '0'), 'x', 'FIF', '', 'A', 'N', 'G', 'N', '', R.indice.dataBase, ''])) }), { hoje: HOJE });
  assert.equal(v.ok, true, v.erros.join()); assert.match(R.indice.licenca, /ODbL/); assert.match(R.indice.atribuicao, /CVM/); assert.match(R.indice.transformacoes, /ODbL/);
  for (const [n, s] of Object.entries(R.shards)) assert.equal(S.validarConteudo(n, s, { hoje: HOJE }).ok, true, n);
});

test('FII (informe mensal): PL, VPA, cotistas e competência; VPA não é cotação; P/VP só com preço de negociação compatível', () => {
  const fii = gerarFII({ zips: [fx('inf_mensal_fii_2025.zip'), fx('inf_mensal_fii_2026.zip')], hoje: HOJE, coleta: '2026-11-27T03:00:00.000Z', catalogo: { itens: [{ assetId: 'BR:B3:ABCP11', classe: 'fii', ids: { cnpj: '01201140000190', isin: 'BRABCPCTF000' } }] } });
  const via = fii.fundos['00332266000131']; assert.ok(via && via.historico.length >= 2);
  const lin = (() => { const [, b] = [...lerZip(fx('inf_mensal_fii_2026.zip'))].find(([n]) => /complemento/.test(n)); const L = b.toString('latin1').split(/\r?\n/); const h = L[0].split(';'); return L.slice(1).filter((l) => l.startsWith('00.332.266/0001-31;')).map((l) => Object.fromEntries(l.split(';').map((v, i) => [h[i], v]))); })();
  const ultCsv = lin.sort((a, b) => (a.Data_Referencia < b.Data_Referencia ? -1 : a.Data_Referencia > b.Data_Referencia ? 1 : Number(a.Versao) - Number(b.Versao))).pop();
  const u = via.historico[via.historico.length - 1];
  assert.equal(u.competencia, ultCsv.Data_Referencia.slice(0, 7)); assert.equal(u.vpa, Number(ultCsv.Valor_Patrimonial_Cotas)); assert.equal(u.cotistas, Number(ultCsv.Total_Numero_Cotistas));
  assert.equal(fii.fundos['01201140000190'].assetId, 'BR:B3:ABCP11', 'vínculo com o catálogo pelo ISIN');
  assert.match(fii.transformacoes, /NÃO é cotação/); assert.equal(S.validarConteudo('fii-mensal.json', Object.assign({}, fii, { fundos: Object.assign({}, ...Array.from({ length: 100 }, (_, i) => ({ ['x' + i]: via })), fii.fundos) }), { hoje: HOJE }).ok, true);
  const f = Object.assign({}, u);
  assert.equal(F.pvp(f, null).valor, null); assert.match(F.pvp(f, null).motivo, /B3/);
  assert.equal(F.pvp(f, { preco: 90, data: u.competenciaFim, estado: 'fechamento', tipoPreco: 'cota-oficial' }).valor, null, 'cota patrimonial não é preço');
  assert.equal(F.pvp(f, { preco: 90, data: '2025-01-01', estado: 'manual' }).valor, null, 'datas incompatíveis');
  const ok = F.pvp(f, { preco: 90, data: u.competenciaFim, estado: 'manual' }); assert.equal(ok.valor, Math.round((90 / u.vpa) * 100) / 100);
});
