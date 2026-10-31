// Fase 4C.2 (passo 1): contratos dos documentos estruturados, validação por tipo,
// permissões por agente, escolha do tipo no plano e a representação Markdown derivada.
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/contratos/documentos');
const R = require('../src/entregas/representacao');
const { AGENTES } = require('../src/agentes/catalogo');
const { validarPlano } = require('../src/motor/validar-plano');
const { montarEtapas } = require('../src/motor/planejador');
const { planoSimulado } = require('../src/ia/simulacao/estrategista-simulado');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { transporteComModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');

const H = 'a'.repeat(64);
const EXEMPLOS = {
  'plano-estrategico': { titulo: 'Plano de verão', objetivo: 'Aumentar as vendas de verão', publico: 'Jovens adultos da cidade', mensagensChave: ['Sabor de verão'], canais: ['instagram'], cronograma: [{ ordem: 1, periodo: 'semana 1', entregas: ['posts de lançamento'] }, { ordem: 2, periodo: 'semana 2', entregas: ['reels'] }], riscos: ['chuva'], metricasSucesso: ['vendas +10%'] },
  'consolidacao-final': { titulo: 'Entrega final', resumo: 'Resumo das entregas do projeto', entregas: [{ etapaId: 'textos', entregaId: 'ent_x_textos', versao: 2, hash: H }], pendencias: [], proximosPassos: ['aprovar as peças'] },
  'diretrizes-marca': { marca: 'Hamburgueria Sol', paleta: [{ nome: 'Laranja', hex: '#FF7A00' }, { nome: 'Grafite', hex: '#222222', uso: 'texto' }], tipografia: [{ uso: 'títulos', familia: 'Inter', pesos: [700] }], tomDeVoz: { e: ['descontraído'], naoE: ['formal'] }, orientacoesUso: ['Logo sempre com respiro'] },
  'briefing-design': { peca: 'Post de lançamento', objetivo: 'Anunciar o novo lanche', formato: '1080x1350', hierarquia: ['título', 'foto'], elementos: ['foto do lanche'], textoDaPeca: 'Chegou o Sol Burger' },
  'estrutura-carrossel': { titulo: '5 motivos', quantidadeSlides: 3, slides: [{ numero: 1, titulo: 'Gancho', texto: 'Você sabia?' }, { numero: 2, titulo: 'Motivo', texto: 'Pão artesanal' }, { numero: 3, titulo: 'Final', texto: 'Peça já' }], chamadaParaAcao: 'Peça pelo app' },
  'roteiro-reels': { titulo: 'Bastidores', objetivo: 'Mostrar o preparo', duracaoSegundos: 15, cenas: [{ ordem: 1, duracaoSegundos: 5, fala: 'Olha só', visual: 'chapa' }, { ordem: 2, duracaoSegundos: 10, fala: 'Pronto!', visual: 'lanche montado' }], chamadaParaAcao: 'Siga o perfil' },
  'legenda-social': { plataforma: 'instagram', texto: 'Chegou o Sol Burger 🍔', chamadaParaAcao: 'Peça já', hashtags: ['#burger', '#verão'] },
  'plano-trafego': { objetivo: 'Gerar pedidos no app', publicos: [{ nome: 'Raio 5 km', descricao: 'Pessoas perto da loja' }], canais: ['meta'], estrategia: 'Campanha de conversão com dois criativos', orcamentoSugerido: { valor: 1500, moeda: 'BRL', periodo: 'mes', somenteSugestao: true }, hipoteses: [{ descricao: 'Vídeo converte mais que foto', metrica: 'CPA', evidencia: null }], indicadores: [{ nome: 'CPA', meta: 'até R$ 15' }] },
  'documentacao-tecnica': { titulo: 'Landing page', objetivo: 'Capturar pedidos', escopo: 'Página única estática', componentes: [{ nome: 'Formulário', descricao: 'Coleta nome e telefone' }], dependencias: [{ nome: 'Hospedagem', tipo: 'externa' }], riscos: [{ descricao: 'Spam', mitigacao: 'captcha' }], recomendacoes: ['Testar em 320px'] },
  'relatorio-tecnico': { titulo: 'Integração CRM', contexto: 'Ligar o formulário ao CRM do cliente', decisoes: [{ decisao: 'Usar webhook', motivo: 'Mais simples' }], riscos: [], testes: [{ descricao: 'Enviar formulário de teste', situacao: 'proposto' }] },
};
const copia = (x) => JSON.parse(JSON.stringify(x));
const ok = (id, dados, op) => D.validarDocumento(id, dados, op);

test('catálogo: 10 contratos, coerentes com os tipos de entrega e com os 8 agentes; equivalentes reaproveitados', () => {
  assert.deepStrictEqual(Object.keys(D.DOCUMENTOS).sort(), Object.keys(EXEMPLOS).sort());
  assert.deepStrictEqual(D.conferirCatalogo(AGENTES.map((a) => a.id)), []);
  assert.deepStrictEqual(D.DOCUMENTOS['documentacao-tecnica'].agentes, ['05-dev-web', '06-engenheiro'], 'documentação de projeto e técnica: o MESMO contrato');
  const esperado = {
    '01-guia-marca': ['diretrizes-marca'], '02-designer': ['briefing-design'], '03-carrosseis': ['estrutura-carrossel'], '04-roteirista': ['legenda-social', 'roteiro-reels'],
    '05-dev-web': ['documentacao-tecnica'], '06-engenheiro': ['documentacao-tecnica', 'relatorio-tecnico'], '07-trafego': ['plano-trafego'], '08-estrategista': ['consolidacao-final', 'plano-estrategico'],
  };
  for (const a of AGENTES) assert.deepStrictEqual(D.documentosDoAgente(a.id).sort(), esperado[a.id], a.id);
});

test('cada tipo: exemplo válido passa; campo obrigatório faltando, tipo errado e campo extra são recusados', () => {
  for (const [id, ex] of Object.entries(EXEMPLOS)) {
    const r = ok(id, ex);
    assert.deepStrictEqual([r.valido, r.problemas], [true, []], id);
    const campos = Object.keys(D.DOCUMENTOS[id].esquema.campos).filter((k) => D.DOCUMENTOS[id].esquema.campos[k].obrigatorio);
    for (const k of campos) { const x = copia(ex); delete x[k]; assert.ok(!ok(id, x).valido, `${id} sem ${k}`); }
    const tipoErrado = copia(ex); tipoErrado[campos[0]] = 12345; assert.ok(!ok(id, tipoErrado).valido, `${id}: tipo errado`);
    for (const extra of ['empresaId', 'permissoes', 'limites', 'aprovado', 'caminho']) { const x = copia(ex); x[extra] = 'x'; assert.ok(!ok(id, x).valido, `${id}: campo ${extra}`); }
    assert.ok(!ok(id, null).valido && !ok(id, []).valido && !ok(id, 'texto').valido, `${id}: não objeto`);
  }
  assert.deepStrictEqual(ok('nao-existe', {}).problemas, ['documento-inexistente']);
  assert.deepStrictEqual(ok('__proto__', {}).problemas, ['documento-inexistente']);
});

test('regras específicas: cores, durações, slides, legendas, orçamento e testes', () => {
  const marca = copia(EXEMPLOS['diretrizes-marca']);
  for (const hex of ['FF7A00', '#FFF', '#GG0000', '#ff7a0', 'red', '#FF7A00;']) { marca.paleta[0].hex = hex; assert.ok(!ok('diretrizes-marca', marca).valido, hex); }
  marca.paleta = [{ nome: 'Laranja', hex: '#ff7a00' }, { nome: 'Laranja 2', hex: '#FF7A00' }];
  assert.ok(ok('diretrizes-marca', marca).problemas.includes('paleta: cor repetida'));
  marca.paleta = Array.from({ length: 13 }, (_, i) => ({ nome: `C${i}`, hex: `#0000${String(i).padStart(2, '0')}` }));
  assert.ok(!ok('diretrizes-marca', marca).valido, 'paleta acima de 12');

  const reels = copia(EXEMPLOS['roteiro-reels']);
  reels.duracaoSegundos = 20; assert.ok(ok('roteiro-reels', reels).problemas.some((p) => p.includes('somam 15')));
  reels.duracaoSegundos = 4; assert.ok(!ok('roteiro-reels', reels).valido, 'menos de 5 s');
  reels.duracaoSegundos = 181; assert.ok(!ok('roteiro-reels', reels).valido, 'mais de 180 s');
  const r2 = copia(EXEMPLOS['roteiro-reels']); r2.cenas[1].ordem = 3; assert.ok(ok('roteiro-reels', r2).problemas.some((p) => p.includes('fora de ordem')));
  const r3 = copia(EXEMPLOS['roteiro-reels']); r3.cenas[0].duracaoSegundos = 0; assert.ok(!ok('roteiro-reels', r3).valido);

  const car = copia(EXEMPLOS['estrutura-carrossel']);
  car.quantidadeSlides = 4; assert.ok(ok('estrutura-carrossel', car).problemas.some((p) => p.includes('quantidade')));
  const c1 = copia(car); c1.slides = [c1.slides[0]]; c1.quantidadeSlides = 1; assert.ok(!ok('estrutura-carrossel', c1).valido, '1 slide');
  const c11 = copia(car); c11.slides = Array.from({ length: 11 }, (_, i) => ({ numero: i + 1, titulo: 'T', texto: 'x' })); c11.quantidadeSlides = 11; assert.ok(!ok('estrutura-carrossel', c11).valido, '11 slides');
  const c2 = copia(EXEMPLOS['estrutura-carrossel']); c2.slides[2].numero = 2; assert.ok(!ok('estrutura-carrossel', c2).valido, 'sequência');
  const c3 = copia(EXEMPLOS['estrutura-carrossel']); c3.slides[0].texto = 'x'.repeat(301); assert.ok(!ok('estrutura-carrossel', c3).valido, 'texto do slide');

  const leg = copia(EXEMPLOS['legenda-social']);
  leg.plataforma = 'x'; leg.texto = 'a'.repeat(281); assert.ok(ok('legenda-social', leg).problemas.some((p) => p.includes('limite para x é 280')));
  leg.plataforma = 'instagram'; leg.texto = 'a'.repeat(100);
  assert.ok(ok('legenda-social', leg).valido);
  assert.ok(ok('legenda-social', leg, { opcoes: { limitesLegenda: { instagram: 50 } } }).problemas.some((p) => p.includes('limite para instagram é 50')), 'limite configurável');
  assert.ok(ok('legenda-social', Object.assign(copia(leg), { texto: 'a'.repeat(2100) }), { opcoes: { limitesLegenda: { instagram: 999999 } } }).valido === true, 'nunca acima do contrato (2200)');
  assert.ok(!ok('legenda-social', Object.assign(copia(leg), { texto: 'a'.repeat(2300) }), { opcoes: { limitesLegenda: { instagram: 999999 } } }).valido);
  assert.ok(!ok('legenda-social', Object.assign(copia(leg), { plataforma: 'orkut' })).valido);
  assert.ok(!ok('legenda-social', Object.assign(copia(leg), { hashtags: ['sem-cerquilha'] })).valido);
  assert.ok(!ok('legenda-social', Object.assign(copia(leg), { hashtags: ['#a', '#A'] })).valido, 'hashtag repetida');

  const tr = copia(EXEMPLOS['plano-trafego']);
  tr.orcamentoSugerido.somenteSugestao = false; assert.ok(!ok('plano-trafego', tr).valido, 'orçamento é sempre sugestão');
  const t2 = copia(EXEMPLOS['plano-trafego']); t2.orcamentoSugerido.valor = -1; assert.ok(!ok('plano-trafego', t2).valido);
  const t3 = copia(EXEMPLOS['plano-trafego']); t3.canais = ['meta', 'meta']; assert.ok(!ok('plano-trafego', t3).valido);
  const t4 = copia(EXEMPLOS['plano-trafego']); t4.canais = ['orkut']; assert.ok(!ok('plano-trafego', t4).valido);
  const t5 = copia(EXEMPLOS['plano-trafego']); t5.hipoteses[0].evidencia = { fonte: 'Meta', periodo: 'out/2026' }; assert.ok(ok('plano-trafego', t5).valido);

  const rel = copia(EXEMPLOS['relatorio-tecnico']); rel.testes[0].situacao = 'executado'; assert.ok(!ok('relatorio-tecnico', rel).valido, 'nada é executado pelo sistema');
  const doc = copia(EXEMPLOS['documentacao-tecnica']); doc.componentes.push({ nome: 'formulário', descricao: 'de novo' }); assert.ok(!ok('documentacao-tecnica', doc).valido);
  const br = copia(EXEMPLOS['briefing-design']); br.formato = '999x999'; assert.ok(!ok('briefing-design', br).valido, 'formato de peça fora da lista');
  const cons = copia(EXEMPLOS['consolidacao-final']); cons.entregas[0].hash = 'xyz'; assert.ok(!ok('consolidacao-final', cons).valido);
  cons.entregas = [EXEMPLOS['consolidacao-final'].entregas[0], EXEMPLOS['consolidacao-final'].entregas[0]]; assert.ok(!ok('consolidacao-final', cons).valido, 'entrega repetida');
});

test('limites de tamanho e de listas', () => {
  const plano = copia(EXEMPLOS['plano-estrategico']);
  plano.mensagensChave = Array.from({ length: 11 }, () => 'msg ok'); assert.ok(!ok('plano-estrategico', plano).valido, 'lista acima do máximo');
  const leg = copia(EXEMPLOS['legenda-social']); leg.hashtags = Array.from({ length: 31 }, (_, i) => `#t${i}`); assert.ok(!ok('legenda-social', leg).valido);
  // tamanho total em bytes: legenda tem limite de 8 KB
  const grande = Object.assign(copia(EXEMPLOS['legenda-social']), { plataforma: 'facebook', texto: '🍔'.repeat(2100) }); // 4200 caracteres (cabe no limite de texto), mas 8400 bytes
  const r = ok('legenda-social', grande);
  assert.ok(r.bytes > 8 * 1024 && r.problemas.some((p) => p.includes('o limite deste tipo é 8192')), 'limite em BYTES, não em caracteres');
  for (const [id, d] of Object.entries(D.DOCUMENTOS)) assert.ok(d.limiteBytes >= 8 * 1024 && d.limiteBytes <= 40 * 1024, id);
});

test('permissões por agente: só quem pode produz cada documento', () => {
  for (const a of AGENTES) {
    for (const id of Object.keys(D.DOCUMENTOS)) {
      const pode = D.DOCUMENTOS[id].agentes.includes(a.id);
      const r = ok(id, EXEMPLOS[id], { agenteId: a.id });
      assert.strictEqual(r.valido, pode, `${a.id} → ${id}`);
      if (!pode) assert.ok(r.problemas.includes('documento-nao-permitido-ao-agente'));
    }
  }
  assert.strictEqual(D.documentoPermitido('99-falso', 'roteiro-reels').motivo, 'documento-nao-permitido-ao-agente');
  // o catálogo é congelado: o modelo (ou qualquer código) não concede permissões em tempo de execução
  assert.throws(() => { 'use strict'; D.DOCUMENTOS['plano-trafego'] = {}; });
});

test('dados maliciosos nos textos: controle recusado; HTML, links e Markdown viram texto inerte', () => {
  const x = copia(EXEMPLOS['documentacao-tecnica']);
  x.objetivo = 'abc\u0000def'; assert.ok(ok('documentacao-tecnica', x).problemas.some((p) => p.includes('caractere de controle')));
  x.objetivo = 'texto ‮ invertido'; assert.ok(!ok('documentacao-tecnica', x).valido, 'troca de direção do texto (bidi)');
  const mal = copia(EXEMPLOS['documentacao-tecnica']);
  mal.titulo = '<script>alert(1)</script> [clique](javascript:alert(1)) ![x](https://mal/x.png) # Título falso -->';
  mal.objetivo = 'linha 1\n# cabeçalho injetado\n<!-- labz-documento id=outro -->\n```js\nfetch("x")\n```';
  assert.ok(ok('documentacao-tecnica', mal).valido, 'é texto válido (é dado)');
  const md = R.gerarMarkdown('documentacao-tecnica', mal).markdown;
  assert.ok(!md.includes('<script>') && !md.includes('](javascript') && !md.includes('![') && !/^#\s*cabe/m.test(md), md);
  assert.strictEqual((md.match(/<!--/g) || []).length, 1, 'só o cabeçalho do sistema é comentário');
  assert.ok(!/^```/m.test(md), 'bloco de código do dado neutralizado');
  assert.ok(md.includes('&lt;script&gt;'));
});

test('representação Markdown: determinística, presa à versão, sem entrega nem aprovação próprias, sem divergência silenciosa', () => {
  for (const [id, ex] of Object.entries(EXEMPLOS)) {
    const a = R.gerarMarkdown(id, ex);
    const inverter = (v) => (Array.isArray(v) ? v.map(inverter) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, inverter(v[k])])) : v);
    const b = R.gerarMarkdown(id, inverter(ex)); // mesmas chaves em outra ordem, em todos os níveis
    assert.strictEqual(a.markdown, b.markdown, `${id}: determinístico`);
    assert.strictEqual(a.hashOrigem, R.hashDoDocumento(id, ex));
    assert.ok(a.markdown.startsWith(`<!-- labz-documento id=${id} contrato=1 gerador=1 origem-sha256=${a.hashOrigem} -->`));
    assert.ok(R.conferirRepresentacao(id, ex, a.markdown).confere);
    assert.strictEqual(R.conferirRepresentacao(id, ex, a.markdown.replace('## ', '## X')).confere, false, `${id}: Markdown alterado é detectado`);
    const mudado = copia(ex); const k = ['titulo', 'texto', 'marca', 'peca', 'objetivo'].find((c) => typeof mudado[c] === 'string'); mudado[k] += ' alterado';
    assert.deepStrictEqual([R.conferirRepresentacao(id, mudado, a.markdown).confere, R.conferirRepresentacao(id, mudado, a.markdown).motivo], [false, 'divergente'], `${id}: documento alterado é detectado`);
    assert.strictEqual(R.conferirRepresentacao(id, { invalido: true }, a.markdown).motivo, 'documento-invalido');
  }
  const desc = R.descreverRepresentacao({ entregaId: 'ent_x', versao: 3, documentoId: 'roteiro-reels', dados: EXEMPLOS['roteiro-reels'] });
  assert.deepStrictEqual([desc.entregaId, desc.versao, desc.formato, desc.derivada, desc.aprovacaoPropria], ['ent_x', 3, 'markdown', true, false]);
  assert.ok(Object.isFrozen(desc));
  assert.throws(() => R.descreverRepresentacao({ versao: 1, documentoId: 'roteiro-reels', dados: EXEMPLOS['roteiro-reels'] }), (e) => e.codigo === 'invalido');
  assert.throws(() => R.gerarMarkdown('roteiro-reels', { titulo: 'x' }), (e) => e.codigo === 'invalido', 'documento inválido não tem representação');
  assert.throws(() => R.gerarMarkdown('nao-existe', {}), (e) => e.codigo === 'invalido');
});

// ---------------- plano ----------------
const etapa = (id, agenteId, extra) => Object.assign({ id, agenteId, objetivo: `Fazer ${id}`, dependeDe: [], criterios: ['Critério claro'], estimativaTokens: 3000 }, extra);
const plano = (etapas) => ({ resumo: 'Plano de teste', etapas });
const EXE = { modo: 'orquestrado', objetivo: 'Campanha' };

test('plano: o Estrategista propõe o documento; o backend confere catálogo e permissão; fica registrado no plano', () => {
  const v = validarPlano(plano([etapa('marca', '01-guia-marca', { documento: 'diretrizes-marca' }), etapa('reels', '04-roteirista', { documento: 'roteiro-reels', dependeDe: ['marca'] })]), { exe: EXE });
  assert.strictEqual(v.valido, true, JSON.stringify(v.problemas));
  assert.deepStrictEqual(v.passos.map((p) => p.documento), ['diretrizes-marca', 'roteiro-reels']);
  const etapas = montarEtapas(EXE, v.passos);
  assert.deepStrictEqual(etapas.map((e) => [e.id, e.documento]), [['marca', 'diretrizes-marca'], ['reels', 'roteiro-reels'], ['consolidacao', 'consolidacao-final']]);
  const casos = [
    ['documento-inexistente', etapa('a', '04-roteirista', { documento: 'documento-inventado' })],
    ['documento-nao-permitido-ao-agente', etapa('a', '04-roteirista', { documento: 'plano-trafego' })],
    ['documento-nao-permitido-ao-agente', etapa('a', '02-designer', { documento: 'consolidacao-final' })],
    ['formato-invalido', etapa('a', '04-roteirista', { documento: 'x'.repeat(41) })],
  ];
  for (const [codigo, e] of casos) {
    const r = validarPlano(plano([e]), { exe: EXE });
    assert.ok(!r.valido && r.problemas.some((p) => p.codigo === codigo), `${codigo}: ${JSON.stringify(r.problemas)}`);
  }
  // o modelo não muda permissões pelo plano
  const r = validarPlano(plano([etapa('a', '04-roteirista', { documento: 'roteiro-reels', permissoes: { documentos: ['plano-trafego'] } })]), { exe: EXE });
  assert.ok(r.problemas.some((p) => p.codigo === 'campo-proibido'));
  // plano do Super Admin (passos) também é conferido
  assert.throws(() => montarEtapas(EXE, [{ id: 'a', agenteId: '04-roteirista', objetivo: 'Legendas', documento: 'plano-trafego' }]), (e) => e.codigo === 'invalido');
  assert.throws(() => montarEtapas(EXE, [{ id: 'a', agenteId: '04-roteirista', objetivo: 'Legendas', documento: 'Plano Trafego!' }]), (e) => e.codigo === 'invalido');
});

test('compatibilidade: planos e etapas antigos (sem documento) continuam iguais; especialista não ganha documento', () => {
  const v = validarPlano(plano([etapa('a', '02-designer')]), { exe: EXE });
  assert.strictEqual(v.valido, true);
  assert.ok(!('documento' in v.passos[0]));
  const etapas = montarEtapas(EXE, [{ id: 'a', agenteId: '04-roteirista', objetivo: 'Legendas' }]);
  assert.ok(!('documento' in etapas[0]));
  assert.ok(!('documento' in montarEtapas({ modo: 'especialista', agenteId: '04-roteirista', objetivo: 'Legenda' })[0]));
  // o Estrategista simulado propõe só documentos permitidos aos agentes que escolheu
  const p = planoSimulado('Campanha completa com posts, carrosséis, roteiros de Reels, landing page, integração com API e anúncios no Meta Ads');
  p.etapas.forEach((e) => assert.ok(D.documentoPermitido(e.agenteId, e.documento).permitido, `${e.agenteId} → ${e.documento}`));
});

test('ponta a ponta (motor): o documento escolhido fica no plano; a execução continua registrando UMA entrega por etapa', async () => {
  const c = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado() } });
  const o = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' });
  assert.deepStrictEqual(o.etapas.map((e) => [e.id, e.documento]), [['textos', 'roteiro-reels'], ['pecas', 'briefing-design'], ['consolidacao', 'consolidacao-final']]);
  await c.executorLocal().drenar();
  assert.strictEqual((await c.execucoes.obter(c.ator, o.id)).estado, 'COMPLETED');
  const entregas = (await c.entregas.listar(c.ator, { execucaoId: o.id })).itens;
  assert.strictEqual(entregas.length, 3, 'uma entrega por etapa: nada duplicado (o Markdown não vira outra entrega)');
  // plano do modelo com documento proibido é recusado sem mudar o estado
  const c2 = await montarComEmpresas({ ia: { transporte: transporteComModeloSimulado({}, { plano: () => plano([etapa('a', '04-roteirista', { documento: 'plano-trafego' })]) }) } });
  const exe = await c2.execucoes.criar(c2.ator, { empresaId: c2.A.id, objetivo: 'Campanha', modo: 'orquestrado' });
  const e = await rejeita(() => c2.motor.planejar(c2.ator, exe.id), 'invalido');
  assert.ok(e.detalhes.problemas.some((x) => x.codigo === 'documento-nao-permitido-ao-agente'));
  assert.strictEqual((await c2.execucoes.obter(c2.ator, exe.id)).estado, 'CREATED');
});
