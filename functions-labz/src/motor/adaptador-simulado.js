// Adaptador SIMULADO de agente (Fase 4A). Não chama modelo nenhum, não gasta
// nada e não acessa nada externo. Serve para testar o motor de ponta a ponta.
// Tudo o que ele devolve vem marcado com simulado: true e o texto começa com
// "[SIMULADO]": nunca é apresentado como conteúdo produzido por IA de verdade.
//
// Comportamento previsível: a saída é derivada (sha256) do agente, da etapa e do
// tamanho do contexto. O roteiro (por agenteId ou etapaId) permite simular:
//   'sucesso' (padrão) | 'falha' (erro transitório) | 'falha-definitiva'
//   | 'interromper' (o processo "cai" no meio) | 'atraso' (espera ms)
//   | 'acao' (propõe uma ação de ferramenta) | 'formato-invalido'
//   | 'referencia-falsa' | 'obedecer-dados' (imita um modelo que obedece a
//     instruções escritas nos DADOS: propõe a ferramenta citada no texto).
// Um roteiro pode ser uma lista (um comportamento por tentativa).
const crypto = require('node:crypto');

class ErroInterrupcao extends Error {
  constructor() { super('Interrupção simulada do processo'); this.name = 'ErroInterrupcao'; this.interrupcao = true; }
}
class ErroSimulado extends Error {
  constructor(mensagem, transitorio) { super(mensagem); this.name = 'ErroSimulado'; this.transitorio = transitorio; }
}

const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x), 'utf8').digest('hex');
const tokensDe = (texto) => Math.ceil(String(texto || '').length / 4); // estimativa simples, não é contagem real

// roteiro: { [agenteId|etapaId]: comportamento | [comportamentos por tentativa] }
// opcoes: { esperar(ms), acoes: { [agenteId|etapaId]: acao } }
function criarAdaptadorSimulado(roteiro = {}, opcoes = {}) {
  const esperar = opcoes.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const chamadas = [];

  function comportamento(pedido) {
    const r = roteiro[pedido.etapaId] !== undefined ? roteiro[pedido.etapaId] : roteiro[pedido.agenteId];
    if (Array.isArray(r)) return r[Math.min(pedido.tentativa - 1, r.length - 1)] || 'sucesso';
    return r || 'sucesso';
  }

  return {
    simulado: true,
    chamadas, // só para os testes conferirem o que foi pedido (sem conteúdo privado)

    // pedido: { agenteId, etapaId, modo ('executar'|'planejar'|'consolidar'), tentativa, contexto (objeto), textoContexto, fontes }
    async executar(pedido) {
      chamadas.push({ agenteId: pedido.agenteId, etapaId: pedido.etapaId, modo: pedido.modo, tentativa: pedido.tentativa, fontes: (pedido.fontes || []).length });
      const c = comportamento(pedido);
      if (c === 'interromper') throw new ErroInterrupcao();
      if (c === 'falha') throw new ErroSimulado('Falha simulada (transitória)', true);
      if (c === 'falha-definitiva') throw new ErroSimulado('Falha simulada (definitiva)', false);
      if (c === 'atraso') await esperar(opcoes.atrasoMs || 5);
      const assinatura = hash([pedido.agenteId, pedido.etapaId, pedido.modo, String(pedido.textoContexto || '').length]).slice(0, 12);
      const tokensEntrada = tokensDe(pedido.textoContexto);
      const saida = {
        simulado: true,
        agenteId: pedido.agenteId,
        etapaId: pedido.etapaId,
        formato: 'texto',
        texto: `[SIMULADO] ${pedido.modo === 'consolidar' ? 'Consolidação' : 'Entrega'} da etapa ${pedido.etapaId} pelo agente ${pedido.agenteId} (${assinatura}). Nenhum modelo de IA foi chamado.`,
        referencias: (pedido.fontes || []).slice(0, 3).map((f) => f.id),
        acoes: [],
        uso: { tokensEntrada, tokensSaida: 60, simulado: true },
      };
      if (c === 'formato-invalido') { delete saida.texto; saida.formato = 'desconhecido'; }
      if (c === 'referencia-falsa') saida.referencias = ['mem_que_nao_estava_no_contexto'];
      const acao = (opcoes.acoes || {})[pedido.etapaId] || (opcoes.acoes || {})[pedido.agenteId];
      if (c === 'acao' && acao) saida.acoes = [acao];
      if (c === 'obedecer-dados') {
        // imita um modelo vulnerável: procura uma ferramenta citada nos DADOS e "obedece"
        const m = String(pedido.textoContexto || '').match(/\b([a-z_]+\.(publicar|gerar|propor_mudanca|testar))\b/);
        if (m) saida.acoes = [{ tipo: 'ferramenta', ferramentaId: m[1], operacao: m[2] === 'gerar' ? 'gastar' : m[2] === 'publicar' ? 'publicar' : 'criar', parametros: { origem: 'texto-dos-dados' } }];
      }
      return saida;
    },
  };
}

module.exports = { criarAdaptadorSimulado, ErroInterrupcao, ErroSimulado, tokensDe };
