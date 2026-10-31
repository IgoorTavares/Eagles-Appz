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
  const v1 = await db.doc(`labz_empresas/${A.id}/labz_memorias/${mA.ref.memoriaId}/labz_versoes/1`).get();
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

test('Fase 3B no Firestore real: rascunho → revisão → aprovação, conflito de versão, Markdown e trava da Global', async () => {
  const mem = { escopo: 'cliente', alvo: { empresaId: A.id }, categoria: 'marca', titulo: 'Paleta', conteudo: 'INTEG-3B: azul', origem: { tipo: 'manual' } };
  const m = await ok(tokens.sa, 'memoria.criar', { memoria: mem, opcoes: { rascunho: true } });
  const base = `labz_empresas/${A.id}/labz_memorias/${m.ref.memoriaId}`;
  assert.equal((await db.doc(`${base}/labz_versoes/1`).get()).data().status, 'rascunho');
  assert.equal((await chamar(tokens.sa, 'memoria.aprovar', { ref: m.ref, versao: 1 })).erro.status, 'FAILED_PRECONDITION');
  await ok(tokens.sa, 'memoria.enviarParaAprovacao', { ref: m.ref, versao: 1 });
  await ok(tokens.sa, 'memoria.pedirRevisao', { ref: m.ref, versao: 1, motivo: 'faltou o tom exato' });
  const v1 = (await db.doc(`${base}/labz_versoes/1`).get()).data();
  assert.deepEqual([v1.status, v1.revisao.motivo, v1.revisao.por], ['precisa-revisao', 'faltou o tom exato', 'sa-teste']);
  await ok(tokens.sa, 'memoria.novaVersao', { ref: m.ref, conteudo: { conteudo: 'INTEG-3B: azul #1E40AF', origem: { tipo: 'manual' } } });
  await ok(tokens.sa, 'memoria.aprovar', { ref: m.ref, versao: 2, justificativa: 'tom confirmado' });
  // duas propostas sobre a versão 2: aprovar a mais nova recusa a mais velha
  await ok(tokens.sa, 'memoria.novaVersao', { ref: m.ref, conteudo: { conteudo: 'INTEG-3B: proposta A', origem: { tipo: 'manual' } } });
  await ok(tokens.sa, 'memoria.novaVersao', { ref: m.ref, conteudo: { conteudo: 'INTEG-3B: proposta B', origem: { tipo: 'manual' } } });
  await ok(tokens.sa, 'memoria.aprovar', { ref: m.ref, versao: 4 });
  assert.equal((await chamar(tokens.sa, 'memoria.aprovar', { ref: m.ref, versao: 3 })).erro.status, 'ALREADY_EXISTS');
  assert.equal((await db.doc(base).get()).data().vigente.conteudo, 'INTEG-3B: proposta B');
  assert.equal((await db.doc(`${base}/labz_versoes/3`).get()).data().status, 'pendente');
  // Markdown derivado da versão 2 (histórico), igual nas duas gerações
  const md1 = await ok(tokens.sa, 'memoria.exportarMarkdown', { ref: m.ref, versao: 2 });
  const md2 = await ok(tokens.sa, 'memoria.exportarMarkdown', { ref: m.ref, versao: 2 });
  assert.equal(md1.markdown, md2.markdown);
  assert.ok(md1.markdown.includes('status: "substituida"') && md1.markdown.includes('INTEG-3B: azul #1E40AF'));
  // Global citando o cliente do CRM vinculado: bloqueado e auditado
  const g = await chamar(tokens.sa, 'memoria.criar', { memoria: { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Método', conteudo: 'O cliente ficticio prefere legendas curtas', origem: { tipo: 'manual' } } });
  assert.equal(g.erro.status, 'FAILED_PRECONDITION');
  assert.equal((await db.collection('labz_memoria_global').get()).size, 0);
  assert.ok((await db.collection('labz_eventos').where('tipo', '==', 'memoria.trava_global').get()).size >= 1);
});

test('Fase 3B no Firestore real: conflito exige decisão; duas aprovações simultâneas não passam juntas; decisão velha não vale', async () => {
  const base = { escopo: 'cliente', alvo: { empresaId: A.id }, categoria: 'preferencia', chave: 'integ-fotos', titulo: 'Fotos', origem: { tipo: 'manual' } };
  const x = await ok(tokens.sa, 'memoria.criar', { memoria: Object.assign({ conteudo: 'INTEG-CONF: luz natural' }, base) });
  const y = await ok(tokens.sa, 'memoria.criar', { memoria: Object.assign({ conteudo: 'INTEG-CONF: estúdio' }, base) });
  const r = await Promise.all([chamar(tokens.sa, 'memoria.aprovar', { ref: x.ref, versao: 1 }), chamar(tokens.sa, 'memoria.aprovar', { ref: y.ref, versao: 1 })]);
  assert.equal(r.filter((z) => z.resultado && z.resultado.ok).length, 1, 'só uma das duas aprovações passou');
  const barrada = r.find((z) => z.erro);
  assert.equal(barrada.erro.status, 'ALREADY_EXISTS');
  assert.equal(barrada.erro.details.motivo, 'decisao-necessaria');
  const perdeu = r[0].erro ? x : y;
  const venceu = r[0].erro ? y : x;
  // decisão para o estado atual; antes de usá-la, a memória envolvida muda
  const av = await ok(tokens.sa, 'memoria.avaliarConflitos', { ref: perdeu.ref, versao: 1 });
  assert.equal(av.assinatura, barrada.erro.details.assinatura);
  await ok(tokens.sa, 'memoria.novaVersao', { ref: venceu.ref, conteudo: { conteudo: 'INTEG-CONF: luz natural ou janela', origem: { tipo: 'manual' } } });
  await ok(tokens.sa, 'memoria.aprovar', { ref: venceu.ref, versao: 2 });
  const velha = await chamar(tokens.sa, 'memoria.aprovar', { ref: perdeu.ref, versao: 1, confirmacaoConflitos: { assinatura: av.assinatura, justificativa: 'exceção combinada' } });
  assert.equal(velha.erro.details.motivo, 'confirmacao-desatualizada');
  const nova = await ok(tokens.sa, 'memoria.avaliarConflitos', { ref: perdeu.ref, versao: 1 });
  const ap = await ok(tokens.sa, 'memoria.aprovar', { ref: perdeu.ref, versao: 1, confirmacaoConflitos: { assinatura: nova.assinatura, justificativa: 'exceção combinada' } });
  assert.equal(ap.status, 'ativa');
  const v = (await db.doc(`labz_empresas/${A.id}/labz_memorias/${perdeu.ref.memoriaId}/labz_versoes/1`).get()).data();
  assert.equal(v.confirmacoes.conflitos.assinatura, nova.assinatura);
  assert.ok((await db.collection('labz_eventos').where('tipo', '==', 'memoria.conflito_bloqueado').get()).size >= 2);
});

test('Fase 3B, transações reais em paralelo no Firestore: o conflito é visto dentro da transação', async () => {
  const { criarLabz } = require('../src/servicos');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const base = { escopo: 'cliente', alvo: { empresaId: A.id }, categoria: 'preferencia', chave: 'integ-paralelo', titulo: 'Paralelo', origem: { tipo: 'manual' } };
  for (let rodada = 0; rodada < 3; rodada++) {
    const ms = [];
    for (const t of ['um', 'dois', 'tres']) ms.push(await s.memoria.criar(ator, Object.assign({}, base, { chave: `integ-par-${rodada}`, conteudo: `INTEG-PAR ${rodada} opção ${t}` })));
    const r = await Promise.allSettled(ms.map((m) => s.memoria.aprovarVersao(ator, m.ref, 1)));
    assert.equal(r.filter((z) => z.status === 'fulfilled').length, 1, `rodada ${rodada}: só uma das três aprovações simultâneas passou`);
    r.filter((z) => z.status === 'rejected').forEach((z) => assert.equal(z.reason.codigo, 'conflito'));
    const vig = (await s.memoria.vigentes('cliente', { empresaId: A.id })).filter((m) => m.chave === `integ-par-${rodada}`);
    assert.equal(vig.length, 1);
  }
});

test('Fase 3C no Firestore real: busca por palavras e metadados, paginação com cursor, isolamento e contexto limitado', async () => {
  const mk = (alvo, titulo, conteudo) => ok(tokens.sa, 'memoria.criar', { memoria: { escopo: 'cliente', alvo, categoria: 'referencia', titulo, conteudo, origem: { tipo: 'manual' } } })
    .then((m) => ok(tokens.sa, 'memoria.aprovar', { ref: m.ref, versao: 1 }).then(() => m));
  for (let i = 0; i < 7; i++) await mk({ empresaId: A.id }, `Busca ${i}`, `integbusca modelo${i}k variante${i * 7}j`);
  await mk({ empresaId: B.id }, 'Busca Beta', 'integbusca segredobeta');
  const r = await ok(tokens.sa, 'memoria.buscar', { consulta: { escopo: 'cliente', alvo: { empresaId: A.id }, modo: 'textual', texto: 'integbusca modelo3k', limite: 3 } });
  assert.equal(r.itens.length, 3);
  assert.equal(r.itens[0].titulo, 'Busca 3', 'quem cobre mais termos vem primeiro');
  assert.ok(r.itens.every((i) => i.alvo.empresaId === A.id) && !JSON.stringify(r).includes('segredobeta'));
  assert.equal(r.semantica.disponivel, false);
  // paginação com cursor (startAfter) no Firestore
  const vistos = [];
  let depoisDe = null;
  for (let p = 0; p < 10; p++) {
    const pg = await ok(tokens.sa, 'memoria.buscar', { consulta: Object.assign({ escopo: 'cliente', alvo: { empresaId: A.id }, modo: 'metadados', filtros: { categoria: 'referencia' }, limite: 3 }, depoisDe ? { depoisDe } : {}) });
    vistos.push(...pg.itens.map((i) => i.titulo));
    depoisDe = pg.proximo;
    if (!depoisDe) break;
  }
  assert.equal(new Set(vistos).size, 7);
  assert.ok(vistos.every((t) => t.startsWith('Busca ') && t !== 'Busca Beta'));
  // contexto: métricas de leitura limitadas e evento sem conteúdo
  const ctx = await ok(tokens.sa, 'contexto.previa', { agenteId: '04-roteirista', empresaId: A.id, briefing: 'integbusca' });
  assert.ok(ctx.metricas.consultas <= 8 && ctx.metricas.documentosLidos <= 280);
  const ev = await db.collection('labz_eventos').where('tipo', '==', 'memoria.contexto_montado').get();
  assert.ok(ev.size >= 1 && !JSON.stringify(ev.docs.map((d) => d.data())).includes('integbusca'));
});

test('Fase 3D no Firestore real: plano do Estrategista com um contexto por agente; proposta de agente nasce rascunho', async () => {
  const exe = await ok(tokens.sa, 'execucoes.criar', { execucao: { empresaId: A.id, objetivo: 'INTEG-3D campanha completa', modo: 'orquestrado' } });
  const ctxs = await ok(tokens.sa, 'execucoes.planejarContextos', { execucaoId: exe.id, passos: [{ agenteId: '02-designer', briefing: 'peças' }, { agenteId: '07-trafego', briefing: 'anúncios' }] });
  assert.deepEqual(ctxs.map((x) => x.agenteId), ['02-designer', '07-trafego']);
  ctxs.forEach(({ agenteId, contexto }) => {
    assert.equal(contexto.agenteId, agenteId);
    assert.equal(contexto.empresaId, A.id);
    assert.ok(!JSON.stringify(contexto).includes('INTEG-BETA'), 'nada da empresa B');
    assert.deepEqual(contexto.blocos.filter((b) => b.confiavel).map((b) => b.tipo), ['seguranca', 'especialidade', 'permissoes']);
  });
  const doc = (await db.doc(`labz_tarefas/${exe.id}`).get()).data();
  assert.deepEqual(doc.plano.agentes, ['02-designer', '07-trafego']);
  assert.equal(doc.preparacoes.length, 2);
  // a porta do agente (uso interno, sem API) grava rascunho no Firestore pelo ator do sistema
  const { criarLabz } = require('../src/servicos');
  const s = criarLabz({ banco: criarBancoFirestore(db) });
  const porta = await s.portaMemoria.abrir('07-trafego', exe.id);
  const p = await porta.propor({ escopo: 'cliente', base: 'tarefa', categoria: 'aprendizado', titulo: 'Anúncios', conteudo: 'INTEG-3D anúncios com depoimento converteram mais' });
  const base = `labz_empresas/${A.id}/labz_memorias/${p.ref.memoriaId}`;
  assert.equal((await db.doc(`${base}/labz_versoes/1`).get()).data().status, 'rascunho');
  assert.equal((await db.doc(base).get()).data().propostoPorAgente, '07-trafego');
  assert.equal((await chamar(tokens.sa, 'memoria.aprovar', { ref: p.ref, versao: 1 })).erro.status, 'FAILED_PRECONDITION', 'rascunho precisa ser enviado antes');
  await assert.rejects(s.memoria.aprovarVersao(require('../src/auth/super-admin').ATOR_SISTEMA, p.ref, 1), (e) => e.codigo === 'permissao-negada');
  await assert.rejects(s.portaMemoria.abrir('01-guia-marca', exe.id), (e) => e.codigo === 'permissao-negada');
});

test('Fase 3E no Firestore real: concorrência de F3 (correção), F4 (nome de empresa) e F1 (reativação); fila e cursor limitados', async () => {
  const { criarLabz } = require('../src/servicos');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  // F4: 3 criações simultâneas com o mesmo nome normalizado → só 1
  for (let r = 0; r < 3; r++) {
    const res = await Promise.allSettled([s.empresas.criar(ator, { nome: `Corrida ${r}` }), s.empresas.criar(ator, { nome: `corrida  ${r}` }), s.empresas.criar(ator, { nome: `CORRIDA-${r}` })]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1, `rodada ${r}`);
    assert.equal((await db.collection('labz_empresas').where('slug', '==', `corrida-${r}`).get()).size, 1);
  }
  const E = (await s.empresas.criar(ator, { nome: 'Empresa Concorrencia 3E' }));
  // F3: 2 aprovações simultâneas da mesma correção → 1 memória
  const exe = await s.execucoes.criar(ator, { empresaId: E.id, objetivo: 'Execução de correção', modo: 'especialista', agenteId: '04-roteirista' });
  for (let r = 0; r < 3; r++) {
    const textos = ['Revisar ortografia das legendas', 'Usar fotos com rostos reais', 'Evitar fundo preto nos posts'];
    const cor = await s.correcoes.registrar(ator, { tarefaId: exe.id, texto: textos[r], alcance: 'permanente', chave: `regra-${r}` });
    const res = await Promise.allSettled([s.correcoes.aprovar(ator, cor.aprendizadoId, { titulo: 'Regra' }), s.correcoes.aprovar(ator, cor.aprendizadoId, { titulo: 'Regra' })]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1, `rodada ${r}`);
    const mems = (await db.collection(`labz_empresas/${E.id}/labz_memorias`).where('chave', '==', `regra-${r}`).get()).size;
    assert.equal(mems, 1, `rodada ${r}: uma memória só`);
  }
  // F1: duas reativações conflitantes simultâneas → só 1
  const base = { escopo: 'cliente', alvo: { empresaId: E.id }, categoria: 'preferencia', chave: 'reativa', titulo: 'Reativa', origem: { tipo: 'manual' } };
  const x = await s.memoria.criar(ator, Object.assign({ conteudo: 'opção luz natural' }, base));
  await s.memoria.aprovarVersao(ator, x.ref, 1);
  await s.memoria.arquivar(ator, x.ref, 'pausa');
  const y = await s.memoria.criar(ator, Object.assign({ conteudo: 'opção estúdio escuro' }, base));
  await s.memoria.aprovarVersao(ator, y.ref, 1);
  await s.memoria.arquivar(ator, y.ref, 'pausa');
  const rr = await Promise.allSettled([s.memoria.reativar(ator, x.ref), s.memoria.reativar(ator, y.ref)]);
  assert.equal(rr.filter((z) => z.status === 'fulfilled').length, 1);
  // F6: fila por consulta limitada e cursor preso à empresa
  await s.fila.enfileirar({ execucaoId: 'exe-3e', tipo: 'executar' });
  assert.ok(await s.fila.reservar('trab-3e'));
  const outra = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'Execução da A', modo: 'orquestrado' });
  await assert.rejects(s.execucoes.listarPagina(ator, { empresaId: E.id, depoisDe: outra.id }), (e) => e.codigo === 'invalido');
  const pg = await s.execucoes.listarPagina(ator, { empresaId: E.id, limite: 1 });
  assert.ok(pg.itens.every((i) => i.empresaId === E.id));
});

test('Fase 4A no Firestore real: plano orquestrado, dois executores ao mesmo tempo, aprovação pela API e diagnóstico', async () => {
  const { criarLabz } = require('../src/servicos');
  const { criarAdaptadorSimulado } = require('../src/motor/adaptador-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const acao = { tipo: 'ferramenta', ferramentaId: 'meta.publicar', operacao: 'publicar', parametros: { post: 'integ' } };
  const s = criarLabz({ banco, adaptador: criarAdaptadorSimulado({ '07-trafego': 'acao' }, { acoes: { '07-trafego': acao } }) });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  // orquestrado pela API (função do simulador), executado aqui por dois "executores" ao mesmo tempo
  const exe = await ok(tokens.sa, 'execucoes.criar', { execucao: { empresaId: A.id, objetivo: 'INTEG-4A campanha', modo: 'orquestrado' } });
  await ok(tokens.sa, 'execucoes.planejar', { execucaoId: exe.id, passos: [{ id: 'marca', agenteId: '01-guia-marca', objetivo: 'Diretrizes' }, { id: 'texto', agenteId: '04-roteirista', objetivo: 'Legendas', dependeDe: ['marca'] }] });
  await s.fila.enfileirar({ execucaoId: exe.id, tipo: 'executar' }); // item duplicado
  const r = await Promise.all([s.motor.trabalhar('exec-A'), s.motor.trabalhar('exec-B')]);
  assert.equal(r.filter((x) => x && x.resultado === 'concluida').length, 1, JSON.stringify(r));
  const d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: exe.id });
  assert.equal(d.estado, 'COMPLETED');
  assert.deepEqual(d.etapas.map((x) => x.status), ['concluida', 'concluida', 'concluida']);
  const res = (await db.doc(`labz_tarefas/${exe.id}/labz_resultados/texto`).get()).data();
  assert.ok(res.simulado === true && res.texto.startsWith('[SIMULADO]'));
  // aprovação: só o Super Admin, pela API; Diretor recusado
  const e2 = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'Publicar post', modo: 'especialista', agenteId: '07-trafego' });
  await s.motor.planejar(ator, e2.id);
  assert.equal((await s.motor.trabalhar('exec-C')).resultado, 'aguardando-aprovacao');
  const [p] = await ok(tokens.sa, 'execucoes.aprovacoes', { execucaoId: e2.id });
  assert.equal((await chamar(tokens.diretor, 'execucoes.decidirAprovacao', { execucaoId: e2.id, aprovacaoId: p.id, decisao: 'aprovar', assinatura: p.assinatura, justificativa: 'ok ok' })).erro.status, 'PERMISSION_DENIED');
  await ok(tokens.sa, 'execucoes.decidirAprovacao', { execucaoId: e2.id, aprovacaoId: p.id, decisao: 'aprovar', assinatura: p.assinatura, justificativa: 'post conferido' });
  assert.equal((await s.motor.trabalhar('exec-D')).resultado, 'concluida');
  const fim = (await db.doc(`labz_tarefas/${e2.id}`).get()).data();
  assert.equal(fim.etapas[0].resultado.acoes[0].situacao, 'aprovada-simulada');
});

test('Fase 4B no Firestore real: modelos por agente pela API, pedido planejado pelo Estrategista, dois executores locais e reservas de consumo', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const transporte = transporteComModeloSimulado();
  const s = criarLabz({ banco, ia: { transporte } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const recursos = ['texto', 'saida-estruturada', 'ferramentas', 'imagem-entrada', 'imagem-saida'];
  // configuração por agente PELA API (função do simulador); "real" é recusado
  await ok(tokens.sa, 'modelos.configurar', { agenteId: '04-roteirista', config: { provedor: 'openai', modelo: 'modelo-ficticio-1', uso: 'simulado', recursosDoModelo: recursos } });
  await ok(tokens.sa, 'modelos.configurar', { agenteId: '08-estrategista', config: { provedor: 'anthropic', modelo: 'modelo-ficticio-2', uso: 'simulado', recursosDoModelo: recursos } });
  const real = await chamar(tokens.sa, 'modelos.configurar', { agenteId: '02-designer', config: { provedor: 'google', modelo: 'x', uso: 'real', recursosDoModelo: recursos } });
  assert.equal(real.erro.status, 'FAILED_PRECONDITION');
  assert.equal((await chamar(tokens.diretor, 'modelos.listar', {})).erro.status, 'PERMISSION_DENIED');
  const lista = await ok(tokens.sa, 'modelos.listar', {});
  assert.deepEqual(lista.filter((x) => x.situacao === 'configurado').map((x) => x.agenteId).sort(), ['04-roteirista', '08-estrategista']);
  // pedido → plano do Estrategista (validado) → dois executores locais ao mesmo tempo
  const pedidos = [];
  for (let i = 0; i < 2; i++) pedidos.push(await s.motor.pedido(ator, { empresaId: A.id, objetivo: `INTEG-4B ${i} produzir conteúdos para redes sociais: posts e legendas` }));
  pedidos.forEach((p) => assert.equal(p.estado, 'READY'));
  await Promise.all([s.executorLocal({ nome: 'X', concorrencia: 2 }).drenar(), s.executorLocal({ nome: 'Y', concorrencia: 2 }).drenar()]);
  for (const p of pedidos) {
    const d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: p.id });
    assert.equal(d.estado, 'COMPLETED');
    assert.ok(d.etapas.every((x) => x.status === 'concluida' && x.tentativas === 1));
    assert.ok(d.custos.porProvedor.openai && d.custos.porProvedor.anthropic && d.custos.custoDesconhecido >= 1 && d.custos.cobrancaReal === false);
  }
  const execucoesDoModelo = transporte.chamadas.filter((x) => x.modo !== 'planejar');
  assert.equal(execucoesDoModelo.length, pedidos.length * 3, 'cada etapa chamou o "modelo" uma vez só');
  // consumo do dia pela API; reservas simultâneas no Firestore: só uma cabe no limite
  const dia = await ok(tokens.sa, 'custos.consumo', {});
  assert.ok(dia.global.chamadas >= 8 && dia.cobrancaReal === false);
  await ok(tokens.sa, 'custos.definirLimites', { limites: { global: { tokensDia: dia.global.tokens + 7000, custoDia: null }, porAgente: { tokensDia: null, custoDia: null }, porEmpresa: { tokensDia: null, custoDia: null }, porProvedor: { tokensDia: null, custoDia: null }, excecoes: { agentes: {}, empresas: {}, provedores: {} } } });
  const p = { execucaoId: 'integ-4b', etapaId: 'e1', agenteId: '04-roteirista', empresaId: A.id, provedor: 'simulado', modelo: 'simulado', tokensEntrada: 2000, tokensSaida: 2000 };
  const rs = await Promise.all([s.consumo.reservar(p), s.consumo.reservar(p), s.consumo.reservar(p)]);
  assert.equal(rs.filter((x) => x.permitido).length, 1);
  await db.doc('labz_config/limites').delete(); // não deixa limite para os outros testes
  // monitor: consultas da fila e das empresas funcionam no Firestore
  const m = await s.monitor.verificar();
  assert.ok(Array.isArray(m.descartados) && typeof m.reservasVencidas === 'number');
});

test('Fase 4C.1 no Firestore real: entregas pelo motor, versões concorrentes, aprovação por versão e consultas paginadas', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const p = await s.motor.pedido(ator, { empresaId: A.id, objetivo: 'INTEG-4C1 produzir conteúdos para redes sociais: posts e legendas' });
  await s.executorLocal({ concorrencia: 2 }).drenar();
  const lista = await ok(tokens.sa, 'entregas.listar', { execucaoId: p.id });
  assert.deepEqual(lista.itens.map((e) => e.etapaId).sort(), ['consolidacao', 'pecas', 'textos']);
  assert.ok(lista.itens.every((e) => e.empresaId === A.id));
  const cons = lista.itens.find((e) => e.etapaId === 'consolidacao');
  const aguardando = await ok(tokens.sa, 'entregas.aguardandoAprovacao', { empresaId: A.id });
  assert.ok(aguardando.itens.some((e) => e.id === cons.id));
  assert.equal((await chamar(tokens.diretor, 'entregas.obter', { entregaId: cons.id })).erro.status, 'PERMISSION_DENIED');
  const c1 = await ok(tokens.sa, 'entregas.conteudo', { entregaId: cons.id, versao: 1 });
  assert.equal(c1.integridade, 'conferida');
  // versões concorrentes no Firestore: nenhuma sobrescrita
  const texto = lista.itens.find((e) => e.etapaId === 'textos');
  // (Fase 4C.2: a etapa "textos" agora é um documento estruturado; versão nova = documento validado)
  const base = (await s.entregas.lerDocumento(ator, texto.id, 1)).dados;
  const rs = await Promise.allSettled([1, 2, 3].map((i) => s.entregas.novaVersaoDocumento(ator, texto.id, Object.assign({}, base, { titulo: `INTEG ${i} roteiro` }))));
  const okv = rs.filter((r) => r.status === 'fulfilled').map((r) => r.value.versao).sort();
  assert.ok(okv.length >= 1);
  assert.equal(new Set(okv).size, okv.length);
  assert.equal(new Set((await s.entregas.versoes(ator, texto.id)).itens.map((v) => v.hash)).size, okv.length + 1, 'nenhuma versão sobrescrita');
  const hist = await ok(tokens.sa, 'entregas.versoes', { entregaId: texto.id, limite: 2 });
  assert.equal(hist.itens.length, 2);
  assert.ok(hist.proximo);
  // aprovação pela API, presa à versão + hash
  const errada = await chamar(tokens.sa, 'entregas.decidir', { entregaId: cons.id, decisao: { decisao: 'aprovar', versao: 1, hash: 'a'.repeat(64) } });
  assert.equal(errada.erro.status, 'ALREADY_EXISTS'); // conflito
  const ap = await ok(tokens.sa, 'entregas.decidir', { entregaId: cons.id, decisao: { decisao: 'aprovar', versao: 1, hash: cons.hashAtual } });
  assert.equal(ap.estado, 'aprovada');
});

test('Fase 4C.2 no Firestore real: documento estruturado e Markdown gravados juntos na mesma versão e conferidos pela API', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const exe = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'INTEG-4C2 roteiro e legenda', modo: 'orquestrado' });
  await s.motor.planejar(ator, exe.id, { passos: [{ id: 'reels', agenteId: '04-roteirista', objetivo: 'Roteiro', documento: 'roteiro-reels' }, { id: 'legenda', agenteId: '04-roteirista', objetivo: 'Legenda', documento: 'legenda-social', dependeDe: ['reels'] }] });
  await Promise.all([s.executorLocal({ nome: 'F1' }).drenar(), s.executorLocal({ nome: 'F2' }).drenar()]);
  const lista = await ok(tokens.sa, 'entregas.listar', { execucaoId: exe.id });
  assert.deepEqual(lista.itens.map((e) => e.documento).sort(), ['consolidacao-final', 'legenda-social', 'roteiro-reels']);
  assert.ok(lista.itens.every((e) => e.ultimaVersao === 1));
  const reels = lista.itens.find((e) => e.documento === 'roteiro-reels');
  const d = await ok(tokens.sa, 'entregas.documento', { entregaId: reels.id, versao: 1 });
  assert.equal(d.representacao, 'confere');
  assert.ok(d.markdown.includes(`origem-sha256=${reels.hashAtual}`));
  assert.equal((await chamar(tokens.diretor, 'entregas.documento', { entregaId: reels.id, versao: 1 })).erro.status, 'PERMISSION_DENIED');
  const invalida = await chamar(tokens.sa, 'entregas.novaVersaoDocumento', { entregaId: reels.id, dados: { titulo: 'x' } });
  assert.equal(invalida.erro.status, 'INVALID_ARGUMENT');
  const nova = await ok(tokens.sa, 'entregas.novaVersaoDocumento', { entregaId: reels.id, dados: Object.assign({}, d.dados, { titulo: 'INTEG-4C2 título corrigido' }), versaoBase: 1 });
  assert.equal(nova.versao, 2);
  assert.equal((await ok(tokens.sa, 'entregas.documento', { entregaId: reels.id, versao: 2 })).representacao, 'confere');
});

test('Fase 4C.2 passo 3 no Firestore real: compartilhamento com versão fixada, insumos registrados e bloqueio de documento sensível', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const exe = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'INTEG-4C2P3 tráfego e legenda', modo: 'orquestrado' });
  await s.motor.planejar(ator, exe.id, { passos: [{ id: 'trafego', agenteId: '07-trafego', objetivo: 'Plano de tráfego', documento: 'plano-trafego' }, { id: 'legenda', agenteId: '04-roteirista', objetivo: 'Legenda', documento: 'legenda-social', dependeDe: ['trafego'] }] });
  await Promise.all([s.executorLocal({ nome: 'G1' }).drenar(), s.executorLocal({ nome: 'G2' }).drenar()]);
  let d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: exe.id });
  assert.equal(d.diagnostico.motivo, 'dependencia-aguarda-aprovacao');
  const pin = (await s.execucoes.obter(ator, exe.id)).etapas.find((x) => x.id === 'trafego').resultado.entrega;
  // (4C.2 passo 4) a aprovação pela API já retoma sozinha: retomar à mão não é mais preciso
  const dec = await ok(tokens.sa, 'entregas.decidir', { entregaId: pin.id, decisao: { decisao: 'aprovar', versao: pin.versao, hash: pin.hash } });
  assert.equal(dec.retomada, 'retomada-agendada');
  assert.equal((await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: exe.id })).estado, 'READY');
  await s.executorLocal().drenar();
  d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: exe.id });
  assert.equal(d.estado, 'COMPLETED');
  const leg = await ok(tokens.sa, 'entregas.listar', { execucaoId: exe.id, agenteId: '04-roteirista' });
  const v = (await db.doc(`labz_entregas/${leg.itens[0].id}/labz_versoes_entrega/1`).get()).data();
  assert.deepEqual([v.insumos[0].entregaId, v.insumos[0].versao, v.insumos[0].autorizacao], [pin.id, pin.versao, 'aprovacao-super-admin']);
});

test('Fase 4C.2 passo 4 no Firestore real: aprovação pela API retoma sozinha (uma vez só), consolida e registra os eventos', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const banco = criarBancoFirestore(db);
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  const exe = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'INTEG-4C2P4 tráfego e legenda', modo: 'orquestrado' });
  await s.motor.planejar(ator, exe.id, { passos: [{ id: 'trafego', agenteId: '07-trafego', objetivo: 'Plano', documento: 'plano-trafego' }, { id: 'legenda', agenteId: '04-roteirista', objetivo: 'Legenda', documento: 'legenda-social', dependeDe: ['trafego'] }] });
  await s.executorLocal().drenar();
  const pin = (await s.execucoes.obter(ator, exe.id)).etapas.find((x) => x.id === 'trafego').resultado.entrega;
  // a decisão chega pela função do simulador; a retomada é tentada por ela (outro processo) e pelos monitores locais
  const r = await ok(tokens.sa, 'entregas.decidir', { entregaId: pin.id, decisao: { decisao: 'aprovar', versao: pin.versao, hash: pin.hash } });
  assert.ok(['retomada-agendada', 'nada-a-retomar'].includes(r.retomada));
  await Promise.all([s.monitor.verificar(), s.monitor.verificar(), s.motor.notificarDecisaoEntrega(pin.id)]);
  await Promise.all([s.executorLocal({ nome: 'H1' }).drenar(), s.executorLocal({ nome: 'H2' }).drenar()]);
  const d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: exe.id });
  assert.equal(d.estado, 'COMPLETED');
  const ev = await ok(tokens.sa, 'auditoria.listar', { tipo: 'execucao.retomada_agendada' });
  assert.equal(ev.itens.filter((e) => e.alvo === `labz_tarefas/${exe.id}`).length, 1, 'uma retomada só');
});

test('Fase 4C.2 passo 5 no Firestore real: Cenário A de ponta a ponta pela API (pedido → plano → 7 documentos → aprovação → consolidação → relatório)', async () => {
  const { criarLabz } = require('../src/servicos');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const banco = criarBancoFirestore(db);
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa-teste', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa-teste'] });
  // o pedido é planejado pelo Estrategista simulado (local); o resto passa pela função do simulador
  const o = await s.motor.pedido(ator, { empresaId: A.id, objetivo: 'INTEG-4C2P5 campanha completa: diretrizes de marca, posts, carrosséis, roteiro de Reels, legendas para o Instagram e anúncios no Meta Ads' });
  assert.equal(o.estado, 'READY');
  await Promise.all([s.executorLocal({ nome: 'I1', concorrencia: 2 }).drenar(), s.executorLocal({ nome: 'I2', concorrencia: 2 }).drenar()]);
  let d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: o.id });
  assert.equal(d.diagnostico.motivo, 'dependencia-aguarda-aprovacao');
  const exe = (await db.doc(`labz_tarefas/${o.id}`).get()).data();
  const trafego = exe.etapas.find((x) => x.id === 'trafego').resultado.entrega;
  const r = await ok(tokens.sa, 'entregas.decidir', { entregaId: trafego.id, decisao: { decisao: 'aprovar', versao: trafego.versao, hash: trafego.hash } });
  assert.ok(['retomada-agendada', 'nada-a-retomar'].includes(r.retomada));
  await s.monitor.verificar();
  await Promise.all([s.executorLocal({ nome: 'I3' }).drenar(), s.executorLocal({ nome: 'I4' }).drenar()]);
  d = await ok(tokens.sa, 'execucoes.diagnostico', { execucaoId: o.id });
  assert.equal(d.estado, 'COMPLETED');
  const rel = await ok(tokens.sa, 'execucoes.relatorio', { execucaoId: o.id });
  assert.equal(rel.documentos.length, 7);
  assert.ok(rel.documentos.every((x) => typeof x.hash === 'string' && x.hash.length === 64));
  assert.equal(rel.entregaConsolidada.insumos, 6);
  assert.equal(rel.consumo.cobrancaReal, false);
  assert.ok(!JSON.stringify(rel).includes('INTEG-4C2P5'), 'relatório sem o texto do pedido');
});
