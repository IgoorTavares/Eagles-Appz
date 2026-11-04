// Roda TODOS os testes (test/*.test.js) com o banco PostgreSQL no lugar do banco em memória.
//   LABZ_PG_URL=postgresql://usuario@host:porta/banco node test/postgres/rodar.js
// Cria um banco temporário (labz_teste_…), roda os testes nele e apaga no fim, mesmo com erro.
// Nunca use a URL de um banco de produção: o usuário precisa poder criar e apagar bancos.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres');

const BASE = process.env.LABZ_PG_URL;
if (!BASE) { console.error('Defina LABZ_PG_URL (um PostgreSQL de TESTE).'); process.exit(1); }
const RAIZ = path.join(__dirname, '..', '..');
const nome = `labz_teste_${Date.now()}_${process.pid}`;

(async () => {
  const admin = postgres(BASE, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${nome}`);
  let codigo = 1;
  try {
    const url = new URL(BASE); url.pathname = `/${nome}`;
    const arquivos = fs.readdirSync(path.join(RAIZ, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f));
    const r = spawnSync(process.execPath, ['--require', './test/postgres/usar-postgres.js', '--test', ...arquivos], {
      cwd: RAIZ, stdio: 'inherit', env: Object.assign({}, process.env, { LABZ_PG_URL: url.toString() }), timeout: 20 * 60 * 1000,
    });
    codigo = r.status === null ? 1 : r.status;
  } finally {
    await admin.unsafe(`drop database if exists ${nome} with (force)`);
    await admin.end();
  }
  process.exit(codigo);
})().catch((e) => { console.error(e); process.exit(1); });
