// Apoio dos testes (Fase S2/S3): ID tokens do Firebase FICTÍCIOS, assinados por uma chave RSA
// gerada na hora (nenhuma chave fica em arquivo). O verificador de teste aceita essa chave POR
// INJEÇÃO (obterChaves); em produção as chaves vêm só do Google.
const crypto = require('node:crypto');

const PROJETO = 'labz-18246';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const chave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = chave.publicKey.export({ type: 'spki', format: 'pem' });
const obterChaves = async () => ({ k1: pem });

function emitir(carga = {}, { agoraSeg = Math.floor(Date.now() / 1000) } = {}) {
  const h = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
  const c = Object.assign({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'sa', iat: agoraSeg - 60, auth_time: agoraSeg - 120, exp: agoraSeg + 3000, email: 'sa@teste.local', email_verified: true, firebase: { sign_in_provider: 'password' } }, carga);
  const corpo = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
  return `${corpo}.${b64url(crypto.createSign('RSA-SHA256').update(corpo).sign(chave.privateKey))}`;
}

module.exports = { PROJETO, emitir, obterChaves, pem };
