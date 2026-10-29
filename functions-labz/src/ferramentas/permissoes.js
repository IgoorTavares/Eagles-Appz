// Quem pode usar o quê. Decide pelo REGISTRO (contratos do agente e da
// ferramenta), nunca por algo que o modelo escreveu.
const { AGENTES } = require('../agentes/catalogo');
const { FERRAMENTAS } = require('./catalogo');

function verificarUsoFerramenta(agenteId, ferramentaId, operacao, catalogos = {}) {
  const agentes = catalogos.agentes || AGENTES;
  const ferramentas = catalogos.ferramentas || FERRAMENTAS;
  const agente = agentes.find((a) => a.id === agenteId);
  const ferramenta = ferramentas.find((x) => x.id === ferramentaId);
  const nao = (motivo) => ({ permitido: false, exigeAprovacao: false, motivo });
  if (!agente) return nao('agente-desconhecido');
  if (!ferramenta) return nao('ferramenta-desconhecida');
  if (!agente.ferramentas.includes(ferramentaId) || !ferramenta.agentesAutorizados.includes(agenteId)) return nao('agente-nao-autorizado');
  if (!ferramenta.operacoes.includes(operacao)) return nao('operacao-nao-permitida');
  if (ferramenta.disponibilidade !== 'disponivel') return nao(`ferramenta-${ferramenta.disponibilidade}`);
  return { permitido: true, exigeAprovacao: ferramenta.exigeAprovacao, motivo: 'ok', limites: ferramenta.limites };
}

module.exports = { verificarUsoFerramenta };
