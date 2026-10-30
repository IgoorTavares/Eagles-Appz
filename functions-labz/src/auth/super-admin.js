// Segunda camada de autorização da LABZ AI (no servidor).
// Na Fase 2, cada função onCall chama exigirSuperAdmin(req.auth, deps) antes
// de qualquer coisa. O Admin SDK ignora as firestore.rules, então ESTA
// verificação é a que vale no servidor. Passa só quem:
//   1. está logado (token verificado pelo Firebase; nunca login anônimo);
//   2. tem usuarios/{uid}.role exatamente 'SuperAdmin' (nada de nível
//      desconhecido virar Diretor, como acontece no navegador);
//   3. está na lista de UIDs autorizados do servidor (segredo
//      LABZ_SUPERADMIN_UIDS no Secret Manager, fora do repositório e do
//      navegador) E na lista do banco labz_config/acesso (a das regras);
//   4. não está com a conta bloqueada por senhas erradas (tentativas_login).
// A mensagem de recusa é sempre a mesma (não revela qual passo falhou);
// o motivo fica só na auditoria.
const { erro } = require('../nucleo/erros');

const MENSAGEM_NEGADO = 'Acesso exclusivo do Super Admin autorizado.';

function lerListaUids(valor) {
  if (Array.isArray(valor)) return valor.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.trim());
  return String(valor || '').split(',').map((u) => u.trim()).filter(Boolean);
}

// deps: { banco, uidsAutorizados (lista ou "a,b"), auditoria? }
async function exigirSuperAdmin(auth, deps) {
  const negar = async (motivo, uid) => {
    if (deps.auditoria) await deps.auditoria.registrar('auth.acesso_negado', uid ? { uid } : null, 'labz', { motivo });
    throw erro(uid ? 'permissao-negada' : 'nao-autenticado', MENSAGEM_NEGADO);
  };
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) return negar('sem-login');
  const uid = auth.uid;
  const token = auth.token || {};
  if (token.firebase && token.firebase.sign_in_provider === 'anonymous') return negar('login-anonimo', uid);

  const autorizados = lerListaUids(deps.uidsAutorizados);
  if (!autorizados.length) return negar('lista-de-autorizados-vazia', uid);

  const usuario = await deps.banco.obter(`usuarios/${uid}`);
  if (!usuario || usuario.role !== 'SuperAdmin') return negar('nao-e-super-admin', uid);
  if (!autorizados.includes(uid)) return negar('fora-da-lista-de-autorizados', uid);
  // A mesma pessoa precisa estar também na lista do banco, que é a que as
  // regras do Firestore usam para a leitura (labz_config/acesso). As duas
  // listas ficam fora do repositório e do navegador; se divergirem, nega.
  const acesso = await deps.banco.obter('labz_config/acesso');
  if (!acesso || !Array.isArray(acesso.uids) || !acesso.uids.includes(uid)) return negar('fora-da-lista-do-banco', uid);

  if (token.email) {
    const tent = await deps.banco.obter(`tentativas_login/${token.email}`);
    if (tent && Number(tent.falhas) >= 5) return negar('conta-bloqueada', uid);
  }
  return Object.freeze({ tipo: 'superadmin', uid, email: token.email || '' });
}

// Os serviços só aceitam um "ator" produzido por exigirSuperAdmin.
function exigirAtor(ator) {
  if (!ator || ator.tipo !== 'superadmin' || !ator.uid || !Object.isFrozen(ator)) throw erro('permissao-negada', MENSAGEM_NEGADO);
  return ator;
}

module.exports = { exigirSuperAdmin, exigirAtor, lerListaUids, MENSAGEM_NEGADO };
