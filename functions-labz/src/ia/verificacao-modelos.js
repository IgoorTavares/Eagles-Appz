// R1 (plano, seção 13.2): VERIFICAÇÃO SEM CUSTO do modelo de um agente, antes de qualquer chamada paga.
//  1. lista fechada + compatibilidade com o agente (config-modelos / modelos-anthropic);
//  2. o modelo existe e está liberado para a conta: consulta GET /v1/models/{id} (não gera texto);
//  3. limites informados pelo provedor: teto de saída configurado ≤ o do modelo; leitura de imagem
//     quando o agente precisa.
// O resultado vai para a auditoria (evento modelo.verificado) só com ID, recursos e data — nunca chave.
// Na R1 só roda com o transporte simulado; com o real, depende da autorização (transporte trancado).
const { caminhos } = require('../armazenamento/caminhos');
const { ATOR_SISTEMA } = require('../auth/super-admin');
const { obterAgente } = require('../agentes/catalogo');
const { adaptadorDoProvedor } = require('./provedores');
const { problemasDaConfig } = require('./config-modelos');
const { ErroProvedor, PROVEDOR_SIMULADO } = require('./contrato');

function criarVerificacaoModelos({ banco, auditoria, transporte }) {
  return {
    // → { ok, agenteId, provedor, modelo, problemas: [], limites? }
    async verificar(agenteId) {
      const agente = obterAgente(agenteId);
      if (!agente) return { ok: false, agenteId, problemas: ['agente desconhecido'] };
      const doc = await banco.obter(caminhos.agente(agenteId));
      const cfg = doc && doc.configModelo;
      if (!cfg || cfg.provedor === PROVEDOR_SIMULADO) return { ok: true, agenteId, provedor: PROVEDOR_SIMULADO, modelo: 'simulado', problemas: [], semCusto: true };
      const problemas = problemasDaConfig(agente, cfg).filter((p) => !/uso "real" não está autorizado/.test(p));
      const prov = adaptadorDoProvedor(cfg.provedor);
      let limites = null;
      if (!problemas.length && prov && prov.montarConsultaModelo) {
        try {
          const resp = await transporte.enviar(cfg.provedor, prov.montarConsultaModelo(cfg.modelo), { meta: { agenteId, modo: 'verificacao' } });
          if (!resp || resp.status !== 200) {
            const e = prov.classificarErro(resp || { status: 500 });
            problemas.push(e.tipo === 'modelo-indisponivel' ? `modelo ${cfg.modelo} indisponível para a conta` : `consulta do modelo falhou (${e.tipo})`);
          } else {
            limites = prov.normalizarModelo(resp.corpo);
            if (limites.id !== cfg.modelo) problemas.push('o provedor respondeu por outro modelo');
            if (limites.maxSaida !== null && cfg.maxTokensSaida && cfg.maxTokensSaida > limites.maxSaida) problemas.push(`teto de saída ${cfg.maxTokensSaida} acima do informado pelo provedor (${limites.maxSaida})`);
            const img = limites.capacidades && limites.capacidades.image_input;
            if (agente.modelo.recursosNecessarios.includes('imagem-entrada') && img && img.supported === false) problemas.push('o provedor informa que o modelo não lê imagem');
          }
        } catch (e) {
          problemas.push(e instanceof ErroProvedor ? `consulta do modelo bloqueada (${e.tipo})` : 'consulta do modelo falhou');
        }
      } else if (!prov) problemas.push('provedor desconhecido');
      const r = { ok: problemas.length === 0, agenteId, provedor: cfg.provedor, modelo: cfg.modelo, problemas, limites };
      await auditoria.registrar('modelo.verificado', ATOR_SISTEMA, caminhos.agente(agenteId), { ok: r.ok, provedor: cfg.provedor, modelo: String(cfg.modelo).slice(0, 60), problemas: problemas.length });
      return r;
    },
  };
}

module.exports = { criarVerificacaoModelos };
