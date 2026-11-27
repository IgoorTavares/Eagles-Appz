// Investimentos · EAGLES DATA ENGINE — publicador do eagles-dados (Etapa 12.2, v160). SÓ LOCAL nesta etapa.
// Monta um repositório SÓ DE DADOS com snapshots IMUTÁVEIS e um manifesto versionado:
//   manifesto.json                       → o ponteiro atual (sequência crescente; escrito POR ÚLTIMO)
//   manifestos/<sequencia>.json           → histórico dos manifestos (permite rollback)
//   snapshots/<AAAAMMDDhhmmss>/<arquivo>  → arquivos nunca sobrescritos (criação exclusiva)
// Cada fonte é independente: se uma falhar (rede, validação, competência), o manifesto mantém o último snapshot
// válido dela, com estado "desatualizado" e a falha registrada; as outras seguem atualizando.
// Uso (local):  node investimentos-portao/eagles-dados.mjs publicar <repo-dados> <pasta-com-os-json> [--hoje AAAA-MM-DD]
//               node investimentos-portao/eagles-dados.mjs rollback <repo-dados> <sequencia> "<motivo>"
//               node investimentos-portao/eagles-dados.mjs verificar <repo-dados>
//               node investimentos-portao/eagles-dados.mjs reter <repo-dados> [manter=14]
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../inv/inv-snapshot.js');

export const sha = (b) => createHash('sha256').update(b).digest('hex');
const lerJson = (arq) => JSON.parse(readFileSync(arq, 'utf8'));
function gravarAtomico(arq, texto) { const tmp = arq + '.tmp-' + process.pid; writeFileSync(tmp, texto); renameSync(tmp, arq); }
function criarExclusivo(arq, buf) { const fd = openSync(arq, 'wx'); try { writeSync(fd, buf); } finally { closeSync(fd); } } // falha se já existir: snapshot imutável

export function manifestoAtual(repo) {
  const arq = join(repo, 'manifesto.json'); if (!existsSync(arq)) return null;
  const m = lerJson(arq); const v = S.validarManifesto(m);
  if (!v.ok) throw new Error('manifesto atual inválido: ' + v.erros.join('; '));
  return m;
}
const carimbo = (iso) => iso.replace(/\D/g, '').slice(0, 14);

// entradas: { 'nome.json': { obj } | { erro: 'mensagem' } }
export function publicar(repo, entradas, op = {}) {
  const agora = op.agora || new Date().toISOString(); const hoje = op.hoje || agora.slice(0, 10);
  mkdirSync(join(repo, 'snapshots'), { recursive: true }); mkdirSync(join(repo, 'manifestos'), { recursive: true });
  const ant = manifestoAtual(repo);
  const snap = carimbo(agora); const dirSnap = join(repo, 'snapshots', snap);
  if (ant && carimbo(ant.gerado) >= snap) throw new Error('relógio: a nova publicação não é posterior à atual');
  const arquivos = Object.assign({}, ant ? JSON.parse(JSON.stringify(ant.arquivos)) : {});
  const relatorio = {};
  const falhou = (nome, erro) => {
    relatorio[nome] = { ok: false, erro, mantido: !!arquivos[nome] };
    if (arquivos[nome]) { arquivos[nome].estado = 'desatualizado'; arquivos[nome].falha = { quando: agora, erro: String(erro).slice(0, 200) }; }
  };
  for (const [nome, e] of Object.entries(entradas)) {
    if (!S.esquema(nome)) { relatorio[nome] = { ok: false, erro: 'fora da lista de dados públicos' }; continue; }
    if (!e || e.erro || !e.obj) { falhou(nome, (e && e.erro) || 'sem dados'); continue; }
    const texto = JSON.stringify(e.obj); const buf = Buffer.from(texto, 'utf8');
    const v = S.validarConteudo(nome, e.obj, { hoje, texto });
    if (!v.ok) { falhou(nome, 'validação: ' + v.erros.join('; ')); continue; }
    const h = sha(buf); const p = arquivos[nome];
    if (p && v.competencia < p.competencia) { falhou(nome, `competência ${v.competencia} anterior à publicada (${p.competencia})`); continue; }
    if (p && p.sha256 === h) { // mesmo conteúdo: não cria arquivo novo (dedup); só registra a conferência
      arquivos[nome] = Object.assign({}, p, { estado: 'atual', conferido: agora }); delete arquivos[nome].falha; relatorio[nome] = { ok: true, igual: true }; continue;
    }
    mkdirSync(dirSnap, { recursive: true });
    criarExclusivo(join(dirSnap, nome), buf);
    const E = S.esquema(nome);
    arquivos[nome] = { caminho: `snapshots/${snap}/${nome}`, sha256: h, bytes: buf.length, formato: E.formato, competencia: v.competencia, fonte: v.fonte, licenca: e.obj.licenca || null, atribuicao: e.obj.atribuicao || null, coleta: e.obj.coleta || agora, estado: 'atual' };
    if (p && v.competencia === p.competencia) arquivos[nome].retificacao = { substitui: p.sha256, caminhoAnterior: p.caminho, quando: agora };
    relatorio[nome] = { ok: true, novo: true, retificacao: !!arquivos[nome].retificacao };
  }
  const seq = (ant ? ant.sequencia : 0) + 1;
  const man = { formato: S.FORMATO_MANIFESTO, sequencia: seq, gerado: agora, anterior: ant ? ant.sequencia : null, arquivos, licencas: 'Cada arquivo traz a licença e a atribuição da fonte; dados da CVM, Tesouro e Banco Central sob ODbL (base derivada aberta).' };
  const vm = S.validarManifesto(man); if (!vm.ok) throw new Error('manifesto gerado inválido: ' + vm.erros.join('; '));
  // ordem de publicação: arquivos do snapshot já gravados → histórico → manifesto por último (troca atômica do ponteiro)
  gravarAtomico(join(repo, 'manifestos', `${seq}.json`), JSON.stringify(man));
  gravarAtomico(join(repo, 'manifesto.json'), JSON.stringify(man));
  return { sequencia: seq, snapshot: snap, relatorio };
}

// rollback = um NOVO manifesto (sequência maior) que aponta para os arquivos de um manifesto antigo
export function rollback(repo, paraSeq, motivo, op = {}) {
  const agora = op.agora || new Date().toISOString();
  const alvoArq = join(repo, 'manifestos', `${paraSeq}.json`); if (!existsSync(alvoArq)) throw new Error('manifesto ' + paraSeq + ' não existe (fora da retenção?)');
  const alvo = lerJson(alvoArq); const atual = manifestoAtual(repo);
  for (const [nome, a] of Object.entries(alvo.arquivos)) { const b = readFileSync(join(repo, a.caminho)); if (sha(b) !== a.sha256) throw new Error('rollback recusado: ' + nome + ' não confere'); }
  const seq = atual.sequencia + 1;
  const man = Object.assign({}, alvo, { sequencia: seq, gerado: agora, anterior: atual.sequencia, rollback: { para: paraSeq, de: atual.sequencia, motivo: String(motivo || '').slice(0, 200), quando: agora } });
  gravarAtomico(join(repo, 'manifestos', `${seq}.json`), JSON.stringify(man)); gravarAtomico(join(repo, 'manifesto.json'), JSON.stringify(man));
  return { sequencia: seq };
}

export function verificar(repo) {
  const m = manifestoAtual(repo); const erros = [];
  for (const [nome, a] of Object.entries(m.arquivos)) {
    const arq = join(repo, a.caminho); if (!existsSync(arq)) { erros.push(nome + ': arquivo ausente'); continue; }
    const b = readFileSync(arq); if (b.length !== a.bytes) erros.push(nome + ': tamanho'); if (sha(b) !== a.sha256) erros.push(nome + ': SHA-256');
  }
  return { ok: !erros.length, erros, sequencia: m.sequencia };
}

// retenção: mantém os últimos N manifestos e só os snapshots que algum deles usa
export function reter(repo, manter = 14) {
  const seqs = readdirSync(join(repo, 'manifestos')).map((x) => Number(x.replace('.json', ''))).filter(Number.isInteger).sort((a, b) => b - a);
  const ficam = seqs.slice(0, manter); const saem = seqs.slice(manter);
  const usados = new Set();
  for (const s of ficam) for (const a of Object.values(lerJson(join(repo, 'manifestos', `${s}.json`)).arquivos)) usados.add(a.caminho.split('/')[1]);
  for (const a of Object.values(manifestoAtual(repo).arquivos)) usados.add(a.caminho.split('/')[1]);
  const apagados = [];
  for (const s of saem) rmSync(join(repo, 'manifestos', `${s}.json`));
  for (const d of readdirSync(join(repo, 'snapshots'))) if (!usados.has(d)) { rmSync(join(repo, 'snapshots', d), { recursive: true }); apagados.push(d); }
  return { manifestosMantidos: ficam.length, manifestosApagados: saem.length, snapshotsApagados: apagados };
}

async function principal() {
  const [cmd, repo, a3, a4] = process.argv.slice(2);
  const pega = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  if (cmd === 'publicar') {
    const entradas = {};
    for (const n of readdirSync(a3)) if (S.esquema(n)) { try { entradas[n] = { obj: lerJson(join(a3, n)) }; } catch (e) { entradas[n] = { erro: 'JSON ilegível' }; } }
    console.log(JSON.stringify(publicar(repo, entradas, { hoje: pega('--hoje') || undefined }), null, 1));
  } else if (cmd === 'rollback') console.log(JSON.stringify(rollback(repo, Number(a3), a4)));
  else if (cmd === 'verificar') { const r = verificar(repo); console.log(JSON.stringify(r)); if (!r.ok) process.exitCode = 1; }
  else if (cmd === 'reter') console.log(JSON.stringify(reter(repo, Number(a3) || 14)));
  else { console.error('uso: publicar|rollback|verificar|reter'); process.exitCode = 2; }
}
if (import.meta.url === `file://${process.argv[1]}`) principal();
