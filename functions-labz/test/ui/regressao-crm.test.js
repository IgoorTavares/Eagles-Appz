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

// I1 (D2 do Igor): "LABZ AI" é um item do MENU PRINCIPAL (barra de cima; no celular, a gaveta lateral
// da barra de cima, a do ERP ou a do CRM), só para o Super Admin, e sem atalho repetido no menu do perfil.
const LINK = 'a[href="labz-ai.html"]';
const ligar = (pagina) => pagina.evaluate(() => { LABZ_AI_MENU_ATIVO = true; renderTopbar(PAGINA_ATIVA_KEY); labzMenuAplicar(); });
const PAPEIS = [['SuperAdmin', true], ['Diretor', false], ['Administrativo', false], ['Financeiro', false]];
const comoPapel = (role) => ({ role, uid: role === 'SuperAdmin' ? 'sa' : 'd1', tenantId: role === 'SuperAdmin' ? null : 't1' });
async function abrirLogado(s, pg, role, viewport) {
  const r = await novaPagina(nav, { teste: comoPapel(role), viewport });
  await r.pagina.goto(`${s.site}/${pg}`);
  await r.pagina.waitForFunction(() => typeof labzMenuAplicar === 'function' && typeof USUARIO_ROLE !== 'undefined' && USUARIO_ROLE !== null, null, { timeout: 20000 });
  await r.pagina.waitForTimeout(500);
  return r;
}

test('menu principal (computador): "LABZ AI" desligado para todos; ligado, só o Super Admin vê, e nunca no menu do perfil', { timeout: 120000 }, async () => {
  const s = await criarServidoresTeste();
  try {
    for (const [role, deveria] of PAPEIS) {
      const { pagina, contexto } = await abrirLogado(s, 'index.html', role);
      try {
        assert.equal(await pagina.evaluate(() => LABZ_AI_MENU_ATIVO), false, 'desligado até a publicação autorizada');
        assert.equal(await pagina.locator(`#topbar-nav ${LINK}`).count(), 0, `${role}: desligado, não aparece`);
        await ligar(pagina);
        assert.equal(await pagina.locator(`#topbar-nav ${LINK}`).count(), deveria ? 1 : 0, role);
        assert.equal(await pagina.locator(`#profile-menu ${LINK}`).count(), 0, `${role}: sem atalho repetido no perfil`);
        assert.equal(await pagina.locator('#labz-ai-crm-link').count(), 0, 'fora do CRM não há item extra');
        if (deveria) {
          assert.equal((await pagina.textContent(`#topbar-nav ${LINK}`)).trim(), 'LABZ AI');
          await pagina.evaluate(() => renderTopbar(PAGINA_ATIVA_KEY));
          assert.equal(await pagina.locator(`#topbar-nav ${LINK}`).count(), 1, 'não duplica');
          await pagina.evaluate(() => { LABZ_AI_MENU_ATIVO = false; renderTopbar(PAGINA_ATIVA_KEY); });
          assert.equal(await pagina.locator(`#topbar-nav ${LINK}`).count(), 0, 'desligar tira do menu');
        }
      } finally { await contexto.close(); }
    }
  } finally { await s.fechar(); }
});

test('menu no celular: gaveta do ERP e gaveta do CRM mostram "LABZ AI" só para o Super Admin (e o item do CRM só no celular)', { timeout: 180000 }, async () => {
  const s = await criarServidoresTeste();
  try {
    for (const [role, deveria] of PAPEIS) {
      // ERP (Painel): a gaveta é montada a partir do mesmo menu principal
      let r = await abrirLogado(s, 'index.html', role, { width: 390, height: 844 });
      try {
        await ligar(r.pagina);
        await r.pagina.evaluate(() => erpRenderMobile());
        assert.equal(await r.pagina.locator(`#erp-gaveta ${LINK}`).count(), deveria ? 1 : 0, `ERP ${role}`);
      } finally { await r.contexto.close(); }
      // CRM: a gaveta é a barra lateral do próprio CRM
      for (const [largura, visivel] of [[390, true], [1280, false]]) {
        r = await abrirLogado(s, 'crm.html', role, { width: largura, height: 844 });
        try {
          await ligar(r.pagina);
          assert.equal(await r.pagina.locator('#labz-ai-crm-link').count(), deveria ? 1 : 0, `CRM ${role} ${largura}px`);
          if (deveria) {
            assert.equal(await r.pagina.getAttribute('#labz-ai-crm-link', 'href'), 'labz-ai.html');
            assert.equal(await r.pagina.$eval('#labz-ai-crm-link', (a) => !a.hidden), visivel, `CRM ${largura}px: ${visivel ? 'aparece' : 'só na barra de cima'}`);
            await r.pagina.evaluate(() => labzMenuAplicar());
            assert.equal(await r.pagina.locator('#labz-ai-crm-link').count(), 1, 'não duplica');
          }
        } finally { await r.contexto.close(); }
      }
    }
  } finally { await s.fechar(); }
});

test('na própria página da LABZ AI o item do menu fica marcado como a página atual', { timeout: 60000 }, async () => {
  const s = await criarServidoresTeste();
  const { pagina, contexto } = await abrirLogado(s, 'labz-ai.html', 'SuperAdmin');
  try {
    await ligar(pagina);
    assert.equal(await pagina.evaluate(() => PAGINA_ATIVA_KEY), 'labz-ai');
    assert.match(await pagina.getAttribute(`#topbar-nav ${LINK}`, 'class'), /\bactive\b/);
  } finally { await contexto.close(); await s.fechar(); }
});
