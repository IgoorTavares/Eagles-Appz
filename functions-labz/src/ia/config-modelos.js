// Fase 4B: provedor e modelo de CADA agente, configurados pelo Super Admin e
// guardados em labz_agentes/{agenteId}.configModelo (fora do repositório).
//  - Nenhum modelo é fixado no código: o nome do modelo é texto do Super Admin.
//  - Padrão (sem configuração): provedor "simulado". Modelos reais NÃO são
//    habilitados por padrão e, nesta fase, uso "real" é RECUSADO.
//  - A configuração é validada ao salvar E de novo antes de cada execução
//    (um documento alterado por fora não passa).
//  - As permissões do agente continuam vindo SÓ do catálogo: trocar o modelo
//    não muda ferramentas, escopos de memória nem aprovações.
const { caminhos } = require('../armazenamento/caminhos');
const { exigirAtor } = require('../auth/super-admin');
const { erro } = require('../nucleo/erros');
const { validar, garantir } = require('../nucleo/validador');
const { relogioPadrao } = require('../nucleo/ids');
const { AGENTES, obterAgente } = require('../agentes/catalogo');
const { RECURSOS_MODELO } = require('../contratos/agente');
const { TODOS_PROVEDORES, PROVEDOR_SIMULADO, ErroProvedor } = require('./contrato');

// Trava da fase: muda só com autorização do Igor (Fase 6), junto com o transporte real.
const USO_REAL_AUTORIZADO = false;
const PADRAO_TIMEOUT_MS = 60 * 1000;
const PADRAO_MAX_SAIDA = 4000;

const ESQUEMA_CONFIG = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    provedor: { tipo: 'texto', obrigatorio: true, valores: TODOS_PROVEDORES },
    // vai na rota do Google: só letras, números, ponto, hífen e sublinhado
    modelo: { tipo: 'texto', obrigatorio: true, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/ },
    uso: { tipo: 'texto', obrigatorio: true, valores: ['simulado', 'real'] },
    recursosDoModelo: { tipo: 'lista', obrigatorio: true, min: 1, max: RECURSOS_MODELO.length, itens: { tipo: 'texto', valores: RECURSOS_MODELO } },
    // abaixo do limite de sinal de vida do monitor (5 min), para uma chamada viva nunca parecer travada
    timeoutMs: { tipo: 'inteiro', min: 1000, max: 240000 },
    maxTokensSaida: { tipo: 'inteiro', min: 16, max: 64000 },
    temperatura: { tipo: 'numero', min: 0, max: 2 },
  },
};

const padraoDe = (agente) => Object.freeze({
  provedor: PROVEDOR_SIMULADO, modelo: 'simulado', uso: 'simulado', recursosDoModelo: agente.modelo.recursosNecessarios.slice(),
  timeoutMs: PADRAO_TIMEOUT_MS, maxTokensSaida: PADRAO_MAX_SAIDA, origem: 'padrao',
});

// Lista de problemas (vazia = válida). Usada ao salvar e antes de executar.
function problemasDaConfig(agente, config) {
  const p = validar(ESQUEMA_CONFIG, config);
  if (p.length) return p;
  if (config.provedor === PROVEDOR_SIMULADO && config.uso !== 'simulado') p.push('o provedor simulado só aceita uso "simulado"');
  if (config.uso === 'real' && !USO_REAL_AUTORIZADO) p.push('uso "real" não está autorizado nesta fase (modelos reais desligados)');
  const faltam = agente.modelo.recursosNecessarios.filter((r) => !config.recursosDoModelo.includes(r));
  if (faltam.length) p.push(`o modelo não declara recursos de que o agente precisa: ${faltam.join(', ')}`);
  return p;
}

function criarConfigModelos({ banco, auditoria, relogio = relogioPadrao }) {
  const exigirAgente = (agenteId) => { const a = obterAgente(agenteId); if (!a) throw erro('nao-encontrado', 'Agente desconhecido'); return a; };

  // Configuração EFETIVA para executar (uso interno do adaptador). Inválida → erro definitivo.
  async function resolver(agenteId) {
    const agente = obterAgente(agenteId);
    if (!agente) throw new ErroProvedor('configuracao-invalida', 'Agente desconhecido');
    const doc = await banco.obter(caminhos.agente(agenteId));
    if (!doc || !doc.configModelo) return padraoDe(agente);
    const cfg = doc.configModelo;
    const p = problemasDaConfig(agente, cfg);
    if (p.length) throw new ErroProvedor('configuracao-invalida', `Configuração de modelo inválida para ${agente.nome}: ${p.join('; ')}`);
    return Object.freeze(Object.assign({ timeoutMs: PADRAO_TIMEOUT_MS, maxTokensSaida: PADRAO_MAX_SAIDA }, cfg, { origem: 'configurada' }));
  }

  return {
    resolver,

    async definir(ator, agenteId, config) {
      exigirAtor(ator);
      const agente = exigirAgente(agenteId);
      const p = problemasDaConfig(agente, config);
      if (p.length) throw erro(config && config.uso === 'real' && !USO_REAL_AUTORIZADO ? 'precondicao' : 'invalido', 'Configuração de modelo inválida', p);
      await banco.transacao(async (t) => {
        const atual = (await t.obter(caminhos.agente(agenteId))) || {};
        await t.gravar(caminhos.agente(agenteId), Object.assign({}, atual, { configModelo: Object.assign({}, config), configAtualizadaEm: relogio(), configAtualizadaPor: ator.uid }));
      });
      await auditoria.registrar('agente.modelo_configurado', ator, caminhos.agente(agenteId), { provedor: config.provedor, uso: config.uso });
      return resolver(agenteId);
    },

    async remover(ator, agenteId) {
      exigirAtor(ator);
      const agente = exigirAgente(agenteId);
      await banco.transacao(async (t) => {
        const atual = await t.obter(caminhos.agente(agenteId));
        if (atual && atual.configModelo) {
          const novo = Object.assign({}, atual, { configAtualizadaEm: relogio(), configAtualizadaPor: ator.uid });
          delete novo.configModelo;
          await t.gravar(caminhos.agente(agenteId), novo);
        }
      });
      await auditoria.registrar('agente.modelo_removido', ator, caminhos.agente(agenteId), {});
      return padraoDe(agente);
    },

    // Situação dos 8 agentes (sem nada secreto: não há chave aqui).
    async listar(ator) {
      exigirAtor(ator);
      const out = [];
      for (const a of AGENTES) {
        let cfg; let situacao;
        try { cfg = await resolver(a.id); situacao = cfg.origem === 'padrao' ? 'simulado-padrao' : 'configurado'; } catch (e) { cfg = null; situacao = 'invalida'; }
        out.push({ agenteId: a.id, nome: a.nome, situacao, provedor: cfg ? cfg.provedor : null, modelo: cfg ? cfg.modelo : null, uso: cfg ? cfg.uso : null, recursosNecessarios: a.modelo.recursosNecessarios.slice() });
      }
      return out;
    },
  };
}

module.exports = { criarConfigModelos, problemasDaConfig, ESQUEMA_CONFIG, USO_REAL_AUTORIZADO, PADRAO_TIMEOUT_MS, PADRAO_MAX_SAIDA, garantirConfig: (c) => garantir(ESQUEMA_CONFIG, c, 'Configuração') };
