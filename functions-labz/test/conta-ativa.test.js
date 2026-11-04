// Proteção extra: conta DESATIVADA e sessão REVOGADA no Firebase (src/auth/conta-ativa.js).
// Ambiente ISOLADO: o Identity Toolkit é um FALSO (nenhuma chamada sai deste processo); tokens fictícios.
const test = require('node:test');
const assert = require('node:assert');
const { criarConferidorConta, comConferenciaDeConta, URL_LOOKUP } = require('../src/auth/conta-ativa');
const { montarComEmpresas } = require('./ajuda');
const { PROJETO, emitir, obterChaves } = require('./ajuda-token');
const { criarApi } = require('../src/api/labz-api');
const { criarVerificadorFirebase } = require('../src/auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../src/auth/acesso-supabase');
const { criarLimitador } = require('../src/borda/limitador');
const { criarHandlerApi } = require('../src/borda/http');

const CHAVE_PUBLICA = 'chave-publica-ficticia-de-teste-0000'; // fictícia (o detector de segredos barra o formato real)
const ORIGEM = 'https://eagleslabz.com.br';

// Identity Toolkit FALSO: contas = { uid: { disabled, validSince } }; modo: 'ok' | 'fora' | 'lento' | 'erro500'
function googleFalso(contas, modo = { atual: 'ok' }) {
  const chamadas = [];
  const buscar = async (url, op) => {
    chamadas.push({ url, corpo: JSON.parse(op.body) });
    if (modo.atual === 'fora') throw new Error('rede');
    if (modo.atual === 'lento') return new Promise((ok, falhou) => { op.signal.addEventListener('abort', () => falhou(new Error('abortado'))); });
    if (modo.atual === 'erro500') return { ok: false, status: 503, json: async () => ({ error: { message: 'BACKEND_ERROR' } }) };
    const carga = JSON.parse(Buffer.from(JSON.parse(op.body).idToken.split('.')[1], 'base64url').toString());
    const c = contas[carga.sub];
    if (!c) return { ok: false, status: 400, json: async () => ({ error: { message: 'USER_NOT_FOUND' } }) };
    if (c.disabled && c.comoErro) return { ok: false, status: 400, json: async () => ({ error: { message: 'USER_DISABLED' } }) };
    return { ok: true, status: 200, json: async () => ({ users: [{ localId: c.localId || carga.sub, disabled: !!c.disabled, validSince: String(c.validSince || 0) }] }) };
  };
  return { buscar, chamadas };
}
const motivo = async (p) => { try { await p; return 'passou'; } catch (e) { assert.equal(e.codigo, 'nao-autenticado'); return e.motivo; } };
const agora = () => Math.floor(Date.now() / 1000);

test('conta ativa: passa; desativada (pelo campo ou pelo erro), sessão revogada, conta sumida e UID trocado → recusa, cada um pelo motivo certo', async () => {
  const t0 = agora();
  const g = googleFalso({ sa: {}, des: { disabled: true }, desErro: { disabled: true, comoErro: true }, rev: { validSince: t0 - 10 }, trocado: { localId: 'outro' } });
  const conferir = criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, cacheMs: 0 });
  const tk = (sub, authTime = t0 - 120) => emitir({ sub, auth_time: authTime });
  assert.equal(await motivo(conferir(tk('sa'), { uid: 'sa', loginEm: t0 - 120 })), 'passou');
  assert.equal(await motivo(conferir(tk('des'), { uid: 'des', loginEm: t0 - 120 })), 'conta-desativada');
  assert.equal(await motivo(conferir(tk('desErro'), { uid: 'desErro', loginEm: t0 - 120 })), 'conta-desativada');
  assert.equal(await motivo(conferir(tk('rev'), { uid: 'rev', loginEm: t0 - 120 })), 'sessao-revogada', 'login ANTES da revogação');
  assert.equal(await motivo(conferir(tk('rev', t0), { uid: 'rev', loginEm: t0 })), 'passou', 'login DEPOIS da revogação vale');
  assert.equal(await motivo(conferir(tk('sumiu'), { uid: 'sumiu', loginEm: t0 })), 'sessao-invalida');
  assert.equal(await motivo(conferir(tk('trocado'), { uid: 'trocado', loginEm: t0 })), 'conta-diferente');
  // a consulta vai para o endereço oficial, com a apiKey pública e o PRÓPRIO token da pessoa (nada de credencial de administrador)
  assert.ok(g.chamadas.every((c) => c.url === `${URL_LOOKUP}?key=${CHAVE_PUBLICA}` && Object.keys(c.corpo).join() === 'idToken'));
});

test('falha FECHADA: Google fora do ar, lento (tempo-limite) ou com erro 5xx → ninguém entra (e a opção aberta existe só por decisão explícita)', async () => {
  const modo = { atual: 'fora' };
  const g = googleFalso({ sa: {} }, modo);
  const fechada = criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, cacheMs: 0, tempoMs: 50 });
  const tk = emitir({ sub: 'sa' });
  for (const m of ['fora', 'lento', 'erro500']) { modo.atual = m; assert.equal(await motivo(fechada(tk, { uid: 'sa', loginEm: agora() - 60 })), 'conta-indisponivel', m); }
  const aberta = criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, cacheMs: 0, tempoMs: 50, falhaFechada: false });
  modo.atual = 'fora';
  assert.deepEqual(await aberta(tk, { uid: 'sa', loginEm: agora() - 60 }), { indisponivel: true });
});

test('custo e latência: o resultado BOM fica guardado por token (1 consulta a cada 5 min); o ruim nunca fica guardado; o guardado vence', async () => {
  let ms = 1_000_000;
  const contas = { sa: {} };
  const g = googleFalso(contas);
  const conferir = criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, agoraMs: () => ms });
  const tk = emitir({ sub: 'sa' });
  const ctx = { uid: 'sa', loginEm: agora() - 60 };
  for (let i = 0; i < 50; i++) await conferir(tk, ctx);
  assert.equal(g.chamadas.length, 1, '50 pedidos seguidos = 1 consulta');
  ms += 5 * 60 * 1000 + 1;
  contas.sa.disabled = true; // desativada no meio do caminho
  assert.equal(await motivo(conferir(tk, ctx)), 'conta-desativada', 'depois de 5 min, consulta de novo e vê a desativação');
  assert.equal(await motivo(conferir(tk, ctx)), 'conta-desativada', 'recusa não fica guardada como boa');
  assert.equal(g.chamadas.length, 3);
  assert.throws(() => criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, cacheMs: 60 * 60 * 1000 }), /15 minutos/);
  assert.throws(() => criarConferidorConta({ apiKey: 'curta', buscar: g.buscar }), /apiKey/);
});

test('na porta HTTP: só quem está na lista do servidor gera consulta ao Google; conta desativada do Super Admin → 401 e o banco não muda', async () => {
  const c = await montarComEmpresas({});
  await c.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  const contas = { sa: {} };
  const g = googleFalso(contas);
  const recusas = [];
  const verificador = criarVerificadorFirebase({ projetoId: PROJETO, obterChaves });
  const uidPermitido = (u) => u === 'sa';
  const autenticar = comConferenciaDeConta(criarAcessoSupabase({ verificador }), { conferirConta: criarConferidorConta({ apiKey: CHAVE_PUBLICA, buscar: g.buscar, cacheMs: 0 }), uidPermitido, aoRecusar: (r) => recusas.push(r) });
  const api = criarApi(Object.assign({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' }, opcoesApiSupabase(c.banco)));
  const handler = criarHandlerApi({ api, autenticar, limitador: criarLimitador({ banco: c.banco, limites: { porMinuto: 1000, tarefasPorHora: 1000 } }), uidPermitido, origens: [ORIGEM] });
  const pedir = async (tk) => (await handler(new Request('http://localhost/functions/v1/labz-api', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM, authorization: `Bearer ${tk}` }, body: '{"acao":"catalogo.agentes"}' }))).status;
  assert.equal(await pedir(emitir({ sub: 'sa' })), 200);
  assert.equal(g.chamadas.length, 1);
  for (let i = 0; i < 20; i++) assert.equal(await pedir(emitir({ sub: `intruso${i}` })), 403);
  assert.equal(g.chamadas.length, 1, 'intrusos (fora da lista do servidor) não geram NENHUMA consulta ao Google');
  const caminhos = () => (c.banco._caminhosAsync ? c.banco._caminhosAsync() : c.banco._caminhos());
  const antes = JSON.stringify(await caminhos());
  contas.sa.disabled = true;
  assert.equal(await pedir(emitir({ sub: 'sa' })), 401, 'conta desativada: recusada com o token ainda válido');
  assert.equal(JSON.stringify(await caminhos()), antes, 'a recusa não grava nada');
  assert.deepEqual(recusas, [{ motivo: 'conta-desativada' }], 'só o motivo vai para o log (nada de token, e-mail ou UID)');
});

test('isolamento do repositório: a proteção NÃO está ligada na labz-api publicada (o pacote das Edge Functions não muda)', () => {
  const { gerar } = require('../supabase/empacotar');
  const g = gerar();
  assert.ok(!g.nomes.includes('src/auth/conta-ativa.js'), 'o módulo não entra no pacote enquanto não for ligado (com autorização)');
  const fs = require('node:fs');
  const path = require('node:path');
  const api = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'labz-api', 'index.ts'), 'utf8');
  assert.doesNotMatch(api, /conta-ativa|identitytoolkit|LABZ_FIREBASE_API_KEY/);
});
