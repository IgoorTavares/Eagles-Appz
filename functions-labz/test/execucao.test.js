const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { criarFila } = require('../src/execucao/fila');
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');

test('execução nasce CREATED e só anda pelas transições permitidas, com histórico', async () => {
  const c = await montarComEmpresas();
  const e = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Cinco legendas para o lançamento', modo: 'orquestrado' });
  assert.equal(e.estado, 'CREATED');
  assert.equal(e.agenteId, '08-estrategista');
  await rejeita(() => c.execucoes.transicionar(c.ator, e.id, 'COMPLETED'), 'transicao-invalida');
  await c.execucoes.transicionar(c.ator, e.id, 'PLANNING');
  const r = await c.execucoes.transicionar(c.ator, e.id, 'READY', { motivo: 'plano pronto' });
  assert.equal(r.versao, 3);
  assert.deepEqual(r.historico.map((h) => h.para), ['CREATED', 'PLANNING', 'READY']);
  assert.equal((await c.fila.listar((x) => x.execucaoId === e.id)).length, 1, 'entrou na fila junto com o READY');
});

test('conflito de versão: duas pessoas não mudam a mesma execução por cima uma da outra', async () => {
  const c = await montarComEmpresas();
  const e = await c.execucoes.criar(c.ator, { objetivo: 'Teste de concorrência', modo: 'especialista', agenteId: '04-roteirista' });
  await c.execucoes.transicionar(c.ator, e.id, 'PLANNING', { versaoEsperada: 1 });
  await rejeita(() => c.execucoes.transicionar(c.ator, e.id, 'CANCELLED', { versaoEsperada: 1 }), 'conflito');
});

test('validações de criação: modo, agente e empresa', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.execucoes.criar(c.ator, { objetivo: 'Sem agente', modo: 'especialista' }), 'invalido');
  await rejeita(() => c.execucoes.criar(c.ator, { objetivo: 'Agente errado', modo: 'orquestrado', agenteId: '04-roteirista' }), 'invalido');
  await c.empresas.arquivar(c.ator, c.B.id);
  await rejeita(() => c.execucoes.criar(c.ator, { objetivo: 'Empresa arquivada', modo: 'orquestrado', empresaId: c.B.id }), 'precondicao');
  await rejeita(() => c.execucoes.criar({ tipo: 'superadmin', uid: 'sa' }, { objetivo: 'Ator falso', modo: 'orquestrado' }), 'permissao-negada');
});

test('execução interrompida volta para a fila; depois de 3 vezes vira FAILED', async () => {
  const c = await montarComEmpresas();
  const e = await c.execucoes.criar(c.ator, { objetivo: 'Execução que cai', modo: 'orquestrado' });
  for (const p of ['PLANNING', 'READY', 'RUNNING']) await c.execucoes.transicionar(c.ator, e.id, p);
  c.relogio.avancarDias(1);
  assert.deepEqual((await c.execucoes.recuperarInterrompidas(60 * 1000)).map((x) => x.para), ['READY']);
  await c.execucoes.transicionar(c.execucoes.ATOR_SISTEMA, e.id, 'RUNNING');
  c.relogio.avancarDias(1);
  assert.deepEqual((await c.execucoes.recuperarInterrompidas(60 * 1000)).map((x) => x.para), ['READY']);
  await c.execucoes.transicionar(c.execucoes.ATOR_SISTEMA, e.id, 'RUNNING');
  c.relogio.avancarDias(1);
  assert.deepEqual((await c.execucoes.recuperarInterrompidas(60 * 1000)).map((x) => x.para), ['FAILED']);
  const fim = await c.execucoes.obter(c.ator, e.id);
  assert.equal(fim.estado, 'FAILED');
  assert.equal(fim.tentativas, 3);
  assert.ok(fim.historico.some((h) => h.por === 'labz-sistema'));
});

test('execução com sinal de vida recente não é retomada', async () => {
  const c = await montarComEmpresas();
  const e = await c.execucoes.criar(c.ator, { objetivo: 'Execução viva', modo: 'orquestrado' });
  for (const p of ['PLANNING', 'READY', 'RUNNING']) await c.execucoes.transicionar(c.ator, e.id, p);
  await c.execucoes.batimento(e.id);
  assert.deepEqual(await c.execucoes.recuperarInterrompidas(60 * 60 * 1000), []);
});

test('fila: reserva única, conclusão, nova tentativa com espera e desistência', async () => {
  const banco = criarBancoMemoria();
  let agora = Date.parse('2026-11-01T12:00:00Z');
  const relogio = () => new Date(agora).toISOString();
  const fila = criarFila({ banco, relogio, opcoes: { maxTentativas: 2, reservaMs: 60000, esperaBaseMs: 1000 } });
  const id = await fila.enfileirar({ execucaoId: 'exe1', tipo: 'executar' });
  const r1 = await fila.reservar('trab-A');
  assert.equal(r1.id, id);
  assert.equal(await fila.reservar('trab-B'), null, 'ninguém pega o que já está reservado');
  await rejeita(() => fila.concluir(id, 'trab-B'), 'precondicao');
  assert.equal(await fila.falhar(id, 'trab-A', 'erro temporário'), 'pendente');
  assert.equal(await fila.reservar('trab-B'), null, 'espera antes da nova tentativa');
  agora += 2000;
  const r2 = await fila.reservar('trab-B');
  assert.equal(r2.tentativas, 2);
  assert.equal(await fila.falhar(id, 'trab-B', 'de novo'), 'falhou');
  const id2 = await fila.enfileirar({ execucaoId: 'exe2', tipo: 'executar' });
  await fila.reservar('trab-C');
  agora += 61000; // trabalhador caiu: a reserva venceu
  const r3 = await fila.reservar('trab-D');
  assert.equal(r3.id, id2);
  await fila.concluir(id2, 'trab-D', { ok: true });
  assert.deepEqual((await fila.listar()).map((x) => x.estado).sort(), ['falhou', 'feita']);
});
