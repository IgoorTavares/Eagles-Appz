// Credenciais dos provedores de IA e integrações: ficam no Secret Manager do
// Google (defineSecret no index.js), NUNCA no banco, no repositório ou no
// navegador. Este módulo só sabe os NOMES dos segredos e responde se cada
// um está configurado — o valor nunca sai do servidor.
//
// lerSegredo(nome) → string | '' (injetado: no servidor lê o defineSecret;
// nos testes, um objeto qualquer).
const SEGREDOS_PROVEDORES = {
  anthropic: 'LABZ_ANTHROPIC_API_KEY',
  openai: 'LABZ_OPENAI_API_KEY',
  google: 'LABZ_GOOGLE_API_KEY',
};
const SEGREDO_UIDS = 'LABZ_SUPERADMIN_UIDS';

function statusProvedores(lerSegredo) {
  const out = {};
  Object.entries(SEGREDOS_PROVEDORES).forEach(([prov, nome]) => {
    let v = '';
    try { v = String(lerSegredo(nome) || ''); } catch (e) { v = ''; }
    out[prov] = v.trim().length >= 10 ? 'configurado' : 'nao-configurado';
  });
  return out;
}

// Uso SÓ dentro do servidor (Fase 6, ao chamar o provedor). Não existe ação da API que devolva isto.
function chaveDoProvedor(lerSegredo, provedor) {
  const nome = SEGREDOS_PROVEDORES[provedor];
  if (!nome) return '';
  try { return String(lerSegredo(nome) || '').trim(); } catch (e) { return ''; }
}

module.exports = { SEGREDOS_PROVEDORES, SEGREDO_UIDS, statusProvedores, chaveDoProvedor };
