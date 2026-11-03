#!/usr/bin/env node
// LABZ AI — Etapa 12.1: ENSAIO COMPLETO do backup com DADOS FICTÍCIOS, no Supabase LOCAL.
// Nada aqui toca o Supabase real (todas as conexões passam pela trava de local.mjs).
//   supabase start && supabase db reset
//   SUPABASE_CLI=supabase node supabase/backup/ensaiar-etapa12.mjs      (ou: npm run backup:ensaio)
// Percorre o caminho inteiro: exportação (a mesma consulta do SQL Editor) → CSV/JSON → página offline
// no navegador (conferir, cifrar, abrir) → abertura independente (Python/Node do README) →
// restauração local (script e SQL manual) → comparação byte a byte → retrato da estrutura.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { conectarLocal, exigirBancoLocal, urlLocal } from './local.mjs';
import { retratoLocal } from './retrato-local.mjs';
import { compararRetratos } from './comparar-estrutura.mjs';

const require = createRequire(import.meta.url);
const N = require('./nucleo.js');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ler = (f) => fs.readFileSync(path.join(PASTA, f), 'utf8');
const SENHA = `ensaio-${crypto.randomBytes(9).toString('hex')}`; // fictícia, só desta rodada
const URL_DB = urlLocal(process.env.LABZ_DB_LOCAL);
exigirBancoLocal(URL_DB);
const db = conectarLocal(URL_DB, { max: 2 });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'labz-ensaio12-'));
let falhas = 0;
let total = 0;
const conferir = (c, nome, extra = '') => { total++; console.log(`${c ? 'ok    ' : 'FALHOU'} ${nome}${extra ? ` — ${extra}` : ''}`); if (!c) falhas++; };

const retrato = async () => (await db`
  select caminho, colecao, id, dados::text as dados, to_char(atualizado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as em, busca::text as busca
  from labz.docs order by caminho collate "C"`).map((r) => [r.caminho, r.colecao, r.id, r.dados, r.em, r.busca].join('\u0001'));
const operacao = async () => {
  const [a] = await db`select (select count(*)::int from labz.acionamentos) as acionamentos,
    (select count(*)::int from net.http_request_queue) + (select count(*)::int from net._http_response) as http`;
  return a;
};
const rodar = (args, env = {}) => spawnSync(process.execPath, [path.join(PASTA, 'restaurar-local.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, SUPABASE_CLI: process.env.SUPABASE_CLI || 'supabase', ...env } });
const bloco = (lang, nome) => { const m = new RegExp('```' + lang + '\\n(' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?)```').exec(fs.readFileSync(path.join(PASTA, '..', '..', 'README.md'), 'utf8')); if (!m) throw new Error(`bloco ${nome} não achado`); return m[1]; };
const csvCampo = (s) => `"${String(s).replace(/"/g, '""')}"`; // como os exportadores que põem aspas em tudo

// Dados fictícios parecidos com os da produção (mesmas coleções e subcoleções), com o que costuma
// quebrar formatos: acentos, emoji, aspas, vírgulas, tabs, quebras de linha, espaços entre tokens,
// ordem de chaves e um documento grande.
function ficticios() {
  const uid = 'UidFicticioDeEnsaio000000000'; // 28 caracteres, fictício
  const d = [
    [`labz_usuarios/${uid}`, '{"role":"SuperAdmin"}'],
    ['labz_config/acesso', `{"uids":["${uid}"]}`],
    ['labz_config/worker', '{"ativo":false}'],
    [`labz_limites/${uid}`, '{"minuto":"2026-11-03T18:49","nMinuto":2,"hora":"2026-11-03T18","nTarefasHora":1}'],
    ['labz_empresas/emp_ensaio', '{ "nome" : "Empresa de Ensaio, Ltda.",\n  "criadaEm": "2026-11-03T18:49:31Z", "z": 1, "a": 2 }'],
    ['labz_nomes/empresa-de-ensaio', '{"empresaId":"emp_ensaio"}'],
    ['labz_fila/fila_1', '{"estado":"feita","tentativas":1}'],
    ['labz_tarefas/exe_ensaio', '{"estado":"COMPLETED","versao":9,"objetivo":"Escrever as legendas da semana. Ação 🚀 \\"aspas\\"\\tcom tab"}'],
    ['labz_tarefas/exe_ensaio/labz_resultados/textos', '{"texto":"[SIMULADO] linha 1\\nlinha 2, com vírgula; e ç ã õ ü ß 中文 😀"}'],
    ['labz_tarefas/exe_ensaio/labz_conteudos/c1', JSON.stringify({ grande: 'x'.repeat(150000), fim: 'ok' })],
    ['labz_consumo/2026-11-03', '{"tokens":3662,"cobrancaReal":false,"provedor":"simulado"}'],
  ];
  for (let i = 0; i < 30; i++) d.push([`labz_eventos/ev_${String(i).padStart(3, '0')}`, `{"tipo":"execucao.passo","n":${i},"texto":"evento ${i}\\r\\n"}`]);
  return d.map(([caminho, dados], i) => {
    const corte = caminho.lastIndexOf('/');
    return { caminho, colecao: caminho.slice(0, corte), id: caminho.slice(corte + 1), dados, em: `2026-11-03T18:${String(10 + (i % 50)).padStart(2, '0')}:00.${String(100000 + i * 7).padStart(6, '0')}Z` };
  });
}

let navegador;
try {
  // 0. banco local com as 4 migrações
  const [{ n: funcoes }] = await db`select count(*)::int as n from pg_proc where pronamespace = 'labz'::regnamespace`;
  conferir(funcoes === 10, 'banco local com as 4 migrações (10 funções labz)', `${funcoes} funções${funcoes === 10 ? '' : ' — rode supabase db reset'}`);
  await db`delete from labz.docs`;
  const opAntes = await operacao();
  for (const f of ficticios()) await db`insert into labz.docs (caminho, colecao, id, dados, atualizado_em) values (${f.caminho}, ${f.colecao}, ${f.id}, ${f.dados}::text::json, ${f.em}::timestamptz)`;
  const original = await retrato();
  conferir(original.length === 41, 'dados fictícios gravados no banco LOCAL', `${original.length} documentos`);

  // 1. exportação: a MESMA consulta que o Igor vai rodar no SQL Editor
  const linhasSql = await db.unsafe(ler('exportar-dados.sql'));
  const exportacao = linhasSql.map((r) => ({ ordem: Number(r.ordem), linha: r.linha }));
  const cab = JSON.parse(exportacao[0].linha);
  const [{ cabecalho: impTexto }] = await db.unsafe(ler('impressao-digital.sql'));
  const imp = JSON.parse(impTexto);
  conferir(exportacao.length === 42 && cab.total === 41, 'exportação: 1 cabeçalho + 41 documentos');
  conferir(imp.sha256 === cab.sha256 && imp.total === cab.total && N.mesmaContagem(imp.contagem, cab.contagem), 'impressao-digital.sql = cabeçalho da exportação (mesmo retrato)');
  const indep = crypto.createHash('sha256');
  for (const r of exportacao.slice(1)) for (const c of JSON.parse(r.linha)) { const b = Buffer.from(c, 'utf8'); indep.update(`${b.length}:`); indep.update(b); }
  conferir(indep.digest('hex') === cab.sha256, 'impressão digital do banco = cálculo independente no Node');
  const csv = `﻿ordem,linha\r\n${exportacao.map((r) => `${csvCampo(r.ordem)},${csvCampo(r.linha)}`).join('\r\n')}\r\n`;
  const arqCsv = path.join(TMP, 'exportado.csv');
  fs.writeFileSync(arqCsv, csv);
  fs.writeFileSync(path.join(TMP, 'exportado.json'), JSON.stringify(exportacao));
  const docNode = N.normalizar(N.abrirArquivo(csv).doc);
  conferir((await N.conferir(docNode)).ok && (await N.conferir(N.abrirArquivo(fs.readFileSync(path.join(TMP, 'exportado.json'), 'utf8')).doc)).ok, 'o núcleo aceita a exportação em CSV (BOM, CRLF, aspas) e em JSON');

  // 2. página offline num navegador de verdade
  const { chromium } = require('playwright');
  navegador = await chromium.launch();
  const ctx = await navegador.newContext({ acceptDownloads: true });
  const pagina = await ctx.newPage();
  const pedidos = [];
  const erros = [];
  pagina.on('request', (r) => pedidos.push(r.url()));
  pagina.on('pageerror', (e) => erros.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await pagina.goto(pathToFileURL(path.join(PASTA, 'labz-backup.html')).href);
  const escolher = async (arquivo) => { await pagina.setInputFiles('#arquivo', arquivo); await pagina.waitForFunction(() => !/Conferindo/.test(document.getElementById('estado-arquivo').textContent)); };
  await escolher(arqCsv);
  await pagina.waitForSelector('#veredito:has-text("Íntegro")');
  conferir((await pagina.textContent('#r-hash')) === cab.sha256 && /^41/.test(await pagina.textContent('#r-total')), 'página: exportação conferida, "Íntegro ✅", mesma impressão digital e 41 documentos');
  // arquivo estragado: um caractere trocado, uma linha a menos
  const estragado = path.join(TMP, 'estragado.csv');
  fs.writeFileSync(estragado, csv.replace('execucao.passo', 'execucao.pass0'));
  await escolher(estragado);
  await pagina.waitForSelector('#veredito:has-text("NÃO está íntegro")');
  conferir(await pagina.isHidden('#painel-cifrar'), 'página: um caractere trocado → "NÃO está íntegro" e não deixa cifrar');
  const cortado = path.join(TMP, 'cortado.csv');
  fs.writeFileSync(cortado, csv.split('\r\n').slice(0, -2).join('\r\n'));
  await escolher(cortado);
  await pagina.waitForSelector('#veredito:has-text("NÃO está íntegro")');
  conferir(/40 de 41 documentos/.test(await pagina.textContent('#r-problemas')), 'página: arquivo cortado (limite de linhas) → "incompleto: 40 de 41"');
  // cifrar
  await escolher(arqCsv);
  await pagina.fill('#senha1', SENHA);
  await pagina.fill('#senha2', `${SENHA}x`);
  await pagina.click('#cifrar');
  conferir(/não são iguais/.test(await pagina.textContent('#estado-cifrar')), 'página: senhas diferentes → não cifra');
  await pagina.fill('#senha1', 'curta');
  await pagina.fill('#senha2', 'curta');
  await pagina.click('#cifrar');
  await pagina.waitForSelector('#estado-cifrar:has-text("12 caracteres")');
  conferir(true, 'página: senha com menos de 12 caracteres → não cifra');
  await pagina.fill('#senha1', SENHA);
  await pagina.fill('#senha2', SENHA);
  const [baixado] = await Promise.all([pagina.waitForEvent('download', { timeout: 60000 }), pagina.click('#cifrar')]);
  const arqCifrado = path.join(TMP, baixado.suggestedFilename());
  await baixado.saveAs(arqCifrado);
  await pagina.waitForSelector('#estado-cifrar:has-text("Pronto")');
  const cifradoTexto = fs.readFileSync(arqCifrado, 'utf8');
  conferir(/^labz-backup-\d{8}-\d{4}Z\.cifrado\.json$/.test(baixado.suggestedFilename()) && JSON.parse(cifradoTexto).kdf.iteracoes === 600000, 'página: backup cifrado baixado (AES-256-GCM, PBKDF2 600 mil)', baixado.suggestedFilename());
  conferir(!cifradoTexto.includes(SENHA) && !cifradoTexto.includes('Empresa de Ensaio') && !cifradoTexto.includes('UidFicticioDeEnsaio'), 'o arquivo cifrado não tem a senha nem os dados às claras');
  conferir((await pagina.inputValue('#senha1')) === '' && (await pagina.inputValue('#senha2')) === '', 'página: os campos de senha são apagados depois de cifrar');
  // abrir o cifrado na página
  await escolher(arqCifrado);
  await pagina.fill('#senha-abrir', 'senha-errada-qualquer');
  await pagina.click('#abrir');
  await pagina.waitForSelector('#estado-abrir:has-text("Não abriu")');
  conferir(true, 'página: senha errada → "Não abriu"');
  await pagina.fill('#senha-abrir', SENHA);
  await pagina.click('#abrir');
  await pagina.waitForSelector('#veredito:has-text("Íntegro")');
  const [baixadoAberto] = await Promise.all([pagina.waitForEvent('download'), pagina.click('#baixar-aberto')]);
  const arqAberto = path.join(TMP, baixadoAberto.suggestedFilename());
  await baixadoAberto.saveAs(arqAberto);
  conferir(fs.readFileSync(arqAberto, 'utf8') === JSON.stringify(docNode), 'página: o cifrado abre com a senha certa, confere e devolve o conteúdo idêntico');
  const deFora = pedidos.filter((u) => !u.startsWith('file://') && !u.startsWith('blob:') && !u.startsWith('data:'));
  conferir(deFora.length === 0, 'página: nenhum pedido à internet', deFora.join(', ') || '0 pedidos');
  conferir(erros.length === 0, 'página: nenhum erro de JavaScript', erros.join(' | ') || '0 erros');
  await navegador.close();
  navegador = null;

  // 3. abertura independente (os programas do README)
  fs.writeFileSync(path.join(TMP, 'recuperar.js'), bloco('js', '// recuperar-labz-backup.js'));
  const rn = spawnSync(process.execPath, [path.join(TMP, 'recuperar.js'), arqCifrado, path.join(TMP, 'node.aberto.json')], { encoding: 'utf8', env: { ...process.env, LABZ_BACKUP_SENHA: SENHA } });
  conferir(rn.status === 0 && fs.readFileSync(path.join(TMP, 'node.aberto.json'), 'utf8') === JSON.stringify(docNode), 'sem a ferramenta (Node, só o módulo crypto): abre e confere', rn.stdout.trim() || rn.stderr.trim());
  fs.writeFileSync(path.join(TMP, 'recuperar.py'), bloco('python', '# recuperar-labz-backup.py'));
  const rp = spawnSync('python3', ['-I', path.join(TMP, 'recuperar.py'), arqCifrado, path.join(TMP, 'py.aberto.json')], { encoding: 'utf8', env: { ...process.env, LABZ_BACKUP_SENHA: SENHA } });
  conferir(rp.status === 0 && fs.readFileSync(path.join(TMP, 'py.aberto.json'), 'utf8') === JSON.stringify(docNode), 'sem a ferramenta (Python + cryptography): abre e confere', rp.stdout.trim() || rp.stderr.trim());

  // 4. restauração local pelo script (arquivo cifrado + senha)
  const retratoAntes = await retratoLocal(URL_DB);
  await db`delete from labz.docs`;
  const opMeio = await operacao();
  const r1 = rodar([arqCifrado], { LABZ_BACKUP_SENHA: SENHA });
  conferir(r1.status === 0, 'restaurar-local.mjs: backup cifrado restaurado no banco local vazio', r1.stdout.split('\n').find((l) => l.startsWith('Restaurado')) || r1.stderr.trim());
  conferir(JSON.stringify(await retrato()) === JSON.stringify(original), 'restauração = original, byte a byte (caminho, coleção, id, texto do JSON, data com microssegundos e busca)');
  const opDepois = await operacao();
  conferir(opDepois.acionamentos === opMeio.acionamentos && opDepois.http === opMeio.http && opMeio.http === opAntes.http, 'restaurar não chamou o worker (0 acionamentos e 0 pedidos HTTP novos)');
  // travas
  const r2 = rodar([arqCifrado], { LABZ_BACKUP_SENHA: SENHA });
  conferir(r2.status === 3 && /já tem 41 documento/.test(r2.stderr) && JSON.stringify(await retrato()) === JSON.stringify(original), 'banco com dados → RECUSADO, nada muda');
  const r3 = rodar([arqCifrado, '--db', 'postgresql://postgres:x@db.ducvpgrtsguaxqhnnupd.supabase.co:5432/postgres'], { LABZ_BACKUP_SENHA: SENHA });
  conferir(r3.status === 3 && /não é este computador/.test(r3.stderr), 'endereço remoto (produção) → RECUSADO antes de conectar');
  await db`delete from labz.docs`;
  const adulterado = JSON.parse(cifradoTexto);
  const b = Buffer.from(adulterado.dados, 'base64'); b[100] ^= 1; adulterado.dados = b.toString('base64');
  fs.writeFileSync(path.join(TMP, 'adulterado.cifrado.json'), JSON.stringify(adulterado));
  const r4 = rodar([path.join(TMP, 'adulterado.cifrado.json')], { LABZ_BACKUP_SENHA: SENHA });
  const [{ n: depoisAdulterado }] = await db`select count(*)::int as n from labz.docs`;
  conferir(r4.status === 1 && depoisAdulterado === 0, 'arquivo cifrado com 1 bit alterado → recusado, banco continua vazio');
  const r5 = rodar([arqCifrado], { LABZ_BACKUP_SENHA: 'senha-errada-qualquer' });
  conferir(r5.status === 1 && /senha está errada/.test(r5.stderr), 'senha errada no script → recusado');
  const r6 = rodar([cortado]);
  conferir(r6.status === 1 && /40 de 41/.test(r6.stderr), 'exportação cortada → recusada antes de conectar');
  const r7 = rodar([arqCsv, '--so-conferir']);
  conferir(r7.status === 0 && r7.stdout.includes(cab.sha256), '--so-conferir: confere a exportação sem tocar em banco');

  // 5. restauração SEM o script (o SQL do README), num banco vazio
  const sqlManual = bloco('sql', 'begin;').replace('<LINHAS>', JSON.stringify(JSON.parse(fs.readFileSync(path.join(TMP, 'py.aberto.json'), 'utf8')).linhas));
  conferir(!JSON.stringify(docNode.linhas).includes('$labzbackup$'), 'o marcador $labzbackup$ não aparece nos dados');
  const umaConexao = conectarLocal(URL_DB); // begin/commit escritos à mão precisam de uma conexão só
  try { await umaConexao.unsafe(sqlManual); } finally { await umaConexao.end({ timeout: 2 }); }
  const [{ cabecalho: impManual }] = await db.unsafe(ler('impressao-digital.sql'));
  conferir(JSON.parse(impManual).sha256 === cab.sha256 && JSON.stringify(await retrato()) === JSON.stringify(original), 'SQL manual do README: restauração idêntica (mesma impressão digital)');

  // 6. retrato da estrutura
  const retratoDepois = await retratoLocal(URL_DB);
  conferir(compararRetratos(retratoAntes, retratoDepois).length === 0, 'retrato da estrutura igual antes e depois de restaurar (13 seções)');
  const texto = JSON.stringify(retratoDepois);
  conferir(!texto.includes('UidFicticioDeEnsaio') && !texto.includes('Empresa de Ensaio'), 'o retrato da estrutura não leva dados');
  let mudado = null;
  const DESFAZER = new Error('desfazer');
  await db.begin(async (tx) => {
    await tx.unsafe('create policy ensaio_extra on labz.docs for select to labz_app using (false)');
    await tx.unsafe("alter function labz.worker_ativo() set statement_timeout = '1s'");
    mudado = JSON.parse((await tx.unsafe(ler('retrato-estrutura.sql')))[0].retrato);
    throw DESFAZER; // a transação é desfeita: nada fica gravado
  }).catch((e) => { if (e !== DESFAZER) throw e; });
  const comparacao = mudado ? compararRetratos(retratoDepois, mudado) : [];
  conferir(comparacao.some((d) => d.secao === 'politicas') && comparacao.some((d) => d.secao === 'funcoes'), 'uma regra de RLS a mais e uma função alterada são detectadas', comparacao.map((d) => d.secao).join(', '));
  conferir(compararRetratos(retratoDepois, await retratoLocal(URL_DB)).length === 0, 'a mudança de teste foi desfeita (estrutura igual à original)');
} catch (e) {
  falhas++;
  console.error('erro no ensaio:', e.stack || e.message);
} finally {
  if (navegador) await navegador.close().catch(() => {});
  await db`delete from labz.docs`.catch(() => {});
  await db.end({ timeout: 2 });
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(falhas ? `\n${falhas} de ${total} conferência(s) falharam` : `\nEnsaio da Etapa 12.1: ${total} de ${total} conferências aprovadas`);
process.exit(falhas ? 1 : 0);
