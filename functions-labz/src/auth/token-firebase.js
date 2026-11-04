// LABZ AI — Fase S2: verificação do Firebase ID Token SEM credencial do Firebase.
// Usa só as chaves PÚBLICAS do Google (as mesmas que o Firebase Admin usa por dentro) e
// confere, nesta ordem: formato → algoritmo RS256 → chave (kid) conhecida → ASSINATURA →
// emissor (iss) → audiência (aud = projeto) → validade (exp) → emissão (iat) e login
// (auth_time) não no futuro → usuário (sub) → login não anônimo.
// Funciona em Node e em Deno (Supabase Edge Functions): só node:crypto. A função de rede que
// baixa as chaves (buscar) é RECEBIDA de quem liga o servidor (S3): nada em src/ acessa a rede sozinho.
//
// LIMITAÇÃO (documentada): sem credencial de administrador do Firebase, este verificador
// NÃO consegue saber se a conta foi DESATIVADA ou se as sessões foram REVOGADAS depois que o
// token foi emitido. O token do Firebase vale no máximo 1 hora; dentro dessa janela, quem tem
// um token válido continua passando AQUI. Por isso a autorização da LABZ AI exige também o UID
// na lista do servidor E na lista do banco (labz_config/acesso): tirar o UID de qualquer uma
// delas corta o acesso NA HORA (ver docs/supabase no README).
const crypto = require('node:crypto');
const { erro } = require('../nucleo/erros');

const URL_CHAVES_GOOGLE = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const MAX_TOKEN = 4096;
const MENSAGEM = 'Login inválido ou expirado. Entre de novo no Eagles Labz.';

const deB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function lerParte(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('base64url inválido');
  const v = JSON.parse(deB64url(s).toString('utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('não é objeto');
  return v;
}

// Chaves públicas do Google com cache pelo Cache-Control (max-age). Falha FECHADA:
// sem chaves, ninguém entra.
function criarChavesGoogle({ buscar, agoraMs = () => Date.now() } = {}) {
  if (typeof buscar !== 'function') throw new Error('criarChavesGoogle: informe buscar(url) (a rede é ligada só no servidor)');
  let cache = null;
  let validoAte = 0;
  return async function obterChaves({ forcar = false } = {}) {
    if (!forcar && cache && agoraMs() < validoAte) return cache;
    let resp;
    try { resp = await buscar(URL_CHAVES_GOOGLE); } catch (e) { throw Object.assign(erro('nao-autenticado', MENSAGEM), { motivo: 'chaves-indisponiveis' }); }
    if (!resp || !resp.ok) throw Object.assign(erro('nao-autenticado', MENSAGEM), { motivo: 'chaves-indisponiveis' });
    const dados = await resp.json();
    const idade = /max-age=(\d+)/.exec((resp.headers && resp.headers.get && resp.headers.get('cache-control')) || '');
    cache = Object.freeze(Object.assign({}, dados));
    validoAte = agoraMs() + Math.min(Number(idade ? idade[1] : 3600), 6 * 3600) * 1000;
    return cache;
  };
}

// projetoId: o projeto do Firebase do Eagles Labz (ex.: "labz-18246").
// obterChaves({ forcar }) → { kid: PEM (certificado ou chave pública) }.
function criarVerificadorFirebase({ projetoId, obterChaves, agoraSeg = () => Math.floor(Date.now() / 1000), folgaSeg = 30 } = {}) {
  if (!/^[a-z0-9-]{4,40}$/.test(String(projetoId || ''))) throw new Error('projetoId do Firebase inválido');
  if (typeof obterChaves !== 'function') throw new Error('criarVerificadorFirebase: informe obterChaves (ex.: criarChavesGoogle({ buscar: fetch }))');
  const emissor = `https://securetoken.google.com/${projetoId}`;
  const negar = (motivo) => { throw Object.assign(erro('nao-autenticado', MENSAGEM), { motivo }); };

  return async function verificarTokenFirebase(token) {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return negar('formato');
    const partes = token.split('.');
    if (partes.length !== 3 || partes.some((p) => !p)) return negar('formato');
    let cab;
    let carga;
    try { cab = lerParte(partes[0]); carga = lerParte(partes[1]); } catch (e) { return negar('formato'); }
    if (cab.alg !== 'RS256') return negar('algoritmo');
    if (typeof cab.kid !== 'string' || !cab.kid) return negar('sem-kid');
    let chaves = await obterChaves();
    if (!Object.prototype.hasOwnProperty.call(chaves, cab.kid)) chaves = await obterChaves({ forcar: true }); // o Google troca as chaves de tempos em tempos
    if (!Object.prototype.hasOwnProperty.call(chaves, cab.kid)) return negar('chave-desconhecida');
    let valida = false;
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(partes[2])) throw new Error('assinatura');
      valida = crypto.createVerify('RSA-SHA256').update(`${partes[0]}.${partes[1]}`).verify(crypto.createPublicKey(chaves[cab.kid]), deB64url(partes[2]));
    } catch (e) { valida = false; }
    if (!valida) return negar('assinatura');
    if (carga.iss !== emissor) return negar('emissor');
    if (carga.aud !== projetoId) return negar('audiencia');
    const agora = agoraSeg();
    if (typeof carga.exp !== 'number' || carga.exp <= agora - folgaSeg) return negar('expirado');
    if (typeof carga.iat !== 'number' || carga.iat > agora + folgaSeg) return negar('emitido-no-futuro');
    if (typeof carga.auth_time !== 'number' || carga.auth_time > agora + folgaSeg) return negar('login-no-futuro');
    if (typeof carga.sub !== 'string' || !carga.sub || carga.sub.length > 128) return negar('usuario');
    const provedor = carga.firebase && carga.firebase.sign_in_provider;
    if (provedor === 'anonymous') return negar('login-anonimo');
    return Object.freeze({ uid: carga.sub, email: typeof carga.email === 'string' ? carga.email : '', emailVerificado: carga.email_verified === true, provedor: provedor || null, emitidoEm: carga.iat, expiraEm: carga.exp });
  };
}

module.exports = { criarVerificadorFirebase, criarChavesGoogle, URL_CHAVES_GOOGLE, MENSAGEM };
