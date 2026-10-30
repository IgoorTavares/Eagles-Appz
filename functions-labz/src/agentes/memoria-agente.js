// Porta de memória de um agente numa execução (Fase 3D). É o ÚNICO caminho
// pelo qual um agente lê ou propõe memória; usa o Memory Engine que já existe
// (recuperador, registro, contexto), sem uma segunda arquitetura.
//  - escopo e alvo saem da EXECUÇÃO e do CONTRATO, nunca do pedido do agente:
//    cliente/desempenho = a empresa da execução; agente = o próprio agente;
//    tarefa = a própria execução. Não há como pedir outra empresa ou outro agente;
//  - o agente precisa fazer parte da execução (especialista: o agente dela;
//    orquestrado: o Estrategista ou um agente do plano definido por ele);
//  - ler: só os escopos de leitura do contrato; mesmas regras e limites da busca;
//  - propor: só os escopos de proposta do contrato, SEMPRE como rascunho, pelo
//    ator do sistema (que não aprova nada). Duplicidade, conflito, trava da
//    Global e auditoria são os do registro;
//  - não existe aprovar, rejeitar, enviar para aprovação nem voltar versão aqui.
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { caminhos } = require('../armazenamento/caminhos');
const { ATOR_SISTEMA } = require('../auth/super-admin');
const { obterAgente } = require('./catalogo');
const { perfilMemoria } = require('../contratos/agente');
const { FINAIS } = require('../contratos/execucao');
const { PRIORIDADE_CATEGORIA } = require('../memoria/ranqueador');

// O agente faz parte desta execução?
function agenteNaExecucao(exe, agenteId) {
  if (exe.modo === 'especialista') return exe.agenteId === agenteId;
  if (agenteId === '08-estrategista') return true;
  return !!(exe.plano && Array.isArray(exe.plano.agentes) && exe.plano.agentes.includes(agenteId));
}

// Bases de aprendizado aceitas e como viram "origem" (proveniência conferida pelo registro).
const BASES = ['tarefa', 'correcao', 'feedback', 'desempenho'];
const ESQUEMA_PROPOSTA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    escopo: { tipo: 'texto', obrigatorio: true, valores: ['global', 'agente', 'cliente', 'desempenho'] },
    base: { tipo: 'texto', obrigatorio: true, valores: BASES },
    correcaoId: { tipo: 'texto', padrao: /^[A-Za-z0-9_-]{1,80}$/ },
    categoria: { tipo: 'texto', obrigatorio: true, min: 3, max: 40 },
    chave: { tipo: 'texto', padrao: /^[a-z0-9-]{2,60}$/ },
    titulo: { tipo: 'texto', obrigatorio: true, min: 3, max: 140 },
    conteudo: { tipo: 'texto', obrigatorio: true, min: 3, max: 20000 },
    tags: { tipo: 'lista', max: 20, itens: { tipo: 'texto', min: 2, max: 40 } },
    evidencias: { tipo: 'lista', max: 50 },
  },
};

// deps: { banco, registro, recuperador }
function criarPortaMemoria({ banco, registro, recuperador }) {
  return {
    // Abre a porta de UM agente para UMA execução.
    async abrir(agenteId, execucaoId) {
      const agente = obterAgente(agenteId);
      if (!agente) throw erro('nao-encontrado', 'Agente desconhecido');
      const exe = await banco.obter(caminhos.tarefa(execucaoId));
      if (!exe) throw erro('nao-encontrado', 'Execução não encontrada');
      if (FINAIS.includes(exe.estado)) throw erro('precondicao', `Execução ${exe.estado}: não recebe mais trabalho`);
      if (!agenteNaExecucao(exe, agenteId)) throw erro('permissao-negada', `O agente ${agente.nome} não faz parte desta execução`);
      const perfil = perfilMemoria(agente);
      const empresaId = exe.empresaId || null;
      const prioridades = Object.assign({}, PRIORIDADE_CATEGORIA, agente.prioridadesMemoria || {});

      // alvo de cada escopo, sempre derivado da execução (null = não se aplica)
      const alvoDe = (escopo) => ({
        global: {}, agente: { agenteId }, tarefa: { tarefaId: execucaoId },
        cliente: empresaId ? { empresaId } : null, desempenho: empresaId ? { empresaId } : null,
      }[escopo]);

      async function consultar(texto, { escopos, limite } = {}) {
        const pedidos = escopos || perfil.leitura;
        pedidos.forEach((e) => { if (!perfil.leitura.includes(e)) throw erro('permissao-negada', `O agente ${agente.nome} não lê memória de ${e}`); });
        const porEscopo = {};
        const metricas = { consultas: 0, documentosLidos: 0 };
        for (const escopo of pedidos) {
          const alvo = alvoDe(escopo);
          if (!alvo) continue; // execução sem empresa: não há memória de cliente/desempenho
          const r = await recuperador.buscarParaAgente({ escopo, alvo, modo: 'textual', texto, limite: limite || 10 }, { prioridades });
          porEscopo[escopo] = r.itens;
          metricas.consultas += r.metricas.consultas;
          metricas.documentosLidos += r.metricas.documentosLidos;
        }
        return { porEscopo, metricas, semantica: { disponivel: false } };
      }

      // Proposta de aprendizado: nasce RASCUNHO; só o Super Admin envia e aprova.
      async function propor(proposta) {
        garantir(ESQUEMA_PROPOSTA, proposta, 'Proposta de aprendizado');
        const p = proposta;
        if (!perfil.propor.includes(p.escopo)) throw erro('permissao-negada', `O agente ${agente.nome} não propõe memória de ${p.escopo}`);
        const alvo = alvoDe(p.escopo);
        if (!alvo) throw erro('invalido', `Execução sem empresa: não há onde guardar memória de ${p.escopo}`);
        if (p.base === 'correcao' && !p.correcaoId) throw erro('invalido', 'Aprendizado de correção precisa da correção de origem');
        if (p.base === 'desempenho' && !(p.evidencias && p.evidencias.length)) throw erro('invalido', 'Aprendizado de desempenho precisa de evidências');
        const origem = p.base === 'correcao' ? { tipo: 'correcao', tarefaId: execucaoId, correcaoId: p.correcaoId }
          : p.base === 'desempenho' ? { tipo: 'desempenho', tarefaId: execucaoId }
            : { tipo: 'tarefa', tarefaId: execucaoId }; // resultado da tarefa ou feedback autorizado
        const dados = { escopo: p.escopo, alvo, categoria: p.categoria, titulo: p.titulo, conteudo: p.conteudo, origem };
        if (p.chave) dados.chave = p.chave;
        if (p.tags) dados.tags = p.tags;
        if (p.evidencias) dados.evidencias = p.evidencias;
        const m = await registro.criar(ATOR_SISTEMA, dados, { agenteId });
        return { ref: m.ref, versao: m.ultimaVersao, estado: 'rascunho', alertas: ((await registro.versoes(m.ref))[0] || {}).alertas || null };
      }

      return Object.freeze({ agenteId, execucaoId, empresaId, perfil, consultar, propor });
    },
  };
}

module.exports = { criarPortaMemoria, agenteNaExecucao, ESQUEMA_PROPOSTA };
