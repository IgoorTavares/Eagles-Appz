// LABZ AI — backend (Fase 2: servidor seguro).
// Uma única função chamável, "labzApi", na região de São Paulo. Toda a
// lógica está em src/ (sem dependência do Firebase) e é testada sem servidor;
// aqui só ligamos o Firestore (Admin SDK) e os segredos do Secret Manager.
//
// NÃO PUBLICADO. Publicar exige o plano Blaze, os segredos criados no Google
// Cloud e o codebase "labz" no firebase.json — tudo só com autorização do Igor.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

const { criarBancoFirestore } = require('./src/armazenamento/banco-firestore');
const { criarLabz } = require('./src/servicos');
const { criarApi, traduzirErro } = require('./src/api/labz-api');
const { SEGREDOS_PROVEDORES, SEGREDO_UIDS } = require('./src/segredos/provedores');
const { erro } = require('./src/nucleo/erros');
const { MENSAGEM_NEGADO } = require('./src/auth/super-admin');

admin.initializeApp();
const db = admin.firestore();

// Segredos (Secret Manager). Os valores nunca ficam no repositório.
const UIDS = defineSecret(SEGREDO_UIDS);
const PROVEDORES = Object.fromEntries(Object.values(SEGREDOS_PROVEDORES).map((nome) => [nome, defineSecret(nome)]));
const lerSegredo = (nome) => (PROVEDORES[nome] ? PROVEDORES[nome].value() : '');

const banco = criarBancoFirestore(db);
const servicos = criarLabz({ banco });

// Confere de novo o token com checkRevoked: além da assinatura (que o
// Firebase já confere), recusa conta desativada e sessões revogadas na hora.
async function verificarToken(request) {
  const cab = (request.rawRequest && request.rawRequest.headers && request.rawRequest.headers.authorization) || '';
  const m = /^Bearer (.+)$/.exec(cab);
  try {
    if (!m) throw new Error('sem token');
    const dec = await admin.auth().verifyIdToken(m[1], true);
    if (dec.uid !== request.auth.uid) throw new Error('token de outra pessoa');
  } catch (e) {
    await servicos.auditoria.registrar('auth.token_recusado', { uid: request.auth.uid }, 'labz', { motivo: String((e && e.code) || (e && e.message) || 'token').slice(0, 80) });
    throw erro('nao-autenticado', MENSAGEM_NEGADO);
  }
}

const api = criarApi({ servicos, banco, uidsAutorizados: () => UIDS.value(), lerSegredo, verificarToken });

exports.labzApi = onCall({
  region: 'southamerica-east1',
  maxInstances: 2,
  timeoutSeconds: 60,
  secrets: [UIDS, ...Object.values(PROVEDORES)],
}, async (request) => {
  try {
    return await api(request);
  } catch (e) {
    const t = traduzirErro(e);
    if (t.codigo === 'internal') logger.error('labzApi: erro interno', { mensagem: e && e.message, pilha: e && e.stack });
    throw new HttpsError(t.codigo, t.mensagem, t.detalhes);
  }
});
