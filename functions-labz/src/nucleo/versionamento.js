// Versionamento comum a memórias e skills.
// Documento base: { status, versaoVigente, ultimaVersao, vigente: {...cópia da versão aprovada} }
// Versões em {base}/versoes/{n}: { n, status, ...conteúdo, origem, criadoEm, criadoPor, aprovacao }
//   pendente → aprovada (vira a vigente; a anterior vira "substituida")
//   pendente → rejeitada
//   rollback(n): cria uma versão NOVA com o conteúdo de n, já aprovada
// Nada é apagado: o histórico completo fica nas versões.
const { erro } = require('./erros');

const versaoPath = (base, n) => `${base}/versoes/${n}`;

function criarVersionamento({ relogio, camposVigentes }) {
  const copiaVigente = (v) => {
    const out = { versao: v.n };
    camposVigentes.forEach((k) => { if (v[k] !== undefined) out[k] = v[k]; });
    return out;
  };

  async function lerBase(t, base) {
    const b = await t.obter(base);
    if (!b) throw erro('nao-encontrado', 'Registro não encontrado');
    return b;
  }

  async function tornarVigente(t, base, b, v, ator) {
    if (b.versaoVigente) await t.atualizar(versaoPath(base, b.versaoVigente), { status: 'substituida', substituidaEm: relogio() });
    await t.atualizar(base, { status: b.status === 'arquivada' ? 'arquivada' : 'ativa', versaoVigente: v.n, vigente: copiaVigente(v), atualizadoEm: relogio(), atualizadoPor: ator.uid });
  }

  return {
    // Cria a próxima versão. aprovarAgora: só para escopos que não exigem aprovação e para rollback.
    async novaVersao(t, base, dados, { ator, aprovarAgora = false }) {
      const b = await lerBase(t, base);
      const n = (b.ultimaVersao || 0) + 1;
      const agora = relogio();
      const v = Object.assign({}, dados, { n, status: aprovarAgora ? 'aprovada' : 'pendente', criadoEm: agora, criadoPor: ator.uid, aprovacao: aprovarAgora ? { por: ator.uid, em: agora } : null });
      await t.gravar(versaoPath(base, n), v);
      await t.atualizar(base, { ultimaVersao: n, atualizadoEm: agora });
      if (aprovarAgora) await tornarVigente(t, base, Object.assign({}, b, { ultimaVersao: n }), v, ator);
      return n;
    },

    async aprovar(t, base, n, ator, conferir) {
      const b = await lerBase(t, base);
      const v = await t.obter(versaoPath(base, n));
      if (!v) throw erro('nao-encontrado', 'Versão não encontrada');
      if (v.status !== 'pendente') throw erro('precondicao', `Só uma versão pendente pode ser aprovada (está ${v.status})`);
      if (conferir) conferir(v, b);
      const aprovacao = { por: ator.uid, em: relogio() };
      await t.atualizar(versaoPath(base, n), { status: 'aprovada', aprovacao });
      await tornarVigente(t, base, b, Object.assign({}, v, { aprovacao }), ator);
    },

    async rejeitar(t, base, n, ator, motivo) {
      const v = await t.obter(versaoPath(base, n));
      if (!v) throw erro('nao-encontrado', 'Versão não encontrada');
      if (v.status !== 'pendente') throw erro('precondicao', `Só uma versão pendente pode ser rejeitada (está ${v.status})`);
      await t.atualizar(versaoPath(base, n), { status: 'rejeitada', rejeicao: { por: ator.uid, em: relogio(), motivo: String(motivo || '').slice(0, 500) } });
    },

    async rollback(t, base, n, ator, camposConteudo) {
      const b = await lerBase(t, base);
      const v = await t.obter(versaoPath(base, n));
      if (!v) throw erro('nao-encontrado', 'Versão não encontrada');
      if (!['aprovada', 'substituida'].includes(v.status)) throw erro('precondicao', 'Só dá para voltar a uma versão que já foi aprovada');
      if (b.versaoVigente === n) throw erro('precondicao', 'Essa já é a versão vigente');
      const dados = {};
      camposConteudo.forEach((k) => { if (v[k] !== undefined) dados[k] = v[k]; });
      dados.origem = { tipo: 'rollback', versaoDe: n };
      return this.novaVersao(t, base, dados, { ator, aprovarAgora: true });
    },

    async listarVersoes(banco, base) {
      return (await banco.listar(`${base}/versoes`)).sort((a, b) => a.n - b.n);
    },
  };
}

module.exports = { criarVersionamento, versaoPath };
