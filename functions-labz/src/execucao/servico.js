// Execuções (produções) persistentes em labz_tarefas/{id}. O estado só muda
// por transicionar(), dentro de uma transação, conferindo:
//  - se a transição é permitida (contratos/execucao.js);
//  - se ninguém mudou a execução no meio (versaoEsperada, opcional);
//  - quem pediu (Super Admin ou o sistema interno da LABZ AI).
// Ao ficar READY, a execução entra na fila persistente na MESMA transação.
// recuperarInterrompidas(): RUNNING sem sinal de vida volta para READY
// (nova tentativa) ou vira FAILED quando acabam as tentativas.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor, ATOR_SISTEMA, exigirAtorOuSistema } = require('../auth/super-admin');
const { garantir } = require('../nucleo/validador');
const { erro } = require('../nucleo/erros');
const { novoId, relogioPadrao } = require('../nucleo/ids');
const { podeTransicionar } = require('../contratos/execucao');
const { obterAgente } = require('../agentes/catalogo');

// ATOR_SISTEMA (trabalhador da fila) mora em auth/super-admin.js. Nunca sai pela API.

const MAX_TENTATIVAS = 3;
const AVANCAM = ['PLANNING', 'READY', 'RUNNING', 'REVISION_REQUIRED']; // estados que retomam trabalho
const PAGINA = 100;
const CAMPOS_EXTRAS = ['execucaoAtual', 'diagnostico', 'plano', 'etapas', 'custos', 'resultadoFinal', 'limites'];
const MAX_HISTORICO = 100;

const ESQUEMA_NOVA_EXECUCAO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    empresaId: { tipo: 'texto', nulo: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ },
    objetivo: { tipo: 'texto', obrigatorio: true, min: 5, max: 4000 },
    modo: { tipo: 'texto', obrigatorio: true, valores: ['orquestrado', 'especialista'] },
    agenteId: { tipo: 'texto', nulo: true, max: 40 },
    // Fase 4A: limites de consumo SIMULADO desta execução (opcionais; padrão em motor/custos.js)
    limites: {
      tipo: 'objeto', extras: false,
      campos: {
        tokens: { tipo: 'inteiro', min: 100, max: 5000000 },
        custoSimulado: { tipo: 'numero', min: 0, max: 100000 },
        etapas: { tipo: 'inteiro', min: 1, max: 8 },
      },
    },
  },
};

function criarExecucoes({ banco, auditoria, empresas, fila, relogio = relogioPadrao }) {
  async function ler(id) {
    const e = await banco.obter(caminhos.tarefa(id));
    if (!e) throw erro('nao-encontrado', 'Execução não encontrada');
    return Object.assign({ id }, e);
  }

  async function transicionar(ator, id, para, opcoes = {}) {
    exigirAtorOuSistema(ator);
    let resultado;
    await banco.transacao(async (t) => {
      const e = await t.obter(caminhos.tarefa(id));
      if (!e) throw erro('nao-encontrado', 'Execução não encontrada');
      if (opcoes.versaoEsperada !== undefined && e.versao !== opcoes.versaoEsperada) throw erro('conflito', 'A execução mudou enquanto você olhava: atualize e tente de novo');
      // Fase 4A: "crachá" do executor. Quem não é o executor atual não muda a execução
      if (opcoes.token !== undefined && (!e.execucaoAtual || e.execucaoAtual.token !== opcoes.token)) throw erro('conflito', 'Outro executor assumiu esta execução', { motivo: 'executor-substituido' });
      if (!podeTransicionar(e.estado, para)) throw erro('transicao-invalida', `transição não permitida: ${e.estado} → ${para}`);
      // F7 (Fase 3E): empresa arquivada não recebe trabalho novo (encerrar continua possível)
      if (e.empresaId && AVANCAM.includes(para)) {
        const emp = await t.obter(caminhos.empresa(e.empresaId));
        if (!emp || emp.status !== 'ativa') throw erro('precondicao', 'Empresa arquivada: a execução não pode avançar (só ser encerrada)');
      }
      const agora = relogio();
      const historico = (e.historico || []).concat([{ de: e.estado, para, em: agora, por: ator.uid, motivo: String(opcoes.motivo || '').slice(0, 300) }]).slice(-MAX_HISTORICO);
      const mud = { estado: para, versao: (e.versao || 0) + 1, historico, atualizadoEm: agora };
      if (para === 'RUNNING') mud.ultimoBatimento = agora;
      if (opcoes.tentativas !== undefined) mud.tentativas = opcoes.tentativas;
      // Fase 4A: campos gravados JUNTO com a transição (ex.: crachá do executor, diagnóstico)
      if (opcoes.extras) Object.keys(opcoes.extras).forEach((k) => { if (CAMPOS_EXTRAS.includes(k)) mud[k] = opcoes.extras[k]; });
      if (para !== 'RUNNING' && e.execucaoAtual && !(opcoes.extras && 'execucaoAtual' in opcoes.extras)) mud.execucaoAtual = null; // saiu de RUNNING: crachá some
      await t.atualizar(caminhos.tarefa(id), mud);
      if (para === 'READY') await fila.enfileirar({ execucaoId: id, tipo: 'executar', atrasoMs: opcoes.atrasoMs }, t);
      resultado = Object.assign({ id }, e, mud);
    });
    await auditoria.registrar('execucao.transicao', ator, caminhos.tarefa(id), { para, motivo: String(opcoes.motivo || '').slice(0, 300) });
    return resultado;
  }

  return {
    ATOR_SISTEMA,
    transicionar,

    async criar(ator, dados) {
      exigirAtor(ator);
      const d = Object.assign({ empresaId: null, agenteId: null }, dados);
      garantir(ESQUEMA_NOVA_EXECUCAO, d, 'Execução');
      if (d.modo === 'especialista' && !obterAgente(d.agenteId)) throw erro('invalido', 'Modo especialista precisa de um agente válido');
      if (d.modo === 'orquestrado' && d.agenteId && d.agenteId !== '08-estrategista') throw erro('invalido', 'No modo orquestrado quem conduz é o Estrategista');
      if (d.empresaId) await empresas.garantirAtiva(d.empresaId);
      const id = novoId('exe');
      const agora = relogio();
      const doc = {
        empresaId: d.empresaId, objetivo: d.objetivo, modo: d.modo, agenteId: d.modo === 'orquestrado' ? '08-estrategista' : d.agenteId,
        estado: 'CREATED', versao: 1, tentativas: 0, historico: [{ de: null, para: 'CREATED', em: agora, por: ator.uid, motivo: '' }],
        criadoEm: agora, criadoPor: ator.uid, atualizadoEm: agora, ultimoBatimento: null,
        limites: d.limites || null, execucaoAtual: null, diagnostico: null,
      };
      await banco.gravar(caminhos.tarefa(id), doc);
      await auditoria.registrar('execucao.criada', ator, caminhos.tarefa(id), { modo: d.modo, empresaId: d.empresaId });
      return Object.assign({ id }, doc);
    },

    // Sinal de vida do trabalhador enquanto a execução está RUNNING.
    async batimento(id) {
      const e = await ler(id);
      if (e.estado !== 'RUNNING') throw erro('precondicao', 'Só execução em andamento manda sinal de vida');
      await banco.atualizar(caminhos.tarefa(id), { ultimoBatimento: relogio() });
    },

    // F6 (Fase 3E): lê só as RUNNING, por páginas (até 10 páginas de 100 por chamada).
    async recuperarInterrompidas(limiteMs) {
      const corte = Date.parse(relogio()) - limiteMs;
      const presas = [];
      let depoisDe = null;
      for (let p = 0; p < 10; p++) {
        const opcoes = { onde: [{ campo: 'estado', op: '==', valor: 'RUNNING' }], ordenar: { campo: 'id', direcao: 'asc' }, limite: PAGINA };
        if (depoisDe) opcoes.depoisDe = depoisDe;
        const pagina = await banco.consultar(caminhos.colecoes.tarefas, opcoes);
        presas.push(...pagina.filter((e) => e.ultimoBatimento && Date.parse(e.ultimoBatimento) < corte));
        if (pagina.length < PAGINA) break;
        depoisDe = pagina[pagina.length - 1].id;
      }
      const feitas = [];
      for (const e of presas) {
        // F7: execução de empresa arquivada não volta para a fila: é encerrada
        if (e.empresaId) {
          const emp = await banco.obter(caminhos.empresa(e.empresaId));
          if (!emp || emp.status !== 'ativa') {
            await transicionar(ATOR_SISTEMA, e.id, 'CANCELLED', { motivo: 'empresa arquivada' });
            feitas.push({ id: e.id, para: 'CANCELLED' });
            continue;
          }
        }
        const tentativas = (e.tentativas || 0) + 1;
        if (tentativas >= MAX_TENTATIVAS) {
          await transicionar(ATOR_SISTEMA, e.id, 'FAILED', { motivo: `interrompida ${tentativas} vezes`, tentativas, extras: { diagnostico: { motivo: 'interrompida-demais', tentativas, em: relogio() } } });
          feitas.push({ id: e.id, para: 'FAILED' });
        } else {
          await transicionar(ATOR_SISTEMA, e.id, 'READY', { motivo: 'retomada após interrupção', tentativas });
          feitas.push({ id: e.id, para: 'READY' });
        }
      }
      return feitas;
    },

    obter: async (ator, id) => { exigirAtor(ator); return ler(id); },
    // F6 (Fase 3E): página por id (até 100), filtros no banco; o cursor tem de ser da mesma empresa.
    async listarPagina(ator, { estado, empresaId, depoisDe, limite } = {}) {
      exigirAtor(ator);
      const lim = Math.min(Math.max(1, limite || PAGINA), PAGINA);
      const onde = [];
      if (estado) onde.push({ campo: 'estado', op: '==', valor: estado });
      if (empresaId) onde.push({ campo: 'empresaId', op: '==', valor: empresaId });
      const opcoes = { onde, ordenar: { campo: 'id', direcao: 'asc' }, limite: lim, cursorMesmoFiltro: ['empresaId'] };
      if (depoisDe) opcoes.depoisDe = depoisDe;
      const itens = (await banco.consultar(caminhos.colecoes.tarefas, opcoes)).map((e) => Object.assign({}, e));
      return { itens, proximo: itens.length === lim ? itens[itens.length - 1].id : null };
    },
    // Primeira página (compatibilidade).
    async listar(ator, filtro = {}) { return (await this.listarPagina(ator, filtro)).itens; },
  };
}

module.exports = { criarExecucoes, ATOR_SISTEMA, MAX_TENTATIVAS };
