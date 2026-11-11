// R1 (plano, seção 5, item 3): converte o esquema FECHADO dos documentos (nucleo/validador.js) em
// esquema JSON, para a saída estruturada do provedor (Anthropic: output_config.format). Usa só as
// palavras mais básicas (type, properties, required, additionalProperties, enum, items): limites de
// tamanho e padrões continuam sendo conferidos pelo BACKEND (validarDocumento), que é quem decide.
const { obterDocumento } = require('../contratos/documentos');

const TIPOS = { texto: 'string', numero: 'number', inteiro: 'integer', booleano: 'boolean', lista: 'array', objeto: 'object' };

function paraJsonSchema(e) {
  if (!e || !e.tipo || e.tipo === 'qualquer') return {};
  const out = {};
  if (TIPOS[e.tipo]) out.type = e.nulo ? [TIPOS[e.tipo], 'null'] : TIPOS[e.tipo];
  if (Array.isArray(e.valores)) out.enum = e.valores.slice();
  if (e.tipo === 'lista' && e.itens) out.items = paraJsonSchema(e.itens);
  if (e.tipo === 'objeto') {
    const campos = e.campos || {};
    out.properties = {};
    Object.entries(campos).forEach(([k, v]) => { out.properties[k] = paraJsonSchema(v); });
    const obrig = Object.entries(campos).filter(([, v]) => v && v.obrigatorio).map(([k]) => k);
    if (obrig.length) out.required = obrig;
    if (e.extras === false) out.additionalProperties = false;
  }
  return out;
}

// Esquema da RESPOSTA inteira de uma etapa com documento: { documento, referencias, acoes[, revisoes] }.
function esquemaDaResposta(tipoDocumento, { consolidar = false } = {}) {
  const d = obterDocumento(tipoDocumento);
  if (!d) return null;
  const props = {
    documento: paraJsonSchema(d.esquema),
    referencias: { type: 'array', items: { type: 'string' } },
    acoes: { type: 'array', items: { type: 'object' } },
  };
  if (consolidar) props.revisoes = { type: 'array', items: { type: 'object' } };
  return { type: 'object', properties: props, required: ['documento'], additionalProperties: false };
}

module.exports = { paraJsonSchema, esquemaDaResposta };
