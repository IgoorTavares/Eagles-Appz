// Fase 4C.1: armazenamento do CONTEÚDO das entregas, separado dos metadados.
// Nesta fase só existe o armazenamento "banco-local": texto pequeno (até
// MAX_BYTES_LOCAL) num documento DENTRO da execução, endereçado pelo sha256 dos
// bytes guardados (labz_tarefas/{execucao}/labz_conteudos/{sha256}):
//  - o mesmo conteúdo na mesma execução é guardado uma vez só e NUNCA sobrescrito;
//  - a referência (caminho) é montada SÓ aqui, a partir da execução e do hash:
//    nada de caminho vindo de fora (sem path traversal, sem link externo);
//  - ao ler, o hash é recalculado: conteúdo alterado por fora é recusado.
// O hash prova que o conteúdo é o mesmo que foi guardado; NÃO prova autoria nem
// que o material é seguro.
// Formatos ainda não suportados (imagem, carrossel, pacote) guardam só uma
// REPRESENTAÇÃO SIMULADA (manifesto JSON com arquivoReal: false): nenhum arquivo é fingido.
// Futuro (com autorização): um adaptador de Cloud Storage com a mesma interface
// (preparar / gravar / ler) e referências { armazenamento: 'cloud-storage', ... }.
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');
const { caminhos } = require('../armazenamento/caminhos');
const { FORMATOS, MAX_BYTES_LOCAL } = require('../contratos/entrega');

const ARMAZENAMENTO_LOCAL = 'banco-local';
const sha256 = (texto) => crypto.createHash('sha256').update(Buffer.from(texto, 'utf8')).digest('hex');

// Valida o conteúdo e devolve EXATAMENTE o que será guardado (e o hash dele).
function prepararConteudo(c) {
  const formato = c.formato;
  let texto;
  const metadados = { mime: FORMATOS[formato].mime };
  if (formato === 'simulado') {
    if (c.texto !== undefined) throw erro('invalido', 'Formato simulado não aceita bytes: só a representação');
    if (!c.representacao) throw erro('invalido', 'Formato simulado precisa da representação do que será o arquivo');
    texto = JSON.stringify({ arquivoReal: false, aviso: 'REPRESENTAÇÃO SIMULADA: nenhum arquivo foi gerado', representacao: c.representacao });
  } else {
    if (c.representacao !== undefined) throw erro('invalido', 'Representação simulada só no formato "simulado"');
    if (typeof c.texto !== 'string' || !c.texto.length) throw erro('invalido', 'Conteúdo de texto obrigatório');
    if (c.texto.includes('\u0000')) throw erro('invalido', 'Conteúdo com caractere nulo');
    if (formato === 'json') {
      try { const v = JSON.parse(c.texto); if (!v || typeof v !== 'object') throw new Error('x'); } catch (e) { throw erro('invalido', 'O conteúdo não é um JSON válido (objeto ou lista)'); }
    }
    if (formato === 'codigo') {
      if (!c.linguagem) throw erro('invalido', 'Arquivo de código precisa da linguagem');
      metadados.linguagem = c.linguagem;
      metadados.inerte = true; // guardado como texto: nunca executado nem renderizado pelo sistema
    } else if (c.linguagem !== undefined) throw erro('invalido', 'Linguagem só em arquivo de código');
    texto = c.texto;
  }
  const tamanho = Buffer.byteLength(texto, 'utf8');
  if (tamanho > MAX_BYTES_LOCAL) throw erro('invalido', `Conteúdo grande demais para o armazenamento local (${tamanho} bytes; máximo ${MAX_BYTES_LOCAL}). Arquivos grandes aguardam o armazenamento de arquivos (fase futura).`);
  metadados.caracteres = texto.length;
  return { formato, texto, hash: sha256(texto), tamanho, arquivoReal: formato !== 'simulado', metadados };
}

// Grava (ou reaproveita) o conteúdo na transação t. Devolve a referência.
async function gravarConteudo(t, execucaoId, preparado, agora) {
  const caminho = caminhos.conteudoExecucao(execucaoId, preparado.hash);
  const existente = await t.obter(caminho);
  if (existente) {
    if (existente.hash !== preparado.hash || sha256(existente.texto) !== preparado.hash) throw erro('integridade', 'Conteúdo guardado não confere com o hash');
  } else {
    await t.gravar(caminho, { texto: preparado.texto, hash: preparado.hash, tamanho: preparado.tamanho, formato: preparado.formato, criadoEm: agora });
  }
  return { armazenamento: ARMAZENAMENTO_LOCAL, caminho, hash: preparado.hash, tamanho: preparado.tamanho };
}

// A referência só vale se for EXATAMENTE a que o backend monta para aquela execução e hash.
function conferirReferencia(ref, execucaoId) {
  if (!ref || ref.armazenamento !== ARMAZENAMENTO_LOCAL) throw erro('invalido', 'Referência de armazenamento desconhecida');
  let esperado;
  try { esperado = caminhos.conteudoExecucao(execucaoId, ref.hash); } catch (e) { throw erro('invalido', 'Referência de conteúdo inválida'); }
  if (ref.caminho !== esperado) throw erro('invalido', 'Referência de conteúdo fora da execução da entrega');
  return esperado;
}

// Lê e CONFERE a integridade (leitor: banco ou transação).
async function lerConteudo(leitor, ref, execucaoId) {
  const caminho = conferirReferencia(ref, execucaoId);
  const doc = await leitor.obter(caminho);
  if (!doc) throw erro('integridade', 'Conteúdo da entrega não encontrado');
  if (typeof doc.texto !== 'string' || sha256(doc.texto) !== ref.hash) throw erro('integridade', 'O conteúdo guardado não confere com o hash registrado');
  return { texto: doc.texto, hash: ref.hash, tamanho: Buffer.byteLength(doc.texto, 'utf8'), integridade: 'conferida' };
}

module.exports = { prepararConteudo, gravarConteudo, lerConteudo, conferirReferencia, sha256, ARMAZENAMENTO_LOCAL };
