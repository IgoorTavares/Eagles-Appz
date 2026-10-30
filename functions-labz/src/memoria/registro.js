// Memory Registry: cria, versiona, aprova, volta versões e arquiva memórias
// dos 5 escopos. É o ÚNICO lugar que aprova memória (as correções usam ele).
// Regras:
//  - escopos permanentes nascem PENDENTES (ou em RASCUNHO, quando é proposta
//    de agente ou o Super Admin pede) e só valem depois que o Super Admin aprova;
//  - ciclo da versão: rascunho → pendente → aprovada | rejeitada | precisa-revisao
//    (a correção de uma versão em revisão é uma versão nova);
//  - memória de tarefa vale na hora (é o histórico daquela produção) e expira;
//  - desempenho só é enviado/aprovado com evidências;
//  - a origem é conferida (tarefa/correção existem e são da mesma empresa);
//  - memória Global passa pela trava (protecao-global.js);
//  - texto com sinal de instrução escondida só é aprovado com confirmação;
//  - duplicidade/conflito com memória vigente bloqueia a aprovação (e o rollback)
//    até o Super Admin decidir, com uma confirmação presa à situação exata;
//  - memória arquivada não recebe nada novo;
//  - cada operação e cada bloqueio geram um evento de auditoria (sem o conteúdo).
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor, ATOR_SISTEMA } = require('../auth/super-admin');
const { garantir } = require('../nucleo/validador');
const { erro } = require('../nucleo/erros');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { criarVersionamento } = require('../nucleo/versionamento');
const { ESCOPO_INFO, ESQUEMA_NOVA_MEMORIA, alvoDoEscopo, memoriaVigente } = require('../contratos/memoria');
const { obterAgente } = require('../agentes/catalogo');
const { sinaisDeInjecao, analisarNovoTexto, assinaturaConflitos } = require('./verificacoes');
const { criarProtecaoGlobal } = require('./protecao-global');
const { gerarMarkdown } = require('./markdown');
const { camposDeIndice, INDICE_VERSAO } = require('./indice');
const { criarRecuperador } = require('./recuperador');
const { LIMITES_BUSCA } = require('../contratos/recuperacao');

const CAMPOS_CONTEUDO = ['titulo', 'conteudo', 'tags', 'evidencias'];
const DIAS_TAREFA = 30;

// alvoDoEscopo (escopo e isolamento) mora no contrato (contratos/memoria.js).

// deps: { banco, auditoria, empresas (serviço), relogio? }
function criarRegistroMemoria(deps) {
  const { banco, auditoria, empresas } = deps;
  const relogio = deps.relogio || relogioPadrao;
  // o índice de busca é gravado junto com a vigente (mesma transação)
  const ver = criarVersionamento({ relogio, camposVigentes: CAMPOS_CONTEUDO, aoTornarVigente: (b, v) => camposDeIndice(b, v, relogio()) });
  const protecao = criarProtecaoGlobal({ banco });
  const recuperador = deps.recuperador || criarRecuperador({ banco, relogio });

  async function conferirAlvo(escopo, alvo) {
    if (escopo === 'agente' && !obterAgente(alvo.agenteId)) throw erro('nao-encontrado', 'Agente desconhecido');
    if (escopo === 'cliente' || escopo === 'desempenho') await empresas.garantirAtiva(alvo.empresaId);
    if (escopo === 'tarefa') {
      const t = await banco.obter(caminhos.tarefa(alvo.tarefaId));
      if (!t) throw erro('nao-encontrado', 'Tarefa não encontrada');
      if (t.empresaId) await empresas.garantirAtiva(t.empresaId);
    }
  }

  const semEvidencia = (escopo, v) => ESCOPO_INFO[escopo].exigeEvidencias && !(v.evidencias && v.evidencias.length);

  // rascunho: a evidência de desempenho pode chegar depois (é exigida no envio e na aprovação)
  function conferirConteudo(escopo, dados, { rascunho = false } = {}) {
    const info = ESCOPO_INFO[escopo];
    if (!info.categorias.includes(dados.categoria)) throw erro('invalido', `categoria "${dados.categoria}" não existe no escopo ${escopo}`);
    if (!rascunho && semEvidencia(escopo, dados)) throw erro('invalido', 'Memória de desempenho precisa de evidências (fonte, métrica, valor e período)');
  }

  // Proveniência: o que a origem cita precisa existir e ser da mesma empresa/tarefa.
  async function conferirOrigem(escopo, alvo, origem) {
    if (origem.tipo === 'rollback') throw erro('invalido', 'Origem "rollback" só é criada pela operação de voltar versão');
    if (origem.tarefaId) {
      const t = await banco.obter(caminhos.tarefa(origem.tarefaId));
      if (!t) throw erro('nao-encontrado', 'Tarefa de origem não encontrada');
      if (alvo.empresaId && (t.empresaId || null) !== alvo.empresaId) throw erro('isolamento', 'A tarefa de origem é de outra empresa');
      if (alvo.tarefaId && origem.tarefaId !== alvo.tarefaId) throw erro('isolamento', 'A origem aponta outra tarefa');
    }
    if (origem.correcaoId) {
      const c = await banco.obter(caminhos.correcao(origem.correcaoId));
      if (!c) throw erro('nao-encontrado', 'Correção de origem não encontrada');
      if (alvo.empresaId && c.empresaId && c.empresaId !== alvo.empresaId) throw erro('isolamento', 'A correção de origem é de outra empresa');
    }
    if (origem.aprendizadoId && !(await banco.obter(caminhos.aprendizado(origem.aprendizadoId)))) throw erro('nao-encontrado', 'Aprendizado de origem não encontrado');
  }

  // Monta a versão a gravar, com sinais de injeção e alertas de duplicidade/conflito.
  async function montarVersao(escopo, alvo, dados, chave, ignorarId) {
    const versao = { origem: dados.origem };
    CAMPOS_CONTEUDO.forEach((k) => { if (dados[k] !== undefined) versao[k] = dados[k]; });
    if (!versao.tags) versao.tags = [];
    const sinais = sinaisDeInjecao([versao.titulo, versao.conteudo, ...versao.tags].join('\n'));
    if (sinais.length) versao.sinais = sinais;
    if (ESCOPO_INFO[escopo].aprovacao) {
      // aviso (consulta limitada); a aprovação confere tudo de novo, dentro da transação
      const { memorias } = await recuperador.parecidas(escopo, alvo, `${versao.titulo || ''} ${versao.conteudo}`, chave);
      const a = analisarNovoTexto(memorias, versao.conteudo, chave, { ignorarId });
      versao.alertas = { duplicados: a.duplicados.map((d) => ({ id: d.id, similaridade: Math.round(d.similaridade * 100) / 100 })), conflitos: a.conflitos };
    }
    return versao;
  }

  // Trava da Global. Grava o bloqueio na auditoria (só os motivos) e recusa.
  async function travaGlobal(ator, alvoAuditoria, versao, opcoes) {
    const r = await protecao.verificar(versao, { confirmoSemDadosDeCliente: opcoes.confirmoSemDadosDeCliente === true });
    if (!r.ok) await auditoria.registrar('memoria.trava_global', ator, alvoAuditoria, { conteudo: r.conteudo, confirmacao: r.confirmacao });
    return r;
  }
  const recusaTrava = (r) => erro('precondicao', 'Memória Global bloqueada: ela precisa ser genérica e sem dados de cliente', { conteudo: r.conteudo, confirmacao: r.confirmacao });

  // As mais recentes que valem como regra (consulta limitada: até 50).
  async function vigentesDe(escopo, alvo) {
    const agora = relogio();
    const lista = await banco.consultar(caminhos.colecaoMemorias(escopo, alvoDoEscopo(escopo, alvo)), {
      onde: [{ campo: 'status', op: '==', valor: 'ativa' }], ordenar: { campo: 'aprovadaEm', direcao: 'desc' }, limite: LIMITES_BUSCA.resultadosPorEscopo,
    });
    return lista.filter((m) => memoriaVigente(m, agora));
  }

  // Uma página da coleção, por id (até 100), com filtro opcional de status no banco.
  async function listarPagina(escopo, alvo, { status, depoisDe, limite } = {}) {
    const lim = Math.min(Math.max(1, limite || LIMITES_BUSCA.paginaListagem), LIMITES_BUSCA.paginaListagem);
    const opcoes = { onde: status ? [{ campo: 'status', op: '==', valor: status }] : [], ordenar: { campo: 'id', direcao: 'asc' }, limite: lim };
    if (depoisDe) opcoes.depoisDe = depoisDe;
    const itens = await banco.consultar(caminhos.colecaoMemorias(escopo, alvoDoEscopo(escopo, alvo)), opcoes);
    return { itens, proximo: itens.length === lim ? itens[itens.length - 1].id : null };
  }

  const base = (ref) => caminhos.memoria(ref.escopo, alvoDoEscopo(ref.escopo, ref.alvo), ref.memoriaId);

  async function ler(ref) {
    const b = await banco.obter(base(ref));
    if (!b) throw erro('nao-encontrado', 'Memória não encontrada');
    return Object.assign({ id: ref.memoriaId }, b);
  }

  // Se veio de um agente, ele precisa ter permissão de propor nesse escopo e,
  // na memória de agente, só na DELE (isolamento entre agentes).
  function conferirAgenteProponente(agenteId, escopo, alvo) {
    if (!agenteId) return;
    const a = obterAgente(agenteId);
    if (!a) throw erro('nao-encontrado', 'Agente desconhecido');
    if (escopo !== 'tarefa' && !a.permissoes.memoriaPropor.includes(escopo)) throw erro('permissao-negada', `O agente ${a.nome} não propõe memória no escopo ${escopo}`);
    if (escopo === 'agente' && alvo.agenteId !== agenteId) throw erro('permissao-negada', 'Um agente não propõe memória de outro agente');
  }

  async function lerAtiva(ref) {
    const m = await ler(ref);
    if (m.status === 'arquivada') throw erro('precondicao', 'Memória arquivada: reative antes de alterar');
    return m;
  }
  const lerVersao = (ref, n) => ver.lerVersao(banco, base(ref), n);
  const exigirMotivo = (motivo, oQue) => {
    if (typeof motivo !== 'string' || motivo.trim().length < 3) throw erro('invalido', `${oQue} precisa de um motivo (mínimo de 3 caracteres)`);
    return motivo.trim().slice(0, 500);
  };
  // Duplicidade/conflito da versão n contra as memórias vigentes do mesmo
  // escopo/alvo, lido com "leitor" (o banco ou a transação). A própria memória
  // fica de fora (uma versão nova dela não conflita com ela mesma).
  async function avaliarConflitosCom(leitor, ref, n, conteudo) {
    const agora = relogio();
    const m = await leitor.obter(base(ref));
    if (!m) throw erro('nao-encontrado', 'Memória não encontrada');
    const vigentes = (await leitor.listar(caminhos.colecaoMemorias(ref.escopo, alvoDoEscopo(ref.escopo, ref.alvo)))).filter((x) => memoriaVigente(x, agora));
    const a = analisarNovoTexto(vigentes, conteudo, m.chave, { ignorarId: ref.memoriaId });
    const vigenteDe = new Map(vigentes.map((x) => [x.id, x.versaoVigente]));
    const itens = [
      ...a.duplicados.map((d) => ({ id: d.id, tipo: 'duplicado', versaoVigente: vigenteDe.get(d.id) })),
      ...a.conflitos.map((id) => ({ id, tipo: 'conflito', versaoVigente: vigenteDe.get(id) })),
    ].sort((x, y) => `${x.id}|${x.tipo}`.localeCompare(`${y.id}|${y.tipo}`));
    const assinatura = itens.length ? assinaturaConflitos({ memoria: base(ref), versao: n, conteudo, itens }) : null;
    return { itens, assinatura };
  }

  // Sem conflito: segue. Com conflito: só passa com { assinatura, justificativa }
  // do Super Admin e se a assinatura for a da situação de AGORA.
  function exigirDecisaoConflitos(av, opcoes, ator) {
    if (!av.itens.length) return null;
    const c = opcoes.confirmacaoConflitos;
    if (!c || typeof c !== 'object') {
      throw erro('conflito', 'Existe memória duplicada ou conflitante: a aprovação precisa de uma decisão explícita do Super Admin', { motivo: 'decisao-necessaria', itens: av.itens, assinatura: av.assinatura });
    }
    if (c.assinatura !== av.assinatura) {
      throw erro('conflito', 'Confirmação desatualizada: as memórias envolvidas mudaram depois da avaliação. Avalie de novo.', { motivo: 'confirmacao-desatualizada', itens: av.itens, assinatura: av.assinatura });
    }
    const motivo = exigirMotivo(c.justificativa, 'A decisão sobre duplicidade/conflito');
    return { por: ator.uid, em: relogio(), motivo, assinatura: av.assinatura, itens: av.itens };
  }

  // Registra na auditoria a tentativa barrada (sem conteúdo) e repassa o erro.
  async function auditarBloqueio(e, ator, ref, n, acao) {
    if (e && e.codigo === 'conflito' && e.detalhes && e.detalhes.motivo) {
      await auditoria.registrar('memoria.conflito_bloqueado', ator, base(ref), { versao: n, acao, motivo: e.detalhes.motivo, itens: e.detalhes.itens.map((i) => `${i.tipo}:${i.id}@${i.versaoVigente}`) });
    }
    throw e;
  }

  // Quem pode CRIAR uma proposta: o Super Admin, ou o sistema em nome de um
  // agente (Fase 3D), e aí só como rascunho, nunca em memória de tarefa (que
  // vale na hora) e sem confirmações (que são decisões do Super Admin).
  function exigirAutorDaProposta(ator, opcoes, escopo) {
    if (ator !== ATOR_SISTEMA) return exigirAtor(ator);
    if (!opcoes.agenteId) throw erro('permissao-negada', 'O sistema só registra propostas em nome de um agente');
    if (!ESCOPO_INFO[escopo] || !ESCOPO_INFO[escopo].aprovacao) throw erro('permissao-negada', 'Agente não grava memória que vale na hora: só propõe rascunhos');
    if (opcoes.confirmoSemDadosDeCliente) throw erro('permissao-negada', 'Só o Super Admin confirma que um texto não tem dados de cliente');
    return ator;
  }

  const semAgente = (opcoes) => {
    if (opcoes && opcoes.agenteId) throw erro('permissao-negada', 'Agente não aprova, rejeita nem decide sobre memória: só o Super Admin');
  };

  return {
    alvoDoEscopo,

    // Cria uma memória nova (versão 1). Permanentes ficam pendentes; proposta
    // de agente (ou opcoes.rascunho) nasce em rascunho. Tarefa vale na hora.
    // opcoes: { agenteId, rascunho, confirmoSemDadosDeCliente }
    async criar(ator, dados, opcoes = {}) {
      exigirAutorDaProposta(ator, opcoes, dados && dados.escopo);
      garantir(ESQUEMA_NOVA_MEMORIA, dados, 'Memória');
      const alvo = alvoDoEscopo(dados.escopo, dados.alvo);
      const info = ESCOPO_INFO[dados.escopo];
      if (opcoes.rascunho && !info.aprovacao) throw erro('invalido', 'Memória de tarefa não tem rascunho: vale na hora');
      const rascunho = info.aprovacao && (opcoes.rascunho === true || !!opcoes.agenteId);
      conferirConteudo(dados.escopo, dados, { rascunho });
      conferirAgenteProponente(opcoes.agenteId, dados.escopo, alvo);
      await conferirAlvo(dados.escopo, alvo);
      await conferirOrigem(dados.escopo, alvo, dados.origem);
      const versao = await montarVersao(dados.escopo, alvo, dados, dados.chave || null);
      if (dados.escopo === 'global') {
        const r = await travaGlobal(ator, caminhos.colecoes.memoriaGlobal, versao, opcoes);
        if (!r.ok) throw recusaTrava(r);
        if (opcoes.confirmoSemDadosDeCliente === true) versao.confirmacoes = { semDadosDeCliente: { por: ator.uid, em: relogio() } };
      }
      const memoriaId = novoId('mem');
      const ref = { escopo: dados.escopo, alvo, memoriaId };
      const agora = relogio();
      const doc = {
        escopo: dados.escopo, alvo, categoria: dados.categoria, chave: dados.chave || null,
        status: 'pendente', versaoVigente: null, ultimaVersao: 0, vigente: null,
        criadoEm: agora, criadoPor: ator.uid, propostoPorAgente: opcoes.agenteId || null, atualizadoEm: agora,
      };
      if (dados.escopo === 'tarefa') doc.expiraEm = dados.expiraEm || new Date(Date.parse(agora) + DIAS_TAREFA * 864e5).toISOString();
      await banco.transacao(async (t) => {
        await t.gravar(base(ref), doc);
        await ver.novaVersao(t, base(ref), versao, { ator, aprovarAgora: !info.aprovacao, rascunho });
      });
      await auditoria.registrar('memoria.criada', ator, base(ref), {
        escopo: dados.escopo, categoria: dados.categoria, estado: !info.aprovacao ? 'aprovada' : rascunho ? 'rascunho' : 'pendente',
        pendente: info.aprovacao, agente: opcoes.agenteId || null, sinais: (versao.sinais || []).length,
        duplicados: versao.alertas ? versao.alertas.duplicados.length : 0, conflitos: versao.alertas ? versao.alertas.conflitos.length : 0,
      });
      return Object.assign({ ref }, await ler(ref));
    },

    // Nova versão do conteúdo de uma memória existente (a vigente continua
    // valendo até a nova ser aprovada). opcoes: { agenteId, rascunho, confirmoSemDadosDeCliente }
    async novaVersao(ator, ref, dados, opcoes = {}) {
      exigirAutorDaProposta(ator, opcoes, ref && ref.escopo);
      const atual = await lerAtiva(ref);
      const info = ESCOPO_INFO[ref.escopo];
      if (opcoes.rascunho && !info.aprovacao) throw erro('invalido', 'Memória de tarefa não tem rascunho: vale na hora');
      const rascunho = info.aprovacao && (opcoes.rascunho === true || !!opcoes.agenteId);
      const completo = Object.assign({ escopo: ref.escopo, alvo: ref.alvo, categoria: atual.categoria, titulo: (atual.vigente && atual.vigente.titulo) || 'Sem título' }, dados);
      garantir(ESQUEMA_NOVA_MEMORIA, completo, 'Memória');
      const alvo = alvoDoEscopo(ref.escopo, ref.alvo);
      conferirConteudo(ref.escopo, completo, { rascunho });
      conferirAgenteProponente(opcoes.agenteId, ref.escopo, alvo);
      await conferirAlvo(ref.escopo, alvo);
      await conferirOrigem(ref.escopo, alvo, completo.origem);
      const versao = await montarVersao(ref.escopo, alvo, completo, atual.chave, ref.memoriaId);
      if (ref.escopo === 'global') {
        const r = await travaGlobal(ator, base(ref), versao, opcoes);
        if (!r.ok) throw recusaTrava(r);
        if (opcoes.confirmoSemDadosDeCliente === true) versao.confirmacoes = { semDadosDeCliente: { por: ator.uid, em: relogio() } };
      }
      let n;
      await banco.transacao(async (t) => { n = await ver.novaVersao(t, base(ref), versao, { ator, aprovarAgora: !info.aprovacao, rascunho }); });
      await auditoria.registrar('memoria.versao_criada', ator, base(ref), { versao: n, estado: !info.aprovacao ? 'aprovada' : rascunho ? 'rascunho' : 'pendente', agente: opcoes.agenteId || null });
      return n;
    },

    // rascunho → pendente (encaminha para a aprovação do Super Admin)
    async enviarParaAprovacao(ator, ref, n) {
      exigirAtor(ator);
      await lerAtiva(ref);
      const v = await lerVersao(ref, n);
      if (v.status === 'rascunho' && semEvidencia(ref.escopo, v)) throw erro('invalido', 'Memória de desempenho precisa de evidências antes de ir para aprovação');
      await banco.transacao(async (t) => { await ver.enviar(t, base(ref), n, ator); });
      await auditoria.registrar('memoria.enviada_para_revisao', ator, base(ref), { versao: n });
      return ler(ref);
    },

    // pendente → aprovada. Só o Super Admin (ator); agente nunca.
    // opcoes: { justificativa, confirmoSinais, confirmoSemDadosDeCliente }
    async aprovarVersao(ator, ref, n, opcoes = {}) {
      exigirAtor(ator);
      semAgente(opcoes);
      await lerAtiva(ref);
      const v = await lerVersao(ref, n);
      if (v.status !== 'pendente') throw erro('precondicao', `Só uma versão pendente pode ser aprovada (está ${v.status})`);
      const confirmacoes = Object.assign({}, v.confirmacoes || {});
      if ((v.sinais || []).length) {
        if (opcoes.confirmoSinais !== true) throw erro('precondicao', 'O texto tem sinais de instrução escondida: confirme que leu antes de aprovar (confirmoSinais)', { sinais: v.sinais });
        confirmacoes.sinais = { por: ator.uid, em: relogio() };
      }
      if (ref.escopo === 'global') {
        const r = await travaGlobal(ator, base(ref), v, opcoes);
        if (!r.ok) {
          // problema no conteúdo: bloqueia e devolve para revisão humana
          if (r.conteudo.length) {
            const motivo = `Trava da memória Global: ${r.conteudo.join('; ')}`.slice(0, 500);
            await banco.transacao(async (t) => { await ver.pedirRevisao(t, base(ref), n, ator, motivo); });
            await auditoria.registrar('memoria.revisao_pedida', ator, base(ref), { versao: n, motivo, automatica: true });
          }
          throw recusaTrava(r);
        }
        if (opcoes.confirmoSemDadosDeCliente === true) confirmacoes.semDadosDeCliente = { por: ator.uid, em: relogio() };
      }
      let decisao = null;
      await banco.transacao(async (t) => {
        await ver.aprovar(t, base(ref), n, ator, async (vv) => {
          if (semEvidencia(ref.escopo, vv)) throw erro('invalido', 'Sem evidências não há aprovação de desempenho');
          // duplicidade/conflito avaliados DENTRO da transação: o que foi confirmado é o que está valendo agora
          decisao = exigirDecisaoConflitos(await avaliarConflitosCom(t, ref, n, vv.conteudo), opcoes, ator);
          const tudo = Object.assign({}, confirmacoes, decisao ? { conflitos: decisao } : {});
          return Object.keys(tudo).length ? { confirmacoes: tudo } : null;
        }, { motivo: opcoes.justificativa });
      }).catch((e) => auditarBloqueio(e, ator, ref, n, 'aprovar'));
      await auditoria.registrar('memoria.versao_aprovada', ator, base(ref), {
        versao: n, justificativa: opcoes.justificativa ? String(opcoes.justificativa).slice(0, 300) : null,
        conflitosDecididos: decisao ? { assinatura: decisao.assinatura, itens: decisao.itens.map((i) => `${i.tipo}:${i.id}@${i.versaoVigente}`), justificativa: decisao.motivo.slice(0, 300) } : null,
      });
      return ler(ref);
    },

    async rejeitarVersao(ator, ref, n, motivo, opcoes = {}) {
      exigirAtor(ator);
      semAgente(opcoes);
      const m = exigirMotivo(motivo, 'A rejeição');
      await banco.transacao(async (t) => { await ver.rejeitar(t, base(ref), n, ator, m); });
      await auditoria.registrar('memoria.versao_rejeitada', ator, base(ref), { versao: n, motivo: m.slice(0, 300) });
      return ler(ref);
    },

    // pendente → precisa-revisao (a correção vem numa versão nova)
    async pedirRevisao(ator, ref, n, motivo, opcoes = {}) {
      exigirAtor(ator);
      semAgente(opcoes);
      const m = exigirMotivo(motivo, 'O pedido de revisão');
      await lerAtiva(ref);
      await banco.transacao(async (t) => { await ver.pedirRevisao(t, base(ref), n, ator, m); });
      await auditoria.registrar('memoria.revisao_pedida', ator, base(ref), { versao: n, motivo: m.slice(0, 300) });
      return ler(ref);
    },

    // Rollback: versão NOVA (já aprovada) com o conteúdo de uma versão aprovada
    // anterior. Nada é apagado. A Global passa de novo pela trava.
    // opcoes: { motivo, confirmoSemDadosDeCliente }
    async voltarVersao(ator, ref, n, opcoes = {}) {
      exigirAtor(ator);
      semAgente(opcoes);
      await ler(ref);
      if (ref.escopo === 'global') {
        const v = await lerVersao(ref, n);
        const r = await travaGlobal(ator, base(ref), v, opcoes);
        if (!r.ok) throw recusaTrava(r);
      }
      let nova, decisao = null;
      await banco.transacao(async (t) => {
        if (ESCOPO_INFO[ref.escopo].aprovacao) {
          const v = await t.obter(`${base(ref)}/versoes/${n}`);
          if (v) decisao = exigirDecisaoConflitos(await avaliarConflitosCom(t, ref, n, v.conteudo), opcoes, ator);
        }
        nova = await ver.rollback(t, base(ref), n, ator, CAMPOS_CONTEUDO);
        if (decisao) await t.atualizar(`${base(ref)}/versoes/${nova}`, { confirmacoes: { conflitos: decisao } });
      }).catch((e) => auditarBloqueio(e, ator, ref, n, 'voltarVersao'));
      await auditoria.registrar('memoria.rollback', ator, base(ref), {
        deVersao: n, novaVersao: nova, motivo: opcoes.motivo ? String(opcoes.motivo).slice(0, 300) : null,
        conflitosDecididos: decisao ? { assinatura: decisao.assinatura, itens: decisao.itens.map((i) => `${i.tipo}:${i.id}@${i.versaoVigente}`), justificativa: decisao.motivo.slice(0, 300) } : null,
      });
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

    // Só leitura: mostra ao Super Admin a duplicidade/conflito da versão n e a
    // assinatura que ele precisa mandar junto com a decisão.
    async avaliarConflitos(ator, ref, n) {
      exigirAtor(ator);
      const v = await lerVersao(ref, n);
      if (!ESCOPO_INFO[ref.escopo].aprovacao) return { itens: [], assinatura: null };
      return avaliarConflitosCom(banco, ref, n, v.conteudo);
    },

    // Markdown derivado de UMA versão aprovada (padrão: a vigente). Gerado na
    // hora e devolvido; não é gravado em lugar nenhum.
    async exportarMarkdown(ator, ref, n) {
      exigirAtor(ator);
      const m = await ler(ref);
      const num = n || m.versaoVigente;
      if (!num) throw erro('precondicao', 'Esta memória ainda não tem versão aprovada');
      const v = await lerVersao(ref, num);
      const { markdown, sha256 } = gerarMarkdown(m, v);
      await auditoria.registrar('memoria.exportada_markdown', ator, base(ref), { versao: num, sha256 });
      return { memoriaId: ref.memoriaId, versao: num, sha256, markdown };
    },

    obter: ler,
    versoes: (ref) => ver.listarVersoes(banco, base(ref)),

    // Primeira página (até 100, por id); filtro opcional aplicado nessa página.
    async listar(escopo, alvo, filtro) {
      const { itens } = await listarPagina(escopo, alvo);
      return filtro ? itens.filter(filtro) : itens;
    },
    listarPagina,

    // Só o que vale como regra: ativa, com versão aprovada e (tarefa) não
    // expirada — as 50 aprovadas mais recentes (para tudo, use a busca).
    vigentes: vigentesDe,

    // Manutenção do índice (uma página de até 100 por chamada): recalcula os
    // termos de quem está sem índice ou com versão antiga dele, cada uma na
    // própria transação, a partir da versão vigente gravada.
    async reindexar(ator, escopo, alvo, { depoisDe } = {}) {
      exigirAtor(ator);
      const pagina = await listarPagina(escopo, alvo, { depoisDe });
      let atualizadas = 0;
      for (const m of pagina.itens) {
        if (!m.vigente || m.indiceVersao === INDICE_VERSAO) continue;
        const ref = { escopo, alvo: alvoDoEscopo(escopo, alvo), memoriaId: m.id };
        await banco.transacao(async (t) => {
          const atual = await t.obter(base(ref));
          if (!atual || !atual.vigente || atual.indiceVersao === INDICE_VERSAO) return;
          const v = await t.obter(`${base(ref)}/versoes/${atual.versaoVigente}`);
          await t.atualizar(base(ref), camposDeIndice(atual, v || Object.assign({ n: atual.versaoVigente }, atual.vigente), atual.atualizadoEm));
          atualizadas++;
        });
      }
      await auditoria.registrar('memoria.reindexada', ator, caminhos.colecaoMemorias(escopo, alvoDoEscopo(escopo, alvo)), { lidas: pagina.itens.length, atualizadas });
      return { lidas: pagina.itens.length, atualizadas, proximo: pagina.proximo };
    },
  };
}

module.exports = { criarRegistroMemoria, alvoDoEscopo, CAMPOS_CONTEUDO };
