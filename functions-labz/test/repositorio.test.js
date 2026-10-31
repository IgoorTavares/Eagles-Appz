// O repositório é público (e o GitHub Pages publica tudo): aqui não pode
// haver chave, conteúdo de skill, prompt privado nem memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.name === 'node_modules' ? [] : d.isDirectory() ? arquivos(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('nenhuma chave ou segredo no código da LABZ AI', () => {
  const padroes = [/sk-[A-Za-z0-9_-]{16,}/, /sk-ant-[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{20,}/, /xox[bp]-[A-Za-z0-9-]{10,}/];
  arquivos(RAIZ).filter((f) => !f.endsWith('repositorio.test.js')).forEach((f) => {
    const t = fs.readFileSync(f, 'utf8');
    padroes.forEach((p) => assert.ok(!p.test(t), `${path.relative(RAIZ, f)} parece conter um segredo (${p})`));
  });
});

test('nenhum arquivo de skill, memória ou prompt no repositório', () => {
  const md = arquivos(RAIZ).filter((f) => /\.(md|txt)$/i.test(f)).map((f) => path.relative(RAIZ, f));
  assert.deepEqual(md.filter((f) => f !== 'README.md'), [], 'conteúdo de skill/memória é privado: vai para o banco, não para o repositório');
  const { AGENTES } = require('../src/agentes/catalogo');
  const proibidos = ['prompt', 'conteudo', 'sistema', 'instrucoes'];
  AGENTES.forEach((a) => {
    proibidos.forEach((k) => assert.ok(!(k in a), `${a.id} tem o campo "${k}" no contrato público`));
    a.skills.forEach((s) => assert.deepEqual(Object.keys(s).sort(), ['arquivo', 'gatilhos', 'obrigatoria']));
  });
});

test('só as bibliotecas oficiais do Firebase; nenhum segredo de verdade guardado em arquivo', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['firebase-admin', 'firebase-functions']);
  assert.ok(!fs.existsSync(path.join(RAIZ, '.secret.local')), '.secret.local não pode existir no repositório');
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.secret.local') && gi.includes('node_modules'));
  const idx = fs.readFileSync(path.join(RAIZ, 'index.js'), 'utf8');
  assert.ok(/defineSecret\(SEGREDO_UIDS\)/.test(idx), 'a lista de UIDs vem do Secret Manager');
  // só a API exportada; nada agendado nem HTTP aberto
  assert.deepEqual((idx.match(/^exports\.(\w+)/gm) || []), ['exports.labzApi']);
  assert.ok(!/onRequest|onSchedule|onDocument/.test(idx));
});
