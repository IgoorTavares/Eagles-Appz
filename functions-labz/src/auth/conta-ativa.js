// LABZ AI — proteção extra (desenho aprovado pelo Igor depois da I2): CONTA DESATIVADA e SESSÃO REVOGADA.
// O verificador de token (token-firebase.js) só usa as chaves PÚBLICAS do Google: ele confirma que o login
// é legítimo, mas não sabe se a conta foi desativada ou se as sessões foram revogadas depois (o token vale
// até 1 h). Este módulo consulta o próprio Firebase Auth (Identity Toolkit, accounts:lookup) com o PRÓPRIO
// ID token da pessoa e a apiKey PÚBLICA do projeto (a mesma do firebase-config.js; não é segredo):
//   - conta desativada ("disabled") ou erro USER_DISABLED/USER_NOT_FOUND/INVALID_ID_TOKEN/TOKEN_EXPIRED → recusa;
//   - "validSince" depois do login (auth_time) → sessão revogada → recusa (a mesma regra do Firebase Admin);
//   - UID diferente do token → recusa.
// Desenho:
//   - roda SÓ para quem já passou pela lista do servidor (o intruso nunca gera consulta ao Google: não dá
//     para usar a LABZ AI para gastar a cota do Firebase);
//   - resultado BOM fica guardado por pouco tempo (padrão 5 min) por token: no máximo 1 consulta a cada
//     5 min por login; resultado ruim nunca fica guardado;
//   - falha FECHADA por padrão: sem resposta do Google (fora do ar, lento), ninguém entra;
//   - nenhuma credencial de administrador, nenhuma gravação no banco, nada do CRM/ERP.
// NÃO está ligado na produção: a labz-api publicada não usa este módulo. Ligar exige a apiKey pública na
// configuração da função e uma nova publicação (etapa com autorização do Igor).
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');
const { MENSAGEM_NEGADO } = require('./super-admin');

const URL_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const ERROS_DE_CONTA = new Set(['USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_ID_TOKEN', 'TOKEN_EXPIRED', 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN']);

function criarConferidorConta({ apiKey, buscar, agoraMs = () => Date.now(), cacheMs = 5 * 60 * 1000, tempoMs = 3000, falhaFechada = true, maxCache = 200 } = {}) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(String(apiKey || ''))) throw new Error('criarConferidorConta: apiKey pública do Firebase inválida');
  if (typeof buscar !== 'function') throw new Error('criarConferidorConta: informe buscar(url, opcoes) (a rede é ligada só no servidor)');
  if (!Number.isInteger(cacheMs) || cacheMs < 0 || cacheMs > 15 * 60 * 1000) throw new Error('criarConferidorConta: cacheMs entre 0 e 15 minutos');
  const bons = new Map(); // sha256(token) → válido até (ms)
  const negar = (motivo) => { throw Object.assign(erro('nao-autenticado', MENSAGEM_NEGADO), { motivo }); };

  return async function conferirConta(idToken, { uid, loginEm }) {
    const chave = crypto.createHash('sha256').update(String(idToken)).digest('hex');
    const ate = bons.get(chave);
    if (ate && ate > agoraMs()) return { cache: true };
    let resp;
    let corpo = null;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), tempoMs) : null;
      try {
        resp = await buscar(`${URL_LOOKUP}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }), redirect: 'error', signal: ctrl ? ctrl.signal : undefined });
        corpo = await resp.json().catch(() => null);
      } finally { if (t) clearTimeout(t); }
    } catch (e) {
      if (falhaFechada) return negar('conta-indisponivel');
      return { indisponivel: true };
    }
    if (!resp.ok) {
      const msg = String((corpo && corpo.error && corpo.error.message) || '').split(/[ :]/)[0];
      if (ERROS_DE_CONTA.has(msg)) return negar(msg === 'USER_DISABLED' ? 'conta-desativada' : 'sessao-invalida');
      if (falhaFechada) return negar('conta-indisponivel');
      return { indisponivel: true };
    }
    const u = corpo && Array.isArray(corpo.users) && corpo.users.length === 1 ? corpo.users[0] : null;
    if (!u) return negar('conta-desconhecida');
    if (u.localId !== uid) return negar('conta-diferente');
    if (u.disabled === true) return negar('conta-desativada');
    const desde = Number(u.validSince);
    if (Number.isFinite(desde) && desde > 0 && Number(loginEm) < desde) return negar('sessao-revogada');
    if (cacheMs > 0) {
      if (bons.size >= maxCache) bons.delete(bons.keys().next().value);
      bons.set(chave, agoraMs() + cacheMs);
    }
    return { cache: false };
  };
}

// Embrulha o autenticar() atual (acesso-supabase.js) SEM mudar a ordem das travas da porta HTTP:
// a consulta à conta só acontece para quem está na lista do servidor (uidPermitido); quem não está segue
// direto para a recusa de sempre, sem consulta nenhuma ao Google.
function comConferenciaDeConta(autenticar, { conferirConta, uidPermitido, aoRecusar } = {}) {
  if (typeof autenticar !== 'function' || typeof conferirConta !== 'function' || typeof uidPermitido !== 'function') throw new Error('comConferenciaDeConta: faltam peças');
  return async function autenticarComConta(cabecalho) {
    const auth = await autenticar(cabecalho); // assinatura, emissor, público, validade: já conferidos
    if (!uidPermitido(auth.uid)) return auth;
    const idToken = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(cabecalho || ''))[1];
    // o token já teve a assinatura conferida: ler o auth_time da carga é seguro
    const carga = JSON.parse(Buffer.from(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    try {
      await conferirConta(idToken, { uid: auth.uid, loginEm: carga.auth_time });
    } catch (e) {
      if (aoRecusar) { try { aoRecusar({ motivo: String((e && e.motivo) || 'conta').slice(0, 40) }); } catch (x) { /* o log nunca derruba a resposta */ } }
      throw erro('nao-autenticado', MENSAGEM_NEGADO);
    }
    return auth;
  };
}

module.exports = { criarConferidorConta, comConferenciaDeConta, URL_LOOKUP };
