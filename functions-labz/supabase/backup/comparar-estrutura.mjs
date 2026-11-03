#!/usr/bin/env node
// LABZ AI — Etapa 12: compara dois RETRATOS DA ESTRUTURA (retrato-estrutura.sql).
//   node supabase/backup/comparar-estrutura.mjs a.json b.json [--repo]
// Sai com 0 se a parte "comparavel" for idêntica; 1 se houver diferença. A parte "ambiente"
// (versões, datas, nomes do Vault) só é mostrada. --repo também confere o texto de cada migração
// registrada no retrato A contra o arquivo do repositório (na produção, devem ser idênticos).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PASTA_MIGRACOES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations');

export function lerRetrato(texto) {
  let v = JSON.parse(String(texto).replace(/^﻿/, ''));
  if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0].retrato === 'string') v = JSON.parse(v[0].retrato);
  else if (v && typeof v.retrato === 'string') v = JSON.parse(v.retrato);
  if (!v || v.formato !== 'labz-retrato-estrutura' || v.versao !== 1 || !v.comparavel) throw new Error('Não é um retrato da estrutura da LABZ AI.');
  return v;
}

export function compararRetratos(a, b) {
  const diferencas = [];
  const secoes = [...new Set([...Object.keys(a.comparavel), ...Object.keys(b.comparavel)])].sort();
  for (const s of secoes) {
    const la = (a.comparavel[s] || []).map((x) => JSON.stringify(x));
    const lb = (b.comparavel[s] || []).map((x) => JSON.stringify(x));
    const sa = new Set(la);
    const sb = new Set(lb);
    for (const x of la) if (!sb.has(x)) diferencas.push({ secao: s, lado: 'só no A', item: x });
    for (const x of lb) if (!sa.has(x)) diferencas.push({ secao: s, lado: 'só no B', item: x });
    if (la.length !== lb.length && diferencas.every((d) => d.secao !== s)) diferencas.push({ secao: s, lado: 'quantidade', item: `${la.length} × ${lb.length}` });
  }
  return diferencas;
}

export function conferirMigracoesRepo(retrato) {
  const arquivos = fs.readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith('.sql'));
  return (retrato.ambiente.migracoes || []).map((m) => {
    const arq = arquivos.find((f) => f.replace(/^\d+_/, '').replace(/\.sql$/, '') === m.nome);
    if (!arq) return { nome: m.nome, ok: false, motivo: 'sem arquivo no repositório' };
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(PASTA_MIGRACOES, arq))).digest('hex');
    return { nome: m.nome, arquivo: arq, ok: h === m.sha256Texto, motivo: h === m.sha256Texto ? 'idêntica ao arquivo' : 'texto registrado diferente do arquivo' };
  });
}

const principal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (principal) {
  const args = process.argv.slice(2);
  const repo = args.includes('--repo');
  const [fa, fb] = args.filter((x) => x !== '--repo');
  if (!fa || !fb) { console.error('Uso: node supabase/backup/comparar-estrutura.mjs a.json b.json [--repo]'); process.exit(2); }
  const a = lerRetrato(fs.readFileSync(fa, 'utf8'));
  const b = lerRetrato(fs.readFileSync(fb, 'utf8'));
  const d = compararRetratos(a, b);
  for (const s of Object.keys(a.comparavel).sort()) console.log(`  ${d.some((x) => x.secao === s) ? 'DIFERENTE' : 'igual    '} ${s} (${(a.comparavel[s] || []).length} × ${(b.comparavel[s] || []).length})`);
  for (const x of d.slice(0, 50)) console.log(`    [${x.secao}] ${x.lado}: ${x.item}`);
  console.log('ambiente (só informação):');
  console.log(`  postgres: ${a.ambiente.postgres} × ${b.ambiente.postgres}`);
  console.log(`  extensões: ${JSON.stringify(a.ambiente.extensoesVersao)} × ${JSON.stringify(b.ambiente.extensoesVersao)}`);
  console.log(`  migrações: ${a.ambiente.migracoes.map((m) => m.versao).join(',')} × ${b.ambiente.migracoes.map((m) => m.versao).join(',')}`);
  console.log(`  nomes no Vault: ${a.ambiente.vaultNomes.length} × ${b.ambiente.vaultNomes.length}`);
  let falhou = d.length > 0;
  if (repo) {
    for (const m of conferirMigracoesRepo(a)) { console.log(`  migração ${m.nome}: ${m.motivo}`); if (!m.ok) falhou = true; }
  }
  console.log(falhou ? '\nRESULTADO: há diferenças' : '\nRESULTADO: estruturas idênticas');
  process.exit(falhou ? 1 : 0);
}
