// Validador de esquemas pequeno, sem dependências.
// Esquema: { tipo, obrigatorio, nulo, min, max, valores, padrao, itens, campos, extras }
//   tipo: 'texto' | 'numero' | 'inteiro' | 'booleano' | 'lista' | 'objeto' | 'qualquer'
//   min/max: tamanho do texto, da lista ou valor do número
//   valores: lista de valores aceitos (enum)
//   padrao: RegExp para texto
//   itens: esquema de cada item da lista
//   campos: esquemas dos campos do objeto; extras: false recusa campos não declarados
const { erro } = require('./erros');

function tipoDe(v) {
  if (v === null) return 'nulo';
  if (Array.isArray(v)) return 'lista';
  return typeof v;
}

function validar(esquema, valor, caminho = '', erros = []) {
  const aqui = caminho || '(raiz)';
  if (valor === undefined) {
    if (esquema.obrigatorio) erros.push(`${aqui}: obrigatório`);
    return erros;
  }
  if (valor === null) {
    if (!esquema.nulo) erros.push(`${aqui}: não pode ser nulo`);
    return erros;
  }
  const t = tipoDe(valor);
  switch (esquema.tipo) {
    case 'texto':
      if (t !== 'string') { erros.push(`${aqui}: deve ser texto`); return erros; }
      if (esquema.min !== undefined && valor.trim().length < esquema.min) erros.push(`${aqui}: mínimo de ${esquema.min} caracteres`);
      if (esquema.max !== undefined && valor.length > esquema.max) erros.push(`${aqui}: máximo de ${esquema.max} caracteres`);
      if (esquema.padrao && !esquema.padrao.test(valor)) erros.push(`${aqui}: formato inválido`);
      break;
    case 'numero':
    case 'inteiro':
      if (t !== 'number' || !Number.isFinite(valor)) { erros.push(`${aqui}: deve ser número`); return erros; }
      if (esquema.tipo === 'inteiro' && !Number.isInteger(valor)) erros.push(`${aqui}: deve ser inteiro`);
      if (esquema.min !== undefined && valor < esquema.min) erros.push(`${aqui}: mínimo ${esquema.min}`);
      if (esquema.max !== undefined && valor > esquema.max) erros.push(`${aqui}: máximo ${esquema.max}`);
      break;
    case 'booleano':
      if (t !== 'boolean') erros.push(`${aqui}: deve ser verdadeiro ou falso`);
      break;
    case 'lista':
      if (t !== 'lista') { erros.push(`${aqui}: deve ser lista`); return erros; }
      if (esquema.min !== undefined && valor.length < esquema.min) erros.push(`${aqui}: mínimo de ${esquema.min} itens`);
      if (esquema.max !== undefined && valor.length > esquema.max) erros.push(`${aqui}: máximo de ${esquema.max} itens`);
      if (esquema.itens) valor.forEach((item, i) => validar(esquema.itens, item, `${caminho}[${i}]`, erros));
      break;
    case 'objeto':
      if (t !== 'object') { erros.push(`${aqui}: deve ser objeto`); return erros; }
      Object.entries(esquema.campos || {}).forEach(([k, sub]) => validar(sub, valor[k], caminho ? `${caminho}.${k}` : k, erros));
      if (esquema.extras === false) {
        Object.keys(valor).forEach((k) => { if (!(k in (esquema.campos || {}))) erros.push(`${caminho ? caminho + '.' : ''}${k}: campo não permitido`); });
      }
      break;
    case 'qualquer':
      break;
    default:
      erros.push(`${aqui}: tipo de esquema desconhecido (${esquema.tipo})`);
  }
  if (esquema.valores && !esquema.valores.includes(valor)) erros.push(`${aqui}: valor não permitido (${String(valor)})`);
  return erros;
}

// Valida e lança ErroLabz('invalido') com a lista de problemas.
function garantir(esquema, valor, oQue) {
  const erros = validar(esquema, valor);
  if (erros.length) throw erro('invalido', `${oQue || 'Dados'} inválidos`, erros);
  return valor;
}

module.exports = { validar, garantir };
