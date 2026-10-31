// Fase 4B: limites de consumo por execução, agente, cliente, provedor e global;
// estimativas; uso desconhecido; custo desconhecido ≠ zero; bloqueio preventivo;
// nenhuma cobrança real. NENHUM preço vem do código (os preços daqui são
// FICTÍCIOS, cadastrados pelo próprio teste).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { PADRAO_LIMITES } = require('../src/motor/consumo');

const cfg = (provedor) => ({ provedor, modelo: 'modelo-ficticio-1', uso: 'simulado', recursosDoModelo: ['texto', 'saida-estruturada', 'ferramentas', 'imagem-entrada', 'imagem-saida'] });
const montar = (roteiro) => montarComEmpresas({ ia: { transporte: transporteComModeloSimulado(roteiro || {}) } });
const limites = (extra) => Object.assign(JSON.parse(JSON.stringify(PADRAO_LIMITES)), extra);
async function rodar(c, agenteId = '04-roteirista', empresaId) {
  const exe = await c.execucoes.criar(c.ator, { empresaId: empresaId === undefined ? c.A.id : empresaId, objetivo: 'Escrever a legenda', modo: 'especialista', agenteId });
  await c.motor.planejar(c.ator, exe.id);
  const r = await c.motor.trabalhar(`t-${exe.id}`);
  return { exe, r, d: await c.motor.diagnosticar(c.ator, exe.id) };
}

test('limite por execução (tokens): bloqueio ANTES de chamar o provedor', async () => {
  const c = await montar();
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Escrever a legenda', modo: 'especialista', agenteId: '04-roteirista', limites: { tokens: 100 } });
  await c.motor.planejar(c.ator, exe.id);
  assert.strictEqual((await c.motor.trabalhar('t1')).resultado, 'bloqueada-por-custo');
  const d = await c.motor.diagnosticar(c.ator, exe.id);
  assert.deepStrictEqual([d.estado, d.diagnostico.motivo, d.custos.tokens], ['REVISION_REQUIRED', 'limite-de-tokens', 0]);
  assert.strictEqual(c.adaptador && (await c.consumo.doDia(c.ator)).global.chamadas, 0, 'nenhuma chamada aconteceu');
});

test('limites diários por agente, por cliente, por provedor e global (com exceções)', async () => {
  // por agente
  let c = await montar();
  await c.consumo.definirLimites(c.ator, limites({ porAgente: { tokensDia: null, custoDia: null }, excecoes: { agentes: { '04-roteirista': { tokensDia: 5000 } }, empresas: {}, provedores: {} } }));
  assert.strictEqual((await rodar(c)).r.resultado, 'concluida');
  let s = await rodar(c);
  assert.deepStrictEqual([s.r.resultado, s.d.diagnostico.motivo], ['bloqueada-por-custo', 'limite-diario-de-tokens-agente']);
  assert.strictEqual((await rodar(c, '02-designer')).r.resultado, 'concluida', 'outro agente não é afetado');

  // por cliente (empresa)
  c = await montar();
  await c.consumo.definirLimites(c.ator, limites({ porEmpresa: { tokensDia: 5000, custoDia: null } }));
  assert.strictEqual((await rodar(c, '04-roteirista', c.A.id)).r.resultado, 'concluida');
  s = await rodar(c, '02-designer', c.A.id);
  assert.strictEqual(s.d.diagnostico.motivo, 'limite-diario-de-tokens-empresa');
  assert.strictEqual((await rodar(c, '04-roteirista', c.B.id)).r.resultado, 'concluida', 'a outra empresa tem o próprio limite');

  // por provedor
  c = await montar();
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('openai'));
  await c.consumo.definirLimites(c.ator, limites({ excecoes: { agentes: {}, empresas: {}, provedores: { openai: { tokensDia: 5000 } } } }));
  assert.strictEqual((await rodar(c)).r.resultado, 'concluida');
  s = await rodar(c);
  assert.strictEqual(s.d.diagnostico.motivo, 'limite-diario-de-tokens-provedor');
  assert.strictEqual((await rodar(c, '02-designer')).r.resultado, 'concluida', 'provedor simulado não é afetado');

  // global
  c = await montar();
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: 5000, custoDia: null } }));
  assert.strictEqual((await rodar(c)).r.resultado, 'concluida');
  s = await rodar(c, '02-designer');
  assert.strictEqual(s.d.diagnostico.motivo, 'limite-diario-de-tokens-global');
  // o dia seguinte começa zerado
  c.relogio.avancarDias(1);
  assert.strictEqual((await rodar(c, '02-designer')).r.resultado, 'concluida');
  const ev = (await c.auditoria.listar()).filter((e) => e.tipo === 'custo.bloqueio_preventivo');
  assert.ok(ev.length >= 1 && ev.every((e) => Object.keys(e.detalhes).sort().join() === 'etapa,motivo,secao'));
});

test('custo desconhecido NUNCA vira zero; com limite de custo e preço desconhecido, a chamada é bloqueada', async () => {
  const c = await montar();
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('anthropic'));
  const { d } = await rodar(c);
  assert.strictEqual(d.estado, 'COMPLETED');
  assert.deepStrictEqual([d.custos.custoDesconhecido, d.custos.custoEstimado, d.custos.custoConfirmado, d.custos.cobrancaReal], [1, null, null, false]);
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.custoDesconhecido, dia.global.custo, dia.custoConfirmado, dia.cobrancaReal], [1, 0, null, false]);
  assert.ok(dia.provedores.anthropic.custoDesconhecido === 1, 'o desconhecido fica contado, separado do custo');
  // limite de custo + preço desconhecido = não dá para garantir → bloqueia
  await c.consumo.definirLimites(c.ator, limites({ porProvedor: { tokensDia: null, custoDia: 1 } }));
  const s = await rodar(c);
  assert.deepStrictEqual([s.r.resultado, s.d.diagnostico.motivo], ['bloqueada-por-custo', 'custo-desconhecido-com-limite-provedor']);
  // o provedor simulado não tem cobrança (não é "desconhecido")
  assert.strictEqual((await rodar(c, '02-designer')).r.resultado, 'concluida');
});

test('estimativa com preço FICTÍCIO cadastrado pelo Super Admin; limite de custo diário bloqueia preventivamente', async () => {
  const c = await montar();
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('openai'));
  await rejeita(() => c.consumo.definirPreco(c.ator, 'openai/modelo-ficticio-1', { entradaPorMilhao: 1, saidaPorMilhao: 2, moeda: 'USD' }), 'invalido'); // sem fonte
  await rejeita(() => c.consumo.definirPreco(c.ator, 'qualquer/coisa', { entradaPorMilhao: 1, saidaPorMilhao: 2, moeda: 'USD', fonte: 'teste fictício', conferidoEm: '2026-10-30' }), 'invalido');
  await c.consumo.definirPreco(c.ator, 'openai/modelo-ficticio-1', { entradaPorMilhao: 1000, saidaPorMilhao: 2000, moeda: 'USD', fonte: 'PREÇO FICTÍCIO DE TESTE', conferidoEm: '2026-10-30' });
  const { d } = await rodar(c);
  assert.ok(d.custos.custoEstimado && d.custos.custoEstimado.valor > 0 && d.custos.custoEstimado.moeda === 'USD');
  assert.deepStrictEqual([d.custos.custoDesconhecido, d.custos.custoConfirmado, d.custos.cobrancaReal], [0, null, false], 'estimativa não é cobrança');
  const gasto = (await c.consumo.doDia(c.ator)).global.custo;
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: null, custoDia: gasto + gasto / 4 } }));
  const s = await rodar(c);
  assert.deepStrictEqual([s.r.resultado, s.d.diagnostico.motivo], ['bloqueada-por-custo', 'limite-diario-de-custo-global']);
});

test('uso desconhecido (o provedor não informou): conta a ESTIMATIVA, marcada como estimada', async () => {
  const c = await montar({ '04-roteirista': 'sem-uso' });
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('google'));
  const { d } = await rodar(c);
  assert.ok(d.custos.tokensEstimados > 0);
  assert.strictEqual(d.custos.usoInformado.tokensEntrada, 0);
  const dia = await c.consumo.doDia(c.ator);
  assert.ok(dia.global.estimadas === 1 && dia.global.tokens > 0, 'entra no limite mesmo sem o provedor informar');
});

test('reservas: chamadas simultâneas não passam juntas do limite; reserva esquecida vence sozinha', async () => {
  const c = await montar();
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: 7000, custoDia: null } }));
  const p = { execucaoId: 'x1', etapaId: 'e1', agenteId: '04-roteirista', empresaId: c.A.id, provedor: 'simulado', modelo: 'simulado', tokensEntrada: 2000, tokensSaida: 2000 };
  const rs = await Promise.all([c.consumo.reservar(p), c.consumo.reservar(p), c.consumo.reservar(p)]);
  assert.strictEqual(rs.filter((r) => r.permitido).length, 1, 'só uma cabe (4000 + 4000 > 7000)');
  // processo caiu sem liquidar: depois do prazo, a reserva para de contar
  c.relogio.avancarDias(11 / (24 * 60));
  const r4 = await c.consumo.reservar(p);
  assert.strictEqual(r4.permitido, true);
  assert.strictEqual((await c.consumo.reservar(p)).permitido, false, 'a reserva em aberto conta (4000 + 4000 > 7000)');
  // liquidação troca a reserva pelo uso real (menor): sobra espaço de novo
  await c.consumo.liquidar(r4, p, { tokensEntrada: 100, tokensSaida: 100, fonte: 'provedor-simulado' });
  assert.strictEqual((await c.consumo.reservar(p)).permitido, true);
  assert.strictEqual((await c.consumo.doDia(c.ator)).global.tokens, 200);
});

test('limites e preços só pelo Super Admin; esquema fechado; nenhuma cobrança real e nenhum preço no código', async () => {
  const c = await montar();
  const sistema = Object.freeze({ tipo: 'sistema', uid: 'labz-sistema' });
  await rejeita(() => c.consumo.definirLimites(sistema, limites()), 'permissao-negada');
  await rejeita(() => c.consumo.definirPreco(sistema, 'openai/x', {}), 'permissao-negada');
  await rejeita(() => c.consumo.definirLimites(c.ator, limites({ extra: 1 })), 'invalido');
  await rejeita(() => c.consumo.definirLimites(c.ator, limites({ excecoes: { agentes: { '99-x': { tokensDia: 1 } }, empresas: {}, provedores: {} } })), 'invalido');
  await rejeita(() => c.consumo.definirLimites(c.ator, limites({ excecoes: { agentes: {}, empresas: {}, provedores: { 'fornecedor-x': { tokensDia: 1 } } } })), 'invalido');
  // nenhum preço de provedor no código (só a taxa FICTÍCIA da unidade simulada da 4A)
  const src = path.join(__dirname, '..', 'src');
  const arquivos = [];
  const andar = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((x) => (x.isDirectory() ? andar(path.join(d, x.name)) : arquivos.push(path.join(d, x.name))));
  andar(src);
  arquivos.forEach((f) => assert.ok(!/PorMilhao\s*:\s*\d/.test(fs.readFileSync(f, 'utf8')), `${path.relative(src, f)}: preço fixo no código`));
  assert.strictEqual((await c.consumo.doDia(c.ator)).cobrancaReal, false);
});
