// Fase 4B: o Estrategista PROPÕE o plano (adaptador de modelos, simulado) e o
// BACKEND valida. Cenários: campanha, identidade visual, landing page, redes
// sociais, anúncios e projeto técnico; planos inválidos recusados.
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { planoSimulado } = require('../src/ia/simulacao/estrategista-simulado');
const { validarPlano } = require('../src/motor/validar-plano');
const { caminhos } = require('../src/armazenamento/caminhos');

const comPlano = (plano, roteiro) => montarComEmpresas({ ia: { transporte: transporteComModeloSimulado(roteiro || {}, plano ? { plano } : undefined) } });
const etapa = (id, agenteId, extra) => Object.assign({ id, agenteId, objetivo: `Fazer ${id}`, dependeDe: [], criterios: ['Critério claro'], estimativaTokens: 3000 }, extra);
const plano = (etapas, extra) => Object.assign({ resumo: 'Plano de teste', etapas }, extra);

const CENARIOS = [
  ['campanha de marketing', 'Crie uma campanha completa para uma hamburgueria com cinco posts, dois carrosséis, três roteiros de Reels e uma landing page.', ['02-designer', '03-carrosseis', '04-roteirista', '05-dev-web']],
  ['identidade visual', 'Criar a identidade visual da padaria: logo, paleta de cores e tipografia.', ['01-guia-marca', '02-designer']],
  ['landing page', 'Desenvolver uma landing page de inscrição para o curso de inglês.', ['04-roteirista', '05-dev-web']],
  ['conteúdos para redes sociais', 'Produzir os conteúdos para redes sociais do mês: posts e legendas.', ['02-designer', '04-roteirista']],
  ['planejamento de anúncios', 'Planejar anúncios no Meta Ads para o lançamento do produto.', ['04-roteirista', '07-trafego']],
  ['projeto técnico com o Engenheiro', 'Integrar o formulário da landing page com a API do CRM e criar uma automação de e-mail.', ['04-roteirista', '05-dev-web', '06-engenheiro']],
];

test('seleção automática: o Estrategista escolhe só os especialistas necessários (6 cenários) e o motor executa tudo sozinho', async () => {
  for (const [nome, pedido, esperados] of CENARIOS) {
    const c = await comPlano();
    const exe = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: pedido });
    assert.strictEqual(exe.estado, 'READY', nome);
    const agentes = exe.plano.agentes.filter((a) => a !== '08-estrategista').sort();
    assert.deepStrictEqual(agentes, esperados, nome);
    assert.strictEqual(exe.etapas[exe.etapas.length - 1].id, 'consolidacao', `${nome}: o Estrategista consolida no fim`);
    assert.ok(exe.etapas.every((e) => e.id === 'consolidacao' || (e.criterios && e.criterios.length)), `${nome}: critérios de conclusão em cada etapa`);
    assert.ok(exe.plano.estimativaTokens > 0 && exe.plano.propostoPor === '08-estrategista');
    if (!esperados.includes('06-engenheiro')) assert.ok(!exe.plano.agentes.includes('06-engenheiro'), `${nome}: Engenheiro só com necessidade técnica`);
    // dependências respeitadas: cada etapa vem depois das que ela depende
    const ordem = exe.etapas.map((e) => e.id);
    exe.etapas.forEach((e) => e.dependeDe.forEach((d) => assert.ok(ordem.indexOf(d) < ordem.indexOf(e.id), `${nome}: ${d} antes de ${e.id}`)));
    // execução automática (sem chamada manual por etapa)
    const exec = c.executorLocal({ concorrencia: 1 });
    await exec.drenar();
    const d = await c.motor.diagnosticar(c.ator, exe.id);
    assert.strictEqual(d.estado, 'COMPLETED', nome);
    const consolidado = await c.banco.obter(caminhos.resultadoEtapa(exe.id, 'consolidacao'));
    assert.ok(consolidado.texto.startsWith('[SIMULADO] Consolidação'), `${nome}: entrega consolidada`);
  }
});

test('planejamento com um só especialista e com vários', async () => {
  const c = await comPlano();
  const um = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Escrever uma legenda curta para divulgar a promoção de hoje.' });
  assert.deepStrictEqual(um.plano.agentes.sort(), ['04-roteirista', '08-estrategista']);
  const varios = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: CENARIOS[0][1] });
  assert.ok(varios.plano.agentes.length >= 4);
  assert.deepStrictEqual(planoSimulado('qualquer coisa').etapas.map((e) => e.agenteId), ['04-roteirista'], 'pedido genérico: um especialista');
});

test('planos inválidos são recusados pelo backend com o motivo; o estado não muda; o modelo não define limites nem cliente', async () => {
  const ruins = [
    ['agente-inexistente', plano([etapa('a', '99-falso')])],
    ['dependencia-circular', plano([etapa('a', '02-designer', { dependeDe: ['b'] }), etapa('b', '04-roteirista', { dependeDe: ['a'] })])],
    ['etapa-duplicada', plano([etapa('a', '02-designer'), etapa('a', '04-roteirista')])],
    ['dependencia-inexistente', plano([etapa('a', '02-designer', { dependeDe: ['fantasma'] })])],
    ['auto-dependencia', plano([etapa('a', '02-designer', { dependeDe: ['a'] })])],
    ['id-reservado', plano([etapa('consolidacao', '02-designer')])],
    ['id-invalido', plano([etapa('A B!', '02-designer')])],
    ['formato-invalido', plano([{ id: 'a', agenteId: '02-designer', objetivo: 'x' }])], // sem critérios nem estimativa
    ['formato-invalido', { etapas: 'não é lista' }],
    ['formato-de-resultado-invalido', plano([etapa('a', '02-designer', { formato: 'video' })])],
    ['campo-proibido', plano([etapa('a', '02-designer')], { limites: { etapas: 50, tokens: 99999999 } })],
    ['campo-proibido', plano([etapa('a', '02-designer', { empresaId: 'outra' })])],
    ['campo-proibido', plano([etapa('a', '02-designer', { tentativas: 99 })])],
    ['campo-proibido', plano([etapa('a', '02-designer', { permissoes: { aprovarMemoria: true } })])],
    ['acao-nao-autorizada', plano([etapa('a', '04-roteirista', { acoesPrevistas: [{ ferramentaId: 'web.publicar', operacao: 'publicar' }] })])],
    ['limite-de-custo', plano([etapa('a', '02-designer', { estimativaTokens: 1500000 })])],
    ['projeto-grande-demais', plano(Array.from({ length: 9 }, (_, i) => etapa(`p${i}`, '04-roteirista')))],
  ];
  for (const [codigo, p] of ruins) {
    const c = await comPlano(() => p);
    const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Campanha de teste', modo: 'orquestrado' });
    const e = await rejeita(() => c.motor.planejar(c.ator, exe.id), 'invalido');
    assert.ok(e.detalhes.problemas.some((x) => x.codigo === codigo), `${codigo}: ${JSON.stringify(e.detalhes.problemas)}`);
    const depois = await c.execucoes.obter(c.ator, exe.id);
    assert.deepStrictEqual([depois.estado, depois.limites, depois.empresaId], ['CREATED', null, c.A.id], `${codigo}: estado, limites e cliente intactos`);
    assert.ok(depois.diagnostico.sugestao, `${codigo}: sugestão clara`);
    if (codigo === 'projeto-grande-demais') {
      assert.strictEqual(e.detalhes.motivo, 'projeto-grande-demais');
      assert.ok(/divida/i.test(e.message) && /Divida o projeto em partes de até 8/.test(e.detalhes.sugestao) && /não é aumentado/.test(e.detalhes.sugestao));
    }
  }
});

test('limites estruturais: o limite da execução vale para o plano do modelo; 3 planos recusados encerram a execução', async () => {
  const c = await comPlano(() => plano([etapa('a', '02-designer'), etapa('b', '04-roteirista'), etapa('c', '01-guia-marca'), etapa('d', '03-carrosseis')]));
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Campanha', modo: 'orquestrado', limites: { etapas: 3 } });
  for (let i = 0; i < 2; i++) await rejeita(() => c.motor.planejar(c.ator, exe.id), 'invalido');
  await rejeita(() => c.motor.planejar(c.ator, exe.id), 'invalido');
  const e = await c.execucoes.obter(c.ator, exe.id);
  assert.deepStrictEqual([e.estado, e.tentativasPlanejamento, e.diagnostico.motivo], ['CANCELLED', 3, 'projeto-grande-demais']);
  assert.ok(e.custos.porEtapa.planejamento.chamadas === 3, 'o consumo de cada tentativa de planejamento fica registrado');
});

test('plano malformado (não JSON) e falha do provedor no planejamento: estado não muda e dá para tentar de novo', async () => {
  let n = 0;
  const c2 = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado(() => (++n === 1 ? 'malformado' : n === 2 ? '500' : 'ok')) } });
  const exe = await c2.execucoes.criar(c2.ator, { empresaId: c2.A.id, objetivo: 'Escrever legendas para o post', modo: 'orquestrado' });
  const e1 = await rejeita(() => c2.motor.planejar(c2.ator, exe.id), 'precondicao');
  assert.strictEqual(e1.detalhes.tipo, 'resposta-malformada');
  const e2 = await rejeita(() => c2.motor.planejar(c2.ator, exe.id), 'precondicao');
  assert.deepStrictEqual([e2.detalhes.tipo, e2.detalhes.transitorio], ['indisponivel', true]);
  assert.strictEqual((await c2.execucoes.obter(c2.ator, exe.id)).estado, 'CREATED');
  const ok = await c2.motor.planejar(c2.ator, exe.id);
  assert.strictEqual(ok.estado, 'READY');
});

test('escopo do cliente: plano que cita outra empresa da LABZ AI é recusado', async () => {
  const c = await comPlano((meta, padrao) => Object.assign({}, padrao, { resumo: 'Usar o material da Marca Beta como base' }));
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Escrever legendas para o post', modo: 'orquestrado' });
  const e = await rejeita(() => c.motor.planejar(c.ator, exe.id), 'invalido');
  assert.ok(e.detalhes.problemas.some((p) => p.codigo === 'escopo-de-outro-cliente'));
  // a própria empresa pode ser citada
  const r = validarPlano(plano([etapa('a', '04-roteirista', { objetivo: 'Legendas da Marca Alfa' })]), { exe: { modo: 'orquestrado' }, outrasEmpresas: ['Marca Beta'] });
  assert.strictEqual(r.valido, true);
});

test('validador: devolve TODOS os problemas e não depende do modelo; plano válido vira passos limpos', () => {
  const r = validarPlano(plano([etapa('a', '99-x', { dependeDe: ['z'] }), etapa('a', '02-designer', { formato: 'pdf' })]), { exe: { modo: 'orquestrado' } });
  const codigos = r.problemas.map((p) => p.codigo).sort();
  assert.deepStrictEqual(codigos, ['agente-inexistente', 'dependencia-inexistente', 'etapa-duplicada', 'formato-de-resultado-invalido']);
  const ok = validarPlano(plano([etapa('a', '02-designer'), etapa('b', '04-roteirista', { dependeDe: ['a'], acoesPrevistas: [{ ferramentaId: 'crm.enviar_conteudo', operacao: 'criar' }] })]), { exe: { modo: 'orquestrado' } });
  assert.strictEqual(ok.valido, true);
  assert.deepStrictEqual(Object.keys(ok.passos[1]).sort(), ['acoesPrevistas', 'agenteId', 'criterios', 'dependeDe', 'estimativaTokens', 'id', 'objetivo']);
  assert.strictEqual(ok.estimativa.tokens, 9000, '2 etapas + consolidação');
});

test('consolidação pelo Estrategista e o Super Admin continua podendo dar o plano (a proposta do modelo é ignorada)', async () => {
  const c = await comPlano(() => plano([etapa('nao-usar', '06-engenheiro')]));
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Campanha', modo: 'orquestrado' });
  const r = await c.motor.planejar(c.ator, exe.id, { passos: [{ id: 'texto', agenteId: '04-roteirista', objetivo: 'Legendas' }] });
  assert.deepStrictEqual(r.etapas.map((e) => [e.id, e.agenteId]), [['texto', '04-roteirista'], ['consolidacao', '08-estrategista']]);
  assert.strictEqual((await c.motor.trabalhar('t1')).resultado, 'concluida');
});
