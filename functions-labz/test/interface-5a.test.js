// Fase 5A: o que a interface usa do backend e o servidor de DEMONSTRAÇÃO LOCAL.
// Nada aqui sai da máquina: o servidor escuta só no 127.0.0.1 numa porta livre.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { montar } = require('./ajuda');
const { criarApi } = require('../src/api/labz-api');
const { AGENTES } = require('../src/agentes/catalogo');
const { criarServidor, montarDemo, ROTA_API } = require('../demo/servidor-local');

const RAIZ = path.resolve(__dirname, '..', '..');
const UI = path.resolve(__dirname, '..', 'demo', 'ui');

test('catalogo.agentes: os 8 agentes, só campos públicos, e só para o Super Admin', async () => {
  const c = await montar();
  const api = criarApi({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const r = await api({ auth: { uid: 'sa', token: {} }, data: { acao: 'catalogo.agentes', dados: {} } });
  assert.equal(r.resultado.length, 8);
  assert.deepEqual(r.resultado.map((a) => a.id), AGENTES.map((a) => a.id));
  const campos = ['id', 'numero', 'nome', 'missao', 'responsabilidades', 'entregaveis', 'ferramentas', 'criteriosQualidade', 'modos', 'podeDelegar', 'modelo'];
  for (const a of r.resultado) {
    assert.deepEqual(Object.keys(a).sort(), campos.slice().sort(), a.id);
    assert.equal(a.modelo, 'simulado');
  }
  const texto = JSON.stringify(r.resultado);
  assert.doesNotMatch(texto, /SKILL\.md|"skills"|"permissoes"|configModelo|apiKey|AIza|sk-/, 'nada de skills, prompts, configuração de modelo ou credenciais');
  // Diretor (ou qualquer outro) é recusado pela mesma trava de toda ação
  await assert.rejects(api({ auth: { uid: 'd1', token: {} }, data: { acao: 'catalogo.agentes', dados: {} } }), (e) => e.codigo === 'permissao-negada');
  await assert.rejects(api({ auth: null, data: { acao: 'catalogo.agentes', dados: {} } }), (e) => ['nao-autenticado', 'permissao-negada'].includes(e.codigo));
  // dados extras são recusados
  await assert.rejects(api({ auth: { uid: 'sa', token: {} }, data: { acao: 'catalogo.agentes', dados: { x: 1 } } }), (e) => e.codigo === 'invalido');
});

test('demonstração: fluxo completo pela API real (pedido → aprovação do sensível → consolidação → documento)', async () => {
  const d = await montarDemo({ atrasoMs: 0 });
  const emp = (await d.chamar('empresas.listar', {})).resultado.itens;
  assert.deepEqual(emp.map((e) => e.nome).sort(), ['Empresa Demonstração Alfa', 'Empresa Demonstração Beta']);
  const p = (await d.chamar('execucoes.pedido', { empresaId: emp[0].id, objetivo: 'Campanha completa: diretrizes de marca, carrosséis, roteiro de Reels, legendas para o Instagram e anúncios no Meta Ads' })).resultado;
  await new Promise((r) => setImmediate(r)); await d.trabalhar();
  let diag = (await d.chamar('execucoes.diagnostico', { execucaoId: p.id })).resultado;
  assert.equal(diag.estado, 'REVISION_REQUIRED');
  assert.equal(diag.diagnostico.motivo, 'dependencia-aguarda-aprovacao');
  const rel = (await d.chamar('execucoes.relatorio', { execucaoId: p.id })).resultado;
  const doc = rel.documentos.find((x) => x.etapaId === diag.diagnostico.dependencia);
  await d.chamar('entregas.decidir', { entregaId: doc.entregaId, decisao: { decisao: 'aprovar', versao: doc.versaoAtual, hash: doc.hash } });
  await new Promise((r) => setImmediate(r)); await d.trabalhar();
  diag = (await d.chamar('execucoes.diagnostico', { execucaoId: p.id })).resultado;
  assert.equal(diag.estado, 'COMPLETED');
  const c = (await d.chamar('execucoes.relatorio', { execucaoId: p.id })).resultado.entregaConsolidada;
  const md = (await d.chamar('entregas.documento', { entregaId: c.entregaId, versao: c.versao })).resultado.markdown;
  assert.match(md, /SIMULADO/);
  // ação fora da lista fechada continua recusada
  await assert.rejects(d.chamar('executor.rodar', {}), (e) => e.codigo === 'invalido');
});

function pedir(porta, { metodo = 'GET', caminho = '/', host, corpo, cabecalhos = {} } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: Object.assign({ Host: host || `127.0.0.1:${porta}` }, cabecalhos) }, (res) => {
      const partes = []; res.on('data', (p) => partes.push(p)); res.on('end', () => ok({ status: res.statusCode, cabecalhos: res.headers, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', falha); if (corpo) req.write(corpo); req.end();
  });
}

test('servidor de demonstração: só 127.0.0.1, só arquivos públicos, Firebase de produção desligado', async (t) => {
  const s = criarServidor({ porta: 0, atrasoMs: 0 });
  await new Promise((r) => s.servidor.listen(0, '127.0.0.1', r));
  t.after(() => s.servidor.close());
  const { address, port } = s.servidor.address();
  assert.equal(address, '127.0.0.1', 'não escuta na rede');
  // a lista de hosts aceitos usa a porta pedida; aqui a porta é aleatória, então o servidor recusa tudo
  // que não seja exatamente o host configurado — conferimos com um servidor na porta configurada
  const s2 = criarServidor({ porta: port + 1, atrasoMs: 0 });
  await new Promise((r) => s2.servidor.listen(port + 1, '127.0.0.1', r)).catch(() => {});
  t.after(() => s2.servidor.close());
  const P = port + 1;
  const ok = await pedir(P, { caminho: '/labz-ai.html' });
  assert.equal(ok.status, 200);
  assert.equal(ok.cabecalhos['cache-control'], 'no-store');
  assert.equal(ok.cabecalhos['x-frame-options'], 'DENY');
  for (const interno of ['/functions-labz/index.js', '/functions/index.js', '/CLAUDE.md', '/firestore.rules', '/firebase.json', '/package.json', '/.github/pages/montar-site.mjs', '/testes-regras/regras.test.mjs', '/functions-labz/demo/servidor-local.js', '/%2e%2e/%2e%2e/etc/passwd', '/../README.md']) {
    assert.equal((await pedir(P, { caminho: interno })).status, 404, interno);
  }
  const cfg = await pedir(P, { caminho: '/firebase-config.js' });
  assert.match(cfg.corpo, /apiKey: 'COLE_AQUI'/);
  assert.doesNotMatch(cfg.corpo, /AIza|labz-18246/);
  assert.doesNotMatch((await pedir(P, { caminho: '/sw.js' })).corpo, /caches\.open|cache\.addAll/);
  assert.equal((await pedir(P, { caminho: '/labz-ai.html', host: 'malicioso.exemplo' })).status, 403, 'DNS rebinding');
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await pedir(P, { metodo: 'POST', caminho: ROTA_API, corpo: '{"acao":"catalogo.agentes"}', cabecalhos: Object.assign({ Origin: 'http://malicioso.exemplo' }, json) })).status, 403, 'outra origem');
  assert.equal((await pedir(P, { metodo: 'POST', caminho: ROTA_API, corpo: '{"acao":"catalogo.agentes"}', cabecalhos: { 'Content-Type': 'text/plain' } })).status, 415, 'só JSON (sem POST simples de outro site)');
  assert.equal((await pedir(P, { metodo: 'GET', caminho: ROTA_API })).status, 405);
  const cat = await pedir(P, { metodo: 'POST', caminho: ROTA_API, corpo: '{"acao":"catalogo.agentes","dados":{}}', cabecalhos: json });
  assert.equal(cat.status, 200);
  assert.equal(JSON.parse(cat.corpo).resultado.length, 8);
  const ruim = await pedir(P, { metodo: 'POST', caminho: ROTA_API, corpo: '{"acao":"modelos.configurar","dados":{"agenteId":"02-designer","config":{"provedor":"openai","modelo":"x","uso":"real","recursosDoModelo":["texto"]}}}', cabecalhos: json });
  assert.equal(ruim.status, 400, 'modelo real continua recusado');
  assert.equal(JSON.parse(ruim.corpo).erro.codigo, 'failed-precondition');
});

test('arquivos da interface: CSS isolado em .pg-labz, sem HTML montado com dados, página no padrão das outras', () => {
  const css = fs.readFileSync(path.join(UI, 'labz-ai.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // todo seletor de regra começa por .pg-labz (fora @keyframes/@media, que só embrulham)
  const semKeyframes = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const seletores = [];
  semKeyframes.replace(/(^|\})\s*([^{}@]+?)\s*\{/g, (m, a, sel) => { seletores.push(...sel.split(',').map((x) => x.trim()).filter(Boolean)); return m; });
  assert.ok(seletores.length > 40);
  const fora = seletores.filter((x) => !x.startsWith('.pg-labz'));
  assert.deepEqual(fora, [], `seletores fora do módulo: ${fora.join(' | ')}`);
  const js = fs.readFileSync(path.join(UI, 'labz-ai.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /apiKey|AIza|token\s*[:=]\s*['"]/);
  const html = fs.readFileSync(path.join(UI, 'labz-ai.html'), 'utf8');
  assert.match(html, /<main class="main pg-labz"/);
  assert.match(html, /protegerPagina\(function \(\) \{\s*labzIniciar\(\);/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">\s*<link rel="stylesheet" href="labz-ai\.css">/);
  assert.doesNotMatch(html, /<style/);
});

test('opção A: a tela fica FORA do site (nem na raiz, nem na lista pública) e só o servidor local a mostra', async () => {
  for (const f of ['labz-ai.html', 'labz-ai.css', 'labz-ai.js']) {
    assert.ok(!fs.existsSync(path.join(RAIZ, f)), `${f} não pode estar na raiz do site`);
    assert.ok(fs.existsSync(path.join(UI, f)), `${f} fica em functions-labz/demo/ui/`);
  }
  const { PERMITIDOS, PROIBIDOS } = await import(require('node:url').pathToFileURL(path.join(RAIZ, '.github/pages/montar-site.mjs')).href);
  assert.ok(PERMITIDOS.every((f) => !/labz-ai/.test(f)), 'a tela não está na lista pública');
  assert.ok(PROIBIDOS.some((p) => p.test('functions-labz/demo/ui/labz-ai.html')), 'a pasta da tela é interna para a publicação segura');
  const cfg = fs.readFileSync(path.join(RAIZ, '_config.yml'), 'utf8');
  assert.match(cfg, /^\s*-\s*functions-labz\s*$/m, 'e também para a trava do modo antigo');
});
