// Testes do artefato público do site (node --test .github/pages/montar-site.test.mjs). Sem rede, sem publicar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montar, conferir, PERMITIDOS, PAGINAS, DOMINIO } from './montar-site.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));

// cópia da raiz só com o que o montador lê (permitidos + alguns internos para provar que ficam de fora)
function raizDeTeste(extra = {}) {
  const r = tmp();
  for (const f of [...PERMITIDOS, 'CLAUDE.md', 'firestore.rules', 'firebase.json', 'package.json', 'functions/index.js', 'functions-labz/index.js', 'testes-regras/regras.test.mjs']) {
    if (!fs.existsSync(path.join(RAIZ, f))) continue;
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.copyFileSync(path.join(RAIZ, f), path.join(r, f));
  }
  for (const [f, c] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), c); }
  return r;
}

test('o site real monta e passa na conferência, sem avisos', () => {
  const saida = path.join(tmp(), '_site');
  const r = montar({ raiz: RAIZ, saida });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.arquivos, [...PERMITIDOS].sort());
  assert.ok(r.referencias.length > 500, 'as referências das páginas, CSS, JS, sw.js e manifesto foram conferidas');
});

test('todas as páginas .html da raiz estão no site (nenhuma rota some)', () => {
  const raiz = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.html') && !f.startsWith('_')).sort();
  assert.deepEqual([...PAGINAS].sort(), raiz);
});

test('nenhum arquivo interno entra no artefato', () => {
  const saida = path.join(tmp(), '_site');
  const r = montar({ raiz: RAIZ, saida });
  const internos = ['functions', 'functions-labz', 'testes-regras', '.github', 'CLAUDE.md', 'firestore.rules', 'firestore.indexes.json', 'firebase.json', 'package.json', 'package-lock.json'];
  for (const i of internos) assert.ok(!fs.existsSync(path.join(saida, i)), `${i} não pode estar no site`);
  assert.ok(r.arquivos.every((f) => !/\.md$|^functions|^testes|^\.|firestore|firebase\.json|package/.test(f)));
});

test('service worker: tudo do APP_SHELL está no site, e o cache não mudou', () => {
  const saida = path.join(tmp(), '_site');
  const r = montar({ raiz: RAIZ, saida });
  const sw = r.referencias.filter((x) => x.de === 'sw.js' && x.origem === 'sw-app-shell');
  assert.ok(sw.length >= 40);
  assert.ok(sw.every((x) => r.arquivos.includes(x.alvo)));
  assert.match(fs.readFileSync(path.join(saida, 'sw.js'), 'utf8'), /CACHE_NAME = 'eagles-cache-v\d+'/);
  assert.equal(fs.readFileSync(path.join(saida, 'sw.js'), 'utf8'), fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8'));
});

test('manifesto (início, ícones e atalho), CNAME e caminhos relativos/absolutos', () => {
  const saida = path.join(tmp(), '_site');
  const r = montar({ raiz: RAIZ, saida });
  const man = r.referencias.filter((x) => x.de === 'manifest.json');
  assert.ok(man.some((x) => x.origem === 'manifest-start_url' && x.alvo === 'index.html'));
  assert.ok(man.filter((x) => x.origem === 'manifest-icone').length === 4);
  assert.equal(fs.readFileSync(path.join(saida, 'CNAME'), 'utf8').trim(), DOMINIO);
  // as páginas usam caminhos relativos à raiz; nenhum aponta para fora do site
  assert.ok(r.referencias.every((x) => !x.alvo.startsWith('..')));
  assert.ok(r.referencias.some((x) => x.origem === 'atributo' && x.alvo === 'style.css'));
  assert.ok(r.referencias.some((x) => x.origem === 'atributo' && x.alvo === 'script.js'));
});

test('arquivo interno colocado no artefato é barrado (functions-labz, CLAUDE.md, .env)', () => {
  for (const intruso of ['functions-labz/index.js', 'functions/index.js', 'CLAUDE.md', '.env', 'testes-regras/x.mjs', 'firestore.rules']) {
    const saida = path.join(tmp(), '_site');
    assert.equal(montar({ raiz: RAIZ, saida }).ok, true);
    fs.mkdirSync(path.dirname(path.join(saida, intruso)), { recursive: true });
    fs.writeFileSync(path.join(saida, intruso), 'x');
    const r = conferir({ raiz: RAIZ, saida });
    assert.equal(r.ok, false, intruso);
    assert.ok(r.erros.some((e) => e.includes(intruso)), intruso);
  }
});

test('arquivo faltando, conteúdo alterado ou CNAME trocado: barrados', () => {
  let saida = path.join(tmp(), '_site');
  montar({ raiz: RAIZ, saida });
  fs.rmSync(path.join(saida, 'style.css'));
  let r = conferir({ raiz: RAIZ, saida });
  assert.ok(r.erros.some((e) => e.includes('faltando no artefato: style.css')));
  assert.ok(r.erros.some((e) => e.includes('usa style.css')), 'as páginas que usam o CSS também acusam');

  saida = path.join(tmp(), '_site');
  montar({ raiz: RAIZ, saida });
  fs.appendFileSync(path.join(saida, 'script.js'), '\n// alterado');
  r = conferir({ raiz: RAIZ, saida });
  assert.ok(r.erros.some((e) => e.includes('conteúdo diferente do repositório: script.js')));

  saida = path.join(tmp(), '_site');
  montar({ raiz: RAIZ, saida });
  fs.writeFileSync(path.join(saida, 'CNAME'), 'outro.com\n');
  r = conferir({ raiz: RAIZ, saida });
  assert.ok(r.erros.some((e) => e.includes('CNAME')));
});

test('página ou imagem nova fora da lista: a montagem falha (ninguém publica sem decidir)', () => {
  for (const novo of ['nova-tela.html', 'assets/foto-nova.png']) {
    const raiz = raizDeTeste({ [novo]: '<html></html>' });
    const r = montar({ raiz, saida: path.join(tmp(), '_site') });
    assert.equal(r.ok, false, novo);
    assert.ok(r.erros.some((e) => e.includes(novo)), novo);
  }
});

test('página que passa a usar um arquivo interno (existente no repositório) é barrada', () => {
  const idx = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').replace('</body>', '<a href="functions-labz/index.js">x</a><script src="/firebase.json"></script></body>');
  // o arquivo interno existe no repositório de teste (criado aqui, sem depender de outra branch)
  const raiz = raizDeTeste({ 'index.html': idx, 'functions-labz/index.js': '// interno', 'firebase.json': '{}' });
  const r = montar({ raiz, saida: path.join(tmp(), '_site') });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('functions-labz/index.js')));
  assert.ok(r.erros.some((e) => e.includes('/firebase.json')));
});

test('referência quebrada que já existia antes vira aviso (não é culpa da lista); externo e data: são ignorados', () => {
  const idx = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').replace('</body>', '<img src="assets/nao-existe.png"><a href="https://exemplo.com/a.js">e</a><img src="data:image/png;base64,AA"><a href="#topo">t</a><a href="mailto:x@y.z">m</a></body>');
  const raiz = raizDeTeste({ 'index.html': idx });
  const r = montar({ raiz, saida: path.join(tmp(), '_site') });
  assert.equal(r.ok, true, r.erros.join('\n'));
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /nao-existe\.png/);
});

test('caminho que sai do site (../) é barrado', () => {
  const idx = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').replace('</body>', '<script src="../segredo.js"></script></body>');
  const r = montar({ raiz: raizDeTeste({ 'index.html': idx }), saida: path.join(tmp(), '_site') });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('fora do site')));
});

test('o workflow não publica sozinho: só com disparo manual, PUBLICAR digitado e na main', () => {
  const wf = fs.readFileSync(path.join(RAIZ, '.github/workflows/pages-seguro.yml'), 'utf8');
  const [cabeca, jobs] = wf.split(/^jobs:/m);
  assert.match(cabeca, /^permissions:\n\s+contents: read\n/m, 'por padrão só leitura');
  assert.doesNotMatch(cabeca, /pages: write|id-token/);
  const [conferirJob, publicarJob] = jobs.split(/^\s{2}publicar:/m);
  assert.doesNotMatch(conferirJob, /deploy-pages|upload-pages-artifact|pages: write/, 'a conferência não publica');
  assert.match(publicarJob, /if: github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.confirmar == 'PUBLICAR' && github\.ref == 'refs\/heads\/main'/);
  assert.match(publicarJob, /needs: conferir/);
  assert.match(publicarJob, /montar-site\.mjs --saida _site/);
  assert.match(publicarJob, /path: _site/);
  // nenhum outro workflow publica o site
  for (const f of fs.readdirSync(path.join(RAIZ, '.github/workflows')).filter((x) => x !== 'pages-seguro.yml')) {
    assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, '.github/workflows', f), 'utf8'), /deploy-pages|upload-pages-artifact|firebase deploy/, f);
  }
});

test('montagem com problema termina com erro (o passo falha e o workflow não chega a publicar)', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = path.join(RAIZ, '.github/pages/montar-site.mjs');
  const ok = spawnSync(process.execPath, [script, '--raiz', RAIZ, '--saida', path.join(tmp(), '_site')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const quebrada = raizDeTeste({ 'nova-tela.html': '<html></html>' });
  const r = spawnSync(process.execPath, [script, '--raiz', quebrada, '--saida', path.join(tmp(), '_site')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /FALHOU/);
  // e no workflow a publicação depende da conferência e monta de novo antes de enviar (sem continue-on-error)
  const wf = fs.readFileSync(path.join(RAIZ, '.github/workflows/pages-seguro.yml'), 'utf8');
  assert.doesNotMatch(wf, /continue-on-error|\|\| true/);
  const pub = wf.split(/^\s{2}publicar:/m)[1];
  assert.ok(pub.indexOf('montar-site.mjs') < pub.indexOf('upload-pages-artifact') && pub.indexOf('upload-pages-artifact') < pub.indexOf('deploy-pages'));
});

test('o workflow não roda código da LABZ AI, do servidor nem mexe no Firebase', () => {
  const wf = fs.readFileSync(path.join(RAIZ, '.github/workflows/pages-seguro.yml'), 'utf8');
  const comandos = [...wf.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)].map((m) => m[1]);
  assert.ok(comandos.length >= 3);
  assert.ok(comandos.every((c) => /^node (--test )?\.github\/pages\/montar-site(\.test)?\.mjs/.test(c)), comandos.join('\n'));
  assert.doesNotMatch(wf, /functions-labz|functions\/|firebase-tools|firebase deploy|npm (ci|install)|secrets\./);
  const usos = [...wf.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(usos)], ['actions/checkout@v4', 'actions/deploy-pages@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4', 'actions/upload-pages-artifact@v3']);
});
