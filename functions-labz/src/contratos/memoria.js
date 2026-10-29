// LABZ Memory Engine — contratos dos 5 escopos de memória.
//
//  escopo      | a quem pertence          | permanente? | precisa de aprovação?
//  global      | metodologia do Super Admin| sim         | sim
//  agente      | um especialista          | sim         | sim
//  cliente     | uma empresa da LABZ AI   | sim         | sim
//  tarefa      | uma produção             | não (expira)| não (é histórico da tarefa)
//  desempenho  | uma empresa (com provas) | sim         | sim + evidências obrigatórias
//
// Uma memória tem versões. Só a versão APROVADA vigente vale como regra;
// versões pendentes, rejeitadas ou substituídas nunca entram no contexto.

const ESCOPOS = ['global', 'agente', 'cliente', 'tarefa', 'desempenho'];

const ESCOPO_INFO = {
  global: { alvo: [], permanente: true, aprovacao: true, categorias: ['identidade', 'metodologia', 'preferencia', 'qualidade'] },
  agente: { alvo: ['agenteId'], permanente: true, aprovacao: true, categorias: ['tecnica', 'preferencia', 'aprendizado', 'qualidade'] },
  cliente: { alvo: ['empresaId'], permanente: true, aprovacao: true, categorias: ['marca', 'design-system', 'tom-de-voz', 'publico', 'preferencia', 'aprendizado', 'referencia'] },
  tarefa: { alvo: ['tarefaId'], permanente: false, aprovacao: false, categorias: ['historico', 'correcao-pontual', 'nota'] },
  desempenho: { alvo: ['empresaId'], permanente: true, aprovacao: true, categorias: ['campanha', 'experimento', 'resultado', 'aprendizado'], exigeEvidencias: true },
};

// Documentos de cliente previstos no pedido (marca.md etc.) → categorias.
// São MODELOS de organização; o conteúdo é sempre privado (banco).
const DOCUMENTOS_CLIENTE = {
  'marca.md': { categoria: 'marca', secoes: ['Essência e posicionamento', 'Tipografia', 'Cores', 'Texturas', 'Espaçamentos', 'Padrões visuais', 'Referências'] },
  'design-system.md': { categoria: 'design-system', secoes: ['Grid e espaçamentos', 'Tipografia aplicada', 'Paleta aplicada', 'Componentes', 'Exemplos aprovados'] },
  'publico.md': { categoria: 'publico', secoes: ['Público principal', 'Dores e desejos', 'Objeções', 'Linguagem do público'] },
  'preferencias.md': { categoria: 'preferencia', secoes: ['O que sempre fazer', 'O que nunca fazer', 'Formatos preferidos'] },
  'aprendizados.md': { categoria: 'aprendizado', secoes: ['Aprendizados aprovados'] },
};

const STATUS_MEMORIA = ['pendente', 'ativa', 'arquivada'];
const STATUS_VERSAO = ['pendente', 'aprovada', 'rejeitada', 'substituida'];
const ORIGENS = ['manual', 'correcao', 'importacao', 'tarefa', 'desempenho', 'rollback'];

const ESQUEMA_ORIGEM = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    tipo: { tipo: 'texto', obrigatorio: true, valores: ORIGENS },
    tarefaId: { tipo: 'texto', max: 80 },
    correcaoId: { tipo: 'texto', max: 80 },
    aprendizadoId: { tipo: 'texto', max: 80 },
    versaoDe: { tipo: 'inteiro', min: 1 },
  },
};

const ESQUEMA_EVIDENCIA = {
  tipo: 'objeto', extras: false,
  campos: {
    fonte: { tipo: 'texto', obrigatorio: true, min: 2, max: 120 },
    metrica: { tipo: 'texto', obrigatorio: true, min: 2, max: 120 },
    valor: { tipo: 'qualquer', obrigatorio: true },
    periodo: { tipo: 'texto', obrigatorio: true, min: 4, max: 60 },
    referencia: { tipo: 'texto', max: 300 },
  },
};

const ESQUEMA_ALVO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    empresaId: { tipo: 'texto', max: 80 },
    agenteId: { tipo: 'texto', max: 80 },
    tarefaId: { tipo: 'texto', max: 80 },
  },
};

// Pedido para criar uma memória nova (ou uma nova versão do conteúdo)
const ESQUEMA_NOVA_MEMORIA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    escopo: { tipo: 'texto', obrigatorio: true, valores: ESCOPOS },
    alvo: ESQUEMA_ALVO,
    categoria: { tipo: 'texto', obrigatorio: true, min: 3, max: 40 },
    chave: { tipo: 'texto', padrao: /^[a-z0-9-]{2,60}$/ },
    titulo: { tipo: 'texto', obrigatorio: true, min: 3, max: 140 },
    conteudo: { tipo: 'texto', obrigatorio: true, min: 3, max: 20000 },
    tags: { tipo: 'lista', max: 20, itens: { tipo: 'texto', min: 2, max: 40 } },
    origem: ESQUEMA_ORIGEM,
    evidencias: { tipo: 'lista', max: 50, itens: ESQUEMA_EVIDENCIA },
    expiraEm: { tipo: 'texto', max: 40 },
  },
};

// Correção feita pelo Super Admin numa produção
const ALCANCES = ['pontual', 'permanente', 'indefinido'];
const ESQUEMA_CORRECAO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    tarefaId: { tipo: 'texto', obrigatorio: true, max: 80 },
    empresaId: { tipo: 'texto', nulo: true, max: 80 },
    agenteId: { tipo: 'texto', nulo: true, max: 80 },
    texto: { tipo: 'texto', obrigatorio: true, min: 3, max: 5000 },
    alcance: { tipo: 'texto', obrigatorio: true, valores: ALCANCES },
    escopoSugerido: { tipo: 'texto', nulo: true, valores: ['global', 'agente', 'cliente', 'desempenho'] },
    categoria: { tipo: 'texto', nulo: true, max: 40 },
    chave: { tipo: 'texto', nulo: true, padrao: /^[a-z0-9-]{2,60}$/ },
  },
};

const STATUS_APRENDIZADO = ['pendente', 'aprovado', 'rejeitado'];

module.exports = {
  ESCOPOS, ESCOPO_INFO, DOCUMENTOS_CLIENTE, STATUS_MEMORIA, STATUS_VERSAO, ORIGENS, ALCANCES, STATUS_APRENDIZADO,
  ESQUEMA_NOVA_MEMORIA, ESQUEMA_CORRECAO, ESQUEMA_EVIDENCIA, ESQUEMA_ALVO,
};
