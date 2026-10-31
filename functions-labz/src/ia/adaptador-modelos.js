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

// opcoes: { configModelos, transporte, limitador?, timeoutPadraoMs? }
function criarAdaptadorModelos({ configModelos, transporte, limitador, timeoutPadraoMs }) {
  if (!transporte || !['simulado', 'bloqueado'].includes(transporte.tipo)) throw new Error('Fase 4B: só o transporte simulado ou o bloqueado são aceitos');

  async function solicitacao(pedido, cfg) {
    return montarSolicitacao({ ctx: pedido.contexto, modo: pedido.modo, maxEtapas: pedido.maxEtapas || 8, documento: pedido.documento });
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
      return { provedor: cfg.provedor, modelo: cfg.modelo, maxTokensSaida: cfg.maxTokensSaida, estimativaEntrada: tokensDe(s.sistema) + tokensDe(s.dados) };
    },

    // pedido: { agenteId, etapaId, modo, tentativa, contexto, textoContexto, fontes, sinal?, objetivo?, maxEtapas? }
    async executar(pedido) {
      const cfg = await configModelos.resolver(pedido.agenteId);
      if (cfg.uso === 'real') throw new ErroProvedor('nao-autorizado', 'Modelos reais não estão autorizados nesta fase', { provedor: cfg.provedor });
      const prov = adaptadorDoProvedor(cfg.provedor);
      if (!prov) throw new ErroProvedor('configuracao-invalida', 'Provedor desconhecido');
      const s = await solicitacao(pedido, cfg);
      const req = prov.montarRequisicao({ modelo: cfg.modelo, sistema: s.sistema, dados: s.dados, maxTokensSaida: cfg.maxTokensSaida, temperatura: cfg.temperatura, formatoJson: true });
      if (limitador) limitador.consumir(cfg.provedor);
      const resp = await chamar(cfg, req, pedido);
      if (!resp || resp.status !== 200) throw prov.classificarErro(resp || { status: 500 });
      const norm = prov.normalizarResposta(resp.corpo);
      const uso = norm.uso;
      if (norm.fim === 'incompleta') throw new ErroProvedor('resposta-incompleta', `${cfg.provedor}: resposta cortada (${norm.motivoFimOriginal || 'limite'})`, { provedor: cfg.provedor, uso });
      if (norm.fim === 'recusada' || norm.fim === 'filtrada') throw new ErroProvedor('recusada', `${cfg.provedor}: o modelo recusou ou o conteúdo foi filtrado`, { provedor: cfg.provedor, uso });
      const obj = lerJson(norm.texto, cfg.provedor, uso);
      // uso: o informado pelo provedor; se não veio, ESTIMADO (e marcado como tal; nunca zero)
      const usoFinal = uso
        ? { tokensEntrada: uso.tokensEntrada, tokensSaida: uso.tokensSaida, fonte: transporte.tipo === 'simulado' ? 'provedor-simulado' : 'provedor' }
        : { tokensEntrada: tokensDe(s.sistema) + tokensDe(s.dados), tokensSaida: tokensDe(norm.texto), fonte: 'estimado' };
      const origem = { provedor: cfg.provedor, modelo: cfg.modelo, uso: cfg.uso, transporte: transporte.tipo, fonteUso: usoFinal.fonte, configuracao: cfg.origem };
      const base = { simulado: true, agenteId: pedido.agenteId, etapaId: pedido.etapaId };
      if (pedido.modo === 'planejar') {
        return Object.assign(base, { formato: 'plano', plano: obj, uso: { tokensEntrada: usoFinal.tokensEntrada, tokensSaida: usoFinal.tokensSaida, fonte: usoFinal.fonte }, origem });
      }
      const sx = saidaDeExecucao(obj, pedido, cfg.provedor, uso);
      origem.camposIgnorados = sx.ignorados.length;
      const saida = Object.assign(base, { formato: pedido.documento ? 'documento' : 'texto', referencias: sx.referencias, acoes: sx.acoes, uso: { tokensEntrada: usoFinal.tokensEntrada, tokensSaida: usoFinal.tokensSaida, fonte: usoFinal.fonte }, origem });
      if (pedido.documento) saida.documento = sx.documento; else saida.texto = sx.texto;
      if (sx.revisoes) saida.revisoes = sx.revisoes;
      return saida;
    },
  };
}

module.exports = { criarAdaptadorModelos, idDaReferencia, lerJson };
