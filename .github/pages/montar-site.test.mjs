// Testes do artefato público do site (node --test .github/pages/montar-site.test.mjs). Sem rede, sem publicar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { montar, conferir, conferirJekyll, GERADOS_PELO_JEKYLL, PERMITIDOS, PAGINAS, DOMINIO } from './montar-site.mjs';

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

// ---------- 2ª e 3ª camadas: se a fonte do Pages voltar para "Deploy from a branch" ----------
function entradasDaRaiz() {
  // o que está no Git (no GitHub o checkout é igual); sem Git, a pasta
  const g = spawnSync('git', ['ls-tree', '--name-only', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' });
  if (g.status === 0 && g.stdout.trim()) return g.stdout.trim().split('\n');
  return fs.readdirSync(RAIZ);
}

test('_config.yml (Jekyll) exclui todo arquivo ou pasta interna da raiz', () => {
  const cfg = fs.readFileSync(path.join(RAIZ, '_config.yml'), 'utf8');
  const excluidos = [...cfg.matchAll(/^\s*-\s*"?([^"\n#]+?)"?\s*$/gm)].map((m) => m[1].trim());
  const publicosNaRaiz = new Set(PERMITIDOS.map((f) => f.split('/')[0]));
  const internos = entradasDaRaiz().filter((f) => !f.startsWith('.') && !f.startsWith('_') && !publicosNaRaiz.has(f));
  assert.ok(internos.includes('functions-labz') && internos.includes('functions') && internos.includes('CLAUDE.md'));
  const faltando = internos.filter((f) => !excluidos.includes(f) && !(f.endsWith('.md') && excluidos.includes('*.md')));
  assert.deepEqual(faltando, [], `faltam no exclude do _config.yml: ${faltando.join(', ')}`);
  // e nada público foi excluído por engano
  for (const p of PERMITIDOS) assert.ok(!excluidos.includes(p) && !excluidos.includes(p.split('/')[0]), p);
  assert.doesNotMatch(cfg, /^\s*(include|plugins|theme|baseurl|url)\s*:/m, 'a trava não muda mais nada do Jekyll');
});

test('sem .nojekyll na raiz (ele desligaria a trava do _config.yml no modo antigo)', () => {
  assert.ok(!entradasDaRaiz().includes('.nojekyll'));
});

test('conferência do modo antigo (Jekyll): só a lista de permitidos, sem nada interno e sem alteração', () => {
  const ok = path.join(tmp(), 'jk');
  assert.equal(montar({ raiz: RAIZ, saida: ok }).ok, true);
  assert.equal(conferirJekyll({ raiz: RAIZ, saida: ok }).ok, true);
  // o CSS do tema padrão do GitHub (gerado pelo Jekyll, visto na montagem real) é aceito — só ele
  fs.mkdirSync(path.join(ok, 'assets/css'), { recursive: true });
  fs.writeFileSync(path.join(ok, 'assets/css/style.css'), '/* tema primer */');
  assert.equal(conferirJekyll({ raiz: RAIZ, saida: ok }).ok, true);
  assert.ok(!fs.existsSync(path.join(RAIZ, 'assets/css/style.css')), 'o site não usa esse caminho');
  assert.deepEqual([...GERADOS_PELO_JEKYLL], ['assets/css/style.css']);
  for (const [nome, estraga] of [
    ['interno', (d) => { fs.mkdirSync(path.join(d, 'functions-labz'), { recursive: true }); fs.writeFileSync(path.join(d, 'functions-labz/index.js'), 'x'); }],
    ['md', (d) => fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'x')],
    ['regras', (d) => fs.writeFileSync(path.join(d, 'firestore.rules'), 'x')],
    ['extra', (d) => fs.writeFileSync(path.join(d, 'sitemap.xml'), 'x')],
    ['extra-assets', (d) => { fs.mkdirSync(path.join(d, 'assets/css'), { recursive: true }); fs.writeFileSync(path.join(d, 'assets/css/outro.css'), 'x'); }],
    ['faltando', (d) => fs.rmSync(path.join(d, 'script.js'))],
    ['alterado', (d) => fs.appendFileSync(path.join(d, 'index.html'), '<!-- x -->')],
  ]) {
    const d = path.join(tmp(), 'jk');
    montar({ raiz: RAIZ, saida: d });
    estraga(d);
    const r = conferirJekyll({ raiz: RAIZ, saida: d });
    assert.equal(r.ok, false, nome);
  }
});

// ---------- guarda: workflow e script (com um "gh" falso; nada sai para a rede) ----------
test('workflow da guarda: gatilhos, permissões mínimas por tarefa, nunca publica, nada de Firebase', () => {
  const wf = fs.readFileSync(path.join(RAIZ, '.github/workflows/pages-guarda.yml'), 'utf8');
  assert.match(wf, /pull_request:/);
  assert.match(wf, /push:\n\s+branches: \[main\]/);
  assert.match(wf, /schedule:/);
  assert.match(wf, /workflow_dispatch:/);
  const [cabeca, jobs] = wf.split(/^jobs:/m);
  assert.match(cabeca, /^permissions:\n\s+contents: read\n/m);
  assert.doesNotMatch(cabeca, /write/);
  const [fonte, jekyll] = jobs.split(/^\s{2}jekyll:/m);
  assert.match(fonte, /pages: read/);
  assert.match(fonte, /actions: write/);
  assert.match(fonte, /run: bash \.github\/pages\/guarda\.sh/);
  assert.match(fonte, /github\.event_name == 'push' && '18'/);
  assert.match(fonte, /github\.event_name == 'pull_request' && '0'/);
  assert.doesNotMatch(jekyll, /write/);
  assert.match(jekyll, /actions\/jekyll-build-pages@v1/);
  assert.match(jekyll, /--conferir-jekyll _site_jekyll/);
  assert.doesNotMatch(wf, /pages: write|id-token|contents: write|deploy-pages|upload-pages-artifact|firebase|functions-labz|secrets\./);
  assert.doesNotMatch(wf, /continue-on-error/);
});

function gharFalso({ tipo = 'workflow', pages403 = false, runs = '', cancelaFalha = false, listaFalha = false } = {}) {
  const d = tmp();
  const log = path.join(d, 'log');
  fs.mkdirSync(path.join(d, 'bin'));
  fs.writeFileSync(path.join(d, 'bin/gh'), `#!/bin/bash
echo "gh $*" >> "${log}"
case "$*" in
  *"/pages --jq"*) ${pages403 ? 'echo "HTTP 403: Resource not accessible by integration" >&2; exit 1' : `echo "${tipo}"`};;
  *"actions/runs?per_page"*) ${listaFalha ? 'echo "rede caiu" >&2; exit 1' : `[ -f "${log}.cancelado" ] || printf '%s\\n' ${runs || '""'} | grep -v '^$'; true`};;
  *"/cancel"*) ${cancelaFalha ? 'echo "HTTP 403" >&2; exit 1' : `touch "${log}.cancelado"`};;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(d, 'bin/sleep'), '#!/bin/bash\ntrue\n', { mode: 0o755 });
  return { d, log };
}
function rodarGuarda(opcoes, voltas) {
  const { d, log } = gharFalso(opcoes);
  const r = spawnSync('bash', [path.join(RAIZ, '.github/pages/guarda.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${d}/bin:${process.env.PATH}`, REPO: 'dono/repo', VOLTAS: String(voltas), PAUSA: '0' } });
  const chamadas = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { status: r.status, saida: r.stdout + r.stderr, chamadas };
}

test('guarda: fonte certa e nada da publicação antiga → passa (verde)', () => {
  const r = rodarGuarda({ tipo: 'workflow' }, 3);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /OK: fonte do Pages = GitHub Actions/);
  assert.doesNotMatch(r.chamadas, /cancel/);
});

test('guarda: fonte errada (Deploy from a branch) → cancela a publicação antiga e fica vermelha', () => {
  const r = rodarGuarda({ tipo: 'legacy', runs: '111' }, 3);
  assert.equal(r.status, 1);
  assert.match(r.saida, /está em 'legacy'/);
  assert.match(r.chamadas, /actions\/runs\/111\/cancel/);
  assert.match(r.saida, /CANCELADA/);
  // fonte errada e nada rodando: ainda vermelha
  assert.equal(rodarGuarda({ tipo: 'legacy' }, 1).status, 1);
});

test('guarda: fonte certa, mas apareceu publicação antiga → cancela e avisa', () => {
  const r = rodarGuarda({ tipo: 'workflow', runs: '222' }, 2);
  assert.equal(r.status, 1);
  assert.match(r.chamadas, /runs\/222\/cancel/);
});

test('guarda: erro 403 ao ler a configuração → vermelha, com a conferência manual explicada (e ainda vigia)', () => {
  const r = rodarGuarda({ pages403: true, runs: '333' }, 1);
  assert.equal(r.status, 1);
  assert.match(r.saida, /Não consegui ler a configuração do Pages \(HTTP 403/);
  assert.match(r.saida, /Confira à mão/);
  assert.match(r.chamadas, /runs\/333\/cancel/);
});

test('guarda: falha ao cancelar → vermelha, pedindo o cancelamento à mão', () => {
  const r = rodarGuarda({ tipo: 'legacy', runs: '444', cancelaFalha: true }, 1);
  assert.equal(r.status, 1);
  assert.match(r.saida, /NÃO consegui cancelar/);
});

test('guarda: rede caiu ao listar → avisa e continua tentando; resultado segue a fonte', () => {
  const r = rodarGuarda({ tipo: 'workflow', listaFalha: true }, 3);
  assert.equal(r.status, 0);
  assert.equal((r.saida.match(/Não consegui listar/g) || []).length, 3);
  assert.equal(rodarGuarda({ tipo: 'legacy', listaFalha: true }, 2).status, 1);
});

test('guarda em PR (VOLTAS=0): só confere a fonte; não lista nem cancela nada', () => {
  const r = rodarGuarda({ tipo: 'workflow', runs: '555' }, 0);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.chamadas, /actions\/runs/);
});
