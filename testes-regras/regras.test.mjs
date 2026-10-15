// =====================================================================
// Testes das regras do banco (firestore.rules) — rodam num SIMULADOR do
// Firebase, nunca no banco de verdade. Conferem principalmente que uma
// empresa não lê nem grava nada de outra, que quem não está logado não
// acessa nada e que os níveis (Diretor, Administrativo, Financeiro,
// Cliente) são respeitados.
//
// Como rodar (no computador, com Java instalado):
//   cd testes-regras && npm install && npm run simulador
// Ou sozinho no GitHub a cada envio (.github/workflows/regras.yml).
// =====================================================================
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc } from 'firebase/firestore';

let env;
const regras = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-eagles', firestore: { rules: regras, host: '127.0.0.1', port: 8080 } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    const seed = (caminho, dados) => setDoc(doc(f, caminho), dados);
    await seed('tenants/t1', { nomeEmpresa: 'Empresa Um', plano: 'ambos', ativo: true, limiteUsuarios: 10 });
    await seed('tenants/t2', { nomeEmpresa: 'Empresa Dois', plano: 'ambos', ativo: true, limiteUsuarios: 10 });
    await seed('tenants/t3', { nomeEmpresa: 'Empresa Suspensa', plano: 'erp', ativo: false });
    await seed('usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
    await seed('usuarios/d1', { tenantId: 't1', role: 'Diretor', nome: 'Diretor Um', titular: true });
    await seed('usuarios/a1', { tenantId: 't1', role: 'Administrativo', nome: 'Adm Um' });
    await seed('usuarios/f1', { tenantId: 't1', role: 'Financeiro', nome: 'Fin Um' });
    await seed('usuarios/c1', { tenantId: 't1', role: 'Cliente', nome: 'Cliente', clienteNome: 'Seven' });
    await seed('usuarios/d2', { tenantId: 't2', role: 'Diretor', nome: 'Diretor Dois', titular: true });
    await seed('usuarios/d3', { tenantId: 't3', role: 'Diretor', nome: 'Diretor Três' });
    for (const t of ['t1', 't2']) {
      await seed(`tenants/${t}/dados/eagles_perfil_empresa_v1`, { valor: { nomeFantasia: t } });
      await seed(`tenants/${t}/dados/eagles_fin_caixas_v1`, { valor: { caixas: [] } });
      await seed(`tenants/${t}/crm_clientes/x`, { nome: 'Cliente secreto ' + t });
      await seed(`tenants/${t}/crm_negocios/n`, { nome: 'Negócio ' + t, valor: 1000 });
      await seed(`tenants/${t}/erp_produtos/p`, { nome: 'Produto ' + t, estoque: 5 });
      await seed(`tenants/${t}/fin_lancamentos/l`, { tipo: 'receber', valor: 100 });
      await seed(`tenants/${t}/kanban_tarefas/k`, { titulo: 'Tarefa ' + t });
      await seed(`tenants/${t}/conteudos/c`, { titulo: 'Conteúdo ' + t });
    }
    await seed('tenants/t3/dados/eagles_perfil_empresa_v1', { valor: {} });
    await seed('conteudos_publicos/tok1', { tenantId: 't1', titulo: 'Post', resposta: '', comentario: '', rodada: 1 });
    await seed('portais_publicos/ptk1', { tenantId: 't1', cliente: 'Seven', cfg: {}, conteudos: [] });
  });
});
after(async () => { if (env) await env.cleanup(); });

// ---------- quem não está logado ----------
test('sem login: não lê dados de empresa nenhuma', async () => {
  await assertFails(getDoc(doc(db(), 'tenants/t1/dados/eagles_perfil_empresa_v1')));
  await assertFails(getDoc(doc(db(), 'tenants/t1/crm_clientes/x')));
  await assertFails(getDocs(collection(db(), 'tenants/t1/erp_produtos')));
  await assertFails(getDoc(doc(db(), 'tenants/t1')));
  await assertFails(getDoc(doc(db(), 'usuarios/d1')));
});
test('sem login: não grava nada da empresa', async () => {
  await assertFails(setDoc(doc(db(), 'tenants/t1/crm_clientes/novo'), { nome: 'invasor' }));
  await assertFails(setDoc(doc(db(), 'tenants/t1/dados/eagles_crm_negocios_v1'), { valor: [] }));
});

// ---------- uma empresa tentando ver a outra ----------
test('Diretor da empresa 2 NÃO lê nada da empresa 1', async () => {
  const d2 = db('d2');
  for (const c of ['tenants/t1', 'tenants/t1/dados/eagles_perfil_empresa_v1', 'tenants/t1/crm_clientes/x', 'tenants/t1/crm_negocios/n', 'tenants/t1/erp_produtos/p', 'tenants/t1/fin_lancamentos/l', 'tenants/t1/kanban_tarefas/k', 'tenants/t1/conteudos/c', 'usuarios/d1']) {
    await assertFails(getDoc(doc(d2, c)));
  }
  await assertFails(getDocs(collection(d2, 'tenants/t1/crm_clientes')));
  await assertFails(getDocs(query(collection(d2, 'usuarios'), where('tenantId', '==', 't1'))));
});
test('Diretor da empresa 2 NÃO grava nada na empresa 1', async () => {
  const d2 = db('d2');
  await assertFails(setDoc(doc(d2, 'tenants/t1/crm_clientes/x'), { nome: 'alterado' }));
  await assertFails(deleteDoc(doc(d2, 'tenants/t1/erp_produtos/p')));
  await assertFails(setDoc(doc(d2, 'tenants/t1/dados/eagles_crm_negocios_v1'), { valor: [] }));
  await assertFails(addDoc(collection(d2, 'tenants/t1/fin_lancamentos'), { tipo: 'pagar', valor: 1 }));
});
test('Diretor da empresa 2 não se coloca na empresa 1', async () => {
  await assertFails(updateDoc(doc(db('d2'), 'usuarios/d2'), { tenantId: 't1' }));
  await assertFails(setDoc(doc(db('d2'), 'usuarios/novo'), { tenantId: 't1', role: 'Diretor', nome: 'x' }));
});
test('alguém que criou login sozinho (sem empresa) não entra em empresa nenhuma', async () => {
  const i = db('intruso');
  await assertFails(setDoc(doc(i, 'usuarios/intruso'), { tenantId: 't1', role: 'Diretor', nome: 'Intruso' }));
  await assertFails(getDoc(doc(i, 'tenants/t1/crm_clientes/x')));
  await assertFails(getDocs(collection(i, 'tenants/t1/erp_produtos')));
});

// ---------- a própria empresa e os níveis ----------
test('Diretor lê e grava a própria empresa', async () => {
  const d1 = db('d1');
  await assertSucceeds(getDoc(doc(d1, 'tenants/t1/crm_clientes/x')));
  await assertSucceeds(setDoc(doc(d1, 'tenants/t1/crm_clientes/novo'), { nome: 'Novo cliente' }));
  await assertSucceeds(getDoc(doc(d1, 'tenants/t1/dados/eagles_fin_caixas_v1')));
  await assertSucceeds(setDoc(doc(d1, 'tenants/t1/dados/eagles_perfil_empresa_v1'), { valor: { nomeFantasia: 'Um' } }));
});
test('Diretor não muda o próprio nível nem o plano da empresa', async () => {
  await assertFails(updateDoc(doc(db('d1'), 'usuarios/d1'), { role: 'SuperAdmin' }));
  await assertFails(updateDoc(doc(db('d1'), 'tenants/t1'), { plano: 'ambos', limiteUsuarios: 999 }));
});
test('Administrativo opera, mas não vê o caixa nem as configurações da empresa', async () => {
  const a1 = db('a1');
  await assertSucceeds(setDoc(doc(a1, 'tenants/t1/crm_negocios/n2'), { nome: 'Negócio novo' }));
  await assertFails(getDoc(doc(a1, 'tenants/t1/dados/eagles_fin_caixas_v1')));
  await assertFails(getDoc(doc(a1, 'tenants/t1/fin_lancamentos/l')));
  await assertSucceeds(addDoc(collection(a1, 'tenants/t1/fin_lancamentos'), { tipo: 'receber', valor: 50 }));
  await assertFails(setDoc(doc(a1, 'tenants/t1/dados/eagles_perfil_empresa_v1'), { valor: {} }));
});
test('Financeiro vê o financeiro, mas não altera o CRM nem o ERP', async () => {
  const f1 = db('f1');
  await assertSucceeds(getDoc(doc(f1, 'tenants/t1/fin_lancamentos/l')));
  await assertSucceeds(getDoc(doc(f1, 'tenants/t1/crm_clientes/x')));
  await assertFails(setDoc(doc(f1, 'tenants/t1/crm_clientes/x'), { nome: 'mudou' }));
  await assertFails(setDoc(doc(f1, 'tenants/t1/erp_produtos/p'), { nome: 'mudou' }));
});
test('login de Cliente (portal antigo) não lê os dados da empresa', async () => {
  await assertFails(getDoc(doc(db('c1'), 'tenants/t1/crm_clientes/x')));
  await assertFails(getDoc(doc(db('c1'), 'tenants/t1/dados/eagles_perfil_empresa_v1')));
});
test('empresa suspensa: o Diretor dela não lê os dados', async () => {
  await assertFails(getDoc(doc(db('d3'), 'tenants/t3/dados/eagles_perfil_empresa_v1')));
});
test('Super Admin lê qualquer empresa', async () => {
  await assertSucceeds(getDoc(doc(db('sa'), 'tenants/t2/crm_clientes/x')));
  await assertSucceeds(getDoc(doc(db('sa'), 'tenants/t1/fin_lancamentos/l')));
});

// ---------- links públicos (aprovação e portal) ----------
test('link de aprovação: o cliente abre só pelo código e só responde', async () => {
  const anon = db();
  await assertSucceeds(getDoc(doc(anon, 'conteudos_publicos/tok1')));
  await assertFails(getDocs(collection(anon, 'conteudos_publicos'))); // não dá para listar os de todo mundo
  await assertFails(updateDoc(doc(anon, 'conteudos_publicos/tok1'), { tenantId: 't2' }));
  await assertFails(updateDoc(doc(anon, 'conteudos_publicos/tok1'), { titulo: 'trocado', resposta: 'aprovado', comentario: '' }));
  await assertSucceeds(updateDoc(doc(anon, 'conteudos_publicos/tok1'), { resposta: 'ajustes', comentario: 'Trocar a cor', respondidoEm: new Date().toISOString() }));
  await assertFails(updateDoc(doc(anon, 'conteudos_publicos/tok1'), { resposta: 'aprovado', comentario: '' })); // já respondeu
});
test('portal do cliente: abre só pelo código, ninguém de fora lista ou altera', async () => {
  const anon = db();
  await assertSucceeds(getDoc(doc(anon, 'portais_publicos/ptk1')));
  await assertFails(getDocs(collection(anon, 'portais_publicos')));
  await assertFails(updateDoc(doc(anon, 'portais_publicos/ptk1'), { cliente: 'outro' }));
  await assertFails(updateDoc(doc(db('d2'), 'portais_publicos/ptk1'), { cliente: 'outro' }));
});

// ---------- registro de erros ----------
test('erros do sistema: cada um registra o seu, só o Super Admin lê', async () => {
  const e = { tenantId: 't1', uid: 'd1', usuario: 'D', pagina: 'index.html', mensagem: 'x', pilha: '', tipo: 'erro', navegador: 'ua', tela: '1x1', versao: 'v', assinatura: 'a', em: new Date().toISOString() };
  await assertSucceeds(setDoc(doc(db('d1'), 'erros_app/e1'), e));
  await assertFails(setDoc(doc(db('d1'), 'erros_app/e2'), Object.assign({}, e, { uid: 'outro' })));
  await assertFails(getDoc(doc(db('d1'), 'erros_app/e1')));
  await assertSucceeds(getDoc(doc(db('sa'), 'erros_app/e1')));
});

// ---------- bloqueio depois de 5 senhas erradas ----------
test('senha errada: quem está fora do sistema só consegue SOMAR 1 no contador', async () => {
  const anon = db(), ref = doc(anon, 'tentativas_login/vitima@x.com');
  const { increment, serverTimestamp } = await import('firebase/firestore');
  await assertSucceeds(setDoc(ref, { falhas: increment(1), ultimaEm: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(ref, { falhas: increment(1), ultimaEm: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(ref, { falhas: 0, ultimaEm: serverTimestamp() }, { merge: true })); // não zera
  await assertFails(setDoc(ref, { falhas: increment(5), ultimaEm: serverTimestamp() }, { merge: true })); // não pula
  await assertFails(deleteDoc(ref)); // não apaga
  await assertFails(getDoc(ref)); // não lê
  await assertFails(getDocs(collection(anon, 'tentativas_login'))); // não lista
});
test('conta com 5 senhas erradas não lê nada, e só o Super Admin desbloqueia', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'tentativas_login/bloq@x.com'), { falhas: 5 }); await setDoc(doc(ctx.firestore(), 'usuarios/ub'), { tenantId: 't1', role: 'Diretor', nome: 'Bloq' }); });
  const ub = env.authenticatedContext('ub', { email: 'bloq@x.com' }).firestore();
  await assertFails(getDoc(doc(ub, 'tenants/t1/crm_clientes/x')));
  await assertFails(deleteDoc(doc(ub, 'tentativas_login/bloq@x.com'))); // o próprio não se desbloqueia
  await assertSucceeds(getDoc(doc(ub, 'tentativas_login/bloq@x.com'))); // mas vê que está bloqueado
  await assertSucceeds(deleteDoc(doc(db('sa'), 'tentativas_login/bloq@x.com')));
  await assertSucceeds(getDoc(doc(ub, 'tenants/t1/crm_clientes/x'))); // desbloqueado: volta a ler
});
test('acertou a senha antes da 5ª: a própria pessoa zera o contador', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'tentativas_login/quase@x.com'), { falhas: 3 }); });
  await assertSucceeds(deleteDoc(doc(env.authenticatedContext('uq', { email: 'quase@x.com' }).firestore(), 'tentativas_login/quase@x.com')));
  await assertFails(deleteDoc(doc(env.authenticatedContext('outro', { email: 'outro@x.com' }).firestore(), 'tentativas_login/vitima@x.com')));
});
