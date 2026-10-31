// LABZ AI — Fase S2: autorização na arquitetura Supabase (Firebase Auth + Postgres da LABZ AI).
// Junta as peças SEM mudar a API: o pedido HTTP traz "Authorization: Bearer <ID token do
// Firebase>"; o token é verificado só com as chaves públicas do Google (token-firebase.js) e
// vira o mesmo { auth } que a criarApi() já recebe. A API então faz o exigirSuperAdmin de
// sempre, com o perfil vindo do banco DA LABZ AI. Para passar, é preciso TUDO:
//   1. token do Firebase válido (assinatura, iss, aud, exp, iat, auth_time, não anônimo);
//   2. UID na lista do SERVIDOR (segredo, fora do Git e do navegador);
//   3. labz_usuarios/{uid}.role exatamente "SuperAdmin" (banco da LABZ AI);
//   4. UID na lista do BANCO (labz_config/acesso) — o "botão de desligar".
// Nada aqui usa credencial do Firebase: o servidor da LABZ AI NÃO consegue ler nem gravar o
// CRM/ERP (não há caminho até o Firestore do Eagles Labz).
const { erro } = require('../nucleo/erros');
const { MENSAGEM_NEGADO } = require('./super-admin');

const caminhoPerfil = (uid) => `labz_usuarios/${uid}`;

// Opções para a criarApi() na arquitetura Supabase.
function opcoesApiSupabase(banco) {
  return { lerPerfil: (uid) => banco.obter(caminhoPerfil(uid)), verificarBloqueio: false };
}

// verificador: criarVerificadorFirebase({ projetoId }); auditoria: opcional (registra recusas sem dados do token)
function criarAcessoSupabase({ verificador, auditoria } = {}) {
  if (typeof verificador !== 'function') throw new Error('criarAcessoSupabase: falta o verificador de token');
  return async function autenticar(cabecalhoAuthorization) {
    const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(cabecalhoAuthorization || ''));
    try {
      if (!m) throw Object.assign(erro('nao-autenticado', MENSAGEM_NEGADO), { motivo: 'sem-bearer' });
      const t = await verificador(m[1]);
      // o mesmo formato de request.auth do Firebase: a API e o exigirSuperAdmin não mudam
      return { uid: t.uid, token: { email: t.email, email_verified: t.emailVerificado, firebase: { sign_in_provider: t.provedor } } };
    } catch (e) {
      if (auditoria) await auditoria.registrar('auth.token_recusado', null, 'labz', { motivo: String((e && e.motivo) || 'token').slice(0, 40) }).catch(() => {});
      throw erro('nao-autenticado', MENSAGEM_NEGADO); // a mesma mensagem sempre (não revela o motivo)
    }
  };
}

module.exports = { criarAcessoSupabase, opcoesApiSupabase, caminhoPerfil };
