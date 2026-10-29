const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarComEmpresas, memoriaAprovada, rejeita } = require('./ajuda');
const { caminhos } = require('../src/armazenamento/caminhos');

const nova = (escopo, alvo, extra = {}) => Object.assign({ escopo, alvo, categoria: { global: 'metodologia', agente: 'tecnica', cliente: 'marca', tarefa: 'nota', desempenho: 'resultado' }[escopo], titulo: `Memória ${escopo}`, conteudo: `Conteúdo de teste do escopo ${escopo}`, origem: { tipo: 'manual' } }, extra);
const EVID = [{ fonte: 'Meta Ads (fictício)', metrica: 'CTR', valor: 2.1, periodo: '2026-10' }];

test('os 5 escopos gravam cada um no seu lugar (isolamento pelo caminho)', async () => {
  const c = await montarComEmpresas();
  const g = await c.memoria.criar(c.ator, nova('global', {}));
  const a = await c.memoria.criar(c.ator, nova('agente', { agenteId: '04-roteirista' }));
  const cl = await c.memoria.criar(c.ator, nova('cliente', { empresaId: c.A.id }));
  const t = await c.memoria.criar(c.ator, nova('tarefa', { tarefaId: 'tA' }));
  const d = await c.memoria.criar(c.ator, nova('desempenho', { empresaId: c.A.id }, { evidencias: EVID }));
  const p = c.banco._caminhos();
  assert.ok(p.includes(`labz_memoria_global/${g.ref.memoriaId}`));
  assert.ok(p.includes(`labz_agentes/04-roteirista/memorias/${a.ref.memoriaId}`));
  assert.ok(p.includes(`labz_empresas/${c.A.id}/memorias/${cl.ref.memoriaId}`));
  assert.ok(p.includes(`labz_tarefas/tA/memorias/${t.ref.memoriaId}`));
  assert.ok(p.includes(`labz_empresas/${c.A.id}/desempenho/${d.ref.memoriaId}`));
  assert.ok(p.every((x) => !x.startsWith(`labz_empresas/${c.B.id}/`)), 'nada foi gravado na empresa B');
});

test('permanentes nascem pendentes; tarefa vale na hora e expira', async () => {
  const c = await montarComEmpresas();
  for (const [esc, alvo, extra] of [['global', {}], ['agente', { agenteId: '02-designer' }], ['cliente', { empresaId: c.A.id }], ['desempenho', { empresaId: c.A.id }, { evidencias: EVID }]]) {
    const m = await c.memoria.criar(c.ator, nova(esc, alvo, extra));
    assert.equal(m.status, 'pendente', esc);
    assert.equal(m.vigente, null, esc);
    assert.equal((await c.memoria.vigentes(esc, alvo)).length, 0, `${esc}: pendente não vale como regra`);
  }
  const t = await c.memoria.criar(c.ator, nova('tarefa', { tarefaId: 'tA' }));
  assert.equal(t.status, 'ativa');
  assert.equal((await c.memoria.vigentes('tarefa', { tarefaId: 'tA' })).length, 1);
  c.relogio.avancarDias(31);
  assert.equal((await c.memoria.vigentes('tarefa', { tarefaId: 'tA' })).length, 0, 'expirou');
});

test('alvo errado, categoria errada e empresa arquivada são recusados', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', {})), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', { empresaId: c.A.id, agenteId: '02-designer' })), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, nova('global', { empresaId: c.A.id })), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, nova('agente', { agenteId: '99-falso' })), 'nao-encontrado');
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', { empresaId: 'emp_naoexiste' })), 'nao-encontrado');
  await rejeita(() => c.memoria.criar(c.ator, nova('tarefa', { tarefaId: 'tX' })), 'nao-encontrado');
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', { empresaId: c.A.id }, { categoria: 'metodologia' })), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', { empresaId: '../../usuarios' })), 'invalido');
  await c.empresas.arquivar(c.ator, c.B.id);
  await rejeita(() => c.memoria.criar(c.ator, nova('cliente', { empresaId: c.B.id })), 'precondicao');
  await rejeita(() => c.memoria.criar(c.ator, nova('tarefa', { tarefaId: 'tB' })), 'precondicao');
});

test('desempenho só com evidências', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.memoria.criar(c.ator, nova('desempenho', { empresaId: c.A.id })), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, nova('desempenho', { empresaId: c.A.id }, { evidencias: [{ fonte: 'x' }] })), 'invalido');
  const m = await memoriaAprovada(c, nova('desempenho', { empresaId: c.A.id }, { evidencias: EVID }));
  assert.equal(m.status, 'ativa');
});

test('agente só propõe nos escopos do contrato dele', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.memoria.criar(c.ator, nova('global', {}), { agenteId: '04-roteirista' }), 'permissao-negada');
  await rejeita(() => c.memoria.criar(c.ator, nova('desempenho', { empresaId: c.A.id }, { evidencias: EVID }), { agenteId: '04-roteirista' }), 'permissao-negada');
  const ok = await c.memoria.criar(c.ator, nova('desempenho', { empresaId: c.A.id }, { evidencias: EVID }), { agenteId: '07-trafego' });
  assert.equal(ok.propostoPorAgente, '07-trafego');
  assert.equal(ok.status, 'pendente', 'proposta de agente nunca nasce aprovada');
});

test('versionamento: aprovar, nova versão pendente, rejeitar, voltar versão, histórico completo', async () => {
  const c = await montarComEmpresas();
  const ref = (await c.memoria.criar(c.ator, nova('cliente', { empresaId: c.A.id }, { conteudo: 'Cor principal: azul' }))).ref;
  await c.memoria.aprovarVersao(c.ator, ref, 1);
  const n2 = await c.memoria.novaVersao(c.ator, ref, { conteudo: 'Cor principal: verde', origem: { tipo: 'manual' } });
  assert.equal(n2, 2);
  assert.equal((await c.memoria.obter(ref)).vigente.conteudo, 'Cor principal: azul', 'pendente não substitui a vigente');
  await c.memoria.aprovarVersao(c.ator, ref, 2);
  assert.equal((await c.memoria.obter(ref)).vigente.conteudo, 'Cor principal: verde');
  const n3 = await c.memoria.novaVersao(c.ator, ref, { conteudo: 'Cor principal: roxo', origem: { tipo: 'manual' } });
  await c.memoria.rejeitarVersao(c.ator, ref, n3, 'não combina');
  await rejeita(() => c.memoria.aprovarVersao(c.ator, ref, n3), 'precondicao');
  const m = await c.memoria.voltarVersao(c.ator, ref, 1);
  assert.equal(m.vigente.conteudo, 'Cor principal: azul');
  assert.equal(m.versaoVigente, 4);
  const vs = await c.memoria.versoes(ref);
  assert.deepEqual(vs.map((v) => [v.n, v.status]), [[1, 'substituida'], [2, 'substituida'], [3, 'rejeitada'], [4, 'aprovada']]);
  assert.deepEqual(vs[3].origem, { tipo: 'rollback', versaoDe: 1 });
  assert.equal(vs[3].aprovacao.por, 'sa');
  await rejeita(() => c.memoria.voltarVersao(c.ator, ref, 3), 'precondicao');
  await rejeita(() => c.memoria.voltarVersao(c.ator, ref, 4), 'precondicao');
});

test('arquivar tira do contexto sem apagar; reativar devolve', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, nova('global', {}));
  await c.memoria.arquivar(c.ator, m.ref, 'obsoleta');
  assert.equal((await c.memoria.vigentes('global', {})).length, 0);
  assert.equal((await c.memoria.versoes(m.ref)).length, 1, 'histórico preservado');
  await rejeita(() => c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'x y z', origem: { tipo: 'manual' } }), 'precondicao');
  await c.memoria.reativar(c.ator, m.ref);
  assert.equal((await c.memoria.vigentes('global', {})).length, 1);
});

test('toda operação de memória fica na auditoria, e só o ator do Super Admin opera', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, nova('cliente', { empresaId: c.A.id }));
  await c.memoria.arquivar(c.ator, m.ref);
  const tipos = (await c.auditoria.listar()).map((e) => e.tipo);
  ['memoria.criada', 'memoria.versao_aprovada', 'memoria.arquivada'].forEach((t) => assert.ok(tipos.includes(t), t));
  await rejeita(() => c.memoria.criar({ tipo: 'superadmin', uid: 'sa' }, nova('global', {})), 'permissao-negada');
  await rejeita(() => c.memoria.aprovarVersao({ uid: 'd1' }, m.ref, 1), 'permissao-negada');
});

test('caminhos não aceitam segmentos perigosos', () => {
  assert.throws(() => caminhos.empresa('a/b'), (e) => e.codigo === 'invalido');
  assert.throws(() => caminhos.colecaoMemorias('cliente', { empresaId: '..' }), (e) => e.codigo === 'invalido');
  assert.throws(() => caminhos.colecaoMemorias('inexistente', {}), (e) => e.codigo === 'invalido');
  assert.ok(Object.values(caminhos.colecoes).every((c) => c.startsWith('labz_')), 'toda coleção é labz_* (coberta pelas regras)');
});

test('auditor aponta duplicadas, conflitos de chave e propostas pendentes antigas', async () => {
  const c = await montarComEmpresas();
  const alvo = { empresaId: c.A.id };
  await memoriaAprovada(c, nova('cliente', alvo, { categoria: 'preferencia', chave: 'fotos', conteudo: 'Fotos sempre com luz natural e fundo claro' }));
  await memoriaAprovada(c, nova('cliente', alvo, { categoria: 'preferencia', chave: 'fotos', conteudo: 'Fotos sempre com luz natural e fundo claro.' }));
  await c.memoria.criar(c.ator, nova('cliente', alvo, { conteudo: 'Proposta esquecida na fila' }));
  c.relogio.avancarDias(15);
  const r = await c.auditor.auditar('cliente', alvo);
  assert.equal(r.duplicadas.length, 1);
  assert.deepEqual(r.conflitos.map((x) => x.chave), ['fotos']);
  assert.equal(r.pendentesAntigas.length, 1);
  assert.equal(r.vigentes, 2);
});
