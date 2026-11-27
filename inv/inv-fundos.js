/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — fundos de investimento (Etapas 12.3 e 12.4, v160)
   Funções PURAS (Node e navegador; window.INVEST.fundos):
   - identidade: assetId = BR:FUNDO:<CNPJ da classe>[.<ID_SUBCLASSE>] (a subclasse é OUTRO investimento:
     mesmo CNPJ, cota própria). Cabe na regra atual das operações (≤ 40 caracteres, A-Z0-9.-).
   - cota guardada como TEXTO decimal (até 12 casas, como a CVM publica) e contas em inteiros (BigInt, 1e12):
     nenhum arredondamento binário na rentabilidade nem na avaliação.
   - o que é cota de fundo ABERTO (avalia carteira) × fundo listado (FII, ETF/FIIM, FIAGRO: a cota da CVM é
     valor patrimonial, NUNCA preço de negociação; não avalia carteira).
   - FII (informe mensal): PL, VPA, cotistas, competência; P/VP só com preço válido e de data compatível.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.fundos = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSAO = '12.3';
  const ESC = 12; const UM = 10n ** 12n;
  const SHARDS = 128;
  const ATRIBUICAO = 'Contém dados da Comissão de Valores Mobiliários (CVM) — Portal de Dados Abertos (Cadastro de Fundos e Informe Diário)';
  const LICENCA = 'ODbL 1.0 (Open Data Commons Open Database License): uso comercial permitido com atribuição; a base derivada publicada continua sob ODbL e aberta';

  // ---------- identidade ----------
  const so = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const RX_SUB = /^[A-Z0-9]{1,16}$/;
  function idFundo(cnpj, sub) {
    const c = so(cnpj); if (c.length !== 14) return null;
    const s = String(sub || '').trim().toUpperCase(); if (s && !RX_SUB.test(s)) return null;
    return 'BR:FUNDO:' + c + (s ? '.' + s : '');
  }
  function partes(assetId) { const m = /^BR:FUNDO:(\d{14})(?:\.([A-Z0-9]{1,16}))?$/.exec(String(assetId || '')); return m ? { cnpj: m[1], sub: m[2] || '' } : null; }
  // shard do histórico: o mesmo cálculo no robô e no navegador
  function shard(assetId) { let h = 2166136261; const s = String(assetId); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h % SHARDS; }
  const arqShard = (assetId) => 'fundos-h-' + String(shard(assetId)).padStart(3, '0') + '.json';

  // ---------- decimais exatos ----------
  // "45.360755300000" → 45360755300000n (escala 1e12). Recusa notação científica, sinais estranhos e mais de 12 casas.
  function dec(txt) {
    const s = String(txt == null ? '' : txt).trim();
    const m = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(s); if (!m) return null;
    const v = BigInt(m[2]) * UM + BigInt((m[3] || '').padEnd(ESC, '0'));
    return m[1] ? -v : v;
  }
  function decTxt(v, casas = ESC) { // 45360755300000n → "45.3607553" (sem zeros à direita, no máximo "casas")
    if (v == null) return null; const neg = v < 0n; let a = neg ? -v : v;
    if (casas < ESC) { const f = 10n ** BigInt(ESC - casas); a = (a + f / 2n) / f; a *= f; }
    const i = a / UM; let d = (a % UM).toString().padStart(ESC, '0').slice(0, casas).replace(/0+$/, '');
    return (neg ? '-' : '') + i.toString() + (d ? '.' + d : '');
  }
  const normCota = (txt) => { const v = dec(txt); return v == null ? null : decTxt(v); };
  // rentabilidade entre duas cotas (fração, número só no fim; precisão de 1e-12)
  function rent(cotaIni, cotaFim) { const a = dec(cotaIni), b = dec(cotaFim); if (a == null || b == null || a <= 0n || b < 0n) return null; return Number(((b - a) * UM * 1000n) / a) / 1e15; }
  // valor em centavos de qtd (E8, inteiro) × cota (texto decimal): arredondamento meio-par, sem passar por float
  function valorCentavos(qtdE8, cotaTxt) {
    const c = dec(cotaTxt); if (c == null) return null;
    const num = BigInt(qtdE8) * c * 100n; const den = 10n ** 8n * UM;
    const neg = num < 0n; const A = neg ? -num : num; let q = A / den; const r = A % den; if (r * 2n > den || (r * 2n === den && q % 2n === 1n)) q += 1n;
    return Number(neg ? -q : q);
  }

  // ---------- natureza do fundo ----------
  // tipo: FIF, FIDC, FIP, FII, FIAGRO, FIIM (fundo de índice = ETF), FAPI...; condominio: aberto|fechado|''
  const LISTADOS = new Set(['FII', 'FIIM', 'FIAGRO']);
  function natureza(f) {
    const tipo = String(f.tipo || '').toUpperCase();
    const listado = LISTADOS.has(tipo) || !!f.listado;
    const aberto = f.condominio === 'Aberto';
    // a cota da CVM avalia carteira SÓ em fundo aberto, não listado, com cota positiva e não agregado de subclasses
    const avalia = aberto && !listado && !f.agregado;
    let motivo = '';
    if (listado) motivo = tipo === 'FIIM' ? 'ETF (fundo de índice) negociado em bolsa: a cota da CVM é valor patrimonial, não é o preço de negociação' : 'Fundo negociado em bolsa: a cota da CVM é valor patrimonial, não é o preço de negociação';
    else if (f.agregado) motivo = 'Linha da classe que soma as subclasses: investimentos são feitos numa subclasse';
    else if (!aberto) motivo = f.condominio === 'Fechado' ? 'Fundo fechado: a cota não é o valor de resgate (resgate só no fim do prazo ou por venda)' : 'Forma de condomínio não informada pela CVM';
    return { listado, aberto, avalia, motivo };
  }
  function disponibilidade(f) { // não presume que o fundo esteja aberto a qualquer investidor
    const avisos = [];
    if (f.situacao && f.situacao !== 'Em Funcionamento Normal') avisos.push('Situação na CVM: ' + f.situacao);
    if (f.exclusivo === 'S') avisos.push('Fundo exclusivo (um único cotista ou grupo)');
    if (f.publico === 'Profissional') avisos.push('Só investidores profissionais');
    else if (f.publico === 'Qualificado') avisos.push('Só investidores qualificados');
    else if (!f.publico) avisos.push('Público-alvo não informado');
    return avisos;
  }

  // ---------- índice compacto (fundos-indice.json) ----------
  // campos: [assetId, nome, tipo, classificacao, condominio, situacao, publico, exclusivo, tributacaoLP, ultimaData, flags]
  // flags: L = listado, A = agregado de subclasses, P = previdenciário, D = cota de hoje não publicada (só antigas)
  const CAMPOS = ['assetId', 'nome', 'tipo', 'classificacao', 'condominio', 'situacao', 'publico', 'exclusivo', 'tributacaoLP', 'ultimaData', 'flags'];
  const SIT = { N: 'Em Funcionamento Normal', P: 'Fase Pré-Operacional', L: 'Em Liquidação', C: 'Cancelado', O: 'Outra situação' };
  const PUB = { G: 'Público Geral', Q: 'Qualificado', R: 'Profissional' };
  const COND = { A: 'Aberto', F: 'Fechado' };
  function deLinha(l) {
    const o = {}; CAMPOS.forEach((c, i) => { o[c] = l[i]; }); const p = partes(o.assetId) || {}; o.cnpj = p.cnpj; o.sub = p.sub;
    o.situacao = SIT[o.situacao] || o.situacao || ''; o.publico = PUB[o.publico] || o.publico || ''; o.condominio = COND[o.condominio] || o.condominio || '';
    o.tributacaoLP = o.tributacaoLP === 'S' ? 'Longo prazo' : o.tributacaoLP === 'N' ? 'Curto prazo/outra' : 'Não informada';
    o.listado = /L/.test(o.flags || ''); o.agregado = /A/.test(o.flags || ''); o.previdenciario = /P/.test(o.flags || ''); o.defasado = /D/.test(o.flags || ''); return o;
  }
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // pesquisa por nome (todas as palavras), CNPJ (com ou sem pontuação, inteiro ou começo) ou código da subclasse
  function pesquisar(indice, termo, op = {}) {
    const lim = op.limite || 30; const t = String(termo || '').trim(); if (!t || !indice || !Array.isArray(indice.itens)) return [];
    const dig = so(t); const sub = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const palavras = norm(t).split(' ').filter((w) => w.length >= 2);
    const out = [];
    for (const l of indice.itens) {
      const id = l[0]; let pts = 0;
      if (dig.length >= 5 && id.slice(9, 23).startsWith(dig)) pts = dig.length === 14 ? 100 : 60;
      else if (sub.length >= 6 && /[A-Z]/.test(sub) && id.includes('.' + sub)) pts = 90;
      else if (palavras.length) { const n = norm(l[1]); if (palavras.every((w) => n.includes(w))) pts = 30 + (n.startsWith(palavras[0]) ? 10 : 0); }
      if (!pts) continue;
      if (op.situacao !== 'todas' && l[5] !== 'N') pts -= 20;
      if (/A/.test(l[10] || '')) pts -= 5;
      out.push([pts, l]);
    }
    return out.sort((a, b) => b[0] - a[0] || String(a[1][1]).localeCompare(String(b[1][1]))).slice(0, lim).map((x) => deLinha(x[1]));
  }

  // ---------- histórico (fundos-h-NNN.json) ----------
  // d: [[data, cota], ...] (dias recentes); u: [data, cota, pl, captacao, resgate, cotistas] (último dia);
  // m: [[AAAA-MM, último dia, cota, PL no fim, captação do mês, resgate do mês, cotistas no fim], ...]
  const okC = (c) => { const v = dec(c); return v != null && v > 0n; };
  function serie(h) { return h && Array.isArray(h.d) ? h.d.filter((x) => okC(x[1])) : []; }
  function ultima(h) { if (h && Array.isArray(h.u) && okC(h.u[1])) return h.u; const d = serie(h); return d.length ? d[d.length - 1] : null; }
  function cotaEm(h, data) { // última cota com data <= data (mensal antigo + diário recente)
    let r = null; for (const x of (h && h.m) || []) if (x[1] <= data && okC(x[2])) r = { data: x[1], cota: x[2] };
    for (const x of serie(h)) if (x[0] <= data && (!r || x[0] >= r.data)) r = { data: x[0], cota: x[1] };
    return r;
  }
  function meses(h) { return ((h && h.m) || []).filter((x) => okC(x[2])).map((x) => ({ mes: x[0], data: x[1], cota: x[2], pl: x[3], captacao: x[4], resgate: x[5], cotistas: x[6] })); }
  const menosMeses = (iso, n) => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 - n, 1)); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(+iso.slice(8, 10), ult)).padStart(2, '0')}`; };
  // rentabilidade no mês, no ano e em 12 meses, sempre pela COTA (já líquida de taxas do fundo, bruta de IR do cotista)
  function rentabilidades(h) {
    const u = ultima(h); if (!u) return null;
    const ref = u[0]; const fimMesAnt = (() => { const d = new Date(Date.UTC(+ref.slice(0, 4), +ref.slice(5, 7) - 1, 0)); return d.toISOString().slice(0, 10); })();
    const fimAnoAnt = (+ref.slice(0, 4) - 1) + '-12-31';
    const base = (dt, tolDias) => { const c = cotaEm(h, dt); if (!c) return null; const dif = (Date.parse(dt) - Date.parse(c.data)) / 864e5; return dif <= tolDias ? c : null; };
    const r = (c) => (c ? { de: c.data, valor: rent(c.cota, u[1]) } : null);
    const A = (h && h.a) || {}; const anc = (k) => (Array.isArray(A[k]) && okC(A[k][1]) ? { data: A[k][0], cota: A[k][1] } : null);
    // com as âncoras do robô (diário completo) usa-as; senão procura no histórico guardado
    return { data: ref, cota: u[1], mes: r(anc('mes') || base(fimMesAnt, 7)), ano: r(anc('ano') || base(fimAnoAnt, 10)), m12: r(anc('m12') || base(menosMeses(ref, 12), 10)) };
  }
  // série para gráfico (diário recente + mensal antigo, sem repetir datas)
  function serieGrafico(h) {
    const d = serie(h); const ini = d.length ? d[0][0] : '9999';
    const m = ((h && h.m) || []).filter((x) => x[1] < ini && okC(x[2])).map((x) => [x[1], x[2]]);
    return m.concat(d.map((x) => [x[0], x[1]])).map(([data, c]) => ({ data, fechamento: Number(c), abertura: Number(c), maxima: Number(c), minima: Number(c), volume: 0 }));
  }

  // ---------- adaptador para o Market Engine (cota oficial D-1; nunca "tempo real") ----------
  function criarAdaptador(indice, carregarShard, hoje) {
    const porId = new Map(((indice && indice.itens) || []).map((l) => [l[0], deLinha(l)]));
    const cache = new Map();
    async function hist(assetId) { const arq = arqShard(assetId); if (!cache.has(arq)) cache.set(arq, carregarShard(arq)); const s = await cache.get(arq); return s && s.fundos ? s.fundos[assetId] || null : null; }
    return {
      id: 'cvm_fundos', nome: 'CVM — Informe Diário de Fundos', real: true, ehSimulado: false,
      suporta: (a) => a && a.classe === 'fundo' && !!partes(a.assetId),
      async cotacao(a) {
        const f = porId.get(a.assetId); if (!f) return null;
        const nat = natureza(f); const h = await hist(a.assetId); const u = ultima(h); if (!u) return null;
        const idade = Math.round((Date.parse(hoje) - Date.parse(u[0])) / 864e5);
        if (!nat.avalia) return { preco: null, estado: 'indisponivel', motivo: nat.motivo, data: u[0], referencia: { cotaPatrimonial: u[1], tipo: 'valor-patrimonial' } };
        return { preco: Number(u[1]), precoDec: u[1], tipoPreco: 'cota-oficial', data: u[0], horario: u[0] + 'T00:00:00', estado: idade > 10 ? 'desatualizado' : 'fechamento', fonteOriginal: 'cvm_fundos', moeda: 'BRL',
          detalhe: { pl: u[2], captacao: u[3], resgate: u[4], cotistas: u[5], competencia: u[0], aviso: 'Cota oficial informada pelo fundo à CVM (D-1 ou anterior), líquida das taxas do fundo e bruta de IR e IOF do cotista.' } };
      },
      async historico(a) { const h = await hist(a.assetId); const s = serieGrafico(h); return s.length ? s : null; },
      hist,
    };
  }

  // versão síncrona para o Market Engine (o motor é síncrono): lê só os históricos JÁ carregados (mapa id → histórico)
  function criarAdaptadorSync(indice, historicos, hoje) {
    const porId = new Map(((indice && indice.itens) || []).map((l) => [l[0], deLinha(l)]));
    return {
      id: 'fundos',
      cotacao(a) {
        const f = porId.get(a.assetId); const h = historicos.get(a.assetId); if (!f || !h) return null;
        const nat = natureza(f); const u = ultima(h); if (!u || !nat.avalia) return null; // fechado/listado/agregado: sem preço (o motivo aparece na tela do fundo)
        const idade = Math.round((Date.parse(hoje) - Date.parse(u[0])) / 864e5);
        return { preco: Number(u[1]), precoDec: u[1], tipoPreco: 'cota-oficial', data: u[0], horario: u[0] + 'T00:00:00', estado: idade > 10 ? 'desatualizado' : 'fechamento',
          detalhe: { pl: u[2], captacao: u[3], resgate: u[4], cotistas: u[5], aviso: 'Cota oficial informada à CVM (D-1 ou anterior), líquida das taxas do fundo e bruta de IR e IOF do cotista.' } };
      },
      historico(a) { const h = historicos.get(a.assetId); const s = h ? serieGrafico(h) : []; return s.length ? s : null; },
    };
  }
  // ativo do catálogo para um fundo (classe "fundo", bolsa FUNDO; o código é a subclasse ou o CNPJ)
  function ativoDe(f) {
    return { assetId: f.assetId, ticker: f.sub || f.cnpj, nome: f.nome, nomeCurto: '', pais: 'BR', bolsa: 'FUNDO', classe: 'fundo', moeda: 'BRL', setor: f.classificacao || 'Fundos', segmento: f.tipo || '', ids: { cnpj: f.cnpj }, fontes: [{ id: 'cvm', dataRef: f.ultimaData || null, arquivo: 'Cadastro de Fundos + Informe Diário (CVM)' }], situacao: f.situacao === 'Em Funcionamento Normal' ? 'ativo' : 'inativo', teste: false, codigoConfirmado: true, fundo: f };
  }

  // ---------- FII (informe mensal) ----------
  // P/VP só com preço de NEGOCIAÇÃO válido (não a cota patrimonial), do mesmo ativo, em data até 45 dias da competência do VPA
  function pvp(fii, preco) {
    if (!fii || !(fii.vpa > 0)) return { valor: null, motivo: 'VPA indisponível' };
    if (!preco || !(preco.preco > 0) || !preco.data) return { valor: null, motivo: 'Sem preço de negociação autorizado (B3 pendente): P/VP não calculado' };
    if (!['tempo-real', 'atrasado', 'fechamento', 'manual'].includes(preco.estado) || preco.tipoPreco === 'cota-oficial' || preco.tipoPreco === 'valor-patrimonial') return { valor: null, motivo: 'O preço disponível não é de negociação em bolsa' };
    const dias = Math.abs(Date.parse(preco.data) - Date.parse(fii.competenciaFim || fii.competencia)) / 864e5;
    if (dias > 45) return { valor: null, motivo: `Preço (${preco.data}) e VPA (${fii.competencia}) de datas incompatíveis` };
    return { valor: Math.round((preco.preco / fii.vpa) * 100) / 100, motivo: '', base: { preco: preco.preco, precoData: preco.data, vpa: fii.vpa, competencia: fii.competencia } };
  }

  return { VERSAO, SHARDS, ATRIBUICAO, LICENCA, CAMPOS, idFundo, partes, shard, arqShard, dec, decTxt, normCota, rent, valorCentavos, natureza, disponibilidade, deLinha, pesquisar, serie, ultima, cotaEm, meses, rentabilidades, serieGrafico, criarAdaptador, criarAdaptadorSync, ativoDe, pvp, norm };
});
