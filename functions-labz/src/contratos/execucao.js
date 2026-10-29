// Estados de uma execução (produção) e as únicas transições permitidas.
// O motor de orquestração (Fase 4) só muda de estado por transicionar().
const { erro } = require('../nucleo/erros');

const ESTADOS = ['CREATED', 'PLANNING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'REVISION_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED'];
const FINAIS = ['COMPLETED', 'FAILED', 'CANCELLED'];

const TRANSICOES = {
  CREATED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['READY', 'WAITING_APPROVAL', 'FAILED', 'CANCELLED'],
  READY: ['RUNNING', 'CANCELLED'],
  // RUNNING → READY: retomada de uma execução interrompida (volta para a fila)
  RUNNING: ['WAITING_APPROVAL', 'REVISION_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED', 'READY'],
  WAITING_APPROVAL: ['READY', 'REVISION_REQUIRED', 'COMPLETED', 'CANCELLED'],
  REVISION_REQUIRED: ['RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

function podeTransicionar(de, para) {
  return ESTADOS.includes(de) && ESTADOS.includes(para) && TRANSICOES[de].includes(para);
}

function transicionar(de, para) {
  if (!podeTransicionar(de, para)) throw erro('transicao-invalida', `transição não permitida: ${de} → ${para}`);
  return para;
}

module.exports = { ESTADOS, FINAIS, TRANSICOES, podeTransicionar, transicionar };
