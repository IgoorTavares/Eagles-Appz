#!/usr/bin/env node
// LABZ AI — Etapa 12: RESTAURAÇÃO SÓ LOCAL de um backup (exportação CSV/JSON, aberto ou cifrado).
//   node supabase/backup/restaurar-local.mjs <arquivo> [--db postgresql://...@127.0.0.1:54322/postgres] [--so-conferir]
// Senha (arquivo cifrado): variável LABZ_BACKUP_SENHA ou digitada no terminal (não aparece na tela).
// Travas, nesta ordem:
//  1. o arquivo é conferido POR INTEIRO (formato, total, contagem e impressão digital) ANTES de conectar;
//  2. só conecta em 127.0.0.1/localhost/::1 (local.mjs): endereço remoto é recusado sem tentar conectar;
//  3. o banco de destino precisa estar VAZIO (ou só com o interruptor desligado que a migração 3 cria,
//     que o do backup substitui): nunca sobrescreve dado nenhum;
//  4. tudo numa transação: grava, recalcula a impressão digital NO BANCO e só confirma se bater;
//     senão, desfaz tudo. Os gatilhos da tabela ficam desligados só dentro da transação (restaurar
//     não chama o worker).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { conectarLocal, exigirBancoLocal, urlLocal, RecusaLocal } from './local.mjs';

const require = createRequire(import.meta.url);
const N = require('./nucleo.js');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const IMPRESSAO_SQL = fs.readFileSync(path.join(PASTA, 'impressao-digital.sql'), 'utf8');

function argumentos(argv) {
  const a = { arquivo: null, db: null, soConferir: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') a.db = argv[++i];
    else if (argv[i] === '--so-conferir') a.soConferir = true;
    else if (!a.arquivo) a.arquivo = argv[i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!a.arquivo) throw new Error('Uso: node supabase/backup/restaurar-local.mjs <arquivo> [--db URL_LOCAL] [--so-conferir]');
  return a;
}

// O que chega do teclado vem em PEDAÇOS, e um pedaço pode trazer várias teclas: colar a senha
// (do gerenciador de senhas) chega de uma vez só, já com o Enter no fim. Por isso, tecla por tecla.
export function processarTeclas(atual, pedaco) {
  let s = Array.from(atual);
  for (const ch of String(pedaco)) {
    if (ch === '\r' || ch === '\n' || ch === '\u0004') return { senha: s.join(''), fim: 'ok' };
    if (ch === '\u0003') return { senha: '', fim: 'cancelado' };
    if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
    else if (ch >= ' ') s.push(ch); // outras teclas de controle (setas etc.) não entram na senha
  }
  return { senha: s.join(''), fim: null };
}

function lerSenhaEscondida(pergunta) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) { reject(new Error('Arquivo cifrado: rode num terminal para digitar a senha (ou defina LABZ_BACKUP_SENHA).')); return; }
    process.stdout.write(pergunta);
    let s = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const aoDigitar = (pedaco) => {
      const r = processarTeclas(s, pedaco);
      s = r.senha;
      if (r.fim === 'ok') { encerrar(); resolve(s); } else if (r.fim === 'cancelado') { encerrar(); reject(new Error('Cancelado.')); }
    };
    const encerrar = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', aoDigitar); process.stdout.write('\n'); };
    process.stdin.on('data', aoDigitar);
  });
}

export async function abrirBackup(arquivo, senha) {
  const aberto = N.abrirArquivo(fs.readFileSync(arquivo, 'utf8'));
  if (aberto.tipo === 'cifrado') {
    const s = senha != null ? senha : (process.env.LABZ_BACKUP_SENHA || await lerSenhaEscondida('Senha do backup: '));
    const { doc, conferencia } = await N.decifrar(aberto.envelope, s);
    return { doc, conferencia, cifrado: true };
  }
  const conferencia = await N.conferir(aberto.doc);
  if (!conferencia.ok) throw new N.ErroBackup('nao-integro', `O arquivo NÃO passou na conferência: ${conferencia.problemas.map((p) => p.mensagem).join(' | ')}`);
  return { doc: N.normalizar(aberto.doc), conferencia, cifrado: false };
}

export async function restaurar({ doc, conferencia }, url) {
  exigirBancoLocal(url); // de novo, logo antes de conectar
  const sql = conectarLocal(url);
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe('lock table labz.docs in access exclusive mode');
      const [{ n }] = await tx.unsafe('select count(*)::int as n from labz.docs');
      // Banco recém-montado pelas 4 migrações: a migração 3 cria o interruptor DESLIGADO. Só esse documento,
      // exatamente com esse valor, é aceito, e o do backup entra no lugar dele. Qualquer outro dado = recusa.
      const [{ padrao }] = await tx.unsafe(`select count(*)::int as padrao from labz.docs where caminho = 'labz_config/worker' and dados::text = '{"ativo":false}'`);
      if (n !== 0 && !(n === 1 && padrao === 1)) throw new RecusaLocal(`RECUSADO: o banco de destino já tem ${n} documento(s). A restauração só grava num banco local VAZIO (ou recém-montado pelas migrações).`);
      if (n === 1) await tx.unsafe(`delete from labz.docs where caminho = 'labz_config/worker' and dados::text = '{"ativo":false}'`);
      await tx.unsafe('alter table labz.docs disable trigger user');
      for (const [caminho, colecao, id, atualizado, dados] of doc.linhas) {
        await tx.unsafe('insert into labz.docs (caminho, colecao, id, dados, atualizado_em) values ($1::text, $2::text, $3::text, $4::text::json, $5::text::timestamptz)', [caminho, colecao, id, dados, atualizado]); // ::text antes: o texto do JSON entra EXATO (sem ser reconvertido)
      }
      await tx.unsafe('alter table labz.docs enable trigger user');
      const [{ cabecalho }] = await tx.unsafe(IMPRESSAO_SQL);
      const banco = JSON.parse(cabecalho);
      const ok = banco.total === conferencia.total && banco.sha256 === conferencia.sha256 && N.mesmaContagem(banco.contagem, conferencia.contagem);
      if (!ok) throw new Error(`A impressão digital no banco (${banco.sha256}) não bate com a do backup (${conferencia.sha256}); nada foi gravado.`);
      return banco;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const principal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (principal) {
  (async () => {
    const a = argumentos(process.argv.slice(2));
    const url = a.soConferir ? null : urlLocal(a.db);
    if (url) exigirBancoLocal(url); // recusa endereço remoto antes até de abrir o arquivo
    const b = await abrirBackup(a.arquivo);
    console.log(`Backup íntegro ✅  ${b.conferencia.total} documentos · impressão digital ${b.conferencia.sha256}${b.cifrado ? ' · aberto com a senha' : ''}`);
    for (const [c, n] of Object.entries(b.conferencia.contagem).sort()) console.log(`  ${c}: ${n}`);
    if (a.soConferir) return;
    const banco = await restaurar(b, url);
    console.log(`Restaurado no banco LOCAL ✅  ${banco.total} documentos · impressão digital no banco ${banco.sha256} (igual à do backup)`);
    const w = b.doc.linhas.find((l) => l[0] === 'labz_config/worker');
    if (w) console.log(`  Atenção: o interruptor do worker restaurado é ${w[4]}.`);
  })().catch((e) => {
    console.error(`ERRO: ${e.message}`);
    process.exit(e instanceof RecusaLocal ? 3 : 1);
  });
}
