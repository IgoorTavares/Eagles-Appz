// Cadastro de empresas da LABZ AI. Toda operação exige o ator do Super Admin
// (exigirAtor) e gera um evento de auditoria.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { garantir, validar } = require('../nucleo/validador');
const { erro } = require('../nucleo/erros');
const { novoId, slugDe, relogioPadrao } = require('../nucleo/ids');
const { ESQUEMA_NOVA_EMPRESA, ESQUEMA_ALTERAR_EMPRESA, ESQUEMA_VINCULO } = require('../contratos/empresa');

// Chave única de um vínculo (uma empresa do sistema ou um cliente do CRM só
// pode estar ligado a UMA empresa da LABZ AI).
function chaveVinculo(v) {
  return v.tipo === 'tenant' ? `tenant_${v.tenantId}` : `crm_${v.tenantId}__${v.clienteId}`;
}

// deps: { banco, auditoria, relogio? }
function criarServicoEmpresas(deps) {
  const { banco, auditoria } = deps;
  const relogio = deps.relogio || relogioPadrao;

  // Confere no próprio sistema (somente leitura) se o alvo do vínculo existe.
  async function conferirVinculo(v) {
    const errs = validar(ESQUEMA_VINCULO, v);
    if (errs.length) throw erro('invalido', 'Vínculo inválido', errs);
    if (v.tipo === 'tenant') {
      if (v.clienteId !== undefined) throw erro('invalido', 'Vínculo com empresa do sistema não leva cliente');
      if (!(await banco.obter(`tenants/${v.tenantId}`))) throw erro('nao-encontrado', 'Empresa do sistema não encontrada');
    } else {
      if (!v.clienteId) throw erro('invalido', 'Vínculo com cliente do CRM precisa do cliente');
      if (!(await banco.obter(`tenants/${v.tenantId}/crm_clientes/${v.clienteId}`))) throw erro('nao-encontrado', 'Cliente do CRM não encontrado');
    }
  }

  async function obterOuFalhar(empresaId) {
    const e = await banco.obter(caminhos.empresa(empresaId));
    if (!e) throw erro('nao-encontrado', 'Empresa da LABZ AI não encontrada');
    return Object.assign({ id: empresaId }, e);
  }

  async function slugLivre(slug, exceto) {
    const iguais = await banco.listar(caminhos.colecoes.empresas, (x) => x.slug === slug && x.id !== exceto);
    return iguais.length === 0;
  }

  return {
    async criar(ator, dados) {
      exigirAtor(ator);
      garantir(ESQUEMA_NOVA_EMPRESA, dados, 'Empresa');
      const slug = slugDe(dados.nome);
      if (!slug) throw erro('invalido', 'Nome da empresa inválido');
      if (dados.vinculo) await conferirVinculo(dados.vinculo);
      const id = novoId('emp');
      const agora = relogio();
      const empresa = {
        nome: dados.nome.trim(), slug, status: 'ativa', observacoes: dados.observacoes || '',
        vinculo: dados.vinculo || null,
        criadoEm: agora, criadoPor: ator.uid, atualizadoEm: agora, atualizadoPor: ator.uid,
      };
      await banco.transacao(async (t) => {
        if (!(await slugLivre(slug))) throw erro('conflito', 'Já existe uma empresa com esse nome');
        if (empresa.vinculo) {
          const cv = caminhos.vinculo(chaveVinculo(empresa.vinculo));
          const dono = await t.obter(cv);
          if (dono && dono.empresaId) throw erro('conflito', 'Esse vínculo já pertence a outra empresa da LABZ AI');
          await t.gravar(cv, { empresaId: id, em: agora });
        }
        await t.gravar(caminhos.empresa(id), empresa);
      });
      await auditoria.registrar('empresa.criada', ator, caminhos.empresa(id), { nome: empresa.nome, vinculo: empresa.vinculo });
      return Object.assign({ id }, empresa);
    },

    async alterar(ator, empresaId, campos) {
      exigirAtor(ator);
      garantir(ESQUEMA_ALTERAR_EMPRESA, campos, 'Alteração da empresa');
      const atual = await obterOuFalhar(empresaId);
      const mud = { atualizadoEm: relogio(), atualizadoPor: ator.uid };
      if (campos.nome !== undefined) {
        mud.nome = campos.nome.trim();
        mud.slug = slugDe(campos.nome);
        if (!(await slugLivre(mud.slug, empresaId))) throw erro('conflito', 'Já existe uma empresa com esse nome');
      }
      if (campos.observacoes !== undefined) mud.observacoes = campos.observacoes;
      await banco.atualizar(caminhos.empresa(empresaId), mud);
      await auditoria.registrar('empresa.alterada', ator, caminhos.empresa(empresaId), { campos: Object.keys(campos), nomeAntes: atual.nome });
      return obterOuFalhar(empresaId);
    },

    // vinculo = null remove o vínculo
    async vincular(ator, empresaId, vinculo) {
      exigirAtor(ator);
      const atual = await obterOuFalhar(empresaId);
      if (vinculo) await conferirVinculo(vinculo);
      await banco.transacao(async (t) => {
        if (vinculo) {
          const cv = caminhos.vinculo(chaveVinculo(vinculo));
          const dono = await t.obter(cv);
          if (dono && dono.empresaId && dono.empresaId !== empresaId) throw erro('conflito', 'Esse vínculo já pertence a outra empresa da LABZ AI');
        }
        if (atual.vinculo && (!vinculo || chaveVinculo(atual.vinculo) !== chaveVinculo(vinculo))) {
          await t.gravar(caminhos.vinculo(chaveVinculo(atual.vinculo)), { empresaId: null, liberadoEm: relogio() });
        }
        if (vinculo) await t.gravar(caminhos.vinculo(chaveVinculo(vinculo)), { empresaId, em: relogio() });
        await t.atualizar(caminhos.empresa(empresaId), { vinculo: vinculo || null, atualizadoEm: relogio(), atualizadoPor: ator.uid });
      });
      await auditoria.registrar('empresa.vinculo_alterado', ator, caminhos.empresa(empresaId), { antes: atual.vinculo, depois: vinculo || null });
      return obterOuFalhar(empresaId);
    },

    async arquivar(ator, empresaId, motivo) {
      exigirAtor(ator);
      const atual = await obterOuFalhar(empresaId);
      if (atual.status === 'arquivada') return atual;
      await banco.atualizar(caminhos.empresa(empresaId), { status: 'arquivada', arquivadaEm: relogio(), atualizadoEm: relogio(), atualizadoPor: ator.uid });
      await auditoria.registrar('empresa.arquivada', ator, caminhos.empresa(empresaId), { motivo: String(motivo || '').slice(0, 300) });
      return obterOuFalhar(empresaId);
    },

    async reativar(ator, empresaId) {
      exigirAtor(ator);
      const atual = await obterOuFalhar(empresaId);
      if (atual.status === 'ativa') return atual;
      await banco.atualizar(caminhos.empresa(empresaId), { status: 'ativa', atualizadoEm: relogio(), atualizadoPor: ator.uid });
      await auditoria.registrar('empresa.reativada', ator, caminhos.empresa(empresaId));
      return obterOuFalhar(empresaId);
    },

    async obter(ator, empresaId) { exigirAtor(ator); return obterOuFalhar(empresaId); },

    async listar(ator, filtro = {}) {
      exigirAtor(ator);
      return banco.listar(caminhos.colecoes.empresas, (x) => !filtro.status || x.status === filtro.status);
    },

    // Uso interno (memória): a empresa existe e está ativa?
    async garantirAtiva(empresaId) {
      const e = await obterOuFalhar(empresaId);
      if (e.status !== 'ativa') throw erro('precondicao', 'Empresa arquivada: não recebe memórias novas');
      return e;
    },
    obterOuFalhar,
  };
}

module.exports = { criarServicoEmpresas, chaveVinculo };
