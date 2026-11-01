// LABZ AI — Fase S3: monta as peças das duas Edge Functions sobre o PostgreSQL da LABZ AI.
// Recebe TUDO de fora (o cliente sql, a função de rede e a configuração): nada aqui lê
// variáveis de ambiente nem acessa a rede sozinho. Quem chama é supabase/functions/*/index.ts.
//
// Agentes: SEMPRE simulados nesta fase (adaptador simulado, ou um transporte simulado
// injetado nos testes). Não há transporte real para modelos de IA.
const { criarBancoPostgres } = require('../armazenamento/banco-postgres');
const { criarLabz } = require('../servicos');
const { criarApi } = require('../api/labz-api');
const { criarVerificadorFirebase, criarChavesGoogle } = require('../auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../auth/acesso-supabase');
const { criarLimitador } = require('./limitador');
const { criarWorker } = require('./worker');
const { criarVerificadorAcionamento, consumirPostgres } = require('./acionamento');
const { criarHandlerApi, criarHandlerWorker } = require('./http');
const { criarTransporteSimulado } = require('../ia/transporte');
const { criarModeloSimulado } = require('../ia/simulacao/modelo-simulado');

const ORIGENS_PADRAO = ['https://eagleslabz.com.br'];

// Padrão: o MODELO SIMULADO (o mesmo da demonstração), pelo adaptador de modelos completo
// (prompt seguro, custos, timeout, cancelamento). Nenhum provedor real existe nesta fase.
const iaSimulada = () => ({ transporte: criarTransporteSimulado(criarModeloSimulado({})) });

function lista(v) {
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// Configuração da API (labz-api)
function montarApi({ sql, config = {}, buscar, obterChaves, relogio, ia, opcoes, registrarErro, registrarRecusa } = {}) {
  if (!sql) throw new Error('montarApi: falta o cliente sql');
  if (!lista(config.uidsSuperAdmin).length) throw new Error('montarApi: falta a lista de UIDs do Super Admin (LABZ_SUPERADMIN_UIDS)');
  const banco = criarBancoPostgres({ sql });
  const servicos = criarLabz({ banco, relogio, ia: ia || iaSimulada(), opcoes });
  const chaves = obterChaves || criarChavesGoogle({ buscar }); // buscar = fetch (só o index.ts liga a rede)
  const verificador = criarVerificadorFirebase({ projetoId: config.projetoFirebase, obterChaves: chaves });
  // recusas de login: só no log, nunca no banco (S5B, Etapa 6)
  const autenticar = criarAcessoSupabase({ verificador, aoRecusar: ({ motivo }) => registrarRecusa && registrarRecusa({ etapa: 'token', motivo }) });
  const uidsServidor = new Set(lista(config.uidsSuperAdmin));
  const api = criarApi(Object.assign({ servicos, banco, uidsAutorizados: () => config.uidsSuperAdmin, lerSegredo: () => '' }, opcoesApiSupabase(banco)));
  const limitador = criarLimitador({ banco, relogio, limites: config.limites });
  const origens = config.origens ? lista(config.origens) : ORIGENS_PADRAO;
  const handler = criarHandlerApi({ api, autenticar, limitador, uidPermitido: (uid) => uidsServidor.has(uid), origens, registrarErro, registrarRecusa });
  return { handler, servicos, banco };
}

// Configuração do worker (labz-worker)
function montarWorker({ sql, config = {}, relogio, ia, opcoes, aoFundo, agoraMs, cpuMs, agoraSeg, registrarErro } = {}) {
  if (!sql) throw new Error('montarWorker: falta o cliente sql');
  const banco = criarBancoPostgres({ sql });
  const servicos = criarLabz({ banco, relogio, ia: ia || iaSimulada(), opcoes });
  const verificarAcionamento = criarVerificadorAcionamento({ segredo: config.segredoWorker, consumir: consumirPostgres(sql), agoraSeg, janelaSeg: config.janelaSeg });
  const worker = criarWorker({ servicos, orcamento: config.orcamento, agoraMs, cpuMs });
  const handler = criarHandlerWorker({ verificarAcionamento, worker, aoFundo, registrarErro });
  return { handler, worker, servicos, banco };
}

module.exports = { montarApi, montarWorker, ORIGENS_PADRAO };
