// Fase 3E: testes da auditoria final (lacunas que não tinham prova). Só dados
// fictícios; nenhum modelo, nenhum serviço externo.
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, memoriaAprovada, rejeita, relogioDeTeste } = require('./ajuda');
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { criarLabz } = require('../src/servicos');
const { criarApi, ACOES } = require('../src/api/labz-api');
const { ATOR_SISTEMA } = require('../src/auth/super-admin');

async function api() {
  const banco = criarBancoMemoria();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1' });
  await banco.gravar('usuarios/labz-sistema', { role: 'SuperAdmin' }); // mesmo com o uid do sistema no banco
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const servicos = criarLabz({ banco, relogio: relogioDeTeste() });
  const chamar = (uid, acao, dados) => criarApi({ servicos, banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' })({ auth: uid ? { uid, token: {} } : undefined, data: { acao, dados } });
  return { banco, servicos, chamar };
}

test('API: TODAS as ações recusam sem login, Diretor e o uid do sistema, antes de executar qualquer coisa', async () => {
  const c = await api();
  const antes = (await c.banco.listar('labz_empresas')).length;
  for (const acao of Object.keys(ACOES)) {
    await rejeita(() => c.chamar(null, acao, {}), 'nao-autenticado');
    await rejeita(() => c.chamar('d1', acao, {}), 'permissao-negada');
    await rejeita(() => c.chamar('labz-sistema', acao, {}), 'permissao-negada');
  }
  assert.strictEqual((await c.banco.listar('labz_empresas')).length, antes, 'nada foi criado');
  // o ator do sistema não pode ser produzido pela API: o objeto só existe no servidor
  assert.ok(Object.isFrozen(ATOR_SISTEMA) && ATOR_SISTEMA.tipo === 'sistema');
  const negadas = (await c.banco.listar('labz_eventos')).filter((e) => e.tipo === 'auth.acesso_negado');
  assert.strictEqual(negadas.length, Object.keys(ACOES).length * 3, 'cada recusa fica na auditoria');
});

test('auditoria e execuções não guardam conteúdo privado em nenhum ponto do fluxo (3A–3D)', async () => {
  const c = await montarComEmpresas();
  const S = 'SEGREDO-AUDITORIA-3E';
  const m = await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', chave: 'cores', titulo: `Título ${S}`, conteudo: `Conteúdo ${S} azul`, origem: { tipo: 'manual' } });
  await c.memoria.novaVersao(c.ator, m.ref, { conteudo: `Conteúdo ${S} verde`, origem: { tipo: 'manual' } });
  const conf = await c.memoria.criar(c.ator, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', chave: 'cores', titulo: 'Outra', conteudo: `Outra ${S} roxa`, origem: { tipo: 'manual' } });
  await rejeita(() => c.memoria.aprovarVersao(c.ator, conf.ref, 1), 'conflito');
  await c.recuperador.buscar(c.ator, { escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'textual', texto: `${S} azul` });
  await c.memoria.exportarMarkdown(c.ator, m.ref);
  const exe = await c.execucoes.criar(c.ator, { empresaId: c.A.id, objetivo: 'Objetivo da execução', modo: 'orquestrado' });
  await c.preparacao.planejarContextos(c.ator, exe.id, [{ agenteId: '02-designer', briefing: `briefing ${S}` }]);
  const porta = await c.portaMemoria.abrir('02-designer', exe.id);
  await porta.consultar(`${S} azul`);
  await porta.propor({ escopo: 'cliente', base: 'tarefa', categoria: 'preferencia', titulo: 'Proposta', conteudo: `Proposta ${S}` });
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Global', conteudo: `Marca Alfa ${S}`, origem: { tipo: 'manual' } }), 'precondicao');
  const eventos = JSON.stringify(await c.auditoria.listar());
  assert.ok(!eventos.includes(S), 'nenhum evento leva título, conteúdo, briefing ou texto pesquisado');
  const doc = JSON.stringify(await c.execucoes.obter(c.ator, exe.id));
  assert.ok(!doc.includes(S), 'a execução guarda só ids e versões das fontes');
});

test('paginação: memória arquivada entre páginas não quebra o cursor; cursor de outra empresa é recusado', async () => {
  const c = await montarComEmpresas();
  const refs = [];
  for (let i = 0; i < 9; i++) refs.push((await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'referencia', titulo: `Pagina ${i}`, conteudo: `conteudo unico numero${i}x`, origem: { tipo: 'manual' } })).ref);
  const b = await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.B.id }, categoria: 'referencia', titulo: 'Beta', conteudo: 'conteudo beta', origem: { tipo: 'manual' } });
  const q = (extra) => c.recuperador.buscar(c.ator, Object.assign({ escopo: 'cliente', alvo: { empresaId: c.A.id }, modo: 'metadados', limite: 4 }, extra));
  const p1 = await q();
  // o último item da página 1 é arquivado antes de pedir a página 2
  await c.memoria.arquivar(c.ator, { escopo: 'cliente', alvo: { empresaId: c.A.id }, memoriaId: p1.proximo }, 'arquivada no meio');
  const p2 = await q({ depoisDe: p1.proximo });
  const p3 = p2.proximo ? await q({ depoisDe: p2.proximo }) : { itens: [] };
  const vistos = [...p1.itens, ...p2.itens, ...p3.itens].map((i) => i.id);
  assert.strictEqual(new Set(vistos).size, vistos.length, 'sem repetição');
  assert.strictEqual(vistos.length, 9, 'as 8 ativas restantes + a que estava na página 1');
  assert.ok(!vistos.includes(b.ref.memoriaId));
  await rejeita(() => q({ depoisDe: b.ref.memoriaId }), 'invalido'); // o id da B não existe na coleção da A
  assert.strictEqual(refs.length, 9);
});

test('o ator do sistema só cria rascunho de agente, mesmo chamando o registro diretamente', async () => {
  const c = await montarComEmpresas();
  const dados = { escopo: 'agente', alvo: { agenteId: '02-designer' }, categoria: 'tecnica', titulo: 'Grid', conteudo: 'grid de 8', origem: { tipo: 'manual' } };
  await rejeita(() => c.memoria.criar(ATOR_SISTEMA, dados), 'permissao-negada');
  await rejeita(() => c.memoria.criar(ATOR_SISTEMA, dados, { agenteId: '04-roteirista' }), 'permissao-negada'); // agente de outro agente
  const m = await c.memoria.criar(ATOR_SISTEMA, dados, { agenteId: '02-designer', rascunho: false });
  assert.deepStrictEqual((await c.memoria.versoes(m.ref)).map((v) => v.status), ['rascunho'], 'rascunho mesmo pedindo o contrário');
  await rejeita(() => c.memoria.novaVersao(ATOR_SISTEMA, m.ref, { conteudo: 'grid de 12', origem: { tipo: 'manual' } }), 'permissao-negada');
  await rejeita(() => c.memoria.reindexar(ATOR_SISTEMA, 'agente', { agenteId: '02-designer' }), 'permissao-negada');
  await rejeita(() => c.memoria.exportarMarkdown(ATOR_SISTEMA, m.ref), 'permissao-negada');
  await rejeita(() => c.recuperador.buscar(ATOR_SISTEMA, { escopo: 'global', alvo: {}, modo: 'metadados' }), 'permissao-negada');
  await rejeita(() => c.memoria.avaliarConflitos(ATOR_SISTEMA, m.ref, 1), 'permissao-negada');
});
