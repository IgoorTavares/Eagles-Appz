const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validar } = require('../src/nucleo/validador');
const { AGENTES } = require('../src/agentes/catalogo');
const { FERRAMENTAS } = require('../src/ferramentas/catalogo');
const { verificarUsoFerramenta } = require('../src/ferramentas/permissoes');
const { ESQUEMA_AGENTE } = require('../src/contratos/agente');
const { ESQUEMA_FERRAMENTA } = require('../src/contratos/ferramenta');
const { ESTADOS, FINAIS, podeTransicionar, transicionar } = require('../src/contratos/execucao');
const { ESCOPOS, ESCOPO_INFO, DOCUMENTOS_CLIENTE } = require('../src/contratos/memoria');

// Skills exatamente como pedidas na especificação da LABZ AI
const SKILLS_PEDIDAS = {
  '01-guia-marca': 'SKILL BRANDING DESIGN-SYSTEM VISUAL-IDENTITY TYPOGRAPHY COLOR-SYSTEM BRAND-VOICE BRAND-AUDIT BRAND-MEMORY',
  '02-designer': 'SKILL ANIMATE ANTI-SLOP AUDIT BOLDER COMPOSITION TYPOGRAPHY COLOR LAYOUT MOTION-DESIGN IMAGE-EDITING EXPORT',
  '03-carrosseis': 'SKILL COPY DESIGN EDITORIAL RENDER STORYTELLING HOOKS CONTENT-FLOW VISUAL-RHYTHM CAROUSEL-AUDIT',
  '04-roteirista': 'SKILL COPYWRITING STORYTELLING BRAND-VOICE PERSUASION SCRIPTWRITING SOCIAL-COPY AD-COPY LANDING-COPY CTA COPY-AUDIT',
  '05-dev-web': 'SKILL CRAFT DEPLOY IMAGE-FIRST INTERACTION-DESIGN RESPONSIVE ACCESSIBILITY PERFORMANCE SEO ANIMATION WEB-AUDIT',
  '06-engenheiro': 'SKILL PLAN BUILD DEBUG QUALITY ARCHITECTURE DATABASE API-INTEGRATION SECURITY TESTING REFACTOR DOCUMENTATION',
  '07-trafego': 'SKILL ANALISE-CRIATIVAS CHECAGEM-PIXEL META-ADS GOOGLE-ADS AUDIENCE-RESEARCH FUNNEL-ANALYSIS PERFORMANCE A-B-TESTING BUDGET-OPTIMIZATION ATTRIBUTION REPORTING',
  '08-estrategista': 'SKILL STRATEGY ORCHESTRATION DELEGATION FUNNEL-DESIGN MARKET-ANALYSIS PLANNING QUALITY-GATE AUDIT PERFORMANCE-REVIEW DECISION-MAKING MEMORY-MANAGEMENT',
};

test('validador: tipos, obrigatórios, enum, padrão e campos extras', () => {
  const e = { tipo: 'objeto', extras: false, campos: { a: { tipo: 'texto', obrigatorio: true, min: 2 }, b: { tipo: 'inteiro', valores: [1, 2] }, c: { tipo: 'lista', itens: { tipo: 'texto', padrao: /^x/ } } } };
  assert.deepEqual(validar(e, { a: 'ok', b: 1, c: ['xa'] }), []);
  assert.equal(validar(e, {}).length, 1);
  assert.ok(validar(e, { a: 'ok', b: 3 }).some((m) => m.includes('não permitido')));
  assert.ok(validar(e, { a: 'ok', c: ['y'] }).some((m) => m.includes('formato')));
  assert.ok(validar(e, { a: 'ok', z: 1 }).some((m) => m.includes('campo não permitido')));
  assert.ok(validar(e, { a: 'ok', b: 1.5 }).some((m) => m.includes('inteiro')));
});

test('os 8 agentes existem, numerados de 1 a 8, e cumprem o contrato', () => {
  assert.equal(AGENTES.length, 8);
  assert.deepEqual(AGENTES.map((a) => a.numero), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(AGENTES.map((a) => a.id)).size, 8);
  AGENTES.forEach((a) => assert.deepEqual(validar(ESQUEMA_AGENTE, a), [], `contrato do agente ${a.id}`));
  assert.deepEqual(AGENTES.map((a) => a.nome), ['Guia da Marca', 'Designer', 'Especialista em Carrosséis', 'Roteirista', 'Desenvolvedor Web', 'Engenheiro', 'Gestor de Tráfego', 'Estrategista']);
});

test('cada agente tem exatamente as skills pedidas, com SKILL.md obrigatória', () => {
  AGENTES.forEach((a) => {
    assert.deepEqual(a.skills.map((s) => s.arquivo.replace('.md', '')), SKILLS_PEDIDAS[a.id].split(' '), a.id);
    assert.deepEqual(a.skills.filter((s) => s.obrigatoria).map((s) => s.arquivo), ['SKILL.md'], a.id);
    a.skills.filter((s) => !s.obrigatoria).forEach((s) => assert.ok(s.gatilhos.length > 0, `${a.id}/${s.arquivo} sem gatilho`));
  });
});

test('nenhum agente aprova memória; só o Estrategista delega; desempenho: leem Tráfego, Estrategista e Carrosséis (D4); propõem só Tráfego e Estrategista', () => {
  AGENTES.forEach((a) => assert.equal(a.permissoes.aprovarMemoria, false));
  assert.deepEqual(AGENTES.filter((a) => a.permissoes.podeDelegar).map((a) => a.id), ['08-estrategista']);
  // D4 (aprovada pelo Igor em 30/10/2026): o Especialista em Carrosséis LÊ desempenho...
  assert.deepEqual(AGENTES.filter((a) => a.permissoes.memoriaLeitura.includes('desempenho')).map((a) => a.id), ['03-carrosseis', '07-trafego', '08-estrategista']);
  // ...mas não propõe: quem propõe desempenho continua sendo só Tráfego e Estrategista
  assert.deepEqual(AGENTES.filter((a) => a.permissoes.memoriaPropor.includes('desempenho')).map((a) => a.id), ['07-trafego', '08-estrategista']);
  AGENTES.forEach((a) => assert.ok(!a.permissoes.memoriaPropor.includes('tarefa')));
  AGENTES.forEach((a) => assert.equal(a.modelo.provedor, null, 'modelo ainda não escolhido'));
});

test('ferramentas: contrato válido, coerente com os agentes e nenhuma fingindo estar disponível', () => {
  assert.equal(new Set(FERRAMENTAS.map((f) => f.id)).size, FERRAMENTAS.length);
  FERRAMENTAS.forEach((f) => {
    assert.deepEqual(validar(ESQUEMA_FERRAMENTA, f), [], f.id);
    assert.notEqual(f.disponibilidade, 'disponivel', `${f.id} não pode estar disponível na Fase 1`);
    if (f.risco === 'alto') assert.equal(f.exigeAprovacao, true, `${f.id}: risco alto exige aprovação`);
    if (f.operacoes.includes('publicar')) assert.equal(f.exigeAprovacao, true, `${f.id}: publicar exige aprovação`);
    f.agentesAutorizados.forEach((ag) => assert.ok(AGENTES.find((a) => a.id === ag).ferramentas.includes(f.id), `${ag} deveria listar ${f.id}`));
  });
  AGENTES.forEach((a) => a.ferramentas.forEach((id) => {
    const f = FERRAMENTAS.find((x) => x.id === id);
    assert.ok(f, `${a.id} usa ferramenta inexistente ${id}`);
    assert.ok(f.agentesAutorizados.includes(a.id), `${id} não autoriza ${a.id}`);
  }));
});

test('permissão de ferramenta vem do registro, não do pedido do modelo', () => {
  // Na Fase 1 nada está disponível: todo pedido é negado com o motivo real
  assert.equal(verificarUsoFerramenta('04-roteirista', 'memoria.consultar', 'ler').motivo, 'ferramenta-planejada');
  assert.equal(verificarUsoFerramenta('07-trafego', 'meta.ler_metricas', 'ler').motivo, 'ferramenta-nao-configurada');
  // Com um catálogo de teste em que tudo está disponível:
  const ferramentas = FERRAMENTAS.map((f) => Object.assign({}, f, { disponibilidade: 'disponivel' }));
  const v = (ag, f, op) => verificarUsoFerramenta(ag, f, op, { ferramentas });
  assert.equal(v('04-roteirista', 'web.publicar', 'publicar').motivo, 'agente-nao-autorizado');
  assert.equal(v('04-roteirista', 'tarefa.delegar', 'criar').motivo, 'agente-nao-autorizado');
  assert.equal(v('07-trafego', 'meta.ler_metricas', 'gastar').motivo, 'operacao-nao-permitida');
  assert.equal(v('99-falso', 'memoria.consultar', 'ler').motivo, 'agente-desconhecido');
  assert.equal(v('08-estrategista', 'sistema.root', 'ler').motivo, 'ferramenta-desconhecida');
  const ok = v('07-trafego', 'meta.publicar', 'publicar');
  assert.equal(ok.permitido, true);
  assert.equal(ok.exigeAprovacao, true);
  assert.equal(v('08-estrategista', 'tarefa.delegar', 'criar').permitido, true);
});

test('execução: só as transições previstas; estados finais não saem do lugar', () => {
  assert.equal(ESTADOS.length, 9);
  assert.ok(podeTransicionar('CREATED', 'PLANNING'));
  assert.ok(podeTransicionar('RUNNING', 'WAITING_APPROVAL'));
  assert.ok(podeTransicionar('WAITING_APPROVAL', 'REVISION_REQUIRED'));
  assert.ok(podeTransicionar('REVISION_REQUIRED', 'RUNNING'));
  assert.ok(podeTransicionar('RUNNING', 'READY'), 'retomada após interrupção');
  assert.ok(!podeTransicionar('CREATED', 'COMPLETED'));
  assert.ok(!podeTransicionar('READY', 'COMPLETED'));
  assert.ok(!podeTransicionar('RUNNING', 'INVENTADO'));
  FINAIS.forEach((f) => ESTADOS.forEach((e) => assert.ok(!podeTransicionar(f, e), `${f} → ${e}`)));
  assert.throws(() => transicionar('COMPLETED', 'RUNNING'), (e) => e.codigo === 'transicao-invalida');
});

test('os 5 escopos de memória e os documentos de cliente estão definidos', () => {
  assert.deepEqual(ESCOPOS, ['global', 'agente', 'cliente', 'tarefa', 'desempenho']);
  assert.equal(ESCOPO_INFO.tarefa.aprovacao, false);
  ['global', 'agente', 'cliente', 'desempenho'].forEach((e) => assert.equal(ESCOPO_INFO[e].aprovacao, true));
  assert.equal(ESCOPO_INFO.desempenho.exigeEvidencias, true);
  assert.deepEqual(Object.keys(DOCUMENTOS_CLIENTE), ['marca.md', 'design-system.md', 'publico.md', 'preferencias.md', 'aprendizados.md']);
  Object.values(DOCUMENTOS_CLIENTE).forEach((d) => assert.ok(ESCOPO_INFO.cliente.categorias.includes(d.categoria)));
});
