// Roda os testes de integração no SIMULADOR do Firebase (login + banco +
// funções), no projeto de demonstração "demo-labz" (nunca toca o projeto real).
// Cria um .secret.local TEMPORÁRIO só com valores fictícios para os segredos
// e apaga no fim, mesmo se der erro. Precisa do firebase-tools e de Java.
//   node integracao/rodar.js            (usa "firebase" do PATH)
//   FIREBASE_BIN=/caminho/firebase node integracao/rodar.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const SEGREDO = path.join(RAIZ, '.secret.local');
// cópia temporária das regras REAIS do projeto (o simulador só lê arquivos dentro desta pasta)
const REGRAS = path.join(RAIZ, '.regras-emulador.rules');
const FICTICIOS = [
  'LABZ_SUPERADMIN_UIDS=sa-teste,sa-desativado',
  'LABZ_ANTHROPIC_API_KEY=VALOR-FICTICIO-SO-PARA-TESTE-123',
  'LABZ_OPENAI_API_KEY=',
  'LABZ_GOOGLE_API_KEY=',
].join('\n') + '\n';

if (fs.existsSync(SEGREDO)) { console.error('Já existe um .secret.local: não vou sobrescrever. Remova-o antes.'); process.exit(1); }
let codigo = 1;
const limpar = () => { fs.rmSync(SEGREDO, { force: true }); fs.rmSync(REGRAS, { force: true }); };
// apaga os temporários mesmo se o processo for interrompido (Ctrl+C ou tempo esgotado)
['SIGINT', 'SIGTERM'].forEach((sinal) => process.on(sinal, () => { limpar(); process.exit(1); }));
try {
  fs.writeFileSync(SEGREDO, FICTICIOS);
  fs.copyFileSync(path.join(RAIZ, '..', 'firestore.rules'), REGRAS);
  const bin = process.env.FIREBASE_BIN || 'firebase';
  const r = spawnSync(bin, ['emulators:exec', '--config', 'firebase.emulador.json', '--project', 'demo-labz', '--only', 'auth,firestore,functions',
    'node --test --test-concurrency=1 integracao/*.test.js'], { cwd: RAIZ, stdio: 'inherit', shell: false, timeout: 10 * 60 * 1000 });
  codigo = r.status === null ? 1 : r.status;
} finally {
  limpar();
}
process.exit(codigo);
