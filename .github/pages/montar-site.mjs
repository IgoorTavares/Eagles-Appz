// Monta a pasta do site (_site/) SÓ com os arquivos públicos do frontend e confere
// o resultado antes de qualquer publicação. Node puro, sem dependências.
//
//   node .github/pages/montar-site.mjs [--saida _site] [--raiz .]
//
// Lista de PERMITIDOS (explícita): um arquivo novo nunca fica público sozinho.
// Página ou imagem nova na raiz/assets que não está na lista FAZ A CONFERÊNCIA
// FALHAR, para alguém decidir se ela é pública.
// Nada é transformado: os arquivos são copiados byte a byte (conferido por sha256).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PAGINAS = [
  'aprovacao.html', 'assinatura.html', 'briefing.html', 'central-ajuda.html', 'clientes-fornecedores.html',
  'conferencia-estoque.html', 'configuracoes.html', 'contratos.html', 'crm.html', 'dpa.html', 'empresas.html',
  'estoque.html', 'financeiro.html', 'funcionarios.html', 'funil-vendas.html', 'index.html',
  'lancamentos-estoque.html', 'login.html', 'meu-negocio.html', 'meu-perfil.html', 'notas-fiscais-entrada.html',
  'objetos-postagem.html', 'pagina.html', 'pedido-compras.html', 'pedidos-venda.html', 'planos.html', 'portal.html',
  'privacidade.html', 'produtos.html', 'proposta.html', 'site.html', 'suporte.html', 'tarefas.html', 'termos.html',
  'usuarios.html', 'vendas.html', 'vendedores.html',
];
export const RECURSOS = ['style.css', 'script.js', 'sw.js', 'manifest.json', 'firebase-config.js', 'CNAME'];
export const IMAGENS = [
  'assets/apple-touch-icon.png', 'assets/favicon-eagles.png', 'assets/favicon-login-alert-32.png',
  'assets/favicon-login-alert.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-192.png',
  'assets/icon-maskable-512.png', 'assets/logo-eagles-full.png', 'assets/logo-eagles-icon.png',
  'assets/logo-full.png', 'assets/logo-icon.png',
];
export const PERMITIDOS = Object.freeze([...PAGINAS, ...RECURSOS, ...IMAGENS]);
export const DOMINIO = 'eagleslabz.com.br';

// nunca podem aparecer no artefato (segunda trava, além da lista de permitidos)
export const PROIBIDOS = [
  /^functions(-labz)?(\/|$)/, /^testes-regras(\/|$)/, /^\.github(\/|$)/, /^\.git(\/|$)/, /(^|\/)node_modules(\/|$)/,
  /^firestore\./, /^firebase\.json$/, /^package(-lock)?\.json$/, /\.md$/i, /(^|\/)\.env/, /(^|\/)\.secret/,
  /\.(pem|key|p12|log|zip|map)$/i, /(^|\/)_(t|x)_[^/]*\.html$/, /(^|\/)_a[^/]*_[^/]*\.html$/, /(^|\/)\./,
  /(^|\/)(scratch|rascunho|tmp|temp)(\/|$)/i,
];

const sha = (b) => createHash('sha256').update(b).digest('hex');
const externo = (u) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u); // http:, https:, data:, mailto:, tel:, javascript:, //cdn, #âncora
const limpar = (u) => u.split('#')[0].split('?')[0];

// resolve uma referência do site para um caminho dentro de _site/
function resolver(deArquivo, ref) {
  let u = limpar(ref.trim());
  if (!u) return null;
  try { u = decodeURI(u); } catch { /* mantém */ }
  const base = u.startsWith('/') ? '' : path.posix.dirname(deArquivo);
  let alvo = path.posix.normalize(path.posix.join(base, u.replace(/^\//, '')));
  if (alvo === '.' || alvo.endsWith('/')) alvo = path.posix.join(alvo, 'index.html');
  return alvo.replace(/^\.\//, '');
}

// referências locais de cada tipo de arquivo (o que o navegador vai pedir)
export function referencias(arquivo, texto) {
  const refs = [];
  // imagens embutidas (data:) podem ter url(#id) por dentro: não são arquivos do site
  const semEmbutidos = (t) => t.replace(/(["'])data:[\s\S]*?\1/g, '""');
  const add = (r, origem) => { if (r && !externo(r) && !r.includes('${') && !r.includes('{{')) refs.push({ ref: r, origem }); };
  if (arquivo.endsWith('.html')) {
    const semComentarios = semEmbutidos(texto.replace(/<!--[\s\S]*?-->/g, ''));
    for (const m of semComentarios.matchAll(/\s(?:src|href|poster|data-src|action)\s*=\s*["']([^"']+)["']/gi)) add(m[1], 'atributo');
    for (const m of semComentarios.matchAll(/\ssrcset\s*=\s*["']([^"']+)["']/gi)) m[1].split(',').forEach((p) => add(p.trim().split(/\s+/)[0], 'srcset'));
    for (const m of semComentarios.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1], 'css-inline');
  }
  if (arquivo.endsWith('.css')) for (const m of semEmbutidos(texto).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1], 'css');
  if (arquivo.endsWith('.js')) {
    // textos do código que são caminhos do site (páginas e imagens); o resto do JS não é rota
    for (const m of texto.matchAll(/["'`]((?:\.\/|\/)?(?:assets\/[A-Za-z0-9._-]+|[A-Za-z0-9_-]+\.html|sw\.js|manifest\.json))(?:[?#][^"'`]*)?["'`]/g)) add(m[1], 'js');
  }
  if (arquivo === 'sw.js') {
    const shell = texto.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
    if (shell) for (const m of shell[1].matchAll(/["']([^"']+)["']/g)) add(m[1], 'sw-app-shell');
  }
  if (arquivo === 'manifest.json') {
    const j = JSON.parse(texto);
    add(j.start_url, 'manifest-start_url');
    (j.icons || []).forEach((i) => add(i.src, 'manifest-icone'));
    (j.shortcuts || []).forEach((s) => { add(s.url, 'manifest-atalho'); (s.icons || []).forEach((i) => add(i.src, 'manifest-atalho-icone')); });
  }
  return refs;
}

export function montar({ raiz = '.', saida = '_site' } = {}) {
  const erros = [];
  const avisos = [];
  // 1) todos os permitidos existem no repositório
  for (const f of PERMITIDOS) if (!fs.existsSync(path.join(raiz, f))) erros.push(`permitido que não existe no repositório: ${f}`);
  // 2) página ou imagem pública nova sem decisão (fora da lista) → falha
  const raizHtml = fs.readdirSync(raiz).filter((f) => f.endsWith('.html') && !/^_/.test(f));
  for (const f of raizHtml) if (!PERMITIDOS.includes(f)) erros.push(`página fora da lista de permitidos (decida se é pública): ${f}`);
  if (fs.existsSync(path.join(raiz, 'assets'))) for (const f of fs.readdirSync(path.join(raiz, 'assets'))) if (!PERMITIDOS.includes(`assets/${f}`)) erros.push(`arquivo de assets/ fora da lista: assets/${f}`);
  if (erros.length) return { ok: false, erros, avisos, arquivos: [] };

  // 3) copiar byte a byte
  fs.rmSync(saida, { recursive: true, force: true });
  for (const f of PERMITIDOS) {
    const destino = path.join(saida, f);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(raiz, f), destino);
  }
  const r = conferir({ raiz, saida });
  return { ...r, erros: [...erros, ...r.erros], avisos: [...avisos, ...r.avisos] };
}

// Confere uma pasta já montada (usado também pelos testes contra artefatos adulterados).
export function conferir({ raiz = '.', saida = '_site' } = {}) {
  const erros = [];
  const avisos = [];
  const arquivos = [];
  (function andar(d, rel = '') {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) andar(path.join(d, e.name), r); else arquivos.push(r);
    }
  })(saida);
  const conjunto = new Set(arquivos);
  // 4) nada fora da lista e nada proibido
  for (const f of arquivos) {
    if (!PERMITIDOS.includes(f)) erros.push(`arquivo não permitido no artefato: ${f}`);
    if (PROIBIDOS.some((p) => p.test(f))) erros.push(`arquivo interno no artefato: ${f}`);
  }
  for (const f of PERMITIDOS) if (!conjunto.has(f)) erros.push(`faltando no artefato: ${f}`);
  // 5) cópia idêntica ao repositório
  for (const f of arquivos) {
    const orig = path.join(raiz, f);
    if (fs.existsSync(orig) && sha(fs.readFileSync(orig)) !== sha(fs.readFileSync(path.join(saida, f)))) erros.push(`conteúdo diferente do repositório: ${f}`);
  }
  // 6) CNAME com o domínio personalizado
  if (conjunto.has('CNAME')) {
    const c = fs.readFileSync(path.join(saida, 'CNAME'), 'utf8').trim();
    if (c !== DOMINIO) erros.push(`CNAME diferente do domínio (${c})`);
  }
  // 7) toda referência local do site existe no artefato
  const referenciasConferidas = [];
  for (const f of arquivos.filter((x) => /\.(html|css|js|json)$/.test(x))) {
    const texto = fs.readFileSync(path.join(saida, f), 'utf8');
    let refs;
    try { refs = referencias(f, texto); } catch (e) { erros.push(`não consegui ler ${f}: ${e.message}`); continue; }
    for (const { ref, origem } of refs) {
      const alvo = resolver(f, ref);
      if (!alvo) continue;
      referenciasConferidas.push({ de: f, ref, origem, alvo });
      if (alvo.startsWith('..')) { erros.push(`${f} aponta para fora do site: ${ref}`); continue; }
      if (conjunto.has(alvo)) continue;
      const noRepo = fs.existsSync(path.join(raiz, alvo));
      if (noRepo) erros.push(`${f} (${origem}) usa ${ref}, que ficou fora do artefato`);
      else avisos.push(`${f} (${origem}) usa ${ref}, que já não existe no repositório (problema anterior, não causado pela lista)`);
    }
  }
  return { ok: erros.length === 0, erros, avisos, arquivos: arquivos.sort(), referencias: referenciasConferidas };
}


// Confere a saída do Jekyll (o modo antigo do Pages) com a trava do _config.yml: o conjunto de
// arquivos tem que ser EXATAMENTE a lista de permitidos, e cada arquivo igual ao do repositório.
export function conferirJekyll({ raiz = '.', saida = '_site_jekyll' } = {}) {
  const erros = [];
  const arquivos = [];
  (function andar(d, rel = '') {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) andar(path.join(d, e.name), r); else arquivos.push(r);
    }
  })(saida);
  const conjunto = new Set(arquivos);
  for (const f of arquivos) {
    if (PROIBIDOS.some((p) => p.test(f))) erros.push(`o modo antigo publicaria um arquivo interno: ${f}`);
    else if (!PERMITIDOS.includes(f)) erros.push(`o modo antigo publicaria um arquivo fora da lista: ${f}`);
  }
  for (const f of PERMITIDOS) if (!conjunto.has(f)) erros.push(`o modo antigo não publicaria: ${f}`);
  for (const f of arquivos) {
    const orig = path.join(raiz, f);
    if (PERMITIDOS.includes(f) && fs.existsSync(orig) && sha(fs.readFileSync(orig)) !== sha(fs.readFileSync(path.join(saida, f)))) erros.push(`o modo antigo alteraria o conteúdo de: ${f}`);
  }
  return { ok: erros.length === 0, erros, arquivos: arquivos.sort() };
}

// execução direta
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, p) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : p; };
  if (process.argv.includes('--conferir-jekyll')) {
    const j = conferirJekyll({ raiz: arg('--raiz', '.'), saida: arg('--conferir-jekyll', '_site_jekyll') });
    for (const e of j.erros) console.error(`ERRO: ${e}`);
    console.log(`${j.ok ? 'OK' : 'FALHOU'}: no modo antigo sairiam ${j.arquivos.length} arquivo(s).`);
    process.exit(j.ok ? 0 : 1);
  }
  const r = montar({ raiz: arg('--raiz', '.'), saida: arg('--saida', '_site') });
  for (const a of r.avisos) console.log(`aviso: ${a}`);
  for (const e of r.erros) console.error(`ERRO: ${e}`);
  console.log(`${r.ok ? 'OK' : 'FALHOU'}: ${r.arquivos.length} arquivo(s) no artefato; ${(r.referencias || []).length} referência(s) conferida(s).`);
  process.exit(r.ok ? 0 : 1);
}
