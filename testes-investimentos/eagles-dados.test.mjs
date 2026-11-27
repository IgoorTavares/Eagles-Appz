// Etapa 12.2 — eagles-dados: snapshots imutáveis, manifesto versionado, SHA-256 no "navegador" (crypto.subtle),
// e as 9 simulações pedidas (snapshot incompleto, arquivo corrompido, manifesto inválido, falha de rede, publicação
// parcial, cache desatualizado, rollback, retificação legítima, falha isolada de uma fonte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { publicar, rollback, verificar, reter } from '../investimentos-portao/eagles-dados.mjs';
const S = createRequire(import.meta.url)('../inv/inv-snapshot.js');

const real = (n) => JSON.parse(readFileSync(new URL('../inv/dados/' + n, import.meta.url), 'utf8'));
const T = (h, m = 0) => `2026-11-${String(20 + Math.floor(h / 24)).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
function repoNovo() { return mkdtempSync(join(tmpdir(), 'eagles-dados-')); }
function armazenamento() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } }; }
// "servidor" estático sobre a pasta do repositório, com defeitos injetáveis
function servidor(repo, defeitos = {}) {
  return async (url) => {
    const caminho = url.replace('https://dados.exemplo/', '').split('?')[0];
    if (defeitos.rede) throw new TypeError('Failed to fetch');
    if (defeitos.manifesto && caminho === 'manifesto.json') return { ok: true, status: 200, text: async () => defeitos.manifesto };
    const arq = join(repo, caminho); if (!existsSync(arq)) return { ok: false, status: 404 };
    let b = readFileSync(arq);
    if (defeitos.corromper && caminho.endsWith(defeitos.corromper)) { b = Buffer.from(b); b[Math.floor(b.length / 2)] ^= 0x20; }
    if (defeitos.truncar && caminho.endsWith(defeitos.truncar)) b = b.subarray(0, b.length - 10);
    return { ok: true, status: 200, text: async () => b.toString('utf8'), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
}
const leitor = (repo, arm, defeitos, hoje = '2026-11-27') => S.criarLeitor({ fetch: servidor(repo, defeitos), base: 'https://dados.exemplo/', armazenamento: arm, subtle: globalThis.crypto.subtle, hoje });

test('publicação: snapshot imutável, manifesto versionado com SHA-256 completo, proveniência e licença; manifesto por último', () => {
  const repo = repoNovo();
  const r = publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') }, 'macro-us.json': { obj: real('macro-us.json') } }, { agora: T(1), hoje: '2026-11-27' });
  assert.equal(r.sequencia, 1);
  const m = JSON.parse(readFileSync(join(repo, 'manifesto.json'), 'utf8'));
  assert.equal(S.validarManifesto(m).ok, true);
  assert.match(m.arquivos['tesouro.json'].sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.arquivos['tesouro.json'].competencia, real('tesouro.json').dataBase);
  assert.match(m.arquivos['tesouro.json'].atribuicao, /Tesouro/); assert.ok(m.arquivos['tesouro.json'].licenca);
  assert.ok(existsSync(join(repo, 'manifestos', '1.json')));
  assert.equal(verificar(repo).ok, true);
  // imutável: o mesmo carimbo de tempo não pode regravar o snapshot
  assert.throws(() => publicar(repo, { 'tesouro.json': { obj: Object.assign({}, real('tesouro.json'), { coleta: 'x' }) } }, { agora: T(1), hoje: '2026-11-27' }), /posterior/);
  // conteúdo igual: não cria arquivo novo (deduplicação)
  const r2 = publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(2), hoje: '2026-11-27' });
  assert.equal(r2.relatorio['tesouro.json'].igual, true); assert.equal(readdirSync(join(repo, 'snapshots')).length, 1);
});

test('navegador: confere tamanho e SHA-256 com crypto.subtle e usa o cache local quando o hash é o mesmo', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento(); const L = leitor(repo, arm);
  const a = await L.arquivo('tesouro.json'); assert.equal(a.ok, true); assert.equal(a.estado, 'atual'); assert.ok(Object.keys(a.dados.titulos).length >= 10);
  const b = await leitor(repo, arm).arquivo('tesouro.json'); assert.equal(b.doCache, true);
});

test('simulação 1 — snapshot incompleto (anti-vazio) não substitui o anterior; a fonte fica "desatualizada"', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const incompleto = Object.assign({}, real('tesouro.json'), { titulos: { X: Object.values(real('tesouro.json').titulos)[0] } });
  const r = publicar(repo, { 'tesouro.json': { obj: incompleto } }, { agora: T(2), hoje: '2026-11-27' });
  assert.equal(r.relatorio['tesouro.json'].ok, false); assert.match(r.relatorio['tesouro.json'].erro, /anti-vazio/);
  const m = JSON.parse(readFileSync(join(repo, 'manifesto.json'), 'utf8'));
  assert.equal(m.arquivos['tesouro.json'].estado, 'desatualizado'); assert.match(m.arquivos['tesouro.json'].caminho, /snapshots\/\d{14}\//);
  const a = await leitor(repo, armazenamento()).arquivo('tesouro.json');
  assert.equal(a.estado, 'desatualizado'); assert.match(a.aviso, /último dado válido/);
});

test('simulação 2 — arquivo corrompido no servidor: SHA-256 não confere, mostra o último válido com aviso', async () => {
  const repo = repoNovo(); publicar(repo, { 'macro-us.json': { obj: real('macro-us.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento(); await leitor(repo, arm).arquivo('macro-us.json');
  const novo = JSON.parse(JSON.stringify(real('macro-us.json'))); novo.coleta = '2026-11-27T10:00:00.000Z';
  publicar(repo, { 'macro-us.json': { obj: novo } }, { agora: T(2), hoje: '2026-11-27' });
  const a = await leitor(repo, arm, { corromper: 'macro-us.json' }).arquivo('macro-us.json');
  assert.equal(a.estado, 'ultimo-valido'); assert.match(a.aviso, /SHA-256 não confere/);
  const sem = await leitor(repo, armazenamento(), { corromper: 'macro-us.json' }).arquivo('macro-us.json');
  assert.equal(sem.ok, false, 'sem cópia válida: indisponível, nunca o arquivo adulterado');
});

test('simulação 3 — manifesto inválido (SHA curto, caminho fora do padrão, arquivo fora da lista) é recusado', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento(); await leitor(repo, arm).manifesto();
  const m = JSON.parse(readFileSync(join(repo, 'manifesto.json'), 'utf8'));
  for (const ruim of [Object.assign({}, m, { sequencia: 9, arquivos: { 'tesouro.json': Object.assign({}, m.arquivos['tesouro.json'], { sha256: 'abc' }) } }),
    Object.assign({}, m, { sequencia: 9, arquivos: { 'tesouro.json': Object.assign({}, m.arquivos['tesouro.json'], { caminho: '../../index.html' }) } }),
    Object.assign({}, m, { sequencia: 9, arquivos: { 'sw.js': m.arquivos['tesouro.json'] } }), 'não é json']) {
    const r = await leitor(repo, arm, { manifesto: typeof ruim === 'string' ? ruim : JSON.stringify(ruim) }).manifesto();
    assert.equal(r.origem, 'guardado'); assert.equal(r.manifesto.sequencia, 1); assert.ok(r.aviso);
  }
  const semNada = await leitor(repo, armazenamento(), { manifesto: '{}' }).manifesto(); assert.equal(semNada.ok, false);
});

test('simulação 4 — falha de rede: usa o manifesto e os arquivos já conferidos', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento(); await leitor(repo, arm).arquivo('tesouro.json');
  const L = leitor(repo, arm, { rede: true }); const m = await L.manifesto();
  assert.equal(m.origem, 'guardado'); const a = await L.arquivo('tesouro.json'); assert.equal(a.ok, true); assert.equal(a.doCache, true);
});

test('simulação 5 — publicação parcial: manifesto novo aponta para arquivo que ainda não chegou ou chegou cortado', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento(); await leitor(repo, arm).arquivo('tesouro.json');
  const novo = Object.assign({}, real('tesouro.json'), { coleta: '2026-11-27T12:00:00.000Z' });
  const r = publicar(repo, { 'tesouro.json': { obj: novo } }, { agora: T(2), hoje: '2026-11-27' });
  const corte = await leitor(repo, arm, { truncar: 'tesouro.json' }).arquivo('tesouro.json');
  assert.equal(corte.estado, 'ultimo-valido'); assert.match(corte.aviso, /publicação parcial|tamanho/);
  rmSync(join(repo, 'snapshots', r.snapshot), { recursive: true }); // o manifesto chegou, o arquivo não
  const falta = await leitor(repo, arm).arquivo('tesouro.json');
  assert.equal(falta.estado, 'ultimo-valido'); assert.match(falta.aviso, /HTTP 404/);
});

test('simulação 6 — cache desatualizado: um manifesto mais antigo nunca substitui o mais novo já conferido', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const velho = readFileSync(join(repo, 'manifesto.json'), 'utf8');
  publicar(repo, { 'tesouro.json': { obj: Object.assign({}, real('tesouro.json'), { coleta: '2026-11-27T12:00:00.000Z' }) } }, { agora: T(2), hoje: '2026-11-27' });
  const arm = armazenamento(); await leitor(repo, arm).manifesto();
  const r = await leitor(repo, arm, { manifesto: velho }).manifesto();
  assert.equal(r.manifesto.sequencia, 2); assert.match(r.aviso, /antigo/);
});

test('simulação 7 — rollback: novo manifesto (sequência maior) volta aos arquivos antigos, conferidos; o navegador aceita', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const arm = armazenamento();
  const t2 = JSON.parse(JSON.stringify(real('tesouro.json'))); t2.dataBase = '2026-11-26'; t2.coleta = '2026-11-27T12:00:00.000Z';
  publicar(repo, { 'tesouro.json': { obj: t2 } }, { agora: T(2), hoje: '2026-11-27' });
  assert.equal((await leitor(repo, arm).arquivo('tesouro.json')).competencia, '2026-11-26');
  const r = rollback(repo, 1, 'dado errado publicado pela fonte', { agora: T(3) });
  assert.equal(r.sequencia, 3);
  const m = JSON.parse(readFileSync(join(repo, 'manifesto.json'), 'utf8')); assert.equal(m.rollback.para, 1);
  const a = await leitor(repo, arm).arquivo('tesouro.json');
  assert.equal(a.estado, 'atual'); assert.equal(a.competencia, real('tesouro.json').dataBase, 'volta à competência anterior só porque é rollback declarado');
  assert.throws(() => rollback(repo, 99, 'x'), /não existe/);
});

test('simulação 8 — retificação legítima: mesma competência, conteúdo novo → publicado e marcado; competência menor sem rollback → recusada', async () => {
  const repo = repoNovo(); publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const ret = JSON.parse(JSON.stringify(real('tesouro.json'))); const k = Object.keys(ret.titulos)[0]; ret.titulos[k].puBase = Math.round((ret.titulos[k].puBase + 0.01) * 100) / 100;
  const r = publicar(repo, { 'tesouro.json': { obj: ret } }, { agora: T(2), hoje: '2026-11-27' });
  assert.equal(r.relatorio['tesouro.json'].retificacao, true);
  const a = await leitor(repo, armazenamento()).arquivo('tesouro.json'); assert.match(a.aviso, /retificado/);
  const velho = JSON.parse(JSON.stringify(real('tesouro.json'))); velho.dataBase = '2026-10-01';
  const r2 = publicar(repo, { 'tesouro.json': { obj: velho } }, { agora: T(3), hoje: '2026-11-27' });
  assert.equal(r2.relatorio['tesouro.json'].ok, false); assert.match(r2.relatorio['tesouro.json'].erro, /anterior/);
});

test('simulação 9 — falha isolada de uma fonte: as outras atualizam; a que falhou mantém o último dado com data e aviso', async () => {
  const repo = repoNovo();
  publicar(repo, { 'tesouro.json': { obj: real('tesouro.json') }, 'macro-us.json': { obj: real('macro-us.json') } }, { agora: T(1), hoje: '2026-11-27' });
  const t2 = Object.assign({}, real('tesouro.json'), { coleta: '2026-11-27T12:00:00.000Z' });
  const r = publicar(repo, { 'tesouro.json': { obj: t2 }, 'macro-us.json': { erro: 'HTTP 503 em fredgraph.csv' } }, { agora: T(2), hoje: '2026-11-27' });
  assert.equal(r.relatorio['tesouro.json'].novo, true); assert.equal(r.relatorio['macro-us.json'].mantido, true);
  const m = JSON.parse(readFileSync(join(repo, 'manifesto.json'), 'utf8'));
  assert.equal(m.arquivos['tesouro.json'].estado, 'atual'); assert.equal(m.arquivos['macro-us.json'].estado, 'desatualizado'); assert.match(m.arquivos['macro-us.json'].falha.erro, /503/);
  const L = leitor(repo, armazenamento());
  assert.equal((await L.arquivo('tesouro.json')).estado, 'atual');
  const mu = await L.arquivo('macro-us.json'); assert.equal(mu.ok, true); assert.equal(mu.estado, 'desatualizado'); assert.match(mu.aviso, /falhou em 2026-11-20.*competência 2026-11-24/);
});

test('conteúdo: bloqueia script, link de domínio não autorizado, http, campo privado, e-mail, credencial e data no futuro', () => {
  const base = real('noticias.json'); const n = (mut) => { const o = JSON.parse(JSON.stringify(base)); mut(o); return S.validarConteudo('noticias.json', o, { hoje: '2026-11-27' }); };
  assert.equal(n(() => {}).ok, true);
  assert.match(n((o) => { o.itens[0].titulo = '<img src=x onerror=alert(1)>'; }).erros.join(), /suspeito/);
  assert.match(n((o) => { o.itens[0].link = 'https://phishing.exemplo/x'; }).erros.join(), /não autorizado/);
  assert.match(n((o) => { o.itens[0].link = 'http://www.federalreserve.gov/x'; }).erros.join(), /https/);
  assert.match(n((o) => { o.itens[0].uid = 'abc'; }).erros.join(), /privado/);
  assert.match(n((o) => { o.nota = 'fale com fulano@empresa.com.br'; }).erros.join(), /e-mail/);
  assert.match(n((o) => { o.nota = 'x?token=abc'; }).erros.join(), /credencial/);
  assert.match(n((o) => { o.itens[0].data = '2099-01-01'; }).erros.join(), /futuro/);
  assert.equal(S.validarConteudo('index.html', {}).ok, false); assert.equal(S.validarConteudo('../x.json', {}).ok, false);
  assert.equal(S.esquema('fundos-h-007.json').formato, 'eagles-inv-fundos-hist-v1'); assert.equal(S.esquema('fundos-h-7.json'), null);
});

test('retenção: mantém os últimos N manifestos e só os snapshots usados; o atual continua íntegro', () => {
  const repo = repoNovo();
  for (let i = 1; i <= 6; i++) publicar(repo, { 'tesouro.json': { obj: Object.assign({}, real('tesouro.json'), { coleta: T(i) }) } }, { agora: T(i), hoje: '2026-11-27' });
  assert.equal(readdirSync(join(repo, 'snapshots')).length, 6);
  const r = reter(repo, 3);
  assert.equal(r.manifestosApagados, 3); assert.equal(readdirSync(join(repo, 'snapshots')).length, 3); assert.equal(verificar(repo).ok, true);
  assert.throws(() => rollback(repo, 1, 'x'), /retenção/);
});
