// Quality Gate da Fase 4A: verificações ESTRUTURAIS do resultado de uma etapa.
// Não avalia se um texto criativo é bom (isso é semântica; fica para depois).
// Confere: resultado presente e marcado como simulado, agente e etapa certos,
// formato, tamanho, referências que estavam no contexto, ações autorizadas para
// o agente e dentro do limite, e nada de campos inesperados.
const { avaliarAcao } = require('./ferramentas-simuladas');

const CAMPOS = ['simulado', 'agenteId', 'etapaId', 'formato', 'texto', 'referencias', 'acoes', 'uso'];
const MAX_TEXTO = 20000;
const MAX_ACOES = 5;

function verificarResultado(saida, { agenteId, etapaId, fontes = [] }) {
  const p = [];
  if (!saida || typeof saida !== 'object' || Array.isArray(saida)) return { aprovado: false, verificacao: 'estrutural', problemas: ['resultado-ausente'] };
  Object.keys(saida).forEach((k) => { if (!CAMPOS.includes(k)) p.push(`campo-inesperado:${k}`); });
  if (saida.simulado !== true) p.push('nao-marcado-como-simulado');
  if (saida.agenteId !== agenteId) p.push('agente-errado');
  if (saida.etapaId !== etapaId) p.push('etapa-errada');
  if (saida.formato !== 'texto' || typeof saida.texto !== 'string' || !saida.texto.trim()) p.push('formato-invalido');
  else if (saida.texto.length > MAX_TEXTO) p.push('texto-grande-demais');
  const validas = new Set(fontes.map((f) => f.id));
  if (!Array.isArray(saida.referencias)) p.push('referencias-invalidas');
  else saida.referencias.forEach((r) => { if (!validas.has(r)) p.push(`referencia-fora-do-contexto:${String(r).slice(0, 40)}`); });
  if (!Array.isArray(saida.acoes)) p.push('acoes-invalidas');
  else {
    if (saida.acoes.length > MAX_ACOES) p.push('acoes-demais');
    saida.acoes.forEach((a) => { const v = avaliarAcao(agenteId, a); if (!v.permitida) p.push(`acao-nao-autorizada:${(a && a.ferramentaId) || '?'}:${v.motivo}`); });
  }
  const u = saida.uso || {};
  if (!(Number.isInteger(u.tokensEntrada) && u.tokensEntrada >= 0 && Number.isInteger(u.tokensSaida) && u.tokensSaida >= 0)) p.push('uso-invalido');
  return { aprovado: p.length === 0, verificacao: 'estrutural', problemas: p };
}

module.exports = { verificarResultado, CAMPOS_RESULTADO: CAMPOS };
