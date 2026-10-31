const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { criarAuditoria } = require('../src/auditoria/eventos');
const { exigirSuperAdmin, exigirAtor, MENSAGEM_NEGADO } = require('../src/auth/super-admin');
const { rejeita } = require('./ajuda');

async function cenario() {
  const banco = criarBancoMemoria();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('usuarios/sa2', { role: 'SuperAdmin' }); // Super Admin fora da lista
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1' });
  await banco.gravar('usuarios/semrole', { tenantId: 't1' }); // sem nível: no navegador viraria Diretor
  await banco.gravar('usuarios/minusculo', { role: 'superadmin' });
  await banco.gravar('labz_config/acesso', { uids: ['sa', 'sa2'] });
  const auditoria = criarAuditoria(banco);
  return { banco, auditoria, deps: { banco, auditoria, uidsAutorizados: 'sa, outro' } };
}

test('passa só o Super Admin que está na lista de autorizados', async () => {
  const { deps } = await cenario();
  const ator = await exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@x.com' } }, deps);
  assert.equal(ator.tipo, 'superadmin');
  assert.equal(ator.uid, 'sa');
  assert.ok(Object.isFrozen(ator));
});

test('recusa: sem login, login anônimo, Diretor, sem nível, nível com outra grafia, Super Admin fora da lista', async () => {
  const { deps } = await cenario();
  await rejeita(() => exigirSuperAdmin(null, deps), 'nao-autenticado');
  await rejeita(() => exigirSuperAdmin({}, deps), 'nao-autenticado');
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: { firebase: { sign_in_provider: 'anonymous' } } }, deps), 'permissao-negada');
  for (const uid of ['d1', 'semrole', 'minusculo', 'sa2', 'ninguem']) {
    const e = await rejeita(() => exigirSuperAdmin({ uid, token: {} }, deps), 'permissao-negada');
    assert.equal(e.message, MENSAGEM_NEGADO, 'a mensagem não revela o motivo');
  }
});

test('recusa quando a lista de autorizados está vazia (falha fechada)', async () => {
  const { deps } = await cenario();
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: {} }, Object.assign({}, deps, { uidsAutorizados: '' })), 'permissao-negada');
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: {} }, Object.assign({}, deps, { uidsAutorizados: undefined })), 'permissao-negada');
});

test('recusa a conta bloqueada por 5 senhas erradas', async () => {
  const { banco, deps } = await cenario();
  await banco.gravar('tentativas_login/sa@x.com', { falhas: 5 });
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@x.com' } }, deps), 'permissao-negada');
  await banco.gravar('tentativas_login/sa@x.com', { falhas: 4 });
  assert.equal((await exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@x.com' } }, deps)).uid, 'sa');
});

test('toda recusa fica na auditoria com o motivo', async () => {
  const { auditoria, deps } = await cenario();
  await rejeita(() => exigirSuperAdmin({ uid: 'd1', token: {} }, deps));
  await rejeita(() => exigirSuperAdmin({ uid: 'sa2', token: {} }, deps));
  const ev = await auditoria.listar();
  assert.deepEqual(ev.map((e) => e.detalhes.motivo).sort(), ['fora-da-lista-de-autorizados', 'nao-e-super-admin']);
  assert.ok(ev.every((e) => e.tipo === 'auth.acesso_negado'));
});

test('os serviços não aceitam um "ator" montado à mão', () => {
  assert.throws(() => exigirAtor({ tipo: 'superadmin', uid: 'sa' }), (e) => e.codigo === 'permissao-negada');
  assert.throws(() => exigirAtor(null), (e) => e.codigo === 'permissao-negada');
  assert.throws(() => exigirAtor(Object.freeze({ tipo: 'diretor', uid: 'd1' })), (e) => e.codigo === 'permissao-negada');
});

test('as duas listas precisam concordar: segredo do servidor E labz_config/acesso', async () => {
  const { banco, deps } = await cenario();
  // sa2 está no banco mas não no segredo
  await rejeita(() => exigirSuperAdmin({ uid: 'sa2', token: {} }, deps), 'permissao-negada');
  // sa está no segredo; sai do banco → negado
  await banco.gravar('labz_config/acesso', { uids: ['outro'] });
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: {} }, deps), 'permissao-negada');
  // sem o documento → negado (falha fechada)
  const b2 = require('../src/armazenamento/banco-memoria').criarBancoMemoria();
  await b2.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await rejeita(() => exigirSuperAdmin({ uid: 'sa', token: {} }, { banco: b2, uidsAutorizados: 'sa' }), 'permissao-negada');
});
