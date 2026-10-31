// Fase 4B: executor automático LOCAL e monitor da fila. Tudo simulado; nada
// agendado em produção. Vários executores sobre o MESMO banco.
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { ErroInterrupcao } = require('../src/motor/adaptador-simulado');
const { caminhos } = require('../src/armazenamento/caminhos');

const MIN = 1 / (24 * 60);
const montar = (roteiro, extra = {}) => {
  const transporte = extra.transporte || transporteComModeloSimulado(roteiro || {});
  return montarComEmpresas({ ia: { transporte, timeoutMs: extra.timeoutMs }, opcoes: extra.opcoes }).then((c) => Object.assign(c, { transporte }));
};
const especialista = async (c, agenteId = '04-roteirista', objetivo = 'Escrever a legenda') => {
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo, modo: 'especialista', agenteId });
  await c.motor.planejar(c.ator, exe.id);
  return exe;
};
const estado = async (c, id) => (await c.execucoes.obter(c.ator, id)).estado;
const chamadasPorEtapa = (transporte, execEtapas) => transporte.chamadas.filter((x) => x.modo !== 'planejar').reduce((m, x) => { m[x.etapaId] = (m[x.etapaId] || 0) + 1; return m; }, {});

test('processa sozinho as tarefas pendentes, sem chamada manual por etapa (especialistas + pedido orquestrado)', async () => {
  const c = await montar();
  const a = await especialista(c, '04-roteirista');
  const b = await especialista(c, '02-designer', 'Criar a arte');
  const o = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Criar a identidade visual da marca: logo e paleta.' });
  const exec = c.executorLocal({ concorrencia: 2 });
  const r = await exec.drenar();
  assert.ok(r.length >= 3);
  for (const id of [a.id, b.id, o.id]) assert.strictEqual(await estado(c, id), 'COMPLETED', id);
  const d = await c.motor.diagnosticar(c.ator, o.id);
  assert.ok(d.etapas.every((e) => e.status === 'concluida' && e.tentativas === 1), 'cada etapa uma vez, sem intervenção');
});

test('concorrência: dois executores no mesmo banco não duplicam execução nem etapa', async () => {
  // dois executores SAUDÁVEIS: o prazo do batimento fica folgado porque o relógio de teste avança 1 s
  // por consulta (no PostgreSQL, as transações repetidas por conflito consultam mais o relógio e o
  // "tempo" do teste passaria de 5 min). A recuperação de executor caído tem teste próprio abaixo.
  const c = await montar(undefined, { opcoes: { monitor: { limiteBatimentoMs: 24 * 60 * 60 * 1000 } } });
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' })).id);
  // itens duplicados na fila para a mesma execução (prevenção de duplicidade)
  for (const id of ids) await c.fila.enfileirar({ execucaoId: id, tipo: 'executar' });
  const e1 = c.executorLocal({ nome: 'A', concorrencia: 3 });
  const e2 = c.executorLocal({ nome: 'B', concorrencia: 3 });
  await Promise.all([e1.drenar(), e2.drenar()]);
  for (const id of ids) assert.strictEqual(await estado(c, id), 'COMPLETED');
  const execucoes = c.transporte.chamadas.filter((x) => x.modo !== 'planejar');
  assert.strictEqual(execucoes.length, ids.length * 3, 'cada execução: 2 etapas + consolidação, uma chamada cada');
  for (const id of ids) {
    const e = await c.execucoes.obter(c.ator, id);
    assert.ok(e.etapas.every((x) => x.tentativas === 1));
  }
  const pend = (await c.fila.listar()).filter((x) => ['pendente', 'em-andamento'].includes(x.estado));
  assert.deepStrictEqual(pend, [], 'fila limpa no fim (duplicados descartados ou ignorados)');
});

test('reserva vencida: item reservado por um executor que morreu é retomado por outro', async () => {
  const c = await montar();
  const exe = await especialista(c);
  const preso = await c.fila.reservar('executor-morto'); // reservou e "morreu" sem processar
  assert.strictEqual(preso.execucaoId, exe.id);
  const exec = c.executorLocal();
  assert.deepStrictEqual((await exec.drenar()).length, 0, 'enquanto a reserva vale, ninguém pega');
  c.relogio.avancarDias(6 * MIN); // reserva de 5 min venceu
  await exec.drenar();
  assert.strictEqual(await estado(c, exe.id), 'COMPLETED');
});

test('executor interrompido no meio da etapa: o monitor recupera com segurança e não repete etapa concluída', async () => {
  let n = 0;
  const responder = criarModeloSimulado();
  const transporte = criarTransporteSimulado(async (x) => {
    if (x.meta.etapaId === 'pecas' && ++n === 1) throw new ErroInterrupcao(); // o processo "cai" durante a etapa
    return responder(x);
  });
  const c = await montar(null, { transporte });
  const o = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' });
  const exec = c.executorLocal({ concorrencia: 1 });
  await exec.drenar();
  assert.strictEqual(await estado(c, o.id), 'RUNNING', 'caiu: ficou RUNNING sem sinal de vida');
  assert.strictEqual(exec.situacao().quedas, 1);
  c.relogio.avancarDias(6 * MIN);
  await exec.drenar();
  const d = await c.motor.diagnosticar(c.ator, o.id);
  assert.strictEqual(d.estado, 'COMPLETED');
  const por = chamadasPorEtapa(transporte);
  assert.deepStrictEqual([por.textos, por.pecas, por.consolidacao], [1, 2, 1], 'a etapa concluída antes da queda não é refeita');
  const ev = (await c.auditoria.listar()).filter((e) => e.tipo === 'fila.monitor');
  assert.ok(ev.length >= 1 && !JSON.stringify(ev).includes('Produzir'), 'monitor registra só números');
});

test('limite de tentativas: caiu 3 vezes → FAILED; reserva vencida sem tentativa → item encerrado (não volta mais)', async () => {
  const transporte = criarTransporteSimulado(async () => { throw new ErroInterrupcao(); });
  const c = await montar(null, { transporte });
  const exe = await especialista(c);
  const exec = c.executorLocal({ concorrencia: 1 });
  for (let i = 0; i < 6; i++) { await exec.drenar({ maxCiclos: 3 }); c.relogio.avancarDias(6 * MIN); }
  await c.monitor.verificar();
  const e = await c.execucoes.obter(c.ator, exe.id);
  assert.deepStrictEqual([e.estado, e.diagnostico.motivo], ['FAILED', 'interrompida-demais']);
  const fila = await c.fila.listar();
  assert.ok(fila.every((x) => ['feita', 'falhou', 'descartada'].includes(x.estado)), JSON.stringify(fila.map((x) => [x.estado, x.tentativas])));
  assert.ok(fila.every((x) => (x.tentativas || 0) <= c.fila.maxTentativas), 'nenhum item passou do limite de tentativas');
});

test('cancelamento: execução cancelada não roda (item descartado); parar() cancela a chamada em curso sem gastar tentativa', async () => {
  const c = await montar();
  const exe = await especialista(c);
  await c.execucoes.transicionar(c.ator, exe.id, 'CANCELLED', { motivo: 'desisti' });
  const exec = c.executorLocal();
  await exec.drenar();
  assert.strictEqual(await estado(c, exe.id), 'CANCELLED', 'cancelamento preservado');
  assert.strictEqual(c.transporte.chamadas.filter((x) => x.modo !== 'planejar').length, 0);
  assert.ok((await c.fila.listar()).every((x) => ['descartada', 'feita'].includes(x.estado)));

  let n = 0;
  const c2 = await montar(() => (++n === 1 ? 'timeout' : 'ok'), { timeoutMs: 60000 });
  const e2 = await especialista(c2);
  const ex2 = c2.executorLocal({ intervaloMs: 5 });
  ex2.iniciar();
  await new Promise((ok) => setTimeout(ok, 60));
  const h = await ex2.parar();
  assert.ok(h.ciclos >= 1);
  const depois = await c2.execucoes.obter(c2.ator, e2.id);
  assert.deepStrictEqual([depois.estado, depois.etapas[0].tentativas, depois.etapas[0].status], ['READY', 0, 'pendente']);
  await c2.executorLocal().drenar();
  assert.strictEqual(await estado(c2, e2.id), 'COMPLETED', 'retomada depois de parar');
});

test('aprovação pendente: o executor para; o Super Admin decide a ação EXATA; a execução retoma sozinha', async () => {
  const c = await montar({ '05-dev-web': 'acao:web.publicar:publicar' });
  const exe = await especialista(c, '05-dev-web', 'Construir a landing page');
  const exec = c.executorLocal();
  await exec.drenar();
  assert.strictEqual(await estado(c, exe.id), 'WAITING_APPROVAL');
  await exec.drenar();
  assert.strictEqual(await estado(c, exe.id), 'WAITING_APPROVAL', 'sem decisão, nada avança');
  const [p] = await c.aprovacoes.pendentes(c.ator, exe.id);
  assert.strictEqual(p.ferramentaId, 'web.publicar');
  // o sistema (agente) não aprova
  await rejeita(() => c.aprovacoes.decidir(Object.freeze({ tipo: 'sistema', uid: 'labz-sistema' }), exe.id, p.id, { decisao: 'aprovar', assinatura: p.assinatura, justificativa: 'ok' }), 'permissao-negada');
  // assinatura de outra ação não serve
  await rejeita(() => c.motor.decidirAprovacao(c.ator, exe.id, p.id, { decisao: 'aprovar', assinatura: 'a'.repeat(64), justificativa: 'conferido' }), 'conflito');
  await c.motor.decidirAprovacao(c.ator, exe.id, p.id, { decisao: 'aprovar', assinatura: p.assinatura, justificativa: 'conferido' });
  await exec.drenar();
  const d = await c.motor.diagnosticar(c.ator, exe.id);
  assert.strictEqual(d.estado, 'COMPLETED');
  assert.strictEqual(d.etapas[0].status, 'concluida');
  // a aprovação usada não serve para outra decisão
  await rejeita(() => c.motor.decidirAprovacao(c.ator, exe.id, p.id, { decisao: 'aprovar', assinatura: p.assinatura, justificativa: 'de novo' }), 'precondicao');
});

test('encerramento: execução concluída não é reprocessada, e item que sobrou na fila é descartado pelo monitor', async () => {
  const c = await montar();
  const exe = await especialista(c);
  const exec = c.executorLocal();
  await exec.drenar();
  assert.strictEqual(await estado(c, exe.id), 'COMPLETED');
  const sobra = await c.fila.enfileirar({ execucaoId: exe.id, tipo: 'executar' });
  const m = await c.monitor.verificar();
  assert.deepStrictEqual(m.descartados, [sobra]);
  const antes = c.transporte.chamadas.length;
  await exec.drenar();
  assert.strictEqual(c.transporte.chamadas.length, antes, 'nada chamado de novo');
  assert.strictEqual((await c.banco.obter(caminhos.filaItem(sobra))).estado, 'descartada');
});

test('monitor: dois monitores ao mesmo tempo não retomam a mesma execução duas vezes', async () => {
  const transporte = criarTransporteSimulado(async () => { throw new ErroInterrupcao(); });
  const c = await montar(null, { transporte });
  const exe = await especialista(c);
  await c.executorLocal({ concorrencia: 1 }).drenar({ maxCiclos: 1 });
  assert.strictEqual(await estado(c, exe.id), 'RUNNING');
  c.relogio.avancarDias(6 * MIN);
  const [m1, m2] = await Promise.all([c.monitor.verificar(), c.monitor.verificar()]);
  assert.strictEqual(m1.recuperadas.length + m2.recuperadas.length, 1, 'só uma retomada');
  const e = await c.execucoes.obter(c.ator, exe.id);
  assert.strictEqual(e.historico.filter((h) => h.motivo === 'retomada após interrupção').length, 1);
});

test('fila sem o monitor: reserva vencida no limite de tentativas não volta (segunda camada de proteção)', async () => {
  const c = await montar();
  const exe = await especialista(c);
  for (let i = 1; i <= c.fila.maxTentativas; i++) {
    const it = await c.fila.reservar(`morto-${i}`);
    assert.strictEqual(it.tentativas, i, `reserva ${i}`);
    c.relogio.avancarDias(6 * MIN);
  }
  assert.strictEqual(await c.fila.reservar('outro'), null, 'esgotou: ninguém pega de novo');
  assert.strictEqual((await c.fila.listar()).filter((x) => x.execucaoId === exe.id)[0].tentativas, c.fila.maxTentativas);
});
