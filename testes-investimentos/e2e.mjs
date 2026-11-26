// Testes de ponta a ponta da Biblioteca de Ativos (Etapa 05) — navegador real (Playwright) + SIMULADOR do Firebase
// (login e banco locais; nada fala com produção). Login de verdade pelo login.html.
// Uso (dentro de "firebase emulators:exec --only firestore,auth"):
//   INV_NM=<pasta node_modules com playwright, firebase, chart.js...> node testes-investimentos/e2e.mjs <raiz> <pasta-saida>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

const [RAIZ, SAIDA] = process.argv.slice(2);
const NM = process.env.INV_NM; const req = createRequire(join(NM, 'x.js'));
const { chromium } = req('playwright');
const CT = createRequire(import.meta.url)('../inv/inv-carteira.js'); // a mesma conta da tela, para preparar dados de teste
mkdirSync(join(SAIDA, 'capturas'), { recursive: true });
const PROJ = 'demo-eagles'; const FS = 'http://127.0.0.1:8080'; const AUTH = 'http://127.0.0.1:9099';
const CDN = { 'firebase-app-compat.js': 'firebase/firebase-app-compat.js', 'firebase-auth-compat.js': 'firebase/firebase-auth-compat.js', 'firebase-firestore-compat.js': 'firebase/firebase-firestore-compat.js', 'firebase-functions-compat.js': 'firebase/firebase-functions-compat.js', 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'qrcode.min.js': 'qrcode-generator/qrcode.js' };
const CONFIG = `const FIREBASE_CONFIG={apiKey:'chave-de-teste',authDomain:'${PROJ}.firebaseapp.com',projectId:'${PROJ}',appId:'teste'};firebase.initializeApp(FIREBASE_CONFIG);firebase.auth().useEmulator('http://127.0.0.1:9099');firebase.firestore().useEmulator('127.0.0.1',8080);`;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const TEMAS = ['padrao-claro', 'padrao-escuro', 'midnight', 'amoled', 'black-blue', 'black-green', 'black-purple', 'emerald', 'ocean', 'purple-rain', 'personalizado', 'monocromatico', 'rosa-claro', 'azul-claro'];

// ---------- banco do simulador (REST com "owner": só para preparar os dados) ----------
const val = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
const gravar = (cam, dados) => fetch(`${FS}/v1/projects/${PROJ}/databases/(default)/documents/${cam}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, val(v)])) }) });
const lerDoc = async (cam) => { const r = await fetch(`${FS}/v1/projects/${PROJ}/databases/(default)/documents/${cam}`, { headers: { authorization: 'Bearer owner' } }); return r.ok ? r.json() : null; };
const apagar = (cam) => fetch(`${FS}/v1/projects/${PROJ}/databases/(default)/documents/${cam}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
async function zerar() { await fetch(`${FS}/emulator/v1/projects/${PROJ}/databases/(default)/documents`, { method: 'DELETE' }); await fetch(`${AUTH}/emulator/v1/projects/${PROJ}/accounts`, { method: 'DELETE' }); }
async function regras() { await fetch(`${FS}/emulator/v1/projects/${PROJ}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: readFileSync(join(RAIZ, 'firestore.rules'), 'utf8') }] } }) }); }
async function pessoa(tenantId, nome, role) {
  const email = `${nome.toLowerCase().replace(/[^a-z0-9]/g, '')}@teste.local`;
  const j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-de-teste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-de-teste-123', returnSecureToken: true }) })).json();
  await gravar(`usuarios/${j.localId}`, Object.assign({ role, nome }, tenantId ? { tenantId } : {}));
  return { uid: j.localId, email, nome, role, tenantId };
}
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- servidor local ----------
function servir() {
  return new Promise((ok) => {
    const srv = createServer((rq, rs) => {
      const u = new URL(rq.url, 'http://x');
      if (u.pathname === '/firebase-config.js') { rs.writeHead(200, { 'content-type': TIPOS['.js'] }); return rs.end(CONFIG); }
      if (u.pathname === '/sw.js') { rs.writeHead(404); return rs.end(); }
      // os testes usam o catálogo de TESTE (fictício, estável); o publicado é o real (05.1), testado à parte
      // Etapa 10: o site publicado só tem o catálogo de PRODUÇÃO (vazio até confirmar as licenças) e nenhuma notícia de teste;
      // os testes de tela usam o catálogo fictício e o feed fictício, servidos daqui (nunca vão para o site)
      const f = process.env.CATALOGO !== 'producao' && u.pathname.startsWith('/inv/catalogo/') ? join(RAIZ, 'testes-investimentos/catalogo-teste', u.pathname.slice('/inv/catalogo/'.length))
        : u.pathname === '/inv/noticias-teste.xml' ? join(RAIZ, 'testes-investimentos/noticias-teste.xml') : join(RAIZ, decodeURIComponent(u.pathname));
      if (!f.startsWith(RAIZ) || !existsSync(f) || statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); }
      rs.writeHead(200, { 'content-type': TIPOS[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); rs.end(readFileSync(f));
    });
    srv.listen(0, '127.0.0.1', () => ok({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}
let nav, BASE; const externas = [];
async function contexto(largura = 1366, tema) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.)/, (r) => { externas.push(r.request().url()); return r.fulfill({ status: 200, body: '' }); });
  await ctx.route(/^https:\/\/(www\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, (r) => {
    const n = r.request().url().split('/').pop().split('?')[0]; const f = CDN[n];
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: f ? readFileSync(join(NM, f)) : '' });
  });
  // o lembrete de backup do sistema (para o Diretor sem backup recente) cobre a tela: aqui ele já foi "visto", como faria quem o fechou
  await ctx.addInitScript(() => { try { sessionStorage.setItem('eagles_backup_lembrete_visto', '1'); } catch (e) {} });
  if (tema) await ctx.addInitScript((t) => { localStorage.setItem('eagles_aparencia_sistema_v1', JSON.stringify({ tema: t, corPersonalizada: '#c2410c' })); }, tema);
  return ctx;
}
async function entrar(ctx, p, destino) {
  const page = await ctx.newPage(); page._erros = [];
  page.on('pageerror', (e) => page._erros.push(String(e.message || e).slice(0, 200)));
  page.on('crash', () => page._erros.push('PÁGINA TRAVOU (crash)')); page.on('close', () => { page._fechou = new Error('fechou').stack; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Service ?Worker|sw\.js|bad HTTP response code \(404\)/i.test(m.text())) page._erros.push('console: ' + m.text().slice(0, 200) + (/403/.test(m.text()) ? ' @' + ((m.location() || {}).url || '').replace(/\?.*/, '') : '')); });
  page.on('dialog', (d) => (page._dialogo ? d.accept(page._dialogo) : d.dismiss()));
  await page.goto(BASE + '/login.html');
  await page.fill('#login-email', p.email); await page.fill('#login-senha', 'senha-de-teste-123'); await page.click('#btn-login');
  await page.waitForURL((u) => !/login\.html/.test(String(u)), { timeout: 30000 });
  if (destino) await abrir(page, destino);
  return page;
}
async function abrir(page, destino) {
  if (destino === 'investimentos.html') destino += '#/biblioteca'; // desde a Etapa 08 a página abre na Visão geral
  const antes = page.url().split('#')[0];
  await page.goto(BASE + '/' + destino);
  if (page.url().split('#')[0] === antes) await page.reload(); // só o "#" mudou: o navegador não recarrega sozinho
  await page.waitForFunction(() => window.INVEST && window.INVEST.estado && window.INVEST.estado.acesso && (window.INVEST.estado.acesso.ok === false || window.INVEST.estado.estadoCat !== 'carregando'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
}
const texto = (page) => page.evaluate(() => (document.getElementById('inv-conteudo') || document.querySelector('main') || document.body).innerText);
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('#topbar-nav a, #topbar-nav button')].map((e) => e.textContent.trim()).join('/'));

const R = []; const ok = (c, m) => { if (!c) throw new Error(m); };
const SO = process.env.CASOS ? process.env.CASOS.split(',').map(Number) : null;
async function caso(n, nome, fn) { if (SO && !SO.includes(n)) return; try { await fn(); R.push([n, nome, 'PASSOU', '']); } catch (e) { R.push([n, nome, 'FALHOU', String(e.message || e).slice(0, 1500) + ((String(e.stack || '').match(/e2e\.mjs:\d+/) || [''])[0] ? ' (linha ' + String(e.stack).match(/e2e\.mjs:(\d+)/)[1] + ')' : '')]); } }
const foto = (page, nome, cheia = true) => page.screenshot({ path: join(SAIDA, 'capturas', nome + '.png'), fullPage: cheia });

(async () => {
  await zerar(); await regras();
  await gravar('tenants/t-inv', { nomeEmpresa: 'Empresa com Investimentos', plano: 'ambos', ativo: true, limiteUsuarios: 50, modulos: { investimentos: true } });
  await gravar('tenants/t-off', { nomeEmpresa: 'Empresa sem o módulo', plano: 'erp', ativo: true, limiteUsuarios: 50 });
  await gravar('tenants/t-crm', { nomeEmpresa: 'Empresa só CRM', plano: 'crm', ativo: true, limiteUsuarios: 50, modulos: { investimentos: true } });
  const P = {
    dir: await pessoa('t-inv', 'Diretora Inv', 'Diretor'), fin: await pessoa('t-inv', 'Financeiro Inv', 'Financeiro'),
    adm: await pessoa('t-inv', 'Adm Inv', 'Administrativo'), off: await pessoa('t-off', 'Diretor Off', 'Diretor'),
    crm: await pessoa('t-crm', 'Diretor Crm', 'Diretor'), sa: await pessoa(null, 'Super Admin', 'SuperAdmin'),
  };
  const { srv, base } = await servir(); BASE = base;
  nav = await chromium.launch(); nav.on('disconnected', () => console.log('NAVEGADOR DESCONECTOU'));
  const medidas = {};

  await caso(1, 'Diretor: menu Financeiro ▾ Investimentos e Biblioteca carregada, sem erro de JavaScript', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'index.html');
    const m = await menu(p); ok(/Financeiro.*Investimentos/.test(m), 'menu: ' + m);
    await abrir(p, 'investimentos.html');
    const t = await texto(p);
    ok(/Biblioteca de ativos/.test(t) && /18 ativos no catálogo/.test(t), 'título/contagem: ' + t.slice(0, 120) + ' | estado: ' + JSON.stringify(await p.evaluate(() => window.INVEST ? { acesso: window.INVEST.estado && window.INVEST.estado.acesso, cat: window.INVEST.estado && window.INVEST.estado.estadoCat, modulos: typeof TENANT_MODULOS !== 'undefined' ? TENANT_MODULOS : 'x', html: (document.getElementById('inv-conteudo')||{}).innerHTML } : 'sem INV')) + ' | erros: ' + p._erros.join(' | '));
    ok(/DADOS DE TESTE/.test(await p.innerText('#inv-avisos')), 'faixa de dados de teste ausente');
    ok((await p.locator('.inv-linha').count()) === 16, 'esperava 16 ativos (cancelado escondido): ' + (await p.locator('.inv-linha').count()));
    ok(await p.locator('.inv-aba.active', { hasText: 'Biblioteca' }).count() === 1, 'aba ativa');
    ok((await p.locator('.inv-aba-off').count()) === 0 && /Projeções/.test(await p.innerText('#inv-abas')), 'todas as abas ligadas desde a Etapa 09 (Projeções inclusive)');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await foto(p, '01-biblioteca-desktop-claro');
    await ctx.close();
  });

  await caso(2, 'Pesquisa por código, nome sem acento, CNPJ e filtros (país, bolsa, classe, setor)', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html');
    const linhas = async () => p.$$eval('.inv-linha', (l) => l.map((x) => x.dataset.id));
    await p.fill('#inv-busca', 'zzta'); await p.waitForTimeout(450);
    let l = await linhas(); ok(l[0] === 'BR:B3:ZZTA3' && l[1] === 'BR:B3:ZZTA4' && l.length === 2, 'zzta: ' + l);
    await p.fill('#inv-busca', 'logistica'); await p.waitForTimeout(450);
    l = await linhas(); ok(l.length === 1 && l[0] === 'BR:B3:ZZTL11', 'logistica: ' + l);
    await p.fill('#inv-busca', ''); await p.waitForTimeout(450);
    await p.selectOption('[data-filtro="classe"]', 'tesouro'); await p.waitForTimeout(200);
    l = await linhas(); ok(l.length === 4 && l.every((x) => x.startsWith('BR:TESOURO:')), 'tesouro: ' + l);
    await p.click('#inv-limpar'); await p.selectOption('[data-filtro="pais"]', 'US'); await p.waitForTimeout(200);
    l = await linhas(); ok(l.length === 5 && l.every((x) => x.startsWith('US:')), 'US: ' + l);
    await p.selectOption('[data-filtro="bolsa"]', 'NYSE'); await p.waitForTimeout(200);
    l = await linhas(); ok(l.length === 3, 'NYSE: ' + l);
    await p.click('#inv-limpar'); await p.selectOption('[data-filtro="setor"]', 'Bancos'); await p.waitForTimeout(200);
    l = await linhas(); ok(l.length === 1 && l[0] === 'BR:B3:ZZTB11', 'Bancos: ' + l);
    await p.click('#inv-limpar'); await p.check('#inv-inativos'); await p.waitForTimeout(200);
    ok((await linhas()).includes('BR:B3:ZZTC3'), 'cancelado aparece ao marcar');
    await p.click('#inv-limpar'); await p.fill('#inv-busca', 'xyz-nada'); await p.waitForTimeout(450);
    ok(/Nenhum ativo encontrado/.test(await texto(p)), 'estado vazio');
    await ctx.close();
  });

  await caso(3, 'Página do ativo: identificação, fonte, cotação INDISPONÍVEL por padrão (sem simulador), links autorizados, FII com código não confirmado; ativo inexistente', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html');
    await p.locator('.inv-linha[data-id="BR:B3:ZZTA3"]').click(); await p.waitForTimeout(300);
    const t = await texto(p);
    ok(/BR:B3:ZZTA3/.test(t) && /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(t), 'identificação/CNPJ');
    ok(/Indisponível/.test(t) && /Nenhum preço é mostrado sem uma fonte autorizada/.test(t), 'cotação indisponível por padrão (simulador desligado — auditoria)');
    ok(/CVM — Dados Abertos/.test(t), 'fonte');
    const links = await p.$$eval('.inv-links a', (a) => a.map((x) => [x.href, x.target, x.rel]));
    ok(links.length >= 3 && links.every(([h, t2, r]) => h.startsWith('https://') && t2 === '_blank' && /noopener/.test(r)), 'links: ' + JSON.stringify(links));
    await foto(p, '02-ativo-desktop-claro');
    await p.goto(BASE + '/investimentos.html#/ativo/BR%3AB3%3AZZFAKE3'); await p.waitForTimeout(700);
    ok(/Este ativo não está no catálogo/.test(await texto(p)), 'inexistente');
    await p.goto(BASE + '/investimentos.html#/ativo/BR%3AB3%3AZZTL11'); await p.waitForTimeout(700);
    ok(/Código não confirmado/.test(await texto(p)) && /a partir do ISIN/.test(await texto(p)), 'aviso de código não confirmado (FII, 05.1)');
    await ctx.close();
  });

  await caso(4, 'Favoritos: favoritar, persistir no banco, listas e remover', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html');
    await p.click('[data-fav="BR:B3:ZZTA3"]'); await p.waitForTimeout(700);
    const doc = await lerDoc(`tenants/t-inv/inv_favoritos/${P.dir.uid}`);
    ok(doc && JSON.stringify(doc).includes('BR:B3:ZZTA3'), 'não gravou no banco');
    await abrir(p, 'investimentos.html#/favoritos');
    ok(/ZZTA3/.test(await texto(p)), 'favorito não aparece depois de recarregar');
    p._dialogo = 'Exterior'; await p.click('#inv-nova-lista'); await p.waitForTimeout(700); p._dialogo = null;
    ok(/Exterior/.test(await texto(p)), 'lista nova');
    await p.click('[data-lista-sel="principal"]'); await p.waitForTimeout(500);
    await foto(p, '03-favoritos-desktop-claro');
    await p.click('[data-tirar="BR:B3:ZZTA3"]'); await p.waitForTimeout(700);
    const d2 = await lerDoc(`tenants/t-inv/inv_favoritos/${P.dir.uid}`);
    ok(!JSON.stringify(d2).includes('BR:B3:ZZTA3'), 'não removeu');
    // de volta para a próxima prova
    await abrir(p, 'investimentos.html'); await p.click('[data-fav="BR:B3:ZZTA3"]'); await p.waitForTimeout(700);
    await ctx.close();
  });

  await caso(5, 'Isolamento: o Financeiro não vê os favoritos da Diretora; empresa sem o módulo não vê nada; plano só CRM bloqueado', async () => {
    let ctx = await contexto(); let p = await entrar(ctx, P.fin, 'investimentos.html#/favoritos');
    ok(!/ZZTA3/.test(await texto(p)) && /Lista vazia/.test(await texto(p)), 'Financeiro viu favorito de outra pessoa');
    const ler = await p.evaluate(async (uid) => { try { await firestoreDb.doc(`tenants/t-inv/inv_favoritos/${uid}`).get(); return 'leu'; } catch (e) { return e.code; } }, P.dir.uid);
    ok(ler === 'permission-denied', 'leitura direta dos favoritos de outra pessoa: ' + ler);
    await ctx.close();
    ctx = await contexto(); p = await entrar(ctx, P.off, 'index.html');
    ok(!/Investimentos/.test(await menu(p)), 'menu de empresa sem o módulo mudou');
    await abrir(p, 'investimentos.html');
    ok(/não está habilitado para a sua empresa/.test(await texto(p)), 'sem módulo: ' + (await texto(p)).slice(0, 120));
    const ler2 = await p.evaluate(async () => { try { await firestoreDb.doc('tenants/t-inv/inv_favoritos/x').get(); return 'leu'; } catch (e) { return e.code; } });
    ok(ler2 === 'permission-denied', 'outra empresa leu: ' + ler2);
    await ctx.close();
    ctx = await contexto(); p = await entrar(ctx, P.crm, 'investimentos.html'); await p.waitForTimeout(500);
    ok(/Não incluído no seu plano/.test(await p.innerText('main')), 'plano CRM deveria bloquear');
    await ctx.close();
  });

  await caso(6, 'Permissões: Administrativo só entra com a liberação do Diretor; Super Admin habilita empresas e não tem favoritos', async () => {
    let ctx = await contexto(); let pa = await entrar(ctx, P.adm, 'investimentos.html');
    ok(/acesso a Investimentos ainda não foi liberado/.test(await texto(pa)), 'adm sem liberação');
    const ctxD = await contexto(); const pd = await entrar(ctxD, P.dir, 'investimentos.html#/config'); await pd.waitForTimeout(1200);
    ok(/Acesso da equipe/.test(await texto(pd)) && /Adm Inv/.test(await texto(pd)), 'tela de equipe');
    await pd.click(`[data-liberar="${P.adm.uid}"]`); await pd.waitForTimeout(1200);
    ok(/Liberado/.test(await texto(pd)), 'não liberou');
    await foto(pd, '04-configuracoes-diretor');
    await abrir(pa, 'investimentos.html');
    ok(/Biblioteca de ativos/.test(await texto(pa)), 'adm liberado não entrou');
    await pa.click('[data-fav="BR:B3:ZZTG3"]'); await pa.waitForTimeout(700);
    ok(JSON.stringify(await lerDoc(`tenants/t-inv/inv_favoritos/${P.adm.uid}`)).includes('ZZTG3'), 'adm liberado não favoritou');
    await pd.click(`[data-liberar="${P.adm.uid}"]`); await pd.waitForTimeout(1200);
    await abrir(pa, 'investimentos.html');
    ok(/ainda não foi liberado/.test(await texto(pa)), 'retirar acesso não funcionou');
    await ctx.close(); await ctxD.close();
    ctx = await contexto(); const ps = await entrar(ctx, P.sa, 'investimentos.html#/config'); await ps.waitForTimeout(1500);
    ok(/Empresa sem o módulo/.test(await texto(ps)), 'SA: lista de empresas');
    await foto(ps, '05-administracao-super-admin');
    await ps.click('[data-modulo="t-off"]'); await ps.waitForTimeout(1200);
    const t = await lerDoc('tenants/t-off'); ok(JSON.stringify(t).includes('investimentos'), 'SA não habilitou');
    await abrir(ps, 'investimentos.html#/favoritos');
    ok(/Favoritos indisponíveis/.test(await texto(ps)), 'SA não deve ter favoritos');
    const ler = await ps.evaluate(async (uid) => { try { await firestoreDb.doc(`tenants/t-inv/inv_favoritos/${uid}`).get(); return 'leu'; } catch (e) { return e.code; } }, P.dir.uid);
    ok(ler === 'permission-denied', 'SA leu favoritos privados: ' + ler);
    await ctx.close();
    ctx = await contexto(); const po = await entrar(ctx, P.off, 'index.html');
    ok(/Financeiro.*Investimentos/.test(await menu(po)), 'depois de habilitada, a empresa vê o item');
    await ctx.close();
  });

  await caso(7, 'Falha da fonte: catálogo fora do ar mostra erro com "Tentar de novo" e recupera', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir);
    await p.route('**/inv/catalogo/meta.json', (r) => r.fulfill({ status: 503, body: '' }));
    await abrir(p, 'investimentos.html');
    ok(/Catálogo indisponível no momento/.test(await texto(p)), 'erro: ' + (await texto(p)).slice(0, 100));
    await foto(p, '06-falha-da-fonte', false);
    await p.unroute('**/inv/catalogo/meta.json');
    await p.click('#inv-tentar'); await p.waitForTimeout(800);
    ok(/18 ativos no catálogo/.test(await texto(p)), 'não recuperou');
    await p.route('**/inv/catalogo/ativos.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"formato":"outro","itens":[1]}' }));
    await abrir(p, 'investimentos.html');
    ok(/formato inválido/.test(await texto(p)), 'catálogo corrompido deveria ser recusado');
    await ctx.close();
  });

  await caso(8, 'Consumo (D-03): aviso em 70%, modo econômico no limite, só o essencial continua; soma global enviada', async () => {
    await gravar(`inv_admin_uso/${hoje()}`, { leituras: 10600, gravacoes: 0, exclusoes: 0 });
    let ctx = await contexto(); let p = await entrar(ctx, P.dir, 'investimentos.html');
    ok(/Atenção ao consumo/.test(await p.innerText('#inv-avisos')), 'aviso de 70% para o Diretor');
    await ctx.close();
    ctx = await contexto(); p = await entrar(ctx, P.fin, 'investimentos.html');
    ok(!/Atenção ao consumo/.test(await p.innerText('#inv-avisos')), 'o aviso de 70% é só para quem administra');
    await ctx.close();
    await gravar(`inv_admin_uso/${hoje()}`, { leituras: 15000, gravacoes: 10, exclusoes: 0 });
    ctx = await contexto(); p = await entrar(ctx, P.dir, 'investimentos.html');
    ok(/Modo econômico/.test(await p.innerText('#inv-avisos')), 'faixa do modo econômico');
    await p.click('[data-fav="BR:B3:ZZTG3"]'); await p.waitForTimeout(700); // salvar favorito é essencial
    ok(JSON.stringify(await lerDoc(`tenants/t-inv/inv_favoritos/${P.dir.uid}`)).includes('ZZTG3'), 'favorito (essencial) foi bloqueado');
    await abrir(p, 'investimentos.html#/config'); await p.waitForTimeout(1000);
    ok(/Pausado pelo limite de uso do dia/.test(await texto(p)), 'listar equipe (não essencial) deveria pausar');
    await foto(p, '07-modo-economico');
    await ctx.close();
    await gravar(`inv_admin_uso/${hoje()}`, { leituras: 0, gravacoes: 0, exclusoes: 0 });
    ctx = await contexto(); p = await entrar(ctx, P.dir, 'investimentos.html');
    await p.click('[data-fav="BR:B3:ZZTB11"]'); await p.waitForTimeout(700);
    medidas.sessaoDiretor = await p.evaluate(() => ({ ...window.INVEST.medidor.pendente(), ops: window.INVEST.medidor.ops }));
    await p.evaluate(() => window.INVEST.enviarConsumo()); await p.waitForTimeout(800);
    const u = await lerDoc(`inv_admin_uso/${hoje()}`); const n = (k) => +((u.fields[k] || {}).integerValue || 0);
    ok(n('leituras') === medidas.sessaoDiretor.leituras + 3 && n('gravacoes') === medidas.sessaoDiretor.gravacoes + 1, 'soma global: ' + JSON.stringify(u.fields)); // +3 e +1: o próprio envio
    await ctx.close();
  });

  await caso(9, 'Teclado e acessibilidade: abas com aria-current, linha abre com Enter, estrela com aria-pressed', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html');
    ok(await p.getAttribute('.inv-aba.active', 'aria-current') === 'page', 'aria-current');
    ok(/Adicionar aos favoritos|Remover dos favoritos/.test(await p.getAttribute('[data-fav="BR:B3:ZZTA4"]', 'aria-label')), 'aria-label da estrela');
    await p.focus('.inv-linha[data-id="BR:B3:ZZTA4"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    ok(/BR:B3:ZZTA4/.test(await texto(p)), 'Enter não abriu');
    await ctx.close();
  });

  await caso(10, 'Responsivo: sem rolagem para o lado em 1440, 1024, 768, 430, 390, 360 e 320 px', async () => {
    const falhas = [];
    for (const w of [1440, 1024, 768, 430, 390, 360, 320]) {
      const ctx = await contexto(w); const p = await entrar(ctx, P.dir);
      for (const d of ['investimentos.html', 'investimentos.html#/ativo/BR%3ATESOURO%3AIPCAJ-2097', 'investimentos.html#/favoritos', 'investimentos.html#/config', 'investimentos.html#/visao', 'investimentos.html#/carteira', 'investimentos.html#/br', 'investimentos.html#/us', 'investimentos.html#/noticias', 'investimentos.html#/projecoes', 'investimentos.html#/ativo/BR%3AINDICE%3AIBOV']) {
        await abrir(p, d); await p.waitForTimeout(900);
        const sw = await p.evaluate(() => document.documentElement.scrollWidth); if (sw > w) falhas.push(`${w}/${d}=${sw}`);
      }
      if (w === 390) { await abrir(p, 'investimentos.html'); await foto(p, '08-biblioteca-celular-390'); await abrir(p, 'investimentos.html#/ativo/BR%3AB3%3AZZTA3'); await foto(p, '09-ativo-celular-390'); }
      await ctx.close();
    }
    ok(!falhas.length, falhas.join(', '));
  });

  await caso(11, 'Os 14 temas do sistema: telas desenhadas, contraste do texto e capturas', async () => {
    const lum = (rgb) => { const c = rgb.match(/[\d.]+/g).slice(0, 3).map((x) => +x / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const problemas = []; medidas.contraste = {};
    for (const tema of TEMAS) {
      const ctx = await contexto(1366, tema); const p = await entrar(ctx, P.dir, 'investimentos.html#/ativo/BR%3AB3%3AZZTX34');
      const cores = await p.evaluate(() => {
        const fundo = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(\d+, \d+, \d+, 0\)|transparent|\/ 0\)$/.test(c)) return c; el = el.parentElement; } return getComputedStyle(document.body).backgroundColor; };
        // converte qualquer formato de cor (rgb, color(srgb …), color-mix) para rgb pelo próprio navegador
        const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const rgb = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
        const par = (sel) => { const el = document.querySelector(sel); return el ? [rgb(getComputedStyle(el).color), rgb(fundo(el))] : null; };
        return { titulo: par('#inv-conteudo h1'), corpo: par('.inv-tec strong'), sobe: par('.inv-cot-topo .inv-sobe, .inv-tec .inv-sobe'), desce: par('.inv-tec .inv-desce, .inv-cot-topo .inv-desce'), valor: par('.inv-cot-preco'), muda: par('.inv-muda'), badge: par('.badge-blue'), aba: par('.inv-aba.active'), estado: par('.inv-estado'), link: par('.inv-links a'), tema: document.documentElement.getAttribute('data-theme') };
      });
      const r = {}; for (const [k, v] of Object.entries(cores)) { if (Array.isArray(v)) r[k] = +contraste(v[0], v[1]).toFixed(2); }
      medidas.contraste[tema] = r;
      for (const [k, v] of Object.entries(r)) if (v < (['muda', 'estado'].includes(k) ? 3 : 4.5)) problemas.push(`${tema}/${k}=${v}`);
      if (p._erros.length) problemas.push(`${tema}: erro JS ${p._erros[0]}`);
      await abrir(p, 'investimentos.html#/br'); await p.waitForTimeout(600); await foto(p, `10-tema-${tema}`, false);
      await ctx.close();
    }
    medidas.problemasContraste = problemas;
    ok(!problemas.filter((x) => /erro JS/.test(x)).length, problemas.join(', '));
  });


  // ======================= Etapas 06–08 =======================
  await caso(13, 'Mercado BR e US: índices, gráfico (períodos, comparação), rankings, mapa, radar, fontes; simulado sempre marcado; sem simulador = indisponível', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html#/br'); await p.waitForTimeout(1200);
    let t = await texto(p);
    ok(/Cotações indisponíveis/.test(t) && !/Números SIMULADOS/.test(t) && !(await p.isChecked('#inv-simulador')), 'por padrão nada simulado (auditoria): ' + t.slice(0, 200));
    await p.click('#inv-simulador'); await p.waitForTimeout(900); t = await texto(p);
    ok(/Mercado Brasil/.test(t) && /Números SIMULADOS/.test(t) && /Ibovespa/.test(t) && /Taxa Selic/.test(t), 'tela BR no modo demonstração: ' + t.slice(0, 300));
    ok((await p.locator('canvas').count()) >= 2, 'gráficos');
    ok(/Maiores altas/.test(t) && /Mapa de calor/.test(t) && /Radar/.test(t) && /Fontes de dados/.test(t), 'blocos');
    ok(/Desligado/.test(t) && /D-06/.test(t), 'provedores desligados com o motivo');
    await p.click('[data-periodo="1A"]'); await p.waitForTimeout(300);
    ok(/25[0-9] pregões|26[0-9] pregões/.test(await p.innerText('[data-rodape]')), 'período 1A: ' + await p.innerText('[data-rodape]'));
    await p.fill('[data-comparar]', 'IFIX'); await p.dispatchEvent('[data-comparar]', 'change'); await p.waitForTimeout(300);
    ok(await p.locator('[data-tirar-comp]').count() === 1, 'comparação não entrou');
    await p.click('[data-rank-classe="fii"]'); await p.waitForTimeout(400);
    ok(/ZZTL11/.test(await texto(p)), 'ranking de FIIs');
    await foto(p, '20-mercado-br');
    await abrir(p, 'investimentos.html#/us'); await p.waitForTimeout(900); t = await texto(p);
    ok(/Mercado Estados Unidos/.test(t) && /S&P 500/.test(t) && /Treasury 10 anos/.test(t) && /Ativos de TESTE/.test(t), 'tela US');
    await foto(p, '21-mercado-us');
    await abrir(p, 'investimentos.html#/ativo/BR%3AINDICE%3AIBOV'); await p.waitForTimeout(700);
    ok(/Ibovespa/.test(await texto(p)) && (await p.locator('canvas').count()) >= 1, 'página do índice');
    await abrir(p, 'investimentos.html#/ativo/BR%3AB3%3AZZTA3'); await p.waitForTimeout(700); t = await texto(p);
    ok(/SIMULADO/.test(t) && /IFR \(14\)/.test(t) && /Retorno 1A/.test(t), 'ativo com gráfico e indicadores (demonstração)');
    await foto(p, '22-ativo-grafico');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  const lancarUi = async (p, campos) => {
    await p.click('#inv-ct-lancar'); await p.waitForSelector('#inv-modal.open');
    await p.selectOption('#inv-modal [name=tipo]', campos.tipo);
    for (const [k, v] of Object.entries(campos)) if (k !== 'tipo') await p.fill(`#inv-modal [name=${k}]`, String(v));
    await p.click('#inv-modal [type=submit]'); await p.waitForTimeout(900);
  };
  const kpi = (p, rot) => p.evaluate((r) => { const k = [...document.querySelectorAll('.inv-kpi')].find((x) => x.querySelector('span').textContent.trim() === r); return k ? k.querySelector('strong').textContent.trim() : null; }, rot);

  await caso(14, 'Minha carteira pela tela: criar, aporte, compra, venda, estorno auditável; venda maior que a posição recusada; carteira pessoal invisível para a Diretora', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.fin, 'investimentos.html#/carteira'); await p.waitForTimeout(900);
    ok(/Nenhuma carteira ainda/.test(await texto(p)), 'começa vazia');
    await p.click('#inv-ct-nova2'); await p.fill('#inv-modal [name=nome]', 'Reserva do Fin'); await p.click('#inv-modal [type=submit]'); await p.waitForTimeout(1200);
    ok(/Reserva do Fin/.test(await texto(p)), 'carteira criada');
    await lancarUi(p, { tipo: 'aporte', data: '2026-01-05', valor: '10000' });
    await lancarUi(p, { tipo: 'compra', data: '2026-01-06', ativo: 'ZZTA3', qtd: '100', preco: '10', taxas: '5' });
    await lancarUi(p, { tipo: 'venda', data: '2026-02-02', ativo: 'ZZTA3', qtd: '500', preco: '12' });
    ok(/venda maior que a quantidade/i.test(await p.innerText('#inv-modal')), 'venda maior deveria ser recusada: ' + await p.innerText('#inv-modal'));
    await p.click('#inv-modal [data-fechar]');
    await lancarUi(p, { tipo: 'venda', data: '2026-02-02', ativo: 'ZZTA3', qtd: '50', preco: '12' });
    ok(await kpi(p, 'Aportado (líquido)') === 'R$ 10.000,00', 'aportado: ' + await kpi(p, 'Aportado (líquido)'));
    ok(await kpi(p, 'Lucro realizado') === 'R$ 97,50', 'lucro realizado (600 − 502,50): ' + await kpi(p, 'Lucro realizado'));
    ok(await kpi(p, 'Patrimônio') === 'Indisponível' && /Avaliação indisponível/.test(await texto(p)), 'sem preço autorizado: patrimônio indisponível (nunca simulado)');
    await foto(p, '23-carteira');
    const cid = await p.evaluate(() => window.INVEST.carteiraEstado.atual);
    const estornar = await p.locator('[data-estornar]').first(); await estornar.click(); await p.waitForSelector('#inv-modal.open');
    await p.fill('#inv-modal [name=nota]', 'lançada errada'); await p.click('#inv-modal [type=submit]'); await p.waitForTimeout(1000);
    ok(await kpi(p, 'Lucro realizado') === 'R$ 0,00', 'estorno da venda: ' + await kpi(p, 'Lucro realizado'));
    ok(/Estornada/.test(await texto(p)) && /lançada errada/.test(await texto(p)), 'histórico mostra a estornada e o motivo');
    const doc = await lerDoc(`tenants/t-inv/inv_carteiras/${cid}`); ok(doc && doc.fields.opsN.integerValue === '4', 'contador da carteira: ' + JSON.stringify(doc && doc.fields.opsN));
    ok(await lerDoc(`tenants/t-inv/inv_carteiras/${cid}/operacoes/4`) && await lerDoc(`tenants/t-inv/inv_carteiras/${cid}/estornos/3`), 'operação nº 4 = estorno da nº 3, com marcador');
    medidas.carteiraId = cid;
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
    const c2 = await contexto(); const d = await entrar(c2, P.dir, 'investimentos.html#/carteira'); await d.waitForTimeout(1000);
    ok(!/Reserva do Fin/.test(await texto(d)), 'Diretora viu a carteira pessoal do Financeiro');
    await c2.close();
  });

  await caso(15, 'Favoritos: cotação, minigráfico, comparação da lista, alerta disparado e excluído, notícias dos favoritos, calendário', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.dir, 'investimentos.html');
    for (const id of ['BR:B3:ZZTA3', 'BR:B3:ZZTA4']) { const b = p.locator(`[data-fav="${id}"]`); if ((await b.getAttribute('aria-pressed')) !== 'true') { await b.click(); await p.waitForTimeout(700); } }
    await gravar(`tenants/t-inv/inv_alertas/${P.dir.uid}`, { itens: [{ assetId: 'BR:B3:ZZTA3', tipo: 'acima', valor: 0.01 }, { assetId: 'BR:B3:ZZTA4', tipo: 'abaixo', valor: 0.01 }] });
    // alerta só dispara com preço autorizado ou MANUAL (nunca simulado): a empresa informa o preço da ZZTA3
    await gravar('tenants/t-inv/inv_precos/manual', { itens: [{ assetId: 'BR:B3:ZZTA3', preco: 11, data: hoje(), moeda: 'BRL' }], por: P.dir.uid });
    await abrir(p, 'investimentos.html#/favoritos'); await p.waitForTimeout(1200);
    let t = await texto(p);
    ok(/Alertas disparados/.test(t) && /ZZTA3 acima de 0,01/.test(t) && /Aguardando/.test(t), 'alertas: ' + t.slice(0, 400));
    ok((await p.locator('.inv-mini').count()) >= 2 && (await p.locator('.inv-mini', { hasText: 'sem histórico' }).count()) >= 2, 'minigráficos: sem histórico autorizado, mostra "sem histórico" (nunca um gráfico inventado)');
    ok(/Nenhuma fonte de notícias ligada/.test(t), 'sem servidor não há fonte de notícias (nada fictício por padrão)');
    ok(/Datas de resultados e de dividendos futuros: indisponível/.test(t), 'calendário honesto');
    await p.click('#inv-fav-comparar'); await p.waitForTimeout(700);
    ok(await p.locator('#inv-fav-comp').count() === 1, 'comparação');
    await foto(p, '24-favoritos');
    await p.click('[data-tirar-alerta="1"]'); await p.waitForTimeout(900);
    const d = await lerDoc(`tenants/t-inv/inv_alertas/${P.dir.uid}`); ok(d.fields.itens.arrayValue.values.length === 1, 'alerta não foi excluído no banco');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(16, 'Visão geral com os MESMOS números da carteira; Notícias (categorias, duplicadas), Insights, Boletins, Pesquisa e IA desligada', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.fin, 'investimentos.html#/carteira'); await p.waitForTimeout(1200);
    const pat = await kpi(p, 'Patrimônio'), res = await kpi(p, 'Resultado total');
    ok(pat === 'R$ 10.095,00' && res === 'R$ 95,00', `avaliação completa com o preço manual (caixa 8.995 + 100 × 11; resultado 10.095 − 10.000): ${pat} / ${res}`);
    await abrir(p, 'investimentos.html#/visao'); await p.waitForTimeout(1200);
    ok(await kpi(p, 'Patrimônio') === pat && await kpi(p, 'Resultado total') === res, `valores diferentes: carteira ${pat}/${res} × visão ${await kpi(p, 'Patrimônio')}/${await kpi(p, 'Resultado total')}`);
    let t = await texto(p); ok(/Insights/.test(t) && /Radar/.test(t) && /Notícias/.test(t) && !/Números SIMULADOS/.test(t), 'blocos da visão geral (sem números simulados por padrão)');
    await foto(p, '25-visao-geral');
    await abrir(p, 'investimentos.html#/noticias'); await p.waitForTimeout(1000);
    ok(/Nenhuma fonte de notícias ligada/.test(await texto(p)), 'sem demonstração: nenhuma notícia fictícia');
    // daqui em diante, o modo demonstração (só existe com o catálogo de teste) para conferir o News Engine
    await p.evaluate(() => { localStorage.setItem('eagles_inv_pref_v1', JSON.stringify({ simulador: true })); }); await abrir(p, 'investimentos.html#/noticias'); await p.waitForTimeout(1000);
    t = await texto(p); ok(/Notícias de TESTE/.test(t) && /1 duplicada\(s\) removida\(s\)/.test(t), 'notícias');
    await p.click('[data-cat="juros"]'); await p.waitForTimeout(500);
    const n = await p.locator('.inv-noticia').count(); ok(n === 3, 'juros: ' + n);
    await foto(p, '26-noticias');
    await p.click('[data-secao="insights"]'); await p.waitForTimeout(1200); t = await texto(p);
    ok(/Sua carteira: Reserva do Fin/.test(t) && /Regra:/.test(t) && !/Juro real/.test(t), 'insights (sem indicadores simulados): ' + t.slice(0, 300));
    await p.click('[data-secao="boletins"]'); await p.waitForTimeout(1200); t = await texto(p);
    ok(/Boletim de abertura/.test(t) && /Boletim de fechamento/.test(t) && /regras fixas \(sem IA\)/.test(t), 'boletins');
    await p.click('[data-secao="pesquisa"]'); await p.waitForTimeout(400); t = await texto(p);
    ok(/não é motor automático/.test(t) && /Google — Programmable Search/.test(t), 'pesquisa');
    await p.click('[data-secao="ia"]'); await p.waitForTimeout(400); t = await texto(p);
    ok((t.match(/Desligado/g) || []).length >= 4 && /chave de acesso só pode ficar no servidor/.test(t), 'IA');
    await foto(p, '27-ia-desligada');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(17, 'Super Admin: Visão geral, Mercados e Biblioteca funcionam; nenhuma carteira, favorito ou alerta é lido', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.sa, 'investimentos.html#/visao'); await p.waitForTimeout(1200);
    ok(/O Super Admin não tem carteiras/.test(await texto(p)), 'visão do SA');
    for (const h of ['#/br', '#/us', '#/carteira', '#/favoritos', '#/noticias']) { await abrir(p, 'investimentos.html' + h); await p.waitForTimeout(700); }
    ok(/não vê as carteiras/.test(await p.evaluate(() => { location.hash = '#/carteira'; return new Promise((r) => setTimeout(() => r(document.getElementById('inv-conteudo').innerText), 600)); })), 'carteira do SA');
    const ops = await p.evaluate(() => window.INVEST.medidor.ops.map((o) => o[0]));
    ok(!ops.some((o) => /carteira|alertas|favorito|operacao/.test(o)), 'SA leu dados privados: ' + ops.join(','));
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(18, 'Consumo de uma sessão típica (Visão geral → Carteira → Mercado BR → Favoritos → Notícias → Biblioteca)', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.fin, 'investimentos.html#/visao'); await p.waitForTimeout(1200);
    for (const h of ['#/carteira', '#/br', '#/us', '#/favoritos', '#/noticias', '#/biblioteca', '#/visao']) { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(900); }
    const m = await p.evaluate(() => ({ leituras: window.INVEST.medidor.leituras, gravacoes: window.INVEST.medidor.gravacoes, ops: window.INVEST.medidor.ops }));
    medidas.sessaoTipica = { leituras: m.leituras, gravacoes: m.gravacoes, porOperacao: m.ops.reduce((a, [o, t, n]) => { a[o + '/' + t] = (a[o + '/' + t] || 0) + n; return a; }, {}) };
    ok(m.leituras <= 45 && m.gravacoes === 0, 'consumo: ' + JSON.stringify(medidas.sessaoTipica));
    await ctx.close();
  });


  // ======================= Auditoria corretiva + Etapa 09 =======================
  await caso(19, 'Concorrência pela tela: duas vendas simultâneas acima do saldo em dois aparelhos — só uma grava; carteira arquivada recusa', async () => {
    const ctx1 = await contexto(); const a = await entrar(ctx1, P.fin, 'investimentos.html#/carteira'); await a.waitForTimeout(1200);
    const ctx2 = await contexto(); const b = await entrar(ctx2, P.fin, 'investimentos.html#/carteira'); await b.waitForTimeout(1200);
    const venda = (pg) => pg.evaluate(async () => { const w = window.INVEST.carteiraEstado; const c = w.carteiras.find((x) => x.id === w.atual);
      const h = new Date(), hoje = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
      try { await window.INVEST.carteiraGravarOp(c, { tipo: 'venda', data: hoje, assetId: 'BR:B3:ZZTA3', qtd: 80, preco: 12, moeda: 'BRL' }); return 'gravou'; } catch (e) { return 'recusou: ' + e.message; } });
    const r = await Promise.all([venda(a), venda(b)]);
    ok(r.filter((x) => x === 'gravou').length === 1 && r.some((x) => /inconsistente|venda maior/.test(x)), 'resultado: ' + JSON.stringify(r));
    const cid = await a.evaluate(() => window.INVEST.carteiraEstado.atual);
    const doc = await lerDoc(`tenants/t-inv/inv_carteiras/${cid}`); ok(doc.fields.opsN.integerValue === '5', 'contador: ' + doc.fields.opsN.integerValue);
    medidas.concorrencia = r;
    // arquivar e tentar lançar direto pelo banco (sem a tela)
    await a.evaluate(async () => { const w = window.INVEST.carteiraEstado; const c = w.carteiras.find((x) => x.id === w.atual); await firestoreDb.doc(`tenants/${TENANT_ID}/inv_carteiras/${c.id}`).set({ ativa: false, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); });
    const direto = await a.evaluate(async () => { const w = window.INVEST.carteiraEstado; const c = w.carteiras.find((x) => x.id === w.atual); const FV = firebase.firestore.FieldValue; const ref = firestoreDb.doc(`tenants/${TENANT_ID}/inv_carteiras/${c.id}`);
      const b2 = firestoreDb.batch(); b2.set(ref.collection('operacoes').doc('6'), { tipo: 'aporte', data: '2026-03-02', valor: 1, moeda: 'BRL', seq: 6, criadoPor: USUARIO_UID, criadoEm: FV.serverTimestamp() }); b2.update(ref, { opsN: 6, atualizadoEm: FV.serverTimestamp() });
      try { await b2.commit(); return 'gravou'; } catch (e) { return e.code; } });
    ok(direto === 'permission-denied', 'carteira arquivada aceitou gravação direta: ' + direto);
    await a.evaluate(async () => { const w = window.INVEST.carteiraEstado; const c = w.carteiras.find((x) => x.id === w.atual); await firestoreDb.doc(`tenants/${TENANT_ID}/inv_carteiras/${c.id}`).set({ ativa: true, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); });
    // 403 = as gravações recusadas DE PROPÓSITO neste caso. Conferência exata: cada 403 tem que ser um commit no banco
    // (no mínimo a gravação direta na carteira arquivada; a venda que perde a corrida costuma ser barrada antes, pela releitura do saldo); nenhum 403 de leitura.
    const de403 = a._erros.concat(b._erros).filter((e) => /status of 403 \(Forbidden\)/.test(e));
    medidas.concorrencia403 = de403.map((e) => e.replace(/.*@/, ''));
    ok(de403.length >= 1 && de403.length <= 5 && de403.every((e) => /documents:commit$/.test(e)), '403 inesperados: ' + JSON.stringify(medidas.concorrencia403));
    const reais = a._erros.concat(b._erros).filter((e) => !/status of 403 \(Forbidden\)/.test(e));
    ok(!reais.length, 'erros: ' + reais.join(' | '));
    await ctx1.close(); await ctx2.close();
  });

  await caso(20, 'Demonstração separada: só com o modo ligado, fictícia, nada gravado; a carteira real continua com preço manual (nunca simulado)', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.fin, 'investimentos.html#/carteira'); await p.waitForTimeout(1200);
    ok(await p.locator('#inv-ct-demo').count() === 0, 'sem o modo demonstração, não há botão de demonstração');
    const realAntes = await kpi(p, 'Patrimônio');
    await p.evaluate(() => { localStorage.setItem('eagles_inv_pref_v1', JSON.stringify({ simulador: true })); }); await abrir(p, 'investimentos.html#/carteira'); await p.waitForTimeout(1200);
    ok(await kpi(p, 'Patrimônio') === realAntes, `com o simulador ligado, a carteira real mudou: ${realAntes} → ${await kpi(p, 'Patrimônio')}`);
    const g0 = await p.evaluate(() => window.INVEST.medidor.gravacoes);
    await p.click('#inv-ct-demo'); await p.waitForTimeout(900); const t = await texto(p);
    ok(/DEMONSTRAÇÃO — carteira FICTÍCIA/.test(t) && !/Lançar operação/.test(t) && (await p.locator('[data-estornar]').count()) === 0, 'demonstração');
    await foto(p, '30-demonstracao-separada');
    ok(await p.evaluate(() => window.INVEST.medidor.gravacoes) === g0, 'a demonstração gravou algo');
    await p.click('#inv-ct-demo'); await p.waitForTimeout(900);
    ok(await kpi(p, 'Patrimônio') === realAntes, 'depois da demonstração a carteira real mudou');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(21, 'Projeções: premissas, cenários, metas, estratégias, classes e rebalanceamento; parte da carteira só com avaliação completa; salva cenário sem tocar na carteira', async () => {
    const ctx = await contexto(); const p = await entrar(ctx, P.fin, 'investimentos.html#/carteira'); await p.waitForTimeout(1200);
    const cid = await p.evaluate(() => window.INVEST.carteiraEstado.atual); const antes = (await lerDoc(`tenants/t-inv/inv_carteiras/${cid}`)).fields.opsN.integerValue;
    await abrir(p, 'investimentos.html#/projecoes'); await p.waitForTimeout(1200);
    let t = await texto(p);
    ok(/Projeção não é promessa/.test(t) && /exemplos/.test(t) && /Nenhum CDI ou IPCA de fonte autorizada/.test(t), 'avisos');
    const nominal = async () => p.evaluate(() => [...document.querySelectorAll('.inv-kpi')].find((k) => /nominal\)/.test(k.textContent)).querySelector('strong').textContent);
    const n1 = await nominal();
    await p.fill('[data-k="aporteMensal"]', '3000'); await p.waitForTimeout(600);
    ok(await nominal() !== n1, 'mudar o aporte não recalculou');
    for (const k of ['Cenários', 'Meta de patrimônio', 'Meta de renda passiva', 'Comparação de estratégias', 'Projeção por classe']) ok(new RegExp(k).test(await texto(p)), 'faltou: ' + k);
    // carteira com avaliação completa (preço manual da ZZTA3) aparece como ponto de partida
    const radio = p.locator(`[name="inv-pj-origem"][value="${cid}"]`); ok(await radio.count() === 1 && !(await radio.isDisabled()), 'carteira avaliada deveria estar disponível');
    await radio.check(); await p.waitForTimeout(1200);
    ok(await p.isDisabled('[data-k="patrimonioInicial"]') && (await p.inputValue('[data-k="patrimonioInicial"]')) === '10175', 'patrimônio inicial vindo da carteira: ' + await p.inputValue('[data-k="patrimonioInicial"]'));
    ok(/da carteira “Reserva do Fin”/.test(await texto(p)), 'classes vindas da carteira');
    await p.fill('[data-alvo="acao"]', '100'); await p.dispatchEvent('[data-alvo="acao"]', 'change'); await p.waitForTimeout(600);
    ok(/comprar R\$ 5\.000,00/.test(await texto(p)), 'rebalanceamento com aporte de 5 mil só em ações');
    await foto(p, '31-projecoes');
    p._dialogo = 'Plano Fin'; await p.click('#inv-pj-salvar'); await p.waitForTimeout(1000); p._dialogo = null;
    const d = await lerDoc(`tenants/t-inv/inv_cenarios/${P.fin.uid}`); ok(d && JSON.stringify(d).includes('Plano Fin'), 'cenário não salvo');
    ok((await lerDoc(`tenants/t-inv/inv_carteiras/${cid}`)).fields.opsN.integerValue === antes, 'a projeção alterou a carteira');
    ok(!p._erros.length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(22, 'Consumo por tamanho de carteira (4, 100, 500, 1.000 e 5.000 operações): 1ª abertura e reabertura no mesmo aparelho', async () => {
    medidas.consumoPorTamanho = {};
    const commit = (writes) => fetch(`${FS}/v1/projects/${PROJ}/databases/(default)/documents:commit`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
    const nome = (cam) => `projects/${PROJ}/databases/(default)/documents/${cam}`;
    const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
    for (const n of [4, 100, 500, 1000, 5000]) {
      const pessoa_ = await pessoa('t-inv', 'Volume ' + n, 'Financeiro'); const cam = `tenants/t-inv/inv_carteiras/vol${n}`;
      // operações preparadas pela MESMA função da tela (efeito e saldo conferidos), gravadas direto no simulador
      const cart = { caixaAutomatico: true, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' }; const lista = [];
      for (let k = 1; k <= n; k++) { const r = CT.prepararOperacao(cart, k % 2 ? { tipo: 'compra', data: '2025-01-02', assetId: 'BR:B3:ZZTA3', qtd: 1, preco: 10, moeda: 'BRL' } : { tipo: 'aporte', data: '2025-01-02', valor: 10, moeda: 'BRL' }, {}); lista.push(Object.assign({ seq: k, criadoPor: pessoa_.uid }, r.gravar)); cart.saldo = r.saldo; cart.ultimaData = r.ultimaData; }
      await gravar(cam, { nome: 'Volume ' + n, tipo: 'pessoal', dono: pessoa_.uid, corretoras: [], moedaBase: 'BRL', caixaAutomatico: true, ativa: true, opsN: n, saldo: cart.saldo, ultimaData: cart.ultimaData });
      for (let i = 0; i < n; i += 400) { const w = []; for (let k = i + 1; k <= Math.min(n, i + 400); k++) w.push({ update: { name: nome(`${cam}/operacoes/${k}`), fields: fields(lista[k - 1]) } }); await commit(w); }
      const ctx = await contexto(); const p = await entrar(ctx, pessoa_, 'investimentos.html#/carteira'); await p.waitForTimeout(1500);
      let resumo = null;
      if (n > 300) { // grande: abre no resumo pelo saldo, sem ler as operações; o histórico completo só quando pedido
        ok(/Resumo rápido/.test(await texto(p)), `${n}: deveria abrir no resumo`);
        resumo = await p.evaluate(() => window.INVEST.medidor.ops.filter((o) => o[0] === 'abrir-carteira' && o[1] === 'leituras').reduce((s, o) => s + o[2], 0));
        await p.click('#inv-ct-completo');
      }
      await p.waitForFunction((x) => window.INVEST.carteiraEstado.ops && Object.values(window.INVEST.carteiraEstado.ops).some((o) => o.length === x), n, { timeout: 120000 });
      const t0 = Date.now(); await p.waitForTimeout(300);
      const l1 = await p.evaluate(() => window.INVEST.medidor.ops.filter((o) => o[0] === 'abrir-carteira' && o[1] === 'leituras').reduce((s, o) => s + o[2], 0));
      await abrir(p, 'investimentos.html#/carteira');
      if (n > 300) { await p.waitForTimeout(1200); if (await p.locator('#inv-ct-completo').count()) await p.click('#inv-ct-completo'); }
      await p.waitForFunction((x) => window.INVEST.carteiraEstado.ops && Object.values(window.INVEST.carteiraEstado.ops).some((o) => o.length === x), n, { timeout: 120000 });
      const l2 = await p.evaluate(() => window.INVEST.medidor.ops.filter((o) => o[0] === 'abrir-carteira' && o[1] === 'leituras').reduce((s, o) => s + o[2], 0));
      const calc = await p.evaluate(() => { const w = window.INVEST.carteiraEstado; const c = w.carteiras[0]; const t = performance.now(); window.INVEST.carteiraResumo(c, w.ops[c.id]); return Math.round(performance.now() - t); });
      const consist = await p.evaluate(() => { const w = window.INVEST.carteiraEstado; const c = w.carteiras[0]; return window.INVEST.carteiraResumo(c, w.ops[c.id]).base.consistente; });
      ok(consist, `${n}: carteira semeada deveria estar consistente com o saldo`);
      medidas.consumoPorTamanho[n] = { resumoPeloSaldo: resumo, historicoCompleto1aVez: l1, reaberturaComCache: l2, calculoMs: calc };
      ok(!p._erros.length, `${n}: erros ` + p._erros.join(' | '));
      await ctx.close(); void t0;
    }
    ok(medidas.consumoPorTamanho[5000].reaberturaComCache < medidas.consumoPorTamanho[5000].historicoCompleto1aVez && medidas.consumoPorTamanho[5000].resumoPeloSaldo <= 12, 'consumo: ' + JSON.stringify(medidas.consumoPorTamanho));
  });


  // ======================= Etapa 10 =======================
  await caso(23, 'D-02 pela tela: Super Admin vinculado à empresa cria e usa a PRÓPRIA carteira; não vê as de outras pessoas', async () => {
    const sa2 = await pessoa('t-inv', 'Super Vinculado', 'SuperAdmin');
    const ctx = await contexto(); const p = await entrar(ctx, sa2, 'investimentos.html#/carteira'); await p.waitForTimeout(1200);
    ok(/Nenhuma carteira ainda/.test(await texto(p)), 'SA vinculado: começa sem carteira (não vê a do Financeiro): ' + (await texto(p)).slice(0, 200));
    await p.click('#inv-ct-nova2'); await p.fill('#inv-modal [name=nome]', 'Carteira do SA'); await p.click('#inv-modal [type=submit]'); await p.waitForTimeout(1200);
    ok(!(await p.locator('#inv-modal [name=tipo] option[value=empresa]').count()), 'SA não cria carteira da empresa');
    await lancarUi(p, { tipo: 'aporte', data: '2026-01-05', valor: '500' });
    ok(await kpi(p, 'Aportado (líquido)') === 'R$ 500,00', 'SA lançou na própria carteira');
    const ler = await p.evaluate(async () => { const s = await firestoreDb.collection(`tenants/${TENANT_ID}/inv_carteiras`).where('tipo', '==', 'empresa').get().then(() => 'leu', (e) => e.code); return s; });
    ok(ler === 'permission-denied', 'SA leu carteiras da empresa: ' + ler);
    ok(!p._erros.filter((e) => !/403/.test(e)).length, 'erros: ' + p._erros.join(' | '));
    await ctx.close();
  });

  await caso(24, 'Chaves de IA do CRM: chave antiga no banco fica escondida da equipe, sai do localStorage, o Diretor limpa ao entrar, backup não leva', async () => {
    await gravar('tenants/t-inv/dados/eagles_ia_config_v1', { valor: { modo: 'empresa', provedor: 'openai', modelos: { openai: 'modelo-x' }, chaves: { openai: 'sk-TESTE-FICTICIA-0000000000' } } });
    const ctxA = await contexto();
    await ctxA.addInitScript(() => { try { localStorage.setItem('t-inv::eagles_ia_config_v1', JSON.stringify({ modo: 'empresa', chaves: { openai: 'sk-TESTE-FICTICIA-0000000000' } })); } catch (e) {} });
    const a = await entrar(ctxA, P.adm, 'index.html'); await a.waitForTimeout(1500);
    const viu = await a.evaluate(async () => { let banco; try { banco = JSON.stringify(await cloudGetForce('eagles_ia_config_v1', null)); } catch (e) { banco = e.code; } return { banco, local: localStorage.getItem('t-inv::eagles_ia_config_v1') || '' }; });
    ok(!/sk-TESTE/.test(viu.banco) && !/sk-TESTE/.test(viu.local), 'equipe viu a chave: ' + JSON.stringify(viu));
    await ctxA.close();
    const ctxD = await contexto(); const d = await entrar(ctxD, P.dir, 'index.html'); await d.waitForTimeout(4500);
    const docIa = await lerDoc('tenants/t-inv/dados/eagles_ia_config_v1');
    ok(docIa && !JSON.stringify(docIa).includes('sk-TESTE') && JSON.stringify(docIa).includes('modelo-x'), 'Diretor deveria ter limpado a chave e mantido o modelo: ' + JSON.stringify(docIa).slice(0, 300));
    const bkp = await d.evaluate(async () => JSON.stringify(await bkpColetar()));
    ok(!/sk-TESTE/.test(bkp), 'o backup levou a chave');
    const grava = await d.evaluate(async () => { try { await firestoreDb.doc(`tenants/${TENANT_ID}/dados/eagles_ia_config_v1`).set({ valor: { modo: 'empresa', chaves: { openai: 'sk-TESTE-NOVA' } } }); return 'gravou'; } catch (e) { return e.code; } });
    ok(grava === 'permission-denied', 'o banco aceitou gravar chave: ' + grava);
    await ctxD.close();
  });

  await caso(25, 'Recuperação do ERP/CRM: backup do sistema devolve anotações e contatos (v157) criados depois da atualização; restauração pelo Super Admin sem empresa própria', async () => {
    await gravar('tenants/t-inv/crm_negocio_anotacoes/an-depois', { negocioId: 'n1', texto: 'Anotação criada depois da atualização', autor: 'teste' });
    await gravar('tenants/t-inv/crm_negocio_contatos/ct-depois', { negocioId: 'n1', nome: 'Contato novo' });
    const ctxD = await contexto(); const d = await entrar(ctxD, P.dir, 'index.html').catch((e) => { throw new Error(e.message + ' | navegador conectado: ' + nav.isConnected() + ' | páginas no contexto: ' + ctxD.pages().length + ' ' + ctxD.pages().map((x) => x.url() + (x._erros || []).join(';')).join(',')); }); await d.waitForTimeout(1500);
    const bkp = await d.evaluate(async () => bkpColetar());
    ok(bkp.colecoes.crm_negocio_anotacoes['an-depois'] && bkp.colecoes.crm_negocio_contatos['ct-depois'], 'backup sem as anotações/contatos novos');
    await ctxD.close();
    await apagar('tenants/t-inv/crm_negocio_anotacoes/an-depois'); await apagar('tenants/t-inv/crm_negocio_contatos/ct-depois');
    const ctxS = await contexto(); const s = await entrar(ctxS, P.sa, 'empresas.html'); await s.waitForTimeout(1500);
    const r = await s.evaluate(async (obj) => { BKP_ALVO = 't-inv'; BKP_ARQUIVO = obj; window.prompt = () => 'RESTAURAR'; let msg = ''; window.avisar = (m) => { msg += m + ' | '; }; await bkpRestaurar(); return msg; }, bkp);
    ok(/Restauração concluída/.test(r) && !/não puderam/.test(r), 'restauração: ' + r);
    ok(await lerDoc('tenants/t-inv/crm_negocio_anotacoes/an-depois') && await lerDoc('tenants/t-inv/crm_negocio_contatos/ct-depois'), 'anotação e contato não voltaram');
    await ctxS.close();
  });

  await caso(26, 'Recuperação de Investimentos: carteira exportada (cópia em arquivo) é reimportada com o MESMO saldo, conferido pelo banco', async () => {
    // Investimentos: exportar a carteira do Financeiro e reimportar (relançamento conferido pelo banco)
    const ctxF = await contexto(); const f = await entrar(ctxF, P.fin, 'investimentos.html#/carteira'); await f.waitForTimeout(1500);
    const res = await f.evaluate(async () => { const w = window.INVEST.carteiraEstado; const c = w.carteiras.find((x) => x.id === w.atual); const ops = await window.INVEST.carteiraUi.carregarOps(c);
      const obj = window.INVEST.carteiraBackup.exportarJson(c, ops); const r = await window.INVEST.carteiraBackup.importarObjeto(obj);
      const a = window.INVEST.carteiraResumo(c, ops).base, b = window.INVEST.carteiraResumo(r.carteira, w.ops[r.carteira.id]).base;
      return { conferido: r.conferido, n: ops.length, iguais: a.caixa === b.caixa && a.lucroRealizado === b.lucroRealizado && a.aportado === b.aportado && a.proventos === b.proventos && JSON.stringify(a.saldo) === JSON.stringify(b.saldo) }; });
    ok(res.conferido && res.iguais && res.n >= 4, 'reimportação: ' + JSON.stringify(res));
    medidas.recuperacaoCarteira = res;
    await ctxF.close();
  });

  await caso(12, 'Nenhuma chamada para fora do sistema (além das bibliotecas do próprio sistema, servidas localmente no teste)', async () => {
    const fora = externas.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
    ok(!fora.length, 'chamadas externas: ' + [...new Set(fora)].slice(0, 5).join(', '));
  });

  await nav.close(); srv.close();
  const passou = R.filter((r) => r[2] === 'PASSOU').length;
  R.forEach(([n, nome, s, d]) => console.log(`${String(n).padStart(2)}. ${s === 'PASSOU' ? '✔' : '✖'} ${nome}${d ? '\n     → ' + d : ''}`));
  console.log(`\n${passou}/${R.length} passaram`);
  writeFileSync(join(SAIDA, 'resultado-e2e.json'), JSON.stringify({ resultados: R, medidas, externas: [...new Set(externas)] }, null, 1));
  process.exit(passou === R.length ? 0 : 1);
})();
