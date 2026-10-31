// LABZ AI — Fase S3: testes NO DENO (o mesmo runtime das Edge Functions), com o PACOTE gerado
// (supabase/functions/_labz/labz.mjs) e o driver postgres.js rodando no Deno contra um
// PostgreSQL de teste. Rodar:  LABZ_PG_URL=postgresql://... deno test -A test/deno/
import { assert, assertEquals } from './afirmar.ts';
import { L, PROJETO, ORIGEM, SEGREDO, obterChaves, emitir, bancoTemporario, criarAcionamento, chamarWorker, transporteContado } from './comum.ts';
import process from 'node:process';

const opcoesTeste = { sanitizeOps: false, sanitizeResources: false };
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

// deno-lint-ignore no-explicit-any
async function montarTudo(app: any, extra: Record<string, any> = {}) {
  const transporte = extra.transporte || transporteContado();
  const api = L.montarApi({ sql: app, config: { uidsSuperAdmin: 'sa,d1', projetoFirebase: PROJETO, origens: ORIGEM, limites: extra.limites }, obterChaves, ia: { transporte } });
  await api.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await api.banco.gravar('labz_usuarios/d1', { role: 'Diretor', nome: 'Diretor' });
  await api.banco.gravar('labz_config/acesso', { uids: ['sa', 'd1'] });
  const wk = L.montarWorker({ sql: app, config: { segredoWorker: SEGREDO, orcamento: extra.orcamento }, ia: { transporte }, opcoes: extra.opcoes, cpuMs });
  const pedir = async (acao: string, dados: unknown, { token = emitir(), origem = ORIGEM }: { token?: string | null; origem?: string } = {}) => {
    const h: Record<string, string> = { 'content-type': 'application/json', origin: origem };
    if (token) h.authorization = `Bearer ${token}`;
    const r = await api.handler(new Request('http://local/functions/v1/labz-api', { method: 'POST', headers: h, body: JSON.stringify({ acao, dados }) }));
    return { status: r.status, corpo: await r.json(), cors: r.headers.get('access-control-allow-origin') };
  };
  const ok = async (acao: string, dados: unknown) => { const r = await pedir(acao, dados); assertEquals(r.status, 200, JSON.stringify(r.corpo)); return r.corpo.resultado; };
  return { api, wk, pedir, ok, transporte };
}
// deno-lint-ignore no-explicit-any
const chamadasExec = (t: any) => t.chamadas.filter((x: any) => x.modo !== 'planejar');

Deno.test('Deno: o pacote carrega, sem Firebase Admin, e o driver postgres.js conecta com o login de permissão mínima', opcoesTeste, async () => {
  assert(L.MODULOS.includes('src/borda/montagem.js'));
  assert(!L.MODULOS.some((n: string) => /node_modules\/(firebase|@google-cloud)/.test(n)));
  const b = await bancoTemporario();
  try {
    const [{ papel, versao }] = await b.app`select current_user as papel, current_setting('server_version') as versao`;
    assertEquals(papel, 'labz_borda_teste');
    assert(Number(String(versao).split('.')[0]) >= 15, `PostgreSQL ${versao}`);
    let negado = false;
    try { await b.app`select * from labz.criar_acionamento('fila', ${SEGREDO})`; } catch (_e) { negado = true; }
    assert(negado, 'o login da função não cria acionamento');
  } finally { await b.fim(); }
});

Deno.test('Deno: API HTTP — token, Super Admin, CORS, limites e erros', opcoesTeste, async () => {
  const b = await bancoTemporario();
  try {
    const t = await montarTudo(b.app, { limites: { porMinuto: 30, tarefasPorHora: 1 } });
    const cat = await t.pedir('catalogo.agentes', {});
    assertEquals(cat.status, 200);
    assertEquals(cat.corpo.resultado.length, 8);
    assertEquals(cat.cors, ORIGEM);
    assertEquals((await t.pedir('catalogo.agentes', {}, { token: null })).status, 401);
    assertEquals((await t.pedir('catalogo.agentes', {}, { token: emitir({ aud: 'outro-projeto' }) })).status, 401);
    assertEquals((await t.pedir('catalogo.agentes', {}, { token: emitir({ exp: Math.floor(Date.now() / 1000) - 600 }) })).status, 401);
    assertEquals((await t.pedir('catalogo.agentes', {}, { token: emitir({ sub: 'd1' }) })).status, 403, 'Diretor não entra');
    assertEquals((await t.pedir('catalogo.agentes', {}, { origem: 'https://outro.example' })).status, 403);
    const A = await t.ok('empresas.criar', { empresa: { nome: 'Marca Deno' } });
    assertEquals((await t.pedir('execucoes.pedido', { empresaId: A.id, objetivo: 'Escrever as legendas da semana.' })).status, 200);
    assertEquals((await t.pedir('execucoes.pedido', { empresaId: A.id, objetivo: 'Escrever as legendas da semana.' })).status, 429, 'limite de tarefas por hora');
  } finally { await b.fim(); }
});

Deno.test('Deno: worker de ponta a ponta — acionamento do banco, 2 empresas, concorrência (5 chamadas ao mesmo tempo) e nenhuma chamada repetida', opcoesTeste, async () => {
  const b = await bancoTemporario();
  try {
    const t = await montarTudo(b.app, { opcoes: { monitor: { limiteBatimentoMs: 24 * 3600 * 1000 } } });
    const A = await t.ok('empresas.criar', { empresa: { nome: 'Marca Alfa Deno' } });
    const B = await t.ok('empresas.criar', { empresa: { nome: 'Marca Beta Deno' } });
    const ids: string[] = [];
    for (const [e, obj] of [[A, 'Produzir conteúdos para redes sociais: posts e legendas.'], [B, 'Criar a identidade visual da marca: logo e paleta.'], [A, 'Escrever as legendas da semana.']] as const) {
      ids.push((await t.ok('execucoes.pedido', { empresaId: e.id, objetivo: obj })).id);
    }
    // sem acionamento válido: nada roda
    assertEquals((await chamarWorker(t.wk.handler, null)).status, 401);
    // 5 acionamentos AO MESMO TEMPO (gatilho + cron), cada um assinado pelo banco
    const acs = await Promise.all(['fila', 'fila', 'cron', 'cron', 'fila'].map((m) => criarAcionamento(b.admin, m)));
    const cpu0 = cpuMs();
    const resp = await Promise.all(acs.map((a) => chamarWorker(t.wk.handler, a)));
    const cpuRodadas = cpuMs() - cpu0;
    assertEquals(resp.map((r) => r.status), [200, 200, 200, 200, 200]);
    // replay de um acionamento já usado
    assertEquals((await chamarWorker(t.wk.handler, acs[0])).status, 401);
    for (let i = 0; i < 3; i++) await chamarWorker(t.wk.handler, await criarAcionamento(b.admin, 'cron')); // o que sobrou dos itens disputados
    let etapas = 0;
    for (const id of ids) {
      const e = await t.ok('execucoes.obter', { execucaoId: id });
      assertEquals(e.estado, 'COMPLETED', id);
      // deno-lint-ignore no-explicit-any
      assert(e.etapas.every((x: any) => x.tentativas === 1));
      etapas += e.etapas.length;
    }
    assertEquals(chamadasExec(t.transporte).length, etapas, 'uma chamada ao modelo por etapa (nenhuma repetida)');
    const eA = await t.ok('entregas.listar', { empresaId: A.id, limite: 100 });
    const eB = await t.ok('entregas.listar', { empresaId: B.id, limite: 100 });
    // deno-lint-ignore no-explicit-any
    const itens = (x: any) => (Array.isArray(x) ? x : x.itens);
    // deno-lint-ignore no-explicit-any
    assert(itens(eA).every((e: any) => e.empresaId === A.id) && itens(eB).every((e: any) => e.empresaId === B.id), 'isolamento entre empresas');
    console.log(`  [medida] CPU do Deno nas 5 rodadas simultâneas (3 tarefas, ${etapas} etapas): ${cpuRodadas.toFixed(0)} ms`);
  } finally { await b.fim(); }
});

Deno.test('Deno: orçamento de tempo REAL — a tarefa é dividida entre chamadas do worker, sem repetir chamada ao modelo', opcoesTeste, async () => {
  const b = await bancoTemporario();
  try {
    // cada chamada ao "modelo" leva 400 ms de verdade; a parada suave em 600 ms → 2 etapas por chamada
    const transporte = transporteContado(async (x: { meta: { modo: string } }) => { if (x.meta.modo !== 'planejar') await new Promise((r) => setTimeout(r, 400)); return null; });
    const t = await montarTudo(b.app, { transporte, orcamento: { paradaSuaveMs: 600, limiteMs: 5000 } });
    const A = await t.ok('empresas.criar', { empresa: { nome: 'Marca Tempo' } });
    const id = (await t.ok('execucoes.pedido', { empresaId: A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' })).id;
    let chamadas = 0;
    while (chamadas < 10 && (await t.ok('execucoes.obter', { execucaoId: id })).estado !== 'COMPLETED') {
      assertEquals((await chamarWorker(t.wk.handler, await criarAcionamento(b.admin, 'fila'))).status, 200);
      chamadas++;
    }
    const e = await t.ok('execucoes.obter', { execucaoId: id });
    assertEquals(e.estado, 'COMPLETED');
    assert(chamadas >= 2, `a tarefa precisou de ${chamadas} chamadas do worker`);
    assertEquals(chamadasExec(t.transporte).length, e.etapas.length);
    const lib = await t.ok('auditoria.listar', { tipo: 'execucao.execucao_liberada', limite: 20 });
    // deno-lint-ignore no-explicit-any
    assert((Array.isArray(lib) ? lib : lib.itens).length >= 1, 'parou entre etapas e voltou para a fila');
  } finally { await b.fim(); }
});

Deno.test('Deno: QUEDA de verdade (SIGKILL no meio da chamada) — a próxima chamada recupera e conclui', opcoesTeste, async () => {
  const b = await bancoTemporario();
  try {
    const t = await montarTudo(b.app, { opcoes: { fila: { reservaMs: 1500 }, monitor: { limiteBatimentoMs: 1500 } } });
    const A = await t.ok('empresas.criar', { empresa: { nome: 'Marca Queda' } });
    const id = (await t.ok('execucoes.pedido', { empresaId: A.id, objetivo: 'Escrever as legendas da semana.' })).id;
    const proc = new Deno.Command(Deno.execPath(), { args: ['run', '-A', new URL('./processo_worker.ts', import.meta.url).pathname, b.url, '1500'], stdout: 'piped', stderr: 'piped' }).spawn();
    const leitor = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let saida = '';
    while (!saida.includes('PENDURADO')) { const { value, done } = await leitor.read(); if (done) break; saida += value; }
    assert(saida.includes('PENDURADO'), 'o processo chegou à chamada');
    proc.kill('SIGKILL');
    const st = await proc.status;
    assert(!st.success);
    await leitor.cancel().catch(() => {});
    await proc.stderr.cancel().catch(() => {});
    assertEquals((await t.ok('execucoes.obter', { execucaoId: id })).estado, 'RUNNING', 'ficou presa, sem ninguém');
    // logo depois: a reserva e o crachá ainda valem → ninguém pega
    const ac0 = await criarAcionamento(b.admin, 'cron');
    await chamarWorker(t.wk.handler, ac0);
    // passou o prazo (1,5 s): o "cron" recupera e conclui
    await new Promise((r) => setTimeout(r, 2000));
    for (let i = 0; i < 4 && (await t.ok('execucoes.obter', { execucaoId: id })).estado !== 'COMPLETED'; i++) {
      await chamarWorker(t.wk.handler, await criarAcionamento(b.admin, 'cron'));
      await new Promise((r) => setTimeout(r, 300));
    }
    const e = await t.ok('execucoes.obter', { execucaoId: id });
    assertEquals(e.estado, 'COMPLETED');
    const mon = await t.ok('auditoria.listar', { tipo: 'fila.monitor', limite: 20 });
    // deno-lint-ignore no-explicit-any
    assert((Array.isArray(mon) ? mon : mon.itens).length >= 1, 'o monitor registrou a recuperação');
  } finally { await b.fim(); }
});
