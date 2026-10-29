// LABZ AI — backend (Fase 1: fundação).
// Este arquivo ainda NÃO exporta funções publicáveis do Firebase: na Fase 2
// cada operação vira uma função onCall que primeiro chama exigirSuperAdmin()
// e depois usa os serviços abaixo com o adaptador do Firestore (Admin SDK).
// Até lá, tudo roda só nos testes, com o banco em memória.
const { criarAuditoria } = require('./src/auditoria/eventos');
const { criarServicoEmpresas } = require('./src/empresas/servico');
const { criarRegistroMemoria } = require('./src/memoria/registro');
const { criarCorrecoes } = require('./src/memoria/correcoes');
const { criarContexto } = require('./src/memoria/contexto');
const { criarAuditorMemoria } = require('./src/memoria/auditor');
const { criarRegistroSkills } = require('./src/skills/registro');
const { exigirSuperAdmin } = require('./src/auth/super-admin');

// Monta todos os serviços sobre um banco (em memória nos testes; Firestore na Fase 2).
function criarLabz({ banco, relogio }) {
  const auditoria = criarAuditoria(banco, relogio);
  const empresas = criarServicoEmpresas({ banco, auditoria, relogio });
  const memoria = criarRegistroMemoria({ banco, auditoria, empresas, relogio });
  const correcoes = criarCorrecoes({ banco, auditoria, registro: memoria, relogio });
  const skills = criarRegistroSkills({ banco, auditoria, relogio });
  const contexto = criarContexto({ banco, registro: memoria, skills });
  const auditor = criarAuditorMemoria({ registro: memoria, relogio });
  return { banco, auditoria, empresas, memoria, correcoes, skills, contexto, auditor };
}

module.exports = {
  criarLabz,
  exigirSuperAdmin,
  agentes: require('./src/agentes/catalogo'),
  ferramentas: require('./src/ferramentas/catalogo'),
  permissoes: require('./src/ferramentas/permissoes'),
  contratos: {
    agente: require('./src/contratos/agente'),
    ferramenta: require('./src/contratos/ferramenta'),
    execucao: require('./src/contratos/execucao'),
    memoria: require('./src/contratos/memoria'),
    empresa: require('./src/contratos/empresa'),
  },
};
