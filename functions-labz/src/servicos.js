// Monta todos os serviços da LABZ AI sobre um banco (em memória nos testes;
// Firestore pelo adaptador banco-firestore no servidor e no emulador).
const { criarAuditoria } = require('./auditoria/eventos');
const { criarServicoEmpresas } = require('./empresas/servico');
const { criarRegistroMemoria } = require('./memoria/registro');
const { criarCorrecoes } = require('./memoria/correcoes');
const { criarContexto } = require('./memoria/contexto');
const { criarAuditorMemoria } = require('./memoria/auditor');
const { criarRecuperador } = require('./memoria/recuperador');
const { criarRegistroSkills } = require('./skills/registro');
const { criarFila } = require('./execucao/fila');
const { criarExecucoes } = require('./execucao/servico');
const { criarPreparacao } = require('./execucao/preparacao');
const { criarPortaMemoria } = require('./agentes/memoria-agente');
const { criarAprovacoes } = require('./motor/aprovacoes');
const { criarMotor } = require('./motor/motor');
const { criarAdaptadorSimulado } = require('./motor/adaptador-simulado');
const { criarConfigModelos } = require('./ia/config-modelos');
const { criarAdaptadorModelos } = require('./ia/adaptador-modelos');
const { criarConsumo } = require('./motor/consumo');
const { criarMonitorFila } = require('./motor/monitor-fila');
const { criarExecutorLocal } = require('./motor/executor-local');
const { criarEntregas } = require('./entregas/registro');

// adaptador: o "agente" que o motor chama. Na Fase 4A é SEMPRE o simulado
// (nenhum modelo real); os testes passam roteiros próprios.
// ia (Fase 4B, opcional): { transporte, limitador?, timeoutMs? } liga o adaptador
// de MODELOS (OpenAI/Anthropic/Google/simulado por agente). Só aceita o
// transporte simulado ou o bloqueado: nenhuma chamada real nesta fase.
// opcoes.monitor / opcoes.executor: configurações do monitor e do executor local.
function criarLabz({ banco, relogio, adaptador, ia, opcoes = {} }) {
  const auditoria = criarAuditoria(banco, relogio);
  const empresas = criarServicoEmpresas({ banco, auditoria, relogio });
  const recuperador = criarRecuperador({ banco, relogio, auditoria });
  const memoria = criarRegistroMemoria({ banco, auditoria, empresas, relogio, recuperador });
  const correcoes = criarCorrecoes({ banco, auditoria, registro: memoria, recuperador, relogio });
  const skills = criarRegistroSkills({ banco, auditoria, relogio });
  const contexto = criarContexto({ banco, registro: memoria, skills, recuperador, auditoria, relogio });
  const auditor = criarAuditorMemoria({ registro: memoria, relogio });
  const fila = criarFila({ banco, relogio });
  const execucoes = criarExecucoes({ banco, auditoria, empresas, fila, relogio });
  const preparacao = criarPreparacao({ banco, contexto, auditoria, relogio });
  // porta de memória dos agentes: uso interno (trabalhador da Fase 4); não sai pela API
  const portaMemoria = criarPortaMemoria({ banco, registro: memoria, recuperador, preparacao });
  const aprovacoes = criarAprovacoes({ banco, auditoria, relogio });
  const configModelos = criarConfigModelos({ banco, auditoria, relogio });
  const consumo = criarConsumo({ banco, auditoria, relogio });
  const agente = adaptador || (ia ? criarAdaptadorModelos({ configModelos, transporte: ia.transporte, limitador: ia.limitador, timeoutPadraoMs: ia.timeoutMs }) : criarAdaptadorSimulado());
  const entregas = criarEntregas({ banco, auditoria, relogio }); // Fase 4C.1
  const motor = criarMotor({ banco, auditoria, execucoes, fila, portaMemoria, aprovacoes, adaptador: agente, consumo, entregas, relogio });
  const monitor = criarMonitorFila({ banco, execucoes, fila, auditoria, relogio, opcoes: opcoes.monitor });
  // executor automático LOCAL: uso interno (testes e emulador); não sai pela API e não é agendado
  const executorLocal = (o) => criarExecutorLocal({ motor, monitor, auditoria, opcoes: Object.assign({}, opcoes.executor, o) });
  return { banco, auditoria, empresas, memoria, recuperador, correcoes, skills, contexto, auditor, fila, execucoes, preparacao, portaMemoria, aprovacoes, motor, configModelos, consumo, monitor, executorLocal, adaptador: agente, entregas };
}

module.exports = { criarLabz };
