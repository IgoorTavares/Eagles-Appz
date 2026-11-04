// Fase S3 no PostgreSQL de verdade (só roda com LABZ_PG_URL; sem ele, fica "pulado"):
//   - migração 2 (acionamentos): idempotente; assinatura feita PELO BANCO confere no JS;
//   - o worker consome cada acionamento UMA vez (10 chamadas iguais ao mesmo tempo → 1 passa);
//   - permissões mínimas: o papel do servidor não cria acionamento nem muda o que foi assinado;
//     o navegador (anon/authenticated) não lê nada;
//   - de ponta a ponta com um LOGIN de teste membro de labz_app (o que a Edge Function usa):
//     API (HTTP) cria empresas e tarefas → banco cria o acionamento → worker (HTTP) executa →
//     tarefas concluídas, cada empresa só com as próprias entregas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sqlMigracao } = require('../src/armazenamento/postgres-migracao');
const { montarApi, montarWorker } = require('../src/borda/montagem');
const { PROJETO, emitir, obterChaves } = require('./ajuda-token');

const URL_PG = process.env.LABZ_PG_URL;
const pular = !URL_PG && 'defina LABZ_PG_URL (npm run test:postgres)';
const SEGREDO = 'segredo-de-teste-ficticio-com-mais-de-32-caracteres';
const SENHA_TESTE = 'teste-local-ficticio';
const PAPEL_LOGIN = 'labz_borda_teste';
const MIG2 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261101000000_labz_acionamentos.sql'), 'utf8');

let admin;
let app; // conexão como o LOGIN de teste (membro de labz_app), igual à da Edge Function
async function preparar() {
  if (app) return;
  const postgres = require('postgres');
  admin = postgres(URL_PG, { max: 12, idle_timeout: 1, onnotice: () => {} });
  for (const p of ['anon', 'authenticated']) await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${p}') then create role ${p} nologin; end if; end $$;`);
  await admin.unsafe(sqlMigracao('labz'));
  await admin.unsafe(MIG2);
  await admin.unsafe(MIG2); // idempotente
  await admin.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${PAPEL_LOGIN}') then create role ${PAPEL_LOGIN} login password '${SENHA_TESTE}' in role labz_app; end if;
  exception when duplicate_object or unique_violation then null; end $$;`);
  await admin.unsafe(`grant connect on database ${(await admin`select current_database() as d`)[0].d} to ${PAPEL_LOGIN}`);
  const u = new URL(URL_PG);
  u.username = PAPEL_LOGIN;
  u.password = SENHA_TESTE;
  app = postgres(u.toString(), { max: 12, idle_timeout: 1, onnotice: () => {}, prepare: false });
}
const criarAcionamento = async (motivo = 'fila') => (await admin`select * from labz.criar_acionamento(${motivo}, ${SEGREDO})`)[0];
const cabecalhos = (a) => ({ 'x-labz-acionamento': a.id, 'x-labz-tempo': String(a.tempo), 'x-labz-motivo': a.motivo, 'x-labz-assinatura': `v1=${a.assinatura}` });
const chamarWorker = (h, a) => h(new Request('http://local/labz-worker', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, a ? cabecalhos(a) : {}), body: '{}' }));

test('migração 2 + permissões: só o banco cria acionamentos; o servidor só consome; o navegador não vê nada', { skip: pular }, async () => {
  await preparar();
  const a = await criarAcionamento('cron');
  assert.match(a.id, /^acn_[0-9a-f]{32}$/);
  assert.match(a.assinatura, /^[0-9a-f]{64}$/);
  await assert.rejects(app`select * from labz.criar_acionamento('fila', ${SEGREDO})`, /permission denied/, 'o servidor não cria acionamento');
  await assert.rejects(app`insert into labz.acionamentos (id, motivo, tempo) values (${`acn_${'f'.repeat(32)}`}, 'fila', 1)`, /permission denied/);
  await assert.rejects(app`update labz.acionamentos set tempo = 1 where id = ${a.id}`, /permission denied/, 'não muda o que foi assinado');
  await assert.rejects(app`delete from labz.acionamentos where id = ${a.id}`, /permission denied/);
  for (const papel of ['anon', 'authenticated']) {
    await assert.rejects(admin.begin(async (tx) => { await tx.unsafe(`set local role ${papel}`); return tx.unsafe('select * from labz.acionamentos'); }), /permission denied/, papel);
    await assert.rejects(admin.begin(async (tx) => { await tx.unsafe(`set local role ${papel}`); return tx.unsafe(`select labz.criar_acionamento('fila', '${SEGREDO}')`); }), /permission denied/, papel);
  }
  await assert.rejects(admin`select * from labz.criar_acionamento('fila', 'curto')`, /segredo/);
  await assert.rejects(admin`select * from labz.criar_acionamento('outro', ${SEGREDO})`, /acionamentos_motivo/);
});

test('acionamento: a assinatura do banco confere no worker, vale UMA vez (10 cópias ao mesmo tempo → 1) e expira', { skip: pular }, async () => {
  await preparar();
  let rodadas = 0;
  const { handler } = montarWorker({ sql: app, config: { segredoWorker: SEGREDO } });
  const contar = { rodar: async () => { rodadas++; return {}; } };
  // o handler real com um worker que só conta (o fluxo completo é o teste de baixo)
  const { criarHandlerWorker } = require('../src/borda/http');
  const { criarVerificadorAcionamento, consumirPostgres } = require('../src/borda/acionamento');
  const verificar = criarVerificadorAcionamento({ segredo: SEGREDO, consumir: consumirPostgres(app) });
  const h = criarHandlerWorker({ verificarAcionamento: verificar, worker: contar });
  const a = await criarAcionamento('fila');
  const respostas = await Promise.all(Array.from({ length: 10 }, () => chamarWorker(h, a)));
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 401, 401, 401, 401, 401, 401, 401, 401, 401]);
  assert.equal(rodadas, 1, 'só uma rodada para o mesmo acionamento');
  const marcado = (await admin`select consumido_em, consumido_por from labz.acionamentos where id = ${a.id}`)[0];
  assert.ok(marcado.consumido_em && marcado.consumido_por === 'worker');
  // assinatura de outro segredo, sem cabeçalhos e acionamento velho
  assert.equal((await chamarWorker(h, Object.assign({}, await criarAcionamento(), { assinatura: 'a'.repeat(64) }))).status, 401);
  assert.equal((await chamarWorker(h, null)).status, 401);
  const velho = await criarAcionamento();
  await admin`update labz.acionamentos set criado_em = now() - interval '10 minutes' where id = ${velho.id}`;
  assert.equal((await chamarWorker(h, velho)).status, 401, 'registrado, mas velho demais');
  assert.equal(rodadas, 1);
  assert.equal(typeof handler, 'function');
});

test('ponta a ponta no PostgreSQL (login com permissão mínima): API → acionamento do banco → worker → concluído, sem misturar empresas', { skip: pular }, async () => {
  await preparar();
  const { handler: apiH, banco } = montarApi({ sql: app, config: { uidsSuperAdmin: 'sa', projetoFirebase: PROJETO, origens: 'https://eagleslabz.com.br' }, obterChaves });
  await banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const chamar = async (acao, dados) => {
    const r = await apiH(new Request('http://local/labz-api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${emitir()}`, origin: 'https://eagleslabz.com.br' }, body: JSON.stringify({ acao, dados }) }));
    const corpo = await r.json();
    assert.equal(r.status, 200, JSON.stringify(corpo));
    return corpo.resultado;
  };
  const A = await chamar('empresas.criar', { empresa: { nome: 'Marca Alfa PG' } });
  const B = await chamar('empresas.criar', { empresa: { nome: 'Marca Beta PG' } });
  const tA = await chamar('execucoes.pedido', { empresaId: A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' });
  const tB = await chamar('execucoes.pedido', { empresaId: B.id, objetivo: 'Escrever as legendas da semana.' });
  // a fila entrou no banco (no Supabase, o gatilho da migração 3 chama o worker; aqui, o teste chama)
  const { handler: wkH } = montarWorker({ sql: app, config: { segredoWorker: SEGREDO } });
  const r1 = await chamarWorker(wkH, await criarAcionamento('fila'));
  const r2 = await chamarWorker(wkH, await criarAcionamento('cron'));
  assert.deepEqual([r1.status, r2.status], [200, 200]);
  for (const t of [tA, tB]) assert.equal((await chamar('execucoes.obter', { execucaoId: t.id })).estado, 'COMPLETED', t.id);
  const eA = await chamar('entregas.listar', { empresaId: A.id, limite: 100 });
  const eB = await chamar('entregas.listar', { empresaId: B.id, limite: 100 });
  const itens = (x) => (Array.isArray(x) ? x : x.itens);
  assert.ok(itens(eA).length >= 1 && itens(eB).length >= 1);
  assert.ok(itens(eA).every((e) => e.empresaId === A.id) && itens(eB).every((e) => e.empresaId === B.id), 'cada empresa só vê as próprias entregas');
  assert.ok(!itens(eA).some((e) => itens(eB).some((f) => f.id === e.id)));
  // auditoria da rodada do worker (só números)
  const ev = await chamar('auditoria.listar', { tipo: 'worker.rodada', limite: 10 });
  assert.ok(itens(ev).length >= 1, 'a rodada que trabalhou fica registrada (a vazia, não)');
});

test('S5B Etapa 6 no PostgreSQL: recusas (sem login, token falso, login válido fora da lista, origem estranha) não gravam NADA', { skip: pular }, async () => {
  await preparar();
  const recusas = [];
  const { handler } = montarApi({ sql: app, config: { uidsSuperAdmin: 'sa-etapa6', projetoFirebase: PROJETO, origens: 'https://eagleslabz.com.br' }, obterChaves, registrarRecusa: (r) => recusas.push(r) });
  const estado = async () => (await admin`select count(*)::int as n, coalesce(max(atualizado_em)::text, '') as ultimo from labz.docs`)[0];
  const antes = await estado();
  const pedir = (headers) => handler(new Request('http://local/labz-api', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: '{"acao":"catalogo.agentes"}' }));
  const casos = [
    [{}, 401],
    [{ authorization: 'Bearer abc.def.ghi' }, 401],
    [{ authorization: `Bearer ${emitir({ aud: 'outro-projeto' })}` }, 401],
    [{ authorization: `Bearer ${emitir({ sub: 'qualquer-usuario-do-crm' })}` }, 403],
    [{ origin: 'https://site-malicioso.example' }, 403],
  ];
  for (let i = 0; i < 20; i++) for (const [h, st] of casos) assert.equal((await pedir(h)).status, st);
  assert.deepEqual(await estado(), antes, '100 chamadas recusadas e o banco exatamente igual');
  assert.equal((await admin`select count(*)::int as n from labz.docs where caminho like 'labz_limites/qualquer%'`)[0].n, 0, 'nem contador de limite para quem está fora da lista');
  assert.ok(recusas.length === 100 && !JSON.stringify(recusas).includes('eyJ'));
});

test('API v4 no PostgreSQL: com a conta ativa o Super Admin entra (200); a mesma conta desativada é recusada (401) sem mudar o banco', { skip: pular }, async () => {
  await preparar();
  await admin.unsafe(`insert into labz.docs (caminho, colecao, id, dados) values ('labz_usuarios/sa-v4', 'labz_usuarios', 'sa-v4', '{"role":"SuperAdmin"}'::json) on conflict (caminho) do nothing`);
  const acesso = (await admin`select dados::text as d from labz.docs where caminho = 'labz_config/acesso'`)[0];
  const uids = acesso ? JSON.parse(acesso.d).uids : [];
  const json = JSON.stringify({ uids: [...new Set([...uids, 'sa-v4'])] });
  await admin.unsafe(`insert into labz.docs (caminho, colecao, id, dados) values ('labz_config/acesso', 'labz_config', 'acesso', '${json}'::json) on conflict (caminho) do update set dados = excluded.dados`);
  const conta = { disabled: false };
  const buscarConta = async (url, op) => { const sub = JSON.parse(Buffer.from(JSON.parse(op.body).idToken.split('.')[1], 'base64url').toString()).sub; return { ok: true, status: 200, json: async () => ({ users: [{ localId: sub, disabled: conta.disabled, validSince: '0' }] }) }; };
  const { handler, contaAtiva } = montarApi({ sql: app, config: { uidsSuperAdmin: 'sa-v4', projetoFirebase: PROJETO, origens: 'https://eagleslabz.com.br', firebaseApiKey: 'chave-publica-ficticia-de-teste-0000', exigirContaAtiva: true }, obterChaves, buscarConta });
  assert.equal(contaAtiva, true);
  const pedir = async (carga = {}) => (await handler(new Request('http://local/labz-api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${emitir(Object.assign({ sub: 'sa-v4' }, carga))}` }, body: '{"acao":"catalogo.agentes"}' }))).status;
  assert.equal(await pedir(), 200, 'conta ativa: entra');
  assert.equal(await pedir(), 200, 'o mesmo login de novo: usa o resultado guardado (5 min)');
  conta.disabled = true;
  const estado = async () => (await admin`select count(*)::int as n, coalesce(max(atualizado_em)::text, '') as u from labz.docs`)[0];
  const antes = await estado();
  assert.equal(await pedir({ iat: Math.floor(Date.now() / 1000) - 90 }), 401, 'a mesma conta desativada, com um login novo (outro token, sem o guardado de 5 min)');
  assert.deepEqual(await estado(), antes, 'a recusa não grava nada');
});

test('S5B Etapa 6 no PostgreSQL (worker): chamadas sem acionamento válido não mudam NADA no banco', { skip: pular }, async () => {
  await preparar();
  const { handler } = montarWorker({ sql: app, config: { segredoWorker: SEGREDO } });
  const estado = async () => (await admin`select (select count(*)::int from labz.docs) as d, (select count(*)::int from labz.acionamentos where consumido_em is not null) as c, (select count(*)::int from labz.acionamentos) as a`)[0];
  const antes = await estado();
  const agora = Math.floor(Date.now() / 1000);
  const id = `acn_${'e'.repeat(32)}`;
  const forjado = { 'x-labz-acionamento': id, 'x-labz-tempo': String(agora), 'x-labz-motivo': 'manual', 'x-labz-assinatura': `v1=${'0'.repeat(64)}` };
  const certoSemRegistro = Object.assign({}, forjado, { 'x-labz-assinatura': `v1=${require('../src/borda/acionamento').assinar(SEGREDO, id, agora, 'manual')}` });
  for (let i = 0; i < 10; i++) {
    for (const h of [{}, forjado, certoSemRegistro]) {
      const r = await handler(new Request('http://local/labz-worker', { method: 'POST', headers: h, body: '{}' }));
      assert.equal(r.status, 401);
    }
  }
  assert.deepEqual(await estado(), antes, '30 chamadas recusadas e o banco igual (nada criado, nada consumido)');
});

test.after(async () => {
  if (app) await app.end({ timeout: 2 });
  if (admin) await admin.end({ timeout: 2 });
});
