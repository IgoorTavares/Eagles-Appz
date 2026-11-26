// =====================================================================
// v157 — várias pessoas usando o sistema ao mesmo tempo, sem perder dados.
// Roda SÓ no simulador do Firebase (nada de produção):
//   cd testes-concorrencia && npm install && npm run simulador
// Precisa de Java e do Chromium do Playwright.
//
// O que é conferido:
//  1. a v155 (antes) perde anotações e links (prova do problema);
//  2. a v157 não perde nada com 2 (CRM inteiro), 20, 30 e 50 pessoas;
//  3. o valor inicial não apaga dado real;
//  4. a cópia da lista antiga (migração) é completa, não altera a lista
//     antiga, roda uma vez só e não estraga nada se as regras faltarem;
//  5. v155 e v157 abertas juntas durante a troca;
//  6. sem internet e reconexão;
//  7. permissões e isolamento entre empresas.
// =====================================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as A from './ambiente.mjs';

const NOTAS = 'eagles_crm_negocio_anotacoes_v1';
const CONTATOS = 'eagles_crm_negocio_contatos_v1';
const LINKS = 'eagles_portal_links_v1';
const RESUMO = [];
const anotar = (t, linha) => { RESUMO.push(linha); t.diagnostic(linha); };

let SRV, BASE, CONT = 0;
before(async () => { ({ srv: SRV, base: BASE } = await A.subirServidor()); await A.zerarTudo(); });
after(async () => {
  console.log('\n===== RESUMO =====\n' + RESUMO.join('\n') + '\n==================');
  // encerra mesmo se o navegador ou o cliente do simulador demorarem a soltar
  setTimeout(() => process.exit(), 15000).unref();
  await Promise.race([A.fecharTudo(), A.pausa(10000)]);
  SRV.closeAllConnections(); SRV.close();
});

// ---------- ajudas ----------
async function empresaNova(plano = 'ambos') { const t = 'emp' + (++CONT); await A.criarEmpresa(t, plano); return t; }
async function pessoas(tenant, n, role = 'Administrativo', prefixo = 'P') {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await A.criarPessoa(tenant, `${prefixo}${i}x${CONT}`, role));
  return out;
}
async function abrir(lista, { versao = 'nova', pagina = '__leve.html', chaves } = {}) {
  const ps = await A.abrirVarias(BASE, lista, (i) => ({ versao: typeof versao === 'function' ? versao(i) : versao, pagina }));
  const ks = chaves || [NOTAS, CONTATOS, LINKS];
  await Promise.all(ps.map((p) => A.esperarCarregado(p, p.pessoa.role === 'Financeiro' ? ks.filter((k) => k !== LINKS) : ks, 90000)));
  return ps;
}
const fechar = (ps) => Promise.all(ps.map((p) => p.ctx.close().catch(() => {})));
const notasDb = (t) => A.listar(`tenants/${t}/crm_negocio_anotacoes`);
const contatosDb = (t) => A.listar(`tenants/${t}/crm_negocio_contatos`);
const linksDb = async (t) => ((await A.ler(`tenants/${t}/dados/${LINKS}`)) || {}).valor || {};
const legadoDb = async (t, k) => ((await A.ler(`tenants/${t}/dados/${k}`)) || {}).valor;
async function esperarContagem(fn, n, ms = 60000) { return A.esperar(async () => { const v = await fn(); return v.length >= n ? v : null; }, ms, 300).then((v) => v || fn()); }
const contar = (v) => (Array.isArray(v) ? v.length : Object.keys(v || {}).length);
// em cada página, quantas anotações (com o texto pedido) estão na tela
const notasNaPagina = (p, prefixo) => p.page.evaluate((pre) => CRM_NEGOCIO_ANOTACOES_DATA.filter((a) => String(a.texto).startsWith(pre)).length, prefixo);

// ações feitas pelas funções REAIS do sistema
function acaoNota(arg) {
  if (document.getElementById('crm-detalhe-abas')) { if (DETALHE_NEGOCIO_ID !== 'n1') abrirDetalheNegocioCrm('n1'); mostrarAbaDetalheNegocio('anotacoes'); } else DETALHE_NEGOCIO_ID = 'n1';
  document.getElementById('nova-anotacao-negocio').value = arg.texto;
  adicionarAnotacaoNegocio();
  return true;
}
function acaoContato(arg) {
  if (document.getElementById('crm-detalhe-abas')) { if (DETALHE_NEGOCIO_ID !== 'n1') abrirDetalheNegocioCrm('n1'); mostrarAbaDetalheNegocio('contatos'); } else DETALHE_NEGOCIO_ID = 'n1';
  document.getElementById('contato-negocio-nome').value = arg.nome;
  document.getElementById('contato-negocio-cargo').value = 'cargo';
  document.getElementById('contato-negocio-email').value = 'x@y.z';
  document.getElementById('contato-negocio-telefone').value = '1';
  salvarContatoNegocio();
  return true;
}
async function acaoLink(arg) { await portalCopiarLink(arg.cliente); return (PORTAL_LINKS[portalChave(arg.cliente)] || ''); }
async function acaoNotaEContato(arg) {
  DETALHE_NEGOCIO_ID = 'n1';
  document.getElementById('nova-anotacao-negocio').value = arg.texto; adicionarAnotacaoNegocio();
  document.getElementById('contato-negocio-nome').value = arg.nome; salvarContatoNegocio();
  return true;
}

// =====================================================================
test('1. ANTES (v155): a perda acontece (prova do problema)', async (t) => {
  // 2 pessoas no CRM inteiro: até 3 rodadas para flagrar a perda
  let perda2 = null;
  for (let r = 1; r <= 3 && perda2 === null; r++) {
    const emp = await empresaNova();
    const ps = await abrir(await pessoas(emp, 2), { versao: 'antiga', pagina: 'crm.html', chaves: [NOTAS] });
    await A.aoMesmoTempo(ps, acaoNota, (i) => ({ texto: `v155-${i}` }));
    await A.pausa(4000);
    const v = (await legadoDb(emp, NOTAS)) || [];
    if (v.length < 2) perda2 = `rodada ${r}: ficou ${v.length} de 2`;
    await fechar(ps);
  }
  anotar(t, `v155 · 2 pessoas (crm.html) · anotações: ${perda2 || 'sem perda em 3 rodadas'}`);

  // 20 pessoas: anotações e links de clientes diferentes
  const emp = await empresaNova();
  const ps = await abrir(await pessoas(emp, 20), { versao: 'antiga', chaves: [NOTAS, CONTATOS, LINKS] });
  await A.aoMesmoTempo(ps, acaoNota, (i) => ({ texto: `v155-${i}` }));
  await A.pausa(6000);
  const n20 = ((await legadoDb(emp, NOTAS)) || []).length;
  await A.aoMesmoTempo(ps, (a) => { portalGarantirToken(a.cliente); return true; }, (i) => ({ cliente: 'Cliente ' + i }));
  await A.pausa(6000);
  const l20 = contar(await linksDb(emp));
  anotar(t, `v155 · 20 pessoas · anotações: ficou ${n20} de 20 · links de clientes diferentes: ficou ${l20} de 20`);
  await fechar(ps);
  assert.ok(n20 < 20, 'a v155 deveria perder anotações com 20 pessoas');
  assert.ok(l20 < 20, 'a v155 deveria perder links com 20 pessoas');
});

// =====================================================================
test('2. v157 · 2 pessoas no CRM inteiro (crm.html, telas reais)', async (t) => {
  const emp = await empresaNova();
  const ps = await abrir(await pessoas(emp, 2), { pagina: 'crm.html', chaves: [NOTAS, CONTATOS, LINKS, 'eagles_crm_negocios_v1'] });
  await A.aoMesmoTempo(ps, acaoNota, (i) => ({ texto: `nota-${i}` }));
  await A.aoMesmoTempo(ps, acaoContato, (i) => ({ nome: `contato-${i}` }));
  const tokMesmo = await A.aoMesmoTempo(ps, acaoLink, () => ({ cliente: 'Seven' }));
  const tokDif = await A.aoMesmoTempo(ps, acaoLink, (i) => ({ cliente: 'Cliente ' + i }));
  const notas = await esperarContagem(() => notasDb(emp), 2);
  const conts = await esperarContagem(() => contatosDb(emp), 2);
  await A.pausa(1500);
  const links = await linksDb(emp);
  const naTela = await Promise.all(ps.map((p) => notasNaPagina(p, 'nota-')));
  const erros = ps.flatMap((p) => p.erros);
  anotar(t, `v157 · 2 pessoas (crm.html) · anotações ${notas.length}/2 · contatos ${conts.length}/2 · links ${contar(links)}/3 · mesmo cliente: ${new Set(tokMesmo).size} código · na tela: ${naTela.join(',')}`);
  await fechar(ps);
  assert.equal(notas.length, 2); assert.equal(conts.length, 2);
  assert.deepEqual(naTela, [2, 2]);
  assert.equal(new Set(tokMesmo).size, 1, 'mesmo cliente → um código só'); assert.ok(tokMesmo[0]);
  assert.equal(links.Seven, tokMesmo[0]);
  assert.equal(contar(links), 3); assert.equal(new Set(tokDif).size, 2);
  assert.deepEqual(erros, [], 'nenhum erro de JavaScript no crm.html');
});

// =====================================================================
for (const N of [20, 30, 50]) {
  test(`3. v157 · ${N} pessoas ao mesmo tempo: anotações, contatos e links`, async (t) => {
    const emp = await empresaNova();
    const t0 = Date.now();
    const ps = await abrir(await pessoas(emp, N));
    const tAbrir = Date.now() - t0;
    await A.aoMesmoTempo(ps, acaoNotaEContato, (i) => ({ texto: `nota-${i}`, nome: `contato-${i}` }));
    const notas = await esperarContagem(() => notasDb(emp), N, 90000);
    const conts = await esperarContagem(() => contatosDb(emp), N, 90000);
    const telas = await A.esperar(async () => { const v = await Promise.all(ps.map((p) => notasNaPagina(p, 'nota-'))); return v.every((x) => x === N) ? v : null; }, 60000, 500);
    // links: cada pessoa um cliente diferente
    const tokDif = await A.aoMesmoTempo(ps, acaoLink, (i) => ({ cliente: `Cliente ${i}` }));
    // quem viu o aviso "tente de novo" (prazo do simulador) tenta de novo e recebe o link certo
    const avisosLink1 = (await Promise.all(ps.map((p) => p.page.evaluate(() => window.__AVISOS.length)))).reduce((x, y) => x + y, 0);
    for (let i = 0; i < N; i++) if (!tokDif[i]) tokDif[i] = await ps[i].page.evaluate(acaoLink, { cliente: `Cliente ${i}` });
    const linksDif = await A.esperar(async () => { const l = await linksDb(emp); return contar(l) >= N ? l : null; }, 60000, 500) || await linksDb(emp);
    // links: todos pedem o MESMO cliente (com grafias diferentes)
    const grafias = ['Seven', 'seven', ' SEVEN ', 'Séven'];
    const tokMesmo = await A.aoMesmoTempo(ps, acaoLink, (i) => ({ cliente: grafias[i % grafias.length] }));
    const avisosLink2 = (await Promise.all(ps.map((p) => p.page.evaluate(() => window.__AVISOS.length)))).reduce((x, y) => x + y, 0) - avisosLink1;
    for (let i = 0; i < N; i++) if (!tokMesmo[i]) tokMesmo[i] = await ps[i].page.evaluate(acaoLink, { cliente: grafias[i % grafias.length] });
    await A.pausa(1500);
    const linksFim = await linksDb(emp);
    const chavesSeven = Object.keys(linksFim).filter((k) => /^s[eé]ven$/i.test(k.trim()));
    const avisos = (await Promise.all(ps.map((p) => p.page.evaluate(() => window.__AVISOS)))).flat();
    const avisosOutros = avisos.filter((m) => !/Link do portal/.test(m));
    anotar(t, `v157 · ${N} pessoas · abriram em ${(tAbrir / 1000).toFixed(1)} s · anotações ${notas.length}/${N} · contatos ${conts.length}/${N} · todas as telas com ${N}: ${telas ? 'sim' : 'NÃO'} · links clientes diferentes ${contar(linksDif)}/${N} (códigos distintos ${new Set(tokDif).size}) · mesmo cliente: ${new Set(tokMesmo).size} código, ${chavesSeven.length} registro · avisos "tente de novo" do link (prazo do simulador): ${avisosLink1}+${avisosLink2}, resolvidos ao repetir`);
    if (avisos.length) anotar(t, 'detalhe dos avisos: ' + JSON.stringify(ps.flatMap((p) => p.consoleErros.filter((m) => /Portal|transa|aborted|prazo/i.test(m)))).slice(0, 1500));
    await fechar(ps);
    assert.equal(notas.length, N); assert.equal(conts.length, N);
    assert.equal(new Set(notas.map((x) => x.texto)).size, N);
    assert.ok(telas, 'todas as telas mostram todas as anotações');
    assert.equal(contar(linksDif), N); assert.equal(new Set(tokDif).size, N);
    tokDif.forEach((tk, i) => assert.equal(linksDif[`Cliente ${i}`], tk, 'o código que cada pessoa recebeu é o que ficou gravado'));
    assert.equal(new Set(tokMesmo).size, 1, 'todos receberam o mesmo código');
    assert.equal(chavesSeven.length, 1); assert.equal(linksFim[chavesSeven[0]], tokMesmo[0]);
    assert.deepEqual(avisosOutros, [], 'nenhum outro aviso');
  });
}

// =====================================================================
test('4. valor inicial não apaga dado real (aparelho que abre sem o documento)', async (t) => {
  const resultado = {};
  for (const versao of ['antiga', 'nova']) {
    const emp = await empresaNova();
    const [p] = await pessoas(emp, 1);
    // abre SEM internet e com o aparelho vazio: o documento "não existe" para ele
    const x = await A.abrirPessoa(BASE, p, { versao, pagina: '__leve.html?desligado=1' });
    await x.page.waitForFunction(() => window.__ESPERANDO === true, null, { timeout: 60000 });
    await x.ctx.setOffline(true);
    await x.page.evaluate(() => window.__SEGUIR());
    await x.page.waitForFunction(() => window.__PRONTO === true, null, { timeout: 60000 });
    await A.pausa(1500);
    // enquanto isso, outra pessoa grava os dados reais
    await A.gravar(`tenants/${emp}/dados/${LINKS}`, { valor: { 'Cliente Real': 'pt-real-123456789' } });
    await A.gravar(`tenants/${emp}/dados/eagles_kanban_modelos_v1`, { valor: [{ id: 'm1', nome: 'Modelo real' }] });
    await x.page.evaluate(() => cloudWatch('eagles_kanban_modelos_v1', [], () => {}));
    await A.pausa(1000);
    await A.comInternet(x); // a internet volta
    await A.pausa(5000);
    const links = await linksDb(emp);
    const modelos = await legadoDb(emp, 'eagles_kanban_modelos_v1');
    resultado[versao] = { links, modelos };
    anotar(t, `valor inicial · ${versao === 'antiga' ? 'v155' : 'v157'} · links depois da reconexão: ${JSON.stringify(links)} · modelos: ${JSON.stringify(modelos)}`);
    await fechar([x]);
  }
  assert.deepEqual(resultado.antiga.links, {}, 'a v155 apagava o dado real com o valor inicial');
  assert.deepEqual(resultado.nova.links, { 'Cliente Real': 'pt-real-123456789' });
  assert.deepEqual(resultado.nova.modelos, [{ id: 'm1', nome: 'Modelo real' }]);

  // muitas telas abrindo ao mesmo tempo enquanto o primeiro salvamento acontece
  const emp = await empresaNova();
  const lista = await pessoas(emp, 20);
  const abrindo = A.abrirVarias(BASE, lista, { pagina: '__leve.html' }, 10);
  await A.pausa(1200);
  await A.gravar(`tenants/${emp}/dados/eagles_conteudos_modelos_v1`, { valor: [{ id: 'real', nome: 'gravado durante a abertura' }] });
  const ps = await abrindo;
  await Promise.all(ps.map((p) => p.page.evaluate(() => cloudWatch('eagles_conteudos_modelos_v1', [{ id: 'padrao' }], () => {}))));
  await A.pausa(4000);
  const cnt = await legadoDb(emp, 'eagles_conteudos_modelos_v1');
  anotar(t, `valor inicial · v157 · 20 telas abrindo durante o 1º salvamento: ${JSON.stringify(cnt)}`);
  await fechar(ps);
  assert.deepEqual(cnt, [{ id: 'real', nome: 'gravado durante a abertura' }]);
});

// =====================================================================
function legadoDeExemplo() {
  const notas = [];
  for (let i = 0; i < 150; i++) notas.push({ id: 'na_old' + i, negocioId: i % 2 ? 'n1' : 'n2', texto: `antiga ${i} — "aspas", <b>html</b>, 😀`, criadoEm: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  notas.push({ negocioId: 'n1', texto: 'sem id', criadoEm: '2026-02-01T00:00:00.000Z' });
  notas.push({ id: 'com/barra', negocioId: 'n1', texto: 'id com barra', criadoEm: '2026-02-02T00:00:00.000Z' });
  notas.push({ id: 'na_extra', negocioId: 'n1', texto: 'campo extra', criadoEm: '2026-02-03T00:00:00.000Z', extra: { a: [1, 2, { b: null }] } });
  const contatos = [];
  for (let i = 0; i < 30; i++) contatos.push({ id: 'nc_old' + i, negocioId: 'n1', nome: 'Contato ' + i, cargo: '', email: '', telefone: '' });
  return { notas, contatos };
}
const semControle = (it) => { const c = Object.assign({}, it); delete c.id; delete c._pos; return JSON.stringify(Object.keys(c).sort().reduce((a, k) => { a[k] = c[k]; return a; }, {})); };

test('5. migração: completa, uma vez só, sem alterar a lista antiga (20 pessoas abrindo juntas)', async (t) => {
  const emp = await empresaNova();
  const { notas, contatos } = legadoDeExemplo();
  await A.gravar(`tenants/${emp}/dados/${NOTAS}`, { valor: notas });
  await A.gravar(`tenants/${emp}/dados/${CONTATOS}`, { valor: contatos });
  const antes = JSON.stringify([await A.ler(`tenants/${emp}/dados/${NOTAS}`), await A.ler(`tenants/${emp}/dados/${CONTATOS}`)]);
  const ps = await abrir(await pessoas(emp, 20));
  const col = await esperarContagem(() => notasDb(emp), notas.length, 90000);
  const colC = await esperarContagem(() => contatosDb(emp), contatos.length, 90000);
  await A.pausa(2000);
  const imp = await A.ler(`tenants/${emp}/dados/${NOTAS}_importados`);
  const depois = JSON.stringify([await A.ler(`tenants/${emp}/dados/${NOTAS}`), await A.ler(`tenants/${emp}/dados/${CONTATOS}`)]);
  const telas = await Promise.all(ps.map((p) => p.page.evaluate(() => CRM_NEGOCIO_ANOTACOES_DATA.length)));
  // conteúdo idêntico (fora id/_pos), item a item
  const esperado = notas.map(semControle).sort(), obtido = (await notasDb(emp)).map(semControle).sort();
  // exclusão depois da migração: não volta
  await ps[0].page.evaluate(() => excluirAnotacaoNegocio('na_old0'));
  await A.pausa(3000);
  const ps2 = await abrir(await pessoas(emp, 5, 'Administrativo', 'Q'));
  await A.pausa(4000);
  const col2 = await notasDb(emp);
  const imp2 = await A.ler(`tenants/${emp}/dados/${NOTAS}_importados`);
  anotar(t, `migração · 20 pessoas abrindo juntas · anotações ${col.length}/${notas.length} · contatos ${colC.length}/${contatos.length} · lista antiga intacta: ${antes === depois ? 'sim' : 'NÃO'} · importados ${imp.ids.length} · telas ${Math.min(...telas)}–${Math.max(...telas)} · excluída depois não volta: ${col2.length === notas.length - 1 ? 'sim' : 'NÃO'} · 2ª abertura sem cópia nova: ${imp2.atualizadoEm === imp.atualizadoEm ? 'sim' : 'NÃO'}`);
  await fechar(ps.concat(ps2));
  assert.equal(col.length, notas.length); assert.equal(colC.length, contatos.length);
  assert.deepEqual(obtido, esperado, 'conteúdo idêntico');
  assert.equal(antes, depois, 'a lista antiga não foi alterada');
  assert.equal(imp.ids.length, notas.length);
  assert.ok(telas.every((x) => x === notas.length));
  assert.equal(col2.length, notas.length - 1);
  assert.ok(!col2.some((x) => x.id === 'na_old0'));
  assert.equal(imp2.atualizadoEm, imp.atualizadoEm, 'abrir de novo não copia nada');
  assert.ok((await notasDb(emp)).some((x) => x.texto === 'sem id' && /^leg_/.test(x.id)));
  assert.ok((await notasDb(emp)).some((x) => x.texto === 'id com barra' && /^leg_/.test(x.id)));
});

test('5b. migração sem as regras novas publicadas: nada é apagado nem sobrescrito', async (t) => {
  const emp = await empresaNova();
  const { notas } = legadoDeExemplo();
  await A.gravar(`tenants/${emp}/dados/${NOTAS}`, { valor: notas });
  const antes = JSON.stringify(await A.ler(`tenants/${emp}/dados/${NOTAS}`));
  const regrasAntigas = execFileSync('git', ['show', A.COMMIT_ANTIGO + ':firestore.rules'], { cwd: A.RAIZ }).toString();
  await A.trocarRegras(regrasAntigas);
  let ps;
  try {
    const [p] = await pessoas(emp, 1);
    const x = await A.abrirPessoa(BASE, p, { pagina: '__leve.html' });
    ps = [x];
    await x.page.waitForFunction((k) => CLOUD_ESTADO_CHAVES[k] === 'erro', NOTAS, { timeout: 60000 });
    const salvou = await x.page.evaluate(() => { DETALHE_NEGOCIO_ID = 'n1'; document.getElementById('nova-anotacao-negocio').value = 'tentativa'; adicionarAnotacaoNegocio(); return CLOUD_ESTADO_CHAVES['eagles_crm_negocio_anotacoes_v1']; });
    await A.pausa(2000);
    const depois = JSON.stringify(await A.ler(`tenants/${emp}/dados/${NOTAS}`));
    const col = await notasDb(emp);
    const imp = await A.ler(`tenants/${emp}/dados/${NOTAS}_importados`);
    anotar(t, `migração sem regras novas · estado ${salvou} · lista antiga intacta: ${antes === depois ? 'sim' : 'NÃO'} · coleção ${col.length} · importados ${imp ? 'existe' : 'não existe'}`);
    assert.equal(antes, depois); assert.equal(col.length, 0); assert.equal(imp, null);
  } finally { await A.trocarRegras(A.regrasReais()); if (ps) await fechar(ps); }
  // regras publicadas: a próxima abertura copia tudo
  const ps2 = await abrir(await pessoas(emp, 1, 'Administrativo', 'R'));
  const col = await esperarContagem(() => notasDb(emp), notas.length, 60000);
  anotar(t, `migração depois de publicar as regras · ${col.length}/${notas.length}`);
  await fechar(ps2);
  assert.equal(col.length, notas.length);
});

// =====================================================================
test('6. convivência: v155 e v157 abertas juntas durante a troca', async (t) => {
  const emp = await empresaNova();
  const { notas } = legadoDeExemplo();
  await A.gravar(`tenants/${emp}/dados/${NOTAS}`, { valor: notas.slice(0, 10) });
  // 1 aparelho antigo + 19 novos anotando ao mesmo tempo
  const lista = await pessoas(emp, 20);
  const ps = await abrir(lista, { versao: (i) => (i === 0 ? 'antiga' : 'nova'), chaves: [NOTAS, CONTATOS] });
  await esperarContagem(() => notasDb(emp), 10, 60000);
  await A.aoMesmoTempo(ps, acaoNota, (i) => ({ texto: `mix-${i}` }));
  const col = await A.esperar(async () => { const c = await notasDb(emp); return c.filter((x) => x.texto.startsWith('mix-')).length >= 20 ? c : null; }, 60000, 500) || await notasDb(emp);
  const mix = col.filter((x) => x.texto.startsWith('mix-')).map((x) => x.texto);
  anotar(t, `convivência · 1 antigo + 19 novos · ficaram ${mix.length}/20 (o do aparelho antigo: ${mix.includes('mix-0') ? 'sim' : 'NÃO'})`);
  assert.equal(mix.length, 20);
  // o aparelho antigo exclui uma anotação: na v157 ela continua (lado seguro, nada some)
  await ps[0].page.evaluate(() => excluirAnotacaoNegocio('na_old1'));
  await A.pausa(3000);
  assert.ok((await notasDb(emp)).some((x) => x.id === 'na_old1'));
  await fechar(ps);

  // 5 antigos + 15 novos: os novos nunca perdem; entre os antigos a perda é a da v155
  const emp2 = await empresaNova();
  const ps2 = await abrir(await pessoas(emp2, 20), { versao: (i) => (i < 5 ? 'antiga' : 'nova'), chaves: [NOTAS, CONTATOS] });
  await A.aoMesmoTempo(ps2, acaoNota, (i) => ({ texto: `mix-${i}` }));
  await A.pausa(8000);
  const c2 = (await notasDb(emp2)).map((x) => x.texto);
  const novos = c2.filter((x) => Number(x.split('-')[1]) >= 5).length, antigos = c2.filter((x) => Number(x.split('-')[1]) < 5).length;
  anotar(t, `convivência · 5 antigos + 15 novos · novos ${novos}/15 · antigos ${antigos}/5 (perda entre aparelhos antigos é da própria v155)`);
  await fechar(ps2);
  assert.equal(novos, 15); assert.ok(antigos >= 1);
});

test('6b. convivência: aparelho antigo com a lista de links desatualizada não apaga nem troca link', async (t) => {
  const emp = await empresaNova();
  const [pa, pn] = await pessoas(emp, 2);
  const novo = await A.abrirPessoa(BASE, pn, { pagina: '__leve.html' });
  const antigo = await A.abrirPessoa(BASE, pa, { versao: 'antiga', pagina: '__leve.html' });
  await Promise.all([A.esperarCarregado(novo, [LINKS]), A.esperarCarregado(antigo, [LINKS])]);
  // o antigo fica sem internet (lista parada no tempo)
  await antigo.page.evaluate(() => firestoreDb.disableNetwork());
  // o novo cria o link da Seven; o retrato público é publicado
  const tokSeven = await novo.page.evaluate(() => portalGarantirToken('Seven'));
  await A.gravar(`portais_publicos/${tokSeven}`, { tenantId: emp, cliente: 'Seven', cfg: {}, conteudos: [] });
  // o antigo, ainda sem a Seven na lista, cria o link da Caniballs e grava a lista INTEIRA
  await antigo.page.evaluate(() => { portalGarantirToken('Caniballs'); });
  await antigo.page.evaluate(() => firestoreDb.enableNetwork());
  const fim = await A.esperar(async () => { const l = await linksDb(emp); return l.Seven && l.Caniballs ? l : null; }, 30000, 300) || await linksDb(emp);
  anotar(t, `convivência · links · antigo desatualizado gravou a lista inteira · Seven ${fim.Seven === tokSeven ? 'mantida (devolvida pela v157)' : 'PERDIDA'} · Caniballs ${fim.Caniballs ? 'mantida' : 'PERDIDA'}`);
  assert.equal(fim.Seven, tokSeven); assert.ok(fim.Caniballs);

  // link trocado ("link novo") pelo novo; o antigo, desatualizado, devolve o código velho
  await antigo.page.evaluate(() => firestoreDb.disableNetwork());
  await novo.page.evaluate(() => portalTrocarToken('Seven'));
  const tokNovo = (await linksDb(emp)).Seven;
  await A.gravar(`portais_publicos/${tokNovo}`, { tenantId: emp, cliente: 'Seven', cfg: {}, conteudos: [] });
  await antigo.page.evaluate(() => { portalGarantirToken('Outro'); });
  await antigo.page.evaluate(() => firestoreDb.enableNetwork());
  const fim2 = await A.esperar(async () => { const l = await linksDb(emp); return l.Outro && l.Seven === tokNovo ? l : null; }, 30000, 300) || await linksDb(emp);
  const velhoPublico = await A.ler(`portais_publicos/${tokSeven}`);
  anotar(t, `convivência · links · código velho devolvido pelo antigo · ficou o novo: ${fim2.Seven === tokNovo ? 'sim' : 'NÃO'} · retrato do código velho apagado: ${velhoPublico ? 'NÃO' : 'sim'}`);
  assert.notEqual(tokNovo, tokSeven); assert.equal(fim2.Seven, tokNovo); assert.equal(velhoPublico, null);

  // o aparelho antigo usa "link novo" DE PROPÓSITO (apaga o retrato público antes): a troca vale
  await antigo.page.waitForFunction((tk) => PORTAL_LINKS.Seven === tk, tokNovo, { timeout: 30000 }); // o antigo já vê o link vigente
  await antigo.page.evaluate(() => portalNovoLink('Seven'));
  const fim3 = await A.esperar(async () => { const l = await linksDb(emp); return l.Seven && l.Seven !== tokNovo ? l : null; }, 30000, 300) || await linksDb(emp);
  await A.pausa(4000);
  const fim4 = await linksDb(emp);
  const reservas = (await A.listar(`tenants/${emp}/dados`)).filter((d) => d.id.startsWith('eagles_portal_links_v1__r_'));
  const resSeven = reservas.find((d) => /seven/i.test(d.nome));
  anotar(t, `convivência · links · "link novo" feito de propósito no aparelho antigo · a troca vale: ${fim4.Seven === fim3.Seven && fim4.Seven !== tokNovo ? 'sim' : 'NÃO'} · reserva acompanhou: ${resSeven && resSeven.token === fim4.Seven ? 'sim' : 'NÃO'}`);
  await fechar([novo, antigo]);
  assert.notEqual(fim4.Seven, tokNovo); assert.equal(fim4.Seven, fim3.Seven);
  assert.equal(resSeven.token, fim4.Seven);
});

// =====================================================================
test('7. sem internet e reconexão', async (t) => {
  const emp = await empresaNova();
  const ps = await abrir(await pessoas(emp, 3));
  const [off, on, on2] = ps;
  await A.semInternet(off);
  await off.page.evaluate(() => { DETALHE_NEGOCIO_ID = 'n1'; for (let i = 0; i < 3; i++) { document.getElementById('nova-anotacao-negocio').value = 'off-' + i; adicionarAnotacaoNegocio(); } document.getElementById('contato-negocio-nome').value = 'contato-off'; salvarContatoNegocio(); });
  await on.page.evaluate(() => { DETALHE_NEGOCIO_ID = 'n1'; for (let i = 0; i < 3; i++) { document.getElementById('nova-anotacao-negocio').value = 'on-' + i; adicionarAnotacaoNegocio(); } });
  // link sem internet: não cria nada e avisa
  const tokOff = await off.page.evaluate(async () => { await portalCopiarLink('Cliente Off'); return [PORTAL_LINKS['Cliente Off'] || '', window.__AVISOS.slice(-1)[0] || '', window.__LINKS.length]; });
  await A.pausa(1500);
  const linksSemNet = await linksDb(emp);
  await A.comInternet(off);
  const col = await esperarContagem(() => notasDb(emp), 6, 60000);
  const c = await esperarContagem(() => contatosDb(emp), 1, 60000);
  const telas = await A.esperar(async () => { const v = await Promise.all(ps.map((p) => p.page.evaluate(() => CRM_NEGOCIO_ANOTACOES_DATA.length))); return v.every((x) => x === 6) ? v : null; }, 30000, 300);
  // reconectado: duas pessoas pedem o link do mesmo cliente
  const toks = await A.aoMesmoTempo([off, on2], acaoLink, () => ({ cliente: 'Cliente Off' }));
  anotar(t, `sem internet · anotações ${col.length}/6 · contato ${c.length}/1 · telas iguais: ${telas ? 'sim' : 'NÃO'} · link sem internet: ${tokOff[0] ? 'CRIADO' : 'não criado'}, aviso: "${tokOff[1].slice(0, 60)}…" · depois da volta: ${new Set(toks).size} código`);
  await fechar(ps);
  assert.equal(col.length, 6); assert.equal(c.length, 1); assert.ok(telas);
  assert.equal(tokOff[0], ''); assert.match(tokOff[1], /internet/); assert.equal(tokOff[2], 0);
  assert.equal(contar(linksSemNet), 0);
  assert.equal(new Set(toks).size, 1); assert.ok(toks[0]);
});

// =====================================================================
test('8. permissões e isolamento entre empresas', async (t) => {
  const e1 = await empresaNova(), e2 = await empresaNova();
  const [adm1] = await pessoas(e1, 1);
  const [fin1] = await pessoas(e1, 1, 'Financeiro', 'F');
  const [adm2] = await pessoas(e2, 1, 'Administrativo', 'S');
  const ps = await abrir([adm1, fin1, adm2], { chaves: [NOTAS, CONTATOS, LINKS] });
  const [a1, f1, a2] = ps;
  await A.aoMesmoTempo([a1, a2], acaoNota, (i) => ({ texto: `empresa-${i + 1}` }));
  const r = await f1.page.evaluate(async () => {
    DETALHE_NEGOCIO_ID = 'n1'; document.getElementById('nova-anotacao-negocio').value = 'financeiro'; adicionarAnotacaoNegocio();
    let tok = 'erro'; try { tok = await portalGarantirToken('Cliente F'); } catch (e) { tok = 'erro'; }
    return { tok, avisos: window.__AVISOS };
  });
  await A.pausa(4000);
  const n1 = await notasDb(e1), n2 = await notasDb(e2);
  const telaA2 = await a2.page.evaluate(() => CRM_NEGOCIO_ANOTACOES_DATA.map((x) => x.texto));
  const telaF1 = await f1.page.evaluate(() => CRM_NEGOCIO_ANOTACOES_DATA.map((x) => x.texto));
  anotar(t, `permissões · empresa 1: ${n1.map((x) => x.texto)} · empresa 2: ${n2.map((x) => x.texto)} · Financeiro gravou: ${n1.some((x) => x.texto === 'financeiro') ? 'SIM' : 'não'} (aviso: ${r.avisos.length}) · Financeiro vê: ${telaF1}`);
  await fechar(ps);
  assert.deepEqual(n1.map((x) => x.texto), ['empresa-1']);
  assert.deepEqual(n2.map((x) => x.texto), ['empresa-2']);
  assert.deepEqual(telaA2, ['empresa-2']);
  assert.ok(telaF1.includes('empresa-1'), 'o Financeiro lê');
  assert.ok(!n1.some((x) => x.texto === 'financeiro'), 'o Financeiro não grava');
  assert.equal(r.tok, ''); assert.ok(r.avisos.length >= 1);
  assert.equal(contar(await linksDb(e1)), 0);
});

// =====================================================================
test('9. voltar atrás (reversão para a v155) sem perder nada', async (t) => {
  const emp = await empresaNova();
  const { notas } = legadoDeExemplo();
  await A.gravar(`tenants/${emp}/dados/${NOTAS}`, { valor: notas.slice(0, 20) });
  const [dir] = await pessoas(emp, 1, 'Diretor', 'D');
  const [x] = await abrir([dir]);
  await esperarContagem(() => notasDb(emp), 20, 60000);
  await x.page.evaluate(() => { DETALHE_NEGOCIO_ID = 'n1'; document.getElementById('nova-anotacao-negocio').value = 'criada na v157'; adicionarAnotacaoNegocio(); });
  await esperarContagem(() => notasDb(emp), 21, 30000);
  const n = await x.page.evaluate(() => ponteVoltarParaListaAntiga('eagles_crm_negocio_anotacoes_v1'));
  await fechar([x]);
  // a v155 abre e enxerga tudo
  const [p] = await pessoas(emp, 1, 'Administrativo', 'V');
  const [velho] = await abrir([p], { versao: 'antiga', chaves: [NOTAS] });
  const tela = await velho.page.evaluate(() => CRM_NEGOCIO_ANOTACOES_DATA.map((a) => a.texto));
  anotar(t, `reversão · ${n} itens devolvidos à lista antiga · a v155 vê ${tela.length} (inclui a criada na v157: ${tela.includes('criada na v157') ? 'sim' : 'NÃO'})`);
  await fechar([velho]);
  assert.equal(n, 21); assert.equal(tela.length, 21); assert.ok(tela.includes('criada na v157'));
});
