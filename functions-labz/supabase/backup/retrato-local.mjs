#!/usr/bin/env node
// LABZ AI — Etapa 12: gera o RETRATO DA ESTRUTURA de um banco LOCAL (só leitura).
//   node supabase/backup/retrato-local.mjs saida.json [--db URL_LOCAL]
// O retrato da produção sai da MESMA consulta (retrato-estrutura.sql), pela conexão Claude/Supabase.
import fs from 'node:fs';
import path from 'node:path';
import { conectarLocal, urlLocal } from './local.mjs';

const SQL = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'retrato-estrutura.sql'), 'utf8');

export async function retratoLocal(url) {
  const sql = conectarLocal(url);
  try {
    return await sql.begin('read only', async (tx) => JSON.parse((await tx.unsafe(SQL))[0].retrato));
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const principal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (principal) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--db');
  const db = i >= 0 ? args.splice(i, 2)[1] : null;
  if (!args[0]) { console.error('Uso: node supabase/backup/retrato-local.mjs saida.json [--db URL_LOCAL]'); process.exit(2); }
  retratoLocal(urlLocal(db)).then((r) => { fs.writeFileSync(args[0], `${JSON.stringify(r, null, 2)}\n`); console.log(`retrato gravado em ${args[0]}`); })
    .catch((e) => { console.error(`ERRO: ${e.message}`); process.exit(1); });
}
