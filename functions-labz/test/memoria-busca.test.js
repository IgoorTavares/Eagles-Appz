// Fase 3C: busca por metadados e palavras-chave, índice, ranking, limites e
// isolamento. Só dados fictícios; banco em memória (que imita as restrições
// do Firestore e conta as leituras).
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, memoriaAprovada, rejeita, relogioDeTeste } = require('./ajuda');
const M = require('../src/contratos/memoria');
const R = require('../src/contratos/recuperacao');
const { caminhos } = require('../src/armazenamento/caminhos');
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { criarLabz } = require('../src/servicos');
const { criarApi } = require('../src/api/labz-api');
const { termosDaVersao, termosDaConsulta, INDICE_VERSAO } = require('../src/memoria/indice');
const { ranquear, desempate } = require('../src/memoria/ranqueador');
const { INDICES_NECESSARIOS, indiceDaConsulta, indiceDeclarado } = require('../src/memoria/recuperador');

const cli = (c, extra = {}) => Object.assign({ escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'referencia', titulo: 'Referência', conteudo: 'texto', origem: { tipo: 'manual' } }, extra);
const buscar = (c, consulta) => c.recuperador.buscar(c.ator, consulta);
const titulos = (r) => r.itens.map((i) => i.titulo);
const doc = (c, ref) => c.banco.obter(caminhos.memoria(ref.escopo, ref.alvo, ref.memoriaId));

// Espião: guarda cada consulta feita ao banco.
function espiar(banco) {
  const feitas = [];
  const original = banco.consultar;
  banco.consultar = async (colecao, opcoes) => { feitas.push({ colecao, opcoes: JSON.parse(JSON.stringify(opcoes)) }); return original(colecao, opcoes); };
  return feitas;
}

// ---------------- índice ----------------

test('índice: termos sem acento, sem palavras vazias e com plural simples; consulta limitada a 30', () => {
  const t = termosDaVersao({ titulo: 'Fotos do Cardápio', conteudo: 'As fotos SEMPRE com luz natural e fotos de produto', tags: ['Verão'], categoria: 'preferencia', chave: 'fotos-cardapio' });
  assert.deepStrictEqual(t.slice(0, 4), ['preferencia', 'foto', 'cardapio', 'verao']);
  assert.ok(!t.includes('sempre') && !t.includes('com') && !t.includes('fotos'));
  assert.ok(t.length <= 40);
  const longo = Array.from({ length: 50 }, (_, i) => `palavra${String(i).padStart(2, '0')}x`).join(' ');
  assert.strictEqual(termosDaConsulta(longo).length, 30);
  assert.deepStrictEqual(termosDaConsulta(longo), termosDaConsulta(longo.split(' ').reverse().join(' ')), 'determinístico');
  assert.deepStrictEqual(termosDaConsulta('de para com que'), []);
});

test('índice: gravado na aprovação, junto com a vigente; pendente não indexa; rollback e nova aprovação reindexam', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c, { titulo: 'Paleta', conteudo: 'Azul marinho' }));
  assert.strictEqual((await doc(c, m.ref)).termos, undefined, 'pendente não tem índice');
  await c.memoria.aprovarVersao(c.ator, m.ref, 1);
  let d = await doc(c, m.ref);
  assert.ok(d.termos.includes('azul') && d.termos.includes('marinho'));
  assert.strictEqual(d.indiceVersao, INDICE_VERSAO);
  assert.strictEqual(d.aprovadaEm, (await c.memoria.versoes(m.ref))[0].aprovacao.em);
  assert.deepStrictEqual(M.conferirRegistroMemoria(d), []);
  await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Verde limão', origem: { tipo: 'manual' } });
  d = await doc(c, m.ref);
  assert.ok(d.termos.includes('azul') && !d.termos.includes('verde'), 'versão pendente não muda o índice');
  await c.memoria.aprovarVersao(c.ator, m.ref, 2);
  d = await doc(c, m.ref);
  assert.ok(d.termos.includes('verde') && !d.termos.includes('azul'), 'aprovação troca o índice');
  await c.memoria.voltarVersao(c.ator, m.ref, 1);
  d = await doc(c, m.ref);
  assert.ok(d.termos.includes('azul') && !d.termos.includes('verde'), 'rollback reindexa');
  assert.strictEqual(d.versaoVigente, 3);
});

// ---------------- busca por escopo, empresa, agente e palavras ----------------

test('busca por empresa, agente e escopo: cada consulta fica na coleção do alvo', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { titulo: 'Fotos Alfa', conteudo: 'Fotos claras da marca alfa' }));
  await memoriaAprovada(c, cli(c, { alvo: { empresaId: c.B.id }, titulo: 'Fotos Beta', conteudo: 'Fotos escuras da marca beta' }));
  await memoriaAprovada(c, { escopo: 'agente', alvo: { agenteId: '02-designer' }, categoria: 'tecnica', titulo: 'Fotos do designer', conteudo: 'Fotos com grid de 8px', origem: { tipo: 'manual' } });
  await memoriaAprovada(c, { escopo: 'agente', alvo: { agenteId: '04-roteirista' }, categoria: 'tecnica', titulo: 'Fotos do roteirista', conteudo: 'Fotos com legenda curta', origem: { tipo: 'manual' } });
  await memoriaAprovada(c, { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Fotos globais', conteudo: 'Fotos revisadas antes da entrega', origem: { tipo: 'manual' } });
  await memoriaAprovada(c, { escopo: 'desempenho', alvo: { empresaId: c.A.id }, categoria: 'resultado', titulo: 'Fotos que performam', conteudo: 'Fotos com rosto tiveram CTR maior', evidencias: [{ fonte: 'Meta', metrica: 'CTR', valor: 2, periodo: 'out/2026' }], origem: { tipo: 'manual' } });
  await c.memoria.criar(c.ator, { escopo: 'tarefa', alvo: { tarefaId: 'tA' }, categoria: 'nota', titulo: 'Fotos da tarefa', conteudo: 'Fotos da tarefa A', origem: { tipo: 'manual' } });
  const casos = [
    [{ escopo: 'cliente', alvo: { empresaId: c.A.id } }, ['Fotos Alfa']],
    [{ escopo: 'cliente', alvo: { empresaId: c.B.id } }, ['Fotos Beta']],
    [{ escopo: 'agente', alvo: { agenteId: '02-designer' } }, ['Fotos do designer']],
    [{ escopo: 'agente', alvo: { agenteId: '04-roteirista' } }, ['Fotos do roteirista']],
    [{ escopo: 'global', alvo: {} }, ['Fotos globais']],
    [{ escopo: 'desempenho', alvo: { empresaId: c.A.id } }, ['Fotos que performam']],
    [{ escopo: 'tarefa', alvo: { tarefaId: 'tA' } }, ['Fotos da tarefa']],
    [{ escopo: 'tarefa', alvo: { tarefaId: 'tB' } }, []],
  ];
  for (const [q, esperado] of casos) {
    const r = await buscar(c, Object.assign({ modo: 'textual', texto: 'fotos' }, q));
    assert.deepStrictEqual(titulos(r), esperado, JSON.stringify(q));
    r.itens.forEach((i) => assert.deepStrictEqual([i.escopo, i.alvo], [q.escopo, M.alvoDoEscopo(q.escopo, q.alvo)]));
    assert.ok(r.itens.every((i) => i.id && i.versao >= 1), 'referência de origem e versão');
  }
});

test('palavras-chave: acento, plural e maiúsculas não atrapalham; filtros de metadados no banco', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { categoria: 'preferencia', chave: 'cardapio', titulo: 'Cardápio', tags: ['verao'], conteudo: 'Foto do cardápio com fundo claro' }));
  await memoriaAprovada(c, cli(c, { categoria: 'marca', titulo: 'Logo', conteudo: 'Logo sempre no canto' }));
  assert.deepStrictEqual(titulos(await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'FOTOS do CARDAPIO' })), ['Cardápio']);
  assert.deepStrictEqual(titulos(await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', filtros: { categoria: 'marca' } })), ['Logo']);
  assert.deepStrictEqual(titulos(await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', filtros: { chave: 'cardapio' } })), ['Cardápio']);
  assert.deepStrictEqual(titulos(await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', filtros: { tags: ['Verão'] } })), ['Cardápio']);
  assert.deepStrictEqual(titulos(await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'logo', filtros: { categoria: 'preferencia' } })), []);
  const r = await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'de para com' });
  assert.deepStrictEqual([r.itens.length, r.metricas.consultas], [0, 0], 'só palavras vazias: nem consulta');
});

test('só a versão aprovada vigente é encontrada: pendente, rascunho, revisão, rejeitada e arquivada não', async () => {
  const c = await montarComEmpresas();
  const ok = await memoriaAprovada(c, cli(c, { titulo: 'Vigente', conteudo: 'palavraaprovada azul' }));
  await c.memoria.novaVersao(c.ator, ok.ref, { conteudo: 'palavrapendente', origem: { tipo: 'manual' } });
  await c.memoria.criar(c.ator, cli(c, { titulo: 'Rascunho', conteudo: 'palavrarascunho' }), { rascunho: true });
  const rev = await c.memoria.criar(c.ator, cli(c, { titulo: 'Revisao', conteudo: 'palavrarevisao' }));
  await c.memoria.pedirRevisao(c.ator, rev.ref, 1, 'incompleta');
  const rej = await c.memoria.criar(c.ator, cli(c, { titulo: 'Rejeitada', conteudo: 'palavrarejeitada' }));
  await c.memoria.rejeitarVersao(c.ator, rej.ref, 1, 'não serve');
  const arq = await memoriaAprovada(c, cli(c, { titulo: 'Arquivada', conteudo: 'palavraarquivada' }));
  await c.memoria.arquivar(c.ator, arq.ref, 'fim');
  const q = (texto) => buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto });
  assert.deepStrictEqual(titulos(await q('palavraaprovada')), ['Vigente']);
  for (const p of ['palavrapendente', 'palavrarascunho', 'palavrarevisao', 'palavrarejeitada', 'palavraarquivada']) assert.deepStrictEqual(titulos(await q(p)), [], p);
  await c.memoria.reativar(c.ator, arq.ref);
  assert.deepStrictEqual(titulos(await q('palavraarquivada')), ['Arquivada'], 'reativada volta para a busca');
  const meta = await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados' });
  assert.deepStrictEqual(titulos(meta).sort(), ['Arquivada', 'Vigente']);
});

test('busca logo depois da aprovação já enxerga a versão nova (índice consistente com a vigente)', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { titulo: 'Tom', conteudo: 'tom formalissimo' }));
  await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'tom descontraidissimo', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, 2);
  const q = (texto) => buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto });
  assert.deepStrictEqual((await q('descontraidissimo')).itens.map((i) => i.versao), [2]);
  assert.deepStrictEqual(titulos(await q('formalissimo')), []);
  await c.memoria.voltarVersao(c.ator, m.ref, 1);
  assert.deepStrictEqual((await q('formalissimo')).itens.map((i) => i.versao), [3]);
});

// ---------------- ranking ----------------

test('ranking: transparente, determinístico e com desempate explícito', async () => {
  const relogio = relogioDeTeste();
  const montarCom = async (ordem) => {
    const banco = criarBancoMemoria();
    await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
    await banco.gravar('labz_config/acesso', { uids: ['sa'] });
    const s = criarLabz({ banco, relogio: relogioDeTeste() });
    const ator = await require('../src/auth/super-admin').exigirSuperAdmin({ uid: 'sa', token: {} }, { banco, uidsAutorizados: ['sa'] });
    const e = await s.empresas.criar(ator, { nome: 'Marca Ranking' });
    const dados = {
      A: { categoria: 'marca', titulo: 'Fotos e legendas', conteudo: 'fotos legendas cardapio' },
      B: { categoria: 'referencia', titulo: 'Fotos', conteudo: 'fotos' },
      C: { categoria: 'marca', titulo: 'Legendas', conteudo: 'legendas curtas' },
      D: { categoria: 'publico', titulo: 'Público', conteudo: 'publico jovem fotos' },
    };
    for (const k of ordem) {
      const m = await s.memoria.criar(ator, Object.assign({ escopo: 'cliente', alvo: { empresaId: e.id }, origem: { tipo: 'manual' } }, dados[k]));
      await s.memoria.aprovarVersao(ator, m.ref, 1);
    }
    return s.recuperador.buscar(ator, { escopo: 'cliente', alvo: { empresaId: e.id }, modo: 'textual', texto: 'fotos legendas' });
  };
  const r1 = await montarCom(['A', 'B', 'C', 'D']);
  const r2 = await montarCom(['D', 'C', 'B', 'A']);
  assert.strictEqual(titulos(r1)[0], 'Fotos e legendas', 'quem cobre os dois termos vem primeiro');
  const semAtualidade = (r) => r.itens.map((i) => [i.titulo, i.criterios.cobertura, i.criterios.categoria, i.criterios.escopo]);
  assert.deepStrictEqual(semAtualidade(r1).sort(), semAtualidade(r2).sort());
  r1.itens.forEach((i) => {
    const p = R.CRITERIOS_RANKING.pesos;
    const soma = Object.keys(p).reduce((s, k) => s + p[k] * i.criterios[k], 0);
    assert.ok(Math.abs(soma - i.pontuacao) < 1e-5, 'a nota é a soma ponderada dos critérios mostrados');
  });
  // desempate: nota igual → versão maior → id alfabético; e a ordem não depende da entrada
  const itens = [{ id: 'b', versao: 1, pontuacao: 0.5 }, { id: 'a', versao: 1, pontuacao: 0.5 }, { id: 'c', versao: 2, pontuacao: 0.5 }, { id: 'd', versao: 1, pontuacao: 0.9 }];
  assert.deepStrictEqual(itens.slice().sort(desempate).map((x) => x.id), ['d', 'c', 'a', 'b']);
  assert.deepStrictEqual(itens.slice().reverse().sort(desempate).map((x) => x.id), ['d', 'c', 'a', 'b']);
  const agora = '2026-12-01T00:00:00.000Z';
  const base = [{ id: 'x', escopo: 'cliente', categoria: 'marca', versao: 1, termos: ['foto'], aprovadaEm: '2026-11-01T00:00:00.000Z' }, { id: 'y', escopo: 'global', categoria: 'marca', versao: 1, termos: ['foto'], aprovadaEm: '2026-11-01T00:00:00.000Z' }];
  assert.deepStrictEqual(ranquear(base, { termos: ['foto'], agora }).map((x) => x.id), ['x', 'y'], 'cliente vem antes da global');
  assert.deepStrictEqual(JSON.stringify(ranquear(base, { termos: ['foto'], agora })), JSON.stringify(ranquear(base.slice().reverse(), { termos: ['foto'], agora })));
});

// ---------------- limites e paginação ----------------

test('limites: até 50 candidatos por escopo, resultado limitado e trecho cortado', async () => {
  const c = await montarComEmpresas();
  for (let i = 0; i < 60; i++) {
    const m = await c.memoria.criar(c.ator, cli(c, { titulo: `Item ${i}`, conteudo: `fotos produto modelo${i}x variante${i * 7}y cor${i * 13}z ${'x'.repeat(i === 0 ? 1500 : 0)}` }));
    await c.memoria.aprovarVersao(c.ator, m.ref, 1);
  }
  c.banco.zerarEstatisticas();
  const r = await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'fotos', limite: 5 });
  assert.strictEqual(r.itens.length, 5);
  assert.strictEqual(r.metricas.documentosLidos, 50, 'leu no máximo 50 candidatos');
  assert.strictEqual(r.metricas.limiteAtingido, true);
  const est = c.banco.estatisticas();
  assert.deepStrictEqual([est.listar.chamadas, est.consultar.chamadas, est.consultar.documentos], [0, 1, 50], 'o limite é aplicado no banco');
  const longa = (await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'modelo0x' })).itens[0];
  assert.strictEqual(longa.trecho.length, R.LIMITES_BUSCA.caracteresPorResultado);
  assert.strictEqual(longa.cortado, true);
});

test('paginação por metadados: páginas sem repetição até acabar, cursor determinístico', async () => {
  const c = await montarComEmpresas();
  for (let i = 0; i < 23; i++) await memoriaAprovada(c, cli(c, { titulo: `Pag ${i}`, conteudo: `conteudo exclusivo numero${i}q bloco${i * 3}w` }));
  const vistos = [];
  let depoisDe;
  let paginas = 0;
  do {
    c.banco.zerarEstatisticas();
    const r = await buscar(c, Object.assign({ escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', limite: 10 }, depoisDe ? { depoisDe } : {}));
    assert.ok(r.itens.length <= 10);
    assert.ok(c.banco.estatisticas().consultar.documentos <= 10, 'o banco devolveu no máximo uma página');
    vistos.push(...r.itens.map((i) => i.id));
    depoisDe = r.proximo;
    paginas++;
  } while (depoisDe && paginas < 10);
  assert.strictEqual(paginas, 3);
  assert.strictEqual(new Set(vistos).size, 23);
  const pg = await c.memoria.listarPagina('cliente', { empresaId: c.A.id }, { limite: 10 });
  assert.strictEqual(pg.itens.length, 10);
  assert.ok(pg.proximo);
});

// ---------------- isolamento, consultas inválidas e leituras ilimitadas ----------------

test('isolamento: nenhuma busca, listagem ou contexto de uma empresa devolve dado de outra', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { titulo: 'Alfa', conteudo: 'segredoalfa fotos' }));
  await memoriaAprovada(c, cli(c, { alvo: { empresaId: c.B.id }, titulo: 'Beta', conteudo: 'segredobeta fotos' }));
  const feitas = espiar(c.banco);
  const rB = await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.B.id }, modo: 'textual', texto: 'segredoalfa fotos' });
  assert.deepStrictEqual(titulos(rB), ['Beta']);
  const ctx = await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.B.id, briefing: 'segredoalfa fotos' });
  const memoriasB = JSON.stringify(ctx.blocos.filter((b) => b.tipo !== 'briefing'));
  assert.ok(!memoriasB.includes('segredoalfa') && memoriasB.includes('segredobeta'), 'só memórias da empresa B (o briefing é o texto pedido)');
  const pagB = JSON.stringify(await c.memoria.listarPagina('cliente', { empresaId: c.B.id }));
  assert.ok(!pagB.includes('segredoalfa'));
  feitas.filter((f) => f.colecao.includes('/labz_memorias')).forEach((f) => assert.ok(!f.colecao.includes(c.A.id), `consultou ${f.colecao}`));
});

test('consultas inválidas são recusadas antes de ler', async () => {
  const c = await montarComEmpresas();
  const base = { escopo: 'cliente', alvo: { empresaId: c.A.id } };
  await rejeita(() => buscar(c, Object.assign({ modo: 'semantica', texto: 'fotos' }, base)), 'precondicao');
  await rejeita(() => buscar(c, Object.assign({ modo: 'textual', texto: 'fotos', depoisDe: 'mem_x' }, base)), 'invalido');
  await rejeita(() => buscar(c, Object.assign({ modo: 'metadados', filtros: { status: 'pendente' } }, base)), 'invalido');
  await rejeita(() => buscar(c, Object.assign({ modo: 'metadados', limite: 51 }, base)), 'invalido');
  await rejeita(() => buscar(c, Object.assign({ modo: 'metadados', depoisDe: '../x' }, base)), 'invalido');
  await rejeita(() => buscar(c, Object.assign({ modo: 'metadados', depoisDe: 'nao-existe' }, base)), 'invalido');
  await rejeita(() => buscar(c, { escopo: 'cliente', alvo: { empresaId: `${c.A.id}/../${c.B.id}` }, modo: 'metadados' }), 'invalido');
  await rejeita(() => buscar(c, { escopo: 'cliente', alvo: {}, modo: 'metadados' }), 'invalido');
  await rejeita(() => c.recuperador.buscar({ tipo: 'superadmin', uid: 'sa' }, Object.assign({ modo: 'metadados' }, base)), 'permissao-negada');
  // o banco recusa consulta sem limite ou fora das regras do Firestore
  await rejeita(() => c.banco.consultar(`labz_empresas/${c.A.id}/labz_memorias`, { onde: [] }), 'invalido');
  await rejeita(() => c.banco.consultar(`labz_empresas/${c.A.id}/labz_memorias`, { limite: 500 }), 'invalido');
  await rejeita(() => c.banco.consultar('usuarios', { limite: 1 }), 'invalido');
});

test('nenhuma leitura de coleção inteira fora da aprovação; toda consulta tem limite, filtro de status e índice declarado', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { categoria: 'preferencia', chave: 'fotos', titulo: 'Fotos', conteudo: 'fotos com luz natural' }));
  await memoriaAprovada(c, { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Método', conteudo: 'revisar antes de entregar', origem: { tipo: 'manual' } });
  const feitas = espiar(c.banco);
  c.banco.zerarEstatisticas();
  // tudo o que é leitura/busca/aviso
  await c.contexto.montar({ agenteId: '08-estrategista', empresaId: c.A.id, tarefaId: 'tA', briefing: 'fotos luz' }, c.ator);
  await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'fotos', filtros: { categoria: 'preferencia' } });
  await buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', filtros: { chave: 'fotos' } });
  const nova = await c.memoria.criar(c.ator, cli(c, { categoria: 'preferencia', chave: 'fotos', titulo: 'Fotos 2', conteudo: 'fotos em estúdio' }));
  await c.memoria.criar(c.ator, { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Outro método', conteudo: 'conferir ortografia', origem: { tipo: 'manual' } });
  await c.correcoes.registrar(c.ator, { tarefaId: 'tA', texto: 'fotos sempre com luz natural', alcance: 'permanente' });
  await c.correcoes.pendentes();
  await c.auditor.auditar('cliente', { empresaId: c.A.id });
  await c.memoria.vigentes('cliente', { empresaId: c.A.id });
  const est = c.banco.estatisticas();
  const memoriasInteiras = Object.entries(est.porColecao).filter(([col, v]) => /memorias|desempenho|labz_memoria_global|labz_aprendizados|labz_empresas$/.test(col) && v.listar > 0);
  assert.deepStrictEqual(memoriasInteiras, [], 'nenhuma coleção de memória lida inteira');
  for (const f of feitas) {
    assert.ok(f.opcoes.limite >= 1 && f.opcoes.limite <= 200, `limite em ${f.colecao}`);
    assert.ok(indiceDeclarado(indiceDaConsulta(f.colecao, f.opcoes)), `índice declarado para ${f.colecao} ${JSON.stringify(f.opcoes.onde)}`);
    const busca = f.opcoes.ordenar && f.opcoes.ordenar.campo === 'aprovadaEm';
    if (busca) assert.ok(f.opcoes.onde.some((o) => o.campo === 'status' && o.op === '==' && o.valor === 'ativa'), 'status ativa NA consulta');
  }
  // a APROVAÇÃO continua lendo a coleção dentro da transação (garantia da Fase 3B)
  c.banco.zerarEstatisticas();
  await rejeita(() => c.memoria.aprovarVersao(c.ator, nova.ref, 1), 'conflito');
  assert.ok(c.banco.estatisticas().porColecao[`labz_empresas/${c.A.id}/labz_memorias`].listar >= 1);
});

test('índices: cada consulta tem índice declarado no formato do firestore.indexes.json (não publicado)', () => {
  assert.strictEqual(INDICES_NECESSARIOS.length, 25);
  INDICES_NECESSARIOS.forEach((i) => {
    assert.ok(['labz_memorias', 'labz_desempenho', 'labz_memoria_global', 'labz_aprendizados'].includes(i.collectionGroup));
    assert.strictEqual(i.queryScope, 'COLLECTION', 'nunca collectionGroup: sem índice que misture clientes');
  });
  assert.deepStrictEqual(indiceDaConsulta('labz_empresas/e1/labz_memorias', { onde: [{ campo: 'status', op: '==', valor: 'ativa' }, { campo: 'termos', op: 'array-contains-any', valor: ['a'] }], ordenar: { campo: 'aprovadaEm', direcao: 'desc' }, limite: 50 }).fields.map((f) => f.fieldPath), ['status', 'termos', 'aprovadaEm']);
  assert.strictEqual(indiceDaConsulta('labz_empresas', { ordenar: { campo: 'id', direcao: 'asc' }, limite: 200 }), null, 'só id: automático');
  assert.ok(!indiceDeclarado({ collectionGroup: 'labz_memorias', queryScope: 'COLLECTION', fields: [{ fieldPath: 'x', order: 'ASCENDING' }, { fieldPath: 'y', order: 'ASCENDING' }] }));
  const arquivo = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'firestore.indexes.json'), 'utf8'));
  assert.ok(!JSON.stringify(arquivo).includes('aprovadaEm'), 'firestore.indexes.json não foi alterado');
});

// ---------------- contexto, auditoria, API e reindexação ----------------

test('contexto: no máximo 2 consultas limitadas por escopo, métricas e auditoria sem conteúdo', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { titulo: 'Fotos', conteudo: 'CONTEUDO-PRIVADO fotos claras' }));
  c.banco.zerarEstatisticas();
  const ctx = await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.A.id, tarefaId: 'tA', briefing: 'BRIEFING-PRIVADO fotos' }, c.ator);
  assert.ok(ctx.metricas.consultas <= 2 * 4, 'roteirista lê 4 escopos');
  assert.ok(ctx.metricas.documentosLidos <= 4 * 70);
  assert.strictEqual(c.banco.estatisticas().listar.chamadas, 0);
  assert.ok(JSON.stringify(ctx).includes('CONTEUDO-PRIVADO'));
  const ev = (await c.auditoria.listar()).filter((e) => e.tipo === 'memoria.contexto_montado');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].ator.uid, 'sa');
  assert.ok(ev[0].detalhes.fontes.length >= 1 && ev[0].detalhes.consultas === ctx.metricas.consultas);
  assert.ok(!JSON.stringify(ev).includes('PRIVADO'), 'nem conteúdo nem briefing na auditoria');
  assert.ok(ctx.blocos.every((b) => b.itens.every((i) => i.termos === undefined)), 'campos internos não saem no contexto');
});

test('API: busca só do Super Admin, auditada sem o texto pesquisado; listagem e fila paginadas', async () => {
  const banco = criarBancoMemoria();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const api = criarApi({ servicos: criarLabz({ banco, relogio: relogioDeTeste() }), banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const chamar = (uid, acao, dados) => api({ auth: uid ? { uid, token: {} } : undefined, data: { acao, dados } });
  const e = (await chamar('sa', 'empresas.criar', { empresa: { nome: 'Marca Teste' } })).resultado;
  const m = (await chamar('sa', 'memoria.criar', { memoria: { escopo: 'cliente', alvo: { empresaId: e.id }, categoria: 'marca', titulo: 'Cores', conteudo: 'azul profundo', origem: { tipo: 'manual' } } })).resultado;
  await chamar('sa', 'memoria.aprovar', { ref: m.ref, versao: 1 });
  const consulta = { escopo: 'cliente', alvo: { empresaId: e.id }, modo: 'textual', texto: 'PESQUISA-SIGILOSA azul' };
  await rejeita(() => chamar('d1', 'memoria.buscar', { consulta }), 'permissao-negada');
  await rejeita(() => chamar(null, 'memoria.buscar', { consulta }), 'nao-autenticado');
  const r = (await chamar('sa', 'memoria.buscar', { consulta })).resultado;
  assert.deepStrictEqual(r.itens.map((i) => i.titulo), ['Cores']);
  assert.strictEqual(r.semantica.disponivel, false);
  const ev = (await banco.listar('labz_eventos')).filter((x) => x.tipo === 'memoria.busca_realizada');
  assert.strictEqual(ev.length, 1);
  assert.ok(!JSON.stringify(ev).includes('SIGILOSA') && ev[0].detalhes.documentosLidos === 1);
  const lista = (await chamar('sa', 'memoria.listar', { escopo: 'cliente', alvo: { empresaId: e.id }, status: 'ativa', limite: 10 })).resultado;
  assert.deepStrictEqual([lista.itens.length, lista.proximo], [1, null]);
  await rejeita(() => chamar('sa', 'memoria.listar', { escopo: 'cliente', alvo: { empresaId: e.id }, limite: 101 }), 'invalido');
  const fila = (await chamar('sa', 'correcoes.pendentes', {})).resultado;
  assert.deepStrictEqual(fila, { itens: [], proximo: null });
});

test('reindexação: registro antigo sem índice volta à busca; só o Super Admin; idempotente', async () => {
  const c = await montarComEmpresas();
  const base = caminhos.memoria('cliente', { empresaId: c.A.id }, 'mem_antiga');
  await c.banco.gravar(base, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', chave: null, status: 'ativa', versaoVigente: 1, ultimaVersao: 1, vigente: { versao: 1, titulo: 'Antiga', conteudo: 'palavraantiga', tags: [] }, criadoEm: '2026-10-01T00:00:00.000Z', criadoPor: 'sa', propostoPorAgente: null, atualizadoEm: '2026-10-01T00:00:00.000Z' });
  await c.banco.gravar(`${base}/labz_versoes/1`, { n: 1, status: 'aprovada', titulo: 'Antiga', conteudo: 'palavraantiga', tags: [], origem: { tipo: 'manual' }, criadoEm: '2026-10-01T00:00:00.000Z', criadoPor: 'sa', aprovacao: { por: 'sa', em: '2026-10-01T00:00:00.000Z' } });
  const q = () => buscar(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: 'palavraantiga' });
  assert.deepStrictEqual(titulos(await q()), [], 'sem índice não aparece (como no Firestore)');
  await rejeita(() => c.memoria.reindexar({ tipo: 'superadmin', uid: 'sa' }, 'cliente', { empresaId: c.A.id }), 'permissao-negada');
  const r1 = await c.memoria.reindexar(c.ator, 'cliente', { empresaId: c.A.id });
  assert.deepStrictEqual([r1.lidas, r1.atualizadas, r1.proximo], [1, 1, null]);
  assert.deepStrictEqual(titulos(await q()), ['Antiga']);
  assert.strictEqual((await c.banco.obter(base)).aprovadaEm, '2026-10-01T00:00:00.000Z', 'data da aprovação original');
  assert.strictEqual((await c.memoria.reindexar(c.ator, 'cliente', { empresaId: c.A.id })).atualizadas, 0);
  assert.ok((await c.auditoria.listar()).some((e) => e.tipo === 'memoria.reindexada'));
});

test('trava da Global lê as empresas por páginas e bloqueia quando não dá para conferir todas', async () => {
  const c = await montarComEmpresas();
  for (let i = 0; i < 2001; i++) await c.banco.gravar(`labz_empresas/emp_massa_${String(i).padStart(5, '0')}`, { nome: `Empresa Massa ${i}`, slug: `empresa-massa-${i}`, status: 'ativa' });
  c.banco.zerarEstatisticas();
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Método', conteudo: 'revisar antes de entregar', origem: { tipo: 'manual' } }), 'precondicao');
  const est = c.banco.estatisticas().porColecao.labz_empresas;
  assert.strictEqual(est.listar, 0);
  assert.ok(est.consultar <= R.LIMITES_BUSCA.paginasDeEmpresas);
  assert.strictEqual((await c.memoria.listar('global', {})).length, 0);
});
