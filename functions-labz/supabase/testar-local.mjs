#!/usr/bin/env node
// LABZ AI — Fase S3: teste no SUPABASE LOCAL (Docker), com as Edge Functions de verdade no
// Edge Runtime, o banco com as 3 migrações (pg_net, pg_cron e Vault) e os gatilhos ligados.
// NADA de projeto real: tudo na máquina, com segredos FICTÍCIOS gerados na hora e apagados no fim.
//
// Antes:  supabase start            (na pasta functions-labz; aplica as migrações)
// Rodar:  SUPABASE_CLI=supabase node supabase/testar-local.mjs
//
// O que é conferido:
//  1. labz-api no Edge Runtime: CORS, método, recusa de token ausente/ inválido (falha FECHADA);
//  2. labz-worker no Edge Runtime: sem acionamento, assinatura forjada e REPETIÇÃO → 401; válido → 202;
//  3. de ponta a ponta: tarefas criadas (pelo backend, com a chave de teste injetada SÓ neste
//     processo) → gatilho da fila → pg_net → labz-worker → concluídas; com a parada suave curta,
//     a tarefa passa por VÁRIAS chamadas encadeadas pelo próprio gatilho;
//  4. pg_cron agendado e labz.tique() chamando o worker;
//  5. a API REST do Supabase (chave anon, pública) não alcança o schema labz.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = process.env.SUPABASE_CLI || 'supabase';
const postgres = require('postgres');
const { montarApi } = require('../src/borda/montagem');
const { assinar } = require('../src/borda/acionamento');
const { PROJETO, emitir, obterChaves } = require('../test/ajuda-token');

const PAPEL = 'labz_borda_teste';
const SENHA = `local-${crypto.randomBytes(9).toString('hex')}`; // fictícia, só desta rodada
const SEGREDO = crypto.randomBytes(32).toString('hex'); // fictício, só desta rodada
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const conferir = (cond, nome, extra = '') => { console.log(`${cond ? 'ok  ' : 'FALHOU'} ${nome}${extra ? ` — ${extra}` : ''}`); if (!cond) falhas++; };

const status = JSON.parse(execFileSync(CLI, ['status', '-o', 'json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const projeto = /project_id = "([^"]+)"/.exec(fs.readFileSync(path.join(RAIZ, 'supabase', 'config.toml'), 'utf8'))[1];
const FUNCS = status.FUNCTIONS_URL || `${status.API_URL}/functions/v1`;
const ANON = status.ANON_KEY || status.PUBLISHABLE_KEY;
const admin = postgres(status.DB_URL, { max: 4, onnotice: () => {} });

async function prepararBanco() {
  await admin.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${PAPEL}') then create role ${PAPEL} login in role labz_app; end if;
  end $$;`);
  await admin.unsafe(`alter role ${PAPEL} with login password '${SENHA}'`);
  await admin`delete from vault.secrets where name in ('labz_worker_url', 'labz_worker_segredo')`;
  await admin`select vault.create_secret(${`http://supabase_kong_${projeto}:8000/functions/v1/labz-worker`}, 'labz_worker_url')`;
  await admin`select vault.create_secret(${SEGREDO}, 'labz_worker_segredo')`;
}

async function limparBanco() {
  await admin`delete from vault.secrets where name in ('labz_worker_url', 'labz_worker_segredo')`.catch(() => {});
  await admin.unsafe(`alter role ${PAPEL} with nologin password null`).catch(() => {});
}

// Só para ambientes de teste atrás de um proxy que reassina o TLS (ex.: o sandbox do Claude Code):
// LABZ_TESTE_CA=/caminho/ca.crt faz o Edge Runtime local confiar nele ao baixar os tipos do npm.
// A cópia fica na pasta das funções (a única que o contêiner enxerga) e é APAGADA no fim.
const CA_TESTE = process.env.LABZ_TESTE_CA ? path.join(RAIZ, 'supabase', 'functions', '.labz-teste-ca.crt') : null;

function servirFuncoes() {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'labz-')), 'funcoes.env');
  if (CA_TESTE) fs.copyFileSync(process.env.LABZ_TESTE_CA, CA_TESTE);
  fs.writeFileSync(arq, [
    ...(CA_TESTE ? [`DENO_CERT=${CA_TESTE}`] : []),
    `LABZ_DB_URL=postgresql://${PAPEL}:${SENHA}@db:5432/postgres`,
    'LABZ_SUPERADMIN_UIDS=sa',
    `LABZ_FIREBASE_PROJETO=${PROJETO}`,
    `LABZ_WORKER_SEGREDO=${SEGREDO}`,
    'LABZ_WORKER_PARADA_SUAVE_MS=1', // parada suave mínima: UMA etapa por chamada (para provar o encadeamento)
    'LABZ_WORKER_LIMITE_MS=60000',
    '',
  ].join('\n'), { mode: 0o600 });
  const p = spawn(CLI, ['functions', 'serve', '--env-file', arq], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  return { p, log: () => log, apagar: () => { fs.rmSync(path.dirname(arq), { recursive: true, force: true }); if (CA_TESTE) fs.rmSync(CA_TESTE, { force: true }); } };
}

async function http(url, opcoes = {}) {
  const r = await fetch(url, opcoes);
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch (e) { corpo = texto; }
  return { status: r.status, corpo, headers: r.headers };
}

async function esperarFuncao() {
  for (let i = 0; i < 90; i++) {
    try { const r = await http(`${FUNCS}/labz-api`, { method: 'GET' }); if (r.status === 405) return true; } catch (e) { /* subindo */ }
    await espera(1000);
  }
  return false;
}

(async () => {
  await prepararBanco();
  const serv = servirFuncoes();
  let codigo = 1;
  try {
    const subiu = await esperarFuncao();
    conferir(subiu, 'as duas funções sobem no Edge Runtime', serv.log().split('\n').find((l) => /edge-runtime|Serving/i.test(l)) || '');
    if (!subiu) console.log(`--- registro do Edge Runtime (valores de teste, fictícios) ---\n${serv.log().slice(-4000)}`);

    // ---------- 1. labz-api no Edge Runtime ----------
    const api = `${FUNCS}/labz-api`;
    const pre = await http(api, { method: 'OPTIONS', headers: { origin: 'https://eagleslabz.com.br' } });
    // ATENÇÃO (achado do teste): o gateway LOCAL (Kong) responde sozinho ao pré-voo e põe
    // "Access-Control-Allow-Origin: *" em tudo. Por isso a função confere a origem NO SERVIDOR:
    // outra origem recebe 403 antes de qualquer trabalho (e o login vai no cabeçalho, sem cookie).
    conferir(pre.status >= 200 && pre.status < 300, 'API: pré-voo do navegador respondido', `${pre.status}, allow-origin ${pre.headers.get('access-control-allow-origin')} (posto pelo gateway)`);
    const docsAntes = (await admin`select count(*)::int as n from labz.docs`)[0].n;
    const outra = await http(api, { method: 'POST', headers: { origin: 'https://site-malicioso.example', 'content-type': 'application/json' }, body: '{"acao":"catalogo.agentes"}' });
    conferir(outra.status === 403, 'API: outra origem → 403 no servidor (mesmo com o * do gateway)');
    const semToken = await http(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"acao":"catalogo.agentes"}' });
    conferir(semToken.status === 401, 'API: sem token → 401', JSON.stringify(semToken.corpo));
    const lixo = await http(api, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc.def.ghi' }, body: '{"acao":"catalogo.agentes"}' });
    conferir(lixo.status === 401, 'API: token inválido → 401');
    // token bem formado, mas assinado por uma chave que NÃO é do Google: a função só confia nas
    // chaves do Google (sem rede no contêiner, nem baixa: falha FECHADA) → 401
    const falso = await http(api, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${emitir()}` }, body: '{"acao":"catalogo.agentes"}' });
    conferir(falso.status === 401, 'API: token assinado por chave de teste NÃO é aceito pela função real → 401');
    // S5B, Etapa 6: recusas vão só para o LOG da função; nenhuma gravação no banco
    const docsDepois = (await admin`select count(*)::int as n from labz.docs`)[0].n;
    conferir(docsDepois === docsAntes, 'API: recusas NÃO gravam no banco (só no log da função)', `documentos antes ${docsAntes}, depois ${docsDepois}`);
    conferir((await http(api, { method: 'GET' })).status === 405, 'API: GET → 405');

    // ---------- 2. labz-worker no Edge Runtime ----------
    const wk = `${FUNCS}/labz-worker`;
    conferir((await http(wk, { method: 'POST', body: '{}' })).status === 401, 'worker: sem acionamento → 401');
    const forjado = { id: `acn_${crypto.randomBytes(16).toString('hex')}`, tempo: Math.floor(Date.now() / 1000), motivo: 'manual' };
    const cabForjado = { 'x-labz-acionamento': forjado.id, 'x-labz-tempo': String(forjado.tempo), 'x-labz-motivo': 'manual', 'x-labz-assinatura': `v1=${assinar(SEGREDO, forjado.id, forjado.tempo, 'manual')}` };
    conferir((await http(wk, { method: 'POST', headers: cabForjado, body: '{}' })).status === 401, 'worker: assinatura CERTA mas acionamento não registrado no banco → 401');
    const [a] = await admin`select * from labz.criar_acionamento('manual', ${SEGREDO})`;
    const cab = { 'x-labz-acionamento': a.id, 'x-labz-tempo': String(a.tempo), 'x-labz-motivo': a.motivo, 'x-labz-assinatura': `v1=${a.assinatura}` };
    conferir((await http(wk, { method: 'POST', headers: Object.assign({}, cab, { 'x-labz-assinatura': `v1=${'0'.repeat(64)}` }), body: '{}' })).status === 401, 'worker: assinatura forjada → 401');
    conferir((await http(wk, { method: 'POST', headers: cab, body: '{}' })).status === 202, 'worker: acionamento válido → 202 (trabalha ao fundo)');
    conferir((await http(wk, { method: 'POST', headers: cab, body: '{}' })).status === 401, 'worker: o MESMO acionamento de novo (replay) → 401');

    // ---------- 2b. S5B Etapa 10: interruptor, tique econômico, limpeza do cron, worker sem Verify JWT ----------
    const sqlApp = postgres(status.DB_URL.replace('postgres:postgres@', `${PAPEL}:${SENHA}@`), { max: 4, prepare: false, onnotice: () => {} });
    const interruptor = async (dados) => (dados === null
      ? admin`delete from labz.docs where caminho = 'labz_config/worker'`
      : admin`insert into labz.docs (caminho, colecao, id, dados) values ('labz_config/worker', 'labz_config', 'worker', ${dados}::text::json) on conflict (caminho) do update set dados = excluded.dados`);
    const ativo = async () => (await admin`select labz.worker_ativo() as a`)[0].a;
    const nAcion = async () => (await admin`select count(*)::int as n from labz.acionamentos`)[0].n;
    const nPedidos = async () => (await admin`select count(*)::int as n from net.http_request_queue`)[0].n + (await admin`select count(*)::int as n from net._http_response`)[0].n;
    const inicial = (await admin`select dados::text as t from labz.docs where caminho = 'labz_config/worker'`)[0];
    conferir(inicial && inicial.t === '{"ativo":false}' && (await ativo()) === false, 'interruptor: a migração cria labz_config/worker DESLIGADO', inicial && inicial.t);
    let listaRecusada = false;
    try { await interruptor('[true]'); } catch (e) { listaRecusada = /docs_objeto/.test(e.message); }
    conferir(listaRecusada, 'interruptor: valor que não é objeto (lista) nem chega a ser gravado (regra docs_objeto)');
    const formatos = [[null, false, 'registro ausente'], ['{"ativo":"true"}', false, 'texto "true"'], ['{"ativo":1}', false, 'número 1'], ['{"ligado":true}', false, 'sem o campo'], ['{"ativo":null}', false, 'nulo'], ['{"ativo":true}', true, 'booleano true']];
    for (const [d, esperado, nome] of formatos) { await interruptor(d); conferir((await ativo()) === esperado, `interruptor: ${nome} → ${esperado ? 'LIGADO' : 'desligado'}`); }
    await interruptor('{"ativo":false}');
    // desligado: nem a fila nem o tique chamam o worker (mesmo havendo trabalho)
    const a0 = await nAcion(); const p0 = await nPedidos();
    await admin`insert into labz.docs (caminho, colecao, id, dados) values ('labz_fila/teste10', 'labz_fila', 'teste10', '{"estado":"pendente"}'::json)`;
    conferir((await admin`select labz.ha_trabalho() as h`)[0].h === true, 'tique econômico: item pendente na fila = há trabalho');
    conferir((await admin`select labz.tique() as r`)[0].r === null && (await admin`select labz.acionar_worker('cron') as r`)[0].r === null && (await admin`select labz.acionar_worker('fila') as r`)[0].r === null, 'interruptor DESLIGADO: gatilho, tique, "cron" e "fila" não chamam nada');
    await espera(1500);
    conferir((await nAcion()) === a0 && (await nPedidos()) === p0, 'interruptor DESLIGADO: nenhum acionamento criado e nenhum pedido HTTP', `acionamentos ${a0}→${await nAcion()}, pedidos ${p0}→${await nPedidos()}`);
    await admin`delete from labz.docs where caminho = 'labz_fila/teste10'`;
    // ligado, mas sem trabalho: o tique não chama
    await interruptor('{"ativo":true}');
    conferir((await admin`select labz.ha_trabalho() as h`)[0].h === false, 'tique econômico: fila e tarefas vazias = sem trabalho');
    conferir((await admin`select labz.tique() as r`)[0].r === null && (await nAcion()) === a0, 'tique LIGADO e SEM trabalho: não chama o worker');
    await interruptor('{"ativo":false}');
    // o acionamento manual (só o dono do banco) funciona com o interruptor desligado, para o teste controlado
    const pm = (await admin`select labz.acionar_worker('manual') as r`)[0].r;
    let consumidoManual = 0;
    for (let i = 0; i < 20 && !consumidoManual; i++) { await espera(500); consumidoManual = (await admin`select count(*)::int as n from labz.acionamentos where motivo = 'manual' and consumido_em is not null`)[0].n; }
    conferir(pm !== null && consumidoManual >= 1, 'acionamento MANUAL com o interruptor desligado: o worker recebe e consome (teste controlado da Etapa 10.5)');
    // permissões: o papel das funções não chama nada disso
    for (const f of ['labz.worker_ativo()', 'labz.ha_trabalho()', 'labz.tique()', 'labz.limpar_historico_cron()', "labz.acionar_worker('manual')"]) {
      let negado = false; try { await sqlApp.unsafe(`select ${f}`); } catch (e) { negado = /permission denied/.test(e.message); }
      conferir(negado, `permissão: o login das funções NÃO executa ${f}`);
    }
    // limpeza do histórico do cron: só o job da LABZ AI; falhas guardadas 30 dias
    await admin`select cron.schedule('outro-sistema-teste', '0 0 1 1 *', 'select 1')`;
    const ids = Object.fromEntries((await admin`select jobname, jobid from cron.job where jobname in ('labz-worker-tique', 'outro-sistema-teste')`).map((j) => [j.jobname, j.jobid]));
    const runIds = [990000001, 990000002, 990000003, 990000004, 990000005];
    await admin`delete from cron.job_run_details where runid in ${admin(runIds)}`;
    await admin`insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time) values
      (${ids['labz-worker-tique']}, 990000001, 1, 'postgres', 'postgres', 'select labz.tique()', 'succeeded', '1 row', now() - interval '8 days', now() - interval '8 days'),
      (${ids['labz-worker-tique']}, 990000002, 1, 'postgres', 'postgres', 'select labz.tique()', 'failed', 'erro', now() - interval '8 days', now() - interval '8 days'),
      (${ids['labz-worker-tique']}, 990000003, 1, 'postgres', 'postgres', 'select labz.tique()', 'failed', 'erro', now() - interval '31 days', now() - interval '31 days'),
      (${ids['labz-worker-tique']}, 990000004, 1, 'postgres', 'postgres', 'select labz.tique()', 'succeeded', '1 row', now() - interval '1 day', now() - interval '1 day'),
      (${ids['outro-sistema-teste']}, 990000005, 1, 'postgres', 'postgres', 'select 1', 'succeeded', '1 row', now() - interval '90 days', now() - interval '90 days')`;
    const apagados = (await admin`select labz.limpar_historico_cron() as n`)[0].n;
    const sobram = (await admin`select runid from cron.job_run_details where runid in ${admin(runIds)} order by runid`).map((r) => Number(r.runid) - 990000000);
    conferir(apagados === 2 && JSON.stringify(sobram) === '[2,4,5]', 'limpeza do cron: apaga só da LABZ AI (ok > 7 dias, falha > 30 dias); falha recente e o job de OUTRO sistema ficam', `apagados ${apagados}, sobram ${sobram.join(',')}`);
    await admin`delete from cron.job_run_details where runid in ${admin(runIds)}`;
    await admin`select cron.unschedule('outro-sistema-teste')`;
    // worker sem Verify JWT: um login (de qualquer tipo) não serve; só o acionamento assinado
    conferir((await http(wk, { method: 'POST', headers: { authorization: `Bearer ${emitir()}`, 'content-type': 'application/json' }, body: '{}' })).status === 401, 'worker sem Verify JWT: login no lugar do acionamento → 401');
    conferir((await http(wk, { method: 'POST', headers: { authorization: `Bearer ${ANON}`, 'content-type': 'application/json' }, body: '{}' })).status === 401, 'worker sem Verify JWT: chave pública do projeto → 401');

    // ---------- 3. de ponta a ponta: gatilho da fila → pg_net → worker ----------
    await interruptor('{"ativo":true}');
    // limites folgados: este processo consulta o estado a cada segundo (o limite real tem teste próprio)
    const local = montarApi({ sql: sqlApp, config: { uidsSuperAdmin: 'sa', projetoFirebase: PROJETO, origens: 'https://eagleslabz.com.br', limites: { porMinuto: 100000, tarefasPorHora: 1000 } }, obterChaves });
    await local.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super (teste local)' });
    await local.banco.gravar('labz_config/acesso', { uids: ['sa'] });
    const chamar = async (acao, dados) => {
      const r = await local.handler(new Request('http://local/labz-api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${emitir()}`, origin: 'https://eagleslabz.com.br' }, body: JSON.stringify({ acao, dados }) }));
      const c = await r.json();
      if (r.status !== 200) throw new Error(`${acao}: ${r.status} ${JSON.stringify(c)}`);
      return c.resultado;
    };
    const A = await chamar('empresas.criar', { empresa: { nome: `Marca Local Alfa ${Date.now()}` } });
    const B = await chamar('empresas.criar', { empresa: { nome: `Marca Local Beta ${Date.now()}` } });
    const inicio = Date.now();
    const tarefas = [
      await chamar('execucoes.pedido', { empresaId: A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' }),
      await chamar('execucoes.pedido', { empresaId: B.id, objetivo: 'Escrever as legendas da semana.' }),
    ];
    let estados = [];
    for (let i = 0; i < 120; i++) {
      estados = await Promise.all(tarefas.map((t) => chamar('execucoes.obter', { execucaoId: t.id }).then((e) => e.estado)));
      if (estados.every((e) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(e))) break;
      await espera(1000);
    }
    conferir(estados.every((e) => e === 'COMPLETED'), 'ponta a ponta: as 2 tarefas concluídas SÓ pelos gatilhos (ninguém chamou o worker à mão)', `${estados.join(', ')} em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
    const ex = await Promise.all(tarefas.map((t) => chamar('execucoes.obter', { execucaoId: t.id })));
    const etapas = ex.reduce((n, e) => n + e.etapas.length, 0);
    conferir(ex.every((e) => e.etapas.every((x) => x.tentativas === 1)), 'ponta a ponta: cada etapa executada UMA vez');
    const rodadas = await admin`select dados->'detalhes' as d from labz.docs where colecao = 'labz_eventos' and dados->>'tipo' = 'worker.rodada' order by atualizado_em`;
    const lib = await admin`select count(*)::int as n from labz.docs where colecao = 'labz_eventos' and dados->>'tipo' = 'execucao.execucao_liberada'`;
    conferir(lib[0].n >= 1, 'encadeamento: a tarefa parou ENTRE etapas e o gatilho chamou o worker de novo', `${lib[0].n} paradas suaves, ${rodadas.length} rodadas do worker, ${etapas} etapas`);
    const cpus = rodadas.map((r) => r.d.cpuMs).filter((x) => typeof x === 'number');
    conferir(true, 'medida: CPU por rodada no Edge Runtime', cpus.length ? `máx ${Math.max(...cpus)} ms, média ${(cpus.reduce((s, x) => s + x, 0) / cpus.length).toFixed(0)} ms` : 'process.cpuUsage indisponível no runtime (vale só o orçamento de tempo)');
    const ents = [await chamar('entregas.listar', { empresaId: A.id, limite: 100 }), await chamar('entregas.listar', { empresaId: B.id, limite: 100 })].map((x) => (Array.isArray(x) ? x : x.itens));
    conferir(ents[0].every((e) => e.empresaId === A.id) && ents[1].every((e) => e.empresaId === B.id) && ents[0].length && ents[1].length, 'isolamento: cada empresa só com as próprias entregas');
    const resp = await admin`select status_code, count(*)::int as n from net._http_response group by status_code order by status_code`;
    conferir(resp.some((r) => r.status_code === 202), 'pg_net: o banco chamou o worker e recebeu 202', resp.map((r) => `${r.status_code}×${r.n}`).join(', '));
    const usados = await admin`select count(*)::int as n from labz.acionamentos where consumido_em is not null`;
    conferir(usados[0].n >= rodadas.length - 1, 'cada rodada consumiu o seu acionamento', `${usados[0].n} consumidos`);

    // ---------- 4. pg_cron ----------
    const jobs = await admin`select jobname, schedule from cron.job where jobname = 'labz-worker-tique'`;
    conferir(jobs.length === 1 && jobs[0].schedule === '* * * * *', 'pg_cron: labz-worker-tique a cada 1 minuto');
    // retenção: evento operacional de 40 dias some no tique; evento de decisão antigo fica
    await admin`insert into labz.docs (caminho, colecao, id, dados, atualizado_em) values ('labz_eventos/ev_velho_op', 'labz_eventos', 'ev_velho_op', '{"tipo":"worker.rodada"}'::json, now() - interval '40 days'), ('labz_eventos/ev_velho_dec', 'labz_eventos', 'ev_velho_dec', '{"tipo":"entrega.decidida"}'::json, now() - interval '40 days')`;
    // interruptor DESLIGADO: uma tarefa pedida agora fica parada (nada a aciona)
    await interruptor('{"ativo":false}');
    const parada = await chamar('execucoes.pedido', { empresaId: A.id, objetivo: 'Escrever as legendas da semana.' });
    await espera(4000);
    const estParada = (await chamar('execucoes.obter', { execucaoId: parada.id })).estado;
    conferir(!['COMPLETED', 'FAILED'].includes(estParada), 'interruptor DESLIGADO: tarefa nova fica parada (o gatilho não chama o worker)', estParada);
    // ligou: o tique (cron) vê o trabalho e leva a tarefa até o fim
    await interruptor('{"ativo":true}');
    const antes = (await admin`select count(*)::int as n from labz.acionamentos where motivo = 'cron' and consumido_em is not null`)[0].n;
    let estFinal = estParada;
    for (let i = 0; i < 30 && estFinal !== 'COMPLETED'; i++) { await admin`select labz.tique()`; await espera(1000); estFinal = (await chamar('execucoes.obter', { execucaoId: parada.id })).estado; }
    const depois = (await admin`select count(*)::int as n from labz.acionamentos where motivo = 'cron' and consumido_em is not null`)[0].n;
    conferir(depois > antes && estFinal === 'COMPLETED', 'interruptor LIGADO de novo: o tique (pg_cron) chama o worker e a tarefa parada termina', `acionamentos "cron" consumidos ${antes}→${depois}, ${estFinal}`);
    const restam = await admin`select id from labz.docs where id in ('ev_velho_op', 'ev_velho_dec') order by id`;
    conferir(restam.length === 1 && restam[0].id === 'ev_velho_dec', 'retenção: evento operacional de 40 dias apagado; evento de decisão mantido', restam.map((x) => x.id).join(','));

    // ---------- 5. API REST do Supabase não alcança o schema labz ----------
    const rest = await http(`${status.API_URL}/rest/v1/docs?select=*`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'accept-profile': 'labz' } });
    conferir(rest.status >= 400 && !(Array.isArray(rest.corpo) && rest.corpo.length), 'REST (chave anon): schema labz não exposto', `${rest.status} ${(rest.corpo && rest.corpo.code) || ''}`);
    const rpc = await http(`${status.API_URL}/rest/v1/rpc/criar_acionamento`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-profile': 'labz', 'content-type': 'application/json' }, body: JSON.stringify({ p_motivo: 'manual', p_segredo: SEGREDO }) });
    conferir(rpc.status >= 400, 'REST (chave anon): não cria acionamento', String(rpc.status));
    await sqlApp.end({ timeout: 2 });
    codigo = falhas ? 1 : 0;
    if (falhas && process.env.LABZ_LOG) console.log(serv.log().split('\n').filter((l) => /error|erro|labz-/i.test(l)).slice(-15).join('\n'));
  } catch (e) {
    falhas++; // erro inesperado também é falha (antes, o resumo dizia "tudo certo")
    console.error('erro no teste local:', e);
    console.error(serv.log().slice(-3000));
  } finally {
    serv.p.kill('SIGTERM');
    serv.apagar();
    await limparBanco();
    await admin.end({ timeout: 2 });
  }
  console.log(falhas ? `\n${falhas} conferência(s) falharam` : '\nSupabase local: tudo certo');
  process.exit(codigo);
})();
