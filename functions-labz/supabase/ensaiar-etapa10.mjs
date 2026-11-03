// LABZ AI — S5B, Etapa 10.2: ENSAIO no Supabase local da aplicação da migração 3 sobre um banco
// no MESMO estado do projeto real (migrações 1, 2 e labz_borda + os 3 documentos + Vault vazio),
// e da REVERSÃO. Nada aqui toca o Supabase real.
//   supabase start && supabase db reset
//   SUPABASE_CLI=supabase node supabase/ensaiar-etapa10.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const postgres = require('postgres');
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = process.env.SUPABASE_CLI || 'supabase';
const status = JSON.parse(execFileSync(CLI, ['status', '-o', 'json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const db = postgres(status.DB_URL, { max: 2, onnotice: () => {} });
const MIG3 = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261101000100_labz_gatilhos.sql'), 'utf8');
const REVERTER = fs.readFileSync(path.join(RAIZ, 'supabase', 'reversao', '20261101000100_labz_gatilhos_reverter.sql'), 'utf8');
const UID = 'UidFicticioDeTeste0123456789'; // 28 caracteres, fictício
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const conferir = (c, nome, extra = '') => { console.log(`${c ? 'ok    ' : 'FALHOU'} ${nome}${extra ? ` — ${extra}` : ''}`); if (!c) falhas++; };
const FUNCS = ['worker_ativo()', 'ha_trabalho()', 'acionar_worker(text)', 'ao_entrar_na_fila()', 'limpar_eventos_operacionais()', 'limpar_historico_cron()', 'tique()'];
const PAPEIS = ['anon', 'authenticated', 'service_role', 'labz_app', 'labz_borda'];

const docs = async () => (await db`select caminho, dados::text as t from labz.docs order by caminho`).map((d) => `${d.caminho}=${d.t}`);
const funcoesLabz = async () => (await db`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'labz' order by 1`).map((x) => x.proname);
const temJob = async () => (await db`select count(*)::int as n from cron.job where jobname = 'labz-worker-tique'`)[0].n;
const pedidosHttp = async () => (await db`select count(*)::int as n from net.http_request_queue`)[0].n + (await db`select count(*)::int as n from net._http_response`)[0].n;

try {
  // 0. estado igual ao do projeto real: sem a migração 3, Vault vazio, 3 documentos
  await db.unsafe(REVERTER);
  await db`delete from vault.secrets where name in ('labz_worker_url', 'labz_worker_segredo')`;
  await db`delete from labz.docs`;
  await db`delete from labz.acionamentos`;
  await db`delete from net.http_request_queue`;
  await db`delete from net._http_response`;
  await db`insert into labz.docs (caminho, colecao, id, dados) values
    (${`labz_usuarios/${UID}`}, 'labz_usuarios', ${UID}, '{"role":"SuperAdmin"}'::json),
    ('labz_config/acesso', 'labz_config', 'acesso', ${`{"uids":["${UID}"]}`}::text::json),
    (${`labz_limites/${UID}`}, 'labz_limites', ${UID}, '{"minuto":"2026-11-03T15:41","nMinuto":1,"hora":"2026-11-03T15","nTarefasHora":0,"atualizadoEm":"2026-11-03T15:41:39.000Z"}'::json)`;
  const antes = await docs();
  conferir(antes.length === 3 && (await funcoesLabz()).join() === 'criar_acionamento,limpar_acionamentos,mensagem_acionamento' && (await temJob()) === 0, 'estado inicial = o do projeto real (3 documentos, 3 funções, sem agendamento, Vault vazio)');

  // 1. aplicar a migração 3 (o mesmo arquivo que vai para o projeto real)
  await db.unsafe(MIG3);
  const depois = await docs();
  conferir(antes.every((d) => depois.includes(d)), 'os 3 documentos existentes ficam IDÊNTICOS');
  conferir(depois.length === 4 && depois.includes('labz_config/worker={"ativo":false}'), 'o interruptor é criado com {"ativo":false} (e é o único documento novo)');
  conferir((await db`select labz.worker_ativo() as a`)[0].a === false, 'labz.worker_ativo() = false');
  conferir((await temJob()) === 1, 'agendamento labz-worker-tique criado');
  conferir((await db`select count(*)::int as n from vault.secrets`)[0].n === 0, 'Vault continua vazio');
  // 2. permissões das funções novas: nenhum papel além do dono do banco
  const perms = [];
  for (const r of PAPEIS) for (const f of FUNCS) perms.push(`${r}:${f}=${(await db`select has_function_privilege(${r}, ${`labz.${f}`}, 'execute') as p`)[0].p}`);
  conferir(perms.every((p) => p.endsWith('=false')), `nenhum dos papéis ${PAPEIS.join(', ')} executa as ${FUNCS.length} funções`, perms.filter((p) => p.endsWith('=true')).join(', ') || 'todas negadas');
  // 3. interruptor desligado: nada sai, nem pelo gatilho, nem pelo tique, nem pelo cron de verdade
  await db`insert into labz.docs (caminho, colecao, id, dados) values ('labz_fila/ensaio', 'labz_fila', 'ensaio', '{"estado":"pendente"}'::json)`;
  await db`select labz.tique()`;
  console.log('       (esperando o pg_cron rodar o tique sozinho, até 75 s...)');
  let rodou = 0;
  for (let i = 0; i < 75 && !rodou; i++) { await espera(1000); rodou = (await db`select count(*)::int as n from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'labz-worker-tique' and d.status = 'succeeded'`)[0].n; }
  conferir(rodou >= 1, 'o pg_cron rodou o tique sozinho, com sucesso');
  conferir((await db`select count(*)::int as n from labz.acionamentos`)[0].n === 0 && (await pedidosHttp()) === 0, 'com o interruptor DESLIGADO (e trabalho na fila): 0 acionamentos e 0 pedidos ao worker');
  await db`delete from labz.docs where caminho = 'labz_fila/ensaio'`;
  // 4. reversão: tudo da migração 3 sai; os 3 documentos ficam
  await db.unsafe(REVERTER);
  conferir((await temJob()) === 0 && (await funcoesLabz()).join() === 'criar_acionamento,limpar_acionamentos,mensagem_acionamento', 'REVERSÃO: agendamento e funções novas removidos');
  conferir((await db`select count(*)::int as n from pg_trigger where tgrelid = 'labz.docs'::regclass and not tgisinternal`)[0].n === 0, 'REVERSÃO: gatilho da fila removido');
  conferir(JSON.stringify(await docs()) === JSON.stringify(antes), 'REVERSÃO: os 3 documentos ficam idênticos e o interruptor sai');
  // 5. aplicar de novo (ida e volta) e mais uma vez por cima (idempotente)
  await db.unsafe(MIG3);
  await db`update labz.docs set dados = '{"ativo":true}'::json where caminho = 'labz_config/worker'`;
  await db.unsafe(MIG3);
  conferir((await db`select dados::text as t from labz.docs where caminho = 'labz_config/worker'`)[0].t === '{"ativo":true}', 'reaplicar a migração NÃO religa nem desliga um interruptor que já existe');
  conferir((await temJob()) === 1 && (await docs()).length === 4, 'reaplicar não duplica o agendamento nem os documentos');
  await db.unsafe(REVERTER);
  conferir(JSON.stringify(await docs()) === JSON.stringify(antes), 'estado final do ensaio = estado inicial');
} catch (e) {
  falhas++;
  console.error('erro no ensaio:', e.message);
} finally {
  await db.end({ timeout: 2 });
}
console.log(falhas ? `\n${falhas} conferência(s) falharam` : '\nEnsaio da Etapa 10.2: tudo certo');
process.exit(falhas ? 1 : 0);
