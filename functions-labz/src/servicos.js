// Monta todos os serviços da LABZ AI sobre um banco (em memória nos testes;
// Firestore pelo adaptador banco-firestore no servidor e no emulador).
const { criarAuditoria } = require('./auditoria/eventos');
const { criarServicoEmpresas } = require('./empresas/servico');
const { criarRegistroMemoria } = require('./memoria/registro');
const { criarCorrecoes } = require('./memoria/correcoes');
const { criarContexto } = require('./memoria/contexto');
const { criarAuditorMemoria } = require('./memoria/auditor');
const { criarRegistroSkills } = require('./skills/registro');
const { criarFila } = require('./execucao/fila');
const { criarExecucoes } = require('./execucao/servico');

function criarLabz({ banco, relogio }) {
  const auditoria = criarAuditoria(banco, relogio);
  const empresas = criarServicoEmpresas({ banco, auditoria, relogio });
  const memoria = criarRegistroMemoria({ banco, auditoria, empresas, relogio });
  const correcoes = criarCorrecoes({ banco, auditoria, registro: memoria, relogio });
  const skills = criarRegistroSkills({ banco, auditoria, relogio });
  const contexto = criarContexto({ banco, registro: memoria, skills });
  const auditor = criarAuditorMemoria({ registro: memoria, relogio });
  const fila = criarFila({ banco, relogio });
  const execucoes = criarExecucoes({ banco, auditoria, empresas, fila, relogio });
  return { banco, auditoria, empresas, memoria, correcoes, skills, contexto, auditor, fila, execucoes };
}

module.exports = { criarLabz };
