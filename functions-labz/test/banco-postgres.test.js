// Fase S1 (Supabase): testes ESPECÍFICOS do banco PostgreSQL. Rodam só com um PostgreSQL de
// teste (npm run test:postgres, que define LABZ_PG_URL); sem ele, ficam marcados como "pulados".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { criarBancoPostgres } = require('../src/armazenamento/banco-postgres');
const { sqlMigracao } = require('../src/armazenamento/postgres-migracao');
const { criarBancoMemoria: memoriaOriginal } = (() => {
  // o banco em memória ORIGINAL (o arquivo de preparação troca a exportação nos testes em Postgres)
  delete require.cache[require.resolve('../src/armazenamento/banco-memoria')];
  const m = require('../src/armazenamento/banco-memoria');
  return { criarBancoMemoria: m.criarBancoMemoria.postgres ? null : m.criarBancoMemoria };
})();

const URL = process.env.LABZ_PG_URL;
const pular = !URL && 'sem PostgreSQL de teste (rode npm run test:postgres)';
let sql;
let n = 0;
async function novoBanco() {
  if (!sql) sql = require('postgres')(URL, { max: 8, idle_timeout: 1, onnotice: () => {} });
  const schema = `s1_${process.pid}_${++n}`;
  await sql.unsafe(sqlMigracao(schema));
  return criarBancoPostgres({ sql, schema });
}
const memoria = () => (memoriaOriginal ? memoriaOriginal() : require('../src/armazenamento/banco-memoria').criarBancoMemoria());

// Um roteiro com TODAS as operações e casos de borda, rodado nos dois bancos: os resultados têm de ser iguais.
async function roteiro(b) {
  const r = {};
  const pega = async (nome, fn) => { try { r[nome] = await fn(); } catch (e) { r[nome] = { erro: e.codigo || e.message }; } };
  await b.gravar('labz_x/a', { ordem: 2, nome: 'Ana', termos: ['marca', 'cor'], aninhado: { nivel: 'alto' }, nulo: null, zeta: 1, alfa: 2 });
  await b.gravar('labz_x/b', { ordem: 1, nome: 'Bia', termos: ['cor'], aninhado: { nivel: 'baixo' } });
  await b.gravar('labz_x/c', { nome: 'Caio', termos: [] });
  await b.gravar('labz_x/d', { ordem: 2, nome: 'Duda', termos: ['tom'] });
  await b.gravar('labz_x/a/labz_sub/1', { v: 1 });
  await pega('obter', () => b.obter('labz_x/a'));
  await pega('ordemDasChaves', async () => Object.keys(await b.obter('labz_x/a')));
  await pega('obterInexistente', () => b.obter('labz_x/zz'));
  await pega('atualizar', async () => { await b.atualizar('labz_x/b', { nome: 'Beatriz', novo: true }); return b.obter('labz_x/b'); });
  await pega('ordemAposAtualizar', async () => Object.keys(await b.obter('labz_x/b')));
  await pega('atualizarInexistente', () => b.atualizar('labz_x/nao', { x: 1 }));
  await pega('substituir', async () => { await b.gravar('labz_x/d', { ordem: 3, nome: 'Duda', termos: ['tom'] }); return b.obter('labz_x/d'); });
  await pega('listar', async () => (await b.listar('labz_x')).map((x) => x.id));
  await pega('listarFiltro', async () => (await b.listar('labz_x', (x) => x.ordem >= 2)).map((x) => x.id));
  await pega('listarSub', () => b.listar('labz_x/a/labz_sub'));
  const c = (o) => b.consultar('labz_x', Object.assign({ limite: 10 }, o)).then((l) => l.map((x) => x.id));
  await pega('igual', () => c({ onde: [{ campo: 'nome', op: '==', valor: 'Ana' }] }));
  await pega('igualAninhado', () => c({ onde: [{ campo: 'aninhado.nivel', op: '==', valor: 'baixo' }] }));
  await pega('igualNulo', () => c({ onde: [{ campo: 'nulo', op: '==', valor: null }] }));
  await pega('in', () => c({ onde: [{ campo: 'nome', op: 'in', valor: ['Ana', 'Caio'] }] }));
  await pega('contem', () => c({ onde: [{ campo: 'termos', op: 'array-contains', valor: 'cor' }] }));
  await pega('contemAlgum', () => c({ onde: [{ campo: 'termos', op: 'array-contains-any', valor: ['tom', 'marca'] }] }));
  await pega('ordemCampoAsc', () => c({ ordenar: { campo: 'ordem', direcao: 'asc' } }));
  await pega('ordemCampoDesc', () => c({ ordenar: { campo: 'ordem', direcao: 'desc' } }));
  await pega('ordemTexto', () => c({ ordenar: { campo: 'nome', direcao: 'asc' } }));
  await pega('ordemId', () => c({ ordenar: { campo: 'id', direcao: 'desc' } }));
  await pega('limite', () => c({ ordenar: { campo: 'ordem', direcao: 'asc' }, limite: 2 }));
  await pega('cursor', () => c({ ordenar: { campo: 'ordem', direcao: 'asc' }, depoisDe: 'b' }));
  await pega('cursorDesc', () => c({ ordenar: { campo: 'ordem', direcao: 'desc' }, depoisDe: 'd' }));
  await pega('cursorInvalido', () => c({ depoisDe: 'naoexiste' }));
  await pega('cursorOutroEscopo', () => c({ onde: [{ campo: 'nome', op: '==', valor: 'Ana' }], depoisDe: 'b', cursorMesmoFiltro: ['nome'] }));
  await pega('semLimite', () => b.consultar('labz_x', {}));
  await pega('colecaoProibida', () => b.consultar('tenants', { limite: 1 }));
  await pega('transacao', () => b.transacao(async (t) => { await t.gravar('labz_x/e', { v: 1 }); await t.atualizar('labz_x/e', { w: 2 }); return [t.emTransacao === true, await t.obter('labz_x/e'), (await t.listar('labz_x')).length]; }));
  await pega('rollback', async () => { await b.transacao(async (t) => { await t.gravar('labz_x/f', { v: 1 }); throw new Error('falha de propósito'); }).catch(() => {}); return b.obter('labz_x/f'); });
  return r;
}

test('as 6 operações: o MESMO roteiro dá o MESMO resultado no banco em memória e no PostgreSQL', { skip: pular }, async () => {
  const esperado = await roteiro(memoria());
  const obtido = await roteiro(await novoBanco());
  for (const k of Object.keys(esperado)) assert.deepStrictEqual(obtido[k], esperado[k], `diferença em "${k}"`);
  // conferências diretas (para o roteiro não passar "igual por engano")
  assert.deepStrictEqual(obtido.ordemDasChaves, ['ordem', 'nome', 'termos', 'aninhado', 'nulo', 'zeta', 'alfa'], 'a ordem das chaves é preservada');
  assert.deepStrictEqual(obtido.cursor, ['a', 'd']);
  assert.deepStrictEqual(obtido.atualizarInexistente, { erro: 'nao-encontrado' });
  assert.deepStrictEqual(obtido.cursorOutroEscopo, { erro: 'invalido' });
  assert.deepStrictEqual(obtido.colecaoProibida, { erro: 'invalido' });
  assert.equal(obtido.rollback, null);
});

test('concorrência: transações SERIALIZABLE em paralelo não perdem atualização e repetem sozinhas', { skip: pular }, async () => {
  const b = await novoBanco();
  await b.gravar('labz_cont/x', { v: 0 });
  await Promise.all(Array.from({ length: 30 }, () => b.transacao(async (t) => { const d = await t.obter('labz_cont/x'); await t.atualizar('labz_cont/x', { v: d.v + 1 }); })));
  assert.equal((await b.obter('labz_cont/x')).v, 30, 'nenhum incremento perdido');
  assert.ok(b.estatisticas().repeticoes > 0, 'houve conflito de verdade e as transações foram repetidas');
  // reserva "se ninguém pegou ainda": só UMA das 10 tentativas simultâneas consegue
  const ganhou = await Promise.all(Array.from({ length: 10 }, (_, i) => b.transacao(async (t) => {
    if (await t.obter('labz_cont/reserva')) return false;
    await t.gravar('labz_cont/reserva', { dono: i });
    return true;
  })));
  assert.equal(ganhou.filter(Boolean).length, 1);
  // erro do próprio código NÃO é repetido (só conflito do banco)
  let vezes = 0;
  await assert.rejects(b.transacao(async () => { vezes++; throw new Error('regra de negócio'); }), /regra de negócio/);
  assert.equal(vezes, 1);
  await assert.rejects(b.transacao(async (t) => t.transacao(async () => {})), /transação dentro de transação/);
});

test('motor no PostgreSQL: dois executores ao mesmo tempo, dois clientes, cada etapa uma vez e nada misturado', { skip: pular }, async () => {
  const { criarLabz } = require('../src/servicos');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  const banco = await novoBanco();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const s = criarLabz({ banco, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa', token: {} }, { banco, uidsAutorizados: ['sa'] });
  const A = await s.empresas.criar(ator, { nome: 'Cliente Alfa' });
  const B = await s.empresas.criar(ator, { nome: 'Cliente Beta' });
  const pa = await s.motor.pedido(ator, { empresaId: A.id, objetivo: 'Roteiro de Reels e legendas para o Instagram da marca' });
  const pb = await s.motor.pedido(ator, { empresaId: B.id, objetivo: 'Roteiro de Reels e legendas para o Instagram da marca' });
  await Promise.all([s.executorLocal({ nome: 'E1' }).drenar(), s.executorLocal({ nome: 'E2' }).drenar()]);
  for (const [p, emp] of [[pa, A], [pb, B]]) {
    const e = await s.execucoes.obter(ator, p.id);
    assert.equal(e.estado, 'COMPLETED', `tarefa de ${emp.nome}`);
    assert.ok(e.etapas.every((x) => x.status === 'concluida' && x.tentativas === 1), 'cada etapa feita uma vez');
    const ents = await s.entregas.listar(ator, { execucaoId: p.id });
    assert.ok(ents.itens.length > 0 && ents.itens.every((x) => x.empresaId === emp.id), 'entregas só da empresa da tarefa');
  }
});

// cenário de recuperação rodado em qualquer banco (para comparar memória × PostgreSQL)
async function cenarioRecuperacao(banco) {
  const { criarLabz } = require('../src/servicos');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  let agora = Date.parse('2026-11-01T12:00:00.000Z'); // relógio controlado: o tempo "pula" para a reserva vencer
  const relogio = () => new Date(agora += 1000).toISOString();
  const s = criarLabz({ banco, relogio, ia: { transporte: transporteComModeloSimulado() } });
  const ator = await exigirSuperAdmin({ uid: 'sa', token: {} }, { banco, uidsAutorizados: ['sa'] });
  const A = await s.empresas.criar(ator, { nome: 'Cliente Alfa' });
  const p = await s.motor.pedido(ator, { empresaId: A.id, objetivo: 'Anúncios no Meta Ads para a campanha' });
  const reservado = await s.fila.reservar('morto'); // um executor pega o item e "morre" (não termina nem libera)
  const passos = [reservado && reservado.trabalhador];
  for (let i = 0; i < 4; i++) { agora += 10 * 60 * 1000; await s.executorLocal({ nome: 'vivo' }).drenar(); passos.push((await s.execucoes.obter(ator, p.id)).estado); }
  return { s, ator, p, passos };
}

test('recuperação: executor que morre no meio é recuperado (igual ao banco em memória); aprovação dupla: só uma vale', { skip: pular }, async () => {
  const mem = await cenarioRecuperacao(memoria());
  const pg = await cenarioRecuperacao(await novoBanco());
  assert.deepStrictEqual(pg.passos, mem.passos, 'mesma sequência de estados nos dois bancos');
  assert.equal(pg.passos[0], 'morto');
  assert.equal(pg.passos[pg.passos.length - 1], 'REVISION_REQUIRED', 'recuperada, executada e parada no documento sensível');
  // aprovação do documento sensível: duas decisões simultâneas na MESMA versão → só uma vale; hash falso é recusado
  const { criarApi } = require('../src/api/labz-api');
  const api = criarApi({ servicos: pg.s, banco: pg.s.banco, uidsAutorizados: () => ['sa'], lerSegredo: () => '' });
  const chamar = (acao, dados) => api({ auth: { uid: 'sa', token: {} }, data: { acao, dados } }).then((r) => r.resultado);
  const rel = await chamar('execucoes.relatorio', { execucaoId: pg.p.id });
  const doc = rel.documentos.find((x) => x.documento === 'plano-trafego');
  await assert.rejects(chamar('entregas.decidir', { entregaId: doc.entregaId, decisao: { decisao: 'aprovar', versao: doc.versaoAtual, hash: 'f'.repeat(64) } }));
  const dec = { decisao: 'aprovar', versao: doc.versaoAtual, hash: doc.hash };
  const r = await Promise.allSettled([chamar('entregas.decidir', { entregaId: doc.entregaId, decisao: dec }), chamar('entregas.decidir', { entregaId: doc.entregaId, decisao: dec })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1, 'duas aprovações simultâneas: só uma vale');
});

test('aprovação de AÇÃO no PostgreSQL: a assinatura recalculada confere depois de ler do banco (ordem das chaves preservada)', { skip: pular }, async () => {
  const { criarLabz } = require('../src/servicos');
  const { exigirSuperAdmin } = require('../src/auth/super-admin');
  const { criarAdaptadorSimulado } = require('../src/motor/adaptador-simulado');
  const banco = await novoBanco();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const acao = { tipo: 'ferramenta', ferramentaId: 'meta.publicar', operacao: 'publicar', parametros: { campanha: 'x' } };
  const s = criarLabz({ banco, adaptador: criarAdaptadorSimulado({ '07-trafego': 'acao' }, { acoes: { '07-trafego': acao } }) });
  const ator = await exigirSuperAdmin({ uid: 'sa', token: {} }, { banco, uidsAutorizados: ['sa'] });
  const A = await s.empresas.criar(ator, { nome: 'Cliente Alfa' });
  const exe = await s.execucoes.criar(ator, { empresaId: A.id, objetivo: 'Publicar campanha', modo: 'especialista', agenteId: '07-trafego' });
  await s.motor.planejar(ator, exe.id);
  await s.executorLocal().drenar();
  const [pedido] = await s.aprovacoes.pendentes(ator, exe.id);
  assert.ok(pedido && pedido.risco, 'pedido com risco gravado');
  const r = await s.aprovacoes.decidir(ator, exe.id, pedido.id, { decisao: 'recusar', assinatura: pedido.assinatura, justificativa: 'teste no PostgreSQL' });
  assert.equal(r.pedido.status, 'recusada');
});

test('migração: arquivo igual ao gerado, aplicável duas vezes, e RLS fecha o banco para o navegador', { skip: pular }, async () => {
  const arquivo = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261031000000_labz_inicial.sql'), 'utf8');
  assert.equal(arquivo, sqlMigracao('labz'), 'o .sql versionado é o gerado pela função (fonte única)');
  if (!sql) sql = require('postgres')(URL, { max: 8, idle_timeout: 1, onnotice: () => {} });
  const schema = `rls_${process.pid}`;
  // papéis do Supabase (no Supabase eles já existem; no PostgreSQL local criamos iguais, sem login)
  for (const p of ['anon', 'authenticated']) await sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${p}') then create role ${p} nologin; end if; end $$;`);
  await sql.unsafe(sqlMigracao(schema));
  await sql.unsafe(sqlMigracao(schema)); // idempotente
  await sql.unsafe(`insert into ${schema}.docs (caminho, colecao, id, dados) values ('labz_x/a', 'labz_x', 'a', '{"segredo":1}')`);
  for (const papel of ['anon', 'authenticated']) {
    await assert.rejects(sql.begin(async (tx) => { await tx.unsafe(`set local role ${papel}`); return tx.unsafe(`select * from ${schema}.docs`); }), /permission denied/, `${papel} não lê`);
    await assert.rejects(sql.begin(async (tx) => { await tx.unsafe(`set local role ${papel}`); return tx.unsafe(`insert into ${schema}.docs (caminho, colecao, id, dados) values ('labz_x/b', 'labz_x', 'b', '{}')`); }), /permission denied/, `${papel} não grava`);
  }
  const lidos = await sql.begin(async (tx) => { await tx.unsafe('set local role labz_app'); return tx.unsafe(`select id from ${schema}.docs`); });
  assert.deepEqual(lidos.map((x) => x.id), ['a'], 'o papel do servidor lê');
  const rls = await sql.unsafe(`select relrowsecurity, relforcerowsecurity from pg_class where oid = '${schema}.docs'::regclass`);
  assert.deepEqual([rls[0].relrowsecurity, rls[0].relforcerowsecurity], [true, true]);
  const login = await sql.unsafe(`select rolcanlogin from pg_roles where rolname = 'labz_app'`);
  assert.equal(login[0].rolcanlogin, false, 'o papel nasce sem login (a senha é definida à mão, fora do Git)');
  // caminho inválido é recusado pelo próprio banco
  await assert.rejects(sql.unsafe(`insert into ${schema}.docs (caminho, colecao, id, dados) values ('so-colecao', 'so-colecao', '', '{}')`), /docs_caminho_valido|docs_partes/);
  await sql.unsafe(`drop schema ${schema} cascade`);
});

test.after(async () => { if (sql) await sql.end({ timeout: 2 }); });
