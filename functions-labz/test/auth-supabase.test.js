// Fase S2 (Supabase): verificação do Firebase ID Token SEM credencial e a autorização completa.
// As chaves RSA são geradas na hora (nenhuma chave fica guardada em arquivo).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { criarVerificadorFirebase, criarChavesGoogle } = require('../src/auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../src/auth/acesso-supabase');
const { criarApi } = require('../src/api/labz-api');
const { montar, rejeita } = require('./ajuda');

const PROJETO = 'labz-18246';
const AGORA = 1_800_000_000;
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const chave = par();
const outra = par();
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });

function emitir(carga = {}, { cab = {}, priv = chave.privateKey, alg = 'RS256' } = {}) {
  const h = Object.assign({ alg, kid: 'k1', typ: 'JWT' }, cab);
  const c = Object.assign({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'sa', iat: AGORA - 60, auth_time: AGORA - 120, exp: AGORA + 3000, email: 'sa@teste.local', email_verified: true, firebase: { sign_in_provider: 'password' } }, carga);
  const corpo = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
  const ass = alg === 'none' ? '' : alg === 'HS256' ? b64url(crypto.createHmac('sha256', 'segredo-qualquer').update(corpo).digest()) : b64url(crypto.createSign('RSA-SHA256').update(corpo).sign(priv));
  return `${corpo}.${ass}`;
}
const verificador = (extra = {}) => criarVerificadorFirebase(Object.assign({ projetoId: PROJETO, obterChaves: async () => ({ k1: pem(chave) }), agoraSeg: () => AGORA }, extra));
const motivo = async (p) => { try { await p; return 'passou'; } catch (e) { assert.equal(e.codigo, 'nao-autenticado'); return e.motivo; } };

test('token válido: devolve só o necessário (uid, e-mail, provedor, validade)', async () => {
  const t = await verificador()(emitir());
  assert.deepEqual(t, { uid: 'sa', email: 'sa@teste.local', emailVerificado: true, provedor: 'password', emitidoEm: AGORA - 60, expiraEm: AGORA + 3000 });
  assert.ok(Object.isFrozen(t));
});

test('tokens inválidos, expirados, adulterados e de outros projetos são recusados (cada um pelo motivo certo)', async () => {
  const v = verificador();
  const casos = {
    expirado: emitir({ exp: AGORA - 31 }),
    'emitido-no-futuro': emitir({ iat: AGORA + 120 }),
    'login-no-futuro': emitir({ auth_time: AGORA + 120 }),
    audiencia: emitir({ aud: 'outro-projeto' }), // token de OUTRO projeto do Firebase
    emissor: emitir({ iss: 'https://securetoken.google.com/outro-projeto' }),
    usuario: emitir({ sub: '' }),
    'login-anonimo': emitir({ firebase: { sign_in_provider: 'anonymous' } }),
    assinatura: emitir({}, { priv: outra.privateKey }), // assinado com outra chave
    algoritmo: emitir({}, { alg: 'HS256' }),
    'chave-desconhecida': emitir({}, { cab: { kid: 'kX' } }),
    'sem-kid': emitir({}, { cab: { kid: '' } }),
  };
  for (const [esperado, token] of Object.entries(casos)) assert.equal(await motivo(v(token)), esperado, esperado);
  // alg "none" (sem assinatura)
  assert.equal(await motivo(v(emitir({}, { alg: 'none' }))), 'formato');
  // carga adulterada depois de assinada (troca o uid): a assinatura não confere mais
  const [h, , a] = emitir().split('.');
  const falsa = `${h}.${b64url(JSON.stringify({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'outro-uid', iat: AGORA, auth_time: AGORA, exp: AGORA + 3000 }))}.${a}`;
  assert.equal(await motivo(v(falsa)), 'assinatura');
  for (const lixo of ['', 'abc', 'a.b', 'a.b.c.d', 'x'.repeat(5000), null, 123, '!!.@@.##']) assert.equal(await motivo(v(lixo)), 'formato', String(lixo).slice(0, 10));
  // folga pequena para relógios desalinhados (30 s), não mais
  assert.equal(await motivo(v(emitir({ exp: AGORA - 10 }))), 'passou');
});

test('chaves do Google: cache pelo max-age, renova quando aparece um kid novo e falha FECHADA', async () => {
  let chamadas = 0;
  let agoraMs = 0;
  let conjunto = { k1: pem(chave) };
  const buscar = async () => { chamadas++; return { ok: true, headers: { get: () => 'public, max-age=600' }, json: async () => conjunto }; };
  const obter = criarChavesGoogle({ buscar, agoraMs: () => agoraMs });
  await obter(); await obter();
  assert.equal(chamadas, 1, 'usa o cache');
  agoraMs += 601 * 1000; await obter();
  assert.equal(chamadas, 2, 'renova depois do max-age');
  // o Google trocou as chaves: um token com kid novo força a renovação uma vez
  const v = criarVerificadorFirebase({ projetoId: PROJETO, obterChaves: obter, agoraSeg: () => AGORA });
  conjunto = { k2: pem(outra) };
  const t = await v(emitir({}, { cab: { kid: 'k2' }, priv: outra.privateKey }));
  assert.equal(t.uid, 'sa');
  assert.equal(chamadas, 3);
  // sem rede (ou resposta de erro): ninguém entra
  const semRede = criarChavesGoogle({ buscar: async () => { throw new Error('sem rede'); } });
  assert.equal(await motivo(semRede()), 'chaves-indisponiveis');
  const erro500 = criarChavesGoogle({ buscar: async () => ({ ok: false }) });
  assert.equal(await motivo(erro500()), 'chaves-indisponiveis');
});

async function montarSupabase() {
  const c = await montar();
  // no Supabase o perfil vem do banco DA LABZ AI (não de usuarios/ do CRM)
  await c.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await c.banco.gravar('labz_usuarios/d1', { role: 'Diretor', nome: 'Diretor' });
  let lidos = [];
  const banco = Object.assign({}, c.banco, { obter: (p) => { lidos.push(p); return c.banco.obter(p); } });
  const api = criarApi(Object.assign({ servicos: c, banco, uidsAutorizados: () => 'sa,d1', lerSegredo: () => '' }, opcoesApiSupabase(banco)));
  const autenticar = criarAcessoSupabase({ verificador: verificador(), auditoria: c.auditoria });
  const chamar = async (token, acao = 'catalogo.agentes', dados = {}) => api({ auth: await autenticar(`Bearer ${token}`), data: { acao, dados } }).then((r) => r.resultado);
  return Object.assign(c, { chamar, autenticar, lidos: () => lidos, zerarLidos: () => { lidos = []; } });
}

test('autorização completa: token válido + lista do servidor + perfil no banco da LABZ AI + lista do banco', async () => {
  const c = await montarSupabase();
  assert.equal((await c.chamar(emitir())).length, 8, 'Super Admin autorizado usa a API');
  await rejeita(() => c.chamar(emitir({ sub: 'd1', email: 'd1@teste.local' })), 'permissao-negada'); // Diretor: perfil não é SuperAdmin
  await rejeita(() => c.chamar(emitir({ sub: 'intruso' })), 'permissao-negada'); // sem perfil e fora da lista
  await rejeita(() => c.chamar(emitir({ aud: 'outro-projeto' })), 'nao-autenticado'); // token de outro projeto
  await rejeita(() => c.autenticar('Basic abc'), 'nao-autenticado');
  await rejeita(() => c.autenticar(undefined), 'nao-autenticado');
  // "botão de desligar": tirar o UID da lista do banco corta NA HORA, mesmo com o token ainda válido
  await c.banco.gravar('labz_config/acesso', { uids: [] });
  await rejeita(() => c.chamar(emitir()), 'permissao-negada');
  const negados = await c.auditoria.listarPagina({ tipo: 'auth.acesso_negado', limite: 20 });
  assert.ok(negados.itens.some((e) => e.detalhes && e.detalhes.motivo === 'fora-da-lista-do-banco'));
  const recusados = await c.auditoria.listarPagina({ tipo: 'auth.token_recusado', limite: 20 });
  assert.ok(recusados.itens.length >= 1 && recusados.itens.every((e) => !JSON.stringify(e).includes('eyJ')), 'a auditoria não guarda o token');
});

test('a autenticação NÃO dá acesso ao CRM/ERP: não lê usuarios/ nem tentativas_login, e não carrega o Firebase Admin', async () => {
  const c = await montarSupabase();
  c.zerarLidos();
  await c.chamar(emitir());
  assert.ok(!c.lidos().some((p) => /^(usuarios|tentativas_login|tenants)\//.test(p)), `nada do Eagles Labz é lido: ${c.lidos().join(', ')}`);
  assert.ok(c.lidos().includes('labz_usuarios/sa') && c.lidos().includes('labz_config/acesso'));
  // num processo limpo: carregar a autenticação do Supabase não carrega firebase-admin nem firebase-functions
  const raiz = path.join(__dirname, '..');
  const r = spawnSync(process.execPath, ['-e', `require('./src/auth/acesso-supabase'); require('./src/auth/token-firebase'); require('./src/api/labz-api');
    const m = Object.keys(require.cache).filter((k) => /node_modules[\\\\/](firebase-admin|firebase-functions|@google-cloud)/.test(k)); console.log(JSON.stringify(m));`], { cwd: raiz, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), []);
});

test('Firebase de hoje continua igual: sem as opções do Supabase, o perfil vem de usuarios/ e o bloqueio por senha vale', async () => {
  const c = await montar();
  const api = criarApi({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const ok = await api({ auth: { uid: 'sa', token: { email: 'sa@teste.local' } }, data: { acao: 'catalogo.agentes', dados: {} } });
  assert.equal(ok.resultado.length, 8);
  await c.banco.gravar('tentativas_login/sa@teste.local', { falhas: 5 });
  await rejeita(() => api({ auth: { uid: 'sa', token: { email: 'sa@teste.local' } }, data: { acao: 'catalogo.agentes', dados: {} } }), 'permissao-negada');
});
