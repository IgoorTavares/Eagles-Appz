// Fase S4 — REGRESSÃO do CRM/ERP no navegador: a única mudança no Eagles Labz é o atalho
// "LABZ AI" (desligado) no script.js. Aqui:
//  1. todas as páginas do site abrem com o script.js NOVO sem nenhum erro de JavaScript a mais do que
//     com o script.js ANTERIOR (o da branch antes da S4, via git);
//  2. o atalho não aparece para ninguém enquanto LABZ_AI_MENU_ATIVO = false; ligado (simulado no
//     teste), só aparece para o Super Admin, logo abaixo de "Empresas (Super Admin)".
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { criarServidoresTeste, RAIZ } = require('./servidor-teste');
const { abrirNavegador, novaPagina } = require('./ajuda-navegador');

let nav;
test.before(async () => { nav = await abrirNavegador(); });
test.after(async () => { if (nav) await nav.close(); });

// o script.js de antes da S4 (último commit que o alterou antes desta fase); sem git, o teste é pulado
function scriptAnterior() {
  try {
    const base = execFileSync('git', ['log', '-1', '--format=%H', 'd5731a5', '--', 'script.js'], { cwd: RAIZ, encoding: 'utf8' }).trim();
    return base ? execFileSync('git', ['show', `${base}:script.js`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : null;
  } catch (e) { return null; }
}

async function errosPorPagina(s, paginas) {
  const out = {};
  for (const pg of paginas) {
    const { pagina, contexto, erros } = await novaPagina(nav, { semFirebase: true }); // modo local (sem nuvem), como no navegador sem login configurado
    try {
      await pagina.goto(`${s.site}/${pg}`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      await pagina.waitForTimeout(700);
      out[pg] = [...new Set(erros)].sort();
    } finally { await contexto.close(); }
  }
  return out;
}

test('todas as páginas do Eagles Labz: nenhum erro de JavaScript novo com o script.js da S4', { timeout: 600000 }, async (t) => {
  const anterior = scriptAnterior();
  if (!anterior) { t.skip('sem o histórico do git'); return; }
  const m = await import(pathToFileURL(path.join(RAIZ, '.github/pages/montar-site.mjs')).href);
  const paginas = m.PAGINAS;
  const sNovo = await criarServidoresTeste();
  const sAntes = await criarServidoresTeste({ scriptJs: anterior });
  try {
    const novo = await errosPorPagina(sNovo, paginas);
    const antes = await errosPorPagina(sAntes, paginas);
    const piorou = paginas.filter((p) => novo[p].some((e) => !antes[p].includes(e)));
    assert.deepEqual(piorou, [], `erros novos: ${piorou.map((p) => `${p}: ${novo[p].join(' | ')}`).join('\n')}`);
    assert.equal(paginas.length, 37);
  } finally { await sNovo.fechar(); await sAntes.fechar(); }
});

test('menu: o atalho "LABZ AI" não aparece para ninguém (desligado); ligado, só para o Super Admin', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  try {
    for (const [role, deveria] of [['SuperAdmin', true], ['Diretor', false], ['Administrativo', false], ['Financeiro', false]]) {
      const { pagina, contexto } = await novaPagina(nav, { teste: { role, uid: role === 'SuperAdmin' ? 'sa' : 'd1', tenantId: role === 'SuperAdmin' ? null : 't1' } });
      try {
        await pagina.goto(`${s.site}/index.html`);
        await pagina.waitForFunction(() => typeof labzMenuAplicar === 'function' && typeof USUARIO_ROLE !== 'undefined' && USUARIO_ROLE !== null, null, { timeout: 20000 });
        await pagina.waitForTimeout(500);
        assert.equal(await pagina.evaluate(() => LABZ_AI_MENU_ATIVO), false);
        assert.equal(await pagina.locator('#labz-ai-menu-link').count(), 0, `${role}: desligado, não aparece`);
        const r = await pagina.evaluate(() => labzMenuAplicar(true)); // simula a publicação autorizada
        assert.equal(r, deveria, role);
        assert.equal(await pagina.locator('#labz-ai-menu-link').count(), deveria ? 1 : 0, role);
        if (deveria) {
          assert.equal(await pagina.getAttribute('#labz-ai-menu-link', 'href'), 'labz-ai.html');
          assert.equal(await pagina.evaluate(() => document.querySelector('#labz-ai-menu-link').previousElementSibling.getAttribute('href')), 'empresas.html');
          assert.equal(await pagina.evaluate(() => labzMenuAplicar(true)), true);
          assert.equal(await pagina.locator('#labz-ai-menu-link').count(), 1, 'não duplica');
          await pagina.evaluate(() => labzMenuAplicar(false));
          assert.equal(await pagina.locator('#labz-ai-menu-link').count(), 0, 'desligar remove');
        }
      } finally { await contexto.close(); }
    }
  } finally { await s.fechar(); }
});
