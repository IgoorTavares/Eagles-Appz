// Tool Executor da Fase 4A: só CONTRATO + execução SIMULADA. Nenhuma ferramenta
// externa é chamada. A autorização usa o mesmo verificador do catálogo
// (ferramentas/permissoes.js); a única diferença é tratar toda ferramenta como
// "simulável" (a disponibilidade real continua sendo do catálogo, e é falsa).
const crypto = require('node:crypto');
const { verificarUsoFerramenta } = require('../ferramentas/permissoes');
const { FERRAMENTAS } = require('../ferramentas/catalogo');

const SIMULAVEIS = FERRAMENTAS.map((f) => Object.assign({}, f, { disponibilidade: 'disponivel' }));
const hashAcao = (acao) => crypto.createHash('sha256').update(JSON.stringify([acao.ferramentaId, acao.operacao, acao.parametros || {}]), 'utf8').digest('hex');

// O agente pode propor esta ação? (agente autorizado + operação permitida; aprovação exigida?)
function avaliarAcao(agenteId, acao) {
  if (!acao || acao.tipo !== 'ferramenta' || typeof acao.ferramentaId !== 'string' || typeof acao.operacao !== 'string') return { permitida: false, motivo: 'acao-invalida' };
  const v = verificarUsoFerramenta(agenteId, acao.ferramentaId, acao.operacao, { ferramentas: SIMULAVEIS });
  return { permitida: v.permitido, exigeAprovacao: !!v.exigeAprovacao, motivo: v.motivo, limites: v.limites || null };
}

function criarExecutorSimulado() {
  return {
    simulado: true,
    // Executa (de mentira) uma ação já autorizada e, se preciso, aprovada.
    async executar(agenteId, acao) {
      const a = avaliarAcao(agenteId, acao);
      if (!a.permitida) return { simulado: true, executada: false, motivo: a.motivo };
      return { simulado: true, executada: false, ferramentaId: acao.ferramentaId, operacao: acao.operacao, acao: hashAcao(acao).slice(0, 16), mensagem: '[SIMULADO] nenhuma ação externa foi executada (Fase 4A)' };
    },
  };
}

module.exports = { avaliarAcao, criarExecutorSimulado, hashAcao };
