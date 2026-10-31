// Apoio dos testes de navegador (Fase S4): abre uma página com o Firebase FALSO e sem internet
// (tudo de fora é bloqueado; só o site e a API de teste em 127.0.0.1 respondem).
const fs = require('node:fs');
const path = require('node:path');

const FALSO = fs.readFileSync(path.join(__dirname, 'firebase-falso.js'), 'utf8');

let chromium = null;
function playwright() {
  if (!chromium) ({ chromium } = require('playwright')); // vem pré-instalado no ambiente (não é dependência do projeto)
  return chromium;
}

async function abrirNavegador() { return playwright().launch(); }

// teste: { role, uid, tokenUid, tokenModo, logado } (vai para window.__TESTE)
async function novaPagina(navegador, { teste = {}, viewport = { width: 1280, height: 900 }, semFirebase = false } = {}) {
  const contexto = await navegador.newContext({ viewport, serviceWorkers: 'block' });
  const erros = [];
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => erros.push(String(e && e.message)));
  await pagina.addInitScript((t) => { window.__TESTE = t; }, teste);
  await contexto.route(/^https?:\/\/(?!127\.0\.0\.1)/, (rota) => {
    const u = rota.request().url();
    if (!semFirebase && /gstatic\.com\/firebasejs\/.*firebase-app-compat\.js$/.test(u)) return rota.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO });
    if (!semFirebase && /gstatic\.com\/firebasejs\//.test(u)) return rota.fulfill({ status: 200, contentType: 'text/javascript', body: '/* parte do SDK falso: nada */' });
    return rota.abort(); // fontes, CDN etc.: sem internet nos testes
  });
  return { pagina, contexto, erros };
}

module.exports = { abrirNavegador, novaPagina };
