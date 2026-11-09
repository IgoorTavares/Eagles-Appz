// =====================================================================
// Base dos testes de concorrência: abre o sistema DE VERDADE (crm.html +
// script.js do repositório) em vários navegadores, cada um logado como uma
// pessoa diferente, todos ligados ao SIMULADOR do Firebase (Firestore + Auth)
// com o firestore.rules real. Nada aqui fala com o Firebase de produção:
// o firebase-config.js é trocado por um que aponta para 127.0.0.1.
//
// "Versão antiga": o mesmo crm.html com o script.js da v155 (commit a340d03),
// para provar o problema antes da correção e testar a convivência das
// versões durante a troca.
// =====================================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, '..');
export const PROJETO = 'demo-eagles';
const FS_HOST = '127.0.0.1:8080';
const AUTH_HOST = '127.0.0.1:9099';
export const COMMIT_ANTIGO = 'a340d03'; // v155, antes da correção
const NM = join(AQUI, 'node_modules');

// ---------- arquivos trocados no navegador ----------
// Cada navegador fala com o simulador por um endereço local próprio
// (127.0.0.10, 127.0.0.11...): o Chromium abre no máximo 6 conexões por
// endereço, e 20+ pessoas no mesmo endereço ficariam em fila (não é assim
// na vida real, onde cada pessoa está no próprio computador).
const configTeste = (ip = '127.0.0.1') => `
const FIREBASE_CONFIG = { apiKey: 'chave-de-teste', authDomain: '${PROJETO}.firebaseapp.com', projectId: '${PROJETO}', appId: 'teste' };
firebase.initializeApp(FIREBASE_CONFIG);
firebase.auth().useEmulator('http://${ip}:9099', { disableWarnings: true });
firebase.firestore().useEmulator('${ip}', 8080);
`;
let PROX_IP = 10;
const CDN = {
  'firebase-app-compat.js': join(NM, 'firebase/firebase-app-compat.js'),
  'firebase-auth-compat.js': join(NM, 'firebase/firebase-auth-compat.js'),
  'firebase-firestore-compat.js': join(NM, 'firebase/firebase-firestore-compat.js'),
  'firebase-functions-compat.js': join(NM, 'firebase/firebase-functions-compat.js'),
  'chart.umd.min.js': join(NM, 'chart.js/dist/chart.umd.js'),
  'html2canvas.min.js': join(NM, 'html2canvas/dist/html2canvas.min.js'),
  'jspdf.umd.min.js': join(NM, 'jspdf/dist/jspdf.umd.min.js'),
  'qrcode.min.js': join(NM, 'qrcode-generator/qrcode.js'),
};
let SCRIPT_ANTIGO = null;
export function scriptAntigo() {
  if (SCRIPT_ANTIGO === null) SCRIPT_ANTIGO = execFileSync('git', ['show', COMMIT_ANTIGO + ':script.js'], { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 }).toString();
  return SCRIPT_ANTIGO;
}

// ---------- página leve ----------
// O CRM inteiro (crm.html) abre ~70 escutas do banco por aba; o simulador do
// Firebase roda num núcleo só e não aguenta 20+ abas assim (as escutas param
// de responder — limite do simulador, não do Firebase de verdade). Para 20,
// 30 e 50 pessoas usamos esta página: o MESMO script.js, o login real
// (resolverTenantDoUsuario) e as MESMAS funções de início das partes testadas
// (crmNegocioIniciarSubcolecoes e portalIniciarDados), sem o resto do CRM.
// Os campos da tela de anotação/contato são os mesmos ids do crm.html.
const PAGINA_LEVE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="crm-detalhe-corpo"></div>
<textarea id="nova-anotacao-negocio"></textarea>
<div id="crm-form-novo-contato"><input id="contato-negocio-nome"><input id="contato-negocio-cargo"><input id="contato-negocio-email"><input id="contato-negocio-telefone"></div>
<script src="/__cdn/firebase-app-compat.js"></script><script src="/__cdn/firebase-auth-compat.js"></script><script src="/__cdn/firebase-firestore-compat.js"></script>
<script src="/firebase-config.js"></script><script src="/script.js"></script>
<script>
window.__AVISOS = []; window.__LINKS = [];
avisar = (m, t) => { window.__AVISOS.push(String(t || '') + ': ' + String(m)); };
avisarSemPermissaoNivel = (o) => { window.__AVISOS.push('sem-permissao: ' + (o || '')); };
confirmarAcao = (m, cb) => { cb(); };
linkCompartilhar = (o) => { window.__LINKS.push(o.link); };
window.__GANCHO = true;
initFirebase();
firebase.auth().onAuthStateChanged(async (u) => {
  if (!u || !(await resolverTenantDoUsuario(u))) return;
  // ?desligado=1: o aparelho fica sem internet ANTES de ligar as escutas (abre com o banco vazio no aparelho)
  if (/desligado=1/.test(location.search)) {
    await firestoreDb.disableNetwork();
    // o teste tira a rede do navegador e então manda seguir
    await new Promise((seguir) => { window.__SEGUIR = seguir; window.__ESPERANDO = true; });
  }
  if (typeof crmNegocioIniciarSubcolecoes === 'function') crmNegocioIniciarSubcolecoes();
  else { // v155 (as mesmas duas linhas que ficavam dentro do início do CRM)
    cloudWatch(CRM_NEGOCIO_CONTATOS_KEY, [], (data) => { CRM_NEGOCIO_CONTATOS_DATA = data; CRM_NEGOCIO_SUBCOLECOES_CARREGADAS = true; });
    cloudWatch(CRM_NEGOCIO_ANOTACOES_KEY, [], (data) => { CRM_NEGOCIO_ANOTACOES_DATA = data; });
  }
  if (nivelPodeOperar()) portalIniciarDados();
  window.__PRONTO = true;
});
</script></body></html>`;

// ---------- servidor local só com os arquivos do site ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function subirServidor() {
  return new Promise((ok) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/__vazio.html') {
        res.writeHead(200, { 'content-type': TIPOS['.html'] });
        res.end(`<!doctype html><meta charset="utf-8"><script src="/__cdn/firebase-app-compat.js"></script><script src="/__cdn/firebase-auth-compat.js"></script><script src="/__cdn/firebase-firestore-compat.js"></script><script src="/firebase-config.js"></script>`);
        return;
      }
      if (u.pathname === '/__leve.html') { res.writeHead(200, { 'content-type': TIPOS['.html'] }); res.end(PAGINA_LEVE); return; }
      if (u.pathname.startsWith('/__cdn/')) { const f = CDN[u.pathname.slice(7)]; res.writeHead(200, { 'content-type': TIPOS['.js'] }); res.end(readFileSync(f)); return; }
      if (u.pathname === '/firebase-config.js') { res.writeHead(200, { 'content-type': TIPOS['.js'] }); res.end(configTeste()); return; }
      if (u.pathname === '/sw.js') { res.writeHead(404); res.end(); return; } // sem service worker nos testes
      const caminho = join(RAIZ, decodeURIComponent(u.pathname));
      if (!caminho.startsWith(RAIZ) || !existsSync(caminho) || statSync(caminho).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TIPOS[extname(caminho)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(caminho));
    });
    srv.listen(0, '127.0.0.1', () => ok({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

// ---------- banco (com as regras desligadas, só para preparar e conferir) ----------
let ENV = null;
export async function banco() {
  if (!ENV) ENV = await initializeTestEnvironment({ projectId: PROJETO, firestore: { rules: readFileSync(join(RAIZ, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
  return ENV;
}
export async function comoAdmin(fn) { const env = await banco(); let r; await env.withSecurityRulesDisabled(async (ctx) => { r = await fn(ctx.firestore()); }); return r; }
export const gravar = (caminho, dados) => comoAdmin((f) => setDoc(doc(f, caminho), dados));
export const ler = (caminho) => comoAdmin(async (f) => { const s = await getDoc(doc(f, caminho)); return s.exists() ? s.data() : null; });
export const listar = (caminho) => comoAdmin(async (f) => (await getDocs(collection(f, caminho))).docs.map((d) => Object.assign({ id: d.id }, d.data())));
export const apagar = (caminho) => comoAdmin((f) => deleteDoc(doc(f, caminho)));
export async function trocarRegras(texto) { const env = await banco(); await env.withSecurityRulesDisabled(async () => {}); await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJETO}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: texto }] } }) }); }
export const regrasReais = () => readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');

export async function zerarTudo() {
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJETO}/accounts`, { method: 'DELETE' });
}

// empresa com um negócio; cada pessoa é um login no Auth simulado + usuarios/{uid}
export async function criarEmpresa(tenantId, plano = 'ambos') {
  await gravar(`tenants/${tenantId}`, { nomeEmpresa: 'Empresa ' + tenantId, plano, ativo: true, limiteUsuarios: 100 });
  await gravar(`tenants/${tenantId}/crm_negocios/n1`, { nome: 'Negócio de teste', etapa: 'lead', valor: 1000, cliente: 'Seven', _pos: 1 });
  await gravar(`tenants/${tenantId}/crm_clientes/c1`, { nome: 'Seven', _pos: 1 });
}
export async function criarPessoa(tenantId, nome, role = 'Administrativo') {
  const email = `${nome.toLowerCase().replace(/[^a-z0-9]/g, '')}.${tenantId}@teste.local`;
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-de-teste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-de-teste-123', returnSecureToken: true }) });
  const j = await r.json();
  if (!j.localId) throw new Error('Auth simulado: ' + JSON.stringify(j));
  await gravar(`usuarios/${j.localId}`, { tenantId, role, nome });
  return { uid: j.localId, email, nome, role, tenantId };
}

// ---------- navegadores ----------
let NAV = null;
export async function navegador() { if (!NAV) NAV = await chromium.launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=256'] }); return NAV; }
export async function fecharTudo() { if (NAV) { await NAV.close(); NAV = null; } if (ENV) { await ENV.cleanup(); ENV = null; } }

// Abre o crm.html logado como "pessoa". versao: 'nova' (script.js do disco) ou 'antiga' (v155).
export async function abrirPessoa(base, pessoa, { versao = 'nova', pagina = 'crm.html' } = {}) {
  const nav = await navegador();
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 800 } });
  const erros = [];
  // (o Playwright usa a rota registrada por ÚLTIMO primeiro: a geral vem antes)
  await ctx.route(/^https?:\/\/(?!127\.)/, (rota) => rota.fulfill({ status: 200, body: '' })); // nada sai para a internet
  await ctx.route(/^https:\/\/(www\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, (rota) => {
    const nomeArq = rota.request().url().split('/').pop().split('?')[0];
    const f = CDN[nomeArq];
    if (!f) return rota.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    return rota.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(f) });
  });
  const ip = '127.0.' + Math.floor(PROX_IP / 250) + '.' + (PROX_IP % 250 + 2); PROX_IP++;
  await ctx.route(base + '/firebase-config.js', (rota) => rota.fulfill({ status: 200, contentType: 'text/javascript', body: configTeste(ip) }));
  if (versao === 'antiga') await ctx.route(base + '/script.js', (rota) => rota.fulfill({ status: 200, contentType: 'text/javascript', body: scriptAntigo() }));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__AVISOS = []; window.__LINKS = [];
    window.addEventListener('DOMContentLoaded', () => {
      if (typeof avisar !== 'function' || window.__GANCHO) return; window.__GANCHO = true;
      const a = avisar; avisar = function (m, t) { window.__AVISOS.push(String(t || '') + ': ' + String(m)); return a.apply(this, arguments); };
      const l = linkCompartilhar; linkCompartilhar = function (o) { window.__LINKS.push(o && o.link); return l.apply(this, arguments); };
    });
  });
  page.on('pageerror', (e) => erros.push(String(e && e.message || e)));
  const consoleErros = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErros.push(m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => { if (process.env.DEPURAR) console.error('[falhou]', r.url().slice(0, 120), r.failure() && r.failure().errorText); });
  for (let tentativa = 1; ; tentativa++) {
    try {
      await page.goto(base + '/__vazio.html');
      await page.evaluate(({ email }) => firebase.auth().signInWithEmailAndPassword(email, 'senha-de-teste-123'), { email: pessoa.email });
      break;
    } catch (e) { console.error('[login falhou]', ip, pessoa.email, tentativa); if (tentativa >= 4) throw e; await pausa(500 * tentativa); }
  }
  await page.goto(base + '/' + pagina);
  return { ctx, page, erros, consoleErros, pessoa, versao, ip };
}

// espera até as chaves estarem carregadas da nuvem nesta página
// abre várias pessoas, poucas por vez (abrir 50 sistemas no mesmo segundo
// sobrecarrega o simulador; o teste de "ao mesmo tempo" é o de gravar)
export async function abrirVarias(base, pessoas, opcoes = {}, porVez = 5) {
  const abertas = [];
  for (let i = 0; i < pessoas.length; i += porVez) {
    const grupo = await Promise.all(pessoas.slice(i, i + porVez).map((p, j) => abrirPessoa(base, p, typeof opcoes === 'function' ? opcoes(i + j) : opcoes)));
    abertas.push(...grupo);
  }
  return abertas;
}

export async function esperarCarregado(p, chaves, ms = 60000) {
  await p.page.waitForFunction((cs) => typeof CLOUD_ESTADO_CHAVES !== 'undefined' && typeof TENANT_ID !== 'undefined' && TENANT_ID && cs.every((k) => CLOUD_ESTADO_CHAVES[k] === 'carregado'), chaves, { timeout: ms, polling: 100 });
}

// todos os navegadores executam "acao" no mesmo instante (relógio do computador)
export async function aoMesmoTempo(pessoas, acao, arg = (i) => i, folgaMs = 1500) {
  const quando = Date.now() + folgaMs + pessoas.length * 40;
  return Promise.all(pessoas.map((p, i) => p.page.evaluate(async ({ quando, corpo, a }) => {
    while (Date.now() < quando) await new Promise((r) => setTimeout(r, 2));
    return (0, eval)('(' + corpo + ')')(a);
  }, { quando, corpo: acao.toString(), a: arg(i) })));
}

// sem internet DE VERDADE: o navegador sem rede (o disableNetwork do Firebase
// sozinho não bloqueia transações) + o Firebase sabendo que está sem rede
export async function semInternet(p) { await p.ctx.setOffline(true); await p.page.evaluate(() => firestoreDb.disableNetwork()); }
export async function comInternet(p) { await p.ctx.setOffline(false); await p.page.evaluate(() => firestoreDb.enableNetwork()); }

export async function esperar(cond, ms = 30000, passo = 200) {
  const fim = Date.now() + ms;
  for (;;) { const v = await cond(); if (v) return v; if (Date.now() > fim) return v; await new Promise((r) => setTimeout(r, passo)); }
}
export const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
