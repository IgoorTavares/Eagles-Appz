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
          sinal.addEventListener('abort', () => reject(new ErroProvedor('cancelado', 'Chamada simulada abortada', { provedor })), { once: true });
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

module.exports = { criarTransporteBloqueado, criarTransporteSimulado, criarLimitador };
