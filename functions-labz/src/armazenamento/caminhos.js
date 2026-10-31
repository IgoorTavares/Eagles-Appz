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
  nomes: 'labz_nomes', // reserva do nome normalizado de cada empresa da LABZ AI (F4)
  consumo: 'labz_consumo', // Fase 4B: consumo por dia (UTC), com as reservas em aberto
  entregas: 'labz_entregas', // Fase 4C.1: registro central das entregas (metadados)
};

// Subcoleções da LABZ AI (Fase 3E: com o prefixo labz_, para que índices e
// isenções do Firestore, que valem por NOME de coleção, nunca alcancem o CRM/ERP).
// Fase 4C.1: versoes de entrega têm nome próprio (as isenções de labz_versoes foram pensadas para memórias)
const SUB = Object.freeze({ memorias: 'labz_memorias', desempenho: 'labz_desempenho', versoes: 'labz_versoes', aprovacoes: 'labz_aprovacoes', resultados: 'labz_resultados', versoesEntrega: 'labz_versoes_entrega', conteudos: 'labz_conteudos' });

const caminhos = {
  colecoes: C,
  subcolecoes: SUB,
  acesso: () => `${C.config}/acesso`,
  empresa: (empresaId) => `${C.empresas}/${seg(empresaId, 'empresaId')}`,
  vinculo: (chave) => `${C.vinculos}/${seg(chave, 'vínculo')}`,
  nomeEmpresa: (slug) => `${C.nomes}/${seg(slug, 'nome normalizado')}`,
  agente: (agenteId) => `${C.agentes}/${seg(agenteId, 'agenteId')}`,
  skill: (skillId) => `${C.skills}/${seg(skillId, 'skillId')}`,
  skillVersao: (skillId, n) => `${C.skills}/${seg(skillId, 'skillId')}/${SUB.versoes}/${seg(String(n), 'versão')}`,
  tarefa: (tarefaId) => `${C.tarefas}/${seg(tarefaId, 'tarefaId')}`,
  correcao: (id) => `${C.correcoes}/${seg(id, 'correcaoId')}`,
  aprendizado: (id) => `${C.aprendizados}/${seg(id, 'aprendizadoId')}`,
  evento: (id) => `${C.eventos}/${seg(id, 'eventoId')}`,
  filaItem: (id) => `${C.fila}/${seg(id, 'filaId')}`,
  // Fase 4A: pedidos de aprovação e resultados de cada etapa, DENTRO da execução
  aprovacoesExecucao: (execucaoId) => `${C.tarefas}/${seg(execucaoId, 'execucaoId')}/${SUB.aprovacoes}`,
  aprovacaoExecucao: (execucaoId, id) => `${C.tarefas}/${seg(execucaoId, 'execucaoId')}/${SUB.aprovacoes}/${seg(id, 'aprovacaoId')}`,
  resultadoEtapa: (execucaoId, etapaId) => `${C.tarefas}/${seg(execucaoId, 'execucaoId')}/${SUB.resultados}/${seg(etapaId, 'etapaId')}`,
  // Fase 4B: resultado preservado de uma tentativa revisada (n = número da revisão)
  resultadoRevisao: (execucaoId, etapaId, n) => `${C.tarefas}/${seg(execucaoId, 'execucaoId')}/${SUB.resultados}/${seg(`${etapaId}_rev${n}`, 'etapaId')}`,
  // Fase 4C.1: entregas (metadados), versões imutáveis e conteúdo endereçado pelo hash, DENTRO da execução
  entrega: (entregaId) => `${C.entregas}/${seg(entregaId, 'entregaId')}`,
  versoesEntrega: (entregaId) => `${C.entregas}/${seg(entregaId, 'entregaId')}/${SUB.versoesEntrega}`,
  versaoEntrega: (entregaId, n) => `${C.entregas}/${seg(entregaId, 'entregaId')}/${SUB.versoesEntrega}/${seg(String(n), 'versão')}`,
  conteudoExecucao: (execucaoId, hash) => {
    if (!/^[0-9a-f]{64}$/.test(String(hash))) throw erro('invalido', 'hash inválido');
    return `${C.tarefas}/${seg(execucaoId, 'execucaoId')}/${SUB.conteudos}/${hash}`;
  },
  // Fase 4B: limites de consumo e preços (só o Super Admin define; preço nunca vem do código)
  limitesConsumo: () => `${C.config}/limites`,
  precosModelos: () => `${C.config}/precos`,

  // Coleção de memórias de cada escopo (os 5 escopos)
  colecaoMemorias(escopo, alvo = {}) {
    switch (escopo) {
      case 'global': return C.memoriaGlobal;
      case 'agente': return `${C.agentes}/${seg(alvo.agenteId, 'agenteId')}/${SUB.memorias}`;
      case 'cliente': return `${C.empresas}/${seg(alvo.empresaId, 'empresaId')}/${SUB.memorias}`;
      case 'tarefa': return `${C.tarefas}/${seg(alvo.tarefaId, 'tarefaId')}/${SUB.memorias}`;
      case 'desempenho': return `${C.empresas}/${seg(alvo.empresaId, 'empresaId')}/${SUB.desempenho}`;
      default: throw erro('invalido', `escopo de memória desconhecido: ${escopo}`);
    }
  },
  memoria: (escopo, alvo, memoriaId) => `${caminhos.colecaoMemorias(escopo, alvo)}/${seg(memoriaId, 'memoriaId')}`,
  memoriaVersao: (escopo, alvo, memoriaId, n) => `${caminhos.memoria(escopo, alvo, memoriaId)}/${SUB.versoes}/${seg(String(n), 'versão')}`,
};

module.exports = { caminhos };
