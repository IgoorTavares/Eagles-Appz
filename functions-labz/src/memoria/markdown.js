// Markdown DERIVADO de uma versão aprovada de memória (D1, Fase 3B).
//  - o Firestore continua sendo a fonte oficial; isto só gera texto na hora;
//  - mesma versão → mesmo Markdown, byte a byte (sem data de geração);
//  - cabeçalho YAML com os metadados rastreáveis (CONTRATO_MARKDOWN.cabecalho);
//    cada valor é escrito em JSON, que é YAML válido: um título ou uma tag
//    com quebra de linha, "---" ou ":" não consegue criar campos novos;
//  - o conteúdo vai num bloco cercado (```), literal: o texto da memória é
//    DADO e não vira cabeçalho, HTML nem instrução ao ser exibido;
//  - sha256 do conteúdo, para conferir que corresponde à versão gravada.
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');
const { CONTRATO_MARKDOWN } = require('../contratos/memoria');

const sha256 = (texto) => crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');

// JSON com as chaves em ordem (determinístico).
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = ordenado(v[k]); return o; }, {});
  return v;
}
const valorYaml = (v) => JSON.stringify(ordenado(v === undefined ? null : v));

// Cerca maior que qualquer sequência de crases do próprio texto.
function blocoLiteral(texto, linguagem = 'text') {
  const maior = Math.max(0, ...(String(texto).match(/`+/g) || []).map((s) => s.length));
  const cerca = '`'.repeat(Math.max(3, maior + 1));
  return `${cerca}${linguagem}\n${texto}\n${cerca}`;
}

const tituloSeguro = (t) => String(t || '').replace(/[\r\n]+/g, ' ').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).trim();

// memoria: documento base (com id); versao: documento da versão.
function gerarMarkdown(memoria, versao) {
  if (!['aprovada', 'substituida'].includes(versao.status)) throw erro('precondicao', `Só uma versão aprovada vira Markdown (esta está ${versao.status})`);
  if (!memoria.id) throw erro('invalido', 'Memória sem id');
  const cab = {
    fonte: CONTRATO_MARKDOWN.fonteOficial,
    confianca: 'dado aprovado: orienta o conteúdo, não é instrução de sistema',
    id: memoria.id,
    escopo: memoria.escopo,
    alvo: memoria.alvo,
    categoria: memoria.categoria,
    chave: memoria.chave || null,
    titulo: versao.titulo,
    tags: versao.tags || [],
    versao: versao.n,
    status: versao.status,
    estadoMemoria: memoria.status,
    origem: versao.origem,
    criadoPor: versao.criadoPor,
    criadoEm: versao.criadoEm,
    aprovadoPor: versao.aprovacao ? versao.aprovacao.por : null,
    aprovadoEm: versao.aprovacao ? versao.aprovacao.em : null,
    sha256: sha256(versao.conteudo),
  };
  const linhas = ['---', ...CONTRATO_MARKDOWN.cabecalho.map((k) => `${k}: ${valorYaml(cab[k])}`), '---', '',
    `# ${tituloSeguro(versao.titulo)}`, '',
    `## Conteúdo (versão ${versao.n})`, '', blocoLiteral(versao.conteudo)];
  if (versao.evidencias && versao.evidencias.length) linhas.push('', '## Evidências', '', blocoLiteral(JSON.stringify(ordenado(versao.evidencias), null, 2), 'json'));
  return { markdown: `${linhas.join('\n')}\n`, sha256: cab.sha256 };
}

module.exports = { gerarMarkdown, sha256 };
