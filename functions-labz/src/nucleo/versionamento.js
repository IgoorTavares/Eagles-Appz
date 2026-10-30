// Versionamento comum a memórias e skills.
// Documento base: { status, versaoVigente, ultimaVersao, vigente: {...cópia da versão aprovada} }
// Versões em {base}/versoes/{n}: { n, status, ...conteúdo, origem, criadoEm, criadoPor, aprovacao, baseVersao }
//   rascunho → pendente (enviar)
//   pendente → aprovada (vira a vigente; a anterior vira "substituida")
//   pendente → rejeitada | precisa-revisao (com o motivo; a correção é uma versão NOVA)
//   rollback(n): cria uma versão NOVA com o conteúdo de n, já aprovada
// As transições seguem TRANSICOES_VERSAO (contratos/memoria.js).
// Nada é apagado: o histórico completo fica nas versões.
// Concorrência: cada versão guarda a vigente de quando foi criada
// (baseVersao). Se outra versão foi aprovada depois disso, aprovar esta
// recusa com "conflito" (nada de sobrescrita silenciosa com conteúdo velho).
const { erro } = require('./erros');
const { transicaoVersaoPermitida } = require('../contratos/memoria');

const versaoPath = (base, n) => `${base}/versoes/${n}`;
const motivoCurto = (m) => String(m || '').slice(0, 500);

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

  async function lerVersao(t, base, n) {
    const v = await t.obter(versaoPath(base, n));
    if (!v) throw erro('nao-encontrado', 'Versão não encontrada');
    return v;
  }

  function exigirTransicao(v, para, acao) {
    if (!transicaoVersaoPermitida(v.status, para)) throw erro('precondicao', `Não dá para ${acao} uma versão ${v.status}`);
  }

  async function tornarVigente(t, base, b, v, ator) {
    if (b.versaoVigente) await t.atualizar(versaoPath(base, b.versaoVigente), { status: 'substituida', substituidaEm: relogio() });
    await t.atualizar(base, { status: b.status === 'arquivada' ? 'arquivada' : 'ativa', versaoVigente: v.n, vigente: copiaVigente(v), atualizadoEm: relogio(), atualizadoPor: ator.uid });
  }

  return {
    // Cria a próxima versão. aprovarAgora: só para escopos que não exigem
    // aprovação e para rollback. rascunho: nasce em rascunho (precisa ser enviada).
    async novaVersao(t, base, dados, { ator, aprovarAgora = false, rascunho = false }) {
      const b = await lerBase(t, base);
      const n = (b.ultimaVersao || 0) + 1;
      const agora = relogio();
      const status = aprovarAgora ? 'aprovada' : rascunho ? 'rascunho' : 'pendente';
      const v = Object.assign({}, dados, { n, status, baseVersao: b.versaoVigente || null, criadoEm: agora, criadoPor: ator.uid, aprovacao: aprovarAgora ? { por: ator.uid, em: agora } : null });
      await t.gravar(versaoPath(base, n), v);
      await t.atualizar(base, { ultimaVersao: n, atualizadoEm: agora });
      if (aprovarAgora) await tornarVigente(t, base, Object.assign({}, b, { ultimaVersao: n }), v, ator);
      return n;
    },

    async enviar(t, base, n, ator) {
      await lerBase(t, base);
      const v = await lerVersao(t, base, n);
      exigirTransicao(v, 'pendente', 'enviar para aprovação');
      await t.atualizar(versaoPath(base, n), { status: 'pendente', envio: { por: ator.uid, em: relogio() } });
    },

    // opcoes: { motivo, extras (campos a gravar junto na versão) }
    // conferir(v, b, t): async; pode recusar ou devolver campos extras.
    async aprovar(t, base, n, ator, conferir, opcoes = {}) {
      const b = await lerBase(t, base);
      const v = await lerVersao(t, base, n);
      exigirTransicao(v, 'aprovada', 'aprovar');
      // registros antigos (sem baseVersao) não têm como conferir
      if (v.baseVersao !== undefined && (b.versaoVigente || null) !== v.baseVersao) {
        throw erro('conflito', `Esta versão foi criada sobre a versão ${v.baseVersao || 'nenhuma'}, mas a vigente agora é a ${b.versaoVigente}. Crie uma nova versão a partir da vigente.`);
      }
      // conferir pode ler mais coisas na MESMA transação e devolver campos a gravar
      const extrasConferir = conferir ? await conferir(v, b, t) : null;
      const aprovacao = { por: ator.uid, em: relogio() };
      if (opcoes.motivo) aprovacao.motivo = motivoCurto(opcoes.motivo);
      await t.atualizar(versaoPath(base, n), Object.assign({ status: 'aprovada', aprovacao }, opcoes.extras || {}, extrasConferir || {}));
      await tornarVigente(t, base, b, Object.assign({}, v, { aprovacao }), ator);
    },

    async rejeitar(t, base, n, ator, motivo) {
      const v = await lerVersao(t, base, n);
      exigirTransicao(v, 'rejeitada', 'rejeitar');
      await t.atualizar(versaoPath(base, n), { status: 'rejeitada', rejeicao: { por: ator.uid, em: relogio(), motivo: motivoCurto(motivo) } });
    },

    async pedirRevisao(t, base, n, ator, motivo) {
      const v = await lerVersao(t, base, n);
      exigirTransicao(v, 'precisa-revisao', 'pedir revisão de');
      await t.atualizar(versaoPath(base, n), { status: 'precisa-revisao', revisao: { por: ator.uid, em: relogio(), motivo: motivoCurto(motivo) } });
    },

    async rollback(t, base, n, ator, camposConteudo) {
      const b = await lerBase(t, base);
      const v = await lerVersao(t, base, n);
      if (!['aprovada', 'substituida'].includes(v.status)) throw erro('precondicao', 'Só dá para voltar a uma versão que já foi aprovada');
      if (b.versaoVigente === n) throw erro('precondicao', 'Essa já é a versão vigente');
      const dados = {};
      camposConteudo.forEach((k) => { if (v[k] !== undefined) dados[k] = v[k]; });
      dados.origem = { tipo: 'rollback', versaoDe: n };
      return this.novaVersao(t, base, dados, { ator, aprovarAgora: true });
    },

    lerVersao,

    async listarVersoes(banco, base) {
      return (await banco.listar(`${base}/versoes`)).sort((a, b) => a.n - b.n);
    },
  };
}

module.exports = { criarVersionamento, versaoPath };
