/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — News Engine + Search Engine (Etapa 08)
   Funções PURAS (sem rede): o navegador e os testes entregam o TEXTO do feed;
   quem busca os feeds de verdade é o servidor (D-10), porque os sites oficiais
   não liberam a leitura direta pelo navegador (CORS) e alguns exigem identificação.
   Regras:
   - só fontes OFICIAIS ou AUTORIZADAS, por RSS/Atom publicado pela própria fonte (sem raspagem);
   - guardamos título, data, fonte, link original e um RESUMO curto (até 280 letras):
     a matéria completa NUNCA é copiada — a pessoa lê no site da fonte;
   - classificação por palavras-chave (regra fixa, sem IA) e remoção de duplicadas;
   - pesquisa: links manuais (a pessoa abre) NÃO são um motor automático; o motor
     automático (API autorizada) fica desligado até existir chave no servidor.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.noticias = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // fontes previstas (todas DESLIGADAS no navegador: dependem do servidor e da confirmação dos termos de uso)
  const FONTES = {
    bcb: { nome: 'Banco Central do Brasil — notas e comunicados', tipo: 'oficial', formato: 'RSS', pais: 'BR', url: 'https://www.bcb.gov.br/', termos: 'Conteúdo público oficial; termos de reprodução a confirmar', ligada: false },
    ibge: { nome: 'IBGE — Agência de Notícias (inflação, PIB, emprego)', tipo: 'oficial', formato: 'RSS', pais: 'BR', url: 'https://agenciadenoticias.ibge.gov.br/', termos: 'Conteúdo público oficial; termos de reprodução a confirmar', ligada: false },
    cvm: { nome: 'CVM — notícias e comunicados', tipo: 'oficial', formato: 'RSS', pais: 'BR', url: 'https://www.gov.br/cvm/', termos: 'Conteúdo público oficial; termos a confirmar', ligada: false },
    tesouro: { nome: 'Tesouro Nacional — notícias', tipo: 'oficial', formato: 'RSS', pais: 'BR', url: 'https://www.tesourotransparente.gov.br/', termos: 'Conteúdo público oficial; termos a confirmar', ligada: false },
    fed: { nome: 'Federal Reserve — press releases', tipo: 'oficial', formato: 'RSS', pais: 'US', url: 'https://www.federalreserve.gov/feeds/', termos: 'Domínio público (federalreserve.gov/disclaimer.htm), citar o Board; título original + link, sem copiar a matéria', ligada: true },
    sec: { nome: 'SEC — press releases', tipo: 'oficial', formato: 'RSS', pais: 'US', url: 'https://www.sec.gov/news/pressreleases.rss', termos: 'Public domain (U.S. government), exige identificação no acesso automático', ligada: false },
    bls: { nome: 'U.S. Bureau of Labor Statistics — releases (CPI, emprego)', tipo: 'oficial', formato: 'RSS', pais: 'US', url: 'https://www.bls.gov/feed/', termos: 'Public domain (U.S. government), a confirmar', ligada: false },
    provedor: { nome: 'Provedor de notícias financeiras com licença (a contratar)', tipo: 'privada', formato: 'API', pais: 'BR/US', url: '', termos: 'Contrato e licença necessários (orçamento atual R$ 0)', ligada: false },
    teste: { nome: 'DADOS DE TESTE (notícias fictícias)', tipo: 'teste', formato: 'RSS', pais: 'BR/US', url: '', termos: 'Sem valor real', ligada: true },
  };

  // categorias pedidas (ordem de exibição) e palavras-chave (sem acento, minúsculas)
  const CATEGORIAS = [
    ['brasil', 'Brasil', ['brasil', 'brasileir', 'ibovespa', 'b3 ', 'governo federal', 'copom', 'congresso']],
    ['eua', 'EUA', ['eua', 'estados unidos', 'wall street', 'federal reserve', 'fed ', 'nasdaq', 's&p', 'dow jones', 'treasury', 'sec ']],
    ['mundo', 'Economia mundial', ['global', 'mundial', 'china', 'europa', 'zona do euro', 'fmi', 'banco mundial', 'japao', 'g20', 'opep']],
    ['empresas', 'Empresas', ['lucro', 'balanco', 'resultado trimestral', 'receita liquida', 'fato relevante', 'aquisicao', 'fusao', 'ipo', 'oferta de acoes', 'companhia']],
    ['setores', 'Setores', ['setor ', 'varejo', 'bancos', 'energia', 'mineracao', 'agronegocio', 'imobiliario', 'tecnologia', 'saude', 'industria']],
    ['inflacao', 'Inflação', ['inflacao', 'ipca', 'igp-m', 'igpm', 'cpi', 'precos ao consumidor', 'deflacao']],
    ['juros', 'Juros', ['juros', 'selic', 'taxa basica', 'copom', 'fed funds', 'politica monetaria', 'cdi']],
    ['cambio', 'Câmbio', ['cambio', 'dolar', 'real frente', 'euro', 'ptax', 'moeda']],
    ['commodities', 'Commodities', ['commodit', 'petroleo', 'brent', 'minerio', 'soja', 'milho', 'ouro', 'cafe', 'acucar']],
    ['renda-fixa', 'Renda fixa', ['renda fixa', 'tesouro direto', 'titulos publicos', 'debenture', 'cdb', 'lci', 'lca', 'treasuries', 'curva de juros']],
    ['cripto', 'Cripto', ['cripto', 'bitcoin', 'ethereum', 'blockchain', 'stablecoin']],
  ];
  const NOME_CAT = Object.fromEntries(CATEGORIAS.map(([k, n]) => [k, n]));
  NOME_CAT.favoritos = 'Favoritos';

  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => ' ' + semAcento(s).toLowerCase().replace(/\s+/g, ' ') + ' ';
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const desescapar = (s) => String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => { if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } return ENT[e.toLowerCase()] ?? m; });
  // texto puro: tira CDATA, TAGS e entidades; nunca devolve HTML
  const textoPuro = (s) => desescapar(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const RESUMO_MAX = 280;
  const resumir = (s) => { const t = textoPuro(s); if (t.length <= RESUMO_MAX) return t; const c = t.slice(0, RESUMO_MAX); return c.slice(0, Math.max(c.lastIndexOf(' '), 200)).replace(/[,;:\-–]$/, '') + '…'; };
  const linkSeguro = (u) => { u = String(u || '').trim(); return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : ''; };
  const tag = (bloco, nome) => { const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${nome}>`, 'i').exec(bloco); return m ? m[1] : ''; };
  const atributo = (bloco, nome, attr) => { const m = new RegExp(`<${nome}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i').exec(bloco); return m ? m[1] : ''; };
  function dataIso(s) { const t = Date.parse(textoPuro(s)); return isFinite(t) ? new Date(t).toISOString() : ''; }

  // RSS 2.0 (<item>) e Atom (<entry>); fonte = id da fonte de origem
  function lerFeed(xml, fonte) {
    const out = []; xml = String(xml || '');
    if (xml.length > 2e6) xml = xml.slice(0, 2e6); // feed gigante: lê só o começo
    const blocos = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    for (const b of blocos.slice(0, 200)) {
      const titulo = textoPuro(tag(b, 'title')).slice(0, 220);
      const link = linkSeguro(textoPuro(tag(b, 'link')) || atributo(b, 'link', 'href') || textoPuro(tag(b, 'guid')));
      const data = dataIso(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
      const resumo = resumir(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
      if (!titulo || !link) continue; // sem título ou sem link original: não entra (não há como citar a fonte)
      out.push({ id: '', titulo, link, data, resumo, fonte });
    }
    return out;
  }

  // classificação por palavras-chave; "favoritos" quando cita código ou nome de um ativo favorito
  function classificar(n, favoritos) {
    const t = norm(n.titulo + ' ' + n.resumo); const cats = [];
    for (const [k, , pal] of CATEGORIAS) if (pal.some((p) => t.includes(' ' + p.trim() + (p.endsWith(' ') ? ' ' : '')))) cats.push(k); // palavra começando no início de uma palavra ("ouro" não casa com "tesouro")
    const ativos = [];
    for (const f of favoritos || []) {
      const nome = f.nomeCurto ? norm(f.nomeCurto).trim() : '';
      if (new RegExp(`[^a-z0-9]${f.ticker.toLowerCase().replace(/[.\-]/g, '\\$&')}[^a-z0-9]`).test(t) || (nome.length >= 4 && t.includes(' ' + nome + ' '))) ativos.push(f.assetId);
    }
    if (ativos.length) cats.push('favoritos');
    return Object.assign({}, n, { categorias: cats.length ? cats : ['mundo'], ativos });
  }
  // duplicadas: mesmo link (sem parâmetros de rastreio) ou mesmo título normalizado; fica a mais antiga como original
  function deduplicar(lista) {
    const chaveLink = (u) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    const chaveTit = (t) => semAcento(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const vistos = new Map(); const out = []; let removidas = 0;
    for (const n of lista.slice().sort((a, b) => (a.data || '').localeCompare(b.data || ''))) {
      const k1 = 'l:' + chaveLink(n.link), k2 = 't:' + chaveTit(n.titulo);
      if (vistos.has(k1) || vistos.has(k2)) { removidas++; const orig = vistos.get(k1) || vistos.get(k2); orig.repetidaEm = (orig.repetidaEm || []).concat(n.fonte); continue; }
      const x = Object.assign({}, n, { id: 'n' + hash(k1) });
      vistos.set(k1, x); vistos.set(k2, x); out.push(x);
    }
    return { itens: out.sort((a, b) => (b.data || '').localeCompare(a.data || '')), removidas };
  }
  const hash = (txt) => { let h = 2166136261; for (const ch of String(txt)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

  // motor: recebe { fonteId: textoDoFeed } (já baixado por quem tem permissão) e devolve a lista pronta
  function processar(feeds, favoritos) {
    const erros = []; let todas = [];
    for (const [id, xml] of Object.entries(feeds || {})) {
      if (!FONTES[id]) { erros.push(`${id}: fonte não cadastrada`); continue; }
      if (!FONTES[id].ligada) { erros.push(`${id}: fonte desligada`); continue; }
      try { todas = todas.concat(lerFeed(xml, id)); } catch (e) { erros.push(`${id}: feed ilegível`); }
    }
    const d = deduplicar(todas.map((n) => classificar(n, favoritos)));
    return { itens: d.itens, removidas: d.removidas, erros, teste: d.itens.some((n) => FONTES[n.fonte].tipo === 'teste') };
  }
  const filtrar = (itens, cat) => (!cat || cat === 'todas' ? itens : itens.filter((n) => n.categorias.includes(cat)));
  const doAtivo = (itens, assetId) => itens.filter((n) => n.ativos.includes(assetId));

  // ---------- Search Engine ----------
  const PESQUISA = {
    links: { nome: 'Links de pesquisa manual (Google, Google Notícias, CVM, SEC)', tipo: 'manual', ligado: true, automatico: false, nota: 'A pessoa abre o link em outra aba. O sistema não lê o resultado: não é um motor automático.' },
    googleCse: { nome: 'Google — Programmable Search (API)', tipo: 'api', ligado: false, automatico: true, nota: 'Exige chave e mecanismo configurado; cota gratuita pequena e regras próprias de uso. A chave só pode ficar no servidor (D-10).' },
    provedor: { nome: 'API de pesquisa autorizada (a escolher)', tipo: 'api', ligado: false, automatico: true, nota: 'Sem contrato (orçamento R$ 0).' },
  };
  function pesquisarAutomatico() { return { estado: 'indisponivel', itens: [], motivo: 'Nenhum motor de pesquisa automático está ligado. Use os links de pesquisa manual.' }; }

  return { FONTES, CATEGORIAS, NOME_CAT, RESUMO_MAX, textoPuro, resumir, linkSeguro, lerFeed, classificar, deduplicar, processar, filtrar, doAtivo, PESQUISA, pesquisarAutomatico };
});
