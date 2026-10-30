// Correções do Super Admin → aprendizado.
//  1. registra a correção          6. cria a proposta de aprendizado (PENDENTE)
//  2. classifica o tipo            7. pede aprovação quando é permanente
//  3. identifica o escopo          8. versiona (ao aprovar, cria memória ou nova versão)
//  4. procura duplicidade          9. publica a memória aprovada
//  5. procura conflito            10. (índices: Fase 3)
// Correção pontual NUNCA muda regra permanente: vira só memória da tarefa.
// A classificação aqui é por regras (sem IA). Na Fase 3 um modelo pode
// SUGERIR a classificação, mas a decisão continua do Super Admin.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { garantir } = require('../nucleo/validador');
const { erro } = require('../nucleo/erros');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { ESQUEMA_CORRECAO, ESCOPO_INFO } = require('../contratos/memoria');
const { normalizar, similaridade, sinaisDeInjecao, analisarNovoTexto } = require('./verificacoes');
const { criarRecuperador } = require('./recuperador');
const { LIMITES_BUSCA } = require('../contratos/recuperacao');

// Texto, duplicidade, conflito e sinais de injeção: memoria/verificacoes.js (um lugar só).
const RESERVA_MS = 2 * 60 * 1000; // reserva da proposta durante a aprovação (F3)
const CATEGORIA_PADRAO = { global: 'preferencia', agente: 'aprendizado', cliente: 'preferencia', desempenho: 'aprendizado' };

// Classificação por regras.
function classificar(c) {
  if (c.alcance === 'pontual') {
    return { alcance: 'pontual', escopo: 'tarefa', categoria: 'correcao-pontual', alvo: { tarefaId: c.tarefaId }, precisaDecisao: false, motivo: 'correção pontual: vale só para esta produção' };
  }
  const escopo = c.escopoSugerido || (c.empresaId ? 'cliente' : c.agenteId ? 'agente' : 'global');
  const alvo = escopo === 'global' ? {} : escopo === 'agente' ? { agenteId: c.agenteId } : { empresaId: c.empresaId };
  const faltaAlvo = ESCOPO_INFO[escopo].alvo.some((k) => !alvo[k]);
  const categoria = c.categoria && ESCOPO_INFO[escopo].categorias.includes(c.categoria) ? c.categoria : CATEGORIA_PADRAO[escopo];
  const motivos = [];
  if (c.alcance === 'indefinido') motivos.push('o alcance não foi definido: decida se vale para sempre ou só para esta produção');
  if (faltaAlvo) motivos.push(`falta ${ESCOPO_INFO[escopo].alvo.join(', ')} para o escopo ${escopo}`);
  if (escopo === 'desempenho') motivos.push('aprendizado de desempenho precisa de evidências antes da aprovação');
  return { alcance: c.alcance, escopo, categoria, alvo, precisaDecisao: motivos.length > 0, motivo: motivos.join('; ') || `vale para o escopo ${escopo}` };
}

// deps: { banco, auditoria, registro (memória), relogio? }
function criarCorrecoes(deps) {
  const { banco, auditoria, registro } = deps;
  const recuperador = deps.recuperador || criarRecuperador({ banco, relogio: deps.relogio || relogioPadrao });
  const relogio = deps.relogio || relogioPadrao;

  async function procurarDuplicidadeEConflito(escopo, alvo, texto, chave) {
    // aviso na proposta (consulta limitada); a aprovação confere tudo de novo
    const { memorias } = await recuperador.parecidas(escopo, alvo, texto, chave);
    return analisarNovoTexto(memorias, texto, chave);
  }

  // Corpo da aprovação, já com a proposta reservada (ver aprovar).
  async function aprovarReservado(ator, aprendizadoId, p, ajustes) {
    if (p.sinais.length && !ajustes.confirmoSinais) throw erro('precondicao', 'O texto tem sinais de instrução escondida: confirme que leu antes de aprovar');
    if (p.duplicados.length && !ajustes.aceitarDuplicado) throw erro('conflito', 'Já existe memória equivalente aprovada');
    const escopo = ajustes.escopo || p.escopo;
    const alvo = ajustes.alvo || p.alvo;
    const categoria = ajustes.categoria || p.categoria;
    if (escopo === 'tarefa') throw erro('invalido', 'Aprendizado aprovado é permanente; correção da tarefa não passa por aqui');
    const origem = { tipo: 'correcao', tarefaId: p.tarefaId, correcaoId: p.correcaoId, aprendizadoId };
    const base = { titulo: ajustes.titulo || 'Aprendizado aprovado', conteudo: p.conteudo, origem };
    if (ajustes.evidencias) base.evidencias = ajustes.evidencias;

    let ref, versao;
    const conflito = escopo === p.escopo && p.conflitos.length ? p.conflitos[0] : null;
    if (p.memoriaGerada) {
      // uma tentativa anterior já gerou a versão e a aprovação foi barrada (ex.: conflito a decidir):
      // decide sobre ELA, sem criar outra memória repetida
      ref = p.memoriaGerada.ref;
      versao = p.memoriaGerada.versao;
      if ((ajustes.escopo && ajustes.escopo !== ref.escopo) || (ajustes.alvo && JSON.stringify(ajustes.alvo) !== JSON.stringify(ref.alvo))) {
        throw erro('precondicao', 'Esta proposta já gerou uma versão de memória: decida sobre ela (o escopo e o alvo não mudam mais)', { memoria: ref, versao });
      }
    } else if (conflito) {
      if (!ajustes.substituirConflito) throw erro('conflito', 'Conflita com uma memória aprovada: confirme a substituição (vira uma nova versão dela)');
      ref = { escopo, alvo, memoriaId: conflito };
      versao = await registro.novaVersao(ator, ref, base, { confirmoSemDadosDeCliente: ajustes.confirmoSemDadosDeCliente });
    } else {
      const criada = await registro.criar(ator, Object.assign({ escopo, alvo, categoria, chave: p.chave || undefined }, base), { confirmoSemDadosDeCliente: ajustes.confirmoSemDadosDeCliente });
      ref = criada.ref;
      versao = criada.ultimaVersao;
    }
    if (!p.memoriaGerada) await banco.atualizar(caminhos.aprendizado(aprendizadoId), { memoriaGerada: { ref, versao } });
    if (ESCOPO_INFO[ref.escopo].aprovacao) {
      await registro.aprovarVersao(ator, ref, versao, {
        justificativa: `Aprendizado ${aprendizadoId} aprovado`,
        confirmoSinais: ajustes.confirmoSinais === true, confirmoSemDadosDeCliente: ajustes.confirmoSemDadosDeCliente === true,
        confirmacaoConflitos: ajustes.confirmacaoConflitos,
      });
    }
    await banco.atualizar(caminhos.aprendizado(aprendizadoId), { status: 'aprovado', aprovadoPor: ator.uid, aprovadoEm: relogio(), memoria: ref, versao, emAprovacao: null });
    await auditoria.registrar('aprendizado.aprovado', ator, caminhos.aprendizado(aprendizadoId), { memoria: ref.memoriaId, versao });
    return { ref, versao };
  }

  return {
    classificar,

    // Registra a correção e decide o caminho (tarefa ou proposta).
    async registrar(ator, dados) {
      exigirAtor(ator);
      const c = Object.assign({ empresaId: null, agenteId: null, escopoSugerido: null, categoria: null, chave: null }, dados);
      garantir(ESQUEMA_CORRECAO, c, 'Correção');
      const tarefa = await banco.obter(caminhos.tarefa(c.tarefaId));
      if (!tarefa) throw erro('nao-encontrado', 'Tarefa não encontrada');
      // isolamento: a correção não pode apontar para outra empresa que não a da tarefa
      if (c.empresaId && tarefa.empresaId && c.empresaId !== tarefa.empresaId) throw erro('permissao-negada', 'A correção pertence a outra empresa');
      if (!c.empresaId && tarefa.empresaId) c.empresaId = tarefa.empresaId;

      const classe = classificar(c);
      const correcaoId = novoId('cor');
      const agora = relogio();
      await banco.gravar(caminhos.correcao(correcaoId), Object.assign({}, c, { classificacao: classe, registradaEm: agora, registradaPor: ator.uid, status: 'registrada' }));
      await auditoria.registrar('correcao.registrada', ator, caminhos.correcao(correcaoId), { alcance: classe.alcance, escopo: classe.escopo });

      if (classe.alcance === 'pontual') {
        const mem = await registro.criar(ator, { escopo: 'tarefa', alvo: { tarefaId: c.tarefaId }, categoria: 'correcao-pontual', titulo: 'Correção pontual', conteudo: c.texto, origem: { tipo: 'correcao', tarefaId: c.tarefaId, correcaoId } });
        await banco.atualizar(caminhos.correcao(correcaoId), { status: 'aplicada-na-tarefa', memoriaId: mem.ref.memoriaId });
        return { correcaoId, classificacao: classe, memoriaTarefa: mem.ref };
      }

      const { duplicados, conflitos } = classe.precisaDecisao && ESCOPO_INFO[classe.escopo].alvo.some((k) => !classe.alvo[k])
        ? { duplicados: [], conflitos: [] }
        : await procurarDuplicidadeEConflito(classe.escopo, classe.alvo, c.texto, c.chave);
      const aprendizadoId = novoId('apr');
      const proposta = {
        status: 'pendente', correcaoId, tarefaId: c.tarefaId,
        escopo: classe.escopo, alvo: classe.alvo, categoria: classe.categoria, chave: c.chave,
        conteudo: c.texto, precisaDecisao: classe.precisaDecisao, motivo: classe.motivo,
        duplicados, conflitos, sinais: sinaisDeInjecao(c.texto),
        criadaEm: agora, criadaPor: ator.uid,
      };
      await banco.gravar(caminhos.aprendizado(aprendizadoId), proposta);
      await banco.atualizar(caminhos.correcao(correcaoId), { status: 'proposta-criada', aprendizadoId });
      await auditoria.registrar('aprendizado.proposto', ator, caminhos.aprendizado(aprendizadoId), { escopo: classe.escopo, duplicados: duplicados.length, conflitos: conflitos.length, sinais: proposta.sinais.length });
      return { correcaoId, classificacao: classe, aprendizadoId, proposta };
    },

    // Aprovar: cria a memória (ou a nova versão da memória em conflito) já aprovada.
    // ajustes: { escopo, alvo, categoria, titulo, evidencias, confirmoSinais, substituirConflito,
    //           aceitarDuplicado, confirmoSemDadosDeCliente, confirmacaoConflitos }. A aprovação em
    // si é do registro, que reavalia duplicidade/conflito na hora (a lista da proposta é só um aviso).
    // F3 (Fase 3E): a proposta é RESERVADA numa transação antes de qualquer
    // gravação; uma segunda aprovação simultânea encontra a reserva e para. A
    // reserva vence sozinha (RESERVA_MS) se o processo cair no meio, e é
    // liberada quando a aprovação falha (a memória gerada é reaproveitada).
    async aprovar(ator, aprendizadoId, ajustes = {}) {
      exigirAtor(ator);
      const caminho = caminhos.aprendizado(aprendizadoId);
      const token = novoId('res');
      let p;
      await banco.transacao(async (t) => {
        p = await t.obter(caminho);
        if (!p) throw erro('nao-encontrado', 'Proposta não encontrada');
        if (p.status !== 'pendente') throw erro('precondicao', `Proposta já ${p.status}`);
        const agora = relogio();
        if (p.emAprovacao && Date.parse(p.emAprovacao.ate) > Date.parse(agora)) {
          throw erro('conflito', 'Esta proposta já está sendo aprovada em outra chamada', { motivo: 'aprovacao-em-andamento' });
        }
        await t.atualizar(caminho, { emAprovacao: { token, por: ator.uid, ate: new Date(Date.parse(agora) + RESERVA_MS).toISOString() } });
      }).catch(async (e) => {
        if (e.detalhes && e.detalhes.motivo === 'aprovacao-em-andamento') await auditoria.registrar('aprendizado.aprovacao_concorrente', ator, caminho, {});
        throw e;
      });
      try {
        return await aprovarReservado(ator, aprendizadoId, p, ajustes);
      } catch (e) {
        await banco.transacao(async (t) => {
          const atual = await t.obter(caminho);
          if (atual && atual.emAprovacao && atual.emAprovacao.token === token) await t.atualizar(caminho, { emAprovacao: null });
        });
        throw e;
      }
    },
    async rejeitar(ator, aprendizadoId, motivo) {
      exigirAtor(ator);
      const p = await banco.obter(caminhos.aprendizado(aprendizadoId));
      if (!p) throw erro('nao-encontrado', 'Proposta não encontrada');
      if (p.status !== 'pendente') throw erro('precondicao', `Proposta já ${p.status}`);
      await banco.atualizar(caminhos.aprendizado(aprendizadoId), { status: 'rejeitado', rejeitadoPor: ator.uid, rejeitadoEm: relogio(), motivo: String(motivo || '').slice(0, 500) });
      await auditoria.registrar('aprendizado.rejeitado', ator, caminhos.aprendizado(aprendizadoId));
    },

    // Fila de revisão das propostas, das mais antigas para as mais novas (até 100 por página).
    async pendentesPagina({ depoisDe } = {}) {
      const opcoes = { onde: [{ campo: 'status', op: '==', valor: 'pendente' }], ordenar: { campo: 'criadaEm', direcao: 'asc' }, limite: LIMITES_BUSCA.filaRevisao };
      if (depoisDe) opcoes.depoisDe = depoisDe;
      const itens = await banco.consultar(caminhos.colecoes.aprendizados, opcoes);
      return { itens, proximo: itens.length === LIMITES_BUSCA.filaRevisao ? itens[itens.length - 1].id : null };
    },
    async pendentes() { return (await this.pendentesPagina()).itens; },
  };
}

module.exports = { criarCorrecoes, classificar, similaridade, sinaisDeInjecao, normalizar };
