const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montar, rejeita } = require('./ajuda');

test('cria empresa própria da LABZ AI, sem vínculo, com auditoria', async () => {
  const c = await montar();
  const e = await c.empresas.criar(c.ator, { nome: '  Café Fictício  ', observacoes: 'teste' });
  assert.equal(e.nome, 'Café Fictício');
  assert.equal(e.slug, 'cafe-ficticio');
  assert.equal(e.status, 'ativa');
  assert.equal(e.vinculo, null);
  assert.equal(e.criadoPor, 'sa');
  assert.ok((await c.auditoria.listar()).some((x) => x.tipo === 'empresa.criada'));
  assert.ok(c.banco._caminhos().includes(`labz_empresas/${e.id}`));
});

test('valida dados e não aceita nome repetido', async () => {
  const c = await montar();
  await c.empresas.criar(c.ator, { nome: 'Marca X' });
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'marca  x' }), 'conflito');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'A' }), 'invalido');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Válida', senha: '123' }), 'invalido');
  await rejeita(() => c.empresas.criar({ tipo: 'superadmin', uid: 'sa' }, { nome: 'Sem ator real' }), 'permissao-negada');
});

test('vínculo opcional com empresa do sistema ou cliente do CRM (só se existir)', async () => {
  const c = await montar();
  const t = await c.empresas.criar(c.ator, { nome: 'Agência', vinculo: { tipo: 'tenant', tenantId: 't1' } });
  assert.deepEqual(t.vinculo, { tipo: 'tenant', tenantId: 't1' });
  const cl = await c.empresas.criar(c.ator, { nome: 'Cliente Um', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } });
  assert.equal(cl.vinculo.clienteId, 'c1');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Fantasma', vinculo: { tipo: 'tenant', tenantId: 'nao_existe' } }), 'nao-encontrado');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Fantasma 2', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'zz' } }), 'nao-encontrado');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Sem cliente', vinculo: { tipo: 'crm_cliente', tenantId: 't1' } }), 'invalido');
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Caminho', vinculo: { tipo: 'tenant', tenantId: '../usuarios' } }), 'invalido');
});

test('um mesmo vínculo não pertence a duas empresas; dá para trocar e remover', async () => {
  const c = await montar();
  const a = await c.empresas.criar(c.ator, { nome: 'Primeira', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } });
  await rejeita(() => c.empresas.criar(c.ator, { nome: 'Segunda', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } }), 'conflito');
  const b = await c.empresas.criar(c.ator, { nome: 'Segunda' });
  await rejeita(() => c.empresas.vincular(c.ator, b.id, { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' }), 'conflito');
  await c.empresas.vincular(c.ator, a.id, { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c2' }); // a troca libera o c1
  const b2 = await c.empresas.vincular(c.ator, b.id, { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' });
  assert.equal(b2.vinculo.clienteId, 'c1');
  const b3 = await c.empresas.vincular(c.ator, b.id, null);
  assert.equal(b3.vinculo, null);
});

test('o vínculo não copia nem altera nada do CRM', async () => {
  const c = await montar();
  const antes = JSON.stringify(await c.banco.obter('tenants/t1/crm_clientes/c1'));
  await c.empresas.criar(c.ator, { nome: 'Ligada', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } });
  assert.equal(JSON.stringify(await c.banco.obter('tenants/t1/crm_clientes/c1')), antes);
  assert.ok(c.banco._caminhos().filter((p) => p.startsWith('tenants/')).every((p) => ['tenants/t1', 'tenants/t1/crm_clientes/c1', 'tenants/t1/crm_clientes/c2'].includes(p)));
});

test('alterar, arquivar, reativar e listar por situação', async () => {
  const c = await montar();
  const e = await c.empresas.criar(c.ator, { nome: 'Antiga' });
  const e2 = await c.empresas.alterar(c.ator, e.id, { nome: 'Nova Marca' });
  assert.equal(e2.slug, 'nova-marca');
  await c.empresas.arquivar(c.ator, e.id, 'encerrou contrato');
  assert.equal((await c.empresas.listar(c.ator, { status: 'arquivada' })).length, 1);
  assert.equal((await c.empresas.listar(c.ator, { status: 'ativa' })).length, 0);
  await rejeita(() => c.empresas.garantirAtiva(e.id), 'precondicao');
  await c.empresas.reativar(c.ator, e.id);
  assert.equal((await c.empresas.obter(c.ator, e.id)).status, 'ativa');
  const tipos = (await c.auditoria.listar()).map((x) => x.tipo);
  ['empresa.criada', 'empresa.alterada', 'empresa.arquivada', 'empresa.reativada'].forEach((t) => assert.ok(tipos.includes(t), t));
});
