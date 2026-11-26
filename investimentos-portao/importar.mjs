// Investimentos · importador do catálogo da Biblioteca de Ativos (Etapa 05)
// Lê os arquivos OFICIAIS que estiverem numa pasta (baixados pelo site de cada fonte), aplica os adaptadores,
// valida, normaliza, junta duplicados e grava o catálogo estático que o site publica (inv/catalogo/).
// Não baixa nada, não usa IA, não usa chave nenhuma. Os adaptadores desligados (B3, CoinGecko) só rodam
// com a opção explícita, depois da decisão correspondente.
//
// Uso: node investimentos-portao/importar.mjs --entrada <pasta> --saida inv/catalogo [--teste] [--relatorio arquivo.json]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import * as A from './adaptadores.mjs';
const require = createRequire(import.meta.url);
const M = require('../inv/inv-motor.js');

// ---------- leitor de .zip (sem biblioteca externa): os arquivos da CVM vêm compactados ----------
// Lê o diretório central e descompacta (método 0 = guardado, 8 = deflate). Recusa caminhos estranhos.
export function lerZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('zip inválido (sem diretório central)');
  const total = buf.readUInt16LE(fim + 10); let p = buf.readUInt32LE(fim + 16); const out = new Map();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip inválido (entrada)');
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), tamReal = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + xl + cl;
    if (nome.endsWith('/') || /(^|\/)\.\.(\/|$)|^\//.test(nome)) continue;
    const ini = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const dados = buf.slice(ini, ini + tam);
    const bruto = metodo === 0 ? dados : metodo === 8 ? inflateRawSync(dados) : null;
    if (!bruto || bruto.length !== tamReal) throw new Error(`zip: ${nome} com compactação não suportada ou corrompido`);
    out.set(nome.split('/').pop(), bruto);
  }
  return out;
}

// junta os arquivos soltos e os de dentro dos .zip numa lista só (o nome interno é o que vale)
function montarArquivos(pasta) {
  const mapa = new Map(); const origem = {};
  if (!pasta || !existsSync(pasta)) return { mapa, origem };
  for (const n of readdirSync(pasta)) {
    const caminho = join(pasta, n);
    if (/\.zip$/i.test(n)) { for (const [interno, b] of lerZip(readFileSync(caminho))) { if (!mapa.has(interno)) { mapa.set(interno, b); origem[interno] = `${n} → ${interno}`; } } }
    else { mapa.set(n, readFileSync(caminho)); origem[n] = n; }
  }
  return { mapa, origem };
}

export function importar({ entrada, complementoTeste = null, teste = false, producao = false, b3Licenca = false, servidor = false, dataGeracao = new Date().toISOString() }) {
  const real = montarArquivos(entrada); const extra = montarArquivos(complementoTeste);
  const ignorados = [];
  const registros = []; const avisos = []; const usados = [];
  const tentar = (rotulo, fn) => { try { const r = fn(); usados.push(rotulo); return r; } catch (e) { avisos.push(`${rotulo}: ${e.message}`); return []; } };
  const passada = (fonteArq, ehTeste) => {
  const { mapa, origem } = fonteArq;
  const arquivos = [...mapa.keys()];
  const ler = (n, enc = 'utf8') => mapa.get(n).toString(enc);
  const achar = (rx) => arquivos.filter((n) => rx.test(n)).sort();
  const op = (arquivo) => ({ arquivo: origem[arquivo] || arquivo, teste: ehTeste, ignorados });

  let empresas = new Map();
  for (const n of achar(/^cad_cia_aberta\.csv$/i)) empresas = tentar(n, () => A.cvmCadastro(ler(n, 'latin1'), op(n))) || new Map();
  for (const n of achar(/^fca_cia_aberta_valor_mobiliario_\d{4}\.csv$/i)) registros.push(...tentar(n, () => A.cvmValoresMobiliarios(ler(n, 'latin1'), empresas, op(n))));
  for (const n of achar(/^inf_mensal_fii_geral_\d{4}\.csv$/i)) registros.push(...tentar(n, () => A.cvmFii(ler(n, 'latin1'), op(n))));
  for (const n of achar(/^company_tickers_exchange\.json$/i)) registros.push(...tentar(n, () => A.secTickers(ler(n), op(n))));
  for (const n of achar(/^PrecoTaxaTesouroDireto\.csv$/i)) registros.push(...tentar(n, () => A.tesouro(ler(n, 'latin1'), op(n))));
  for (const n of achar(/^b3_instrumentos\.csv$/i)) registros.push(...tentar(n, () => A.b3Instrumentos(ler(n, 'latin1'), Object.assign(op(n), { licencaConfirmada: b3Licenca }))));
  for (const n of achar(/^coins_list\.json$/i)) registros.push(...tentar(n, () => A.coingecko(ler(n), Object.assign(op(n), { servidor }))));
  return { achar, ler };
  };
  const principal = passada(real, !!teste);
  if (complementoTeste) passada(extra, true); // complemento SEMPRE marcado como teste (ex.: EUA enquanto o arquivo da SEC não chega)
  const { achar, ler } = principal;

  const r = M.mesclar(registros.map((x) => M.novoAtivo(x)));
  // classificação manual: só corrige o que existe
  const naoAplicadas = [];
  for (const n of achar(/^classificacao-manual\.csv$/i)) {
    for (const c of tentar(n, () => A.classificacaoManual(ler(n)))) {
      const a = r.ativos.find((x) => x.assetId === c.assetId);
      if (!a) { naoAplicadas.push(c.assetId); continue; }
      a.classe = c.classe; if (c.setor) a.setor = c.setor; if (c.segmento) a.segmento = c.segmento;
      if (!a.fontes.some((f) => f.id === 'manual')) a.fontes.push({ id: 'manual', dataRef: '', arquivo: n });
    }
  }
  // código derivado (FII): fica registrado em cada ativo para a tela avisar
  const derivados = new Set(registros.filter((x) => x.codigoDerivado).map((x) => M.montarAssetId(x.pais, x.bolsa, x.ticker)));
  r.ativos.forEach((a) => { if (derivados.has(a.assetId)) { a.codigoDerivado = true; a.codigoConfirmado = false; } if (teste) { a.teste = true; a.fontes.forEach((f) => { f.teste = true; }); } });
  // PRODUÇÃO: só fontes com uso autorizado comprovado (FONTES[id].autorizadaProducao) e nada de teste
  let bloqueadas = {};
  if (producao) {
    const antes = r.ativos.length;
    r.ativos = r.ativos.filter((a) => !a.teste && a.fontes.every((f) => { const ok = M.FONTES[f.id] && M.FONTES[f.id].autorizadaProducao === true; if (!ok) bloqueadas[f.id] = (bloqueadas[f.id] || 0) + 1; return ok; }));
    avisos.push(`modo produção: ${antes - r.ativos.length} ativo(s) retirados por fonte sem autorização comprovada ou de teste`);
  }
  const qtdTeste = r.ativos.filter((a) => a.teste).length;

  // contagem separada: uma fonte só aparece como "ok" se trouxe dado REAL; fixture/complemento de teste não conta
  const porFonte = {}, porFonteTeste = {};
  r.ativos.forEach((a) => a.fontes.forEach((f) => { const alvo = a.teste ? porFonteTeste : porFonte; alvo[f.id] = (alvo[f.id] || 0) + 1; }));
  const meta = {
    formato: 'eagles-inv-catalogo-v1', versao: dataGeracao.replace(/\D/g, '').slice(0, 14), geradoEm: dataGeracao, teste: !!teste,
    total: r.ativos.length, porFonte, porFonteTeste, totalTeste: qtdTeste, totalReal: r.ativos.length - qtdTeste, producao: !!producao, bloqueadasNaProducao: bloqueadas,
    // produção: sem demonstração (nada de números ou notícias fictícias); desenvolvimento e testes: demonstração permitida
    demonstracao: !producao,
    naoConfirmados: r.ativos.filter((a) => a.codigoConfirmado === false).length,
    fontes: Object.fromEntries(Object.entries(M.FONTES).map(([id, f]) => [id, { nome: f.nome, tipo: f.tipo, licenca: f.licenca, atribuicao: f.atribuicao || '', url: f.url, usada: !!porFonte[id],
      autorizadaProducao: f.autorizadaProducao === true, usadaSoEmTeste: !porFonte[id] && !!porFonteTeste[id],
      estado: porFonte[id] ? 'ok' : porFonteTeste[id] ? 'somente-teste' : (!f.habilitada ? 'desligada' : 'sem-arquivo') }])),
    aviso: teste ? 'DADOS DE TESTE: empresas e códigos fictícios, sem valor real.' : (qtdTeste ? `Catálogo misto: ${r.ativos.length - qtdTeste} ativos reais (fontes oficiais) e ${qtdTeste} de TESTE, marcados um a um (fictícios, sem valor real).` : ''),
  };
  const relatorio = { geradoEm: dataGeracao, arquivosUsados: usados, avisos, ignorados, rejeitados: r.rejeitados, duplicados: r.duplicados, conflitos: r.conflitos, classificacaoNaoAplicada: naoAplicadas, total: r.ativos.length, porFonte };
  return { meta, ativos: r.ativos, relatorio };
}

// ---------- linha de comando ----------
const args = process.argv.slice(2);
if (args.includes('--entrada')) {
  const pega = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const saida = pega('--saida') || 'inv/catalogo';
  const res = importar({ entrada: pega('--entrada'), complementoTeste: pega('--complemento-teste'), producao: args.includes('--producao'), teste: args.includes('--teste'), b3Licenca: args.includes('--b3-licenca-confirmada'), servidor: args.includes('--servidor'), dataGeracao: pega('--data') || new Date().toISOString() });
  mkdirSync(saida, { recursive: true });
  writeFileSync(join(saida, 'meta.json'), JSON.stringify(res.meta, null, 1));
  writeFileSync(join(saida, 'ativos.json'), JSON.stringify({ formato: res.meta.formato, versao: res.meta.versao, itens: res.ativos }));
  const rel = pega('--relatorio') || join(dirname(new URL(import.meta.url).pathname), 'saida', 'relatorio-importacao.json');
  mkdirSync(dirname(rel), { recursive: true });
  writeFileSync(rel, JSON.stringify(res.relatorio, null, 1));
  console.log(`Catálogo: ${res.meta.total} ativos · rejeitados ${res.relatorio.rejeitados.length} · duplicados ${res.relatorio.duplicados.length} · conflitos ${res.relatorio.conflitos.length} · avisos ${res.relatorio.avisos.length}`);
  res.relatorio.avisos.forEach((a) => console.log('  aviso:', a));
}
