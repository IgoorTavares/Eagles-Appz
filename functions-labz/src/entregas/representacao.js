// Fase 4C.2 (passo 1): REPRESENTAÇÃO MARKDOWN derivada de um documento
// estruturado. Só o contrato e o gerador (para validar os contratos); gravar e
// mostrar ficam para o próximo passo.
//
// Regras:
//  - o Markdown é DERIVADO: gerado pelo sistema, de forma determinística, a partir
//    do documento validado. Nunca vem do modelo;
//  - não é uma segunda entrega nem tem aprovação própria: pertence à MESMA versão
//    da MESMA entrega (o descritor leva entregaId + versão + hash da origem);
//  - não há divergência silenciosa: conferirRepresentacao gera de novo e compara
//    byte a byte, e o cabeçalho leva o sha256 do documento de origem;
//  - todo texto do documento é DADO não confiável: HTML e marcações de Markdown são
//    escapados, e campos de uma linha não quebram linha (nada vira link, imagem,
//    script, título ou comentário). O cabeçalho só contém valores do sistema.
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');
const { obterDocumento, validarDocumento, VERSAO_CONTRATO } = require('../contratos/documentos');

const VERSAO_GERADOR = 1;
const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// JSON canônico (chaves em ordem): o mesmo documento dá sempre o mesmo hash.
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
// O documento completo (envelope) que será guardado no passo seguinte.
const envelope = (documentoId, dados) => ({ documento: documentoId, contrato: VERSAO_CONTRATO, dados });
const hashDoDocumento = (documentoId, dados) => sha256(canonico(envelope(documentoId, dados)));

// Escapa um DADO para Markdown/HTML: nada vira marcação.
function escapar(texto, umaLinha) {
  let s = String(texto);
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  s = s.replace(/([\\`*_{}[\]()#+\-.!|~:])/g, '\\$1');
  if (umaLinha) s = s.replace(/\s*[\r\n]+\s*/g, ' ');
  else s = s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('  \n');
  return s.trim();
}

// Rótulos (do sistema) dos campos. Campo sem rótulo usa o próprio nome.
const ROTULOS = {
  titulo: 'Título', objetivo: 'Objetivo', publico: 'Público', mensagensChave: 'Mensagens-chave', canais: 'Canais', cronograma: 'Cronograma',
  riscos: 'Riscos', metricasSucesso: 'Métricas de sucesso', resumo: 'Resumo', entregas: 'Entregas', pendencias: 'Pendências', proximosPassos: 'Próximos passos',
  marca: 'Marca', posicionamento: 'Posicionamento', paleta: 'Paleta de cores', tipografia: 'Tipografia', tomDeVoz: 'Tom de voz', orientacoesUso: 'Orientações de uso',
  peca: 'Peça', formato: 'Formato', hierarquia: 'Hierarquia', elementos: 'Elementos', textoDaPeca: 'Texto da peça', referenciasMarca: 'Referências da marca', restricoes: 'Restrições',
  quantidadeSlides: 'Quantidade de slides', slides: 'Slides', chamadaParaAcao: 'Chamada para ação', legenda: 'Legenda', duracaoSegundos: 'Duração (s)', cenas: 'Cenas',
  plataforma: 'Plataforma', texto: 'Texto', hashtags: 'Hashtags', publicos: 'Públicos', estrategia: 'Estratégia', orcamentoSugerido: 'Orçamento sugerido (não é gasto)',
  hipoteses: 'Hipóteses', indicadores: 'Indicadores', escopo: 'Escopo', componentes: 'Componentes', dependencias: 'Dependências', recomendacoes: 'Recomendações',
  contexto: 'Contexto', decisoes: 'Decisões', testes: 'Testes (propostos; nada é executado)',
  e: 'É', naoE: 'Não é', nome: 'Nome', hex: 'Código', uso: 'Uso', familia: 'Família', pesos: 'Pesos', ordem: 'Ordem', periodo: 'Período', fala: 'Fala', visual: 'Visual',
  textoNaTela: 'Texto na tela', numero: 'Slide', descricao: 'Descrição', metrica: 'Métrica', evidencia: 'Evidência', fonte: 'Fonte', meta: 'Meta', tipo: 'Tipo',
  observacao: 'Observação', mitigacao: 'Mitigação', decisao: 'Decisão', motivo: 'Motivo', situacao: 'Situação', valor: 'Valor', moeda: 'Moeda',
  somenteSugestao: 'Somente sugestão', etapaId: 'Etapa', entregaId: 'Entrega', versao: 'Versão', hash: 'Hash',
};
const rotulo = (k) => escapar(ROTULOS[k] || k, true);

// Valor simples (uma linha).
const simples = (v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : escapar(v, true));

// Objeto como pares "Rótulo: valor", na ORDEM do esquema (determinística).
function pares(valor, esquema) {
  const campos = Object.keys((esquema && esquema.campos) || valor);
  return campos.filter((k) => valor[k] !== undefined).map((k) => {
    const v = valor[k];
    if (Array.isArray(v)) return `${rotulo(k)}: ${v.length ? v.map(simples).join('; ') : '—'}`;
    if (v && typeof v === 'object') return `${rotulo(k)}: ${pares(v, esquema.campos[k]).join('; ')}`;
    return `${rotulo(k)}: ${simples(v)}`;
  });
}

function secao(k, v, esq) {
  const titulo = `## ${rotulo(k)}`;
  if (Array.isArray(v)) {
    if (!v.length) return `${titulo}\n\n_Nenhum item._`;
    const itens = v.map((x, i) => (x && typeof x === 'object' ? `${i + 1}. ${pares(x, esq.itens).join(' · ')}` : `- ${simples(x)}`));
    return `${titulo}\n\n${itens.join('\n')}`;
  }
  if (v && typeof v === 'object') return `${titulo}\n\n${pares(v, esq).map((l) => `- ${l}`).join('\n')}`;
  if (typeof v === 'string' && v.includes('\n')) return `${titulo}\n\n${escapar(v, false)}`;
  return `${titulo}\n\n${simples(v)}`;
}

// Gera o Markdown de um documento VÁLIDO. Documento inválido não tem representação.
// → { markdown, hashOrigem, hash, tamanho, gerador }
function gerarMarkdown(documentoId, dados) {
  const doc = obterDocumento(documentoId);
  if (!doc) throw erro('invalido', 'Documento inexistente');
  const v = validarDocumento(documentoId, dados);
  if (!v.valido) throw erro('invalido', 'Documento inválido: não há representação para ele', v.problemas);
  const hashOrigem = hashDoDocumento(documentoId, dados);
  const cab = `<!-- labz-documento id=${documentoId} contrato=${VERSAO_CONTRATO} gerador=${VERSAO_GERADOR} origem-sha256=${hashOrigem} -->`;
  const corpo = Object.keys(doc.esquema.campos).filter((k) => dados[k] !== undefined).map((k) => secao(k, dados[k], doc.esquema.campos[k]));
  const markdown = `${cab}\n# ${escapar(doc.nome, true)}\n\n${corpo.join('\n\n')}\n`;
  return { markdown, hashOrigem, hash: sha256(markdown), tamanho: Buffer.byteLength(markdown, 'utf8'), gerador: VERSAO_GERADOR };
}

// A representação guardada corresponde EXATAMENTE ao documento? (gera de novo e compara)
// Documento inválido nunca "confere" (não tem representação válida).
function conferirRepresentacao(documentoId, dados, markdown) {
  let g;
  try { g = gerarMarkdown(documentoId, dados); } catch (e) { return { confere: false, motivo: 'documento-invalido', esperado: null, recebido: sha256(String(markdown)) }; }
  return { confere: g.markdown === markdown, motivo: g.markdown === markdown ? 'ok' : 'divergente', esperado: g.hash, recebido: sha256(String(markdown)) };
}

// Descritor da representação, preso à MESMA entrega e versão (sem entrega nem aprovação próprias).
function descreverRepresentacao({ entregaId, versao, documentoId, dados }) {
  if (typeof entregaId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entregaId) || !Number.isInteger(versao) || versao < 1) throw erro('invalido', 'Entrega e versão obrigatórias');
  const g = gerarMarkdown(documentoId, dados);
  return Object.freeze({ entregaId, versao, documento: documentoId, formato: 'markdown', derivada: true, aprovacaoPropria: false, gerador: g.gerador, hashOrigem: g.hashOrigem, hash: g.hash, tamanho: g.tamanho });
}

module.exports = { gerarMarkdown, conferirRepresentacao, descreverRepresentacao, hashDoDocumento, canonico, escapar, envelope, VERSAO_GERADOR };
