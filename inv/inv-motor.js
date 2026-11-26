/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — núcleo (Etapa 05: Biblioteca de Ativos)
   Search Engine + Market Engine (só o necessário para a Biblioteca).
   Funções PURAS: sem tela, sem rede direta, sem IA. Rodam no navegador
   (window.INVEST.motor) e no Node (require), para o importador e os testes.
   Regras de ouro: nada inventado como real; toda informação carrega a
   fonte; sem fonte autorizada = "indisponível"; dados de teste marcados.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.motor = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ---------- vocabulário ----------
  const CLASSES = {
    acao: 'Ação', fii: 'Fundo imobiliário (FII)', etf: 'ETF', bdr: 'BDR', reit: 'REIT',
    renda_fixa: 'Renda fixa', tesouro: 'Tesouro Direto', fundo: 'Fundo', cripto: 'Criptomoeda', indice: 'Índice',
  };
  const PAISES = { BR: 'Brasil', US: 'Estados Unidos', CRYPTO: 'Cripto (global)' };
  const BOLSAS = { B3: 'B3', TESOURO: 'Tesouro Direto', NYSE: 'NYSE', NASDAQ: 'Nasdaq', NYSEARCA: 'NYSE Arca', CBOE: 'Cboe', OTC: 'Balcão (OTC)', INDICE: 'Índice', MACRO: 'Indicador econômico', '-': '—' };
  const MOEDAS = ['BRL', 'USD'];
  // fontes conhecidas (sem nenhuma credencial; a credencial, quando existir, fica só no servidor)
  const FONTES = {
    cvm: { nome: 'CVM — Dados Abertos (cadastro de companhias, FCA e informes de FII)', tipo: 'oficial', licenca: 'Dados abertos da CVM — licença declarada no portal A CONFIRMAR (esperada: ODbL, que exige atribuição e compartilhar a base derivada pela mesma licença); não verificável neste ambiente', atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Portal de Dados Abertos', url: 'https://dados.cvm.gov.br/', habilitada: true, credencial: false, autorizadaProducao: false },
    sec: { nome: 'SEC — EDGAR (company tickers)', tipo: 'oficial', licenca: 'Informação pública da SEC (exige identificação no acesso automático)', url: 'https://www.sec.gov/edgar/sec-api-documentation', habilitada: true, credencial: false },
    tesouro: { nome: 'Tesouro Transparente — Tesouro Direto', tipo: 'oficial', licenca: 'Tesouro Transparente — termos de uso A CONFIRMAR para cadastro e para preços; citar a fonte', atribuicao: 'Contém dados do Tesouro Nacional — Tesouro Transparente', url: 'https://www.tesourotransparente.gov.br/', habilitada: true, credencial: false, autorizadaProducao: false },
    b3: { nome: 'B3 — cadastro de instrumentos', tipo: 'oficial', licenca: 'Política comercial de market data da B3: uso a confirmar por escrito (D-06)', url: 'https://www.b3.com.br/', habilitada: false, credencial: false },
    coingecko: { nome: 'CoinGecko — lista de moedas', tipo: 'privada', licenca: 'Plano gratuito com atribuição; chave só no servidor (nunca no navegador)', url: 'https://www.coingecko.com/en/api', habilitada: false, credencial: true },
    manual: { nome: 'Classificação manual (Super Admin)', tipo: 'manual', licenca: 'Cadastro interno', url: '', habilitada: true, credencial: false },
    teste: { nome: 'DADOS DE TESTE (fictícios)', tipo: 'teste', licenca: 'Sem valor real', url: '', habilitada: true, credencial: false },
  };
  // prioridade ao mesclar o mesmo ativo vindo de fontes diferentes (maior manda)
  const PRIORIDADE = { manual: 90, b3: 80, sec: 80, tesouro: 80, cvm: 70, coingecko: 60, teste: 10 };

  // ---------- normalização ----------
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normTexto = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const normTicker = (s) => semAcento(s).toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  const soDigitos = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const limpaNome = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

  function cnpjValido(c) {
    c = soDigitos(c);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    const dv = (base) => { let s = 0, p = base.length - 7; for (let i = 0; i < base.length; i++) { s += +base[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(c.slice(0, 12)) === +c[12] && dv(c.slice(0, 13)) === +c[13];
  }
  const fmtCnpj = (c) => { c = soDigitos(c); return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c; };
  function isinValido(isin) {
    isin = String(isin || '').toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
    const dig = isin.split('').map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
    let soma = 0, dobra = true;
    for (let i = dig.length - 2; i >= 0; i--) { let n = +dig[i]; if (dobra) { n *= 2; if (n > 9) n -= 9; } soma += n; dobra = !dobra; }
    return (10 - (soma % 10)) % 10 === +dig[dig.length - 1];
  }
  const cikNorm = (c) => { const d = soDigitos(c); return d ? d.padStart(10, '0') : ''; };

  // ---------- identidade única ----------
  // assetId = PAIS:BOLSA:CODIGO (Etapa 03). Ex.: BR:B3:PETR4 · US:NASDAQ:AAPL · BR:TESOURO:IPCA-2035 · CRYPTO:-:BTC
  const montarAssetId = (pais, bolsa, codigo) => `${String(pais).toUpperCase()}:${String(bolsa || '-').toUpperCase()}:${normTicker(codigo)}`;
  const RX_TICKER = {
    B3: /^[A-Z][A-Z0-9]{3}\d{1,2}[A-Z]?$/,  // PETR4, KNRI11, AAPL34, B3SA3 (raiz com número), unidades 11
    TESOURO: /^[A-Z]+-\d{4}$/,               // SELIC-2029, IPCA-2035, PREFIXADO-2027, IPCAJ-2040
    NYSE: /^[A-Z]{1,5}([.\-][A-Z])?$/, NASDAQ: /^[A-Z]{1,5}$/, NYSEARCA: /^[A-Z]{1,5}$/, CBOE: /^[A-Z]{1,5}$/, OTC: /^[A-Z]{1,5}$/,
    '-': /^[A-Z0-9]{2,15}$/,
  };

  function validarAtivo(a) {
    const erros = [];
    if (!a || typeof a !== 'object') return { ok: false, erros: ['registro vazio'] };
    if (!PAISES[a.pais]) erros.push('país inválido');
    if (!BOLSAS[a.bolsa]) erros.push('bolsa inválida');
    if (!CLASSES[a.classe]) erros.push('classe inválida');
    if (!MOEDAS.includes(a.moeda)) erros.push('moeda inválida');
    if (!a.ticker || !(RX_TICKER[a.bolsa] || /./).test(a.ticker)) erros.push('código inválido para a bolsa');
    if (!a.nome) erros.push('sem nome');
    if (a.assetId !== montarAssetId(a.pais, a.bolsa, a.ticker)) erros.push('assetId não confere');
    if (a.pais === 'CRYPTO' && a.bolsa !== '-') erros.push('cripto sem bolsa');
    if (a.ids) {
      if (a.ids.cnpj && !cnpjValido(a.ids.cnpj)) erros.push('CNPJ inválido');
      if (a.ids.isin && !isinValido(a.ids.isin)) erros.push('ISIN inválido');
      if (a.ids.cik && !/^\d{10}$/.test(a.ids.cik)) erros.push('CIK inválido');
    }
    if (!a.fontes || !a.fontes.length || a.fontes.some((f) => !FONTES[f.id])) erros.push('sem fonte conhecida');
    return { ok: !erros.length, erros };
  }

  // registro bruto de um adaptador → ativo do catálogo
  function novoAtivo(r) {
    const ticker = normTicker(r.ticker);
    const a = {
      assetId: montarAssetId(r.pais, r.bolsa, ticker), ticker, nome: limpaNome(r.nome), nomeCurto: limpaNome(r.nomeCurto || ''),
      pais: r.pais, bolsa: r.bolsa || '-', classe: r.classe, moeda: r.moeda,
      setor: limpaNome(r.setor || ''), segmento: limpaNome(r.segmento || ''),
      ids: {}, fontes: [{ id: r.fonte, dataRef: r.dataRef || '', arquivo: r.arquivo || '' }],
      situacao: r.situacao || 'ativo', teste: !!r.teste,
      codigoConfirmado: !r.codigoDerivado, // código derivado (ex.: FII pelo ISIN) NUNCA é apresentado como confirmado
    };
    if (r.codigoDerivado) a.codigoDerivado = true;
    if (r.fimNegociacao) a.fimNegociacao = r.fimNegociacao;
    if (r.cnpj) a.ids.cnpj = soDigitos(r.cnpj);
    if (r.isin) a.ids.isin = String(r.isin).toUpperCase();
    if (r.cik) a.ids.cik = cikNorm(r.cik);
    if (r.codigoCvm) a.ids.cvm = soDigitos(r.codigoCvm);
    if (r.coingecko) a.ids.coingecko = String(r.coingecko).toLowerCase();
    if (r.vencimento) a.vencimento = r.vencimento;
    if (r.indexador) a.indexador = limpaNome(r.indexador);
    if (r.subjacente) a.subjacente = r.subjacente;
    return a;
  }

  // ---------- mescla e duplicidades ----------
  // Mesmo assetId de fontes diferentes = o MESMO ativo (mescla; a fonte de maior prioridade manda em cada campo).
  // Mesmo ISIN em assetIds diferentes = CONFLITO (fica o de maior prioridade; o outro vai para o relatório).
  // Mesmo CNPJ com códigos diferentes (ON/PN) = ativos diferentes da mesma empresa (normal).
  function mesclar(registros) {
    const porId = new Map(); const rejeitados = []; const duplicados = []; const conflitos = [];
    const prio = (a) => Math.max(...a.fontes.map((f) => PRIORIDADE[f.id] || 0));
    for (const r of registros) {
      const a = r && r.assetId ? r : novoAtivo(r || {});
      const v = validarAtivo(a);
      if (!v.ok) { rejeitados.push({ assetId: a.assetId, nome: a.nome, fonte: (a.fontes[0] || {}).id, erros: v.erros }); continue; }
      const ex = porId.get(a.assetId);
      if (!ex) { porId.set(a.assetId, a); continue; }
      duplicados.push({ assetId: a.assetId, fontes: [...ex.fontes.map((f) => f.id), ...a.fontes.map((f) => f.id)] });
      const [alto, baixo] = prio(a) > prio(ex) ? [a, ex] : [ex, a];
      const m = Object.assign({}, baixo, Object.fromEntries(Object.entries(alto).filter(([, x]) => x !== '' && x != null)));
      m.ids = Object.assign({}, baixo.ids, alto.ids);
      m.fontes = [...ex.fontes, ...a.fontes].filter((f, i, arr) => arr.findIndex((g) => g.id === f.id) === i);
      m.teste = ex.teste && a.teste;
      porId.set(a.assetId, m);
    }
    const porIsin = new Map();
    for (const a of porId.values()) {
      if (!a.ids.isin) continue;
      const outro = porIsin.get(a.ids.isin);
      if (!outro) { porIsin.set(a.ids.isin, a); continue; }
      const [fica, sai] = prio(a) > prio(outro) ? [a, outro] : [outro, a];
      conflitos.push({ isin: a.ids.isin, mantido: fica.assetId, removido: sai.assetId });
      porId.delete(sai.assetId); porIsin.set(a.ids.isin, fica);
    }
    const ativos = [...porId.values()].sort((x, y) => x.assetId.localeCompare(y.assetId));
    return { ativos, rejeitados, duplicados, conflitos };
  }

  // ---------- Search Engine (local, sem rede, sem IA) ----------
  function indexar(ativos) {
    return ativos.map((a) => ({
      a, tk: a.ticker, nm: normTexto(`${a.nome} ${a.nomeCurto}`), pal: normTexto(`${a.nome} ${a.nomeCurto}`).split(' '),
      ids: [a.ids.cnpj, a.ids.isin, a.ids.cik && a.ids.cik.replace(/^0+/, ''), a.ids.coingecko].filter(Boolean),
      st: normTexto(a.setor), sg: normTexto(a.segmento),
    }));
  }
  function pontuar(it, q, qTk, qDig) {
    if (!q) return 1;
    if (it.tk === qTk) return 100;
    if (qDig.length >= 5 && it.ids.some((x) => x === qDig || x === qTk)) return 95;
    if (qTk && it.tk.startsWith(qTk)) return 80 - Math.min(10, it.tk.length - qTk.length);
    const partes = q.split(' ');
    if (partes.every((p) => it.pal.some((w) => w.startsWith(p)))) return 60;
    if (it.nm.includes(q)) return 45;
    if (it.st.includes(q) || it.sg.includes(q)) return 25;
    return 0;
  }
  function buscar(indice, consulta, filtros, op) {
    filtros = filtros || {}; op = op || {};
    const q = normTexto(String(consulta || '').slice(0, 80)); const qTk = normTicker(consulta || ''); const qDig = soDigitos(consulta || '');
    const ok = (a) => (!filtros.pais || a.pais === filtros.pais) && (!filtros.bolsa || a.bolsa === filtros.bolsa)
      && (!filtros.classe || a.classe === filtros.classe) && (!filtros.setor || normTexto(a.setor) === normTexto(filtros.setor))
      && (filtros.incluirInativos || !a.situacao || a.situacao === 'ativo');
    const res = [];
    for (const it of indice) { if (!ok(it.a)) continue; const p = pontuar(it, q, qTk, qDig); if (p > 0) res.push([p, it.a]); }
    res.sort((x, y) => y[0] - x[0] || x[1].ticker.localeCompare(y[1].ticker));
    const total = res.length; const lim = op.limite || 200;
    return { total, itens: res.slice(0, lim).map((x) => x[1]) };
  }
  // valores disponíveis para os filtros (a partir do que existe no catálogo)
  function opcoesFiltro(ativos) {
    const conta = (k) => { const m = {}; ativos.forEach((a) => { if (a[k]) m[a[k]] = (m[a[k]] || 0) + 1; }); return Object.entries(m).sort((x, y) => x[0].localeCompare(y[0], 'pt-BR')); };
    return { pais: conta('pais'), bolsa: conta('bolsa'), classe: conta('classe'), setor: conta('setor') };
  }

  // Pesquisa externa AUTORIZADA: só links que a PRÓPRIA pessoa abre (o sistema não coleta nada),
  // montados só com dados públicos do ativo (nunca carteira, valores ou nomes de clientes).
  function linksExternos(a) {
    const g = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);
    const l = [{ id: 'google', rotulo: 'Pesquisar no Google', url: g(`${a.ticker} ${a.nome}`) },
      { id: 'google-noticias', rotulo: 'Notícias no Google', url: g(`${a.ticker} ${a.nome}`) + '&tbm=nws' }];
    if (a.ids.cik) l.push({ id: 'sec', rotulo: 'Documentos na SEC (EDGAR)', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + a.ids.cik });
    if (a.ids.cnpj) l.push({ id: 'cvm', rotulo: 'Documentos na CVM (pesquisa)', url: g(`site:cvm.gov.br ${fmtCnpj(a.ids.cnpj)}`) });
    if (a.classe === 'tesouro') l.push({ id: 'tesouro', rotulo: 'Tesouro Direto (preços e taxas)', url: 'https://www.tesourodireto.com.br/titulos/precos-e-taxas.htm' });
    return l;
  }

  // ---------- Market Engine: estados do dado ----------
  // Na Etapa 05 a Biblioteca NÃO tem cotação: sem fonte autorizada, o estado é "indisponivel" (nunca um preço inventado).
  const ESTADOS = { 'tempo-real': 'Tempo real', atrasado: 'Atrasado', fechamento: 'Fechamento', manual: 'Manual', simulado: 'Simulado', indisponivel: 'Indisponível', teste: 'Dado de teste' };
  function cotacaoDaBiblioteca(a) {
    return { assetId: a.assetId, preco: null, estado: 'indisponivel', motivo: 'Cotações entram na Etapa 06 (fonte autorizada ainda não ligada).', fonte: null, horarioDoDado: null };
  }

  // ---------- consumo (D-03) ----------
  // Limites por dia do MÓDULO inteiro (todas as empresas). Este medidor conta o que ESTE aparelho fez; o total global vem
  // do documento do dia (inv_admin_uso/{dia}), somado por todos os aparelhos. É cooperativo: só um servidor consegue
  // impor o limite a um aparelho que não coopera (D-10). O desenho do módulo mantém o gasto por sessão muito abaixo.
  const LIMITES = { leituras: 15000, gravacoes: 4000, exclusoes: 2000, aviso: 0.7 };
  // cada operação também faz o Firebase ler documentos DENTRO das regras (cadastro da pessoa, empresa, bloqueio de login),
  // e essas leituras contam na cota: somamos 3 por operação (estimativa conservadora das regras de Investimentos)
  const LEITURAS_DAS_REGRAS = 3;
  function estadoConsumo(uso, limites) {
    limites = limites || LIMITES; uso = uso || {};
    const frac = Math.max((uso.leituras || 0) / limites.leituras, (uso.gravacoes || 0) / limites.gravacoes, (uso.exclusoes || 0) / limites.exclusoes);
    return { frac, estado: frac >= 1 ? 'contencao' : frac >= limites.aviso ? 'aviso' : 'normal' };
  }
  // em contenção, só o essencial: o que a pessoa pediu agora (abrir a página, salvar um favorito). Para o resto.
  const OPERACOES = { 'abrir-favoritos': true, 'salvar-favorito': true, 'abrir-carteira': true, 'salvar-carteira': true, 'salvar-operacao': true, 'salvar-precos': true, 'abrir-alertas': true, 'salvar-alertas': true, 'abrir-cenarios': true, 'salvar-cenario': true, 'ler-uso': true, 'alterar-acesso': true, 'alterar-modulo': true, 'listar-empresas': false, 'listar-equipe': false, 'recarregar-catalogo': false };
  const podeExecutar = (op, estado) => estado !== 'contencao' || !!OPERACOES[op];
  function criarMedidor() {
    const m = { leituras: 0, gravacoes: 0, exclusoes: 0, ops: [] };
    m.contar = (tipo, n, op) => { m[tipo] += n; m.ops.push([op || '?', tipo, n]); };
    m.pendente = () => ({ leituras: m.leituras, gravacoes: m.gravacoes, exclusoes: m.exclusoes });
    m.zerar = () => { m.leituras = 0; m.gravacoes = 0; m.exclusoes = 0; };
    return m;
  }
  const diaHoje = (d) => { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- favoritos (estrutura) ----------
  const FAV_MAX_LISTAS = 20, FAV_MAX_ATIVOS = 500;
  function favoritosPadrao() { return { listas: [{ id: 'principal', nome: 'Meus favoritos', ativos: [] }] }; }
  function favoritosValidos(f) {
    if (!f || !Array.isArray(f.listas) || !f.listas.length || f.listas.length > FAV_MAX_LISTAS) return false;
    const total = f.listas.reduce((s, l) => s + (Array.isArray(l.ativos) ? l.ativos.length : 1e9), 0);
    return total <= FAV_MAX_ATIVOS && f.listas.every((l) => typeof l.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(l.id) && typeof l.nome === 'string' && l.nome.length >= 1 && l.nome.length <= 60 && l.ativos.every((x) => typeof x === 'string' && /^[A-Z]+:[A-Z0-9-]+:[A-Z0-9.\-]+$/.test(x)));
  }
  function alternarFavorito(f, listaId, assetId) {
    const n = JSON.parse(JSON.stringify(f && f.listas ? f : favoritosPadrao()));
    const l = n.listas.find((x) => x.id === listaId) || n.listas[0];
    const i = l.ativos.indexOf(assetId);
    if (i >= 0) l.ativos.splice(i, 1); else l.ativos.push(assetId);
    return n;
  }
  const ehFavorito = (f, assetId) => !!(f && f.listas && f.listas.some((l) => l.ativos.includes(assetId)));

  // ---------- catálogo publicado (formato do arquivo) ----------
  function validarCatalogo(meta, lista) {
    const erros = [];
    if (!meta || meta.formato !== 'eagles-inv-catalogo-v1') erros.push('formato desconhecido');
    if (!Array.isArray(lista)) erros.push('lista ausente');
    else if (meta && meta.total !== lista.length) erros.push('total não confere');
    return { ok: !erros.length, erros };
  }

  return {
    CLASSES, PAISES, BOLSAS, MOEDAS, FONTES, PRIORIDADE, ESTADOS, LIMITES, LEITURAS_DAS_REGRAS, OPERACOES, FAV_MAX_LISTAS, FAV_MAX_ATIVOS,
    semAcento, normTexto, normTicker, soDigitos, limpaNome, cnpjValido, fmtCnpj, isinValido, cikNorm,
    montarAssetId, validarAtivo, novoAtivo, mesclar, indexar, buscar, opcoesFiltro, linksExternos, cotacaoDaBiblioteca,
    estadoConsumo, podeExecutar, criarMedidor, diaHoje, favoritosPadrao, favoritosValidos, alternarFavorito, ehFavorito, validarCatalogo,
  };
});
