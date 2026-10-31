// Fase 4C.2 (passo 1): CONTRATOS dos documentos estruturados que os agentes
// poderão produzir. Só contratos e validação: a geração, o armazenamento e o
// compartilhamento ficam para os próximos passos.
//
// Cada documento:
//  - tem um id fixo no catálogo (o modelo não inventa tipo);
//  - diz quais agentes podem produzi-lo (a permissão é do catálogo, nunca do modelo);
//  - diz em que TIPO DE ENTREGA da 4C.1 ele vira (mesmo Registro de Entregas);
//  - tem um esquema FECHADO (sem campos extras: nada de cliente, permissões,
//    limites, ids ou caminhos dentro do documento) + regras estruturais próprias;
//  - tem um limite de tamanho em bytes do JSON.
// Validação ESTRUTURAL: confere formato, quantidades, códigos e somas. NÃO avalia
// qualidade criativa nem se o que está escrito é verdadeiro.
// Todo texto dentro de um documento é DADO não confiável (veio de um modelo).
const { validar } = require('../nucleo/validador');
const { TIPOS } = require('./entrega');

const VERSAO_CONTRATO = 1;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const ETAPA = /^[a-z0-9-]{1,30}$/;
const ID_ENTREGA = /^[A-Za-z0-9_-]{1,80}$/;
const SHA = /^[0-9a-f]{64}$/;

// Textos: limites de tamanho por uso.
const t = (max, min = 1) => ({ tipo: 'texto', obrigatorio: true, min, max });
const tOpc = (max) => ({ tipo: 'texto', max });
const lista = (itens, min, max, obrigatorio = true) => ({ tipo: 'lista', obrigatorio, min, max, itens });
const obj = (campos, obrigatorio = true) => ({ tipo: 'objeto', obrigatorio, extras: false, campos });
const int = (min, max, obrigatorio = true) => ({ tipo: 'inteiro', obrigatorio, min, max });

// Plataformas e limites PADRÃO de caracteres da legenda. Configuráveis para baixo
// (opcoes.limitesLegenda), nunca acima do máximo do contrato.
const LIMITES_LEGENDA = Object.freeze({ instagram: 2200, facebook: 5000, tiktok: 2200, linkedin: 3000, x: 280, youtube: 5000 });
const CANAIS_TRAFEGO = ['meta', 'google', 'tiktok', 'linkedin', 'youtube', 'pinterest', 'outro'];
// Formatos de peça aceitos no briefing (largura x altura, em px)
const FORMATOS_PECA = Object.freeze(['1080x1080', '1080x1350', '1080x1920', '1200x628', '1920x1080', '1280x720']);

// Caracteres de controle (exceto quebra de linha e tabulação) nunca entram num documento.
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;

// ---------- regras estruturais por documento (devolvem a lista de problemas) ----------
function sequencial(itens, campo, rotulo) {
  return itens.every((x, i) => x[campo] === i + 1) ? [] : [`${rotulo} fora de ordem: numere de 1 a ${itens.length}, sem pular`];
}

const REGRAS = {
  'diretrizes-marca': (d) => {
    const p = [];
    d.paleta.forEach((c, i) => { if (!HEX.test(c.hex)) p.push(`paleta[${i}].hex: código de cor inválido (use #RRGGBB)`); });
    const hexes = d.paleta.map((c) => c.hex.toUpperCase());
    if (new Set(hexes).size !== hexes.length) p.push('paleta: cor repetida');
    return p;
  },
  'roteiro-reels': (d) => {
    const p = sequencial(d.cenas, 'ordem', 'cenas');
    const soma = d.cenas.reduce((s, c) => s + c.duracaoSegundos, 0);
    if (soma !== d.duracaoSegundos) p.push(`duração: as cenas somam ${soma} s, mas o roteiro diz ${d.duracaoSegundos} s`);
    return p;
  },
  'legenda-social': (d, op) => {
    const limite = Math.min(LIMITES_LEGENDA[d.plataforma], (op.limitesLegenda || {})[d.plataforma] || Infinity);
    const total = [d.texto, d.chamadaParaAcao || '', ...(d.hashtags || [])].join(' ').trim().length;
    const p = [];
    if (total > limite) p.push(`legenda com ${total} caracteres: o limite para ${d.plataforma} é ${limite}`);
    const tags = (d.hashtags || []).map((h) => h.toLowerCase());
    if (new Set(tags).size !== tags.length) p.push('hashtags repetidas');
    return p;
  },
  'estrutura-carrossel': (d) => {
    const p = sequencial(d.slides, 'numero', 'slides');
    if (d.quantidadeSlides !== d.slides.length) p.push(`quantidade de slides: diz ${d.quantidadeSlides}, mas há ${d.slides.length}`);
    return p;
  },
  'plano-trafego': (d) => {
    const p = [];
    const canais = d.canais;
    if (new Set(canais).size !== canais.length) p.push('canais repetidos');
    return p;
  },
  'plano-estrategico': (d) => sequencial(d.cronograma, 'ordem', 'cronograma'),
  'briefing-design': () => [],
  'documentacao-tecnica': (d) => {
    const nomes = d.componentes.map((c) => c.nome.toLowerCase());
    return new Set(nomes).size === nomes.length ? [] : ['componentes com nome repetido'];
  },
  'relatorio-tecnico': () => [],
  'consolidacao-final': (d) => {
    const ids = d.entregas.map((e) => e.entregaId);
    return new Set(ids).size === ids.length ? [] : ['a mesma entrega aparece duas vezes'];
  },
};

// ---------- catálogo ----------
// agentes: quem pode produzir. tipoEntrega: o tipo da 4C.1. limiteBytes: JSON inteiro.
const DOCUMENTOS = Object.freeze({
  'plano-estrategico': {
    nome: 'Plano estratégico', agentes: ['08-estrategista'], tipoEntrega: 'planejamento', limiteBytes: 40 * 1024,
    esquema: obj({
      titulo: t(140, 3), objetivo: t(1000, 10), publico: t(1000, 3),
      mensagensChave: lista(t(300, 3), 1, 10), canais: lista(t(60, 2), 1, 10),
      cronograma: lista(obj({ ordem: int(1, 52), periodo: t(60, 2), entregas: lista(t(200, 3), 1, 10) }), 1, 26),
      riscos: lista(t(300, 3), 0, 10, false), metricasSucesso: lista(t(200, 3), 1, 10),
    }),
  },
  'consolidacao-final': {
    nome: 'Consolidação final', agentes: ['08-estrategista'], tipoEntrega: 'relatorio', limiteBytes: 40 * 1024,
    esquema: obj({
      titulo: t(140, 3), resumo: t(4000, 10),
      // referências EXATAS às entregas (no passo seguinte, preenchidas pelo backend)
      entregas: lista(obj({ etapaId: { tipo: 'texto', obrigatorio: true, padrao: ETAPA }, entregaId: { tipo: 'texto', obrigatorio: true, padrao: ID_ENTREGA }, versao: int(1, 100000), hash: { tipo: 'texto', obrigatorio: true, padrao: SHA } }), 0, 20),
      pendencias: lista(t(300, 3), 0, 20, false), proximosPassos: lista(t(300, 3), 0, 20, false),
    }),
  },
  'diretrizes-marca': {
    nome: 'Diretrizes de marca', agentes: ['01-guia-marca'], tipoEntrega: 'documento', limiteBytes: 32 * 1024,
    esquema: obj({
      marca: t(120, 2), posicionamento: tOpc(1000),
      paleta: lista(obj({ nome: t(60, 2), hex: t(7, 7), uso: tOpc(200) }), 1, 12),
      tipografia: lista(obj({ uso: t(60, 2), familia: t(80, 2), pesos: lista(int(100, 900), 0, 9, false) }), 1, 4),
      tomDeVoz: obj({ e: lista(t(120, 2), 1, 10), naoE: lista(t(120, 2), 0, 10, false) }),
      orientacoesUso: lista(t(300, 3), 1, 20), publico: tOpc(1000),
    }),
  },
  'briefing-design': {
    nome: 'Briefing de design', agentes: ['02-designer'], tipoEntrega: 'documento', limiteBytes: 16 * 1024,
    esquema: obj({
      peca: t(140, 3), objetivo: t(600, 5), formato: { tipo: 'texto', obrigatorio: true, valores: FORMATOS_PECA },
      hierarquia: lista(t(200, 2), 1, 6), elementos: lista(t(200, 2), 1, 15), textoDaPeca: t(600, 1),
      referenciasMarca: lista(t(200, 2), 0, 10, false), restricoes: lista(t(200, 3), 0, 10, false),
    }),
  },
  'estrutura-carrossel': {
    nome: 'Estrutura de carrossel', agentes: ['03-carrosseis'], tipoEntrega: 'roteiro', limiteBytes: 24 * 1024,
    esquema: obj({
      titulo: t(140, 3), quantidadeSlides: int(2, 10),
      slides: lista(obj({ numero: int(1, 10), titulo: t(120, 1), texto: t(300, 1), visual: tOpc(300) }), 2, 10),
      chamadaParaAcao: t(200, 3), legenda: tOpc(2200),
    }),
  },
  'roteiro-reels': {
    nome: 'Roteiro de Reels', agentes: ['04-roteirista'], tipoEntrega: 'roteiro', limiteBytes: 24 * 1024,
    esquema: obj({
      titulo: t(140, 3), objetivo: t(600, 5), duracaoSegundos: int(5, 180),
      cenas: lista(obj({ ordem: int(1, 30), duracaoSegundos: int(1, 60), fala: t(500, 1), visual: t(300, 2), textoNaTela: tOpc(120) }), 1, 30),
      chamadaParaAcao: t(200, 3),
    }),
  },
  'legenda-social': {
    nome: 'Legenda para redes sociais', agentes: ['04-roteirista'], tipoEntrega: 'roteiro', limiteBytes: 8 * 1024,
    esquema: obj({
      plataforma: { tipo: 'texto', obrigatorio: true, valores: Object.keys(LIMITES_LEGENDA) },
      texto: t(5000, 1), chamadaParaAcao: tOpc(200),
      hashtags: lista({ tipo: 'texto', padrao: /^#[\p{L}\p{N}_]{1,60}$/u }, 0, 30, false),
    }),
  },
  'plano-trafego': {
    nome: 'Plano de tráfego', agentes: ['07-trafego'], tipoEntrega: 'planejamento', limiteBytes: 32 * 1024,
    esquema: obj({
      objetivo: t(600, 5),
      publicos: lista(obj({ nome: t(80, 2), descricao: t(500, 3) }), 1, 10),
      canais: lista({ tipo: 'texto', valores: CANAIS_TRAFEGO }, 1, CANAIS_TRAFEGO.length),
      estrategia: t(3000, 10),
      // orçamento é SEMPRE sugestão: o contrato não aceita nada que pareça gasto
      orcamentoSugerido: obj({ valor: { tipo: 'numero', obrigatorio: true, min: 0, max: 10000000 }, moeda: { tipo: 'texto', obrigatorio: true, valores: ['BRL', 'USD'] }, periodo: { tipo: 'texto', obrigatorio: true, valores: ['dia', 'semana', 'mes', 'campanha'] }, somenteSugestao: { tipo: 'booleano', obrigatorio: true, valores: [true] } }),
      hipoteses: lista(obj({ descricao: t(300, 5), metrica: t(80, 2), evidencia: { tipo: 'objeto', nulo: true, extras: false, campos: { fonte: t(120, 2), periodo: t(60, 2) } } }), 1, 10),
      indicadores: lista(obj({ nome: t(80, 2), meta: tOpc(120) }), 1, 15),
    }),
  },
  // Documentação de projeto (Dev Web) e documentação técnica (Engenheiro): o MESMO contrato
  'documentacao-tecnica': {
    nome: 'Documentação de projeto / técnica', agentes: ['05-dev-web', '06-engenheiro'], tipoEntrega: 'documento', limiteBytes: 40 * 1024,
    esquema: obj({
      titulo: t(140, 3), objetivo: t(1000, 5), escopo: t(2000, 5),
      componentes: lista(obj({ nome: t(80, 2), descricao: t(500, 3) }), 1, 30),
      dependencias: lista(obj({ nome: t(80, 2), tipo: { tipo: 'texto', obrigatorio: true, valores: ['interna', 'externa'] }, observacao: tOpc(300) }), 0, 30),
      riscos: lista(obj({ descricao: t(300, 3), mitigacao: t(300, 3) }), 0, 20),
      recomendacoes: lista(t(300, 3), 1, 20),
    }),
  },
  'relatorio-tecnico': {
    nome: 'Relatório técnico', agentes: ['06-engenheiro'], tipoEntrega: 'relatorio', limiteBytes: 40 * 1024,
    esquema: obj({
      titulo: t(140, 3), contexto: t(2000, 10),
      decisoes: lista(obj({ decisao: t(300, 3), motivo: t(500, 3) }), 1, 20),
      riscos: lista(obj({ descricao: t(300, 3), mitigacao: t(300, 3) }), 0, 20),
      // nenhum código é executado pelo sistema: teste só pode estar "proposto"
      testes: lista(obj({ descricao: t(300, 3), situacao: { tipo: 'texto', obrigatorio: true, valores: ['proposto'] } }), 0, 30),
      pendencias: lista(t(300, 3), 0, 20, false),
    }),
  },
});

const DOCUMENTO_DA_CONSOLIDACAO = 'consolidacao-final';
const obterDocumento = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(DOCUMENTOS, id) ? DOCUMENTOS[id] : null);
const documentosDoAgente = (agenteId) => Object.keys(DOCUMENTOS).filter((k) => DOCUMENTOS[k].agentes.includes(agenteId));

// O agente pode produzir este documento? → { permitido, motivo }
function documentoPermitido(agenteId, documentoId) {
  const d = obterDocumento(documentoId);
  if (!d) return { permitido: false, motivo: 'documento-inexistente' };
  if (!d.agentes.includes(agenteId)) return { permitido: false, motivo: 'documento-nao-permitido-ao-agente' };
  return { permitido: true, motivo: 'ok' };
}

// Percorre todos os textos do documento (para a checagem de caracteres de controle).
function textos(v, caminho, out) {
  if (typeof v === 'string') out.push([caminho, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => textos(x, `${caminho}[${i}]`, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach((k) => textos(v[k], caminho ? `${caminho}.${k}` : k, out));
  return out;
}

// Valida um documento. agenteId (opcional): confere a permissão do agente.
// opcoes.limitesLegenda: limites menores por plataforma (nunca maiores que o contrato).
// → { valido, problemas, bytes, documentoId }
function validarDocumento(documentoId, dados, { agenteId, opcoes = {} } = {}) {
  const d = obterDocumento(documentoId);
  if (!d) return { valido: false, problemas: ['documento-inexistente'], bytes: null, documentoId };
  const p = [];
  if (agenteId) { const a = documentoPermitido(agenteId, documentoId); if (!a.permitido) p.push(a.motivo); }
  let bytes = null;
  try { bytes = Buffer.byteLength(JSON.stringify(dados), 'utf8'); } catch (e) { p.push('documento não serializável'); }
  if (bytes !== null && bytes > d.limiteBytes) p.push(`documento com ${bytes} bytes: o limite deste tipo é ${d.limiteBytes}`);
  const estrutura = validar(d.esquema, dados);
  p.push(...estrutura);
  if (!estrutura.length) {
    textos(dados, '', []).forEach(([c, v]) => { if (CONTROLE.test(v)) p.push(`${c}: caractere de controle não permitido`); });
    p.push(...REGRAS[documentoId](dados, opcoes));
  }
  return { valido: p.length === 0, problemas: p.slice(0, 50), bytes, documentoId };
}

// Conferência de coerência do catálogo (usada nos testes): tipos e agentes existem.
function conferirCatalogo(agentesExistentes) {
  const p = [];
  Object.entries(DOCUMENTOS).forEach(([id, d]) => {
    if (!TIPOS[d.tipoEntrega] || !TIPOS[d.tipoEntrega].suportado) p.push(`${id}: tipo de entrega ${d.tipoEntrega} indisponível`);
    if (!TIPOS[d.tipoEntrega].formatos.includes('json')) p.push(`${id}: o tipo de entrega não aceita JSON`);
    d.agentes.forEach((a) => { if (!agentesExistentes.includes(a)) p.push(`${id}: agente ${a} inexistente`); });
    if (!REGRAS[id]) p.push(`${id}: sem regras`);
  });
  return p;
}

module.exports = {
  DOCUMENTOS, VERSAO_CONTRATO, DOCUMENTO_DA_CONSOLIDACAO, LIMITES_LEGENDA, FORMATOS_PECA, CANAIS_TRAFEGO,
  obterDocumento, documentosDoAgente, documentoPermitido, validarDocumento, conferirCatalogo,
};
