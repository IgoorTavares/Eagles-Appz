#!/usr/bin/env node
// LABZ AI — I2: ensaio do "Verify JWT" do Supabase com a labz-api de verdade, SÓ NO SUPABASE LOCAL.
// Serve a mesma função duas vezes (Verify JWT LIGADO e DESLIGADO) e manda os mesmos pedidos que a tela
// manda (pré-voo do navegador + POST com o login do Firebase), para ver QUEM responde: o gateway do
// Supabase (antes do código) ou o código da LABZ AI.
// NADA de projeto real: tokens do Firebase FICTÍCIOS (chave gerada na hora), banco local.
//
// Antes:  supabase start   (na pasta functions-labz)
// Rodar:  SUPABASE_CLI=supabase node supabase/ensaiar-i2-verify-jwt.mjs
// Atrás de um proxy que reassina o TLS (sandbox): LABZ_TESTE_CA=/caminho/ca.crt
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = process.env.SUPABASE_CLI || 'supabase';
const { emitir } = require('../test/ajuda-token');
const ORIGEM = 'https://eagleslabz.com.br';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const conferir = (cond, nome, extra = '') => { console.log(`${cond ? 'ok  ' : 'FALHOU'} ${nome}${extra ? ` — ${extra}` : ''}`); if (!cond) falhas++; };

const status = JSON.parse(execFileSync(CLI, ['status', '-o', 'json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const FUNCS = status.FUNCTIONS_URL || `${status.API_URL}/functions/v1`;
// chave "anon" do Supabase LOCAL (um JWT do Supabase, com o papel anon). As versões novas do CLI não a mostram no
// status: aí ela é assinada aqui com o segredo de DEMONSTRAÇÃO do banco local (o mesmo de toda instalação local).
function anonLocal() {
  if (status.ANON_KEY) return status.ANON_KEY;
  const env = execFileSync('docker', ['inspect', 'supabase_db_labz-local', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' });
  const segredo = (/^JWT_SECRET=(.+)$/m.exec(env) || [])[1];
  if (!segredo) throw new Error('não achei o segredo de JWT do Supabase local');
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iss: 'supabase-demo', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${corpo}.${crypto.createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}
const ANON = anonLocal();

// Uma cópia temporária da pasta supabase/ (config + funções), só com o Verify JWT da labz-api trocado:
// o arquivo do repositório não muda.
function pastaComVerify(ligado) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `labz-vjwt-${ligado ? 'on' : 'off'}-`));
  fs.mkdirSync(path.join(dir, 'supabase'));
  const cfg = fs.readFileSync(path.join(RAIZ, 'supabase', 'config.toml'), 'utf8').replace(/\[functions\.labz-api\]\nverify_jwt = (true|false)/, `[functions.labz-api]\nverify_jwt = ${ligado}`);
  if (!cfg.includes(`[functions.labz-api]\nverify_jwt = ${ligado}`)) throw new Error('config.toml: não achei o verify_jwt da labz-api');
  fs.writeFileSync(path.join(dir, 'supabase', 'config.toml'), cfg);
  fs.cpSync(path.join(RAIZ, 'supabase', 'functions'), path.join(dir, 'supabase', 'functions'), { recursive: true, filter: (s) => !/node_modules/.test(s) });
  const ca = process.env.LABZ_TESTE_CA ? path.join(dir, 'supabase', 'functions', '.labz-teste-ca.crt') : null;
  if (ca) fs.copyFileSync(process.env.LABZ_TESTE_CA, ca);
  const env = path.join(dir, 'funcoes.env');
  fs.writeFileSync(env, [
    ...(ca ? [`DENO_CERT=${ca}`] : []), // o CLI monta a pasta das funções no mesmo caminho
    'LABZ_DB_URL=postgresql://ninguem:ficticia@db:5432/postgres', // as recusas acontecem ANTES de qualquer acesso ao banco
    'LABZ_SUPERADMIN_UIDS=sa', 'LABZ_FIREBASE_PROJETO=labz-18246', `LABZ_ORIGENS=${ORIGEM}`, 'LABZ_WORKER_SEGREDO=ficticio-ficticio-ficticio-ficticio-00', '',
  ].join('\n'), { mode: 0o600 });
  return { dir, env };
}

async function http(url, opcoes = {}) {
  const r = await fetch(url, opcoes);
  const texto = await r.text();
  return { status: r.status, texto, headers: r.headers, doCodigo: /"ok":false|"erro":\{/.test(texto) };
}

async function rodada(ligado) {
  const { dir, env } = pastaComVerify(ligado);
  const p = spawn(CLI, ['functions', 'serve', '--env-file', env], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  try {
    // "subiu" = o CÓDIGO da função respondeu a um pedido com a chave pública do Supabase local (que o gateway aceita)
    let subiu = false;
    let ultima = null;
    for (let i = 0; i < 150 && !subiu; i++) { try { ultima = await http(`${FUNCS}/labz-api`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ANON}`, origin: ORIGEM }, body: '{"acao":"catalogo.agentes"}' }); subiu = ultima.doCodigo; } catch (e) { /* subindo */ } if (!subiu) await espera(1000); }
    conferir(subiu, `[Verify JWT ${ligado ? 'LIGADO' : 'DESLIGADO'}] a labz-api sobe no Edge Runtime local`, ultima ? `última resposta ${ultima.status} ${ultima.texto.slice(0, 80)}` : '');
    if (!subiu) { console.log(log.split('\n').filter((l) => /error|Error|JWT|jwt/.test(l)).slice(-15).join('\n')); return {}; }
    const firebase = emitir({ sub: 'sa' }); // ID token no FORMATO do Firebase (RS256, chave fictícia)
    const pedidos = {
      preVoo: () => http(`${FUNCS}/labz-api`, { method: 'OPTIONS', headers: { origin: ORIGEM, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } }),
      loginFirebase: () => http(`${FUNCS}/labz-api`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${firebase}`, origin: ORIGEM }, body: '{"acao":"catalogo.agentes"}' }),
      semLogin: () => http(`${FUNCS}/labz-api`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM }, body: '{"acao":"catalogo.agentes"}' }),
      chavePublicaSupabase: () => http(`${FUNCS}/labz-api`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ANON}`, origin: ORIGEM }, body: '{"acao":"catalogo.agentes"}' }),
    };
    const r = {};
    for (const [k, f] of Object.entries(pedidos)) { r[k] = await f(); console.log(`     ${k}: ${r[k].status} ${r[k].doCodigo ? '(respondido pelo CÓDIGO da LABZ AI)' : '(respondido pelo GATEWAY do Supabase)'} ${r[k].texto.slice(0, 90).replace(/\s+/g, ' ')}`); }
    return r;
  } finally {
    p.kill('SIGTERM');
    await espera(3000);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  console.log('Verify JWT LIGADO (como está hoje na produção):');
  const on = await rodada(true);
  console.log('Verify JWT DESLIGADO (opção A):');
  const off = await rodada(false);
  if (on.loginFirebase) {
    conferir(on.loginFirebase.status === 401 && !on.loginFirebase.doCodigo, 'LIGADO: o login do Firebase é barrado pelo GATEWAY (o código nem roda) → a tela não funciona assim');
    console.log(`     (ambiente local) pré-voo com Verify JWT ligado: ${on.preVoo.status}, allow-origin=${on.preVoo.headers.get('access-control-allow-origin')}`);
    conferir(on.chavePublicaSupabase.status === 401 && on.chavePublicaSupabase.doCodigo, 'LIGADO: com a chave PÚBLICA do Supabase o gateway deixa passar e quem recusa é o código (o gateway não protege de verdade)');
  }
  if (off.loginFirebase) {
    // O Kong do Supabase LOCAL responde o pré-voo sozinho (com "*"); na produção quem responde é o código
    // (Etapa 9: OPTIONS 204 só para o site; outra origem → 403). Aqui só registramos o que o local faz.
    console.log(`     (ambiente local) pré-voo respondido por ${off.preVoo.doCodigo ? 'código' : 'Kong local'}: ${off.preVoo.status}, allow-origin=${off.preVoo.headers.get('access-control-allow-origin')}`);
    conferir(off.loginFirebase.doCodigo && off.loginFirebase.status === 401, 'DESLIGADO: o login do Firebase chega ao código, que confere a assinatura com as chaves do Google (aqui a chave é fictícia → 401)');
    conferir(off.semLogin.doCodigo && off.semLogin.status === 401, 'DESLIGADO: sem login → 401 do código');
    conferir(off.chavePublicaSupabase.doCodigo && off.chavePublicaSupabase.status === 401, 'DESLIGADO: a chave pública do Supabase não serve de login → 401 do código');
  }
  console.log(falhas ? `\n${falhas} conferência(s) falharam` : '\nEnsaio do Verify JWT: todas as conferências passaram');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('erro no ensaio:', e); process.exit(1); });
