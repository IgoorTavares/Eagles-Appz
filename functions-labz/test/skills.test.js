const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { selecionarSkills } = require('../src/skills/registro');

const TEXTO = 'Conteúdo fictício de teste da skill, com mais de vinte caracteres.';

test('seleção: SKILL.md sempre; as outras só com gatilho na tarefa', () => {
  assert.deepEqual(selecionarSkills('04-roteirista', 'organizar a pasta').map((s) => s.arquivo), ['SKILL.md']);
  const sel = selecionarSkills('04-roteirista', 'Roteiro de reels com chamada para o anúncio').map((s) => s.arquivo);
  assert.ok(sel.includes('SCRIPTWRITING.md') && sel.includes('AD-COPY.md') && sel.includes('CTA.md'));
  assert.ok(!sel.includes('LANDING-COPY.md'));
});

test('conteúdo privado e versionado: só a versão aprovada é carregada', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.skills.salvarVersao(c.ator, '04-roteirista', 'INVENTADA.md', TEXTO), 'nao-encontrado');
  await rejeita(() => c.skills.salvarVersao(c.ator, '04-roteirista', 'SKILL.md', 'curto'), 'invalido');
  const { versao } = await c.skills.salvarVersao(c.ator, '04-roteirista', 'SKILL.md', TEXTO + ' v1');
  let r = await c.skills.carregarParaTarefa('04-roteirista', 'legenda');
  assert.deepEqual(r.carregadas, [], 'pendente não carrega');
  assert.ok(r.faltando.includes('SKILL.md'));
  await c.skills.aprovarVersao(c.ator, '04-roteirista', 'SKILL.md', versao);
  await c.skills.salvarVersao(c.ator, '04-roteirista', 'SKILL.md', TEXTO + ' v2');
  r = await c.skills.carregarParaTarefa('04-roteirista', 'legenda');
  assert.equal(r.carregadas[0].conteudo, TEXTO + ' v1', 'a v2 ainda está pendente');
  await c.skills.aprovarVersao(c.ator, '04-roteirista', 'SKILL.md', 2);
  assert.equal((await c.skills.carregarParaTarefa('04-roteirista', 'x')).carregadas[0].conteudo, TEXTO + ' v2');
  await c.skills.voltarVersao(c.ator, '04-roteirista', 'SKILL.md', 1);
  assert.equal((await c.skills.carregarParaTarefa('04-roteirista', 'x')).carregadas[0].conteudo, TEXTO + ' v1');
  assert.ok(c.banco._caminhos().some((p) => p.startsWith('labz_skills/04-roteirista__SKILL/versoes/')));
});

test('a skill aprovada entra no bloco de especialidade do contexto', async () => {
  const c = await montarComEmpresas();
  await c.skills.salvarVersao(c.ator, '04-roteirista', 'SKILL.md', 'INSTRUCAO-PRIVADA-ROTEIRISTA ' + TEXTO);
  await c.skills.aprovarVersao(c.ator, '04-roteirista', 'SKILL.md', 1);
  const ctx = await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.A.id, briefing: 'legenda' });
  const esp = ctx.blocos.find((b) => b.tipo === 'especialidade');
  assert.ok(esp.itens.some((i) => i.origem === 'skill' && i.texto.includes('INSTRUCAO-PRIVADA-ROTEIRISTA')));
  assert.ok(ctx.fontes.some((f) => f.origem === 'skill' && f.versao === 1));
  const outro = await c.contexto.montar({ agenteId: '02-designer', empresaId: c.A.id, briefing: 'legenda' });
  assert.ok(!JSON.stringify(outro).includes('INSTRUCAO-PRIVADA-ROTEIRISTA'), 'skill de um agente não vaza para outro');
});
