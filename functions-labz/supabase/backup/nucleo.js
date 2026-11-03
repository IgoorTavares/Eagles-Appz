// LABZ AI — Etapa 12: NÚCLEO do backup (formato, impressão digital e criptografia).
// O MESMO texto roda na página offline (labz-backup.html, entre as marcas NUCLEO-INICIO/NUCLEO-FIM;
// um teste confere que é idêntico) e no Node (restaurar-local.mjs e os testes).
// Só usa o que o navegador e o Node 20 têm de fábrica: WebCrypto, TextEncoder, btoa/atob.
// Formato documentado em functions-labz/README.md (seção "Backup do Supabase"). Nenhuma senha ou chave é guardada aqui.
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.LabzBackup = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMATO_DADOS = 'labz-backup-dados';
  const FORMATO_CIFRADO = 'labz-backup-cifrado';
  const ALGORITMO = 'sha256-netstring-v1';
  const TABELA = 'labz.docs';
  const ITERACOES = 600000; // PBKDF2-SHA256 (recomendação OWASP)
  const ITERACOES_MIN = 100000;
  const ITERACOES_MAX = 10000000; // arquivo adulterado não trava o computador
  const MIN_SENHA = 12;
  const RE_DATA = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
  const RE_HASH = /^[0-9a-f]{64}$/;

  class ErroBackup extends Error {
    constructor(codigo, mensagem) { super(mensagem); this.name = 'ErroBackup'; this.codigo = codigo; }
  }
  const falhar = (codigo, mensagem) => { throw new ErroBackup(codigo, mensagem); };
  const utf8 = new TextEncoder();
  const deUtf8 = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  function sutil() {
    const c = globalThis.crypto;
    if (!c || !c.subtle) falhar('sem-cripto', 'Este navegador não tem a criptografia necessária (WebCrypto). Use um Chrome, Edge ou Firefox atualizado.');
    return c;
  }
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  function paraB64(bytes) {
    const u = new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deB64(s, campo) {
    if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) falhar('cifrado-invalido', `Campo "${campo}" do arquivo cifrado está estragado.`);
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function sha256Hex(texto) { return hex(await sutil().subtle.digest('SHA-256', utf8.encode(texto))); }

  // Impressão digital: cada campo vira "<bytes em UTF-8>:<texto>" (netstring, sem ambiguidade),
  // na ordem caminho, colecao, id, atualizado_em, dados; as linhas na ordem do arquivo (caminho, collate "C").
  const netstring = (campos) => campos.map((c) => `${utf8.encode(c).length}:${c}`).join('');
  async function impressao(linhas) {
    const contagem = {};
    for (const l of linhas) contagem[l[1]] = (contagem[l[1]] || 0) + 1;
    return { total: linhas.length, contagem, sha256: await sha256Hex(linhas.map(netstring).join('')) };
  }
  function mesmaContagem(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Number(a[k]) === Number(b[k]));
  }

  // CSV (RFC 4180): aspas, aspas dobradas, vírgulas e quebras de linha dentro de campos; BOM; CRLF.
  function lerCsv(texto) {
    const t = String(texto).replace(/^\uFEFF/, '');
    const linhas = [];
    let campo = '';
    let linha = [];
    let aspas = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (aspas) {
        if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === ',') { linha.push(campo); campo = ''; } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && t[i + 1] === '\n') i++;
        linha.push(campo); linhas.push(linha); linha = []; campo = '';
      } else campo += ch;
    }
    if (aspas) falhar('csv-invalido', 'O arquivo CSV termina no meio de um campo (arquivo cortado?).');
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.filter((l) => !(l.length === 1 && l[0] === ''));
  }

  // Exportação do SQL Editor (CSV ou JSON com as colunas "ordem" e "linha") → documento normalizado.
  function deLinhasExportadas(pares) {
    const lista = pares.map((p) => {
      const o = String(p.ordem == null ? '' : p.ordem).trim();
      if (!/^\d{1,9}$/.test(o)) falhar('exportacao-invalida', 'Coluna "ordem" com valor inválido.');
      if (typeof p.linha !== 'string') falhar('exportacao-invalida', 'Coluna "linha" ausente ou vazia.');
      return { ordem: Number(o), linha: p.linha };
    }).sort((a, b) => a.ordem - b.ordem);
    const cabecalhos = lista.filter((p) => p.ordem === 0);
    if (cabecalhos.length !== 1) falhar('exportacao-invalida', 'O arquivo precisa ter exatamente uma linha de cabeçalho (ordem 0).');
    let cabecalho;
    try { cabecalho = JSON.parse(cabecalhos[0].linha); } catch (e) { falhar('exportacao-invalida', 'O cabeçalho não é um JSON válido.'); }
    const dados = lista.filter((p) => p.ordem !== 0);
    const linhas = dados.map((p, i) => {
      if (p.ordem !== i + 1) falhar('incompleto', `Faltam linhas no arquivo (esperada a linha ${i + 1}, veio a ${p.ordem}).`);
      let l;
      try { l = JSON.parse(p.linha); } catch (e) { falhar('exportacao-invalida', `A linha ${p.ordem} não é um JSON válido.`); }
      return l;
    });
    return { formato: FORMATO_DADOS, versao: 1, cabecalho, linhas };
  }

  // Abre qualquer arquivo do backup: exportação (CSV/JSON), documento normalizado ou arquivo cifrado.
  function abrirArquivo(texto) {
    const t = String(texto).replace(/^\uFEFF/, '');
    const inicio = t.trimStart()[0];
    if (inicio === '{' || inicio === '[') {
      let v;
      try { v = JSON.parse(t); } catch (e) { falhar('json-invalido', 'O arquivo parece JSON, mas está estragado ou cortado.'); }
      if (Array.isArray(v)) return { tipo: 'dados', doc: deLinhasExportadas(v.map((o) => ({ ordem: o && o.ordem, linha: o && o.linha }))) };
      if (v && v.formato === FORMATO_CIFRADO) return { tipo: 'cifrado', envelope: v };
      if (v && v.formato === FORMATO_DADOS) return { tipo: 'dados', doc: v };
      falhar('desconhecido', 'Este arquivo não é um backup da LABZ AI.');
    }
    const csv = lerCsv(t);
    if (!csv.length) falhar('vazio', 'O arquivo está vazio.');
    const cab = csv[0].map((c) => c.trim().toLowerCase());
    const iO = cab.indexOf('ordem');
    const iL = cab.indexOf('linha');
    if (iO < 0 || iL < 0) falhar('desconhecido', 'Não encontrei as colunas "ordem" e "linha". Rode a consulta exportar-dados.sql e baixe o resultado.');
    return { tipo: 'dados', doc: deLinhasExportadas(csv.slice(1).map((r) => ({ ordem: r[iO], linha: r[iL] }))) };
  }

  // Confere TUDO (nunca presume que um arquivo baixado está íntegro).
  async function conferir(doc) {
    const problemas = [];
    const p = (codigo, mensagem) => { if (problemas.length < 20) problemas.push({ codigo, mensagem }); };
    if (!doc || doc.formato !== FORMATO_DADOS || doc.versao !== 1) { p('formato', 'Formato ou versão desconhecidos.'); return { ok: false, problemas }; }
    const c = doc.cabecalho || {};
    if (c.formato !== FORMATO_DADOS || c.versao !== 1 || c.algoritmo !== ALGORITMO || c.tabela !== TABELA) p('cabecalho', 'Cabeçalho com formato, versão, algoritmo ou tabela inesperados.');
    if (!Number.isInteger(c.total) || c.total < 0) p('cabecalho', 'Cabeçalho sem o total de documentos.');
    if (!RE_HASH.test(String(c.sha256))) p('cabecalho', 'Cabeçalho sem a impressão digital (sha256).');
    if (!c.contagem || typeof c.contagem !== 'object') p('cabecalho', 'Cabeçalho sem a contagem por coleção.');
    if (!Array.isArray(doc.linhas)) { p('linhas', 'Sem a lista de documentos.'); return { ok: false, problemas }; }
    const vistos = new Set();
    doc.linhas.forEach((l, i) => {
      if (!Array.isArray(l) || l.length !== 5 || !l.every((x) => typeof x === 'string')) { p('linha', `Documento ${i + 1}: formato inválido.`); return; }
      const [caminho, colecao, id, atualizado, dados] = l;
      if (caminho !== `${colecao}/${id}`) p('linha', `Documento ${i + 1}: caminho não bate com coleção e id.`);
      if (vistos.has(caminho)) p('linha', `Documento ${i + 1}: caminho repetido.`);
      vistos.add(caminho);
      if (!RE_DATA.test(atualizado)) p('linha', `Documento ${i + 1}: data inválida.`);
      let obj;
      try { obj = JSON.parse(dados); } catch (e) { obj = null; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) p('linha', `Documento ${i + 1}: conteúdo não é um objeto JSON.`);
    });
    const valido = doc.linhas.every((l) => Array.isArray(l) && l.length === 5 && l.every((x) => typeof x === 'string'));
    const calc = valido ? await impressao(doc.linhas) : { total: doc.linhas.length, contagem: {}, sha256: '' };
    if (Number.isInteger(c.total) && calc.total !== c.total) p('incompleto', `O arquivo tem ${calc.total} de ${c.total} documentos (o SQL Editor pode ter limitado o número de linhas).`);
    if (c.contagem && !mesmaContagem(calc.contagem, c.contagem)) p('contagem', 'A contagem por coleção não bate com o cabeçalho.');
    if (valido && calc.sha256 !== c.sha256) p('impressao', 'A impressão digital NÃO bate: o arquivo foi alterado ou corrompido.');
    return { ok: problemas.length === 0, problemas, total: calc.total, contagem: calc.contagem, sha256: calc.sha256, cabecalho: c };
  }

  // Documento normalizado canônico (só os campos do formato, nesta ordem).
  const normalizar = (doc) => ({ formato: FORMATO_DADOS, versao: 1, cabecalho: doc.cabecalho, linhas: doc.linhas });

  async function derivarChave(senha, sal, iteracoes, usos) {
    const c = sutil();
    const base = await c.subtle.importKey('raw', utf8.encode(String(senha).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, base, { name: 'AES-GCM', length: 256 }, false, usos);
  }

  function validarSenha(senha) {
    if (typeof senha !== 'string' || Array.from(senha.normalize('NFC')).length < MIN_SENHA) falhar('senha-curta', `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
  }

  // Cifra (AES-256-GCM, chave por PBKDF2-SHA256) e, ANTES de devolver, abre de novo e confere.
  async function cifrar(doc, senha, opcoes = {}) {
    validarSenha(senha);
    const conf = await conferir(doc);
    if (!conf.ok) falhar('nao-integro', 'O arquivo não passou na conferência; não vou cifrar um backup estragado.');
    const c = sutil();
    const iteracoes = opcoes.iteracoes || ITERACOES;
    const sal = c.getRandomValues(new Uint8Array(16));
    const iv = c.getRandomValues(new Uint8Array(12));
    const rotulo = { formato: FORMATO_CIFRADO, versao: 1, geradoEm: doc.cabecalho.geradoEm || null, cifradoEm: (opcoes.agora || new Date()).toISOString(), total: conf.total, sha256: conf.sha256 };
    const aad = JSON.stringify(rotulo);
    const chave = await derivarChave(senha, sal, iteracoes, ['encrypt']);
    const texto = utf8.encode(JSON.stringify(normalizar(doc)));
    const cifrado = await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad), tagLength: 128 }, chave, texto);
    const envelope = {
      formato: FORMATO_CIFRADO,
      versao: 1,
      kdf: { nome: 'PBKDF2', hash: 'SHA-256', iteracoes, sal: paraB64(sal) },
      cifra: { nome: 'AES-GCM', bitsChave: 256, iv: paraB64(iv), bitsTag: 128 },
      aad,
      dados: paraB64(cifrado),
    };
    const volta = await decifrar(envelope, senha);
    if (volta.conferencia.sha256 !== conf.sha256) falhar('autoteste', 'A cópia cifrada não abriu igual ao original; nada foi gerado.');
    return envelope;
  }

  async function decifrar(envelope, senha) {
    const e = envelope || {};
    const k = e.kdf || {};
    const f = e.cifra || {};
    if (e.formato !== FORMATO_CIFRADO || e.versao !== 1) falhar('cifrado-invalido', 'Não é um backup cifrado da LABZ AI (ou é de uma versão desconhecida).');
    if (k.nome !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iteracoes) || k.iteracoes < ITERACOES_MIN || k.iteracoes > ITERACOES_MAX) falhar('cifrado-invalido', 'Parâmetros da chave inválidos.');
    if (f.nome !== 'AES-GCM' || f.bitsChave !== 256 || f.bitsTag !== 128) falhar('cifrado-invalido', 'Parâmetros da cifra inválidos.');
    if (typeof e.aad !== 'string') falhar('cifrado-invalido', 'Rótulo ausente.');
    let rotulo;
    try { rotulo = JSON.parse(e.aad); } catch (x) { falhar('cifrado-invalido', 'Rótulo estragado.'); }
    if (!rotulo || rotulo.formato !== FORMATO_CIFRADO || !RE_HASH.test(String(rotulo.sha256))) falhar('cifrado-invalido', 'Rótulo inválido.');
    const sal = deB64(k.sal, 'sal');
    const iv = deB64(f.iv, 'iv');
    const dados = deB64(e.dados, 'dados');
    if (sal.length !== 16 || iv.length !== 12 || dados.length < 16) falhar('cifrado-invalido', 'Arquivo cifrado com tamanhos inválidos.');
    if (typeof senha !== 'string' || !senha) falhar('senha-errada', 'Digite a senha.');
    const chave = await derivarChave(senha, sal, k.iteracoes, ['decrypt']);
    let aberto;
    try {
      aberto = await sutil().subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(e.aad), tagLength: 128 }, chave, dados);
    } catch (x) {
      falhar('senha-errada', 'Não abriu: a senha está errada ou o arquivo foi alterado.');
    }
    let doc;
    try { doc = JSON.parse(deUtf8(aberto)); } catch (x) { falhar('cifrado-invalido', 'O conteúdo aberto não é um backup válido.'); }
    const conferencia = await conferir(doc);
    if (!conferencia.ok) falhar('nao-integro', `O conteúdo aberto não passou na conferência: ${conferencia.problemas[0].mensagem}`);
    if (conferencia.sha256 !== rotulo.sha256 || conferencia.total !== rotulo.total) falhar('nao-integro', 'O conteúdo aberto não bate com o rótulo do arquivo.');
    return { doc: normalizar(doc), rotulo, conferencia };
  }

  // Nome de arquivo a partir da data do cabeçalho: labz-backup-20261104-1830Z
  function nomeBase(doc) {
    const g = String((doc && doc.cabecalho && doc.cabecalho.geradoEm) || '');
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(g);
    return m ? `labz-backup-${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}Z` : 'labz-backup';
  }

  return {
    FORMATO_DADOS, FORMATO_CIFRADO, ALGORITMO, TABELA, ITERACOES, MIN_SENHA, ErroBackup,
    sha256Hex, netstring, impressao, mesmaContagem, lerCsv, abrirArquivo, conferir, normalizar,
    cifrar, decifrar, validarSenha, nomeBase,
  };
});
