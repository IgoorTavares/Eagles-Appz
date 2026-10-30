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
const { erro } = require('../nucleo/erros');
const { validar } = require('../nucleo/validador');

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
const STATUS_VERSAO = ['rascunho', 'pendente', 'precisa-revisao', 'aprovada', 'rejeitada', 'substituida'];
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

// ---------- Fase 3A: contratos consolidados do Memory Engine ----------

// Escopo e isolamento: o alvo tem exatamente as chaves do escopo (nem mais,
// nem menos). É o alvo validado que monta o caminho no banco, então a
// memória de uma empresa nunca é lida pelo caminho de outra.
function alvoDoEscopo(escopo, alvo = {}) {
  const info = ESCOPO_INFO[escopo];
  if (!info) throw erro('invalido', `escopo de memória desconhecido: ${escopo}`);
  const chaves = Object.keys(alvo).filter((k) => alvo[k] !== undefined && alvo[k] !== null);
  const sobrando = chaves.filter((k) => !info.alvo.includes(k));
  const faltando = info.alvo.filter((k) => !alvo[k]);
  if (sobrando.length || faltando.length) throw erro('invalido', `alvo inválido para o escopo ${escopo}`, { faltando, sobrando });
  const limpo = {};
  info.alvo.forEach((k) => { limpo[k] = alvo[k]; });
  return limpo;
}

// Estados (D2). O valor gravado no banco é o nome em português; "nome" é a
// referência em inglês mostrada na API. ativo: false = estado RESERVADO
// (nenhum serviço grava esse valor). Desde a Fase 3B todos estão em uso.
const ESTADOS_VERSAO = Object.freeze({
  rascunho: { nome: 'DRAFT', ativo: true, entraNoContexto: false },
  pendente: { nome: 'PENDING_REVIEW', ativo: true, entraNoContexto: false },
  'precisa-revisao': { nome: 'NEEDS_REVISION', ativo: true, entraNoContexto: false },
  aprovada: { nome: 'APPROVED', ativo: true, entraNoContexto: true }, // só a versão vigente
  rejeitada: { nome: 'REJECTED', ativo: true, entraNoContexto: false },
  substituida: { nome: 'SUPERSEDED', ativo: true, entraNoContexto: false },
});
// Corrigir uma versão em "precisa-revisao" cria uma versão NOVA (pendente);
// a versão em si não muda mais. Rollback também é versão nova (já aprovada).
const TRANSICOES_VERSAO = Object.freeze({
  rascunho: ['pendente'],
  pendente: ['aprovada', 'rejeitada', 'precisa-revisao'],
  'precisa-revisao': [],
  aprovada: ['substituida'],
  rejeitada: [],
  substituida: [],
});
const ESTADOS_MEMORIA = Object.freeze({
  pendente: { nome: 'PENDING', descricao: 'sem versão aprovada' },
  ativa: { nome: 'ACTIVE', descricao: 'tem versão aprovada vigente' },
  arquivada: { nome: 'ARCHIVED', descricao: 'fora do contexto; o histórico continua' },
});
const TRANSICOES_MEMORIA = Object.freeze({
  pendente: ['ativa', 'arquivada'],
  ativa: ['arquivada'],
  arquivada: ['ativa', 'pendente'],
});

// somenteAtivos: recusa estados reservados (o que os serviços podem gravar HOJE).
function transicaoVersaoPermitida(de, para, { somenteAtivos = true } = {}) {
  if (!ESTADOS_VERSAO[de] || !ESTADOS_VERSAO[para]) return false;
  if (somenteAtivos && !(ESTADOS_VERSAO[de].ativo && ESTADOS_VERSAO[para].ativo)) return false;
  return TRANSICOES_VERSAO[de].includes(para);
}

// A única regra do que vale no contexto: ativa, com versão aprovada vigente
// e (memória de tarefa) ainda não expirada.
function memoriaVigente(m, agora) {
  return !!(m && m.status === 'ativa' && m.vigente && m.versaoVigente && (!m.expiraEm || m.expiraEm > agora));
}

// Modelo canônico: o Firestore é a fonte oficial (D1). Documento base em
// caminhos.memoria(...) e versões imutáveis em {base}/versoes/{n}.
const ESQUEMA_DECISAO = (motivoObrigatorio) => ({
  tipo: 'objeto', extras: false,
  campos: { por: { tipo: 'texto', obrigatorio: true }, em: { tipo: 'texto', obrigatorio: true }, motivo: { tipo: 'texto', obrigatorio: motivoObrigatorio } },
});
const ESQUEMA_APROVACAO = Object.assign(ESQUEMA_DECISAO(false), { nulo: true });
const ESQUEMA_VIGENTE = {
  tipo: 'objeto', obrigatorio: true, nulo: true, extras: false,
  campos: {
    versao: { tipo: 'inteiro', obrigatorio: true, min: 1 },
    titulo: { tipo: 'texto', obrigatorio: true },
    conteudo: { tipo: 'texto', obrigatorio: true },
    tags: { tipo: 'lista' },
    evidencias: { tipo: 'lista', itens: ESQUEMA_EVIDENCIA },
  },
};
const ESQUEMA_DOC_MEMORIA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto' }, // presente quando lido (não é gravado)
    escopo: { tipo: 'texto', obrigatorio: true, valores: ESCOPOS },
    alvo: ESQUEMA_ALVO,
    categoria: { tipo: 'texto', obrigatorio: true },
    chave: { tipo: 'texto', obrigatorio: true, nulo: true },
    status: { tipo: 'texto', obrigatorio: true, valores: Object.keys(ESTADOS_MEMORIA) },
    versaoVigente: { tipo: 'inteiro', obrigatorio: true, nulo: true, min: 1 },
    ultimaVersao: { tipo: 'inteiro', obrigatorio: true, min: 0 },
    vigente: ESQUEMA_VIGENTE,
    criadoEm: { tipo: 'texto', obrigatorio: true },
    criadoPor: { tipo: 'texto', obrigatorio: true },
    propostoPorAgente: { tipo: 'texto', obrigatorio: true, nulo: true },
    atualizadoEm: { tipo: 'texto', obrigatorio: true },
    atualizadoPor: { tipo: 'texto' },
    arquivadaEm: { tipo: 'texto' },
    expiraEm: { tipo: 'texto' },
  },
};
const ESQUEMA_DOC_VERSAO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto' },
    n: { tipo: 'inteiro', obrigatorio: true, min: 1 },
    status: { tipo: 'texto', obrigatorio: true, valores: Object.keys(ESTADOS_VERSAO) },
    titulo: { tipo: 'texto', obrigatorio: true },
    conteudo: { tipo: 'texto', obrigatorio: true },
    tags: { tipo: 'lista', obrigatorio: true },
    evidencias: { tipo: 'lista', itens: ESQUEMA_EVIDENCIA },
    origem: ESQUEMA_ORIGEM, // proveniência: de onde veio esta versão
    criadoEm: { tipo: 'texto', obrigatorio: true },
    criadoPor: { tipo: 'texto', obrigatorio: true },
    aprovacao: Object.assign({}, ESQUEMA_APROVACAO, { obrigatorio: true }),
    rejeicao: ESQUEMA_DECISAO(false), // registros antigos podem não ter motivo
    // Fase 3B (campos novos; registros antigos não têm)
    baseVersao: { tipo: 'inteiro', nulo: true, min: 1 }, // versão vigente quando esta foi criada
    envio: ESQUEMA_DECISAO(false), // rascunho → pendente
    revisao: ESQUEMA_DECISAO(true), // pendente → precisa-revisao (com o motivo)
    sinais: { tipo: 'lista', itens: { tipo: 'texto' } }, // sinais de instrução escondida no texto
    alertas: {
      tipo: 'objeto', extras: false,
      campos: { duplicados: { tipo: 'lista', obrigatorio: true }, conflitos: { tipo: 'lista', obrigatorio: true } },
    },
    confirmacoes: {
      tipo: 'objeto', extras: false,
      campos: {
        semDadosDeCliente: ESQUEMA_DECISAO(false), sinais: ESQUEMA_DECISAO(false),
        // decisão do Super Admin sobre duplicidade/conflito, presa à assinatura da situação
        conflitos: {
          tipo: 'objeto', extras: false,
          campos: {
            por: { tipo: 'texto', obrigatorio: true }, em: { tipo: 'texto', obrigatorio: true }, motivo: { tipo: 'texto', obrigatorio: true, min: 3 },
            assinatura: { tipo: 'texto', obrigatorio: true, padrao: /^[0-9a-f]{64}$/ },
            itens: { tipo: 'lista', obrigatorio: true, min: 1 },
          },
        },
      },
    },
    substituidaEm: { tipo: 'texto' },
  },
};

// Confere um registro gravado (esquema + coerência). Devolve a lista de problemas.
function conferirRegistroMemoria(doc) {
  const erros = validar(ESQUEMA_DOC_MEMORIA, doc);
  if (erros.length) return erros;
  try { alvoDoEscopo(doc.escopo, doc.alvo); } catch (e) { erros.push(e.message); }
  if (!ESCOPO_INFO[doc.escopo].categorias.includes(doc.categoria)) erros.push(`categoria fora do escopo: ${doc.categoria}`);
  if (doc.versaoVigente && doc.versaoVigente > doc.ultimaVersao) erros.push('versaoVigente maior que ultimaVersao');
  if (!doc.versaoVigente !== !doc.vigente) erros.push('versaoVigente e vigente precisam existir juntos');
  if (doc.vigente && doc.vigente.versao !== doc.versaoVigente) erros.push('vigente não é a versão vigente');
  if (doc.status === 'ativa' && !doc.versaoVigente) erros.push('memória ativa sem versão aprovada');
  if (doc.escopo === 'tarefa' && !doc.expiraEm) erros.push('memória de tarefa sem expiração');
  return erros;
}
function conferirVersaoMemoria(v) {
  const erros = validar(ESQUEMA_DOC_VERSAO, v);
  if (erros.length) return erros;
  if (['aprovada', 'substituida'].includes(v.status) && !v.aprovacao) erros.push(`versão ${v.status} sem registro de aprovação`);
  if (['pendente', 'rascunho'].includes(v.status) && v.aprovacao) erros.push(`versão ${v.status} não pode ter aprovação`);
  if (v.status === 'rejeitada' && !v.rejeicao) erros.push('versão rejeitada sem registro de rejeição');
  if (v.status === 'precisa-revisao' && !v.revisao) erros.push('versão em revisão sem o pedido de revisão');
  if (v.baseVersao && v.baseVersao >= v.n) erros.push('baseVersao precisa ser anterior à própria versão');
  if (v.origem && v.origem.tipo === 'rollback' && !v.origem.versaoDe) erros.push('rollback sem a versão de origem');
  return erros;
}

// Representação Markdown: DERIVADA de uma versão APROVADA gravada (D1).
// Gerada sob demanda (memoria/markdown.js) e devolvida ao Super Admin; não é
// gravada em lugar nenhum (nem no repositório público). A importação de
// Markdown não está implementada.
const CONTRATO_MARKDOWN = Object.freeze({
  fonteOficial: 'firestore',
  derivado: true,
  disponivel: true,
  etapa: '3B',
  formato: 'markdown com cabeçalho YAML (valores em JSON, que é YAML válido)',
  geradoDe: 'uma versão aprovada ou substituída (nunca rascunho, pendente, em revisão ou rejeitada)',
  persistencia: 'nenhuma: gerado na hora e devolvido',
  importacao: 'não implementada (quando existir, cria uma versão pendente; nunca grava por cima)',
  cabecalho: Object.freeze(['fonte', 'confianca', 'id', 'escopo', 'alvo', 'categoria', 'chave', 'titulo', 'tags', 'versao', 'status', 'estadoMemoria', 'origem', 'criadoPor', 'criadoEm', 'aprovadoPor', 'aprovadoEm', 'sha256']),
});

// Auditoria: eventos que os serviços gravam HOJE e os reservados (3B a 3D).
// Eventos de consulta guardam só ids e versões, nunca o conteúdo.
const EVENTOS_MEMORIA = Object.freeze({
  ativos: Object.freeze([
    'memoria.criada', 'memoria.versao_criada', 'memoria.versao_aprovada', 'memoria.versao_rejeitada',
    'memoria.rollback', 'memoria.arquivada', 'memoria.reativada',
    'memoria.enviada_para_revisao', 'memoria.revisao_pedida', 'memoria.exportada_markdown', 'memoria.trava_global',
    'memoria.conflito_bloqueado',
    'correcao.registrada', 'aprendizado.proposto', 'aprendizado.aprovado', 'aprendizado.rejeitado',
  ]),
  reservados: Object.freeze(['memoria.importada_markdown', 'memoria.contexto_montado']),
});

module.exports = {
  ESCOPOS, ESCOPO_INFO, DOCUMENTOS_CLIENTE, STATUS_MEMORIA, STATUS_VERSAO, ORIGENS, ALCANCES, STATUS_APRENDIZADO,
  ESQUEMA_NOVA_MEMORIA, ESQUEMA_CORRECAO, ESQUEMA_EVIDENCIA, ESQUEMA_ALVO,
  alvoDoEscopo, ESTADOS_VERSAO, TRANSICOES_VERSAO, ESTADOS_MEMORIA, TRANSICOES_MEMORIA, transicaoVersaoPermitida, memoriaVigente,
  ESQUEMA_ORIGEM, ESQUEMA_DOC_MEMORIA, ESQUEMA_DOC_VERSAO, conferirRegistroMemoria, conferirVersaoMemoria,
  CONTRATO_MARKDOWN, EVENTOS_MEMORIA,
};
