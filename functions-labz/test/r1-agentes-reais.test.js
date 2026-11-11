// R1 (plano dos agentes reais, versão 2, seções 5, 6 e 13): tudo LOCAL e SIMULADO.
// Nenhuma chave real, nenhuma chamada paga, nenhuma rede: o "provedor" é o modelo simulado e a
// "rede" do transporte real é uma função espiã que só conta se foi chamada.
// Os preços daqui são FICTÍCIOS (cadastrados pelo próprio teste; nunca vêm do código).
const test = require('node:test');
const assert = require('node:assert');
const anthropic = require('../src/ia/provedores/anthropic');
const { criarTransporteReal, criarTransporteSimulado } = require('../src/ia/transporte');
const { criarModeloSimulado, transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { removerDadosPessoais } = require('../src/ia/dados-pessoais');
const { criarRegistroChamadas, resultadoDesconhecido, MAX_CHAMADAS_PAGAS } = require('../src/ia/registro-chamadas');
const { MODELOS_ANTHROPIC, IDS_ANTHROPIC_PERMITIDOS, problemasDoModeloAnthropic } = require('../src/ia/modelos-anthropic');
const { USO_REAL_AUTORIZADO } = require('../src/ia/config-modelos');
const { ErroProvedor } = require('../src/ia/contrato');
const { esquemaDaResposta } = require('../src/ia/esquema-json');
const { PADRAO_LIMITES, custoDoUso, custoMaximo } = require('../src/motor/consumo');
const { caminhos } = require('../src/armazenamento/caminhos');
const { montarComEmpresas, memoriaAprovada, rejeita, precoFicticio } = require('./ajuda');

const HAIKU = 'claude-haiku-5-5';
const cfgA = (extra) => Object.assign({ provedor: 'anthropic', modelo: HAIKU, uso: 'simulado', maxTokensSaida: 1500, esforco: 'low', recursosDoModelo: ['texto', 'saida-estruturada', 'ferramentas', 'imagem-entrada'] }, extra);
const limites = (extra) => Object.assign(JSON.parse(JSON.stringify(PADRAO_LIMITES)), extra);
const mensagens = (t) => t.chamadas.filter((x) => x.rota === '/v1/messages');
// preço fictício "redondo" (US$ por milhão): entrada 1, saída 5, gravação de cache 1,25, leitura 0,1
const PRECO = { entradaPorMilhao: 1, saidaPorMilhao: 5, cacheEscritaPorMilhao: 1.25, cacheLeituraPorMilhao: 0.1, moeda: 'USD', fonte: 'PREÇO FICTÍCIO DE TESTE', conferidoEm: '2026-11-01' };

// transporte simulado que também guarda os CORPOS (só no teste) para provar o que sairia da máquina
function transporteEspiao(roteiro, opcoes) {
  const modelo = criarModeloSimulado(roteiro, opcoes);
  const corpos = [];
  const t = criarTransporteSimulado(async (x) => { corpos.push(JSON.stringify(x.requisicao)); return modelo(x); });
  t.corpos = corpos;
  return t;
}
async function cenario(roteiro, { opcoes, ia } = {}) {
  const transporte = transporteEspiao(roteiro || {}, opcoes);
  const c = await montarComEmpresas({ ia: Object.assign({ transporte }, ia) });
  c.transporte = transporte;
  await c.configModelos.definir(c.ator, '04-roteirista', cfgA());
  await precoFicticio(c);
  return c;
}
async function roteirista(c, empresaId, objetivo = 'Escrever a legenda do post de lançamento') {
  const exe = await c.execucoes.criar(c.ator, { empresaId: empresaId || c.A.id, objetivo, modo: 'especialista', agenteId: '04-roteirista' });
  await c.motor.planejar(c.ator, exe.id);
  const r = await c.motor.trabalhar(`t-${exe.id}`);
  return { exe, r, d: await c.motor.diagnosticar(c.ator, exe.id) };
}
const pedidoReserva = (c, extra) => Object.assign({ execucaoId: 'exe_teste', etapaId: 'e1', agenteId: '04-roteirista', empresaId: c.A.id, provedor: 'anthropic', modelo: HAIKU, tokensEntrada: 1000, tokensSaida: 1000 }, extra);

// ---------------- 1. adaptador da Anthropic ----------------

test('R1 adaptador: corpo nos moldes atuais — sem temperature/top_p/top_k, esforço, cache das instruções, saída estruturada, sem prefill nem ferramenta forçada', () => {
  const esquema = esquemaDaResposta('legenda-social');
  assert.ok(esquema && esquema.properties.documento && esquema.additionalProperties === false);
  const req = anthropic.montarRequisicao({ modelo: HAIKU, sistema: 'REGRAS', dados: 'DADOS', maxTokensSaida: 1500, temperatura: 0.9, esforco: 'low', esquemaJson: esquema });
  const c = req.corpo;
  for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'thinking']) assert.ok(!(k in c), `sem ${k}`);
  assert.deepStrictEqual([req.metodo, req.rota, c.model, c.max_tokens], ['POST', '/v1/messages', HAIKU, 1500]);
  assert.deepStrictEqual(c.system, [{ type: 'text', text: 'REGRAS', cache_control: { type: 'ephemeral' } }]);
  assert.deepStrictEqual(c.messages, [{ role: 'user', content: 'DADOS' }], 'só a mensagem do usuário (sem prefill do assistente)');
  assert.deepStrictEqual(c.output_config, { effort: 'low', format: { type: 'json_schema', schema: esquema } });
  assert.strictEqual(anthropic.montarRequisicao({ modelo: HAIKU, sistema: 's', dados: 'd', maxTokensSaida: 10 }).corpo.output_config.effort, 'medium', 'esforço padrão');
  assert.deepStrictEqual(Object.keys(req.cabecalhos).sort(), ['anthropic-version', 'content-type'], 'a chave nunca é posta pelo adaptador');
  // chamadas sem custo: contagem (mesmo corpo, sem max_tokens) e consulta do modelo
  const cont = anthropic.montarContagem({ modelo: HAIKU, sistema: 'REGRAS', dados: 'DADOS' });
  assert.deepStrictEqual([cont.rota, 'max_tokens' in cont.corpo], ['/v1/messages/count_tokens', false]);
  assert.strictEqual(anthropic.montarConsultaModelo(HAIKU).rota, `/v1/models/${HAIKU}`);
  assert.throws(() => anthropic.montarConsultaModelo('../v1/files'), (e) => e.tipo === 'configuracao-invalida');
  assert.throws(() => anthropic.normalizarContagem({}), (e) => e.tipo === 'resposta-malformada');
});

test('R1 adaptador: recusa guarda só a categoria; uso com cache separado; request-id; 529, 404 e modelo retirado classificados', () => {
  const rec = anthropic.normalizarResposta({ id: 'msg_1', model: HAIKU, content: [], stop_reason: 'refusal', stop_details: { category: 'cyber', explicacao: 'TEXTO QUE NÃO PODE SER GUARDADO' }, usage: { input_tokens: 10, output_tokens: 0 } }, { 'request-id': 'req_abc' });
  assert.deepStrictEqual([rec.fim, rec.categoriaRecusa, rec.requestId], ['recusada', 'cyber', 'req_abc']);
  assert.ok(!JSON.stringify(rec).includes('NÃO PODE SER GUARDADO'));
  const ok = anthropic.normalizarResposta({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 } });
  assert.deepStrictEqual([ok.texto, ok.fim, ok.uso], ['{"a":1}', 'completa', { tokensEntrada: 100, tokensSaida: 20, cacheEscrita: 3000, cacheLeitura: 0 }]);
  assert.strictEqual(anthropic.normalizarResposta({ content: [{ type: 'text', text: 'x' }], stop_reason: 'max_tokens' }).fim, 'incompleta');
  const e529 = anthropic.classificarErro({ status: 529, corpo: { error: { type: 'overloaded_error', message: 'Overloaded' } } });
  assert.deepStrictEqual([e529.tipo, e529.comCorpo], ['indisponivel', true]);
  assert.strictEqual(resultadoDesconhecido(e529), false, 'com corpo de erro, o provedor recusou: resultado conhecido (sem cobrança)');
  assert.strictEqual(anthropic.classificarErro({ status: 404, corpo: { error: { type: 'not_found_error', message: 'model: x' } } }).tipo, 'modelo-indisponivel');
  assert.strictEqual(anthropic.classificarErro({ status: 400, corpo: { error: { type: 'invalid_request_error', message: 'model claude-x has been retired' } } }).tipo, 'modelo-indisponivel');
  assert.notStrictEqual(anthropic.classificarErro({ status: 400, corpo: { error: { type: 'invalid_request_error', message: 'max_tokens too large' } } }).tipo, 'modelo-indisponivel');
});

// ---------------- 2. lista fechada de modelos e verificação sem custo ----------------

test('R1 modelos: só os 3 IDs da lista fechada; recursos, teto de saída e esforço conferidos; nenhum preço no código', async () => {
  assert.deepStrictEqual(IDS_ANTHROPIC_PERMITIDOS, ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  assert.ok(Object.values(MODELOS_ANTHROPIC).every((m) => !Object.keys(m).some((k) => /preco|price|custo/i.test(k))));
  assert.match(problemasDoModeloAnthropic('claude-3-opus')[0], /fora da lista fechada/);
  assert.match(problemasDoModeloAnthropic(HAIKU, { recursos: ['imagem-saida'] })[0], /não gera imagem/);
  assert.match(problemasDoModeloAnthropic(HAIKU, { maxTokensSaida: 200000 })[0], /teto de saída/);
  assert.match(problemasDoModeloAnthropic(HAIKU, { esforco: 'max' })[0], /esforço/);
  assert.deepStrictEqual(problemasDoModeloAnthropic(HAIKU, { recursos: ['texto', 'imagem-entrada'], maxTokensSaida: 4000, esforco: 'high' }), []);
  const c = await cenario();
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfgA({ modelo: 'claude-3-opus' })), 'invalido');
  await rejeita(() => c.configModelos.definir(c.ator, '02-designer', cfgA({ recursosDoModelo: ['texto', 'imagem-entrada', 'imagem-saida'] })), 'invalido');
  await rejeita(() => c.configModelos.definir(c.ator, '04-roteirista', cfgA({ uso: 'real' })), 'precondicao');
  assert.strictEqual(USO_REAL_AUTORIZADO, false, 'uso real continua trancado na R1');
});

test('R1 verificação sem custo: consulta GET do modelo; indisponível (404), teto acima do informado e modelo trocado viram problema; evento sem chave', async () => {
  const c = await cenario({}, { opcoes: { modelos: { 'claude-sonnet-5-5': { max_tokens: 1000 } }, modelosIndisponiveis: ['claude-opus-5-5'] } });
  const ok = await c.verificacaoModelos.verificar('04-roteirista');
  assert.deepStrictEqual([ok.ok, ok.modelo, ok.limites.maxSaida, ok.problemas], [true, HAIKU, 128000, []]);
  await c.configModelos.definir(c.ator, '04-roteirista', cfgA({ modelo: 'claude-sonnet-5-5', maxTokensSaida: 4000 }));
  const teto = await c.verificacaoModelos.verificar('04-roteirista');
  assert.ok(!teto.ok && /teto de saída 4000/.test(teto.problemas.join()));
  await c.configModelos.definir(c.ator, '04-roteirista', cfgA({ modelo: 'claude-opus-5-5' }));
  const ind = await c.verificacaoModelos.verificar('04-roteirista');
  assert.ok(!ind.ok && /indisponível/.test(ind.problemas.join()));
  assert.ok(c.transporte.chamadas.every((x) => /^\/v1\/models\//.test(x.rota)), 'só consultas de modelo (nenhum texto gerado)');
  assert.strictEqual(mensagens(c.transporte).length, 0);
  const sim = await c.verificacaoModelos.verificar('02-designer');
  assert.deepStrictEqual([sim.ok, sim.provedor, sim.semCusto], [true, 'simulado', true]);
  const ev = (await c.auditoria.listar()).filter((e) => e.tipo === 'modelo.verificado');
  assert.strictEqual(ev.length, 3);
  assert.ok(ev.every((e) => Object.keys(e.detalhes).sort().join() === 'modelo,ok,problemas,provedor'));
});

// ---------------- 3. transporte real trancado ----------------

test('R1 transporte real: trancado por padrão e em cada trava, NA ORDEM, sem tocar a rede; a chave nunca aparece', async () => {
  const CHAVE = ['chave', 'ficticia', 'de', 'teste', '0123456789'].join('-');
  let rede = 0;
  const buscar = async () => { rede += 1; return { status: 200, headers: new Map([['request-id', 'req_1']]), json: async () => ({ ok: true }) }; };
  const req = anthropic.montarRequisicao({ modelo: HAIKU, sistema: 's', dados: 'd', maxTokensSaida: 10 });
  const casos = [
    [{}, 'anthropic', req, 'nao-autorizado', /não estão autorizadas/],
    [{ autorizado: 'true', buscar, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true }, 'anthropic', req, 'nao-autorizado', /não estão autorizadas/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true }, 'openai', req, 'nao-autorizado', /fora da lista/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true }, 'anthropic', Object.assign({}, req, { rota: '/v1/files' }), 'nao-autorizado', /Rota/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true }, 'anthropic', Object.assign({}, req, { rota: '/v1/messages/batches' }), 'nao-autorizado', /Rota/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => CHAVE, provedorLigado: async () => false }, 'anthropic', req, 'nao-autorizado', /interruptor/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => CHAVE }, 'anthropic', req, 'nao-autorizado', /interruptor/],
    [{ autorizado: true, buscar, chaveDoProvedor: () => '', provedorLigado: async () => true }, 'anthropic', req, 'credencial', /não configurada/],
    [{ autorizado: true, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true }, 'anthropic', req, 'nao-autorizado', /sem função de rede/],
  ];
  for (const [op, prov, r, tipo, msg] of casos) {
    const t = criarTransporteReal(op);
    await assert.rejects(t.enviar(prov, r), (e) => e instanceof ErroProvedor && e.tipo === tipo && msg.test(e.message) && !e.message.includes(CHAVE));
    assert.deepStrictEqual(t.contagem, { tentativasBarradas: tipo === 'credencial' || tipo === 'nao-autorizado' ? 1 : 0, enviadas: 0 });
  }
  assert.strictEqual(rede, 0, 'nenhuma trava deixou passar para a rede');
  // com TODAS as travas abertas (só aqui, com rede FALSA): endereço oficial, chave só no cabeçalho, sem seguir redirecionamento
  let visto;
  const t = criarTransporteReal({ autorizado: true, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true, buscar: async (url, init) => { visto = { url, init }; return { status: 200, headers: new Map([['request-id', 'req_9']]), json: async () => ({ ok: 1 }) }; } });
  const resp = await t.enviar('anthropic', req);
  assert.deepStrictEqual([visto.url, visto.init.method, visto.init.redirect, visto.init.headers['x-api-key'], resp.status, resp.cabecalhos['request-id']], ['https://api.anthropic.com/v1/messages', 'POST', 'error', CHAVE, 200, 'req_9']);
  assert.ok(!visto.init.body.includes(CHAVE) && !JSON.stringify(resp).includes(CHAVE));
  // queda de rede = sem corpo de erro = resultado DESCONHECIDO
  const caiu = criarTransporteReal({ autorizado: true, chaveDoProvedor: () => CHAVE, provedorLigado: async () => true, buscar: async () => { throw new Error(`socket hang up ${CHAVE}`); } });
  await assert.rejects(caiu.enviar('anthropic', req), (e) => e.tipo === 'indisponivel' && !e.comCorpo && resultadoDesconhecido(e) && !e.message.includes(CHAVE));
});

test('R1 transporte real ligado ao sistema: com o transporte trancado, uma tarefa inteira não sai para a rede', async () => {
  let rede = 0;
  const transporte = criarTransporteReal({ buscar: async () => { rede += 1; throw new Error('não deveria chegar aqui'); }, chaveDoProvedor: () => 'x'.repeat(40), provedorLigado: async () => true });
  const c = await montarComEmpresas({ ia: { transporte } });
  await c.configModelos.definir(c.ator, '04-roteirista', cfgA());
  await precoFicticio(c);
  const { d } = await roteirista(c);
  assert.notStrictEqual(d.estado, 'COMPLETED');
  assert.strictEqual(rede, 0);
  assert.strictEqual(transporte.contagem.enviadas, 0);
  assert.ok(transporte.contagem.tentativasBarradas >= 1);
  assert.strictEqual((await c.consumo.doDia(c.ator)).global.custo, 0, 'nenhum custo');
});

// ---------------- 4. dados pessoais (D5) e isolamento entre empresas ----------------

test('R1 D5: CPF, e-mail, telefone, CEP e endereço são removidos; CNPJ, valores e datas ficam', () => {
  const entrada = [
    'Contato: joao.silva+lead@exemplo.com.br e MARIA@EMPRESA.COM',
    'CPF 123.456.789-09 e 98765432100. Outro: 222.333.444-05.',
    'Tel (11) 98765-4321, +55 11 3456-7890, 11 912345678 e 3456 7890',
    'CEP 01310-100 e 01.310-100',
    'Mora na Rua das Flores, 123 e trabalha na Av. Paulista 1000',
    'CNPJ 12.345.678/0001-90; preço R$ 1.500,00; data 2026-11-10; 30% de desconto; ano 2026; 150 mil seguidores',
  ].join('\n');
  const r = removerDadosPessoais(entrada);
  for (const v of ['joao.silva', 'MARIA@', '123.456.789-09', '98765432100', '222.333.444-05', '98765-4321', '3456-7890', '912345678', '3456 7890', '01310-100', '01.310-100', 'Flores, 123', 'Paulista 1000']) assert.ok(!r.texto.includes(v), `removido: ${v}`);
  for (const v of ['12.345.678/0001-90', 'R$ 1.500,00', '2026-11-10', '30%', 'ano 2026', '150 mil']) assert.ok(r.texto.includes(v), `mantido: ${v}`);
  assert.deepStrictEqual(r.removidos, { email: 2, cpf: 3, cep: 2, telefone: 4, endereco: 2 });
  assert.strictEqual(r.total, 13);
  assert.deepStrictEqual(removerDadosPessoais(null), { texto: '', removidos: {}, total: 0 });
});

test('R1 D5 + isolamento: nada pessoal sai da máquina; a memória de outra empresa nunca entra no pedido', async () => {
  const c = await cenario();
  await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', chave: 'tom-alfa', titulo: 'Tom da legenda de lançamento', conteudo: 'MARCA-SECRETA-ALFA-7731: legenda de lançamento com tom alegre.' });
  await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.B.id }, categoria: 'marca', chave: 'tom-beta', titulo: 'Tom da legenda de lançamento', conteudo: 'MARCA-BETA-4410: legenda de lançamento sóbria. Responsável: ana.souza@exemplo.com, (21) 99876-5432, CPF 111.222.333-96.' }, { confirmoSinais: true });
  const { r, exe } = await roteirista(c, c.B.id, 'Escrever a legenda do post de lançamento com o tom da marca');
  assert.strictEqual(r.resultado, 'concluida');
  const saiu = c.transporte.corpos.join('\n');
  assert.ok(saiu.includes('MARCA-BETA-4410'), 'a memória da própria empresa entrou (o teste é significativo)');
  assert.ok(!saiu.includes('MARCA-SECRETA-ALFA-7731'), 'a memória da OUTRA empresa nunca sai');
  for (const v of ['ana.souza', '99876-5432', '111.222.333-96']) assert.ok(!saiu.includes(v), `dado pessoal não sai: ${v}`);
  assert.ok(saiu.includes('[e-mail removido]') && saiu.includes('[CPF removido]'));
  const res = await c.banco.obter(caminhos.resultadoEtapa(exe.id, 'e1'));
  assert.ok(!JSON.stringify(res).includes('ana.souza'));
  assert.ok(res.origem.removidosD5 >= 3, 'só a CONTAGEM do que foi removido fica registrada');
  // o provedor simulado (sem custo, nada sai) não é filtrado: o texto de referência continua igual
  const c2 = await cenario();
  await c2.configModelos.remover(c2.ator, '04-roteirista');
  const r2 = await roteirista(c2);
  assert.strictEqual((await c2.banco.obter(caminhos.resultadoEtapa(r2.exe.id, 'e1'))).origem.provedor, 'simulado');
  assert.ok(c2.transporte.corpos.length >= 1 && c2.transporte.corpos.every((x) => !x.includes('[e-mail removido]')));
});

// ---------------- 5. registro das chamadas pagas e resultado desconhecido ----------------

test('R1 resultado desconhecido: sem resposta → NÃO repete; a reserva inteira vira custo provável; retomar libera uma nova chamada', async () => {
  let n = 0; // por CHAMADA (a retomada zera as tentativas): a 1ª do Roteirista fica sem resposta
  const c = await cenario((meta) => (meta.agenteId === '04-roteirista' && ++n === 1 ? 'timeout' : 'ok'), { ia: { timeoutMs: 30 } });
  const { exe, r, d } = await roteirista(c);
  assert.deepStrictEqual([r.resultado, d.estado, d.diagnostico.motivo], ['resultado-desconhecido', 'REVISION_REQUIRED', 'resultado-desconhecido']);
  assert.strictEqual(mensagens(c.transporte).length, 1);
  const reg = criarRegistroChamadas({ banco: c.banco });
  const [ch] = await reg.listar(exe.id, 'e1');
  assert.deepStrictEqual([ch.n, ch.chave, ch.estado, ch.tipoErro], [1, `${exe.id}:e1:1`, 'desconhecido', 'timeout']);
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.chamadas, dia.global.provaveis, dia.global.custo, dia.global.custoDesconhecido], [1, 1, ch.reserva.custo.valor, 0], 'conta o MÁXIMO (a reserva inteira), nunca zero');
  assert.ok(ch.reserva.custo.valor > 0);
  assert.strictEqual(dia.mes.global.custo, ch.reserva.custo.valor, 'o mês também conta');
  // o executor não pega de novo sozinho
  assert.strictEqual(await c.motor.trabalhar('t2'), null, 'fila vazia');
  assert.strictEqual(mensagens(c.transporte).length, 1);
  // decisão do Super Admin: retomar → nova chamada (n = 2)
  await c.motor.retomar(c.ator, exe.id);
  assert.strictEqual((await c.motor.trabalhar('t3')).resultado, 'concluida');
  assert.strictEqual(mensagens(c.transporte).length, 2);
  const lista = await reg.listar(exe.id, 'e1');
  assert.deepStrictEqual(lista.map((x) => [x.n, x.estado, !!x.liberadaEm]), [[1, 'desconhecido', true], [2, 'concluida', false]]);
  assert.ok((await c.auditoria.listar()).some((e) => e.tipo === 'execucao.chamadas_liberadas' || /chamadas_liberadas/.test(e.tipo)));
});

test('R1 worker caiu depois de enviar: a chamada "em andamento" que ficou para trás bloqueia, é contada e vai para decisão', async () => {
  const c = await cenario();
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Escrever a legenda', modo: 'especialista', agenteId: '04-roteirista' });
  await c.motor.planejar(c.ator, exe.id);
  // simula o worker que reservou, gravou "em-andamento", enviou e caiu (sem fechar)
  const res = await c.consumo.reservar(pedidoReserva(c, { execucaoId: exe.id }));
  const reg = criarRegistroChamadas({ banco: c.banco });
  await reg.abrir({ execucaoId: exe.id, etapaId: 'e1', agenteId: '04-roteirista', provedor: 'anthropic', modelo: HAIKU, reserva: { dia: res.dia, reservaId: res.reservaId, tokens: res.tokens, custo: res.custo } });
  const r = await c.motor.trabalhar('t-novo');
  assert.strictEqual(r.resultado, 'bloqueada-por-chamada');
  assert.strictEqual(mensagens(c.transporte).length, 0, 'nenhuma chamada nova');
  const [ch] = await reg.listar(exe.id, 'e1');
  assert.deepStrictEqual([ch.estado, ch.tipoErro], ['desconhecido', 'interrupcao']);
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.provaveis, dia.global.custo, dia.reservasAbertas], [1, res.custo.valor, 0], 'a reserva da chamada perdida foi contada inteira');
  assert.strictEqual((await c.execucoes.obter(c.ator, exe.id)).estado, 'REVISION_REQUIRED');
});

test('R1 no máximo 3 chamadas pagas por etapa; erro com corpo (529) = custo 0 e tentativa registrada', async () => {
  const c = await cenario({ '04-roteirista': ['529', '529', '529', '529', '529', '529'] });
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Escrever a legenda', modo: 'especialista', agenteId: '04-roteirista' });
  await c.motor.planejar(c.ator, exe.id);
  for (let i = 0; i < 8; i++) { const r = await c.motor.trabalhar(`t${i}`); if (!r) c.relogio.avancarDias(0.01); } // espera entre tentativas: o relógio anda
  assert.strictEqual(mensagens(c.transporte).length, MAX_CHAMADAS_PAGAS, 'repetiu até o máximo e parou');
  const lista = await criarRegistroChamadas({ banco: c.banco }).listar(exe.id, 'e1');
  assert.ok(lista.length >= 1 && lista.length === mensagens(c.transporte).length && lista.every((x) => x.estado === 'erro' && x.tipoErro === 'indisponivel'));
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.custo, dia.global.provaveis, dia.reservasAbertas], [0, 0, 0], 'o provedor recusou com corpo de erro: sem cobrança');
});

test('R1 registro: chave única, limite de 3 por etapa e liberação pelo Super Admin', async () => {
  const c = await cenario();
  const reg = criarRegistroChamadas({ banco: c.banco, relogio: c.relogio });
  const base = { execucaoId: 'exe_x', etapaId: 'e1', agenteId: '04-roteirista', provedor: 'anthropic', modelo: HAIKU };
  for (let i = 1; i <= 3; i++) {
    const a = await reg.abrir(base);
    assert.deepStrictEqual(a, { n: i, chave: `exe_x:e1:${i}` });
    await reg.fechar({ execucaoId: 'exe_x', etapaId: 'e1', n: i }, 'erro', { tipoErro: 'indisponivel', requestId: 'r'.repeat(200) });
  }
  assert.deepStrictEqual(await reg.abrir(base), { bloqueio: 'limite-de-chamadas-pagas', feitas: 3, limite: 3 });
  assert.strictEqual((await reg.listar('exe_x', 'e1'))[0].requestId.length, 80);
  assert.strictEqual(await reg.liberar('exe_x', ['e1'], c.ator), 0, 'nenhuma estava pendente; a contagem recomeça');
  assert.deepStrictEqual(await reg.abrir(base), { n: 4, chave: 'exe_x:e1:4' });
  const bl = await reg.abrir(base);
  assert.deepStrictEqual([bl.bloqueio, bl.chamada.n, bl.chamada.estado], ['resultado-desconhecido', 4, 'em-andamento'], 'uma em andamento bloqueia a próxima');
  assert.deepStrictEqual(await reg.abrir(Object.assign({}, base, { etapaId: 'e2' })), { n: 1, chave: 'exe_x:e2:1' }, 'outra etapa, outra conta');
  assert.ok(!JSON.stringify(await reg.listar('exe_x', 'e1')).match(/texto|prompt|conteudo/i), 'só metadados');
});

// ---------------- 6. contabilidade ----------------

test('R1 custos: conta exata por tipo de token, faixa longa, cache sem preço = desconhecido, reserva = teto real', () => {
  assert.strictEqual(custoDoUso(PRECO, { tokensEntrada: 1000, tokensSaida: 500 }), 0.0035);
  assert.strictEqual(custoDoUso(PRECO, { tokensEntrada: 1000, tokensSaida: 500, cacheEscrita: 2000, cacheLeitura: 3000 }), 0.0063);
  const longo = Object.assign({}, PRECO, { longo: { acimaDeTokens: 100000, entradaPorMilhao: 5, saidaPorMilhao: 25, cacheEscritaPorMilhao: 6.25, cacheLeituraPorMilhao: 0.5 } });
  assert.strictEqual(custoDoUso(longo, { tokensEntrada: 100000, tokensSaida: 1000 }), 0.105, 'até o limite: faixa normal');
  assert.strictEqual(custoDoUso(longo, { tokensEntrada: 90000, tokensSaida: 1000, cacheLeitura: 20000 }), 0.485, 'acima (entrada + cache): faixa longa');
  assert.strictEqual(custoDoUso({ entradaPorMilhao: 1, saidaPorMilhao: 5 }, { tokensEntrada: 10, tokensSaida: 10, cacheEscrita: 100 }), null, 'sem preço de cache: desconhecido');
  assert.strictEqual(custoMaximo(PRECO, 1000, 1000), 0.00625, 'entrada pelo preço mais alto possível (gravação de cache) + saída inteira');
  assert.ok(custoMaximo(PRECO, 1000, 1000) >= custoDoUso(PRECO, { tokensEntrada: 0, tokensSaida: 1000, cacheEscrita: 1000 }));
});

test('R1 custos: liquidação exata no dia e no mês; preço da Anthropic exige cache; preço vencido avisa', async () => {
  const c = await cenario();
  await rejeita(() => c.consumo.definirPreco(c.ator, `anthropic/${HAIKU}`, { entradaPorMilhao: 1, saidaPorMilhao: 5, moeda: 'USD', fonte: 'PREÇO FICTÍCIO DE TESTE', conferidoEm: '2026-11-01' }), 'invalido');
  await c.consumo.definirPreco(c.ator, `anthropic/${HAIKU}`, PRECO);
  const p = pedidoReserva(c);
  const res = await c.consumo.reservar(p);
  assert.deepStrictEqual([res.permitido, res.custo.valor, res.tokens, res.avisos], [true, 0.00625, 2000, []]);
  await c.consumo.liquidar(res, p, { tokensEntrada: 1000, tokensSaida: 500, fonte: 'provedor' });
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.custo, dia.global.tokens, dia.reservasAbertas, dia.mes.global.custo, dia.cobrancaReal], [0.0035, 1500, 0, 0.0035, false]);
  assert.deepStrictEqual((await c.consumo.doMes(c.ator)).global.custo, 0.0035);
  await c.consumo.definirPreco(c.ator, `anthropic/${HAIKU}`, Object.assign({}, PRECO, { conferidoEm: '2026-09-01' }));
  const venc = await c.consumo.reservar(p);
  assert.deepStrictEqual(venc.avisos, ['preco-vencido']);
  assert.ok((await c.auditoria.listar()).some((e) => e.tipo === 'custo.preco_vencido'));
});

// ---------------- 7. limites (seção 13.5) ----------------

test('R1 limites: limite menor que a reserva → o transporte NÃO é chamado nenhuma vez', async () => {
  const c = await cenario();
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: null, custoDia: 0.000001 } }));
  const { r, d } = await roteirista(c);
  assert.deepStrictEqual([r.resultado, d.diagnostico.motivo], ['bloqueada-por-custo', 'limite-diario-de-custo-global']);
  assert.strictEqual(mensagens(c.transporte).length, 0);
  assert.deepStrictEqual(await criarRegistroChamadas({ banco: c.banco }).listar(r.execucaoId || d.id, 'e1'), [], 'nem chegou a registrar chamada');
  // sem preço cadastrado (provedor que cobra) → também 0 chamadas
  const c2 = await montarComEmpresas({ ia: { transporte: transporteEspiao({}) } });
  await c2.configModelos.definir(c2.ator, '04-roteirista', cfgA());
  const s = await roteirista(c2);
  assert.deepStrictEqual([s.r.resultado, s.d.diagnostico.motivo], ['bloqueada-por-custo', 'preco-nao-cadastrado']);
});

test('R1 limites: limite EXATO de 2 reservas → passam 2, a 3ª é barrada; concorrência com saldo para um só → só um passa', async () => {
  const c = await cenario();
  await c.consumo.definirPreco(c.ator, `anthropic/${HAIKU}`, PRECO);
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: null, custoDia: 0.0125 } }));
  const r = [];
  for (let i = 0; i < 3; i++) r.push(await c.consumo.reservar(pedidoReserva(c)));
  assert.deepStrictEqual(r.map((x) => x.permitido), [true, true, false]);
  assert.strictEqual(r[2].motivo, 'limite-diario-de-custo-global');
  const c2 = await cenario();
  await c2.consumo.definirPreco(c2.ator, `anthropic/${HAIKU}`, PRECO);
  await c2.consumo.definirLimites(c2.ator, limites({ global: { tokensDia: null, custoDia: 0.007 } }));
  const juntos = await Promise.all([c2.consumo.reservar(pedidoReserva(c2)), c2.consumo.reservar(pedidoReserva(c2))]);
  assert.deepStrictEqual(juntos.map((x) => x.permitido).sort(), [false, true]);
});

test('R1 limites: virada de dia zera o dia; o limite do MÊS continua; virada de mês zera o mês', async () => {
  const c = await cenario();
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: 3000, custoDia: null }, mensal: { tokensMes: 5000, custoMes: null } }));
  const gastar = async () => { const p = pedidoReserva(c); const res = await c.consumo.reservar(p); if (res.permitido) await c.consumo.liquidar(res, p, { tokensEntrada: 1000, tokensSaida: 1000, fonte: 'provedor' }); return res; };
  assert.strictEqual((await gastar()).permitido, true); // dia 1: 2000
  assert.strictEqual((await gastar()).motivo, 'limite-diario-de-tokens-global'); // 4000 > 3000
  c.relogio.avancarDias(1);
  assert.strictEqual((await gastar()).permitido, true, 'dia novo começa zerado'); // mês: 4000
  c.relogio.avancarDias(1);
  const mes = await gastar(); // mês: 6000 > 5000
  assert.deepStrictEqual([mes.permitido, mes.motivo, mes.consumo, mes.limite], [false, 'limite-mensal-de-tokens', 4000, 5000]);
  c.relogio.avancarDias(29); // 2026-12
  assert.strictEqual((await gastar()).permitido, true, 'mês novo começa zerado');
  assert.strictEqual((await c.consumo.doMes(c.ator, '2026-11')).global.tokens, 4000);
  // limite de custo do mês com preço desconhecido: não dá para garantir → bloqueia
  await c.consumo.definirLimites(c.ator, limites({ mensal: { tokensMes: null, custoMes: 9 } }));
  const sp = await c.consumo.reservar(pedidoReserva(c, { provedor: 'openai', modelo: 'modelo-ficticio-1' }));
  assert.strictEqual(sp.motivo, 'custo-desconhecido-com-limite-mensal');
  await rejeita(() => c.consumo.definirLimites(c.ator, limites({ mensal: { custoMes: -1, tokensMes: null } })), 'invalido');
});

test('R1 limites: resultado desconhecido consome o saldo → a chamada seguinte é barrada antes do transporte', async () => {
  const c = await cenario({ '04-roteirista': ['timeout', 'ok', 'ok'] }, { ia: { timeoutMs: 30 } });
  // saldo para UMA reserva (1500 de saída × 5/M + entrada): a provável ocupa o saldo
  await c.consumo.definirLimites(c.ator, limites({ global: { tokensDia: null, custoDia: 0.012 } }));
  const { exe, r } = await roteirista(c);
  assert.strictEqual(r.resultado, 'resultado-desconhecido');
  await c.motor.retomar(c.ator, exe.id);
  const s = await c.motor.trabalhar('t2');
  assert.strictEqual(s.resultado, 'bloqueada-por-custo');
  assert.strictEqual(mensagens(c.transporte).length, 1, 'só a primeira chamada saiu');
});

test('R1 limites por tarefa, agente, empresa e provedor continuam valendo para o provedor que cobra', async () => {
  for (const [lim, motivo] of [
    [{ porAgente: { tokensDia: 10, custoDia: null } }, 'limite-diario-de-tokens-agente'],
    [{ porEmpresa: { tokensDia: null, custoDia: 0.000001 } }, 'limite-diario-de-custo-empresa'],
    [{ porProvedor: { tokensDia: 10, custoDia: null } }, 'limite-diario-de-tokens-provedor'],
  ]) {
    const c = await cenario();
    await c.consumo.definirLimites(c.ator, limites(lim));
    const { r, d } = await roteirista(c);
    assert.deepStrictEqual([r.resultado, d.diagnostico.motivo], ['bloqueada-por-custo', motivo]);
    assert.strictEqual(mensagens(c.transporte).length, 0, motivo);
  }
  const c = await cenario();
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Legenda', modo: 'especialista', agenteId: '04-roteirista', limites: { tokens: 100 } });
  await c.motor.planejar(c.ator, exe.id);
  assert.strictEqual((await c.motor.trabalhar('t')).resultado, 'bloqueada-por-custo');
  assert.strictEqual(mensagens(c.transporte).length, 0, 'limite da tarefa');
});

// ---------------- 8. modo simulado e tarefas órfãs ----------------

test('R1 modo simulado continua: sem configuração, nada é cobrado, nada é registrado como chamada paga', async () => {
  const transporte = transporteEspiao({});
  const c = await montarComEmpresas({ ia: { transporte } });
  const p = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'legendas para o lançamento' });
  await c.executorLocal().drenar();
  const e = await c.execucoes.obter(c.ator, p.id || p.execucaoId || p.execucao.id);
  assert.strictEqual(e.estado, 'COMPLETED');
  assert.ok(transporte.chamadas.length >= 2 && transporte.chamadas.every((x) => x.provedor === 'simulado'));
  for (const et of ['planejamento'].concat(e.etapas.map((x) => x.id))) assert.deepStrictEqual(await criarRegistroChamadas({ banco: c.banco }).listar(e.id, et), []);
  const dia = await c.consumo.doDia(c.ator);
  assert.deepStrictEqual([dia.global.custo, dia.global.provaveis, dia.cobrancaReal], [0, 0, false]);
});

test('R1 tarefas pela metade: falha inesperada no pedido limpa a tarefa; o monitor encerra as órfãs antigas', async () => {
  const c = await cenario();
  // 1) falha INESPERADA no planejamento (ex.: conflito do banco que esgotou as tentativas)
  const original = c.banco.transacao.bind(c.banco);
  let falhar = true;
  c.banco.transacao = async (fn) => { if (falhar && new Error().stack.includes('planejar')) { falhar = false; throw new Error('could not serialize access (simulado)'); } return original(fn); };
  await assert.rejects(c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'legendas para o lançamento' }), /serialize/);
  c.banco.transacao = original;
  const todas = await c.banco.consultar(caminhos.colecoes.tarefas, { onde: [{ campo: 'origem', op: '==', valor: 'pedido' }], ordenar: { campo: 'id', direcao: 'asc' }, limite: 10 });
  assert.strictEqual(todas.length, 1);
  assert.ok(['CANCELLED', 'FAILED'].includes(todas[0].estado), `não fica pela metade (está ${todas[0].estado})`);
  assert.strictEqual(todas[0].diagnostico.motivo, 'criacao-interrompida');
  // 2) órfã que sobrou (o processo caiu): o monitor encerra depois de 10 minutos; as outras não mudam
  const orfa = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Pedido que caiu', modo: 'orquestrado' }, { origem: 'pedido' });
  const manual = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Criada à mão', modo: 'orquestrado' });
  const presa = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Ficou planejando', modo: 'orquestrado' }, { origem: 'pedido' });
  await c.execucoes.transicionar(c.ator, presa.id, 'PLANNING', { motivo: 'teste' });
  assert.deepStrictEqual(await c.execucoes.encerrarOrfas(10 * 60 * 1000), [], 'recentes: nada a fazer');
  c.relogio.avancarDias(1 / 96); // 15 minutos
  const r = await c.monitor.verificar();
  assert.deepStrictEqual(r.orfas.map((x) => [x.id, x.de, x.para]).sort(), [[orfa.id, 'CREATED', 'CANCELLED'], [presa.id, 'PLANNING', 'FAILED']].sort());
  assert.strictEqual((await c.execucoes.obter(c.ator, manual.id)).estado, 'CREATED', 'tarefa criada à mão não é tocada');
  assert.strictEqual((await c.execucoes.obter(c.ator, orfa.id)).diagnostico.motivo, 'criacao-interrompida');
});
