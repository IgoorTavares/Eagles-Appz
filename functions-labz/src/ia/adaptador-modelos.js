// Fase 4B: ponte entre o MOTOR (mesma interface do adaptador simulado da 4A:
// executar(pedido) → saída) e os provedores de IA. Por agente:
//   configuração (config-modelos) → solicitação segura (prompt.js) →
//   requisição no formato do provedor → limitador local → transporte (com
//   timeout e cancelamento) → resposta normalizada → JSON conferido → saída.
// Na Fase 4B o transporte é SEMPRE o simulado (ou o bloqueado): nenhuma
// chamada real, nenhuma chave. Por isso a saída continua marcada simulado: true.
//
// preparar(pedido) → { provedor, modelo, maxTokensSaida, estimativaEntrada } (o motor usa
// para reservar o consumo ANTES de chamar).
const { adaptadorDoProvedor } = require('./provedores');
const { ErroProvedor } = require('./contrato');
const { montarSolicitacao } = require('./prompt');
const { limparCredenciais } = require('./credenciais');
const { removerDadosPessoais } = require('./dados-pessoais');
const { esquemaDaResposta } = require('./esquema-json');
const { PROVEDOR_SIMULADO } = require('./contrato');

const tokensDe = (t) => Math.ceil(String(t || '').length / 4); // estimativa (não é contagem do provedor)
const REF_MEMORIA = /^memoria:[a-z]+:([A-Za-z0-9_-]{1,80})@v\d+$/;
const MAX_TEXTO = 20000;
const MAX_REVISOES = 8;

// Lê o JSON que o modelo devolveu (às vezes vem entre ```json … ```).
function lerJson(texto, provedor, uso) {
  let t = String(texto || '').trim();
  const cerca = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (cerca) t = cerca[1];
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('não é objeto');
    return v;
  } catch (e) {
    throw new ErroProvedor('resposta-malformada', `${provedor}: a resposta não é um objeto JSON`, { provedor, uso });
  }
}

// Referência "memoria:cliente:ID@v2" → "ID" (o id que o controle de qualidade confere).
const idDaReferencia = (r) => { const m = String(r).match(REF_MEMORIA); return m ? m[1] : String(r).slice(0, 120); };

// Só os campos conhecidos passam; o resto é descartado e contado (o modelo não
// muda cliente, permissões, limites nem aprovações escrevendo campos a mais).
function saidaDeExecucao(obj, pedido, provedor, uso) {
  // Fase 4C.2: etapa com documento → o documento vem em "documento" (validado depois, no motor)
  if (pedido.documento) {
    if (!obj.documento || typeof obj.documento !== 'object' || Array.isArray(obj.documento)) throw new ErroProvedor('resposta-malformada', `${provedor}: JSON sem o objeto "documento"`, { provedor, uso });
  } else if (typeof obj.texto !== 'string' || !obj.texto.trim()) throw new ErroProvedor('resposta-malformada', `${provedor}: JSON sem "texto"`, { provedor, uso });
  const conhecidos = [pedido.documento ? 'documento' : 'texto', 'referencias', 'acoes', ...(pedido.modo === 'consolidar' ? ['revisoes'] : [])];
  const ignorados = Object.keys(obj).filter((k) => !conhecidos.includes(k));
  const saida = {
    texto: pedido.documento ? undefined : obj.texto.slice(0, MAX_TEXTO + 1),
    documento: pedido.documento ? obj.documento : undefined,
    referencias: Array.isArray(obj.referencias) ? obj.referencias.slice(0, 50).map(idDaReferencia) : [],
    acoes: Array.isArray(obj.acoes) ? obj.acoes.slice(0, 20) : obj.acoes === undefined ? [] : obj.acoes,
    ignorados,
  };
  if (pedido.modo === 'consolidar' && obj.revisoes !== undefined) {
    if (!Array.isArray(obj.revisoes)) throw new ErroProvedor('resposta-malformada', `${provedor}: "revisoes" não é lista`, { provedor, uso });
    saida.revisoes = obj.revisoes.slice(0, MAX_REVISOES);
  }
  return saida;
}

// opcoes: { configModelos, transporte, limitador?, timeoutPadraoMs?, contarEntrada? }
//  contarEntrada (R1): antes de cada chamada, conta a entrada EXATA pela API do provedor (sem custo),
//  para a reserva ser um teto real. Com o transporte REAL é obrigatório (sem contagem, não chama).
function criarAdaptadorModelos({ configModelos, transporte, limitador, timeoutPadraoMs, contarEntrada = false }) {
  if (!transporte || !['simulado', 'bloqueado', 'real'].includes(transporte.tipo)) throw new Error('Transporte desconhecido (aceitos: simulado, bloqueado, real)');
  const real = transporte.tipo === 'real';
  const contar = real || contarEntrada === true;

  // R1 (D5): o que vai para um provedor de verdade passa pelo filtro de dados pessoais. Só a
  // CONTAGEM do que foi removido é guardada. O provedor simulado não sai da máquina.
  async function solicitacao(pedido, cfg) {
    const s = await montarSolicitacao({ ctx: pedido.contexto, modo: pedido.modo, maxEtapas: pedido.maxEtapas || 8, documento: pedido.documento, documentosRecebidos: pedido.documentosRecebidos });
    if (cfg.provedor === PROVEDOR_SIMULADO) return Object.assign({}, s, { removidosD5: 0 });
    const a = removerDadosPessoais(s.sistema);
    const b = removerDadosPessoais(s.dados);
    return Object.assign({}, s, { sistema: a.texto, dados: b.texto, removidosD5: a.total + b.total });
  }
  // requisição neutra → formato do provedor (esforço e, com documento, saída estruturada)
  function neutra(cfg, s, pedido) {
    const esquemaJson = cfg.provedor === 'anthropic' && pedido.documento ? esquemaDaResposta(pedido.documento, { consolidar: pedido.modo === 'consolidar' }) : undefined;
    return { modelo: cfg.modelo, sistema: s.sistema, dados: s.dados, maxTokensSaida: cfg.maxTokensSaida, temperatura: cfg.temperatura, esforco: cfg.esforco, esquemaJson: esquemaJson || undefined, formatoJson: true };
  }
  // contagem exata da entrada (sem custo); null quando o provedor não tem contagem
  async function contarTokens(cfg, prov, s, pedido) {
    if (!prov.montarContagem) return null;
    const req = prov.montarContagem(neutra(cfg, s, pedido));
    const resp = await chamar(cfg, req, Object.assign({}, pedido, { modo: 'contagem' }));
    if (!resp || resp.status !== 200) throw prov.classificarErro(resp || { status: 500 });
    return prov.normalizarContagem(resp.corpo);
  }

  // Chamada com timeout e cancelamento (o sinal do executor e o do relógio).
  async function chamar(cfg, req, pedido) {
    const controle = new AbortController();
    const externo = pedido.sinal;
    let motivo = null;
    const aoCancelar = () => { motivo = 'cancelado'; controle.abort(); };
    if (externo) { if (externo.aborted) throw new ErroProvedor('cancelado', 'Execução cancelada antes da chamada', { provedor: cfg.provedor }); externo.addEventListener('abort', aoCancelar, { once: true }); }
    const ms = timeoutPadraoMs || cfg.timeoutMs;
    const relogio = setTimeout(() => { motivo = 'timeout'; controle.abort(); }, ms);
    try {
      return await transporte.enviar(cfg.provedor, req, { sinal: controle.signal, meta: { agenteId: pedido.agenteId, etapaId: pedido.etapaId, modo: pedido.modo, tentativa: pedido.tentativa, objetivo: pedido.objetivo, documento: pedido.documento || null } });
    } catch (e) {
      if (motivo === 'timeout') throw new ErroProvedor('timeout', `${cfg.provedor}: sem resposta em ${ms} ms`, { provedor: cfg.provedor });
      if (motivo === 'cancelado') throw new ErroProvedor('cancelado', 'Chamada cancelada pelo executor', { provedor: cfg.provedor });
      if (e instanceof ErroProvedor || (e && e.interrupcao)) throw e; // interrupção (queda simulada) passa intacta
      throw new ErroProvedor('indisponivel', `${cfg.provedor}: falha de transporte (${limparCredenciais(e && e.message).slice(0, 120)})`, { provedor: cfg.provedor });
    } finally {
      clearTimeout(relogio);
      if (externo) externo.removeEventListener('abort', aoCancelar);
    }
  }

  return {
    simulado: true, // Fase 4B: nunca há modelo real por trás
    transporte: transporte.tipo,

    async preparar(pedido) {
      const cfg = await configModelos.resolver(pedido.agenteId);
      const s = await solicitacao(pedido, cfg);
      const prov = adaptadorDoProvedor(cfg.provedor);
      let entrada = tokensDe(s.sistema) + tokensDe(s.dados);
      let fonteEntrada = 'estimativa';
      if (contar && cfg.provedor !== PROVEDOR_SIMULADO && prov) {
        const n = await contarTokens(cfg, prov, s, pedido);
        if (n !== null) { entrada = n; fonteEntrada = 'contagem-do-provedor'; } else if (real) throw new ErroProvedor('configuracao-invalida', `${cfg.provedor}: sem contagem exata de tokens; chamada real recusada`, { provedor: cfg.provedor });
      }
      return { provedor: cfg.provedor, modelo: cfg.modelo, maxTokensSaida: cfg.maxTokensSaida, estimativaEntrada: entrada, fonteEntrada };
    },

    // pedido: { agenteId, etapaId, modo, tentativa, contexto, textoContexto, fontes, sinal?, objetivo?, maxEtapas? }
    async executar(pedido) {
      const cfg = await configModelos.resolver(pedido.agenteId);
      if (cfg.uso === 'real') throw new ErroProvedor('nao-autorizado', 'Modelos reais não estão autorizados nesta fase', { provedor: cfg.provedor });
      const prov = adaptadorDoProvedor(cfg.provedor);
      if (!prov) throw new ErroProvedor('configuracao-invalida', 'Provedor desconhecido');
      const s = await solicitacao(pedido, cfg);
      const req = prov.montarRequisicao(neutra(cfg, s, pedido));
      if (limitador) limitador.consumir(cfg.provedor);
      const resp = await chamar(cfg, req, pedido);
      if (!resp || resp.status !== 200) {
        const e = prov.classificarErro(resp || { status: 500 });
        // R1: o provedor RESPONDEU (com status de erro): o pedido foi recusado, resultado conhecido
        e.comCorpo = !!resp;
        throw e;
      }
      const norm = prov.normalizarResposta(resp.corpo, resp.cabecalhos || {});
      const uso = norm.uso;
      if (norm.fim === 'incompleta') throw new ErroProvedor('resposta-incompleta', `${cfg.provedor}: resposta cortada (${norm.motivoFimOriginal || 'limite'})`, { provedor: cfg.provedor, uso, comCorpo: true });
      if (norm.fim === 'recusada' || norm.fim === 'filtrada') throw new ErroProvedor('recusada', `${cfg.provedor}: o modelo recusou ou o conteúdo foi filtrado`, { provedor: cfg.provedor, uso, comCorpo: true, categoria: norm.categoriaRecusa || undefined });
      const obj = lerJson(norm.texto, cfg.provedor, uso);
      // uso: o informado pelo provedor; se não veio, ESTIMADO (e marcado como tal; nunca zero)
      const usoFinal = uso
        ? Object.assign({ tokensEntrada: uso.tokensEntrada, tokensSaida: uso.tokensSaida, fonte: transporte.tipo === 'simulado' ? 'provedor-simulado' : 'provedor' }, uso.cacheEscrita !== undefined ? { cacheEscrita: uso.cacheEscrita, cacheLeitura: uso.cacheLeitura } : {})
        : { tokensEntrada: tokensDe(s.sistema) + tokensDe(s.dados), tokensSaida: tokensDe(norm.texto), fonte: 'estimado' };
      const origem = { provedor: cfg.provedor, modelo: cfg.modelo, uso: cfg.uso, transporte: transporte.tipo, fonteUso: usoFinal.fonte, configuracao: cfg.origem, removidosD5: s.removidosD5 || 0, requestId: norm.requestId || null };
      const usoSaida = Object.assign({ tokensEntrada: usoFinal.tokensEntrada, tokensSaida: usoFinal.tokensSaida, fonte: usoFinal.fonte }, usoFinal.cacheEscrita !== undefined ? { cacheEscrita: usoFinal.cacheEscrita, cacheLeitura: usoFinal.cacheLeitura } : {});
      const base = { simulado: true, agenteId: pedido.agenteId, etapaId: pedido.etapaId };
      if (pedido.modo === 'planejar') {
        return Object.assign(base, { formato: 'plano', plano: obj, uso: usoSaida, origem });
      }
      const sx = saidaDeExecucao(obj, pedido, cfg.provedor, uso);
      origem.camposIgnorados = sx.ignorados.length;
      const saida = Object.assign(base, { formato: pedido.documento ? 'documento' : 'texto', referencias: sx.referencias, acoes: sx.acoes, uso: usoSaida, origem });
      if (pedido.documento) saida.documento = sx.documento; else saida.texto = sx.texto;
      if (sx.revisoes) saida.revisoes = sx.revisoes;
      return saida;
    },
  };
}

module.exports = { criarAdaptadorModelos, idDaReferencia, lerJson };
