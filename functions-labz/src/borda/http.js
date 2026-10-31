// LABZ AI — Fase S3: a "porta" HTTP das duas Edge Functions, com Request/Response padrão da web
// (iguais no Node 20+ e no Deno). Nenhuma lógica de negócio aqui: só travas e tradução.
//
// labz-api — ordem das travas:
//   CORS (só as origens da lista) → só POST → só JSON → tamanho (200 KB) → token do Firebase
//   (assinatura, projeto, validade) → limite de pedidos por UID → criarApi() (Super Admin:
//   lista do servidor + perfil no banco da LABZ AI + lista do banco; validação; auditoria).
// labz-worker — só POST, sem corpo útil → acionamento assinado E registrado no banco (uma vez só)
//   → rodada com orçamento. Nunca recebe dados do navegador.
const { traduzirErro } = require('../api/labz-api');

const MAX_CORPO = 200 * 1024;
const STATUS = {
  unauthenticated: 401, 'permission-denied': 403, 'invalid-argument': 400, 'not-found': 404,
  'already-exists': 409, 'failed-precondition': 409, 'data-loss': 500, 'resource-exhausted': 429, internal: 500,
};
const BASE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function json(status, corpo, extras = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: Object.assign({}, BASE, extras) });
}
const falha = (status, codigo, mensagem, extras, detalhes) => json(status, { ok: false, erro: detalhes === undefined ? { codigo, mensagem } : { codigo, mensagem, detalhes } }, extras);

// Lê o corpo com limite REAL de bytes (não confia só no content-length).
async function lerCorpo(request, max) {
  const decl = Number(request.headers.get('content-length') || 0);
  if (decl > max) return { grande: true };
  if (!request.body) return { texto: '' };
  const leitor = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await leitor.cancel().catch(() => {}); return { grande: true }; }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let p = 0;
  for (const x of partes) { tudo.set(x, p); p += x.byteLength; }
  return { texto: new TextDecoder('utf-8', { fatal: false }).decode(tudo) };
}

// api: criarApi(...); autenticar(cabecalho) → { uid, token }; limitador: criarLimitador(...)
// origens: lista exata de origens do navegador permitidas (ex.: https://eagleslabz.com.br)
// registrarErro(e): log do servidor (sem dados do pedido)
function criarHandlerApi({ api, autenticar, limitador, origens = [], maxCorpo = MAX_CORPO, registrarErro = () => {} }) {
  if (typeof api !== 'function' || typeof autenticar !== 'function' || !limitador) throw new Error('criarHandlerApi: faltam peças');
  const permitidas = new Set(origens);
  return async function handlerApi(request) {
    const origem = request.headers.get('origin');
    const cors = origem && permitidas.has(origem)
      ? { 'access-control-allow-origin': origem, vary: 'Origin', 'access-control-allow-credentials': 'false' }
      : { vary: 'Origin' };
    if (origem && !permitidas.has(origem)) return falha(403, 'permission-denied', 'Origem não permitida.', cors);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: Object.assign({}, cors, { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' }) });
    }
    if (request.method !== 'POST') return falha(405, 'invalid-argument', 'Use POST.', Object.assign({ allow: 'POST, OPTIONS' }, cors));
    if (!/^application\/json(;|$)/i.test(request.headers.get('content-type') || '')) return falha(415, 'invalid-argument', 'Envie JSON.', cors);
    const corpo = await lerCorpo(request, maxCorpo);
    if (corpo.grande) return falha(413, 'invalid-argument', 'Pedido grande demais.', cors);
    let pedido;
    try { pedido = JSON.parse(corpo.texto); } catch (e) { return falha(400, 'invalid-argument', 'JSON inválido.', cors); }
    if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido) || typeof pedido.acao !== 'string') return falha(400, 'invalid-argument', 'Pedido inválido.', cors);
    try {
      const auth = await autenticar(request.headers.get('authorization'));
      await limitador.verificar(auth.uid, pedido.acao);
      const r = await api({ auth, data: { acao: pedido.acao, dados: pedido.dados } });
      return json(200, r, cors);
    } catch (e) {
      if (e && e.codigo === 'limite-excedido') return falha(429, 'resource-exhausted', e.message, Object.assign({ 'retry-after': '60' }, cors));
      const t = traduzirErro(e);
      if (t.codigo === 'internal') { try { registrarErro(e); } catch (x) { /* nunca derruba a resposta */ } }
      return falha(STATUS[t.codigo] || 500, t.codigo, t.mensagem, cors, t.detalhes);
    }
  };
}

// verificarAcionamento(cabecalho) → { id, motivo }; worker: criarWorker(...)
// aoFundo(promessa) (opcional): EdgeRuntime.waitUntil — responde 202 na hora e trabalha depois
function criarHandlerWorker({ verificarAcionamento, worker, aoFundo, registrarErro = () => {} }) {
  if (typeof verificarAcionamento !== 'function' || !worker) throw new Error('criarHandlerWorker: faltam peças');
  return async function handlerWorker(request) {
    if (request.method !== 'POST') return falha(405, 'invalid-argument', 'Use POST.', { allow: 'POST' });
    const corpo = await lerCorpo(request, 4096); // o corpo é ignorado; só garante que não é enorme
    if (corpo.grande) return falha(413, 'invalid-argument', 'Pedido grande demais.');
    let acionamento;
    try {
      acionamento = await verificarAcionamento((n) => request.headers.get(n));
    } catch (e) {
      if (e && e.codigo === 'nao-autenticado') return falha(401, 'unauthenticated', 'Chamada do worker recusada.');
      try { registrarErro(e); } catch (x) { /* ignora */ }
      return falha(500, 'internal', 'Erro interno da LABZ AI.');
    }
    const tarefa = worker.rodar({ acionamento }).catch((e) => { try { registrarErro(e); } catch (x) { /* ignora */ } return { erro: true }; });
    if (aoFundo) {
      aoFundo(tarefa);
      return json(202, { ok: true, aceito: true });
    }
    const resumo = await tarefa;
    return json(resumo && resumo.erro ? 500 : 200, { ok: !(resumo && resumo.erro), resumo: resumo && !resumo.erro ? { processados: resumo.processados, recuperadas: resumo.recuperadas, parouPor: resumo.parouPor } : undefined });
  };
}

module.exports = { criarHandlerApi, criarHandlerWorker, lerCorpo, MAX_CORPO, STATUS };
