// Fase S3 (Supabase Edge Functions): a "borda" — portas HTTP da API e do worker, limite de
// pedidos, autenticação de cada chamada do worker, orçamento de tempo e pacote do Deno.
// Aqui no banco em memória (e, com LABZ_PG_URL, também no PostgreSQL pelo preload). Os testes
// no Deno e no Supabase local ficam em test/deno/ e supabase/testar-local.mjs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { montarComEmpresas } = require('./ajuda');
const { PROJETO, emitir, obterChaves } = require('./ajuda-token');
const { criarApi } = require('../src/api/labz-api');
const { criarVerificadorFirebase } = require('../src/auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../src/auth/acesso-supabase');
const { criarLimitador } = require('../src/borda/limitador');
const { criarHandlerApi, criarHandlerWorker } = require('../src/borda/http');
const { criarWorker } = require('../src/borda/worker');
const { criarVerificadorAcionamento, assinar } = require('../src/borda/acionamento');
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');

const ORIGEM = 'https://eagleslabz.com.br';
const SEGREDO = 'segredo-de-teste-ficticio-com-mais-de-32-caracteres';
const URL = 'http://localhost/functions/v1/labz-api';

// transporte simulado que CONTA as chamadas e deixa o teste mexer em cada uma
function transporteContado(gancho = () => null) {
  const modelo = criarModeloSimulado({});
  return criarTransporteSimulado(async (x) => (await gancho(x)) || modelo(x));
}

async function montarBorda({ limites = { porMinuto: 100, tarefasPorHora: 100 }, gancho, opcoes } = {}) {
  const transporte = transporteContado(gancho);
  const c = await montarComEmpresas({ ia: { transporte }, opcoes });
  await c.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await c.banco.gravar('labz_usuarios/d1', { role: 'Diretor', nome: 'Diretor' });
  const api = criarApi(Object.assign({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa,d1', lerSegredo: () => '' }, opcoesApiSupabase(c.banco)));
  const verificador = criarVerificadorFirebase({ projetoId: PROJETO, obterChaves });
  const recusas = [];
  const autenticar = criarAcessoSupabase({ verificador, aoRecusar: ({ motivo }) => recusas.push({ etapa: 'token', motivo }) });
  const limitador = criarLimitador({ banco: c.banco, relogio: () => '2026-11-01T12:00:30.000Z', limites });
  const handler = criarHandlerApi({ api, autenticar, limitador, uidPermitido: (uid) => ['sa', 'd1'].includes(uid), origens: [ORIGEM], registrarRecusa: (r) => recusas.push(r) });
  const pedir = async (corpo, { token = emitir(), origem = ORIGEM, metodo = 'POST', tipo = 'application/json', bruto } = {}) => {
    const headers = {};
    if (tipo) headers['content-type'] = tipo;
    if (token) headers.authorization = `Bearer ${token}`;
    if (origem) headers.origin = origem;
    const r = await handler(new Request(URL, { method: metodo, headers, body: metodo === 'POST' || metodo === 'PUT' ? (bruto !== undefined ? bruto : JSON.stringify(corpo)) : undefined }));
    const texto = await r.text();
    return { status: r.status, headers: r.headers, corpo: texto ? JSON.parse(texto) : null };
  };
  return Object.assign(c, { transporte, pedir, handler, recusas });
}

test('API (HTTP): CORS só para a origem do site, só POST + JSON, tamanho limitado e respostas sem cache', async () => {
  const c = await montarBorda();
  const ok = await c.pedir({ acao: 'catalogo.agentes' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.resultado.length, 8);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGEM);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  // outra origem (outro site tentando usar o login de quem está no navegador): recusado, sem CORS
  const outra = await c.pedir({ acao: 'catalogo.agentes' }, { origem: 'https://site-malicioso.example' });
  assert.equal(outra.status, 403);
  assert.equal(outra.headers.get('access-control-allow-origin'), null);
  // pré-voo do navegador
  const pre = await c.handler(new Request(URL, { method: 'OPTIONS', headers: { origin: ORIGEM } }));
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await c.pedir(null, { metodo: 'GET' })).status, 405);
  assert.equal((await c.pedir(null, { tipo: 'text/plain', bruto: '{}' })).status, 415);
  assert.equal((await c.pedir(null, { bruto: '{nao é json' })).status, 400);
  assert.equal((await c.pedir(null, { bruto: '[1,2]' })).status, 400);
  assert.equal((await c.pedir(null, { bruto: JSON.stringify({ acao: 'x', dados: 'a'.repeat(210 * 1024) }) })).status, 413);
  assert.equal((await c.pedir({ acao: 'acao.que.nao.existe' })).status, 400);
});

test('API (HTTP): sem token, token inválido/expirado/de outro projeto → 401 (mesma mensagem); Diretor → 403; nada de detalhe do motivo', async () => {
  const c = await montarBorda();
  const agora = Math.floor(Date.now() / 1000);
  const casos = [null, 'abc.def.ghi', emitir({ exp: agora - 600, iat: agora - 4000, auth_time: agora - 4000 }), emitir({ aud: 'outro-projeto' })];
  const mensagens = new Set();
  for (const token of casos) {
    const r = await c.pedir({ acao: 'catalogo.agentes' }, { token });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro.codigo, 'unauthenticated');
    mensagens.add(r.corpo.erro.mensagem);
  }
  assert.equal(mensagens.size, 1, 'a mesma mensagem para todos os motivos');
  const d = await c.pedir({ acao: 'catalogo.agentes' }, { token: emitir({ sub: 'd1', email: 'd1@teste.local' }) });
  assert.equal(d.status, 403);
  assert.equal(d.corpo.erro.detalhes, undefined);
});

// retrato do banco inteiro (caminhos + conteúdo): qualquer gravação muda o retrato
async function retrato(banco) {
  const caminhos = banco._caminhosAsync ? await banco._caminhosAsync() : banco._caminhos(); // no PostgreSQL: a tabela inteira
  const docs = await Promise.all(caminhos.map(async (p) => [p, await banco.obter(p)]));
  return JSON.stringify(docs);
}

test('S5B Etapa 6: chamadas SEM login válido ou fora da lista do servidor NÃO gravam nada no banco (só log, sem dados sensíveis)', async () => {
  const c = await montarBorda();
  const antes = await retrato(c.banco);
  const agora = Math.floor(Date.now() / 1000);
  const tokenIntruso = emitir({ sub: 'intruso', email: 'intruso@teste.local' }); // login VÁLIDO do Firebase, fora da lista
  const casos = [
    [{ token: null }, 401],
    [{ token: 'abc.def.ghi' }, 401],
    [{ token: emitir({ exp: agora - 600, iat: agora - 4000, auth_time: agora - 4000 }) }, 401],
    [{ token: emitir({ aud: 'outro-projeto' }) }, 401],
    [{ token: tokenIntruso }, 403],
    [{ origem: 'https://site-malicioso.example' }, 403],
    [{ metodo: 'GET' }, 405],
    [{ tipo: 'text/plain' }, 415],
    [{ bruto: '{nao-e-json' }, 400],
  ];
  for (let volta = 0; volta < 5; volta++) {
    for (const [op, status] of casos) assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, op)).status, status, JSON.stringify(op));
  }
  assert.equal(await retrato(c.banco), antes, 'o banco ficou EXATAMENTE igual');
  // fora da lista: a MESMA resposta do Super Admin negado (não revela se o login era válido)
  const fora = await c.pedir({ acao: 'catalogo.agentes' }, { token: tokenIntruso });
  const diretor = await c.pedir({ acao: 'catalogo.agentes' }, { token: emitir({ sub: 'd1', email: 'd1@teste.local' }) });
  assert.deepEqual([fora.status, fora.corpo.erro], [diretor.status, diretor.corpo.erro]);
  // o log: só etapa e motivo, de listas fechadas; nada de token, e-mail ou UID
  assert.ok(c.recusas.length >= 30);
  const texto = JSON.stringify(c.recusas);
  for (const proibido of ['eyJ', 'intruso', '@', 'malicioso', 'Bearer']) assert.ok(!texto.includes(proibido), proibido);
  assert.ok(c.recusas.every((r) => Object.keys(r).sort().join() === 'etapa,motivo' && ['origem', 'token', 'lista-servidor'].includes(r.etapa)));
  assert.ok(c.recusas.some((r) => r.etapa === 'token' && r.motivo === 'sem-bearer'));
  assert.ok(c.recusas.some((r) => r.etapa === 'lista-servidor'));
});

test('S5B Etapa 6: o Super Admin continua passando, e o que é dele continua auditado/limitado no banco', async () => {
  const c = await montarBorda({ limites: { porMinuto: 3, tarefasPorHora: 100 } });
  for (let i = 0; i < 3; i++) assert.equal((await c.pedir({ acao: 'catalogo.agentes' })).status, 200);
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' })).status, 429, 'o limite por UID continua valendo para quem está na lista');
  assert.ok(await c.banco.obter('labz_limites/sa'), 'o contador do Super Admin continua no banco');
  // da lista do servidor, mas com perfil errado no banco: continua auditado (só UIDs da lista chegam aqui)
  const d = await c.pedir({ acao: 'catalogo.agentes' }, { token: emitir({ sub: 'd1', email: 'd1@teste.local' }) });
  assert.equal(d.status, 403);
  const negados = await c.auditoria.listarPagina({ tipo: 'auth.acesso_negado', limite: 20 });
  assert.ok(negados.itens.length >= 1);
  assert.equal((await c.auditoria.listarPagina({ tipo: 'auth.token_recusado', limite: 20 })).itens.length, 0, 'recusa de token nunca vira auditoria no banco');
});

test('S5B Etapa 6: registro de recusas — linhas fechadas e volume limitado (resumo das suprimidas)', () => {
  const { criarRegistroRecusas } = require('../src/borda/registro-recusas');
  const linhas = [];
  let t = 0;
  const reg = criarRegistroRecusas({ escrever: (l) => linhas.push(JSON.parse(l)), maxPorMinuto: 5, agoraMs: () => t });
  for (let i = 0; i < 1000; i++) reg({ etapa: 'token', motivo: 'assinatura' });
  assert.equal(linhas.length, 5, 'no máximo 5 por minuto');
  t = 60000;
  reg({ etapa: 'qualquer coisa <script>', motivo: 'eyJhbGciOi.xxx Bearer @' });
  assert.deepEqual(linhas[5], { evento: 'labz-api.recusas_suprimidas', n: 995 });
  assert.deepEqual(linhas[6], { evento: 'labz-api.recusa', etapa: 'outra', motivo: 'outro' }, 'texto estranho nunca vai para o log');
  assert.doesNotThrow(() => criarRegistroRecusas({ escrever: () => { throw new Error('log fora'); } })({ etapa: 'token', motivo: 'x' }));
  assert.throws(() => require('../src/auth/acesso-supabase').criarAcessoSupabase({ verificador: async () => ({}), auditoria: {} }), /não vão para o banco/);
});

test('API (HTTP): limite de pedidos por UID (por minuto e de tarefas novas por hora) → 429', async () => {
  const c = await montarBorda({ limites: { porMinuto: 5, tarefasPorHora: 2 } });
  for (let i = 0; i < 5; i++) assert.equal((await c.pedir({ acao: 'catalogo.agentes' })).status, 200);
  const r = await c.pedir({ acao: 'catalogo.agentes' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  const c2 = await montarBorda({ limites: { porMinuto: 100, tarefasPorHora: 2 } });
  const pedido = { acao: 'execucoes.pedido', dados: { empresaId: c2.A.id, objetivo: 'Escrever as legendas da semana.' } };
  assert.equal((await c2.pedir(pedido)).status, 200);
  assert.equal((await c2.pedir(pedido)).status, 200);
  assert.equal((await c2.pedir(pedido)).status, 429, 'a 3ª tarefa na mesma hora é recusada');
  assert.equal((await c2.pedir({ acao: 'catalogo.agentes' })).status, 200, 'as outras ações continuam');
});

test('worker (autenticação de CADA chamada): formato, janela de tempo, assinatura e acionamento registrado e usado UMA vez', async () => {
  const registrados = new Map();
  const consumir = async ({ id, tempo, motivo }) => {
    const r = registrados.get(id);
    if (!r || r.usado || r.tempo !== tempo || r.motivo !== motivo) return false;
    r.usado = true;
    return true;
  };
  let agora = 1_800_000_000;
  const verificar = criarVerificadorAcionamento({ segredo: SEGREDO, consumir, agoraSeg: () => agora });
  const cab = (id, tempo, motivo, ass) => (n) => ({ 'x-labz-acionamento': id, 'x-labz-tempo': String(tempo), 'x-labz-motivo': motivo, 'x-labz-assinatura': ass })[n];
  const id = `acn_${'a'.repeat(32)}`;
  registrados.set(id, { tempo: agora, motivo: 'fila' });
  const certo = cab(id, agora, 'fila', `v1=${assinar(SEGREDO, id, agora, 'fila')}`);
  const motivo = async (c) => { try { await verificar(c); return 'passou'; } catch (e) { assert.equal(e.codigo, 'nao-autenticado'); return e.motivo; } };
  // sem nada / formato errado
  assert.equal(await motivo(() => undefined), 'formato');
  assert.equal(await motivo(cab('acn_x', agora, 'fila', 'v1=00')), 'formato');
  assert.equal(await motivo(cab(id, agora, 'outro', `v1=${assinar(SEGREDO, id, agora, 'fila')}`)), 'formato');
  // assinatura com OUTRO segredo, ou de outro motivo
  assert.equal(await motivo(cab(id, agora, 'fila', `v1=${assinar('x'.repeat(40), id, agora, 'fila')}`)), 'assinatura');
  assert.equal(await motivo(cab(id, agora, 'cron', `v1=${assinar(SEGREDO, id, agora, 'fila')}`)), 'assinatura');
  // assinatura certa, mas o acionamento NÃO foi registrado pelo banco (alguém com o segredo e a URL)
  const inventado = `acn_${'b'.repeat(32)}`;
  assert.equal(await motivo(cab(inventado, agora, 'fila', `v1=${assinar(SEGREDO, inventado, agora, 'fila')}`)), 'nao-registrado-ou-usado');
  // a chamada certa passa UMA vez; repetir a mesma (replay) é recusado
  assert.equal(await motivo(certo), 'passou');
  assert.equal(await motivo(certo), 'nao-registrado-ou-usado');
  // velha demais (fora da janela de 120 s)
  agora += 121;
  assert.equal(await motivo(cab(id, agora - 121, 'fila', `v1=${assinar(SEGREDO, id, agora - 121, 'fila')}`)), 'fora-da-janela');
  assert.throws(() => criarVerificadorAcionamento({ segredo: 'curto', consumir }), /32/);
});

test('worker (HTTP): sem acionamento válido → 401 e NADA roda; com acionamento → roda (ou 202 + trabalho ao fundo)', async () => {
  let rodadas = 0;
  const worker = { rodar: async () => { rodadas++; return { processados: 0, recuperadas: 0, parouPor: 'fila-vazia' }; } };
  const negar = async () => { const { erro } = require('../src/nucleo/erros'); throw erro('nao-autenticado', 'x'); };
  const h1 = criarHandlerWorker({ verificarAcionamento: negar, worker });
  const r1 = await h1(new Request('http://x/labz-worker', { method: 'POST', body: '{}' }));
  assert.equal(r1.status, 401);
  assert.equal(rodadas, 0);
  assert.equal((await h1(new Request('http://x/labz-worker', { method: 'GET' }))).status, 405);
  assert.equal((await h1(new Request('http://x/labz-worker', { method: 'POST', body: 'x'.repeat(5000) }))).status, 413);
  const aceitar = async () => ({ id: `acn_${'c'.repeat(32)}`, motivo: 'cron' });
  const h2 = criarHandlerWorker({ verificarAcionamento: aceitar, worker });
  const r2 = await h2(new Request('http://x/labz-worker', { method: 'POST' }));
  assert.equal(r2.status, 200);
  assert.equal(rodadas, 1);
  const fundo = [];
  const h3 = criarHandlerWorker({ verificarAcionamento: aceitar, worker, aoFundo: (p) => fundo.push(p) });
  const r3 = await h3(new Request('http://x/labz-worker', { method: 'POST' }));
  assert.equal(r3.status, 202);
  await Promise.all(fundo);
  assert.equal(rodadas, 2);
});

test('S5B Etapa 6 (worker): sem assinatura válida, a chamada é recusada SEM consultar o banco e sem rodar nada', async () => {
  let consultas = 0;
  let rodadas = 0;
  const consumir = async () => { consultas++; return false; };
  const agora = 1_800_000_000;
  const verificar = criarVerificadorAcionamento({ segredo: SEGREDO, consumir, agoraSeg: () => agora });
  const h = criarHandlerWorker({ verificarAcionamento: verificar, worker: { rodar: async () => { rodadas++; return {}; } } });
  const id = `acn_${'d'.repeat(32)}`;
  const chamar = (headers, metodo = 'POST') => h(new Request('http://x/labz-worker', { method: metodo, headers, body: metodo === 'POST' ? '{}' : undefined }));
  const cab = (tempo, motivo, ass) => ({ 'x-labz-acionamento': id, 'x-labz-tempo': String(tempo), 'x-labz-motivo': motivo, 'x-labz-assinatura': ass });
  const casos = [
    [{}, 401], // sem nada
    [{ authorization: 'Bearer qualquer-coisa' }, 401], // um login (de qualquer tipo) não serve para o worker
    [cab(agora, 'fila', 'v1=123'), 401], // formato
    [cab(agora, 'fila', `v1=${assinar('outro-segredo-qualquer-com-mais-de-32-caracteres', id, agora, 'fila')}`), 401], // segredo errado
    [cab(agora - 500, 'fila', `v1=${assinar(SEGREDO, id, agora - 500, 'fila')}`), 401], // velha (fora da janela)
  ];
  for (let i = 0; i < 10; i++) for (const [hd, st] of casos) assert.equal((await chamar(hd)).status, st);
  assert.equal((await chamar({}, 'GET')).status, 405);
  assert.equal(consultas, 0, 'nenhuma consulta ao banco antes de a assinatura conferir');
  assert.equal(rodadas, 0, 'nada roda');
  // só com a assinatura CERTA (quem tem o segredo) o banco é consultado — e, sem o registro, recusa
  assert.equal((await chamar(cab(agora, 'fila', `v1=${assinar(SEGREDO, id, agora, 'fila')}`))).status, 401);
  assert.equal(consultas, 1);
  assert.equal(rodadas, 0);
});

// relógio controlado pelo teste (o "tempo" que o worker vê)
function relogioWorker() { let t = 0; return { agoraMs: () => t, avancar: (ms) => { t += ms; } }; }
const chamadasExec = (transporte) => transporte.chamadas.filter((x) => x.modo !== 'planejar');

test('worker: orçamento de tempo — para ENTRE etapas, a próxima chamada continua, e nenhuma chamada ao modelo se repete', async () => {
  const r = relogioWorker();
  const c = await montarBorda({ gancho: () => { r.avancar(40_000); return null; } }); // cada chamada ao "modelo" leva 40 s
  const pedido = await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' } });
  const id = pedido.corpo.resultado.id;
  const w = criarWorker({ servicos: c, orcamento: { paradaSuaveMs: 60_000, limiteMs: 120_000 }, agoraMs: r.agoraMs });
  const r1 = await w.rodar({ acionamento: { id: `acn_${'1'.repeat(32)}`, motivo: 'fila' } });
  assert.equal(r1.parouPor, 'orcamento-tempo');
  assert.deepEqual(r1.resultados, { liberada: 1 });
  let e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'READY', 'volta para a fila entre etapas');
  assert.equal(e.etapas.filter((x) => x.status === 'concluida').length, 2, '2 etapas couberam no orçamento (40 s + 40 s)');
  const r2 = await w.rodar({ acionamento: { id: `acn_${'2'.repeat(32)}`, motivo: 'fila' } });
  assert.deepEqual(r2.resultados, { concluida: 1 });
  e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'COMPLETED');
  assert.ok(e.etapas.every((x) => x.tentativas === 1), 'cada etapa uma vez');
  const chamadas = chamadasExec(c.transporte);
  assert.equal(chamadas.length, e.etapas.length, 'nenhuma chamada ao modelo repetida ou desperdiçada');
  assert.equal(new Set(chamadas.map((x) => x.etapaId)).size, chamadas.length);
});

test('worker: sempre há progresso (a 1ª etapa roda mesmo com o orçamento curto) e o CPU também é orçamento', async () => {
  const r = relogioWorker();
  const c = await montarBorda({ gancho: () => { r.avancar(90_000); return null; } }); // etapa maior que a parada suave
  const id = (await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.A.id, objetivo: 'Escrever as legendas da semana.' } })).corpo.resultado.id;
  const w = criarWorker({ servicos: c, orcamento: { paradaSuaveMs: 60_000, limiteMs: 120_000 }, agoraMs: r.agoraMs });
  for (let i = 0; i < 10 && (await c.execucoes.obter(c.ator, id)).estado !== 'COMPLETED'; i++) await w.rodar({ acionamento: { id: `acn_${String(i).repeat(32)}`, motivo: 'fila' } });
  const e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'COMPLETED');
  assert.equal(chamadasExec(c.transporte).length, e.etapas.length, 'uma etapa por chamada, sem repetir');
  // orçamento mínimo (1 ms, já estourado antes de começar): mesmo assim cada chamada avança uma etapa
  const c3 = await montarBorda();
  const id3 = (await c3.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c3.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' } })).corpo.resultado.id;
  let t3 = 0;
  const w3 = criarWorker({ servicos: c3, orcamento: { paradaSuaveMs: 1, limiteMs: 60_000 }, agoraMs: () => (t3 += 5) });
  let n3 = 0;
  while (n3 < 10 && (await c3.execucoes.obter(c3.ator, id3)).estado !== 'COMPLETED') { await w3.rodar({}); n3++; }
  const e3 = await c3.execucoes.obter(c3.ator, id3);
  assert.equal(e3.estado, 'COMPLETED');
  assert.equal(n3, e3.etapas.length, 'uma etapa por chamada');
  assert.equal(chamadasExec(c3.transporte).length, e3.etapas.length);
  // orçamento de CPU: a medida passa do limite → para antes de pegar outro item
  let cpu = 0;
  const c2 = await montarBorda({ gancho: () => { cpu += 2000; return null; } });
  await c2.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c2.A.id, objetivo: 'Escrever as legendas da semana.' } });
  const w2 = criarWorker({ servicos: c2, orcamento: { cpuMaxMs: 1200 }, agoraMs: () => 0, cpuMs: () => cpu });
  const r2 = await w2.rodar({});
  assert.equal(r2.parouPor, 'orcamento-cpu');
  assert.equal(chamadasExec(c2.transporte).length, 1);
  assert.throws(() => criarWorker({ servicos: c2, orcamento: { paradaSuaveMs: 10, limiteMs: 5 } }), /orçamento/);
});

test('worker: várias chamadas AO MESMO TEMPO (gatilho + cron) não executam a mesma etapa duas vezes', async () => {
  const c = await montarBorda({ opcoes: { monitor: { limiteBatimentoMs: 24 * 60 * 60 * 1000 } } });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: i % 2 ? c.B.id : c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' } })).corpo.resultado.id);
  const w = criarWorker({ servicos: c });
  await Promise.all(Array.from({ length: 5 }, (_, i) => w.rodar({ acionamento: { id: `acn_${String(i).repeat(32)}`, motivo: i ? 'cron' : 'fila' } })));
  for (let k = 0; k < 3; k++) await w.rodar({}); // o que sobrou (itens disputados) termina aqui
  let total = 0;
  for (const id of ids) {
    const e = await c.execucoes.obter(c.ator, id);
    assert.equal(e.estado, 'COMPLETED', id);
    assert.ok(e.etapas.every((x) => x.tentativas === 1));
    total += e.etapas.length;
  }
  const chamadas = chamadasExec(c.transporte);
  assert.equal(chamadas.length, total, 'uma chamada ao modelo por etapa, no total');
  assert.equal(new Set(chamadas.map((x) => `${x.etapaId}|${x.n}`)).size, total);
});

test('worker: parada DURA (aviso de desligamento) devolve a etapa sem gastar tentativa; QUEDA sem aviso é recuperada pelo monitor', async () => {
  let pendurar = 1;
  let chegou;
  let primeira = new Promise((ok) => { chegou = ok; });
  const c = await montarBorda({ gancho: (x) => { if (x.meta.modo !== 'planejar' && pendurar > 0) { pendurar--; chegou(); return { pendurar: true }; } return null; } });
  const id = (await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.A.id, objetivo: 'Escrever as legendas da semana.' } })).corpo.resultado.id;
  // 1. parada dura: o runtime avisa (beforeunload) → pararTudo()
  const w1 = criarWorker({ servicos: c });
  const rodando = w1.rodar({});
  await primeira;
  assert.equal(w1.pararTudo(), 1);
  await rodando;
  let e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'READY');
  assert.ok(e.etapas.every((x) => (x.tentativas || 0) === 0), 'a etapa cortada não gastou tentativa');
  // 2. QUEDA sem aviso: o processo "morre" no meio da chamada (a promessa fica pendurada para sempre)
  pendurar = 1;
  primeira = new Promise((ok) => { chegou = ok; });
  const morto = criarWorker({ servicos: c });
  const abandonado = morto.rodar({});
  await primeira;
  e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'RUNNING', 'ficou presa (sem ninguém)');
  // outra chamada logo depois NÃO pega a execução (reserva e crachá ainda valem)
  const w2 = criarWorker({ servicos: c });
  assert.equal((await w2.rodar({})).processados, 0);
  // passou o prazo da reserva e do sinal de vida (5 min): a próxima chamada (cron) recupera e conclui
  c.relogio.avancarDias(1 / 24);
  const r3 = await w2.rodar({});
  assert.ok(r3.recuperadas >= 1 || r3.processados >= 1);
  for (let i = 0; i < 3 && (await c.execucoes.obter(c.ator, id)).estado !== 'COMPLETED'; i++) await w2.rodar({});
  e = await c.execucoes.obter(c.ator, id);
  assert.equal(e.estado, 'COMPLETED');
  // o executor "morto" acorda depois: perdeu o crachá, não grava nada
  morto.pararTudo();
  await abandonado;
  const depois = await c.execucoes.obter(c.ator, id);
  assert.equal(depois.estado, 'COMPLETED');
  assert.equal(depois.versao, e.versao, 'o executor antigo não mexeu em nada');
  // custo da queda: só a chamada cortada é refeita (1 a mais), as outras não
  assert.equal(chamadasExec(c.transporte).length, e.etapas.length + 2, '+1 da parada dura e +1 da queda');
});

test('pacote do Deno: atualizado, determinístico, sem Firebase Admin, e as funções só leem os segredos certos', () => {
  const { gerar, conferirPastas, nomePacote, PASTAS, PACOTES_PERMITIDOS } = require('../supabase/empacotar');
  const g = gerar();
  assert.equal(PASTAS.length, 2);
  assert.deepEqual(conferirPastas(g), [], 'rode "npm run empacotar"');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'supabase', 'functions', '_labz')), 'nada fora da pasta de cada função (a publicação só leva a pasta)');
  assert.equal(gerar().sha256, g.sha256, 'determinístico');
  assert.deepEqual(PACOTES_PERMITIDOS, ['postgres']);
  assert.ok(!g.nomes.some((n) => /node_modules\/(firebase|@google-cloud|@grpc|google-auth)/.test(n)), 'nada do Firebase Admin/Google Cloud');
  assert.ok(g.nomes.filter((n) => n.startsWith('node_modules/')).every((n) => n.startsWith('node_modules/postgres/')), 'só o postgres de pacote de fora');
  assert.ok(g.nomes.includes('src/borda/montagem.js') && g.nomes.includes('src/armazenamento/banco-postgres.js'));
  assert.ok(!g.nomes.some((n) => /^(index\.js|demo\/|integracao\/|test\/)/.test(n)), 'nem o servidor do Firebase, nem a demonstração, nem testes');
  assert.ok(!g.nativos.includes('node:child_process') && !g.nativos.includes('node:http') && !g.nativos.includes('node:https'));
  const raiz = path.join(__dirname, '..', 'supabase', 'functions');
  const api = fs.readFileSync(path.join(raiz, 'labz-api', 'index.ts'), 'utf8');
  const wk = fs.readFileSync(path.join(raiz, 'labz-worker', 'index.ts'), 'utf8');
  const envs = (s) => [...s.matchAll(/env\('([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(envs(api))], ['LABZ_DB_URL', 'LABZ_FIREBASE_PROJETO', 'LABZ_ORIGENS', 'LABZ_SUPERADMIN_UIDS']);
  assert.deepEqual([...new Set(envs(wk))], ['LABZ_DB_URL', 'LABZ_WORKER_SEGREDO']);
  assert.ok(!/obterChaves|criarTransporte|SERVICE_ROLE|service_role/.test(api + wk), 'nenhuma chave de teste nem chave de administrador do Supabase');
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  assert.match(cfg, /schemas = \["public", "graphql_public"\]/, 'o schema labz não é exposto pela API REST');
});

test('S5B Etapa 6: pacote com NOME POR VERSÃO — o index.ts importa exatamente o arquivo gerado, e só ele existe na pasta', () => {
  const os = require('node:os');
  const { gerar, conferirPastas, nomePacote, PASTAS } = require('../supabase/empacotar');
  const crypto = require('node:crypto');
  const g = gerar();
  const nome = nomePacote(g.sha256);
  assert.match(nome, /^labz-[0-9a-f]{12}\.mjs$/);
  assert.equal(nome, `labz-${crypto.createHash('sha256').update(g.texto).digest('hex').slice(0, 12)}.mjs`, 'o nome vem do SHA-256 do conteúdo');
  for (const pasta of PASTAS) {
    assert.deepEqual(fs.readdirSync(pasta).sort(), ['index.ts', nome].sort(), `${pasta}: só index.ts + o pacote da versão (nenhum labz.mjs antigo)`);
    const idx = fs.readFileSync(path.join(pasta, 'index.ts'), 'utf8');
    const imports = [...idx.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(imports, [`./${nome}`], `${pasta}/index.ts importa só o pacote da versão`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(pasta, nome))).digest('hex'), g.sha256, 'o arquivo importado é o gerado');
  }
  // o conferidor pega os 3 jeitos de errar: import apontando para o nome antigo, arquivo antigo sobrando, conteúdo trocado
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labz-pacote-'));
  try {
    const raiz = path.join(__dirname, '..', 'supabase');
    fs.cpSync(raiz, path.join(tmp, 'supabase'), { recursive: true, filter: (f) => !f.includes(`${path.sep}migrations`) });
    const copia = path.join(tmp, 'supabase', 'empacotar.js');
    // o empacotador copiado procura src/ e node_modules/ um nível acima: aponte para o projeto real
    fs.symlinkSync(path.join(__dirname, '..', 'src'), path.join(tmp, 'src'));
    fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(tmp, 'node_modules'));
    const E = require(copia);
    const g2 = E.gerar();
    assert.deepEqual(E.conferirPastas(g2), []);
    const api = E.PASTAS[0];
    const idx = path.join(api, 'index.ts');
    const original = fs.readFileSync(idx, 'utf8');
    fs.writeFileSync(idx, original.replace(`./${nome}`, './labz.mjs'));
    assert.ok(E.conferirPastas(g2).some((p) => /não importa/.test(p)), 'import para o nome antigo é pego');
    fs.writeFileSync(idx, original);
    fs.writeFileSync(path.join(api, 'labz.mjs'), 'antigo');
    assert.ok(E.conferirPastas(g2).some((p) => /arquivos a mais: labz\.mjs/.test(p)), 'arquivo antigo sobrando é pego');
    E.gravar(g2); // o empacotador apaga o antigo e reescreve o import
    assert.ok(!fs.existsSync(path.join(api, 'labz.mjs')));
    fs.writeFileSync(path.join(api, nome), `${g2.texto}// trocado\n`);
    assert.ok(E.conferirPastas(g2).some((p) => /desatualizado/.test(p)), 'conteúdo trocado é pego');
    E.gravar(g2);
    assert.deepEqual(E.conferirPastas(g2), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('worker: rodada VAZIA (cron sem nada para fazer) não grava auditoria; rodada com trabalho grava', async () => {
  const c = await montarBorda();
  const w = criarWorker({ servicos: c });
  const contar = async () => (await c.auditoria.listarPagina({ tipo: 'worker.rodada', limite: 100 })).itens.length;
  for (let i = 0; i < 5; i++) await w.rodar({ acionamento: { id: `acn_${String(i).repeat(32)}`, motivo: 'cron' } });
  assert.equal(await contar(), 0, '5 rodadas vazias, nenhum evento');
  await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.A.id, objetivo: 'Escrever as legendas da semana.' } });
  await w.rodar({ acionamento: { id: `acn_${'9'.repeat(32)}`, motivo: 'fila' } });
  assert.equal(await contar(), 1, 'a rodada que trabalhou fica registrada');
});

test('S5B: as conferências SQL do roteiro são SOMENTE LEITURA (nada de gravar, criar, alterar ou apagar)', () => {
  const dir = path.join(__dirname, '..', 'supabase', 's5b');
  const sqls = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  assert.deepEqual(sqls.sort(), ['00-verificar-projeto.sql', '10-conferir-permissoes.sql']);
  for (const f of sqls) {
    const codigo = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"); // textos entre aspas não são comandos
    assert.doesNotMatch(codigo, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|copy|do|call|perform|set|vacuum|cluster|reindex|comment|lock|pg_read_file|lo_import|dblink)\b/i, f);
    const comandos = codigo.split(';').map((x) => x.trim()).filter(Boolean);
    assert.ok(comandos.length >= 4 && comandos.every((x) => /^select\b/i.test(x)), `${f}: só SELECT`);
  }
});
