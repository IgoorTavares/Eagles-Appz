// S5B, Etapa 4 — o papel de LOGIN das Edge Functions (labz_borda) e o gerador de senha offline.
//  1. (sempre) o gerador da página supabase/s5b/gerar-senha.html produz o verificador SCRAM-SHA-256
//     igual a uma implementação independente (node:crypto) — RFC 5802/7677, formato do PostgreSQL;
//  2. (com LABZ_PG_URL) o verificador da página é aceito pelo PostgreSQL: entra com a senha certa,
//     NÃO entra com a errada; e o papel tem SÓ as permissões de labz_app (nada administrativo).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sqlMigracao } = require('../src/armazenamento/postgres-migracao');

const RAIZ = path.join(__dirname, '..');
const PAGINA = fs.readFileSync(path.join(RAIZ, 'supabase', 's5b', 'gerar-senha.html'), 'utf8');
const MIG_BORDA = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261101000050_labz_borda.sql'), 'utf8');
const MIG2 = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261101000000_labz_acionamentos.sql'), 'utf8');
const URL_PG = process.env.LABZ_PG_URL;

// carrega as funções da própria página (o mesmo código que roda no navegador do Igor)
function funcoesDaPagina() {
  const codigo = PAGINA.match(/<script>([\s\S]*?)<\/script>/)[1];
  return new Function(`${codigo}\nreturn { senhaAleatoria, verificadorScram, montarUrl, hostValido, segredoWorker, PROJETO };`)();
}
function scramIndependente(senha, sal, it = 4096) {
  const salted = crypto.pbkdf2Sync(senha, sal, it, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${it}:${Buffer.from(sal).toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

test('gerador offline: senha forte (40, só letras e números), verificador SCRAM igual ao independente, e a página não usa a rede', async () => {
  const f = funcoesDaPagina();
  const s = f.senhaAleatoria(40);
  assert.match(s, /^[A-Za-z0-9]{40}$/);
  assert.notEqual(f.senhaAleatoria(40), s, 'cada vez uma senha nova');
  const sal = crypto.randomBytes(16);
  assert.equal(await f.verificadorScram(s, new Uint8Array(sal)), scramIndependente(s, sal));
  assert.equal(f.montarUrl('X', 'aws-0-us-east-1.pooler.supabase.com'), 'postgresql://labz_borda.ducvpgrtsguaxqhnnupd:X@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
  assert.equal(f.montarUrl('X', ' aws-1-us-east-1.pooler.supabase.com '), 'postgresql://labz_borda.ducvpgrtsguaxqhnnupd:X@aws-1-us-east-1.pooler.supabase.com:6543/postgres');
  for (const ruim of ['', 'https://aws-0-us-east-1.pooler.supabase.com', 'aws-0-us-east-1.pooler.supabase.com:6543', 'x@aws-0-us-east-1.pooler.supabase.com', 'aws-0-us-east-1.pooler.supabase.com.evil.example', 'evil.example', 'aws-0-us-east-1.pooler.supabase.co']) {
    assert.equal(f.hostValido(ruim), false, ruim);
    assert.throws(() => f.montarUrl('X', ruim), /inválido/, ruim);
  }
  // a senha e a URL (que tem a senha) ficam escondidas na tela; nada de autocompletar
  assert.match(PAGINA, /<input id="senha" type="password" readonly autocomplete="off"/);
  assert.match(PAGINA, /<input id="url" type="password" readonly autocomplete="off"/);
  assert.doesNotMatch(PAGINA, /value="aws-/, 'o endereço do pooler não vem preenchido (tem que ser o do painel)');
  assert.match(PAGINA, /Content-Security-Policy" content="default-src 'none'/, 'a política da página bloqueia qualquer conexão');
  assert.doesNotMatch(PAGINA, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<link|<img|src="http|localStorage|sessionStorage/i, 'nada sai do computador e nada fica guardado');
  // o comando que vai para o SQL Editor leva só o verificador (a senha não aparece nele)
  assert.match(PAGINA, /\$\('sql'\)\.value = `alter role labz_borda with password '\$\{v\}';`/);
});

test('segredo do worker: 64 caracteres hexadecimais, sempre novo, sem viés aparente, e aceito pelo verificador do worker', () => {
  const f = funcoesDaPagina();
  const { criarVerificadorAcionamento } = require('../src/borda/acionamento');
  const vistos = new Set();
  const contagem = new Map();
  for (let i = 0; i < 2000; i++) {
    const s = f.segredoWorker();
    assert.match(s, /^[0-9a-f]{64}$/);
    vistos.add(s);
    for (const c of s) contagem.set(c, (contagem.get(c) || 0) + 1);
  }
  assert.equal(vistos.size, 2000, 'nenhum repetido');
  // 128 mil caracteres em 16 símbolos: cada um perto de 8000 (folga larga, só pega erro grosseiro)
  assert.equal(contagem.size, 16);
  for (const [c, n] of contagem) assert.ok(n > 7200 && n < 8800, `${c}: ${n}`);
  assert.doesNotThrow(() => criarVerificadorAcionamento({ segredo: f.segredoWorker(), consumir: async () => true }));
  // o segredo fica escondido por padrão e é independente do gerador da senha
  assert.match(PAGINA, /<input id="segredo-worker" type="password" readonly autocomplete="off"/);
  assert.match(PAGINA, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
});

test('migração do papel: só atributos sem poder administrativo, herda labz_app sem "vestir", limites de sessão, sem senha', () => {
  assert.match(MIG_BORDA, /create role labz_borda with login inherit connection limit 15;/);
  assert.doesNotMatch(MIG_BORDA.replace(/--.*$/gm, ''), /\b(superuser|createdb|createrole|replication|bypassrls)\b/i, 'nenhum privilégio administrativo citado (nem para ligar)');
  assert.match(MIG_BORDA, /grant labz_app to labz_borda with inherit true, set false;/);
  assert.doesNotMatch(MIG_BORDA.replace(/--.*$/gm, ''), /password|grant\s+(all|create|usage|select|insert|update|delete)/i);
  for (const g of ["statement_timeout = '30s'", "lock_timeout = '10s'", "idle_in_transaction_session_timeout = '60s'"]) assert.ok(MIG_BORDA.includes(g), g);
});

test('no PostgreSQL: o verificador da página funciona (senha certa entra, errada não) e labz_borda só tem o que labz_app tem', { skip: !URL_PG && 'defina LABZ_PG_URL' }, async (t) => {
  const postgres = require('postgres');
  const admin = postgres(URL_PG, { max: 2, onnotice: () => {} });
  const nome = `papel_borda_${process.pid}`;
  await admin.unsafe(`create database ${nome}`);
  const u = new URL(URL_PG); u.pathname = `/${nome}`;
  const db = postgres(u.toString(), { max: 2, onnotice: () => {} });
  let conexao;
  try {
    for (const p of ['anon', 'authenticated']) await db.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${p}') then create role ${p} nologin; end if; end $$;`);
    await db.unsafe(sqlMigracao('labz'));
    await db.unsafe(MIG2);
    await db.unsafe(MIG_BORDA);
    await db.unsafe(MIG_BORDA); // idempotente
    const f = funcoesDaPagina();
    const senha = f.senhaAleatoria(40);
    const verificador = await f.verificadorScram(senha, crypto.getRandomValues(new Uint8Array(16)));
    await db.unsafe(`alter role labz_borda with password '${verificador}'`);
    await db.unsafe(`grant connect on database ${nome} to labz_borda`);
    // atributos e participação
    const [r] = await db`select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig from pg_roles where rolname = 'labz_borda'`;
    assert.deepEqual([r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit, r.rolconnlimit], [true, false, false, false, false, false, true, 15]);
    assert.deepEqual([...r.rolconfig].sort(), ['idle_in_transaction_session_timeout=60s', 'lock_timeout=10s', 'statement_timeout=30s']);
    const [m] = await db`select am.inherit_option, am.set_option from pg_auth_members am join pg_roles g on g.oid = am.roleid join pg_roles x on x.oid = am.member where g.rolname = 'labz_app' and x.rolname = 'labz_borda'`;
    assert.deepEqual([m.inherit_option, m.set_option], [true, false]);
    // senha errada não entra (prova real quando o servidor de teste exige senha, como o Supabase e o CI)
    const ub = new URL(u.toString()); ub.username = 'labz_borda';
    ub.password = 'senha-errada-0000000000000000000000000';
    const errada = postgres(ub.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
    let entrouComErrada = true;
    try { await errada`select 1`; } catch (e) { entrouComErrada = false; assert.match(e.message, /password authentication failed|autentica/i); }
    await errada.end({ timeout: 1 });
    if (entrouComErrada) t.diagnostic('servidor de teste SEM exigência de senha (trust): a recusa da senha errada não pôde ser provada aqui');
    else t.diagnostic('senha errada RECUSADA pelo servidor (verificador SCRAM conferido)');
    ub.password = senha;
    conexao = postgres(ub.toString(), { max: 1, onnotice: () => {}, prepare: false });
    const [eu] = await conexao`select current_user as u, current_setting('statement_timeout') as st`;
    assert.deepEqual([eu.u, eu.st], ['labz_borda', '30s']);
    // pode: o que o worker e a API usam
    await conexao`insert into labz.docs (caminho, colecao, id, dados) values ('labz_x/a', 'labz_x', 'a', '{"ok":1}')`;
    assert.equal((await conexao`select count(*)::int as n from labz.docs`)[0].n, 1);
    await conexao`update labz.docs set dados = '{"ok":2}' where caminho = 'labz_x/a'`;
    await conexao`delete from labz.docs where caminho = 'labz_x/a'`;
    const segredoGerado = f.segredoWorker();
    const [g] = await db`select * from labz.criar_acionamento('manual', ${segredoGerado})`;
    const { assinar } = require('../src/borda/acionamento');
    assert.equal(g.assinatura, assinar(segredoGerado, g.id, Number(g.tempo), g.motivo), 'o segredo gerado assina igual no banco e no worker');
    const [a] = await db`select * from labz.criar_acionamento('manual', 'segredo-ficticio-de-teste-com-mais-de-32-caracteres')`;
    const consumo = await conexao`update labz.acionamentos set consumido_em = now(), consumido_por = 'worker' where id = ${a.id} and consumido_em is null returning id`;
    assert.equal(consumo.length, 1);
    // não pode: nada administrativo, nada fora do necessário
    const negado = async (q, re = /permission denied|must be|not allowed|insufficient/i) => assert.rejects(conexao.unsafe(q), re, q);
    await negado(`insert into labz.acionamentos (id, motivo, tempo) values ('acn_${'f'.repeat(32)}', 'manual', 1)`);
    await negado(`update labz.acionamentos set tempo = 1 where id = '${a.id}'`);
    await negado(`delete from labz.acionamentos where id = '${a.id}'`);
    await negado(`select * from labz.criar_acionamento('manual', 'segredo-ficticio-de-teste-com-mais-de-32-caracteres')`);
    await negado('create table labz.invasor (x int)');
    await negado('create table public.invasor (x int)');
    await negado('create schema invasor');
    await negado('create function public.invasor() returns int language sql as $$ select 1 $$');
    await negado('create role invasor');
    await negado('set role labz_app');
    await negado('alter role labz_borda createrole');
    await negado('truncate labz.docs');
    await negado('drop table labz.docs', /must be owner|permission denied/i);
  } finally {
    if (conexao) await conexao.end({ timeout: 1 });
    await db.end({ timeout: 1 });
    await admin.unsafe(`drop database if exists ${nome} with (force)`);
    await admin.unsafe('drop role if exists labz_borda').catch(() => {}); // papel do cluster de teste
    await admin.end({ timeout: 1 });
  }
});
