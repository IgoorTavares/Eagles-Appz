#!/usr/bin/env node
// LABZ AI — Fase S3: EMPACOTADOR das Edge Functions (sem dependências; determinístico).
// O backend é CommonJS (Node). O Supabase Edge Runtime é Deno e carrega módulos ES (ESM).
// Este script junta, num único arquivo ESM (uma cópia idêntica em cada função:
// supabase/functions/labz-api/labz.mjs e supabase/functions/labz-worker/labz.mjs — a publicação pela
// conexão Claude/Supabase só envia os arquivos da PRÓPRIA pasta da função):
//   - todos os arquivos alcançados por require() a partir de supabase/entrada-borda.js;
//   - os módulos nativos do Node pedidos (node:crypto, node:net...) viram "import" estáticos
//     (o Deno fornece todos eles);
// e RECUSA: require() com nome calculado (não dá para empacotar com segurança), qualquer pacote
// fora da lista (firebase-admin, firebase-functions, @google-cloud...) e arquivos fora do projeto.
//   node supabase/empacotar.js            → grava o pacote
//   node supabase/empacotar.js --conferir → só confere se o pacote gravado está atualizado
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { builtinModules } = require('node:module');

const RAIZ = path.join(__dirname, '..');
const ENTRADA = path.join(__dirname, 'entrada-borda.js');
const SAIDAS = ['labz-api', 'labz-worker'].map((f) => path.join(__dirname, 'functions', f, 'labz.mjs'));
const SAIDA = SAIDAS[0];
const PACOTES_PERMITIDOS = ['postgres'];
const NATIVOS = new Set(builtinModules);
const RE_REQUIRE = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;

const rel = (f) => path.relative(RAIZ, f).split(path.sep).join('/');

function resolverArquivo(base) {
  for (const c of [base, `${base}.js`, `${base}.cjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function resolver(spec, deArquivo) {
  const nome = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (spec.startsWith('node:') || NATIVOS.has(nome)) {
    if (!NATIVOS.has(nome)) throw new Error(`módulo nativo desconhecido: ${spec}`);
    return { nativo: `node:${nome}` };
  }
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const f = resolverArquivo(path.resolve(path.dirname(deArquivo), spec));
    if (!f) throw new Error(`não achei ${spec} (em ${rel(deArquivo)})`);
    return { arquivo: f };
  }
  const pacote = spec.split('/')[0];
  if (!PACOTES_PERMITIDOS.includes(pacote)) throw new Error(`pacote NÃO permitido no pacote das Edge Functions: ${spec} (em ${rel(deArquivo)})`);
  const dir = path.join(RAIZ, 'node_modules', pacote);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const f = resolverArquivo(path.join(dir, spec === pacote ? pj.main : spec.slice(pacote.length + 1)));
  if (!f) throw new Error(`não achei o pacote ${spec}`);
  return { arquivo: f };
}

// Tira comentários e textos para achar só os require() de CÓDIGO (sem confundir com os
// require() citados em comentários). Simples e conservador: na dúvida, recusa.
function codigoSemComentarios(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); i = f < 0 ? src.length : f + 2; continue; }
    if (c === '`') { // template: mantém (pode conter require? não no nosso código; se tiver, o conferidor recusa)
      let j = i + 1;
      while (j < src.length && src[j] !== '`') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function coletar() {
  const modulos = new Map(); // caminho relativo → { codigo, deps }
  const nativos = new Set(['node:buffer', 'node:process', 'node:timers']); // Buffer, process e setImmediate (o Edge Runtime não tem setImmediate/clearImmediate globais)
  const pilha = [ENTRADA];
  while (pilha.length) {
    const f = pilha.pop();
    const r = rel(f);
    if (modulos.has(r)) continue;
    if (r.startsWith('..')) throw new Error(`arquivo fora do projeto: ${f}`);
    const codigo = fs.readFileSync(f, 'utf8').replace(/^#!.*\n/, '\n');
    const limpo = codigoSemComentarios(codigo);
    const literais = [...limpo.matchAll(RE_REQUIRE)].map((m) => m[2]);
    const todos = (limpo.match(/\brequire\s*\(/g) || []).length;
    if (todos !== literais.length) throw new Error(`require() com nome calculado em ${r}: não dá para empacotar com segurança`);
    const deps = {};
    for (const spec of literais) {
      const x = resolver(spec, f);
      if (x.nativo) { deps[spec] = x.nativo; nativos.add(x.nativo); } else { deps[spec] = rel(x.arquivo); pilha.push(x.arquivo); }
    }
    modulos.set(r, { codigo, deps });
  }
  return { modulos, nativos };
}

function gerar() {
  const { modulos, nativos } = coletar();
  const listaNativos = [...nativos].sort();
  const nomes = [...modulos.keys()].sort();
  const proibidos = nomes.filter((n) => /node_modules\/(firebase-admin|firebase-functions|@google-cloud|firebase)\//.test(n));
  if (proibidos.length) throw new Error(`entraria no pacote: ${proibidos.join(', ')}`);
  const versaoPg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', 'postgres', 'package.json'), 'utf8')).version;
  const linhas = [];
  linhas.push('// LABZ AI — pacote das Edge Functions (GERADO por supabase/empacotar.js; não edite à mão).');
  linhas.push(`// Módulos: ${nomes.length} · postgres ${versaoPg} · nativos: ${listaNativos.join(', ')}`);
  linhas.push('/* eslint-disable */');
  listaNativos.forEach((n, i) => linhas.push(`import * as __n${i} from ${JSON.stringify(n)};`));
  linhas.push('const __nativos = {');
  listaNativos.forEach((n, i) => linhas.push(`  ${JSON.stringify(n)}: (__n${i}.default ?? __n${i}),`));
  linhas.push('};');
  linhas.push('const __Buffer = __nativos["node:buffer"].Buffer;');
  linhas.push('const __process = __nativos["node:process"];');
  linhas.push('const __setImmediate = __nativos["node:timers"].setImmediate;');
  linhas.push('const __clearImmediate = __nativos["node:timers"].clearImmediate;');
  linhas.push('const __defs = Object.create(null);');
  linhas.push('const __cache = Object.create(null);');
  linhas.push('function __carregar(nome) {');
  linhas.push('  if (__cache[nome]) return __cache[nome].exports;');
  linhas.push('  const d = __defs[nome];');
  linhas.push('  if (!d) throw new Error("módulo não empacotado: " + nome);');
  linhas.push('  const module = { exports: {} };');
  linhas.push('  __cache[nome] = module;');
  linhas.push('  const req = (spec) => {');
  linhas.push('    const alvo = d.deps[spec];');
  linhas.push('    if (alvo === undefined) throw new Error("require não empacotado: " + spec + " (em " + nome + ")");');
  linhas.push('    return alvo.startsWith("node:") ? __nativos[alvo] : __carregar(alvo);');
  linhas.push('  };');
  linhas.push('  d.fn.call(module.exports, module, module.exports, req, __Buffer, __process, "/labz/" + nome, "/labz/" + nome.split("/").slice(0, -1).join("/"), globalThis, __setImmediate, __clearImmediate);');
  linhas.push('  return module.exports;');
  linhas.push('}');
  for (const n of nomes) {
    const m = modulos.get(n);
    const deps = Object.keys(m.deps).sort().reduce((o, k) => { o[k] = m.deps[k]; return o; }, {});
    linhas.push(`__defs[${JSON.stringify(n)}] = { deps: ${JSON.stringify(deps)}, fn: function (module, exports, require, Buffer, process, __filename, __dirname, global, setImmediate, clearImmediate) {`);
    linhas.push(m.codigo);
    linhas.push('} };');
  }
  linhas.push(`const __m = __carregar(${JSON.stringify(rel(ENTRADA))});`);
  linhas.push('export const postgres = __m.postgres;');
  linhas.push('export const montarApi = __m.montarApi;');
  linhas.push('export const montarWorker = __m.montarWorker;');
  linhas.push('export const assinar = __m.assinar;');
  linhas.push('export const criarTransporteSimulado = __m.criarTransporteSimulado;');
  linhas.push('export const criarModeloSimulado = __m.criarModeloSimulado;');
  linhas.push(`export const MODULOS = ${JSON.stringify(nomes)};`);
  const texto = `${linhas.join('\n')}\n`;
  return { texto, nomes, nativos: listaNativos, sha256: crypto.createHash('sha256').update(texto).digest('hex') };
}

if (require.main === module) {
  const g = gerar();
  if (process.argv.includes('--conferir')) {
    for (const saida of SAIDAS) {
      const atual = fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8') : '';
      if (atual !== g.texto) { console.error(`O pacote ${rel(saida)} está DESATUALIZADO: rode "npm run empacotar".`); process.exit(1); }
    }
    console.log(`pacote atualizado (${g.nomes.length} módulos, ${Buffer.byteLength(g.texto)} bytes)`);
  } else {
    for (const saida of SAIDAS) {
      fs.mkdirSync(path.dirname(saida), { recursive: true });
      fs.writeFileSync(saida, g.texto);
    }
    console.log(`gravado em ${SAIDAS.map(rel).join(' e ')}: ${g.nomes.length} módulos, ${Buffer.byteLength(g.texto)} bytes, sha256 ${g.sha256.slice(0, 16)}…`);
  }
}

module.exports = { gerar, SAIDA, SAIDAS, PACOTES_PERMITIDOS };
