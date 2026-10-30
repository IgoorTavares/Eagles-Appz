// Skills: o CONTEÚDO é privado e versionado no banco (labz_skills/{id} e
// labz_versoes/{n}). O repositório só sabe quais skills cada agente tem e quando
// carregá-las (contrato do agente). Só a versão aprovada é carregada.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { erro } = require('../nucleo/erros');
const { relogioPadrao } = require('../nucleo/ids');
const { criarVersionamento } = require('../nucleo/versionamento');
const { obterAgente } = require('../agentes/catalogo');
const { normalizar } = require('../memoria/correcoes');

const MAX_SKILL = 60000;
const idDaSkill = (agenteId, arquivo) => `${agenteId}__${arquivo.replace(/\.md$/, '')}`;

function refDaSkill(agenteId, arquivo) {
  const agente = obterAgente(agenteId);
  if (!agente) throw erro('nao-encontrado', 'Agente desconhecido');
  const s = agente.skills.find((x) => x.arquivo === arquivo);
  if (!s) throw erro('nao-encontrado', `A skill ${arquivo} não pertence ao agente ${agente.nome}`);
  return { agente, skill: s, id: idDaSkill(agenteId, arquivo) };
}

// Quais skills entram numa tarefa: as obrigatórias + as que têm gatilho no texto.
function selecionarSkills(agenteId, textoTarefa) {
  const agente = obterAgente(agenteId);
  if (!agente) throw erro('nao-encontrado', 'Agente desconhecido');
  const t = ` ${normalizar(textoTarefa)} `;
  return agente.skills.filter((s) => s.obrigatoria || s.gatilhos.some((g) => t.includes(` ${normalizar(g)} `) || t.includes(` ${normalizar(g)}`)));
}

// deps: { banco, auditoria, relogio? }
function criarRegistroSkills(deps) {
  const { banco, auditoria } = deps;
  const relogio = deps.relogio || relogioPadrao;
  const ver = criarVersionamento({ relogio, camposVigentes: ['conteudo'] });

  return {
    selecionarSkills,

    async salvarVersao(ator, agenteId, arquivo, conteudo) {
      exigirAtor(ator);
      const { id } = refDaSkill(agenteId, arquivo);
      if (typeof conteudo !== 'string' || conteudo.trim().length < 20 || conteudo.length > MAX_SKILL) throw erro('invalido', `Conteúdo da skill deve ter entre 20 e ${MAX_SKILL} caracteres`);
      const base = caminhos.skill(id);
      let n;
      await banco.transacao(async (t) => {
        if (!(await t.obter(base))) await t.gravar(base, { agenteId, arquivo, status: 'pendente', versaoVigente: null, ultimaVersao: 0, vigente: null, criadoEm: relogio() });
        n = await ver.novaVersao(t, base, { conteudo, origem: { tipo: 'manual' } }, { ator });
      });
      await auditoria.registrar('skill.versao_criada', ator, base, { versao: n });
      return { id, versao: n };
    },

    async aprovarVersao(ator, agenteId, arquivo, n) {
      exigirAtor(ator);
      const { id } = refDaSkill(agenteId, arquivo);
      await banco.transacao(async (t) => { await ver.aprovar(t, caminhos.skill(id), n, ator); });
      await auditoria.registrar('skill.versao_aprovada', ator, caminhos.skill(id), { versao: n });
    },

    async voltarVersao(ator, agenteId, arquivo, n) {
      exigirAtor(ator);
      const { id } = refDaSkill(agenteId, arquivo);
      let nova;
      await banco.transacao(async (t) => { nova = await ver.rollback(t, caminhos.skill(id), n, ator, ['conteudo']); });
      await auditoria.registrar('skill.rollback', ator, caminhos.skill(id), { deVersao: n, novaVersao: nova });
      return nova;
    },

    // Conteúdo aprovado das skills selecionadas; o que ainda não foi escrito
    // ou aprovado aparece em "faltando" (nunca é inventado).
    async carregarParaTarefa(agenteId, textoTarefa) {
      const selecionadas = selecionarSkills(agenteId, textoTarefa);
      const carregadas = [];
      const faltando = [];
      for (const s of selecionadas) {
        const doc = await banco.obter(caminhos.skill(idDaSkill(agenteId, s.arquivo)));
        if (doc && doc.status === 'ativa' && doc.vigente) carregadas.push({ arquivo: s.arquivo, versao: doc.vigente.versao, conteudo: doc.vigente.conteudo });
        else faltando.push(s.arquivo);
      }
      return { carregadas, faltando };
    },
  };
}

module.exports = { criarRegistroSkills, selecionarSkills, idDaSkill };
