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
import { createRequire } from 'node:module';
// a mesma função da tela monta as operações "boas" (Investimentos, Etapa 10)
const CT = createRequire(import.meta.url)('../inv/inv-carteira.js');
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc, serverTimestamp, increment, writeBatch } from 'firebase/firestore';

let env;
const regras = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
// Todo login real é por e-mail e senha, então o login simulado também traz o
// e-mail (a regra contaLivre lê request.auth.token.email). Cada login simulado
// abre a conexão uma vez só: abrir de novo dá "Firestore has already been started".
const conexoes = {};
const db = (uid) => (uid ? (conexoes[uid] = conexoes[uid] || env.authenticatedContext(uid, { email: uid + '@teste.local' }).firestore()) : env.unauthenticatedContext().firestore());

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
    // Super Admin que também usa a própria empresa (Empresas → Minha empresa grava só o tenantId, sem "titular")
    await seed('usuarios/sa1', { role: 'SuperAdmin', tenantId: 't1', nome: 'Super com empresa' });
    await seed('usuarios/a1b', { tenantId: 't1', role: 'Administrativo', nome: 'Adm Dois' });
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
  await env.withSecurityRulesDisabled(async (ctx) => { const f = ctx.firestore(); /* abre a conexão uma vez só */ await setDoc(doc(f, 'tentativas_login/bloq@x.com'), { falhas: 5 }); await setDoc(doc(f, 'usuarios/ub'), { tenantId: 't1', role: 'Diretor', nome: 'Bloq' }); });
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

// ---------- proteção do Super Admin e dos níveis ----------
test('Super Admin vinculado a uma empresa: o Diretor dela não muda o nível, os dados nem apaga a conta', async () => {
  const d1 = db('d1');
  await assertFails(updateDoc(doc(d1, 'usuarios/sa1'), { role: 'Diretor' }));
  await assertFails(updateDoc(doc(d1, 'usuarios/sa1'), { role: 'Administrativo' }));
  await assertFails(updateDoc(doc(d1, 'usuarios/sa1'), { nome: 'Trocado' }));
  await assertFails(deleteDoc(doc(d1, 'usuarios/sa1')));
  await assertFails(updateDoc(doc(db('a1'), 'usuarios/sa1'), { role: 'Diretor' }));
});
test('Diretor continua mudando o nível da equipe, mas nunca cria nem promove Super Admin', async () => {
  const d1 = db('d1');
  await assertSucceeds(updateDoc(doc(d1, 'usuarios/a1b'), { role: 'Financeiro' }));
  await assertFails(updateDoc(doc(d1, 'usuarios/a1b'), { role: 'SuperAdmin' }));
  await assertFails(setDoc(doc(d1, 'usuarios/novo_sa'), { tenantId: 't1', role: 'SuperAdmin', nome: 'X' }));
});
test('login de Cliente do portal não vira equipe, mas quem opera continua editando o login', async () => {
  await assertFails(updateDoc(doc(db('d1'), 'usuarios/c1'), { role: 'Diretor' }));
  await assertFails(updateDoc(doc(db('a1'), 'usuarios/c1'), { role: 'Diretor' }));
  await assertSucceeds(updateDoc(doc(db('d1'), 'usuarios/c1'), { nome: 'Cliente renomeado' }));
});
test('ninguém se promove a Super Admin', async () => {
  await assertFails(updateDoc(doc(db('a1'), 'usuarios/a1'), { role: 'SuperAdmin' }));
  await assertFails(updateDoc(doc(db('c1'), 'usuarios/c1'), { role: 'SuperAdmin' }));
  await assertFails(setDoc(doc(db('sozinho'), 'usuarios/sozinho'), { role: 'SuperAdmin', nome: 'X' }));
  await assertFails(setDoc(doc(db(), 'usuarios/anonimo'), { role: 'SuperAdmin' }));
});

// ---------- v157: anotações e contatos dos negócios (um documento por item) ----------
test('v157: anotações e contatos dos negócios — mesmas permissões das outras listas do CRM', async () => {
  for (const col of ['crm_negocio_anotacoes', 'crm_negocio_contatos']) {
    // quem opera grava e lê; o Diretor também
    await assertSucceeds(setDoc(doc(db('a1'), `tenants/t1/${col}/x1`), { negocioId: 'n', texto: 'ok' }));
    await assertSucceeds(updateDoc(doc(db('d1'), `tenants/t1/${col}/x1`), { texto: 'editado' }));
    await assertSucceeds(getDocs(collection(db('a1'), `tenants/t1/${col}`)));
    // o Financeiro lê, mas não grava nem apaga
    await assertSucceeds(getDoc(doc(db('f1'), `tenants/t1/${col}/x1`)));
    await assertFails(setDoc(doc(db('f1'), `tenants/t1/${col}/x2`), { texto: 'não' }));
    await assertFails(deleteDoc(doc(db('f1'), `tenants/t1/${col}/x1`)));
    // login de Cliente, outra empresa e quem não está logado: nada
    await assertFails(getDoc(doc(db('c1'), `tenants/t1/${col}/x1`)));
    await assertFails(getDocs(collection(db('d2'), `tenants/t1/${col}`)));
    await assertFails(setDoc(doc(db('d2'), `tenants/t1/${col}/x3`), { texto: 'invasor' }));
    await assertFails(getDoc(doc(db(), `tenants/t1/${col}/x1`)));
    await assertFails(setDoc(doc(db('c1'), `tenants/t1/${col}/x4`), { texto: 'cliente' }));
    await assertFails(setDoc(doc(db(), `tenants/t1/${col}/x5`), { texto: 'sem login' }));
    // o Diretor também apaga (o item volta logo abaixo para o resto do teste)
    await assertSucceeds(deleteDoc(doc(db('d1'), `tenants/t1/${col}/x1`)));
    await assertSucceeds(setDoc(doc(db('a1'), `tenants/t1/${col}/x1`), { negocioId: 'n', texto: 'ok' }));
    // empresa suspensa: nem o Diretor dela
    await assertFails(setDoc(doc(db('d3'), `tenants/t3/${col}/x1`), { texto: 'suspensa' }));
    // o Super Admin lê
    await assertSucceeds(getDoc(doc(db('sa'), `tenants/t1/${col}/x1`)));
    await assertSucceeds(deleteDoc(doc(db('a1'), `tenants/t1/${col}/x1`)));
  }
  // a lista não virou "qualquer coleção": um nome parecido continua fechado
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/crm_negocio_outros/x'), { a: 1 }));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/crm_negocio_outros/x')));
});
test('v157: itens já copiados (dados/{chave}_importados) e reserva do link do portal seguem a regra comum de dados', async () => {
  for (const k of ['tenants/t1/dados/eagles_crm_negocio_anotacoes_v1_importados', 'tenants/t1/dados/eagles_portal_links_v1__r_0123456789abcdef']) {
    await assertSucceeds(setDoc(doc(db('a1'), k), { ids: ['a'] }));
    await assertSucceeds(getDoc(doc(db('f1'), k)));
    await assertFails(setDoc(doc(db('f1'), k), { ids: [] }));
    await assertFails(getDoc(doc(db('d2'), k)));
    await assertFails(setDoc(doc(db('d2'), k), { ids: [] }));
    await assertFails(getDoc(doc(db('c1'), k)));
    await assertFails(setDoc(doc(db(), k), { ids: [] }));
  }
});

// ---------- Investimentos (Etapa 05): favoritos, liberação do Administrativo e consumo do dia ----------
const favOk = () => ({ listas: [{ id: 'principal', nome: 'Meus favoritos', ativos: ['BR:B3:ZZTA3'] }], atualizadoEm: serverTimestamp() });
test('Investimentos: com o módulo DESLIGADO ninguém usa os favoritos', async () => {
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/d1'), favOk()));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/d1')));
  // só o Super Admin liga o módulo (o Diretor não grava o documento da empresa)
  await assertFails(updateDoc(doc(db('d1'), 'tenants/t1'), { modulos: { investimentos: true } }));
  await assertSucceeds(setDoc(doc(db('sa'), 'tenants/t1'), { modulos: { investimentos: true } }, { merge: true }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'tenants/t2'), { modulos: { investimentos: true } }, { merge: true });
    await setDoc(doc(f, 'tenants/t3'), { modulos: { investimentos: true } }, { merge: true });
    await setDoc(doc(f, 'tenants/t4'), { nomeEmpresa: 'Sem módulo', plano: 'erp', ativo: true });
    await setDoc(doc(f, 'usuarios/d4'), { tenantId: 't4', role: 'Diretor', nome: 'Diretor Quatro' });
    await setDoc(doc(f, 'usuarios/a2'), { tenantId: 't2', role: 'Administrativo', nome: 'Adm Dois da t2' });
  });
});
test('Investimentos: favoritos são de cada pessoa (nem Diretor, nem Super Admin, nem outra empresa)', async () => {
  await assertSucceeds(setDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/d1'), favOk()));
  await assertSucceeds(getDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/d1')));
  await assertSucceeds(setDoc(doc(db('f1'), 'tenants/t1/inv_favoritos/f1'), favOk()));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/f1')));          // Diretor não lê os do Financeiro
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_favoritos/f1'), favOk())); // nem grava por ele
  await assertFails(getDoc(doc(db('sa'), 'tenants/t1/inv_favoritos/d1')));           // Super Admin sem acesso automático
  await assertFails(getDoc(doc(db('sa1'), 'tenants/t1/inv_favoritos/d1')));
  await assertFails(setDoc(doc(db('sa1'), 'tenants/t1/inv_favoritos/sa1'), favOk())); // Super Admin não tem favoritos
  await assertFails(getDoc(doc(db('d2'), 'tenants/t1/inv_favoritos/d1')));           // outra empresa
  await assertFails(setDoc(doc(db('d2'), 'tenants/t1/inv_favoritos/d2'), favOk()));
  await assertFails(getDoc(doc(db('c1'), 'tenants/t1/inv_favoritos/c1')));           // login de Cliente
  await assertFails(getDoc(doc(db(), 'tenants/t1/inv_favoritos/d1')));               // sem login
  await assertFails(setDoc(doc(db('d3'), 'tenants/t3/inv_favoritos/d3'), favOk()));  // empresa suspensa
  await assertFails(setDoc(doc(db('d4'), 'tenants/t4/inv_favoritos/d4'), favOk()));  // empresa sem o módulo
  await assertFails(setDoc(doc(db('a1'), 'tenants/t1/inv_favoritos/a1'), favOk()));  // Administrativo sem liberação
  await assertSucceeds(deleteDoc(doc(db('f1'), 'tenants/t1/inv_favoritos/f1')));
});
test('Investimentos: formato dos favoritos é conferido', async () => {
  const d = db('d1'); const cam = 'tenants/t1/inv_favoritos/d1';
  await assertFails(setDoc(doc(d, cam), { listas: [], atualizadoEm: serverTimestamp() }));
  await assertFails(setDoc(doc(d, cam), { listas: Array.from({ length: 21 }, (_, i) => ({ id: 'l' + i, nome: 'L', ativos: [] })), atualizadoEm: serverTimestamp() }));
  await assertFails(setDoc(doc(d, cam), Object.assign(favOk(), { carteira: 'não pode' })));
  await assertFails(setDoc(doc(d, cam), { listas: favOk().listas, atualizadoEm: new Date('2020-01-01') }));
  await assertFails(setDoc(doc(d, cam), { listas: 'texto', atualizadoEm: serverTimestamp() }));
});
test('Investimentos: só o Diretor libera o Administrativo da própria empresa', async () => {
  const lib = (uid) => ({ liberadoPor: uid, em: serverTimestamp() });
  await assertFails(setDoc(doc(db('a1'), 'tenants/t1/inv_acesso/a1'), lib('a1')));    // não se autolibera
  await assertFails(setDoc(doc(db('f1'), 'tenants/t1/inv_acesso/a1'), lib('f1')));    // Financeiro não libera
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_acesso/f1'), lib('d1')));    // só Administrativo é liberado
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_acesso/a2'), lib('d1')));    // pessoa de outra empresa
  await assertFails(setDoc(doc(db('d2'), 'tenants/t1/inv_acesso/a1'), lib('d2')));    // Diretor de outra empresa
  await assertFails(setDoc(doc(db('sa'), 'tenants/t1/inv_acesso/a1'), lib('sa')));    // Super Admin não mexe na equipe
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_acesso/a1'), lib('outro'))); // "liberadoPor" tem que ser quem libera
  await assertSucceeds(setDoc(doc(db('d1'), 'tenants/t1/inv_acesso/a1'), lib('d1')));
  await assertSucceeds(getDoc(doc(db('a1'), 'tenants/t1/inv_acesso/a1')));           // a pessoa vê a própria liberação
  await assertFails(getDoc(doc(db('a1b'), 'tenants/t1/inv_acesso/a1')));              // colega Administrativo não vê
  await assertSucceeds(setDoc(doc(db('a1'), 'tenants/t1/inv_favoritos/a1'), favOk())); // liberado: usa
  await assertFails(deleteDoc(doc(db('a1'), 'tenants/t1/inv_acesso/a1')));            // não tira a liberação de ninguém
  await assertSucceeds(deleteDoc(doc(db('d1'), 'tenants/t1/inv_acesso/a1')));
  await assertFails(getDoc(doc(db('a1'), 'tenants/t1/inv_favoritos/a1')));            // sem liberação: não usa mais
});
test('Investimentos: consumo do dia só soma (de 0 a 500), não apaga e não aceita outros campos', async () => {
  const cam = 'inv_admin_uso/2026-11-25';
  const soma = (l, g, e) => ({ leituras: increment(l), gravacoes: increment(g), exclusoes: increment(e), atualizadoEm: serverTimestamp() });
  await assertSucceeds(setDoc(doc(db('d1'), cam), soma(12, 2, 0), { merge: true }));
  await assertSucceeds(setDoc(doc(db('f1'), cam), soma(5, 1, 0), { merge: true }));
  await assertSucceeds(setDoc(doc(db('d2'), cam), soma(3, 1, 1), { merge: true }));   // outra empresa habilitada também soma
  await assertFails(setDoc(doc(db('d1'), cam), soma(501, 0, 0), { merge: true }));     // soma grande demais
  await assertFails(setDoc(doc(db('d1'), cam), soma(-5, 0, 0), { merge: true }));      // não diminui
  await assertFails(setDoc(doc(db('d1'), cam), Object.assign(soma(1, 0, 0), { empresa: 't1' }), { merge: true })); // sem dados extras
  await assertFails(setDoc(doc(db('d1'), 'inv_admin_uso/hoje'), soma(1, 0, 0), { merge: true }));                  // dia no formato AAAA-MM-DD
  await assertFails(setDoc(doc(db('d4'), cam), soma(1, 0, 0), { merge: true }));      // empresa sem o módulo
  await assertFails(setDoc(doc(db('c1'), cam), soma(1, 0, 0), { merge: true }));      // Cliente
  await assertFails(setDoc(doc(db(), cam), soma(1, 0, 0), { merge: true }));          // sem login
  await assertFails(deleteDoc(doc(db('d1'), cam)));
  await assertFails(deleteDoc(doc(db('sa'), cam)));
  await assertSucceeds(getDoc(doc(db('sa'), cam)));
  await assertSucceeds(getDoc(doc(db('f1'), cam)));
  await assertFails(getDoc(doc(db('d4'), cam)));
  let s = null; await env.withSecurityRulesDisabled(async (ctx) => { s = (await getDoc(doc(ctx.firestore(), cam))).data(); });
  if (s.leituras !== 20 || s.gravacoes !== 4 || s.exclusoes !== 1) throw new Error('soma errada: ' + JSON.stringify(s));
});

// ---------- Investimentos: carteiras, preços manuais, alertas e cache global ----------
// Etapa 10: a carteira guarda o SALDO (caixa e quantidade de cada ativo) e as regras conferem cada mudança.
// As operações "boas" são montadas pela MESMA função da tela (inv/inv-carteira.js → prepararOperacao).
const cart = (tipo, dono, extra) => Object.assign({ nome: 'Minha carteira', tipo, dono, corretoras: ['XP'], moedaBase: 'BRL', caixaAutomatico: true, ativa: true, opsN: 0, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01', criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }, extra || {});
const opOk = (extra) => Object.assign({ tipo: 'compra', data: '2026-01-05', assetId: 'BR:B3:PETR4', qtd: 100, preco: 10.5, taxas: 1, moeda: 'BRL' }, extra || {});
async function lerCarteira(cam) { let c = null; await env.withSecurityRulesDisabled(async (x) => { c = (await getDoc(doc(x.firestore(), cam))).data(); }); return c; }
async function lerOp(cam, id) { let o = null; await env.withSecurityRulesDisabled(async (x) => { const s = await getDoc(doc(x.firestore(), cam + '/operacoes/' + id)); o = s.exists() ? s.data() : null; }); return o; }
// grava como a tela: operação N + carteira (contador, saldo, última data) + marcador do estorno. "trocar" adultera o que for pedido.
async function lancar(uid, cam, o, trocar = {}) {
  const c = await lerCarteira(cam);
  const alvo = o.tipo === 'estorno' ? await lerOp(cam, o.estorna) : null;
  const p = CT.prepararOperacao(c, o, { alvo: alvo ? Object.assign({ id: o.estorna }, alvo) : null });
  const opDoc = Object.assign({}, p.ok ? p.gravar : CT.paraGravar(o), { seq: c.opsN + 1, criadoPor: uid, criadoEm: serverTimestamp() }, trocar.op || {});
  for (const k of Object.keys(opDoc)) if (opDoc[k] === undefined) delete opDoc[k];
  const saldo = trocar.saldo || (p.ok ? p.saldo : c.saldo);
  const f = db(uid); const b = writeBatch(f); const id = trocar.id || String(c.opsN + 1);
  b.set(doc(f, cam + '/operacoes/' + id), opDoc);
  if (!trocar.semContador) b.update(doc(f, cam), Object.assign({ opsN: c.opsN + 1, saldo, ultimaData: trocar.ultimaData || o.data, atualizadoEm: serverTimestamp() }, trocar.cart || {}));
  if (o.tipo === 'estorno' && !trocar.semMarcador) b.set(doc(f, cam + '/estornos/' + o.estorna), { op: id, criadoPor: uid, criadoEm: serverTimestamp() });
  return b.commit();
}
test('Investimentos: carteira PESSOAL só o dono vê e mexe (nem Diretor, nem Super Admin de outra pessoa, nem outra empresa)', async () => {
  await assertSucceeds(setDoc(doc(db('f1'), 'tenants/t1/inv_carteiras/cf1'), cart('pessoal', 'f1')));
  await assertSucceeds(getDoc(doc(db('f1'), 'tenants/t1/inv_carteiras/cf1')));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_carteiras/cf1')));      // Diretor não vê
  await assertFails(getDoc(doc(db('sa'), 'tenants/t1/inv_carteiras/cf1')));      // Super Admin não vê
  await assertFails(getDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/cf1')));     // nem o Super Admin vinculado à empresa
  await assertFails(getDoc(doc(db('d2'), 'tenants/t1/inv_carteiras/cf1')));      // outra empresa
  await assertFails(getDoc(doc(db('c1'), 'tenants/t1/inv_carteiras/cf1')));
  await assertFails(getDoc(doc(db(), 'tenants/t1/inv_carteiras/cf1')));
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_carteiras/cd1x'), cart('pessoal', 'f1')));  // não cria no nome de outro
  await assertFails(setDoc(doc(db('a1'), 'tenants/t1/inv_carteiras/ca1'), cart('pessoal', 'a1')));  // Administrativo sem liberação
  await assertFails(setDoc(doc(db('f1'), 'tenants/t1/inv_carteiras/cf9'), cart('pessoal', 'f1', { saldo: { caixa: 100000, pos: {} } }))); // não nasce com saldo
  await assertSucceeds(getDocs(query(collection(db('f1'), 'tenants/t1/inv_carteiras'), where('dono', '==', 'f1'), where('tipo', '==', 'pessoal'))));
  await assertFails(getDocs(query(collection(db('d1'), 'tenants/t1/inv_carteiras'), where('tipo', '==', 'pessoal'))));
  await assertFails(getDocs(collection(db('d1'), 'tenants/t1/inv_carteiras')));
  await assertSucceeds(lancar('f1', 'tenants/t1/inv_carteiras/cf1', opOk()));
  await assertFails(getDocs(collection(db('d1'), 'tenants/t1/inv_carteiras/cf1/operacoes')));
  await assertFails(lancar('d1', 'tenants/t1/inv_carteiras/cf1', opOk()));
  await assertSucceeds(getDocs(collection(db('f1'), 'tenants/t1/inv_carteiras/cf1/operacoes')));
});
test('Investimentos: carteira da EMPRESA é do Diretor e do Financeiro; Administrativo liberado só tem a pessoal', async () => {
  await assertFails(setDoc(doc(db('a1'), 'tenants/t1/inv_carteiras/ce0'), cart('empresa', 'a1')));
  await assertSucceeds(setDoc(doc(db('d1'), 'tenants/t1/inv_carteiras/ce1'), cart('empresa', 'd1', { nome: 'Caixa da empresa' })));
  await assertSucceeds(getDoc(doc(db('f1'), 'tenants/t1/inv_carteiras/ce1')));
  await assertSucceeds(lancar('f1', 'tenants/t1/inv_carteiras/ce1', opOk()));
  await assertSucceeds(getDocs(query(collection(db('d1'), 'tenants/t1/inv_carteiras'), where('tipo', '==', 'empresa'))));
  await assertFails(getDoc(doc(db('sa'), 'tenants/t1/inv_carteiras/ce1')));
  await assertFails(getDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/ce1')));    // Super Admin vinculado: não lê a carteira da empresa
  await assertFails(getDoc(doc(db('d2'), 'tenants/t1/inv_carteiras/ce1')));
  await assertSucceeds(setDoc(doc(db('d1'), 'tenants/t1/inv_acesso/a1'), { liberadoPor: 'd1', em: serverTimestamp() }));
  await assertFails(getDoc(doc(db('a1'), 'tenants/t1/inv_carteiras/ce1')));
  await assertSucceeds(setDoc(doc(db('a1'), 'tenants/t1/inv_carteiras/ca1'), cart('pessoal', 'a1')));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_carteiras/ca1')));
});
test('Investimentos: operação é imutável, conferida e numerada; carteira não é apagada nem muda de dono', async () => {
  const cam = 'tenants/t1/inv_carteiras/cf1'; const f = db('f1');
  await assertFails(lancar('f1', cam, opOk(), { semContador: true }));
  await assertFails(lancar('f1', cam, opOk({ tipo: 'apagar' })));
  await assertFails(lancar('f1', cam, opOk({ qtd: -1 })));
  await assertFails(lancar('f1', cam, opOk({ assetId: '<script>' })));
  await assertFails(lancar('f1', cam, opOk(), { op: { extra: 1 } }));
  await assertFails(lancar('f1', cam, opOk(), { op: { criadoPor: 'd1' } }));                      // criadoPor é quem grava
  await assertFails(lancar('f1', cam, opOk(), { op: { data: '26/01/2026' } }));
  await assertFails(lancar('f1', cam, opOk(), { id: 'qualquer' }));                               // número fora da sequência
  const umaOp = cam + '/operacoes/1';
  await assertFails(updateDoc(doc(f, umaOp), { qtd: 1 }));
  await assertFails(deleteDoc(doc(f, umaOp)));
  await assertFails(deleteDoc(doc(f, cam)));
  await assertFails(updateDoc(doc(f, cam), { dono: 'd1', atualizadoEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, cam), { tipo: 'empresa', atualizadoEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, cam), { opsN: 0, atualizadoEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, cam), { saldo: { caixa: 999999, pos: {} }, atualizadoEm: serverTimestamp() }));     // saldo não muda sozinho
  await assertFails(updateDoc(doc(f, cam), { caixaAutomatico: false, atualizadoEm: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(f, cam), { nome: 'Aposentadoria', atualizadoEm: serverTimestamp() }));
});
test('Investimentos: preços manuais (Diretor e Financeiro gravam), alertas de cada pessoa e cache global só do servidor', async () => {
  const pm = (uid, n = 1) => ({ itens: Array.from({ length: n }, (_, i) => ({ assetId: 'BR:B3:ZZT' + i, preco: 10, data: '2026-11-25' })), por: uid, atualizadoEm: serverTimestamp() });
  await assertSucceeds(setDoc(doc(db('d1'), 'tenants/t1/inv_precos/manual'), pm('d1')));
  await assertSucceeds(getDoc(doc(db('a1'), 'tenants/t1/inv_precos/manual')));
  await assertFails(setDoc(doc(db('a1'), 'tenants/t1/inv_precos/manual'), pm('a1')));
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_precos/outro'), pm('d1')));
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_precos/manual'), pm('d1', 301)));
  await assertFails(getDoc(doc(db('d2'), 'tenants/t1/inv_precos/manual')));
  await assertFails(deleteDoc(doc(db('d1'), 'tenants/t1/inv_precos/manual')));
  const al = { itens: [{ assetId: 'BR:B3:PETR4', tipo: 'acima', valor: 40 }], atualizadoEm: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db('f1'), 'tenants/t1/inv_alertas/f1'), al));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_alertas/f1')));
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_alertas/f1'), al));
  await assertFails(setDoc(doc(db('f1'), 'tenants/t1/inv_alertas/f1'), { itens: Array(51).fill({}), atualizadoEm: serverTimestamp() }));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'inv_mercado/BR_B3_PETR4'), { preco: 10, estado: 'atrasado', fonte: 'x', horario: '2026-11-25T10:00:00' }); });
  await assertSucceeds(getDoc(doc(db('d1'), 'inv_mercado/BR_B3_PETR4')));
  await assertSucceeds(getDoc(doc(db('sa'), 'inv_mercado/BR_B3_PETR4')));
  await assertFails(getDoc(doc(db('d4'), 'inv_mercado/BR_B3_PETR4')));
  await assertFails(getDoc(doc(db(), 'inv_mercado/BR_B3_PETR4')));
  await assertFails(setDoc(doc(db('d1'), 'inv_mercado/BR_B3_PETR4'), { preco: 1 }));
  await assertFails(setDoc(doc(db('sa'), 'inv_mercado/BR_B3_PETR4'), { preco: 1 }));
});

// ---------- Auditoria corretiva + Etapa 10: integridade garantida pelas regras (gravação direta e concorrência) ----------
async function novaCarteira(id, extra) {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'tenants/t1/inv_carteiras/' + id), Object.assign(cart('pessoal', 'f1', { nome: 'Aud' }), extra || {})); });
  return 'tenants/t1/inv_carteiras/' + id;
}
test('Auditoria: várias operações no mesmo lote com UM incremento do contador são recusadas', async () => {
  const cam = await novaCarteira('aud1'); const f = db('f1'); const b = writeBatch(f);
  const p = CT.prepararOperacao(await lerCarteira(cam), opOk(), {});
  b.set(doc(f, cam + '/operacoes/1'), Object.assign({ seq: 1, criadoPor: 'f1', criadoEm: serverTimestamp() }, p.gravar));
  b.set(doc(f, cam + '/operacoes/2'), Object.assign({ seq: 2, criadoPor: 'f1', criadoEm: serverTimestamp() }, p.gravar));
  b.update(doc(f, cam), { opsN: 1, saldo: p.saldo, ultimaData: '2026-01-05', atualizadoEm: serverTimestamp() });
  await assertFails(b.commit());
  await assertSucceeds(lancar('f1', cam, opOk()));
  if ((await lerCarteira(cam)).opsN !== 1) throw new Error('contador deveria ser 1');
});
test('Auditoria: contador não sobe sem a operação correspondente', async () => {
  const cam = await novaCarteira('aud2');
  await assertFails(updateDoc(doc(db('f1'), cam), { opsN: increment(1), atualizadoEm: serverTimestamp() }));
  await assertFails(lancar('f1', cam, opOk(), { id: '5' }));
});
test('Auditoria: duas vendas simultâneas (mesma pessoa em dois aparelhos, ou Diretor e Financeiro na carteira da empresa) — só UMA passa', async () => {
  const cam = await novaCarteira('aud3', { tipo: 'empresa', dono: 'd1' });
  await assertSucceeds(lancar('d1', cam, opOk({ qtd: 100 })));
  const c = await lerCarteira(cam);
  const venda = (uid) => { const p = CT.prepararOperacao(c, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 80, preco: 12 }), {}); const f = env.authenticatedContext(uid, { email: uid + '@teste.local' }).firestore(); const b = writeBatch(f);
    b.set(doc(f, cam + '/operacoes/2'), Object.assign({ seq: 2, criadoPor: uid, criadoEm: serverTimestamp() }, p.gravar)); b.update(doc(f, cam), { opsN: 2, saldo: p.saldo, ultimaData: '2026-01-06', atualizadoEm: serverTimestamp() }); return b.commit(); };
  const r = await Promise.allSettled([venda('d1'), venda('f1')]);
  if (r.filter((x) => x.status === 'fulfilled').length !== 1) throw new Error('esperava exatamente 1 gravação aceita');
  const depois = await lerCarteira(cam);
  if (depois.opsN !== 2 || depois.saldo.pos['BR:B3:PETR4'] !== 20e8) throw new Error('saldo errado: ' + JSON.stringify(depois.saldo));
  // a segunda venda, refeita sobre o saldo novo (como a tela faz), é recusada: só restam 20
  await assertFails(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 80, preco: 12 }), { saldo: { caixa: depois.saldo.caixa + 96000, pos: { 'BR:B3:PETR4': -60e8 } } }));
});
test('Etapa 10: gravação DIRETA com saldo insuficiente ou números adulterados é recusada pelas regras', async () => {
  const cam = await novaCarteira('sal1');
  await assertSucceeds(lancar('f1', cam, { tipo: 'aporte', data: '2026-01-02', valor: 1000, moeda: 'BRL' }));
  await assertSucceeds(lancar('f1', cam, opOk({ data: '2026-01-05', qtd: 50, preco: 10, taxas: 0 })));
  const c = await lerCarteira(cam); const P = 'BR:B3:PETR4';
  // venda de 80 com só 50: saldo "consertado" para 0 não engana (o efeito declarado não fecha) e saldo negativo é recusado
  await assertFails(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 80, preco: 10, taxas: 0 }), { saldo: { caixa: c.saldo.caixa + 80000, pos: { [P]: -30e8 } } }));
  await assertFails(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 80, preco: 10, taxas: 0 }), { saldo: { caixa: c.saldo.caixa + 80000, pos: { [P]: 0 } } }));
  // retirada maior que o caixa
  await assertFails(lancar('f1', cam, { tipo: 'retirada', data: '2026-01-06', valor: 600, moeda: 'BRL' }, { saldo: { caixa: 0, pos: c.saldo.pos }, op: { dc: -60000, ai: 0 } }));
  // caixa inflado (efeito declarado maior que a conta)
  await assertFails(lancar('f1', cam, { tipo: 'aporte', data: '2026-01-06', valor: 10, moeda: 'BRL' }, { op: { dc: 100000 }, saldo: { caixa: c.saldo.caixa + 100000, pos: c.saldo.pos } }));
  // venda com preço declarado diferente do caixa que entra
  await assertFails(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 10, preco: 10, taxas: 0 }), { op: { dc: 999999 }, saldo: { caixa: c.saldo.caixa + 999999, pos: { [P]: 40e8 } } }));
  // aporte implícito sem necessidade (havia caixa) e aporte implícito numa retirada
  await assertFails(lancar('f1', cam, opOk({ data: '2026-01-06', qtd: 1, preco: 10, taxas: 0 }), { op: { ai: 5000 }, saldo: { caixa: c.saldo.caixa - 1000 + 5000, pos: { [P]: 51e8 } } }));
  // mexer em OUTRO ativo junto
  await assertFails(lancar('f1', cam, opOk({ data: '2026-01-06', qtd: 1, preco: 10, taxas: 0 }), { saldo: { caixa: c.saldo.caixa - 1000, pos: { [P]: 51e8, 'BR:B3:VALE3': 1000e8 } } }));
  // operação ANTERIOR à última (fora de ordem) e "última data" errada
  await assertFails(lancar('f1', cam, { tipo: 'aporte', data: '2026-01-03', valor: 1, moeda: 'BRL' }));
  await assertFails(lancar('f1', cam, { tipo: 'aporte', data: '2026-01-06', valor: 1, moeda: 'BRL' }, { ultimaData: '2026-01-05' }));
  // campos obrigatórios por tipo: compra sem preço, aporte com ativo
  await assertFails(lancar('f1', cam, opOk({ data: '2026-01-06' }), { op: { preco: undefined } }));
  await assertFails(lancar('f1', cam, { tipo: 'aporte', data: '2026-01-06', valor: 1, moeda: 'BRL' }, { op: { assetId: P } }));
  // e o certo passa
  await assertSucceeds(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-01-06', qtd: 50, preco: 10, taxas: 0 })));
  const d = await lerCarteira(cam); if (d.saldo.pos[P] !== 0 || d.saldo.caixa !== 100000) throw new Error('saldo final ' + JSON.stringify(d.saldo));
});
test('Etapa 10: datas — calendário real (fevereiro, bissexto, meses de 30 dias), viradas de mês e ano, nada no futuro', async () => {
  const cam = await novaCarteira('dat1'); const ap = (data) => ({ tipo: 'aporte', data, valor: 1, moeda: 'BRL' });
  for (const d of ['2023-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', '1900-02-29', '2099-01-01']) await assertFails(lancar('f1', cam, ap(d)), d);
  for (const d of ['2024-02-29', '2025-01-31', '2025-12-31', '2026-01-01', '2026-03-31', '2026-04-30']) await assertSucceeds(lancar('f1', cam, ap(d)));
});
test('Auditoria: estorno inexistente, duplicado, de estorno, irreversível ou que deixaria saldo negativo é recusado', async () => {
  const cam = await novaCarteira('aud4');
  await assertSucceeds(lancar('f1', cam, opOk({ qtd: 100 })));                                                       // 1
  await assertSucceeds(lancar('f1', cam, opOk({ tipo: 'venda', data: '2026-02-01', qtd: 80, preco: 12, taxas: 0 })));  // 2
  await assertSucceeds(lancar('f1', cam, { tipo: 'retirada', data: '2026-02-02', valor: 900, moeda: 'BRL' }));         // 3
  const est = (alvo) => ({ tipo: 'estorno', data: '2026-02-03', estorna: alvo, moeda: 'BRL' });
  await assertFails(lancar('f1', cam, est('99'), { op: { dc: 0, ai: 0 } }));                                           // não existe
  await assertFails(lancar('f1', cam, est('1'), { saldo: { caixa: (await lerCarteira(cam)).saldo.caixa + 105100, pos: { 'BR:B3:PETR4': -80e8 } }, op: { dq: -100e8, dc: 105100, ai: 0, alvoAsset: 'BR:B3:PETR4' } })); // compra: deixaria −80
  await assertFails(lancar('f1', cam, est('2'), { saldo: { caixa: -1, pos: { 'BR:B3:PETR4': 100e8 } }, op: { dq: 80e8, dc: -96000, ai: 0, alvoAsset: 'BR:B3:PETR4' } })); // venda: caixa negativo
  await assertSucceeds(lancar('f1', cam, est('3')));                                                                    // 4 = estorno da retirada
  await assertFails(lancar('f1', cam, est('3')));                                                                       // duplicado
  await assertFails(lancar('f1', cam, est('4'), { op: { dc: -90000, ai: 0 } }));                                       // estorno de estorno
  await assertSucceeds(lancar('f1', cam, est('2')));                                                                    // 5 = agora o caixa permite
  await assertFails(setDoc(doc(db('f1'), cam + '/estornos/1'), { op: '4', criadoPor: 'f1', criadoEm: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db('f1'), cam + '/estornos/3')));
  const d2 = await novaCarteira('aud4b');
  await assertSucceeds(lancar('f1', d2, opOk({ qtd: 10 })));
  await assertSucceeds(lancar('f1', d2, { tipo: 'desdobramento', data: '2026-02-01', assetId: 'BR:B3:PETR4', fator: 2, moeda: 'BRL' }));
  await assertFails(lancar('f1', d2, est('2'), { op: { dq: -10e8, dc: 0, ai: 0, alvoAsset: 'BR:B3:PETR4' }, saldo: { caixa: 0, pos: { 'BR:B3:PETR4': 10e8 } } })); // desdobramento não se estorna
});
test('Auditoria: carteira arquivada não recebe operações; números grandes demais são recusados', async () => {
  const arq = await novaCarteira('aud5', { ativa: false });
  await assertFails(lancar('f1', arq, opOk()));
  await assertSucceeds(updateDoc(doc(db('f1'), arq), { ativa: true, atualizadoEm: serverTimestamp() }));
  const cam = await novaCarteira('aud6');
  await assertFails(lancar('f1', cam, opOk(), { op: { qtd: 900000000, qtdE8: 90000000000000000, dq: 90000000000000000 } }));
  await assertFails(lancar('f1', cam, opOk({ preco: 900000000 })));
  await assertSucceeds(lancar('f1', cam, opOk({ data: '2001-02-03', qtd: 10000000, preco: 0.00000001, taxas: 0 })));
});
async function rotulo(n, p) { try { return await p; } catch (e) { throw new Error('passo ' + n + ': ' + e.message); } }
test('D-02: Super Admin tem a PRÓPRIA carteira pessoal só na empresa vinculada; nunca a de terceiros nem a da empresa', async () => {
  await rotulo(1, assertSucceeds(setDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/csa1'), cart('pessoal', 'sa1'))));
  await rotulo(2, assertSucceeds(getDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/csa1'))));
  await rotulo(3, assertSucceeds(lancar('sa1', 'tenants/t1/inv_carteiras/csa1', opOk())));
  await assertSucceeds(setDoc(doc(db('sa1'), 'tenants/t1/inv_cenarios/sa1'), { itens: [], atualizadoEm: serverTimestamp() }));  // cenários próprios
  await assertFails(getDoc(doc(db('sa1'), 'tenants/t1/inv_cenarios/f1')));
  await rotulo(4, assertSucceeds(getDocs(query(collection(db('sa1'), 'tenants/t1/inv_carteiras'), where('dono', '==', 'sa1'), where('tipo', '==', 'pessoal')))));
  // o caminho mais caro das regras (Super Admin + estorno de compra, com marcador) cabe no limite de 1.000 expressões
  await rotulo(40, assertSucceeds(lancar('sa1', 'tenants/t1/inv_carteiras/csa1', { tipo: 'estorno', data: '2026-01-06', estorna: '1', moeda: 'BRL' })));
  await rotulo(41, assertSucceeds(lancar('sa1', 'tenants/t1/inv_carteiras/csa1', { tipo: 'aporte', data: '2026-01-07', valor: 10, moeda: 'USD', cambio: 5.4321 })));
  await rotulo(5, assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_carteiras/csa1'))));        // o Diretor não vê a do Super Admin
  await rotulo(6, assertFails(getDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/cf1'))));        // o Super Admin não vê a de terceiros
  await rotulo(7, assertFails(getDocs(collection(db('sa1'), 'tenants/t1/inv_carteiras/cf1/operacoes'))));
  await rotulo(8, assertFails(setDoc(doc(db('sa1'), 'tenants/t1/inv_carteiras/csa2'), cart('empresa', 'sa1'))));  // nem cria carteira da empresa
  await rotulo(9, assertFails(setDoc(doc(db('sa1'), 'tenants/t2/inv_carteiras/csa3'), cart('pessoal', 'sa1'))));  // nem em outra empresa
  await rotulo(10, assertFails(setDoc(doc(db('sa'), 'tenants/t1/inv_carteiras/csa4'), cart('pessoal', 'sa'))));    // Super Admin sem empresa vinculada
  await rotulo(11, assertSucceeds(getDoc(doc(db('sa1'), 'tenants/t1/inv_precos/manual'))));       // lê os preços manuais da empresa dele
  await rotulo(12, assertFails(setDoc(doc(db('sa1'), 'tenants/t1/inv_precos/manual'), { itens: [], por: 'sa1', atualizadoEm: serverTimestamp() })));
});
test('Etapa 09: cenários de projeção são de cada pessoa (nem Diretor, nem Super Admin, nem outra empresa); até 20', async () => {
  const cen = (n = 1) => ({ itens: Array.from({ length: n }, (_, i) => ({ id: 'c' + i, nome: 'Cenário ' + i, premissas: { meses: 12 } })), atualizadoEm: serverTimestamp() });
  await assertSucceeds(setDoc(doc(db('f1'), 'tenants/t1/inv_cenarios/f1'), cen()));
  await assertSucceeds(getDoc(doc(db('f1'), 'tenants/t1/inv_cenarios/f1')));
  await assertFails(getDoc(doc(db('d1'), 'tenants/t1/inv_cenarios/f1')));
  await assertFails(getDoc(doc(db('sa'), 'tenants/t1/inv_cenarios/f1')));
  await assertFails(getDoc(doc(db('d2'), 'tenants/t1/inv_cenarios/f1')));
  await assertFails(setDoc(doc(db('d1'), 'tenants/t1/inv_cenarios/f1'), cen()));
  await assertFails(setDoc(doc(db('f1'), 'tenants/t1/inv_cenarios/f1'), cen(21)));
  await assertFails(setDoc(doc(db('f1'), 'tenants/t1/inv_cenarios/f1'), Object.assign(cen(), { carteira: 'x' })));
  await assertSucceeds(deleteDoc(doc(db('f1'), 'tenants/t1/inv_cenarios/f1')));
});

// ---------- Segurança das chaves de IA do CRM (correção S1/S2, 26/11/2026) ----------
test('Chaves de IA: ninguém grava chave no banco (nem Diretor, nem Super Admin, nem restauração); sem chave grava normalmente', async () => {
  const cam = 'tenants/t2/dados/eagles_ia_config_v1';
  const comChave = { valor: { modo: 'empresa', provedor: 'openai', modelos: { openai: 'm' }, chaves: { openai: 'sk-TESTE-FICTICIA' } } };
  const semChave = { valor: { modo: 'empresa', provedor: 'openai', modelos: { openai: 'm' } } };
  await assertFails(setDoc(doc(db('d2'), cam), comChave));
  await assertFails(setDoc(doc(db('sa'), cam), comChave));                                   // restauração pelo Super Admin também
  await assertFails(setDoc(doc(db('d2'), cam), { valor: { modo: 'navegador', chaves: { gemini: 'AIzaTESTE' } } }));
  await assertSucceeds(setDoc(doc(db('d2'), cam), semChave));
  await assertSucceeds(setDoc(doc(db('d2'), cam), { valor: { modo: 'navegador', provedor: '', modelos: {}, chaves: {} } })); // vazio é permitido
  await assertSucceeds(setDoc(doc(db('sa'), cam), semChave));
});
test('Chaves de IA: documento antigo COM chave fica escondido da equipe até o Diretor limpar', async () => {
  const cam = 'tenants/t1/dados/eagles_ia_config_v1';
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), cam), { valor: { modo: 'empresa', provedor: 'openai', modelos: {}, chaves: { openai: 'sk-TESTE-FICTICIA' } } }); });
  await assertFails(getDoc(doc(db('a1'), cam)));      // Administrativo
  await assertFails(getDoc(doc(db('f1'), cam)));      // Financeiro
  await assertFails(getDoc(doc(db('d2'), cam)));      // outra empresa
  await assertSucceeds(getDoc(doc(db('d1'), cam)));   // Diretor (limpa ao abrir)
  await assertSucceeds(getDoc(doc(db('sa'), cam)));   // Super Admin (backup)
  await assertSucceeds(setDoc(doc(db('d1'), cam), { valor: { modo: 'empresa', provedor: 'openai', modelos: {} } })); // limpeza
  await assertSucceeds(getDoc(doc(db('a1'), cam)));   // depois da limpeza a equipe volta a ler provedor e modelo
  await assertSucceeds(getDoc(doc(db('f1'), cam)));
  await assertSucceeds(getDoc(doc(db('a1'), 'tenants/t1/dados/nao_existe_ainda')));
});
