// S5B, Etapa 12 — ferramentas de backup (formato, conferência, criptografia, travas e Git).
// O ensaio com o banco de verdade (Supabase local) e a página no navegador fica em
// supabase/backup/ensaiar-etapa12.mjs; aqui ficam as regras que rodam em qualquer lugar (CI incluído).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PASTA = path.join(__dirname, '..', 'supabase', 'backup');
const REPO = path.join(__dirname, '..', '..');
const N = require('../supabase/backup/nucleo.js');
const ler = (f) => fs.readFileSync(path.join(PASTA, f), 'utf8');
const semComentarios = (sql) => sql.replace(/--.*$/gm, '');
const RAPIDO = { iteracoes: 100000 }; // o mínimo aceito, só para os testes rodarem depressa
const SENHA = 'frase-de-teste-ficticia-123';

// Netstring + sha256 calculados SEM o núcleo (conferência independente do algoritmo).
function impressaoIndependente(linhas) {
  const h = crypto.createHash('sha256');
  for (const l of linhas) for (const c of l) { const b = Buffer.from(c, 'utf8'); h.update(`${b.length}:`); h.update(b); }
  return h.digest('hex');
}
// Dados fictícios com o que costuma quebrar formatos: acentos, emoji, tabs, quebras de linha,
// aspas, vírgulas, espaços entre os tokens do JSON e a ordem das chaves.
const LINHAS = [
  ['labz_config/acesso', 'labz_config', 'acesso', '2026-11-03T15:41:38.123456Z', '{"uids":["UidFicticio0000000000000000000"]}'],
  ['labz_config/worker', 'labz_config', 'worker', '2026-11-03T18:21:00.000001Z', '{"ativo":true}'],
  ['labz_eventos/ev1', 'labz_eventos', 'ev1', '2026-11-03T18:49:31.500000Z', '{ "tipo" : "execucao.criada",\n\t"texto": "ação \\"citada\\", com vírgula; 🚀\\nlinha 2" }'],
  ['labz_fila/f1', 'labz_fila', 'f1', '2026-11-03T18:49:32.000000Z', '{"z":1,"a":2,"estado":"feita"}'],
];
async function docFicticio(linhas = LINHAS) {
  const imp = await N.impressao(linhas);
  return { formato: N.FORMATO_DADOS, versao: 1, cabecalho: { formato: N.FORMATO_DADOS, versao: 1, algoritmo: N.ALGORITMO, tabela: N.TABELA, geradoEm: '2026-11-04T18:30:00Z', total: imp.total, contagem: imp.contagem, sha256: imp.sha256 }, linhas };
}
// Como o SQL Editor devolve: colunas ordem e linha (linha 0 = cabeçalho).
const comoExportacao = (doc) => [{ ordem: 0, linha: JSON.stringify(doc.cabecalho) }, ...doc.linhas.map((l, i) => ({ ordem: i + 1, linha: JSON.stringify(l) }))];
const csvCampo = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const comoCsv = (doc, { bom = false, crlf = false } = {}) => (bom ? '﻿' : '') + ['ordem,linha', ...comoExportacao(doc).map((r) => `${r.ordem},${csvCampo(r.linha)}`)].join(crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n');

test('consultas: só leitura, o mesmo "with" na exportação e na impressão digital, sem Vault nem acionamentos', () => {
  const exp = ler('exportar-dados.sql');
  const imp = ler('impressao-digital.sql');
  const bloco = (s) => s.slice(s.indexOf('with base as ('), s.indexOf('\nselect '));
  assert.ok(bloco(exp).length > 200);
  assert.equal(bloco(exp), bloco(imp), 'o bloco "with" precisa ser idêntico nas duas consultas');
  for (const [nome, sql] of [['exportar', exp], ['impressao', imp], ['retrato', ler('retrato-estrutura.sql')]]) {
    const s = semComentarios(sql);
    assert.doesNotMatch(s, /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|copy|call|do)\b/i, `${nome}: só leitura`);
    assert.doesNotMatch(s, /decrypted|pg_authid|rolpassword|\.secret\b|pg_read_file|lo_import/i, `${nome}: nunca lê segredos`);
    assert.doesNotMatch(s, /acionamentos/i, `${nome}: não lê os bilhetes do worker`);
  }
  assert.match(semComentarios(exp), /from labz\.docs\b/);
  assert.match(semComentarios(ler('retrato-estrutura.sql')), /select coalesce\(json_agg\(s\.name order by s\.name collate "C"\), '\[\]'::json\) from vault\.secrets s/, 'do Vault, só os NOMES');
});

test('página offline: contém o núcleo idêntico, não usa a internet e não guarda a senha', async () => {
  const { nucleoDaPagina } = await import('../supabase/backup/sincronizar-pagina.mjs');
  const html = ler('labz-backup.html');
  assert.equal(nucleoDaPagina(html), ler('nucleo.js'), 'rode: node supabase/backup/sincronizar-pagina.mjs');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script src|<link /);
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'dados do arquivo só por textContent');
});

test('impressão digital: netstring + sha256 igual a um cálculo independente', async () => {
  const imp = await N.impressao(LINHAS);
  assert.equal(imp.sha256, impressaoIndependente(LINHAS));
  assert.equal(N.netstring(['ação']), '6:ação'); // ç e ã têm 2 bytes em UTF-8
  assert.deepEqual(imp.contagem, { labz_config: 2, labz_eventos: 1, labz_fila: 1 });
  // sem ambiguidade: mover um caractere entre campos muda a impressão
  const outra = await N.impressao([['ab', 'c', 'x', 'y', '{}']]);
  const mesma = await N.impressao([['a', 'bc', 'x', 'y', '{}']]);
  assert.notEqual(outra.sha256, mesma.sha256);
});

test('conferência: aceita CSV (com BOM/CRLF), JSON do SQL Editor e documento aberto, todos com a mesma impressão', async () => {
  const doc = await docFicticio();
  const variantes = [comoCsv(doc), comoCsv(doc, { bom: true, crlf: true }), JSON.stringify(comoExportacao(doc)), JSON.stringify(comoExportacao(doc).map((r) => ({ ...r, ordem: String(r.ordem) }))), JSON.stringify(doc)];
  for (const v of variantes) {
    const a = N.abrirArquivo(v);
    assert.equal(a.tipo, 'dados');
    const c = await N.conferir(a.doc);
    assert.ok(c.ok, JSON.stringify(c.problemas));
    assert.equal(c.sha256, doc.cabecalho.sha256);
    assert.deepEqual(a.doc.linhas, LINHAS, 'os textos voltam idênticos (byte a byte)');
  }
});

test('conferência: nunca presume que o arquivo baixado está íntegro', async () => {
  const doc = await docFicticio();
  const exp = comoExportacao(doc);
  const conf = async (pares) => N.conferir(N.abrirArquivo(JSON.stringify(pares)).doc);
  // cortado no fim (limite de linhas do SQL Editor)
  let c = await conf(exp.slice(0, -1));
  assert.equal(c.ok, false);
  assert.ok(c.problemas.some((p) => p.codigo === 'incompleto'));
  // falta uma linha no meio
  assert.throws(() => N.abrirArquivo(JSON.stringify(exp.filter((r) => r.ordem !== 2))), (e) => e.codigo === 'incompleto');
  // um caractere trocado no conteúdo
  const alterado = exp.map((r) => (r.ordem === 4 ? { ...r, linha: r.linha.replace('feita', 'feitA') } : r));
  c = await conf(alterado);
  assert.ok(!c.ok && c.problemas.some((p) => p.codigo === 'impressao'));
  // cabeçalho adulterado (total e contagem "consertados" à mão não bastam: a impressão não bate)
  const semUma = exp.filter((r) => r.ordem !== 4);
  const cab = { ...doc.cabecalho, total: 3, contagem: { labz_config: 2, labz_eventos: 1 } };
  c = await conf([{ ordem: 0, linha: JSON.stringify(cab) }, ...semUma.slice(1)]);
  assert.ok(!c.ok && c.problemas.some((p) => p.codigo === 'impressao'));
  // caminho repetido, caminho que não bate, data inválida e conteúdo que não é objeto
  const ruim = [...LINHAS.slice(0, 3), LINHAS[0]];
  c = await N.conferir(await docFicticio(ruim));
  assert.ok(c.problemas.some((p) => /repetido/.test(p.mensagem)));
  c = await N.conferir(await docFicticio([['a/b', 'a', 'c', '2026-11-03T00:00:00.000000Z', '[]'], ['x/y', 'x', 'y', '2026-11-03', '{}']]));
  assert.equal(c.problemas.length, 3);
  // sem cabeçalho, cabeçalho duplo, arquivo vazio, cortado no meio de um campo e arquivo estranho
  assert.throws(() => N.abrirArquivo(JSON.stringify(exp.slice(1))), (e) => e.codigo === 'exportacao-invalida');
  assert.throws(() => N.abrirArquivo(JSON.stringify([exp[0], ...exp])), (e) => e.codigo === 'exportacao-invalida');
  assert.throws(() => N.abrirArquivo(''), (e) => e.codigo === 'vazio');
  assert.throws(() => N.abrirArquivo(comoCsv(doc).slice(0, 200)), (e) => ['csv-invalido', 'exportacao-invalida'].includes(e.codigo));
  assert.throws(() => N.abrirArquivo('nome,email\na,b\n'), (e) => e.codigo === 'desconhecido');
});

test('criptografia: AES-256-GCM com PBKDF2-SHA256, abre com a senha certa e confere tudo', async () => {
  const doc = await docFicticio();
  const env = await N.cifrar(doc, SENHA, RAPIDO);
  assert.equal(env.formato, N.FORMATO_CIFRADO);
  assert.deepEqual([env.kdf.nome, env.kdf.hash, env.cifra.nome, env.cifra.bitsChave, env.cifra.bitsTag], ['PBKDF2', 'SHA-256', 'AES-GCM', 256, 128]);
  const texto = JSON.stringify(env);
  assert.ok(!texto.includes(SENHA), 'a senha nunca vai para o arquivo');
  assert.ok(!texto.includes('labz_eventos/ev1') && !texto.includes('UidFicticio'), 'o conteúdo não aparece às claras');
  const r = await N.decifrar(N.abrirArquivo(texto).envelope, SENHA);
  assert.deepEqual(r.doc, N.normalizar(doc));
  assert.equal(r.rotulo.sha256, doc.cabecalho.sha256);
  // sal e IV novos a cada vez
  const env2 = await N.cifrar(doc, SENHA, RAPIDO);
  assert.notEqual(env2.kdf.sal, env.kdf.sal);
  assert.notEqual(env2.cifra.iv, env.cifra.iv);
  assert.notEqual(env2.dados, env.dados);
  // o padrão (600 mil iterações) também funciona
  const padrao = await N.cifrar(doc, SENHA);
  assert.equal(padrao.kdf.iteracoes, 600000);
  assert.equal((await N.decifrar(padrao, SENHA)).conferencia.sha256, doc.cabecalho.sha256);
});

test('criptografia: senha errada, byte alterado, rótulo trocado ou parâmetros adulterados → não abre', async () => {
  const doc = await docFicticio();
  const env = await N.cifrar(doc, SENHA, RAPIDO);
  const falha = (e, codigo) => assert.rejects(() => N.decifrar(e, SENHA), (x) => x.codigo === codigo);
  await assert.rejects(() => N.decifrar(env, `${SENHA}x`), (x) => x.codigo === 'senha-errada');
  const bytes = Buffer.from(env.dados, 'base64');
  for (const pos of [0, Math.floor(bytes.length / 2), bytes.length - 1]) { // conteúdo e etiqueta
    const b = Buffer.from(bytes); b[pos] ^= 1;
    await falha({ ...env, dados: b.toString('base64') }, 'senha-errada');
  }
  const rot = JSON.parse(env.aad);
  await falha({ ...env, aad: JSON.stringify({ ...rot, total: rot.total + 1 }) }, 'senha-errada');
  await falha({ ...env, kdf: { ...env.kdf, iteracoes: env.kdf.iteracoes + 1 } }, 'senha-errada');
  await falha({ ...env, kdf: { ...env.kdf, iteracoes: 1000 } }, 'cifrado-invalido');
  await falha({ ...env, kdf: { ...env.kdf, iteracoes: 1e9 } }, 'cifrado-invalido');
  await falha({ ...env, cifra: { ...env.cifra, nome: 'AES-CBC' } }, 'cifrado-invalido');
  await falha({ ...env, dados: env.dados.slice(0, 8) }, 'cifrado-invalido');
  await falha({ ...env, versao: 2 }, 'cifrado-invalido');
  // senha curta e arquivo estragado não são cifrados
  await assert.rejects(() => N.cifrar(doc, 'curta-11ch!'), (x) => x.codigo === 'senha-curta');
  const estragado = { ...doc, linhas: doc.linhas.slice(1) };
  await assert.rejects(() => N.cifrar(estragado, SENHA, RAPIDO), (x) => x.codigo === 'nao-integro');
});

test('recuperação SEM a ferramenta: os programas do README abrem o backup (Node sempre; Python se houver)', async (t) => {
  const leia = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const bloco = (lang, nome) => { const m = new RegExp('```' + lang + '\\n(' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?)```').exec(leia); assert.ok(m, `bloco ${nome}`); return m[1]; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labz-backup-teste-'));
  try {
    const doc = await docFicticio();
    fs.writeFileSync(path.join(tmp, 'b.cifrado.json'), JSON.stringify(await N.cifrar(doc, SENHA, RAPIDO)));
    const esperado = JSON.stringify(N.normalizar(doc));
    fs.writeFileSync(path.join(tmp, 'recuperar.js'), bloco('js', '// recuperar-labz-backup.js'));
    execFileSync(process.execPath, [path.join(tmp, 'recuperar.js'), path.join(tmp, 'b.cifrado.json'), path.join(tmp, 'n.aberto.json')], { env: { ...process.env, LABZ_BACKUP_SENHA: SENHA }, stdio: 'pipe' });
    assert.equal(fs.readFileSync(path.join(tmp, 'n.aberto.json'), 'utf8'), esperado);
    const errada = spawnSync(process.execPath, [path.join(tmp, 'recuperar.js'), path.join(tmp, 'b.cifrado.json'), path.join(tmp, 'x.json')], { env: { ...process.env, LABZ_BACKUP_SENHA: 'outra-senha-qualquer' }, stdio: 'pipe' });
    assert.notEqual(errada.status, 0, 'senha errada não abre');
    const py = spawnSync('python3', ['-c', 'import cryptography'], { stdio: 'ignore' });
    if (py.status !== 0) { t.diagnostic('python3 com "cryptography" ausente: bloco Python não rodou aqui'); return; }
    fs.writeFileSync(path.join(tmp, 'recuperar.py'), bloco('python', '# recuperar-labz-backup.py'));
    execFileSync('python3', ['-I', path.join(tmp, 'recuperar.py'), path.join(tmp, 'b.cifrado.json'), path.join(tmp, 'p.aberto.json')], { env: { ...process.env, LABZ_BACKUP_SENHA: SENHA }, stdio: 'pipe' });
    assert.equal(fs.readFileSync(path.join(tmp, 'p.aberto.json'), 'utf8'), esperado);
    const pyErrada = spawnSync('python3', ['-I', path.join(tmp, 'recuperar.py'), path.join(tmp, 'b.cifrado.json'), path.join(tmp, 'y.json')], { env: { ...process.env, LABZ_BACKUP_SENHA: 'outra-senha-qualquer' }, stdio: 'pipe' });
    assert.notEqual(pyErrada.status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('restauração: só aceita banco LOCAL e recusa endereço remoto antes de conectar', async () => {
  const { exigirBancoLocal, RecusaLocal } = await import('../supabase/backup/local.mjs');
  for (const ok of ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'postgres://u:p@localhost/db', 'postgresql://u@[::1]:5432/x']) assert.ok(exigirBancoLocal(ok).host);
  for (const ruim of [
    'postgresql://postgres:x@db.ducvpgrtsguaxqhnnupd.supabase.co:5432/postgres',
    'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://u:p@10.0.0.5/postgres', 'postgresql://u:p@127.0.0.1.exemplo.com/x', 'postgresql://localhost@exemplo.com/x',
    'postgresql://u:p@127.0.0.1:54322/postgres?host=db.exemplo.com', 'postgresql://u:p@127.0.0.1,exemplo.com/x',
    'mysql://u@127.0.0.1/x', 'nao-e-url', '',
  ]) assert.throws(() => exigirBancoLocal(ruim), RecusaLocal, ruim);
  // o programa recusa o remoto com código 3, sem nem abrir o arquivo
  const r = spawnSync(process.execPath, [path.join(PASTA, 'restaurar-local.mjs'), '/nao/existe.json', '--db', 'postgresql://u:p@db.ducvpgrtsguaxqhnnupd.supabase.co:5432/postgres'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /RECUSADO: "db\.ducvpgrtsguaxqhnnupd\.supabase\.co" não é este computador/);
  const fonte = ler('restaurar-local.mjs');
  assert.ok(fonte.indexOf('exigirBancoLocal(url); // recusa endereço remoto') < fonte.indexOf('await abrirBackup(a.arquivo)'));
  assert.match(fonte, /if \(n !== 0\) throw new RecusaLocal/, 'só grava em banco vazio');
  // achado do ensaio: sem o ::text, o driver mandava o JSON como texto JSON ("{...}" entre aspas) e a regra docs_objeto recusava
  assert.match(fonte, /\$4::text::json, \$5::text::timestamptz/, 'o texto do JSON entra exato');
});

test('Git: arquivos de backup ficam fora do repositório; as ferramentas ficam dentro', () => {
  const ignorado = (f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: REPO }).status === 0;
  for (const f of ['labz-backup-20261104-1830Z.cifrado.json', 'qualquer/labz-backup-20261104-1830Z.aberto.json', 'functions-labz/supabase/backup/Supabase Snippet.csv', 'functions-labz/supabase/backup/resultado.json', 'outro.cifrado.json', 'labz-backup.csv']) assert.ok(ignorado(f), `deveria ser ignorado: ${f}`);
  for (const f of ['functions-labz/supabase/backup/labz-backup.html', 'functions-labz/supabase/backup/nucleo.js', 'functions-labz/supabase/backup/exportar-dados.sql', 'functions-labz/README.md']) assert.ok(!ignorado(f), `deveria ficar no Git: ${f}`);
});
