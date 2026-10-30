// Integração no SIMULADOR do Firebase: login de verdade (tokens do emulador
// de Auth), a função labzApi rodando no emulador de Functions, o Firestore
// com as regras reais (firestore.rules) e o adaptador do Admin SDK.
// Projeto "demo-labz": nada sai deste computador. Dados FICTÍCIOS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { criarBancoFirestore } = require('../src/armazenamento/banco-firestore');
const { criarFila } = require('../src/execucao/fila');

const PROJETO = 'demo-labz';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FN = `http://127.0.0.1:5001/${PROJETO}/southamerica-east1/labzApi`;
const SEGREDO_FICTICIO = 'VALOR-FICTICIO-SO-PARA-TESTE-123';

admin.initializeApp({ projectId: PROJETO });
const db = admin.firestore();
const SENHA = 'senha-de-teste-123';
const tokens = {};
const appsCliente = [];

async function entrar(email) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qualquer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: SENHA, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou: ' + JSON.stringify(j));
  return j.idToken;
}

async function chamar(token, acao, dados) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify({ data: { acao, dados } }) });
  const texto = await r.text();
  let j;
  try { j = JSON.parse(texto); } catch (e) { j = { error: { status: 'NAO_JSON', message: texto.slice(0, 200) } }; }
  return { http: r.status, texto, resultado: j.result, erro: j.error };
}
const ok = async (token, acao, dados) => {
  const r = await chamar(token, acao, dados);
  assert.ok(r.resultado && r.resultado.ok, `${acao} falhou: ${JSON.stringify(r.erro)}`);
  return r.resultado.resultado;
};

before(async () => {
  for (const [uid, email] of [['sa-teste', 'sa@teste.local'], ['sa-fora', 'safora@teste.local'], ['d-teste', 'diretor@teste.local'], ['sa-desativado', 'sadesativado@teste.local']]) {
    await admin.auth().createUser({ uid, email, password: SENHA }).catch((e) => { if (e.code !== 'auth/uid-already-exists') throw e; });
  }
  await db.doc('tenants/t1').set({ nomeEmpresa: 'Agência Fictícia', plano: 'ambos', ativo: true });
  await db.doc('tenants/t1/crm_clientes/c1').set({ nome: 'Cliente Fictício' });
  // Super Admin vinculado à própria empresa (o caso da falha corrigida)
  await db.doc('usuarios/sa-teste').set({ role: 'SuperAdmin', tenantId: 't1', nome: 'Super Teste' });
  await db.doc('usuarios/sa-fora').set({ role: 'SuperAdmin', nome: 'Super fora da lista' });
  await db.doc('usuarios/d-teste').set({ role: 'Diretor', tenantId: 't1', nome: 'Diretor Teste', titular: true });
  await db.doc('usuarios/sa-desativado').set({ role: 'SuperAdmin', nome: 'Super que será desativado' });
  await db.doc('labz_config/acesso').set({ uids: ['sa-teste', 'sa-fora', 'sa-desativado'] }); // sa-fora está no banco, mas não no segredo
  tokens.sa = await entrar('sa@teste.local');
  tokens.saFora = await entrar('safora@teste.local');
  tokens.diretor = await entrar('diretor@teste.local');
  tokens.saDesativado = await entrar('sadesativado@teste.local');
});

// fecha as conexões no fim (senão o processo de testes fica esperando)
after(async () => {
  const { deleteApp } = require('firebase/app');
  await Promise.all(appsCliente.map((a) => deleteApp(a).catch(() => {})));
  await admin.app().delete().catch(() => {});
});

// ---------- autorização na função real ----------
test('sem login: a função recusa (UNAUTHENTICATED)', async () => {
  const r = await chamar(null, 'sistema.status', {});
  assert.equal(r.erro && r.erro.status, 'UNAUTHENTICATED');
});

test('token adulterado: LIMITAÇÃO do simulador (não confere assinatura) — registrado, não comprovado', async () => {
  const partes = tokens.diretor.split('.');
  const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  carga.user_id = carga.sub = 'sa-teste';
  const falso = [partes[0], Buffer.from(JSON.stringify(carga)).toString('base64url'), partes[2]].join('.');
  const r = await chamar(falso, 'empresas.listar', {});
  // O emulador de Functions NÃO confere a assinatura do token (o servidor real confere).
  // Registramos o comportamento sem fingir: se o emulador aceitar, o teste avisa.
  // Nem o emulador de Functions nem o Admin SDK ligado ao emulador de Auth conferem a
  // assinatura do token. No Firebase real, a assinatura é conferida pelo Google e de novo
  // por verifyIdToken (index.js). Aqui só registramos o comportamento, sem fingir.
  if (r.resultado && r.resultado.ok) console.log('# AVISO: o simulador aceitou um token com assinatura inválida (limitação do simulador).');
  else assert.equal(r.erro.status, 'UNAUTHENTICATED');
});

test('Diretor com login real é recusado e a recusa fica na auditoria', async () => {
  const r = await chamar(tokens.diretor, 'empresas.criar', { empresa: { nome: 'Invasora' } });
  assert.equal(r.erro && r.erro.status, 'PERMISSION_DENIED');
  assert.equal((await db.collection('labz_empresas').where('nome', '==', 'Invasora').get()).size, 0);
  const ev = await db.collection('labz_eventos').where('tipo', '==', 'auth.acesso_negado').get();
  assert.ok(ev.docs.some((d) => d.data().ator && d.data().ator.uid === 'd-teste' && d.data().detalhes.motivo === 'nao-e-super-admin'));
});

test('Super Admin fora do segredo (mesmo estando no banco) é recusado', async () => {
  const r = await chamar(tokens.saFora, 'sistema.status', {});
  assert.equal(r.erro && r.erro.status, 'PERMISSION_DENIED');
});

test('conta desativada perde o acesso na hora, mesmo com um token ainda válido', async () => {
  assert.ok((await chamar(tokens.saDesativado, 'sistema.status', {})).resultado.ok, 'antes de desativar, entra');
  await admin.auth().updateUser('sa-desativado', { disabled: true });
  const r = await chamar(tokens.saDesativado, 'sistema.status', {});
  assert.equal(r.erro && r.erro.status, 'UNAUTHENTICATED');
  const ev = await db.collection('labz_eventos').where('tipo', '==', 'auth.token_recusado').get();
  assert.ok(ev.docs.some((d) => d.data().ator.uid === 'sa-desativado'));
});

test('ação desconhecida e dados inválidos: INVALID_ARGUMENT', async () => {
  assert.equal((await chamar(tokens.sa, 'sistema.apagarTudo', {})).erro.status, 'INVALID_ARGUMENT');
  assert.equal((await chamar(tokens.sa, 'empresas.criar', { empresa: { nome: 'A' } })).erro.status, 'INVALID_ARGUMENT');
});

test('status: o segredo fictício aparece como "configurado", mas o valor nunca sai do servidor', async () => {
  const r = await chamar(tokens.sa, 'sistema.status', {});
  assert.equal(r.resultado.resultado.provedores.anthropic, 'configurado');
  assert.equal(r.resultado.resultado.provedores.openai, 'nao-configurado');
  assert.ok(!r.texto.includes(SEGREDO_FICTICIO));
});

// ---------- persistência real (Firestore do emulador) ----------
let A, B;
test('empresas e vínculo com o CRM ficam gravados no Firestore', async () => {
  A = await ok(tokens.sa, 'empresas.criar', { empresa: { nome: 'Marca Alfa Integração', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } } });
  B = await ok(tokens.sa, 'empresas.criar', { empresa: { nome: 'Marca Beta Integração' } });
  const doc = await db.doc(`labz_empresas/${A.id}`).get();
  assert.equal(doc.data().vinculo.clienteId, 'c1');
  assert.ok((await db.doc('labz_vinculos/crm_t1__c1').get()).exists);
  assert.equal((await chamar(tokens.sa, 'empresas.criar', { empresa: { nome: 'Outra', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } } })).erro.status, 'ALREADY_EXISTS');
  assert.deepEqual((await db.doc('tenants/t1/crm_clientes/c1').get()).data(), { nome: 'Cliente Fictício' }, 'o CRM não foi alterado');
});

test('memória: pendente → aprovada, versões guardadas, isolamento entre empresas no contexto', async () => {
  const mA = await ok(tokens.sa, 'memoria.criar', { memoria: { escopo: 'cliente', alvo: { empresaId: A.id }, categoria: 'tom-de-voz', titulo: 'Voz', conteudo: 'INTEG-ALFA: tom leve', origem: { tipo: 'manual' } } });
  const mB = await ok(tokens.sa, 'memoria.criar', { memoria: { escopo: 'cliente', alvo: { empresaId: B.id }, categoria: 'tom-de-voz', titulo: 'Voz', conteudo: 'INTEG-BETA: tom formal', origem: { tipo: 'manual' } } });
  assert.equal(mA.status, 'pendente');
  await ok(tokens.sa, 'memoria.aprovar', { ref: mA.ref, versao: 1 });
  await ok(tokens.sa, 'memoria.aprovar', { ref: mB.ref, versao: 1 });
  const v1 = await db.doc(`labz_empresas/${A.id}/memorias/${mA.ref.memoriaId}/versoes/1`).get();
  assert.equal(v1.data().status, 'aprovada');
  assert.equal(v1.data().aprovacao.por, 'sa-teste');
  await ok(tokens.sa, 'memoria.novaVersao', { ref: mA.ref, conteudo: { conteudo: 'INTEG-ALFA: tom leve e divertido', origem: { tipo: 'manual' } } });
  await ok(tokens.sa, 'memoria.aprovar', { ref: mA.ref, versao: 2 });
  await ok(tokens.sa, 'memoria.voltarVersao', { ref: mA.ref, versao: 1 });
  const vs = await ok(tokens.sa, 'memoria.versoes', { ref: mA.ref });
  assert.deepEqual(vs.map((v) => v.status), ['substituida', 'substituida', 'aprovada']);
  const ctxA = JSON.stringify(await ok(tokens.sa, 'contexto.previa', { agenteId: '04-roteirista', empresaId: A.id, briefing: 'legenda' }));
  assert.ok(ctxA.includes('INTEG-ALFA: tom leve') && !ctxA.includes('divertido') && !ctxA.includes('INTEG-BETA'));
});

test('execução → correção permanente → aprendizado aprovado → entra no contexto', async () => {
  const e = await ok(tokens.sa, 'execucoes.criar', { execucao: { empresaId: A.id, objetivo: 'Legendas de teste de integração', modo: 'especialista', agenteId: '04-roteirista' } });
  const cor = await ok(tokens.sa, 'correcoes.registrar', { correcao: { tarefaId: e.id, texto: 'INTEG-REGRA: nunca usar emojis', alcance: 'permanente' } });
  assert.equal(cor.proposta.alvo.empresaId, A.id);
  await ok(tokens.sa, 'correcoes.aprovar', { aprendizadoId: cor.aprendizadoId, ajustes: { titulo: 'Sem emojis' } });
  const ctx = JSON.stringify(await ok(tokens.sa, 'contexto.previa', { agenteId: '04-roteirista', empresaId: A.id, tarefaId: e.id, briefing: 'post' }));
  assert.ok(ctx.includes('INTEG-REGRA'));
  const ctxB = JSON.stringify(await ok(tokens.sa, 'contexto.previa', { agenteId: '04-roteirista', empresaId: B.id, briefing: 'post' }));
  assert.ok(!ctxB.includes('INTEG-REGRA'));
  assert.equal((await chamar(tokens.sa, 'contexto.previa', { agenteId: '04-roteirista', empresaId: B.id, tarefaId: e.id, briefing: 'x' })).erro.status, 'PERMISSION_DENIED');
});

test('execução persistente: transições, fila no Firestore e conflito de versão', async () => {
  const e = await ok(tokens.sa, 'execucoes.criar', { execucao: { objetivo: 'Fila de integração', modo: 'orquestrado' } });
  await ok(tokens.sa, 'execucoes.transicionar', { execucaoId: e.id, para: 'PLANNING', versaoEsperada: 1 });
  assert.equal((await chamar(tokens.sa, 'execucoes.transicionar', { execucaoId: e.id, para: 'CANCELLED', versaoEsperada: 1 })).erro.status, 'ALREADY_EXISTS');
  assert.equal((await chamar(tokens.sa, 'execucoes.transicionar', { execucaoId: e.id, para: 'COMPLETED' })).erro.status, 'FAILED_PRECONDITION');
  await ok(tokens.sa, 'execucoes.transicionar', { execucaoId: e.id, para: 'READY' });
  const fila = await db.collection('labz_fila').where('execucaoId', '==', e.id).get();
  assert.equal(fila.size, 1);
  assert.equal(fila.docs[0].data().estado, 'pendente');
});

// ---------- regras reais com login real (SDK do navegador) ----------
test('regras: com login real, o Super Admin autorizado só LÊ labz_*; Diretor não lê; ninguém grava', async () => {
  const { initializeApp } = require('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
  const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
  const cliente = (nome, email) => {
    const app = initializeApp({ projectId: PROJETO, apiKey: 'fake-api-key-teste' }, nome);
    appsCliente.push(app);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const fs = getFirestore(app); connectFirestoreEmulator(fs, '127.0.0.1', 8080);
    return signInWithEmailAndPassword(auth, email, SENHA).then(() => fs);
  };
  const recusa = (p) => p.then(() => { throw new Error('deveria ser recusado'); }, (e) => assert.equal(e.code, 'permission-denied'));
  const fsSa = await cliente('sa', 'sa@teste.local');
  const fsDir = await cliente('dir', 'diretor@teste.local');
  assert.equal((await getDoc(doc(fsSa, `labz_empresas/${A.id}`))).data().nome, 'Marca Alfa Integração');
  await recusa(setDoc(doc(fsSa, `labz_empresas/${A.id}`), { nome: 'trocado' }));
  await recusa(getDoc(doc(fsDir, `labz_empresas/${A.id}`)));
  await recusa(setDoc(doc(fsDir, 'labz_config/acesso'), { uids: ['d-teste'] }));
  // a falha corrigida: o Diretor da empresa não rebaixa o Super Admin vinculado a ela
  await recusa(updateDoc(doc(fsDir, 'usuarios/sa-teste'), { role: 'Diretor' }));
  assert.equal((await db.doc('usuarios/sa-teste').get()).data().role, 'SuperAdmin');
});

// ---------- adaptador do Firestore e fila no banco real ----------
test('adaptador: lê o que acabou de gravar na transação, desfaz tudo se der erro, e só lista a coleção direta', async () => {
  const banco = criarBancoFirestore(db);
  const r = await banco.transacao(async (t) => {
    await t.gravar('labz_teste/a', { v: 1 });
    await t.atualizar('labz_teste/a', { w: 2 });
    return t.obter('labz_teste/a');
  });
  assert.deepEqual(r, { v: 1, w: 2 });
  assert.deepEqual(await banco.obter('labz_teste/a'), { v: 1, w: 2 });
  await assert.rejects(banco.transacao(async (t) => { await t.gravar('labz_teste/b', { v: 1 }); throw new Error('falhou no meio'); }));
  assert.equal(await banco.obter('labz_teste/b'), null, 'nada foi gravado');
  await assert.rejects(banco.atualizar('labz_teste/naoexiste', { x: 1 }), (e) => e.codigo === 'nao-encontrado');
  await banco.gravar('labz_teste/a/sub/c', { v: 3 });
  assert.deepEqual((await banco.listar('labz_teste')).map((x) => x.id), ['a']);
});

test('fila no Firestore real: dois trabalhadores ao mesmo tempo, só um pega o item', async () => {
  const banco = criarBancoFirestore(db);
  const fila = criarFila({ banco });
  const id = await fila.enfileirar({ execucaoId: 'exe-corrida', tipo: 'executar' });
  const [x, y] = await Promise.all([fila.reservar('trab-X'), fila.reservar('trab-Y')]);
  const pegaram = [x, y].filter((r) => r && r.id === id);
  assert.equal(pegaram.length, 1, 'exatamente um trabalhador reservou o item');
});
