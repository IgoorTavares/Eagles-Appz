// Onde cada dado da LABZ AI mora no Firestore. Todas as coleções de topo
// começam com "labz_" (as regras deixam só o Super Admin autorizado ler e
// ninguém gravar pelo navegador; quem grava é o servidor).
//
// O isolamento entre empresas é pelo CAMINHO: a memória de uma empresa fica
// dentro do documento dela, então ler a memória da empresa A nunca passa
// pelos documentos da empresa B.
const { erro } = require('../nucleo/erros');

const SEG = /^[A-Za-z0-9_-]{1,80}$/;
function seg(v, nome) {
  if (typeof v !== 'string' || !SEG.test(v)) throw erro('invalido', `${nome} inválido`);
  return v;
}

const C = {
  config: 'labz_config',
  empresas: 'labz_empresas',
  agentes: 'labz_agentes',
  skills: 'labz_skills',
  memoriaGlobal: 'labz_memoria_global',
  tarefas: 'labz_tarefas',
  correcoes: 'labz_correcoes',
  aprendizados: 'labz_aprendizados',
  eventos: 'labz_eventos',
  vinculos: 'labz_vinculos',
  fila: 'labz_fila',
};

const caminhos = {
  colecoes: C,
  acesso: () => `${C.config}/acesso`,
  empresa: (empresaId) => `${C.empresas}/${seg(empresaId, 'empresaId')}`,
  vinculo: (chave) => `${C.vinculos}/${seg(chave, 'vínculo')}`,
  agente: (agenteId) => `${C.agentes}/${seg(agenteId, 'agenteId')}`,
  skill: (skillId) => `${C.skills}/${seg(skillId, 'skillId')}`,
  skillVersao: (skillId, n) => `${C.skills}/${seg(skillId, 'skillId')}/versoes/${seg(String(n), 'versão')}`,
  tarefa: (tarefaId) => `${C.tarefas}/${seg(tarefaId, 'tarefaId')}`,
  correcao: (id) => `${C.correcoes}/${seg(id, 'correcaoId')}`,
  aprendizado: (id) => `${C.aprendizados}/${seg(id, 'aprendizadoId')}`,
  evento: (id) => `${C.eventos}/${seg(id, 'eventoId')}`,
  filaItem: (id) => `${C.fila}/${seg(id, 'filaId')}`,

  // Coleção de memórias de cada escopo (os 5 escopos)
  colecaoMemorias(escopo, alvo = {}) {
    switch (escopo) {
      case 'global': return C.memoriaGlobal;
      case 'agente': return `${C.agentes}/${seg(alvo.agenteId, 'agenteId')}/memorias`;
      case 'cliente': return `${C.empresas}/${seg(alvo.empresaId, 'empresaId')}/memorias`;
      case 'tarefa': return `${C.tarefas}/${seg(alvo.tarefaId, 'tarefaId')}/memorias`;
      case 'desempenho': return `${C.empresas}/${seg(alvo.empresaId, 'empresaId')}/desempenho`;
      default: throw erro('invalido', `escopo de memória desconhecido: ${escopo}`);
    }
  },
  memoria: (escopo, alvo, memoriaId) => `${caminhos.colecaoMemorias(escopo, alvo)}/${seg(memoriaId, 'memoriaId')}`,
  memoriaVersao: (escopo, alvo, memoriaId, n) => `${caminhos.memoria(escopo, alvo, memoriaId)}/versoes/${seg(String(n), 'versão')}`,
};

module.exports = { caminhos };
