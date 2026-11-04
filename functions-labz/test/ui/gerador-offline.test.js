// S5B, Etapas 4 e 5 — a página offline supabase/s5b/gerar-senha.html no navegador de verdade:
// nenhuma conexão sai da página; senha, URL e segredo do worker ficam escondidos por padrão;
// nada fica guardado no navegador; o gerador da senha (Etapa 4) continua funcionando igual.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { abrirNavegador } = require('./ajuda-navegador');

const URL_PAGINA = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 's5b', 'gerar-senha.html')).toString();

test('gerador offline no navegador: escondido por padrão, sem rede, sem guardar nada, os dois geradores independentes', async () => {
  const navegador = await abrirNavegador();
  try {
    const contexto = await navegador.newContext({ serviceWorkers: 'block' });
    const pedidos = [];
    contexto.on('request', (r) => { if (r.url() !== URL_PAGINA) pedidos.push(r.url()); });
    const pagina = await contexto.newPage();
    const erros = [];
    pagina.on('pageerror', (e) => erros.push(String(e.message)));
    await pagina.goto(URL_PAGINA);

    // segredo do worker
    assert.equal(await pagina.isVisible('#resultado-worker'), false);
    await pagina.click('#gerar-worker');
    assert.equal(await pagina.getAttribute('#segredo-worker', 'type'), 'password', 'escondido por padrão');
    const s1 = await pagina.inputValue('#segredo-worker');
    assert.match(s1, /^[0-9a-f]{64}$/);
    await pagina.click('[data-mostrar="segredo-worker"]');
    assert.equal(await pagina.getAttribute('#segredo-worker', 'type'), 'text');
    await pagina.click('#gerar-worker');
    assert.equal(await pagina.getAttribute('#segredo-worker', 'type'), 'password', 'gerar de novo volta a esconder');
    const s2 = await pagina.inputValue('#segredo-worker');
    assert.match(s2, /^[0-9a-f]{64}$/);
    assert.notEqual(s1, s2);
    assert.equal(await pagina.isVisible('#resultado'), false, 'o segredo do worker não mexe na parte da senha');

    // gerador da senha (Etapa 4) continua igual
    await pagina.click('#gerar');
    await pagina.waitForFunction(() => document.getElementById('sql').value.startsWith('alter role'));
    const senha = await pagina.inputValue('#senha');
    assert.match(senha, /^[A-Za-z0-9]{40}$/);
    assert.equal(await pagina.getAttribute('#senha', 'type'), 'password');
    assert.match(await pagina.inputValue('#sql'), /^alter role labz_borda with password 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+';$/);
    assert.ok(!(await pagina.inputValue('#sql')).includes(senha), 'o comando não leva a senha');
    await pagina.fill('#host', 'aws-0-us-east-1.pooler.supabase.com');
    assert.equal(await pagina.getAttribute('#url', 'type'), 'password');
    assert.equal(await pagina.inputValue('#url'), `postgresql://labz_borda.ducvpgrtsguaxqhnnupd:${senha}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`);
    assert.equal(await pagina.inputValue('#segredo-worker'), s2, 'a senha não mexe no segredo do worker');

    // a política da página bloqueia conexões (tentativa de dentro da página falha)
    const conectou = await pagina.evaluate(async () => { try { await fetch('https://example.com/'); return true; } catch (_) { return false; } });
    assert.equal(conectou, false);
    // nada guardado no navegador
    const guardado = await pagina.evaluate(() => { try { return localStorage.length + sessionStorage.length; } catch (_) { return 0; } });
    assert.equal(guardado, 0);
    const cookies = await contexto.cookies();
    assert.equal(cookies.length, 0);
    assert.deepEqual(pedidos.filter((u) => !u.startsWith('https://example.com')), [], 'nenhum pedido de rede além do bloqueado');
    assert.deepEqual(erros, []);
  } finally {
    await navegador.close();
  }
});
