// Fase 4C.1: contrato das ENTREGAS (o que os agentes produzem).
// Uma entrega = metadados (labz_entregas/{id}) + versões IMUTÁVEIS
// (labz_entregas/{id}/labz_versoes_entrega/{n}) + conteúdo guardado À PARTE,
// endereçado pelo próprio hash (labz_tarefas/{execucao}/labz_conteudos/{sha256}).
// Ids, empresa, execução, caminhos e hash são do BACKEND: nada disso vem do modelo.
// Nome, descrição e conteúdo produzidos por IA são DADOS não confiáveis.
const { erro } = require('../nucleo/erros');

// Os 8 tipos previstos. "suportado": há armazenamento funcional nesta fase
// (só texto, seguro e local). Os outros só têm REPRESENTAÇÃO SIMULADA: um
// manifesto do que será o arquivo, marcado arquivoReal: false (nenhum arquivo é fingido).
const TIPOS = Object.freeze({
  documento: { formatos: ['markdown', 'texto', 'json', 'csv'], suportado: true },
  roteiro: { formatos: ['json', 'markdown', 'texto'], suportado: true },
  planejamento: { formatos: ['markdown', 'json', 'texto', 'csv'], suportado: true },
  relatorio: { formatos: ['markdown', 'texto', 'json', 'csv'], suportado: true },
  codigo: { formatos: ['codigo'], suportado: true }, // texto INERTE: nunca executado nem renderizado
  imagem: { formatos: ['simulado'], suportado: false },
  carrossel: { formatos: ['simulado'], suportado: false },
  pacote: { formatos: ['simulado'], suportado: false },
});
const FORMATOS = Object.freeze({
  markdown: { mime: 'text/markdown', extensoes: ['md'] },
  texto: { mime: 'text/plain', extensoes: ['txt'] },
  json: { mime: 'application/json', extensoes: ['json'] },
  csv: { mime: 'text/csv', extensoes: ['csv'] },
  codigo: { mime: 'text/plain', extensoes: ['js', 'mjs', 'ts', 'py', 'html', 'css', 'sql', 'sh', 'json', 'md', 'txt'] },
  simulado: { mime: 'application/vnd.labz.representacao-simulada+json', extensoes: ['png', 'jpg', 'svg', 'pdf', 'zip'] },
});
const LINGUAGENS = ['javascript', 'typescript', 'python', 'html', 'css', 'sql', 'shell', 'json', 'markdown', 'texto'];

// Estado de CADA versão. Aprovar, rejeitar e pedir revisão: só o Super Admin.
const ESTADOS = ['rascunho', 'em-revisao', 'aprovada', 'rejeitada', 'precisa-revisao'];
const TRANSICOES = Object.freeze({
  rascunho: ['em-revisao', 'aprovada', 'rejeitada', 'precisa-revisao'],
  'em-revisao': ['aprovada', 'rejeitada', 'precisa-revisao'],
  aprovada: [], rejeitada: [], 'precisa-revisao': [], // finais: mudança = versão NOVA
});
const DECISOES_DO_SUPER_ADMIN = ['aprovada', 'rejeitada', 'precisa-revisao'];

// Limite do armazenamento local (texto no Firestore): bem abaixo de 1 MiB por documento.
const MAX_BYTES_LOCAL = 200 * 1024;
const MAX_NOME = 120;
const MAX_DESCRICAO = 1000;

// Nome do material: um NOME, nunca um caminho. Recusa barra, "..", controle,
// começo com ponto, protocolo e extensão fora do formato.
function validarNome(nome, formato) {
  const n = typeof nome === 'string' ? nome.normalize('NFC').trim() : '';
  const p = [];
  if (!n || n.length > MAX_NOME) p.push('nome vazio ou longo demais');
  if (/[\\/]/.test(n) || n.includes('..') || n.startsWith('.') || n.startsWith('~')) p.push('nome com cara de caminho');
  if (/[\u0000-\u001f\u007f<>:"|?*%]/.test(n)) p.push('caracteres não permitidos no nome');
  if (/^[a-z][a-z0-9+.-]*:/i.test(n)) p.push('nome com protocolo (link)');
  const ext = (n.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  const f = FORMATOS[formato];
  if (!f) p.push('formato desconhecido');
  else if (!ext || !f.extensoes.includes(ext.toLowerCase())) p.push(`extensão não permitida para ${formato} (${f.extensoes.join(', ')})`);
  if (p.length) throw erro('invalido', 'Nome de entrega inválido', p);
  return n;
}

function exigirTipoFormato(tipo, formato) {
  const t = TIPOS[tipo];
  if (!t) throw erro('invalido', `Tipo de entrega desconhecido: ${String(tipo).slice(0, 30)}`);
  if (!t.formatos.includes(formato)) throw erro('invalido', `O tipo ${tipo} não aceita o formato ${String(formato).slice(0, 30)} nesta fase`, { aceitos: t.formatos });
  return t;
}

const transicaoPermitida = (de, para) => ESTADOS.includes(de) && (TRANSICOES[de] || []).includes(para);

// Entrada de uma versão (o Super Admin pela API ou o motor a partir de uma etapa).
const ESQUEMA_CONTEUDO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    formato: { tipo: 'texto', obrigatorio: true, valores: Object.keys(FORMATOS) },
    nome: { tipo: 'texto', obrigatorio: true, min: 1, max: MAX_NOME },
    descricao: { tipo: 'texto', max: MAX_DESCRICAO },
    texto: { tipo: 'texto', max: MAX_BYTES_LOCAL }, // formatos de texto
    linguagem: { tipo: 'texto', valores: LINGUAGENS }, // só "codigo"
    // só "simulado": o que SERIA o arquivo (nada de bytes de imagem nesta fase)
    representacao: {
      tipo: 'objeto', extras: false,
      campos: {
        descricao: { tipo: 'texto', obrigatorio: true, min: 3, max: 2000 },
        largura: { tipo: 'inteiro', min: 1, max: 10000 }, altura: { tipo: 'inteiro', min: 1, max: 10000 },
        paginas: { tipo: 'inteiro', min: 1, max: 50 },
        itens: { tipo: 'lista', max: 50, itens: { tipo: 'texto', min: 1, max: 300 } },
      },
    },
  },
};
const ESQUEMA_NOVA_ENTREGA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    execucaoId: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z0-9_-]{1,80}$/ },
    etapaId: { tipo: 'texto', nulo: true, padrao: /^[a-z0-9-]{1,30}$/ },
    agenteId: { tipo: 'texto', nulo: true, padrao: /^0[1-8]-[a-z-]+$/ },
    tipo: { tipo: 'texto', obrigatorio: true, valores: Object.keys(TIPOS) },
    conteudo: ESQUEMA_CONTEUDO,
  },
};

module.exports = {
  TIPOS, FORMATOS, LINGUAGENS, ESTADOS, TRANSICOES, DECISOES_DO_SUPER_ADMIN, MAX_BYTES_LOCAL,
  validarNome, exigirTipoFormato, transicaoPermitida, ESQUEMA_CONTEUDO, ESQUEMA_NOVA_ENTREGA,
};
