#!/usr/bin/env node
// LABZ AI — Etapa 12.5: TESTE DE RESTAURAÇÃO no computador do Igor, de ponta a ponta, com UM comando:
//   npm run backup:teste-restauracao -- "<arquivo>.cifrado.json" --tarefa <id> --entregas <n>
// Opções: --manter (não apaga o banco local no fim) · --referencia <retrato.json>
// O que faz, nesta ordem (tudo no próprio computador; nada vai para a internet nem para a produção):
//  1. confere que é um backup CIFRADO, que o projeto não está ligado a um Supabase remoto e que o Docker está pronto;
//  2. pede a senha (não aparece na tela; pode colar) e abre + confere o backup ANTES de qualquer banco;
//  3. sobe o Supabase LOCAL e remonta o banco do zero só com as 4 migrações do repositório;
//  4. pausa o relógio automático LOCAL (para ele não mexer nos dados restaurados durante o teste);
//  5. restaura numa transação (restaurar-local.mjs: só 127.0.0.1/localhost/::1);
//  6. confere tudo (conferir-restauracao.mjs) e mostra SÓ resultados, sem conteúdo de documentos;
//  7. desliga o Supabase local e APAGA os dados restaurados (a não ser com --manter).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RAIZ, conectarLocal, exigirBancoLocal, RecusaLocal } from './local.mjs';
import { abrirBackup, restaurar } from './restaurar-local.mjs';
import { conferirRestauracao, imprimir } from './conferir-restauracao.mjs';

const require = createRequire(import.meta.url);
const N = require('./nucleo.js');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
export const CLI_VERSAO = '2.122.0'; // a mesma versão usada nos ensaios
export const SERVICOS_DESLIGADOS = 'gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor,edge-runtime,kong,postgrest';
// Rede própria do Docker em que as portas só abrem para ESTE computador (127.0.0.1). Sem ela, o Supabase
// local abre o banco em 0.0.0.0, ou seja, para a rede (o Wi-Fi), com a senha padrão "postgres".
export const REDE_LOCAL = 'labz-restauracao-local';
const REFERENCIA_PADRAO = path.join(PASTA, 'retratos', 'producao-2026-11-03.json');

export function argumentos(argv) {
  const a = { arquivo: null, tarefa: null, entregas: null, manter: false, referencia: REFERENCIA_PADRAO };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--tarefa') a.tarefa = argv[++i];
    else if (x === '--entregas') a.entregas = Number(argv[++i]);
    else if (x === '--manter') a.manter = true;
    else if (x === '--referencia') a.referencia = argv[++i];
    else if (!a.arquivo && !x.startsWith('--')) a.arquivo = x;
    else throw new Error(`Opção desconhecida: ${x}`);
  }
  if (!a.arquivo) throw new Error('Informe o arquivo: npm run backup:teste-restauracao -- "<arquivo>.cifrado.json" --tarefa <id> --entregas <n>');
  if (a.tarefa !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(a.tarefa)) throw new Error('Id de tarefa inválido.');
  if (a.entregas !== null && !(Number.isInteger(a.entregas) && a.entregas >= 0)) throw new Error('Número de entregas inválido.');
  return a;
}

const titulo = (n, t) => console.log(`\n[${n}/7] ${t}`);
const pausar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Depois de o Docker reiniciar, o banco local leva alguns segundos para se recuperar e a 1ª tentativa
// pode responder "not ready". Tenta até 3 vezes, com pausa, antes de desistir.
export function subirComRepeticao(rodar, { tentativas = 3, pausaMs = 15000 } = {}) {
  for (let i = 1; i <= tentativas; i++) {
    if (rodar(['start', '--network-id', REDE_LOCAL, '-x', SERVICOS_DESLIGADOS])) return true;
    if (i < tentativas) { console.log(`       o banco local ainda não estava pronto; nova tentativa em ${pausaMs / 1000} s (${i + 1}/${tentativas})...`); pausar(pausaMs); }
  }
  return false;
}
// No Windows, "npx" é um .cmd e só roda pelo cmd.exe. Para não cair no aviso DEP0190 do Node (lista de
// argumentos com shell), a linha é montada aqui. Os argumentos são sempre FIXOS deste arquivo (nunca
// vêm do usuário). Vai entre aspas o que tiver espaço, aspas ou um caractere que o cmd.exe interpreta
// (| & < > ^ ( ) %): achado no Windows do Igor, o "|" do formato do docker ps virava um "pipe".
export function linhaDeComando(cmd, args) {
  return [cmd, ...args].map((a) => (/[\s"|&<>^()%!]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)).join(' ');
}
function rodar(cmd, args, opcoes) {
  if (process.platform === 'win32') return spawnSync(linhaDeComando(cmd, args), { ...opcoes, shell: true });
  return spawnSync(cmd, args, opcoes);
}
// Cria (ou recria) a rede do teste com as portas presas a 127.0.0.1.
export function prepararRedeLocal(executar = (a) => rodar('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  const v = executar(['network', 'inspect', REDE_LOCAL, '--format', '{{json .Options}}']);
  if (v.status === 0) {
    let op = {};
    try { op = JSON.parse(String(v.stdout).trim() || '{}') || {}; } catch (e) { op = {}; }
    if (op['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1') return;
    executar(['network', 'rm', REDE_LOCAL]);
  }
  const c = executar(['network', 'create', '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', REDE_LOCAL]);
  if (c.status !== 0) throw new Error('Não consegui criar a rede local do Docker (feche outros testes abertos e tente de novo).');
}

// Lê a saída de "docker ps --format {{.Names}}|{{.Ports}}" e devolve as portas abertas para FORA deste computador.
export function portasAbertasParaRede(texto) {
  const abertas = [];
  for (const linha of String(texto).split(/\r?\n/).filter(Boolean)) {
    const [nome, portas = ''] = linha.split('|');
    for (const m of portas.matchAll(/([0-9.]+|\[[0-9a-f:]*\]):(\d+)->/gi)) {
      if (m[1] !== '127.0.0.1' && m[1] !== '[::1]') abertas.push(`${nome} ${m[1]}:${m[2]}`);
    }
  }
  return abertas;
}

function supabase(args, { mostrar = true } = {}) {
  const viaEnv = process.env.SUPABASE_CLI;
  const [cmd, base] = viaEnv ? [viaEnv, []] : ['npx', ['--yes', `supabase@${CLI_VERSAO}`]];
  return rodar(cmd, [...base, ...args], { cwd: RAIZ, encoding: 'utf8', stdio: mostrar ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  const [maior] = process.versions.node.split('.').map(Number);
  if (maior < 20) throw new Error(`Node.js ${process.versions.node} é antigo demais: instale o Node.js 20 ou mais novo.`);

  titulo(1, 'Conferências antes de começar');
  if (!fs.existsSync(a.arquivo)) throw new Error('Arquivo não encontrado. Confira o caminho entre aspas.');
  const aberto = N.abrirArquivo(fs.readFileSync(a.arquivo, 'utf8'));
  if (aberto.tipo !== 'cifrado') throw new RecusaLocal('RECUSADO: este teste só aceita o backup CIFRADO (.cifrado.json).');
  if (fs.existsSync(path.join(RAIZ, 'supabase', '.temp', 'project-ref'))) throw new RecusaLocal('RECUSADO: esta pasta está ligada a um projeto Supabase remoto (supabase/.temp/project-ref). Use uma cópia limpa do projeto.');
  const docker = rodar('docker', ['info'], { stdio: 'ignore' });
  if (docker.status !== 0) throw new Error('O Docker não está pronto. Abra o Docker Desktop, espere aparecer "Engine running" e rode de novo.');
  try { require.resolve('postgres'); } catch (e) { throw new Error('Faltam as peças do projeto nesta pasta. Rode antes: npm.cmd ci --omit=dev --ignore-scripts'); }
  const referencia = JSON.parse(fs.readFileSync(a.referencia, 'utf8'));
  console.log('ok     backup cifrado · projeto sem ligação remota · Docker pronto');

  titulo(2, 'Abrir e conferir o backup (espere o pedido; a senha não aparece na tela; cole e aperte Enter; 3 tentativas)');
  const b = await abrirBackup(a.arquivo);
  console.log(`ok     backup íntegro: ${b.conferencia.total} documentos · impressão digital ${b.conferencia.sha256}`);

  let subiu = false;
  try {
    titulo(3, 'Subir o Supabase LOCAL e montar o banco só com as 4 migrações (a 1ª vez baixa cerca de 2 GB)');
    subiu = true;
    prepararRedeLocal();
    if (!subirComRepeticao((args) => supabase(args).status === 0)) throw new Error('O Supabase local não subiu (veja a mensagem acima). Confira se o Docker Desktop está aberto e tente de novo.');
    if (supabase(['db', 'reset', '--network-id', REDE_LOCAL]).status !== 0) throw new Error('Não consegui remontar o banco local (veja a mensagem acima).');
    const st = supabase(['status', '-o', 'json'], { mostrar: false });
    const url = JSON.parse(st.stdout).DB_URL;
    exigirBancoLocal(url);
    const ps = rodar('docker', ['ps', '--filter', 'name=_labz-local', '--format', '{{.Names}}|{{.Ports}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const abertas = portasAbertasParaRede(ps.stdout);
    if (ps.status !== 0 || !/127\.0\.0\.1:\d+->5432/.test(ps.stdout) || abertas.length) {
      const linhaBanco = String(ps.stdout || '').split(/\r?\n/).find((l) => /supabase_db_/.test(l));
      const motivo = abertas.length ? `aberto em ${abertas.join(', ')}` : ps.status !== 0 ? 'o Docker não respondeu à conferência das portas' : `porta do banco: ${linhaBanco ? linhaBanco.split('|')[1] || 'sem porta' : 'não encontrada'}`;
      throw new RecusaLocal(`RECUSADO: não foi possível confirmar que o banco local só aceita conexões deste computador (${motivo}). Nada foi restaurado.`);
    }
    console.log('ok     o banco local só aceita conexões deste computador (127.0.0.1)');
    console.log('ok     banco LOCAL pronto (127.0.0.1), montado do zero pelas migrações');

    titulo(4, 'Pausar o relógio automático LOCAL durante o teste');
    const sql = conectarLocal(url);
    try {
      const r = await sql.unsafe("select cron.alter_job(jobid, active := false) from cron.job where jobname = 'labz-worker-tique'");
      if (r.length !== 1) throw new Error('relógio local não encontrado');
    } finally { await sql.end({ timeout: 2 }); }
    console.log('ok     relógio local pausado (só neste computador)');

    titulo(5, 'Restaurar numa transação (só no banco local)');
    const banco = await restaurar(b, url);
    console.log(`ok     ${banco.total} documentos restaurados · impressão digital no banco ${banco.sha256}`);

    titulo(6, 'Conferir a restauração');
    const r = await conferirRestauracao(url, { cabecalho: b.doc.cabecalho, tarefa: a.tarefa, entregasEsperadas: a.entregas, referencia, cronPausado: true });
    imprimir(r);
    const falhas = r.filter((x) => !x.ok).length;
    console.log(`\nRESULTADO: ${falhas ? `REPROVADO (${falhas} de ${r.length} conferências falharam)` : `APROVADO (${r.length} de ${r.length} conferências)`}`);
    process.exitCode = falhas ? 1 : 0;
  } finally {
    if (subiu && !a.manter) {
      titulo(7, 'Desligar o Supabase local e APAGAR os dados restaurados deste computador');
      const p = supabase(['stop', '--no-backup', '--network-id', REDE_LOCAL]);
      rodar('docker', ['network', 'rm', REDE_LOCAL], { stdio: 'ignore' });
      console.log(p.status === 0 ? 'ok     banco local apagado (o arquivo cifrado continua guardado com você)' : 'ATENÇÃO: não consegui desligar; rode: npx supabase stop --no-backup');
    } else if (subiu) console.log('\n[7/7] --manter: o banco local continua ligado. Para apagar: npx.cmd supabase@2.122.0 stop --no-backup');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`\nERRO: ${String(e.message).slice(0, 400)}`);
    console.log('RESULTADO: INTERROMPIDO');
    process.exitCode = e instanceof RecusaLocal ? 3 : 1;
  });
}
