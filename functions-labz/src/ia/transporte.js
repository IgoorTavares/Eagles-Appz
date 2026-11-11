// Fase 4B: TRANSPORTE = quem leva a requisição montada até o provedor.
// Nesta fase só existem:
//  - o transporte BLOQUEADO (recusa tudo; é o que um servidor usaria se alguém
//    tentasse ligar um provedor antes da autorização);
//  - o transporte SIMULADO (responde no formato de cada provedor, sem rede).
// O transporte REAL (HTTPS com a chave do Secret Manager) NÃO existe aqui: será
// escrito só quando o Igor autorizar modelos reais (Fase 6).
// Também fica aqui o limitador LOCAL de requisições por provedor.
const { ErroProvedor } = require('./contrato');

// enviar(provedor, requisicao, { sinal, meta }) → { status, corpo, cabecalhos }
function criarTransporteBloqueado() {
  return Object.freeze({
    tipo: 'bloqueado',
    async enviar(provedor) {
      throw new ErroProvedor('nao-autorizado', 'Chamadas reais aos provedores de IA não estão autorizadas nesta fase', { provedor });
    },
  });
}

// responder({ provedor, requisicao, meta, chamada }) → { status, corpo, cabecalhos }
//   | { pendurar: true } (nunca responde: serve para testar timeout e cancelamento)
// O registro de chamadas guarda só metadados (nunca o texto do prompt).
function criarTransporteSimulado(responder) {
  const chamadas = [];
  return {
    tipo: 'simulado',
    chamadas,
    async enviar(provedor, requisicao, { sinal, meta } = {}) {
      const chamada = { provedor, rota: requisicao.rota, agenteId: meta && meta.agenteId, etapaId: meta && meta.etapaId, modo: meta && meta.modo, tentativa: meta && meta.tentativa, n: chamadas.length + 1 };
      chamadas.push(chamada);
      if (sinal && sinal.aborted) throw new ErroProvedor('cancelado', 'Chamada cancelada antes de sair', { provedor });
      const r = await responder({ provedor, requisicao, meta: meta || {}, chamada });
      if (r && r.pendurar) {
        // fica esperando até ser cancelada (timeout ou parada do executor)
        await new Promise((resolve, reject) => {
          if (!sinal) return; // sem sinal: nunca termina (o adaptador sempre passa um)
          const cancelar = () => reject(new ErroProvedor('cancelado', 'Chamada simulada abortada', { provedor }));
          // o cancelamento pode ter chegado ENQUANTO a resposta era preparada (antes de escutar): não pode se perder
          if (sinal.aborted) return cancelar();
          sinal.addEventListener('abort', cancelar, { once: true });
        });
      }
      return r;
    },
  };
}

// Limitador local (janela deslizante) por provedor: N requisições por janela.
// Protege o provedor e o orçamento; o provedor real ainda pode devolver 429.
function criarLimitador({ porJanela = 30, janelaMs = 60 * 1000, agoraMs = () => Date.now(), porProvedor = {} } = {}) {
  const marcas = new Map();
  return {
    consumir(provedor) {
      const lim = porProvedor[provedor] || porJanela;
      const agora = agoraMs();
      const lista = (marcas.get(provedor) || []).filter((t) => t > agora - janelaMs);
      if (lista.length >= lim) {
        marcas.set(provedor, lista);
        throw new ErroProvedor('limite-requisicoes', `${provedor}: limite local de ${lim} requisições por janela`, { provedor, esperaMs: lista[0] + janelaMs - agora });
      }
      lista.push(agora);
      marcas.set(provedor, lista);
    },
  };
}

// ---------- R1: transporte REAL (preparado, TRANCADO) ----------
// Leva a requisição por HTTPS só para os endereços OFICIAIS (lista fechada) e só pelas rotas
// conhecidas. Ordem das travas, TODAS antes de qualquer acesso à rede:
//   1. autorização da fase (autorizado === true; na R1 é sempre false → recusa);
//   2. provedor na lista fechada (nesta fase: só a Anthropic);
//   3. rota permitida (mensagens, contagem de tokens, consulta de modelo);
//   4. interruptor do provedor ligado (labz_config/provedores, lido por provedorLigado);
//   5. chave configurada no segredo do servidor (nunca no banco, no navegador ou no chat).
// A chave entra só no cabeçalho, aqui; nunca volta em erro, registro ou resposta.
const ENDERECOS_OFICIAIS = Object.freeze({ anthropic: 'https://api.anthropic.com' });
const ROTAS_PERMITIDAS = Object.freeze({ anthropic: [/^\/v1\/messages$/, /^\/v1\/messages\/count_tokens$/, /^\/v1\/models\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/] });
const CABECALHO_CHAVE = Object.freeze({ anthropic: 'x-api-key' });

// opcoes: { autorizado, buscar(url, init), chaveDoProvedor(provedor) → string, provedorLigado(provedor) → Promise<bool> }
function criarTransporteReal({ autorizado = false, buscar, chaveDoProvedor, provedorLigado } = {}) {
  const contagem = { tentativasBarradas: 0, enviadas: 0 };
  return {
    tipo: 'real',
    contagem,
    async enviar(provedor, requisicao, { sinal } = {}) {
      const barrar = (tipo, msg) => { contagem.tentativasBarradas += 1; throw new ErroProvedor(tipo, msg, { provedor }); };
      if (autorizado !== true) barrar('nao-autorizado', 'Chamadas reais aos provedores de IA não estão autorizadas nesta fase');
      if (!Object.prototype.hasOwnProperty.call(ENDERECOS_OFICIAIS, provedor)) barrar('nao-autorizado', 'Provedor fora da lista fechada desta fase');
      const rota = String(requisicao && requisicao.rota || '');
      if (!ROTAS_PERMITIDAS[provedor].some((re) => re.test(rota))) barrar('nao-autorizado', 'Rota fora da lista permitida');
      if (typeof provedorLigado !== 'function' || !(await provedorLigado(provedor))) barrar('nao-autorizado', `Provedor ${provedor} desligado no interruptor (labz_config/provedores)`);
      const chave = typeof chaveDoProvedor === 'function' ? String(chaveDoProvedor(provedor) || '').trim() : '';
      if (chave.length < 10) barrar('credencial', `Chave de ${provedor} não configurada no servidor`);
      if (typeof buscar !== 'function') barrar('nao-autorizado', 'Transporte sem função de rede');
      if (sinal && sinal.aborted) throw new ErroProvedor('cancelado', 'Chamada cancelada antes de sair', { provedor });
      const cab = Object.assign({}, requisicao.cabecalhos || {}, { [CABECALHO_CHAVE[provedor]]: chave });
      contagem.enviadas += 1;
      let resp;
      try {
        resp = await buscar(ENDERECOS_OFICIAIS[provedor] + rota, { method: requisicao.metodo, headers: cab, body: requisicao.corpo === null || requisicao.corpo === undefined ? undefined : JSON.stringify(requisicao.corpo), redirect: 'error', signal: sinal });
      } catch (e) {
        if (sinal && sinal.aborted) throw new ErroProvedor('cancelado', 'Chamada abortada', { provedor });
        // sem resposta: o pedido pode ter sido processado (e cobrado) → resultado DESCONHECIDO (comCorpo: false)
        throw new ErroProvedor('indisponivel', `${provedor}: falha de rede`, { provedor });
      }
      const cabecalhos = {};
      if (resp.headers && typeof resp.headers.forEach === 'function') resp.headers.forEach((v, k) => { cabecalhos[String(k).toLowerCase()] = v; });
      let corpo = null;
      try { corpo = await resp.json(); } catch (e) { corpo = null; }
      return { status: resp.status, corpo, cabecalhos };
    },
  };
}

module.exports = { criarTransporteBloqueado, criarTransporteSimulado, criarLimitador, criarTransporteReal, ENDERECOS_OFICIAIS };
