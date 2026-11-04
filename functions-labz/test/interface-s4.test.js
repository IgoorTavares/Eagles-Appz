// Fase S4 — interface integrada à labz-api (Supabase): histórico no backend, arquivos da tela,
// configuração pública sem segredo, menu desligado no CRM/ERP e a preparação (sem publicar) no
// "Site seguro". Os testes de NAVEGADOR ficam em test/ui/ (npm run test:ui).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { criarApi } = require('../src/api/labz-api');

const RAIZ = path.join(__dirname, '..', '..');
const UI = path.join(__dirname, '..', 'demo', 'ui');
const ler = (f) => fs.readFileSync(f, 'utf8');

test('execucoes.historico: do mais novo para o mais antigo, só RESUMO (sem conteúdo), filtros, páginas e só o Super Admin', async () => {
  const c = await montarComEmpresas();
  const ids = [];
  for (const [e, o] of [[c.A, 'Primeira tarefa da Alfa'], [c.B, 'Segunda tarefa, da Beta'], [c.A, 'Terceira tarefa da Alfa']]) ids.push((await c.execucoes.criar(c.ator, { empresaId: e.id, objetivo: o, modo: 'especialista', agenteId: '04-roteirista' })).id);
  const api = criarApi({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const chamar = (dados, uid = 'sa') => api({ auth: { uid, token: { email: `${uid}@teste.local` } }, data: { acao: 'execucoes.historico', dados } }).then((r) => r.resultado);
  const todas = await chamar({});
  const minhas = todas.itens.filter((x) => ids.includes(x.id));
  assert.deepEqual(minhas.map((x) => x.id), [...ids].reverse(), 'mais nova primeiro');
  const um = minhas[0];
  assert.deepEqual(Object.keys(um).sort(), ['atualizadoEm', 'criadoEm', 'empresaId', 'esperaSuperAdmin', 'estado', 'etapas', 'id', 'modo', 'motivo', 'objetivo']);
  assert.deepEqual(Object.keys(um.etapas).sort(), ['concluidas', 'falharam', 'total']);
  assert.ok(!JSON.stringify(todas).includes('historico"') && !('plano' in um) && !('resultadoFinal' in um), 'nada de histórico interno, plano ou resultado');
  const alfa = await chamar({ empresaId: c.A.id });
  assert.ok(alfa.itens.length === 2 && alfa.itens.every((x) => x.empresaId === c.A.id), 'filtro por empresa (isolamento)');
  const p1 = await chamar({ empresaId: c.A.id, limite: 1 });
  assert.equal(p1.itens.length, 1);
  const p2 = await chamar({ empresaId: c.A.id, limite: 1, depoisDe: p1.proximo });
  assert.equal(p2.itens[0].id, ids[0]);
  await rejeita(() => chamar({ empresaId: c.B.id, limite: 1, depoisDe: p1.proximo }), 'invalido'); // cursor preso à empresa
  await rejeita(() => chamar({ estado: 'QUALQUER' }), 'invalido');
  await rejeita(() => chamar({ limite: 51 }), 'invalido');
  await rejeita(() => chamar({}, 'd1'), 'permissao-negada');
  assert.ok(String('x'.repeat(200)).slice(0, 160).length === 160 && um.objetivo.length <= 160);
});

test('tela (S4): modo https com o token do Firebase, sem credencial no navegador, sem HTML de dados e sem o SDK de funções do Firebase', () => {
  const js = ler(path.join(UI, 'labz-ai.js'));
  assert.match(js, /Authorization: `Bearer \$\{await tokenDoLogin\(forcarToken\)\}`/);
  assert.match(js, /getIdToken\(!!forcar\)/);
  assert.match(js, /credentials: 'omit'/);
  assert.match(js, /redirect: 'error'/);
  assert.match(js, /if \(status === 401\) \(\{ status, j \} = await postarHttps\(acao, dados, true\)\)/, 'renova o token UMA vez');
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie/, 'o token nunca é guardado');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /httpsCallable|functions\(/, 'não usa mais a função do Firebase (precisaria do Blaze)');
  assert.match(js, /visibilitychange/);
  const html = ler(path.join(UI, 'labz-ai.html'));
  assert.doesNotMatch(html, /firebase-functions-compat/);
  assert.match(html, /<script src="firebase-config\.js"><\/script>\s*<script src="labz-config\.js"><\/script>\s*<script src="script\.js"><\/script>\s*<script src="labz-ai\.js"><\/script>/);
  for (const id of ['lz-resumo', 'lz-pendencias', 'lz-hist-lista', 'lz-hist-empresa', 'lz-hist-estado', 'lz-hist-mais', 'lz-progresso', 'lz-org']) assert.match(html, new RegExp(`id="${id}"`), id);
  const cfg = ler(path.join(UI, 'labz-config.js'));
  assert.match(cfg, /^const LABZ_API_URL = 'https:\/\/ducvpgrtsguaxqhnnupd\.supabase\.co\/functions\/v1\/labz-api';$/m, 'v155 (I3): o projeto labz-ai do Supabase');
  const codigo = cfg.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(codigo, /key|senha|secret|token|eyJ|service_role|sb_/i, 'nenhum segredo na configuração pública');
});

test('CRM/ERP: o menu "LABZ AI" (v155: LIGADO) só existe para o Super Admin', () => {
  const s = ler(path.join(RAIZ, 'script.js'));
  assert.match(s, /^let LABZ_AI_MENU_ATIVO = true;$/m);
  assert.match(s, /^const LABZ_AI_PAGINA = 'labz-ai\.html';$/m, 'nome escrito por inteiro: o conferidor do Site seguro checa o link');
  // I1 (D2): item do MENU PRINCIPAL, só para o Super Admin, sem atalho no menu do perfil
  assert.match(s, /function labzMenuLiberado\(\) \{\n  return LABZ_AI_MENU_ATIVO === true && typeof USUARIO_ROLE !== 'undefined' && USUARIO_ROLE === 'SuperAdmin';\n\}/);
  assert.match(s, /\{ key: 'labz-ai', href: LABZ_AI_PAGINA, label: 'LABZ AI', soSuperAdmin: true \},\n\];/);
  assert.match(s, /function itemVisivelNoPlano\(item\) \{\n  if \(item\.soSuperAdmin\) return labzMenuLiberado\(\);/);
  assert.match(s, /function aplicarGatingPorRole\(\) \{[\s\S]*?labzMenuAplicar\(\);\n\}/);
  const atalho = /function labzMenuAplicar\(\) \{[\s\S]*?\n\}/.exec(s)[0];
  assert.match(atalho, /if \(!labzMenuLiberado\(\) \|\| !painel\)/);
  assert.doesNotMatch(atalho, /profile-menu/, 'nada no menu do perfil');
  // a mudança no script.js é só esta (nada mais do CRM/ERP mudou na S4)
  for (const f of fs.readdirSync(RAIZ).filter((x) => x.endsWith('.html'))) assert.doesNotMatch(ler(path.join(RAIZ, f)), /labz-ai|labz-config/, `${f} não aponta para a LABZ AI`);
});

test('Site seguro (v155): os 4 arquivos da LABZ AI são publicados a partir de functions-labz/demo/ui, idênticos, e nada mais de functions-labz', async () => {
  const m = await import(pathToFileURL(path.join(RAIZ, '.github/pages/montar-site.mjs')).href);
  assert.equal(m.LABZ_AI_PREPARADOS, undefined, 'não existe mais "ensaio": a publicação é a de verdade');
  assert.deepEqual(m.LABZ_AI_PUBLICADOS.map((x) => [x.origem, x.publicado]), [
    ['functions-labz/demo/ui/labz-ai.html', 'labz-ai.html'], ['functions-labz/demo/ui/labz-ai.css', 'labz-ai.css'],
    ['functions-labz/demo/ui/labz-ai.js', 'labz-ai.js'], ['functions-labz/demo/ui/labz-config.js', 'labz-config.js']]);
  assert.ok(m.LABZ_AI_PUBLICADOS.every((x) => !m.PERMITIDOS.includes(x.publicado)), 'fora de PERMITIDOS (não ficam na raiz)');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'labz-site-'));
  try {
    const r = m.montar({ raiz: RAIZ, saida: path.join(tmp, 'site') });
    assert.ok(r.ok, r.erros.join('\n'));
    assert.deepEqual(r.avisos, []);
    assert.equal(r.arquivos.length, m.PERMITIDOS.length + 4);
    assert.deepEqual(r.arquivos.filter((f) => /labz/.test(f)).sort(), ['labz-ai.css', 'labz-ai.html', 'labz-ai.js', 'labz-config.js']);
    assert.ok(!r.arquivos.some((f) => m.PROIBIDOS.some((p) => p.test(f))), 'nada interno');
    const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    for (const x of m.LABZ_AI_PUBLICADOS) assert.equal(h(path.join(tmp, 'site', x.publicado)), h(path.join(RAIZ, x.origem)), `${x.publicado} idêntico`);
    assert.ok(r.referencias.some((x) => /labz-ai\.html/.test(JSON.stringify(x))), 'o link do menu (script.js) foi conferido');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const wf = ler(path.join(RAIZ, '.github/workflows/pages-seguro.yml'));
  assert.doesNotMatch(wf, /labz/i, 'o workflow não muda (continua manual: digitar PUBLICAR)');
  assert.doesNotMatch(ler(path.join(RAIZ, '.github/pages/montar-site.mjs')), /process\.argv[^\n]*labz/i);
});
