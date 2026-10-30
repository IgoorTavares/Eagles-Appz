// Contrato de um agente da LABZ AI. O contrato (público, no repositório)
// descreve O QUE o agente é e pode fazer. O CONTEÚDO das skills e os
// prompts ficam privados no banco (labz_skills, versionados); a escolha de
// provedor e modelo fica em labz_agentes/{id} (configurada pelo Super Admin).
const { ESCOPOS, ESCOPO_INFO } = require('./memoria');

const RECURSOS_MODELO = ['texto', 'saida-estruturada', 'ferramentas', 'imagem-entrada', 'imagem-saida'];

const ESQUEMA_SKILL_REF = {
  tipo: 'objeto', extras: false,
  campos: {
    arquivo: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Z0-9-]+\.md$/ },
    obrigatoria: { tipo: 'booleano', obrigatorio: true },
    gatilhos: { tipo: 'lista', obrigatorio: true, itens: { tipo: 'texto', min: 2, max: 40 } },
  },
};

const ESQUEMA_MODELO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    provedor: { tipo: 'texto', obrigatorio: true, nulo: true, valores: ['anthropic', 'openai', 'google'] },
    modelo: { tipo: 'texto', obrigatorio: true, nulo: true, max: 120 },
    provedorAlternativo: { tipo: 'texto', obrigatorio: true, nulo: true, valores: ['anthropic', 'openai', 'google'] },
    modeloAlternativo: { tipo: 'texto', obrigatorio: true, nulo: true, max: 120 },
    parametros: { tipo: 'objeto', obrigatorio: true },
    limites: {
      tipo: 'objeto', obrigatorio: true, extras: false,
      campos: {
        tokensPorExecucao: { tipo: 'inteiro', obrigatorio: true, nulo: true, min: 1 },
        execucoesPorDia: { tipo: 'inteiro', obrigatorio: true, nulo: true, min: 1 },
        custoDiarioMax: { tipo: 'numero', obrigatorio: true, nulo: true, min: 0 },
      },
    },
    recursosNecessarios: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', valores: RECURSOS_MODELO } },
  },
};

const ESQUEMA_AGENTE = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto', obrigatorio: true, padrao: /^0[1-8]-[a-z-]+$/ },
    numero: { tipo: 'inteiro', obrigatorio: true, min: 1, max: 8 },
    nome: { tipo: 'texto', obrigatorio: true, min: 3, max: 60 },
    missao: { tipo: 'texto', obrigatorio: true, min: 10, max: 300 },
    responsabilidades: { tipo: 'lista', obrigatorio: true, min: 3, itens: { tipo: 'texto', min: 5, max: 200 } },
    skills: { tipo: 'lista', obrigatorio: true, min: 2, itens: ESQUEMA_SKILL_REF },
    ferramentas: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', padrao: /^[a-z_]+\.[a-z_]+$/ } },
    entregaveis: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', min: 3, max: 80 } },
    permissoes: {
      tipo: 'objeto', obrigatorio: true, extras: false,
      campos: {
        memoriaLeitura: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', valores: ESCOPOS } },
        memoriaPropor: { tipo: 'lista', obrigatorio: true, itens: { tipo: 'texto', valores: ESCOPOS } },
        // nenhum agente aprova memória: só o Super Admin (fixo no contrato)
        aprovarMemoria: { tipo: 'booleano', obrigatorio: true, valores: [false] },
        podeDelegar: { tipo: 'booleano', obrigatorio: true },
      },
    },
    prioridadesMemoria: { tipo: 'objeto', obrigatorio: true }, // categoria → 0..1 (conferida por conferirPrioridades)
    criteriosQualidade: { tipo: 'lista', obrigatorio: true, min: 3, itens: { tipo: 'texto', min: 5, max: 200 } },
    modos: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', valores: ['orquestrado', 'especialista'] } },
    modelo: ESQUEMA_MODELO,
  },
};

// Modelo ainda não escolhido (a escolha é do Super Admin, na Fase 6).
function modeloAConfigurar(recursosNecessarios) {
  return {
    provedor: null, modelo: null, provedorAlternativo: null, modeloAlternativo: null,
    parametros: {}, limites: { tokensPorExecucao: null, execucoesPorDia: null, custoDiarioMax: null },
    recursosNecessarios,
  };
}

// ---------- Fase 3A: contrato de integração agente ↔ memória ----------
// Derivado SÓ do catálogo (permissões do contrato): nada que venha de uma
// memória, skill ou briefing muda o que o agente lê, propõe ou aprova.
// A integração operacional (prioridades por agente, D4) fica para a Fase 3D.
const ESQUEMA_PERFIL_MEMORIA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    agenteId: { tipo: 'texto', obrigatorio: true, padrao: /^0[1-8]-[a-z-]+$/ },
    leitura: { tipo: 'lista', obrigatorio: true, min: 1, itens: { tipo: 'texto', valores: ESCOPOS } },
    propor: { tipo: 'lista', obrigatorio: true, itens: { tipo: 'texto', valores: ESCOPOS } },
    aprovar: { tipo: 'booleano', obrigatorio: true, valores: [false] },
    alvos: { tipo: 'objeto', obrigatorio: true },
    exigeEmpresa: { tipo: 'lista', obrigatorio: true, itens: { tipo: 'texto', valores: ESCOPOS } },
    memoriaComo: { tipo: 'texto', obrigatorio: true, valores: ['dado'] },
    propostaComo: { tipo: 'texto', obrigatorio: true, valores: ['pendente'] },
    etapaOperacional: { tipo: 'texto', obrigatorio: true, valores: ['3D'] },
    prioridades: { tipo: 'objeto', obrigatorio: true },
  },
};

// Prioridades só com categorias que existem e notas entre 0 e 1.
function conferirPrioridades(prioridades) {
  const validas = new Set(Object.values(ESCOPO_INFO).flatMap((i) => i.categorias));
  return Object.entries(prioridades || {}).filter(([k, v]) => !validas.has(k) || typeof v !== 'number' || v < 0 || v > 1).map(([k]) => k);
}

function perfilMemoria(agente) {
  const p = agente.permissoes;
  const alvos = {};
  p.memoriaLeitura.forEach((e) => { alvos[e] = ESCOPO_INFO[e].alvo.slice(); });
  return Object.freeze({
    agenteId: agente.id,
    leitura: p.memoriaLeitura.slice(),
    propor: p.memoriaPropor.slice(),
    aprovar: false, // só o Super Admin aprova
    alvos, // chaves obrigatórias do alvo em cada escopo lido
    exigeEmpresa: p.memoriaLeitura.filter((e) => ESCOPO_INFO[e].alvo.includes('empresaId')), // só a empresa da tarefa
    memoriaComo: 'dado',
    propostaComo: 'pendente',
    etapaOperacional: '3D',
    prioridades: Object.freeze(Object.assign({}, agente.prioridadesMemoria || {})),
  });
}

module.exports = { ESQUEMA_AGENTE, ESQUEMA_MODELO, RECURSOS_MODELO, modeloAConfigurar, ESQUEMA_PERFIL_MEMORIA, perfilMemoria, conferirPrioridades };
