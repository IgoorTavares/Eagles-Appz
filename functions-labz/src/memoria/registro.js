// Memory Registry: cria, versiona, aprova, volta versões e arquiva memórias
// dos 5 escopos. Regras:
//  - escopos permanentes nascem PENDENTES e só valem depois que o Super Admin aprova;
//  - memória de tarefa vale na hora (é o histórico daquela produção) e expira;
//  - desempenho só é aprovado com evidências;
//  - memória de empresa arquivada não recebe nada novo;
//  - cada operação gera um evento de auditoria.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { garantir } = require('../nucleo/validador');
const { erro } = require('../nucleo/erros');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { criarVersionamento } = require('../nucleo/versionamento');
const { ESCOPO_INFO, ESQUEMA_NOVA_MEMORIA, alvoDoEscopo, memoriaVigente } = require('../contratos/memoria');
const { obterAgente } = require('../agentes/catalogo');

const CAMPOS_CONTEUDO = ['titulo', 'conteudo', 'tags', 'evidencias'];
const DIAS_TAREFA = 30;

// alvoDoEscopo (escopo e isolamento) mora no contrato (contratos/memoria.js).

// deps: { banco, auditoria, empresas (serviço), relogio? }
function criarRegistroMemoria(deps) {
  const { banco, auditoria, empresas } = deps;
  const relogio = deps.relogio || relogioPadrao;
  const ver = criarVersionamento({ relogio, camposVigentes: CAMPOS_CONTEUDO });

  async function conferirAlvo(escopo, alvo) {
    if (escopo === 'agente' && !obterAgente(alvo.agenteId)) throw erro('nao-encontrado', 'Agente desconhecido');
    if (escopo === 'cliente' || escopo === 'desempenho') await empresas.garantirAtiva(alvo.empresaId);
    if (escopo === 'tarefa') {
      const t = await banco.obter(caminhos.tarefa(alvo.tarefaId));
      if (!t) throw erro('nao-encontrado', 'Tarefa não encontrada');
      if (t.empresaId) await empresas.garantirAtiva(t.empresaId);
    }
  }

  function conferirConteudo(escopo, dados) {
    const info = ESCOPO_INFO[escopo];
    if (!info.categorias.includes(dados.categoria)) throw erro('invalido', `categoria "${dados.categoria}" não existe no escopo ${escopo}`);
    if (info.exigeEvidencias && !(dados.evidencias && dados.evidencias.length)) throw erro('invalido', 'Memória de desempenho precisa de evidências (fonte, métrica, valor e período)');
  }

  const base = (ref) => caminhos.memoria(ref.escopo, alvoDoEscopo(ref.escopo, ref.alvo), ref.memoriaId);

  async function ler(ref) {
    const b = await banco.obter(base(ref));
    if (!b) throw erro('nao-encontrado', 'Memória não encontrada');
    return Object.assign({ id: ref.memoriaId }, b);
  }

  // Se veio de um agente, ele precisa ter permissão de propor nesse escopo.
  function conferirAgenteProponente(agenteId, escopo) {
    if (!agenteId) return;
    const a = obterAgente(agenteId);
    if (!a) throw erro('nao-encontrado', 'Agente desconhecido');
    if (escopo !== 'tarefa' && !a.permissoes.memoriaPropor.includes(escopo)) throw erro('permissao-negada', `O agente ${a.nome} não propõe memória no escopo ${escopo}`);
  }

  return {
    alvoDoEscopo,

    // Cria uma memória nova (versão 1). Permanentes ficam pendentes.
    async criar(ator, dados, opcoes = {}) {
      exigirAtor(ator);
      garantir(ESQUEMA_NOVA_MEMORIA, dados, 'Memória');
      const alvo = alvoDoEscopo(dados.escopo, dados.alvo);
      conferirConteudo(dados.escopo, dados);
      conferirAgenteProponente(opcoes.agenteId, dados.escopo);
      await conferirAlvo(dados.escopo, alvo);
      const info = ESCOPO_INFO[dados.escopo];
      const memoriaId = novoId('mem');
      const ref = { escopo: dados.escopo, alvo, memoriaId };
      const agora = relogio();
      const doc = {
        escopo: dados.escopo, alvo, categoria: dados.categoria, chave: dados.chave || null,
        status: 'pendente', versaoVigente: null, ultimaVersao: 0, vigente: null,
        criadoEm: agora, criadoPor: ator.uid, propostoPorAgente: opcoes.agenteId || null, atualizadoEm: agora,
      };
      if (dados.escopo === 'tarefa') doc.expiraEm = dados.expiraEm || new Date(Date.parse(agora) + DIAS_TAREFA * 864e5).toISOString();
      const versao = { origem: dados.origem };
      CAMPOS_CONTEUDO.forEach((k) => { if (dados[k] !== undefined) versao[k] = dados[k]; });
      if (!versao.tags) versao.tags = [];
      await banco.transacao(async (t) => {
        await t.gravar(base(ref), doc);
        await ver.novaVersao(t, base(ref), versao, { ator, aprovarAgora: !info.aprovacao });
      });
      await auditoria.registrar('memoria.criada', ator, base(ref), { escopo: dados.escopo, categoria: dados.categoria, pendente: info.aprovacao, agente: opcoes.agenteId || null });
      return Object.assign({ ref }, await ler(ref));
    },

    // Nova versão do conteúdo de uma memória existente.
    async novaVersao(ator, ref, dados, opcoes = {}) {
      exigirAtor(ator);
      const atual = await ler(ref);
      if (atual.status === 'arquivada') throw erro('precondicao', 'Memória arquivada: reative antes de alterar');
      const completo = Object.assign({ escopo: ref.escopo, alvo: ref.alvo, categoria: atual.categoria, titulo: (atual.vigente && atual.vigente.titulo) || 'Sem título' }, dados);
      garantir(ESQUEMA_NOVA_MEMORIA, completo, 'Memória');
      conferirConteudo(ref.escopo, completo);
      conferirAgenteProponente(opcoes.agenteId, ref.escopo);
      await conferirAlvo(ref.escopo, alvoDoEscopo(ref.escopo, ref.alvo));
      const versao = { origem: completo.origem, tags: completo.tags || [] };
      CAMPOS_CONTEUDO.forEach((k) => { if (completo[k] !== undefined) versao[k] = completo[k]; });
      let n;
      await banco.transacao(async (t) => { n = await ver.novaVersao(t, base(ref), versao, { ator, aprovarAgora: !ESCOPO_INFO[ref.escopo].aprovacao }); });
      await auditoria.registrar('memoria.versao_criada', ator, base(ref), { versao: n });
      return n;
    },

    async aprovarVersao(ator, ref, n) {
      exigirAtor(ator);
      await banco.transacao(async (t) => {
        await ver.aprovar(t, base(ref), n, ator, (v) => {
          if (ESCOPO_INFO[ref.escopo].exigeEvidencias && !(v.evidencias && v.evidencias.length)) throw erro('invalido', 'Sem evidências não há aprovação de desempenho');
        });
      });
      await auditoria.registrar('memoria.versao_aprovada', ator, base(ref), { versao: n });
      return ler(ref);
    },

    async rejeitarVersao(ator, ref, n, motivo) {
      exigirAtor(ator);
      await banco.transacao(async (t) => { await ver.rejeitar(t, base(ref), n, ator, motivo); });
      await auditoria.registrar('memoria.versao_rejeitada', ator, base(ref), { versao: n, motivo: String(motivo || '').slice(0, 300) });
      return ler(ref);
    },

    async voltarVersao(ator, ref, n) {
      exigirAtor(ator);
      let nova;
      await banco.transacao(async (t) => { nova = await ver.rollback(t, base(ref), n, ator, CAMPOS_CONTEUDO); });
      await auditoria.registrar('memoria.rollback', ator, base(ref), { deVersao: n, novaVersao: nova });
      return ler(ref);
    },

    async arquivar(ator, ref, motivo) {
      exigirAtor(ator);
      await ler(ref);
      await banco.atualizar(base(ref), { status: 'arquivada', arquivadaEm: relogio(), atualizadoEm: relogio() });
      await auditoria.registrar('memoria.arquivada', ator, base(ref), { motivo: String(motivo || '').slice(0, 300) });
      return ler(ref);
    },

    async reativar(ator, ref) {
      exigirAtor(ator);
      const m = await ler(ref);
      await banco.atualizar(base(ref), { status: m.versaoVigente ? 'ativa' : 'pendente', atualizadoEm: relogio() });
      await auditoria.registrar('memoria.reativada', ator, base(ref));
      return ler(ref);
    },

    obter: ler,
    versoes: (ref) => ver.listarVersoes(banco, base(ref)),

    async listar(escopo, alvo, filtro) {
      return banco.listar(caminhos.colecaoMemorias(escopo, alvoDoEscopo(escopo, alvo)), filtro);
    },

    // Só o que vale como regra: ativa, com versão aprovada e (tarefa) não expirada.
    async vigentes(escopo, alvo) {
      const agora = relogio();
      const lista = await banco.listar(caminhos.colecaoMemorias(escopo, alvoDoEscopo(escopo, alvo)));
      return lista.filter((m) => memoriaVigente(m, agora));
    },
  };
}

module.exports = { criarRegistroMemoria, alvoDoEscopo, CAMPOS_CONTEUDO };
