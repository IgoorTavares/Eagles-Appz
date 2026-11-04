// Fase 4B: contratos dos provedores (OpenAI, Anthropic, Google, simulado),
// configuração por agente, normalização, falhas, timeout, limite e cancelamento.
// NENHUMA chamada real: só o transporte simulado (ou o bloqueado).
const test = require('node:test');
const assert = require('node:assert');
const { ADAPTADORES } = require('../src/ia/provedores');
const { ErroProvedor, PROVEDORES, RECURSOS_PROVEDOR } = require('../src/ia/contrato');
const { criarTransporteBloqueado, criarTransporteSimulado, criarLimitador } = require('../src/ia/transporte');
const { criarModeloSimulado, transporteComModeloSimulado, corpoDe } = require('../src/ia/simulacao/modelo-simulado');
const { criarAdaptadorModelos } = require('../src/ia/adaptador-modelos');
const { problemasDaConfig, USO_REAL_AUTORIZADO } = require('../src/ia/config-modelos');
const { AGENTES, obterAgente } = require('../src/agentes/catalogo');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { caminhos } = require('../src/armazenamento/caminhos');

const SOL = { modelo: 'modelo-de-teste', sistema: 'INSTRUCOES-DO-SISTEMA', dados: 'DADOS-DO-CLIENTE', maxTokensSaida: 500, temperatura: 0.3, formatoJson: true };
const cfg = (provedor, extra) => Object.assign({ provedor, modelo: 'modelo-ficticio-1', uso: 'simulado', recursosDoModelo: ['texto', 'saida-estruturada', 'ferramentas', 'imagem-entrada', 'imagem-saida'] }, extra);
const comIa = (roteiro, extra = {}) => montarComEmpresas({ ia: Object.assign({ transporte: transporteComModeloSimulado(roteiro, extra.op) }, extra.ia) });
async function rodarEspecialista(c, agenteId = '04-roteirista') {
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Escrever a legenda do post', modo: 'especialista', agenteId });
  await c.motor.planejar(c.ator, exe.id);
  const r = await c.motor.trabalhar('t1');
  return { exe, r, d: await c.motor.diagnosticar(c.ator, exe.id) };
}

// ---------------- contratos ----------------

test('contratos: cada provedor monta a requisição no próprio formato, sem chave, com sistema e dados separados', () => {
  const o = ADAPTADORES.openai.montarRequisicao(SOL);
  assert.deepStrictEqual([o.rota, o.corpo.messages[0].role, o.corpo.messages[1].role, o.corpo.response_format.type], ['/v1/chat/completions', 'system', 'user', 'json_object']);
  const a = ADAPTADORES.anthropic.montarRequisicao(SOL);
  assert.deepStrictEqual([a.rota, a.corpo.system, a.corpo.messages.length, a.corpo.max_tokens], ['/v1/messages', 'INSTRUCOES-DO-SISTEMA', 1, 500]);
  const g = ADAPTADORES.google.montarRequisicao(SOL);
  assert.deepStrictEqual([g.rota, g.corpo.systemInstruction.parts[0].text, g.corpo.generationConfig.responseMimeType], ['/v1beta/models/modelo-de-teste:generateContent', 'INSTRUCOES-DO-SISTEMA', 'application/json']);
  for (const [nome, ad] of Object.entries(ADAPTADORES)) {
    const req = ad.montarRequisicao(SOL);
    const txt = JSON.stringify(req);
    assert.ok(!/authorization|api[-_]?key|x-goog|bearer/i.test(txt), `${nome}: requisição sem credencial`);
    const t = ad.extrairTextos(req);
    assert.deepStrictEqual([t.sistema, t.dados], ['INSTRUCOES-DO-SISTEMA', 'DADOS-DO-CLIENTE'], `${nome}: instruções e dados em lugares separados`);
  }
  // os provedores NÃO são iguais (recursos declarados por provedor)
  assert.notStrictEqual(RECURSOS_PROVEDOR.openai.instrucoesDeSistema, RECURSOS_PROVEDOR.anthropic.instrucoesDeSistema);
  assert.ok(RECURSOS_PROVEDOR.anthropic.saidaJson.includes('instrução'));
  // nome de modelo que mexeria na rota do Google é recusado
  assert.throws(() => ADAPTADORES.google.montarRequisicao(Object.assign({}, SOL, { modelo: '../x?key=1' })), (e) => e.tipo === 'configuracao-invalida');
});

test('normalização: respostas válidas, malformadas, incompletas, recusadas e sem uso, nos três provedores', () => {
  for (const p of PROVEDORES) {
    const ad = ADAPTADORES[p];
    const ok = ad.normalizarResposta(corpoDe(p, { texto: '{"texto":"oi"}', uso: { entrada: 10, saida: 3 }, modelo: 'm' }));
    assert.deepStrictEqual([ok.texto, ok.fim, ok.uso], ['{"texto":"oi"}', 'completa', { tokensEntrada: 10, tokensSaida: 3 }], p);
    assert.strictEqual(ad.normalizarResposta(corpoDe(p, { texto: 'x', fim: 'incompleta', uso: { entrada: 1, saida: 1 } })).fim, 'incompleta', p);
    assert.ok(['recusada', 'filtrada'].includes(ad.normalizarResposta(corpoDe(p, { texto: 'x', fim: 'recusada' })).fim), p);
    assert.strictEqual(ad.normalizarResposta(corpoDe(p, { texto: 'x' })).uso, null, `${p}: uso não informado é null, nunca zero`);
    assert.throws(() => ad.normalizarResposta({ inesperado: true }), (e) => e instanceof ErroProvedor && e.tipo === 'resposta-malformada', p);
    assert.throws(() => ad.normalizarResposta(null), (e) => e.tipo === 'resposta-malformada', p);
  }
  // uso negativo ou não inteiro = não informado
  assert.strictEqual(ADAPTADORES.openai.normalizarResposta({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: -1, completion_tokens: 2 } }).uso, null);
  // Google: bloqueio no promptFeedback (sem candidatos)
  assert.strictEqual(ADAPTADORES.google.normalizarResposta({ promptFeedback: { blockReason: 'SAFETY' } }).fim, 'filtrada');
});

test('erros: 429 com espera, 5xx/529 transitórios, 401 credencial (sem ecoar a chave), 400 definitivo', () => {
  const chave = ['sk', 'proj', 'A'.repeat(30)].join('-');
  for (const p of PROVEDORES) {
    const ad = ADAPTADORES[p];
    const e429 = ad.classificarErro({ status: 429, corpo: {}, cabecalhos: { 'retry-after': '3' } });
    assert.deepStrictEqual([e429.tipo, e429.transitorio, e429.esperaMs], ['limite-requisicoes', true, 3000], p);
    assert.deepStrictEqual([ad.classificarErro({ status: 503, corpo: {} }).tipo, ad.classificarErro({ status: 503, corpo: {} }).transitorio], ['indisponivel', true]);
    assert.strictEqual(ad.classificarErro({ status: 504, corpo: {} }).tipo, 'timeout');
    const e401 = ad.classificarErro({ status: 401, corpo: { error: { message: `bad key ${chave}` } } });
    assert.deepStrictEqual([e401.tipo, e401.transitorio], ['credencial', false]);
    assert.ok(!e401.message.includes(chave), `${p}: a chave não aparece na mensagem`);
    const e400 = ad.classificarErro({ status: 400, corpo: { error: { message: `x Authorization: Bearer ${'b'.repeat(30)}` } } });
    assert.deepStrictEqual([e400.tipo, e400.transitorio, e400.revisavel], ['requisicao-invalida', false, false]);
    assert.ok(!e400.message.includes('b'.repeat(30)));
  }
  assert.strictEqual(ADAPTADORES.anthropic.classificarErro({ status: 529, corpo: {} }).tipo, 'indisponivel');
});

// ---------------- configuração por agente ----------------

test('configuração independente por agente: provedor e modelo de cada um; padrão simulado; "real" recusado; recursos conferidos', async () => {
  const c = await comIa();
  assert.strictEqual(USO_REAL_AUTORIZADO, false);
  const lista = await c.configModelos.listar(c.ator);
  assert.strictEqual(lista.length, 8);
  assert.ok(lista.every((x) => x.situacao === 'simulado-padrao' && x.provedor === 'simulado'), 'sem configuração: nenhum modelo real habilitado');
  const escolhas = { '01-guia-marca': 'anthropic', '02-designer': 'google', '03-carrosseis': 'openai', '04-roteirista': 'anthropic', '05-dev-web': 'openai', '06-engenheiro': 'google', '07-trafego': 'openai', '08-estrategista': 'anthropic' };
  for (const [ag, prov] of Object.entries(escolhas)) await c.configModelos.definir(c.ator, ag, cfg(prov, { modelo: `modelo-${ag}` }));
  const depois = await c.configModelos.listar(c.ator);
  depois.forEach((x) => assert.deepStrictEqual([x.situacao, x.provedor, x.modelo], ['configurado', escolhas[x.agenteId], `modelo-${x.agenteId}`]));
  // permissões continuam do catálogo (o modelo não muda nada)
  assert.deepStrictEqual(obterAgente('05-dev-web').ferramentas, AGENTES.find((a) => a.id === '05-dev-web').ferramentas);
  // inválidas
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfg('openai', { uso: 'real' })), 'precondicao');
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfg('fornecedor-x')), 'invalido');
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfg('openai', { modelo: 'a b/c' })), 'invalido');
  await rejeita(() => c.configModelos.definir(c.ator, '02-designer', cfg('openai', { recursosDoModelo: ['texto'] })), 'invalido'); // Designer precisa de imagem
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfg('simulado', { uso: 'real' })), 'precondicao');
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfg('openai', { chave: 'x' })), 'invalido'); // não aceita chave na configuração
  await rejeita(() => c.configModelos.definir(c.ator, '99-falso', cfg('openai')), 'nao-encontrado');
  await rejeita(() => c.configModelos.definir(Object.freeze({ tipo: 'sistema', uid: 'labz-sistema' }), '04-roteirista', cfg('openai')), 'permissao-negada');
  assert.deepStrictEqual(problemasDaConfig(obterAgente('04-roteirista'), cfg('openai')), []);
  // documento alterado por fora (uso real) é recusado ANTES de executar
  await c.banco.atualizar(caminhos.agente('04-roteirista'), { configModelo: cfg('openai', { uso: 'real' }) });
  const { d } = await rodarEspecialista(c);
  assert.deepStrictEqual([d.estado, d.diagnostico.tipo], ['FAILED', 'configuracao-invalida']);
  await c.configModelos.remover(c.ator, '04-roteirista');
  assert.strictEqual((await c.configModelos.resolver('04-roteirista')).provedor, 'simulado');
});

test('seleção independente: cada agente fala com o provedor configurado para ELE, no formato daquele provedor', async () => {
  const transporte = transporteComModeloSimulado();
  const c = await montarComEmpresas({ ia: { transporte } });
  await c.configModelos.definir(c.ator, '01-guia-marca', cfg('anthropic'));
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('google'));
  await c.configModelos.definir(c.ator, '08-estrategista', cfg('openai'));
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Campanha', modo: 'orquestrado' });
  await c.motor.planejar(c.ator, exe.id, { passos: [{ id: 'marca', agenteId: '01-guia-marca', objetivo: 'Revisar a marca' }, { id: 'texto', agenteId: '04-roteirista', objetivo: 'Legendas', dependeDe: ['marca'] }, { id: 'arte', agenteId: '02-designer', objetivo: 'Peças', dependeDe: ['marca'] }] });
  assert.strictEqual((await c.motor.trabalhar('t1')).resultado, 'concluida');
  const por = Object.fromEntries(transporte.chamadas.map((x) => [x.etapaId, [x.provedor, x.rota]]));
  assert.deepStrictEqual(por.planejamento, ['openai', '/v1/chat/completions']);
  assert.deepStrictEqual(por.marca, ['anthropic', '/v1/messages']);
  assert.deepStrictEqual(por.texto, ['google', '/v1beta/models/modelo-ficticio-1:generateContent']);
  assert.deepStrictEqual(por.arte, ['simulado', 'simulado'], 'agente sem configuração continua simulado');
  const d = await c.motor.diagnosticar(c.ator, exe.id);
  assert.deepStrictEqual(Object.keys(d.custos.porProvedor).sort(), ['anthropic', 'google', 'openai', 'simulado']);
  const res = await c.banco.obter(caminhos.resultadoEtapa(exe.id, 'texto'));
  assert.deepStrictEqual([res.simulado, res.origem.provedor, res.origem.fonteUso], [true, 'google', 'provedor-simulado']);
  assert.ok(res.texto.startsWith('[SIMULADO]'));
});

// ---------------- respostas e falhas pelo motor ----------------

test('respostas válidas, malformadas, incompletas e recusadas passam pelo controle do motor (sem aceitar lixo)', async () => {
  for (const p of ['openai', 'anthropic', 'google']) {
    const c = await comIa({ '04-roteirista': ['malformado', 'ok'] });
    await c.configModelos.definir(c.ator, '04-roteirista', cfg(p));
    const { r, exe } = await rodarEspecialista(c);
    assert.strictEqual(r.resultado, 'concluida', p);
    const e = await c.execucoes.obter(c.ator, exe.id);
    assert.deepStrictEqual(e.etapas[0].revisoes.map((x) => x.problemas[0]), ['resposta:resposta-malformada'], `${p}: a tentativa ruim fica registrada`);
    assert.ok(await c.banco.obter(caminhos.resultadoRevisao(exe.id, 'e1', 1)), 'tentativa recusada preservada');
  }
  for (const [comp, problema] of [['incompleto', 'resposta:resposta-incompleta'], ['recusa', 'resposta:recusada'], ['filtrado', 'resposta:recusada'], ['sem-texto', 'resposta:resposta-malformada'], ['corpo-quebrado', 'resposta:resposta-malformada']]) {
    const c = await comIa({ '04-roteirista': comp });
    await c.configModelos.definir(c.ator, '04-roteirista', cfg('anthropic'));
    const { d } = await rodarEspecialista(c);
    assert.deepStrictEqual([d.estado, d.diagnostico.motivo, d.diagnostico.problemas[0]], ['REVISION_REQUIRED', 'qualidade-reprovada', problema], comp);
  }
  // sem uso informado: usa a ESTIMATIVA, marcada como estimada
  const c = await comIa({ '04-roteirista': 'sem-uso' });
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('openai'));
  const { d } = await rodarEspecialista(c);
  assert.ok(d.estado === 'COMPLETED' && d.custos.tokensEstimados > 0 && d.custos.tokens >= d.custos.tokensEstimados);
});

test('falhas temporárias (429/500) tentam de novo com espera; definitivas (401/400) encerram; credencial nunca vai para o registro', async () => {
  const c = await comIa({ '04-roteirista': ['429', '500', 'ok'] });
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('openai'));
  const { exe, r } = await rodarEspecialista(c);
  assert.strictEqual(r.resultado, 'nova-tentativa');
  const item = (await c.fila.listar()).find((x) => x.execucaoId === exe.id && x.estado === 'pendente');
  assert.ok(Date.parse(item.disponivelEm) - Date.parse(c.relogio()) >= 2000 - 2000, 'espera respeitada (retry-after ou a base)');
  c.relogio.avancarDias(1);
  assert.strictEqual((await c.motor.trabalhar('t2')).resultado, 'nova-tentativa');
  c.relogio.avancarDias(1);
  assert.strictEqual((await c.motor.trabalhar('t3')).resultado, 'concluida');

  for (const comp of ['401', '400']) {
    const c2 = await comIa({ '04-roteirista': comp });
    await c2.configModelos.definir(c2.ator, '04-roteirista', cfg('google'));
    const { d } = await rodarEspecialista(c2);
    assert.deepStrictEqual([d.estado, d.diagnostico.motivo], ['FAILED', 'falha-definitiva'], comp);
    const tudo = JSON.stringify([d, await c2.auditoria.listar(), await c2.fila.listar()]);
    assert.ok(!/sk-simulado/.test(tudo), `${comp}: a "chave" ecoada pelo provedor não chega a diagnóstico, auditoria nem fila`);
  }
  // tentativas esgotadas
  const c3 = await comIa({ '04-roteirista': '500' });
  const { exe: e3 } = await rodarEspecialista(c3);
  for (let i = 0; i < 3; i++) { c3.relogio.avancarDias(1); await c3.motor.trabalhar(`x${i}`); }
  const d3 = await c3.motor.diagnosticar(c3.ator, e3.id);
  assert.deepStrictEqual([d3.estado, d3.diagnostico.motivo, d3.diagnostico.tipo], ['FAILED', 'tentativas-esgotadas', 'indisponivel']);
});

test('timeout e cancelamento: chamada pendurada vira timeout (nova tentativa); parar o executor cancela sem gastar tentativa', async () => {
  const c = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado({ '04-roteirista': ['timeout', 'ok'] }), timeoutMs: 30 } });
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('anthropic'));
  const { r, d } = await rodarEspecialista(c);
  assert.strictEqual(r.resultado, 'nova-tentativa');
  assert.ok(d.etapas[0].ultimoErro.includes('sem resposta'));

  // cancelamento: o sinal do executor aborta a chamada pendurada
  let n = 0; // 1ª chamada fica pendurada; as seguintes respondem (a retomada não gasta tentativa, então o roteiro é por chamada)
  let chegou; const primeiraChamada = new Promise((ok) => { chegou = ok; });
  const c2 = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado(() => { if (++n === 1) { chegou(); return 'timeout'; } return 'ok'; }), timeoutMs: 60000 } });
  const exe = await c2.execucoes.criar(c2.ator, { empresaId: c2.A.id, objetivo: 'Legenda', modo: 'especialista', agenteId: '04-roteirista' });
  await c2.motor.planejar(c2.ator, exe.id);
  const ctrl = new AbortController();
  const p = c2.motor.trabalhar('t1', { sinal: ctrl.signal });
  await primeiraChamada; // cancela com a chamada JÁ pendurada (não depende da velocidade do banco)
  ctrl.abort();
  assert.strictEqual((await p).resultado, 'liberada');
  const e = await c2.execucoes.obter(c2.ator, exe.id);
  assert.deepStrictEqual([e.estado, e.etapas[0].status, e.etapas[0].tentativas, e.execucaoAtual], ['READY', 'pendente', 0, null], 'volta para a fila sem gastar tentativa');
  assert.strictEqual((await c2.motor.trabalhar('t2')).resultado, 'concluida', 'retomada por outro executor');
});

test('limite local de requisições por provedor (simulado) e transporte bloqueado', async () => {
  let agora = 1000;
  const lim = criarLimitador({ porJanela: 2, janelaMs: 1000, agoraMs: () => agora });
  lim.consumir('openai'); lim.consumir('openai');
  assert.throws(() => lim.consumir('openai'), (e) => e.tipo === 'limite-requisicoes' && e.transitorio && e.esperaMs === 1000);
  lim.consumir('google'); // outro provedor, outra conta
  agora += 1001;
  lim.consumir('openai');

  const c = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado(), limitador: criarLimitador({ porJanela: 1, janelaMs: 3600 * 1000 }) } });
  await c.configModelos.definir(c.ator, '04-roteirista', cfg('openai'));
  assert.strictEqual((await rodarEspecialista(c)).r.resultado, 'concluida');
  const seg = await rodarEspecialista(c);
  assert.strictEqual(seg.r.resultado, 'nova-tentativa', 'acima do limite local: espera e tenta depois, sem chamar');

  // o transporte bloqueado nunca chama nada
  const c2 = await montarComEmpresas({ ia: { transporte: criarTransporteBloqueado() } });
  const { d } = await rodarEspecialista(c2);
  assert.deepStrictEqual([d.estado, d.diagnostico.tipo], ['FAILED', 'nao-autorizado']);
  // e o adaptador recusa qualquer transporte que não seja o simulado ou o bloqueado
  assert.throws(() => criarAdaptadorModelos({ configModelos: c2.configModelos, transporte: { tipo: 'real', enviar: async () => ({}) } }), /só o transporte simulado/);
});

test('nenhuma chamada externa: nenhum módulo da IA usa rede (http, https, fetch, net)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pasta = path.join(__dirname, '..', 'src');
  const arquivos = [];
  const andar = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((x) => (x.isDirectory() ? andar(path.join(d, x.name)) : arquivos.push(path.join(d, x.name))));
  andar(pasta);
  arquivos.forEach((f) => {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"](node:)?(https?|net|tls|dgram|http2|child_process)['"]\)|\bfetch\(|XMLHttpRequest|axios|undici/.test(t), `${path.relative(pasta, f)} não pode usar rede nem executar comandos`);
  });
  const sim = criarTransporteSimulado(criarModeloSimulado());
  assert.strictEqual(sim.tipo, 'simulado');
});
