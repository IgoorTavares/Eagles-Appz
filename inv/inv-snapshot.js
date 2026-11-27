/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — eagles-dados (Etapa 12.2, v160)
   Integridade dos arquivos de dados, igual no robô (Node) e no navegador:
   - ESQUEMAS: a lista FECHADA de arquivos de dados públicos (nada fora dela; nunca código).
   - validarConteudo: formato, tamanho, anti-vazio, competência, datas no futuro, conteúdo malicioso,
     URLs só de domínios autorizados, nenhum campo privado (uid, tenant, e-mail, CPF, senha, token).
   - validarManifesto: manifesto versionado (sequência crescente), caminho imutável, SHA-256 completo.
   - criarLeitor (navegador): lê o manifesto, baixa cada arquivo do snapshot imutável, confere tamanho e
     SHA-256 (crypto.subtle), valida o conteúdo e guarda o último válido; se algo falhar, usa o último
     válido com aviso (nunca mostra um arquivo adulterado ou incompleto).
   O publicador (Node) fica em investimentos-portao/eagles-dados.mjs.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.snapshot = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSAO = '12.2';
  const FORMATO_MANIFESTO = 'eagles-dados-manifesto-v2';
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  const maxData = (lista) => lista.filter((d) => typeof d === 'string' && DIA.test(d.slice(0, 10))).map((d) => d.slice(0, 10)).sort().pop() || null;
  const chaves = (o) => (o && typeof o === 'object' ? Object.keys(o) : []);

  // ---------- lista fechada de arquivos públicos ----------
  // competencia(o): a data do dado (não a da coleta). min(o): anti-vazio. max: bytes.
  const ESQUEMAS = {
    'tesouro.json': { formato: 'eagles-inv-tesouro-v1', max: 2.5e6, fonte: 'tesouro_direto', min: (o) => chaves(o.titulos).length >= 10, competencia: (o) => o.dataBase },
    'noticias.json': { formato: 'eagles-inv-noticias-v1', max: 4e5, fonte: 'noticias_fed', min: (o) => Array.isArray(o.itens) && o.itens.length >= 1, competencia: (o) => maxData((o.itens || []).map((x) => x.data)) },
    'macro-us.json': { formato: 'eagles-inv-macro-us-v1', max: 5e5, fonte: 'fred', min: (o) => chaves(o.series).length >= 5, competencia: (o) => maxData(Object.values(o.series || {}).map((s) => s.dataRef)) },
    'fundamentos-br.json': { formato: 'eagles-inv-fundamentos-br-v1', max: 3e6, fonte: 'cvm', min: (o) => chaves(o.empresas).length >= 100, competencia: (o) => maxData(Object.values(o.empresas || {}).map((e) => { const a = e.anual || []; const u = a[a.length - 1]; return u && (u.fim || (u.ano ? u.ano + '-12-31' : null)); })) },
    'fundamentos-us.json': { formato: 'eagles-inv-fundamentos-us-v1', max: 2e6, fonte: 'sec_edgar', min: (o) => !!o.indisponivel || chaves(o.empresas).length >= 10, competencia: (o) => maxData(Object.values(o.empresas || {}).map((e) => { const a = e.anual || []; return a.length ? a[a.length - 1].fim : null; })) || (o.coleta || '').slice(0, 10) },
    'catalogo-us.json': { formato: 'eagles-inv-catalogo-us-v1', max: 2e6, fonte: 'sec_edgar', min: (o) => !!o.indisponivel || (Array.isArray(o.itens) && o.itens.length >= 1000), competencia: (o) => (o.coleta || '').slice(0, 10) },
    // v160
    'fundos-indice.json': { formato: 'eagles-inv-fundos-indice-v1', max: 6e6, fonte: 'cvm_fundos', min: (o) => Array.isArray(o.itens) && o.itens.length >= 1000, competencia: (o) => o.competencia },
    'fundos-h-###.json': { formato: 'eagles-inv-fundos-hist-v1', max: 1.5e6, fonte: 'cvm_fundos', min: (o) => chaves(o.fundos).length >= 1, competencia: (o) => o.competencia, padrao: /^fundos-h-\d{3}\.json$/ },
    'fii-mensal.json': { formato: 'eagles-inv-fii-mensal-v1', max: 6e6, fonte: 'cvm_fii', min: (o) => chaves(o.fundos).length >= 100, competencia: (o) => o.competencia },
    'energia.json': { formato: 'eagles-inv-energia-v1', max: 4e5, fonte: 'eia_fred', min: (o) => chaves(o.series).length >= 1, competencia: (o) => maxData(Object.values(o.series || {}).map((s) => s.dataRef)) },
    'cambio-int.json': { formato: 'eagles-inv-cambio-int-v1', max: 6e5, fonte: 'cambio_int', min: (o) => chaves(o.pares).length >= 3, competencia: (o) => maxData(Object.values(o.pares || {}).map((s) => s.dataRef)) },
    'macro-int.json': { formato: 'eagles-inv-macro-int-v1', max: 8e5, fonte: 'worldbank', min: (o) => chaves(o.paises).length >= 5, competencia: (o) => maxData(Object.values(o.paises || {}).flatMap((p) => Object.values(p.indicadores || {}).map((i) => (i.ano ? i.ano + '-12-31' : null)))) },
  };
  function esquema(nome) {
    if (typeof nome !== 'string' || nome.length > 60 || /[\/\\]|\.\./.test(nome)) return null;
    if (ESQUEMAS[nome] && !ESQUEMAS[nome].padrao) return ESQUEMAS[nome];
    for (const e of Object.values(ESQUEMAS)) if (e.padrao && e.padrao.test(nome)) return e;
    return null;
  }

  // ---------- conteúdo ----------
  // domínios de onde podem vir links dentro dos dados (atribuição, notícia oficial, página da fonte)
  const DOMINIOS = ['federalreserve.gov', 'sec.gov', 'cvm.gov.br', 'bcb.gov.br', 'tesourotransparente.gov.br', 'tesourodireto.com.br', 'treasury.gov', 'stlouisfed.org', 'eia.gov', 'ecb.europa.eu', 'bankofcanada.ca', 'worldbank.org', 'opendatacommons.org', 'creativecommons.org', 'gov.br'];
  const hostOk = (h) => DOMINIOS.some((d) => h === d || h.endsWith('.' + d));
  const RX_PERIGO = /<\s*script|<\s*iframe|<\s*object|<\s*embed|<\s*svg|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon(error|load|click|mouseover|focus)\s*=|srcdoc\s*=/i;
  const RX_CREDENCIAL = /api_key=|apikey=|token=|access_token|Bearer\s|-----BEGIN|\bAKIA[0-9A-Z]{16}\b|ghp_[A-Za-z0-9]{20,}/i;
  const RX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const CAMPOS_PRIVADOS = /"(uid|tenantId|tenant|email|e-mail|cpf|senha|password|token|telefone|celular|carteiraId|usuario|ownerUid)"\s*:/i;
  function urlsDe(txt) { return txt.match(/https?:\/\/[^"\s\\]+/gi) || []; }
  function validarConteudo(nome, obj, op = {}) {
    const E = esquema(nome); const erros = [];
    if (!E) return { ok: false, erros: ['arquivo fora da lista de dados públicos'] };
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, erros: ['não é um objeto JSON'] };
    if (obj.formato !== E.formato) erros.push('formato inesperado');
    const txt = op.texto || JSON.stringify(obj);
    if (txt.length > E.max) erros.push(`grande demais (${txt.length} bytes; limite ${E.max})`);
    if (RX_PERIGO.test(txt)) erros.push('conteúdo suspeito (script, iframe, javascript:)');
    if (RX_CREDENCIAL.test(txt)) erros.push('possível credencial no conteúdo');
    if (CAMPOS_PRIVADOS.test(txt)) erros.push('campo privado (dados de pessoa ou de conta) num arquivo público');
    if (RX_EMAIL.test(txt.replace(/"(link|url|fonteUrl|site)"\s*:\s*"[^"]*"/g, ''))) erros.push('e-mail no conteúdo');
    for (const u of urlsDe(txt)) {
      let h = ''; try { const x = new URL(u); if (x.protocol !== 'https:') { erros.push('link sem https: ' + u.slice(0, 60)); continue; } h = x.hostname.toLowerCase(); } catch (e) { erros.push('link inválido'); continue; }
      if (!hostOk(h)) { erros.push('link de domínio não autorizado: ' + h); break; }
    }
    const hoje = op.hoje || '9999-12-31';
    const datas = txt.match(/"(dataBase|dataRef|data|fim|competencia|dt)"\s*:\s*"(\d{4}-\d{2}-\d{2})/g) || [];
    if (datas.some((d) => d.slice(-10) > hoje)) erros.push('data no futuro');
    let competencia = null;
    try { competencia = E.competencia(obj) || null; } catch (e) { competencia = null; }
    if (competencia != null && !DIA.test(String(competencia).slice(0, 10))) erros.push('competência inválida');
    if (competencia && competencia.slice(0, 10) > hoje) erros.push('competência no futuro');
    if (!erros.length) { let m = false; try { m = !!E.min(obj); } catch (e) { m = false; } if (!m) erros.push('vazio ou incompleto (anti-vazio)'); }
    if (!erros.length && !competencia) erros.push('sem data de competência');
    return { ok: !erros.length, erros, competencia: competencia ? competencia.slice(0, 10) : null, fonte: E.fonte };
  }

  // ---------- manifesto ----------
  const RX_CAMINHO = /^snapshots\/\d{14}\/[a-z0-9-]+\.json$/;
  const RX_SHA = /^[0-9a-f]{64}$/;
  function validarManifesto(m) {
    const erros = [];
    if (!m || typeof m !== 'object' || m.formato !== FORMATO_MANIFESTO) return { ok: false, erros: ['formato do manifesto inesperado'] };
    if (!Number.isInteger(m.sequencia) || m.sequencia < 1) erros.push('sequência inválida');
    if (typeof m.gerado !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(m.gerado)) erros.push('data de geração inválida');
    if (!m.arquivos || typeof m.arquivos !== 'object' || !chaves(m.arquivos).length) erros.push('sem arquivos');
    else for (const [nome, a] of Object.entries(m.arquivos)) {
      if (!esquema(nome)) { erros.push('arquivo fora da lista: ' + String(nome).slice(0, 40)); continue; }
      if (!a || !RX_CAMINHO.test(a.caminho || '') || !a.caminho.endsWith('/' + nome)) erros.push(nome + ': caminho inválido');
      if (!a || !RX_SHA.test(a.sha256 || '')) erros.push(nome + ': SHA-256 ausente ou incompleto');
      if (!a || !Number.isInteger(a.bytes) || a.bytes <= 0 || a.bytes > esquema(nome).max) erros.push(nome + ': tamanho inválido');
      if (!a || !DIA.test(a.competencia || '')) erros.push(nome + ': competência inválida');
      if (a && !['atual', 'desatualizado'].includes(a.estado)) erros.push(nome + ': estado inválido');
    }
    return { ok: !erros.length, erros };
  }

  // ---------- SHA-256 (navegador: crypto.subtle; Node: o mesmo, globalThis.crypto) ----------
  async function sha256Hex(bytes, subtle) {
    const s = subtle || (typeof crypto !== 'undefined' && crypto.subtle);
    if (!s) throw new Error('verificação de integridade indisponível neste navegador');
    const h = await s.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- leitor (navegador) ----------
  // op: { fetch, base (url com / no fim), armazenamento, subtle, hoje, agora, maxCacheBytes, timeoutMs }
  function criarLeitor(op) {
    const f = op.fetch; const arm = op.armazenamento || null; const agora = op.agora || (() => Date.now());
    const PREF = 'eagles_dados_v2:'; const maxCache = op.maxCacheBytes || 900000; const timeoutMs = op.timeoutMs || 15000;
    const eventos = [];
    const log = (tipo, nome, msg) => { eventos.push({ tipo, nome, msg: String(msg).slice(0, 200), quando: new Date(agora()).toISOString() }); if (eventos.length > 60) eventos.shift(); };
    const ler = (k) => { try { const s = arm && arm.getItem(PREF + k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const gravar = (k, v) => { try { if (!arm) return; const s = JSON.stringify(v); if (s.length > maxCache) return; arm.setItem(PREF + k, s); } catch (e) { /* cheio: segue sem guardar */ } };
    async function baixar(url, comoTexto) {
      let ctl = null, t = null;
      try {
        if (typeof AbortController !== 'undefined') { ctl = new AbortController(); t = setTimeout(() => ctl.abort(), timeoutMs); }
        const r = await f(url, { signal: ctl ? ctl.signal : undefined, cache: comoTexto ? 'no-cache' : 'default', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
        return comoTexto ? await r.text() : new Uint8Array(await r.arrayBuffer());
      } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'sem resposta (tempo esgotado)' : (e && e.message) || String(e)); } finally { if (t) clearTimeout(t); }
    }
    let manAtual = null;
    async function manifesto() {
      const guardado = ler('manifesto');
      try {
        const txt = await baixar(op.base + 'manifesto.json?t=' + Math.floor(agora() / 60000), true);
        if (txt.length > 400000) throw new Error('manifesto grande demais');
        const m = JSON.parse(txt); const v = validarManifesto(m);
        if (!v.ok) throw new Error('manifesto inválido: ' + v.erros.slice(0, 3).join('; '));
        if (guardado && guardado.sequencia > m.sequencia) { log('aviso', 'manifesto', `manifesto antigo (sequência ${m.sequencia} < ${guardado.sequencia}): cache desatualizado; mantido o mais novo`); manAtual = guardado; return { ok: true, manifesto: guardado, origem: 'guardado', aviso: 'O servidor entregou um manifesto antigo; mantido o mais recente já conferido.' }; }
        gravar('manifesto', m); manAtual = m; return { ok: true, manifesto: m, origem: 'rede' };
      } catch (e) {
        log('erro', 'manifesto', e.message);
        if (guardado && validarManifesto(guardado).ok) { manAtual = guardado; return { ok: true, manifesto: guardado, origem: 'guardado', aviso: 'Sem acesso ao manifesto (' + e.message + '); usando o último conferido.' }; }
        manAtual = null; return { ok: false, erro: e.message };
      }
    }
    function ultimoValido(nome, motivo) {
      const g = ler('arq:' + nome);
      if (g && g.dados && g.sha256) return { ok: true, dados: g.dados, estado: 'ultimo-valido', competencia: g.competencia, sha256: g.sha256, aviso: `Atualização recusada (${motivo}). Mostrando o último dado válido, de ${g.competencia}.` };
      return { ok: false, estado: 'indisponivel', erro: motivo };
    }
    async function arquivo(nome) {
      if (!manAtual) await manifesto();
      const m = manAtual; const a = m && m.arquivos && m.arquivos[nome];
      if (!a) return ultimoValido(nome, 'arquivo não está no manifesto');
      const g = ler('arq:' + nome);
      const estadoDe = (x) => (a.estado === 'desatualizado' ? 'desatualizado' : x);
      const avisoDe = () => (a.estado === 'desatualizado' ? `A fonte falhou${a.falha && a.falha.quando ? ' em ' + a.falha.quando.slice(0, 10) : ''}; este é o último dado válido (competência ${a.competencia}).` : (a.retificacao ? `Dado retificado pela fonte (competência ${a.competencia}).` : ''));
      if (g && g.sha256 === a.sha256 && g.dados) return { ok: true, dados: g.dados, estado: estadoDe('atual'), competencia: a.competencia, sha256: a.sha256, aviso: avisoDe(), doCache: true };
      try {
        const bytes = await baixar(op.base + a.caminho, false);
        if (bytes.length !== a.bytes) throw new Error(`tamanho diferente do manifesto (${bytes.length} ≠ ${a.bytes}): publicação parcial ou arquivo corrompido`);
        const h = await sha256Hex(bytes, op.subtle);
        if (h !== a.sha256) throw new Error('SHA-256 não confere: arquivo corrompido ou adulterado');
        const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const dados = JSON.parse(texto);
        const v = validarConteudo(nome, dados, { hoje: op.hoje, texto });
        if (!v.ok) throw new Error('conteúdo inválido: ' + v.erros.slice(0, 2).join('; '));
        if (v.competencia !== a.competencia) throw new Error(`competência diferente do manifesto (${v.competencia} ≠ ${a.competencia})`);
        if (g && g.competencia && v.competencia < g.competencia && !m.rollback) throw new Error(`competência anterior à já exibida (${v.competencia} < ${g.competencia})`);
        gravar('arq:' + nome, { sha256: h, competencia: v.competencia, dados });
        return { ok: true, dados, estado: estadoDe('atual'), competencia: v.competencia, sha256: h, aviso: avisoDe() };
      } catch (e) { log('erro', nome, e.message); return ultimoValido(nome, e.message); }
    }
    return { manifesto, arquivo, eventos: () => eventos.slice(), limpar: () => { try { const ks = []; for (let i = 0; i < arm.length; i++) { const k = arm.key(i); if (k && k.startsWith(PREF)) ks.push(k); } ks.forEach((k) => arm.removeItem(k)); } catch (e) { /* sem acesso */ } } };
  }

  return { VERSAO, FORMATO_MANIFESTO, ESQUEMAS, DOMINIOS, esquema, validarConteudo, validarManifesto, sha256Hex, criarLeitor };
});
