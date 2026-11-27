// Investimentos · EAGLES DATA ENGINE — fundos (CVM Cadastro + Informe Diário) e FII (Informe Mensal). Etapas 12.3/12.4.
// Licença: ODbL (registros CKAN fi-cad, fi-doc-inf_diario e fii-doc-inf_mensal: license_id odc-odbl).
// Regras deste gerador (nada é presumido):
//  - a chave é (CNPJ da classe, ID_SUBCLASSE): subclasses são investimentos diferentes do mesmo CNPJ;
//  - a linha da classe que também tem subclasses fica marcada como "agregado" (não avalia carteira);
//  - não presume que todo registro seja fundo distinto, ativo ou aberto ao público: situação, público-alvo, exclusivo e
//    condomínio vêm do cadastro; quem não publicou cota na última data fica marcado (flag D) com a data real;
//  - cota preservada como texto decimal (até 12 casas); cota zero ou negativa não entra como cota válida;
//  - FII, FIIM (ETF) e FIAGRO são listados: a cota/VPA da CVM nunca vira preço de negociação.
import { lerZip } from './importar.mjs';
import { createRequire } from 'node:module';
const F = createRequire(import.meta.url)('../inv/inv-fundos.js');

const so = (s) => String(s == null ? '' : s).replace(/\D/g, '');
function tabela(buf, obrig) {
  const txt = buf.toString('latin1'); const linhas = txt.split(/\r?\n/); const cab = linhas[0].split(';').map((c) => c.trim());
  const ix = Object.fromEntries(cab.map((c, i) => [c, i])); for (const c of obrig) if (!(c in ix)) throw new Error('CVM: coluna ausente ' + c);
  const out = []; for (let i = 1; i < linhas.length; i++) { if (!linhas[i]) continue; out.push(linhas[i].split(';')); }
  return { ix, linhas: out };
}
const num2 = (s) => { const n = Number(String(s || '').trim()); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const numF = (s) => { const t = String(s || '').trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const tipoDeClasse = (t) => { const m = /Fundos\s+(.+)$/i.exec(String(t || '')); if (!m) return ''; const x = m[1].replace(/\s+/g, ' ').trim(); const p = /\((\w+)\)/.exec(x); return (p ? p[1] : x.split(' ')[0]).toUpperCase(); };
// listado: SÓ pelo tipo oficial (FII, FIIM = fundo de índice/ETF, FIAGRO) ou pelo catálogo de ativos negociados.
// Nunca pelo nome: "… ALOCAÇÃO ETF FIF" é um fundo ABERTO que compra ETFs (falso positivo achado na v160).

export function cadastro(zipBuf) {
  const z = lerZip(zipBuf);
  const fundo = tabela(z.get('registro_fundo.csv'), ['ID_Registro_Fundo', 'CNPJ_Fundo', 'Tipo_Fundo', 'Denominacao_Social', 'Situacao']);
  const classe = tabela(z.get('registro_classe.csv'), ['ID_Registro_Fundo', 'ID_Registro_Classe', 'CNPJ_Classe', 'Tipo_Classe', 'Denominacao_Social', 'Situacao', 'Forma_Condominio', 'Classificacao', 'Exclusivo', 'Publico_Alvo', 'Tributacao_Longo_Prazo']);
  const sub = tabela(z.get('registro_subclasse.csv'), ['ID_Registro_Classe', 'ID_Subclasse', 'Denominacao_Social', 'Situacao', 'Forma_Condominio', 'Exclusivo', 'Publico_Alvo', 'Previdenciario']);
  const fundos = new Map(); const fundoPorCnpj = new Map();
  for (const r of fundo.linhas) { const f = fundo.ix; const o = { id: r[f.ID_Registro_Fundo], cnpj: so(r[f.CNPJ_Fundo]), tipo: String(r[f.Tipo_Fundo]).trim(), nome: r[f.Denominacao_Social], situacao: r[f.Situacao], inicio: r[f.Data_Inicio_Situacao] || '' }; fundos.set(o.id, o); const ex = fundoPorCnpj.get(o.cnpj); if (!ex || (o.situacao !== 'Cancelado' && (ex.situacao === 'Cancelado' || o.inicio > ex.inicio))) fundoPorCnpj.set(o.cnpj, o); }
  const classes = new Map(); const classePorId = new Map(); let duplicadas = 0;
  for (const r of classe.linhas) {
    const c = classe.ix;
    const o = { idReg: r[c.ID_Registro_Classe], idFundo: r[c.ID_Registro_Fundo], cnpj: so(r[c.CNPJ_Classe]), tipo: tipoDeClasse(r[c.Tipo_Classe]), nome: r[c.Denominacao_Social], situacao: r[c.Situacao], inicio: r[c.Data_Inicio_Situacao] || '',
      condominio: r[c.Forma_Condominio] || '', classificacao: r[c.Classificacao] || r[c.Classificacao_Anbima] || '', exclusivo: r[c.Exclusivo] || '', publico: r[c.Publico_Alvo] || '', tributacaoLP: r[c.Tributacao_Longo_Prazo] || '' };
    classePorId.set(o.idReg, o);
    const ex = classes.get(o.cnpj); if (ex) duplicadas++;
    if (!ex || (o.situacao === 'Em Funcionamento Normal' && ex.situacao !== 'Em Funcionamento Normal') || (o.situacao === ex.situacao && o.inicio > ex.inicio)) classes.set(o.cnpj, o);
  }
  const subs = new Map();
  for (const r of sub.linhas) { const s = sub.ix; subs.set(String(r[s.ID_Subclasse]).trim().toUpperCase(), { idClasse: r[s.ID_Registro_Classe], nome: r[s.Denominacao_Social], situacao: r[s.Situacao], condominio: r[s.Forma_Condominio] || '', exclusivo: r[s.Exclusivo] || '', publico: r[s.Publico_Alvo] || '', previdenciario: r[s.Previdenciario] === 'S' }); }
  return { fundos, fundoPorCnpj, classes, classePorId, subs, duplicadas };
}

// informe diário de vários meses → mapa por (cnpj, sub)
export function informes(bufsZip, hoje) {
  const por = new Map(); let linhas = 0, descartadas = 0, futuras = 0;
  for (const zb of bufsZip) {
    for (const [, csv] of lerZip(zb)) {
      const t = tabela(csv, ['CNPJ_FUNDO_CLASSE', 'DT_COMPTC', 'VL_QUOTA', 'VL_PATRIM_LIQ', 'CAPTC_DIA', 'RESG_DIA', 'NR_COTST']); const x = t.ix; const temSub = 'ID_SUBCLASSE' in x;
      for (const r of t.linhas) {
        linhas++; const dt = r[x.DT_COMPTC]; if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { descartadas++; continue; } if (dt > hoje) { futuras++; continue; }
        const cnpj = so(r[x.CNPJ_FUNDO_CLASSE]); const sub = temSub ? String(r[x.ID_SUBCLASSE] || '').trim().toUpperCase() : '';
        const id = F.idFundo(cnpj, sub); if (!id) { descartadas++; continue; }
        const cota = F.normCota(r[x.VL_QUOTA]);
        if (!por.has(id)) por.set(id, { id, cnpj, sub, tp: String(r[x.TP_FUNDO_CLASSE] || '').trim(), dias: new Map() });
        por.get(id).dias.set(dt, [dt, cota, num2(r[x.VL_PATRIM_LIQ]), num2(r[x.CAPTC_DIA]), num2(r[x.RESG_DIA]), Number.isInteger(Number(r[x.NR_COTST])) ? Number(r[x.NR_COTST]) : null]);
      }
    }
  }
  return { por, linhas, descartadas, futuras };
}

export function gerarFundos({ cadastroZip, informesZip, hoje, coleta, catalogo, diasDiario = 35, diasIndice = 62 }) {
  const C = cadastro(cadastroZip); const I = informes(informesZip, hoje);
  let competencia = ''; const ultimas = new Map();
  for (const f of I.por.values()) { let u = ''; for (const d of f.dias.keys()) { if (d > competencia) competencia = d; if (d > u) u = d; } ultimas.set(u, (ultimas.get(u) || 0) + 1); }
  // data de referência da base = a última data informada pela MAIORIA dos fundos (alguns informam um dia a mais)
  const dataBase = [...ultimas.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0];
  const corte = new Date(Date.parse(competencia) - diasDiario * 864e5).toISOString().slice(0, 10);
  const cnpjsComSub = new Set([...I.por.values()].filter((f) => f.sub).map((f) => f.cnpj));
  const listadosCatalogo = new Set(((catalogo && catalogo.itens) || []).filter((a) => ['fii', 'etf'].includes(a.classe) && a.ids && a.ids.cnpj).map((a) => a.ids.cnpj));
  const itens = []; const shards = {}; const conta = { semInformeRecente: 0, semCadastro: 0, semCotaValida: 0, agregados: 0, listados: 0, defasados: 0, subclasses: 0, subSemCadastro: 0 };
  const SIT = { 'Em Funcionamento Normal': 'N', 'Fase Pré-Operacional': 'P', 'Em Liquidação': 'L', 'Cancelado': 'C' };
  const PUB = { 'Público Geral': 'G', 'Qualificado': 'Q', 'Profissional': 'R' };
  const COND = { Aberto: 'A', Fechado: 'F' };
  const corteIndice = new Date(Date.parse(competencia) - diasIndice * 864e5).toISOString().slice(0, 10);
  for (const f of [...I.por.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const dias = [...f.dias.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!dias.length || dias[dias.length - 1][0] < corteIndice) { conta.semInformeRecente++; continue; } // parou de informar (encerrado/incorporado): fora do índice
    const cl = C.classes.get(f.cnpj); const fu = C.fundoPorCnpj.get(f.cnpj); const sb = f.sub ? C.subs.get(f.sub) : null;
    if (!cl && !fu) conta.semCadastro++;
    if (f.sub) { conta.subclasses++; if (!sb) conta.subSemCadastro++; }
    const base = cl || (fu ? { nome: fu.nome, tipo: fu.tipo, situacao: fu.situacao, condominio: '', classificacao: '', exclusivo: '', publico: '', tributacaoLP: '' } : { nome: '(sem cadastro na CVM)', tipo: f.tp.replace(/^CLASSES? - /, ''), situacao: '', condominio: '', classificacao: '', exclusivo: '', publico: '', tributacaoLP: '' });
    const nome = (sb && sb.nome) || base.nome;
    const tipo = base.tipo || '';
    const listado = ['FII', 'FIIM', 'FIAGRO'].includes(tipo) || listadosCatalogo.has(f.cnpj);
    const agregado = !f.sub && cnpjsComSub.has(f.cnpj);
    const validas = dias.filter((d) => d[1] != null && F.dec(d[1]) > 0n);
    if (!validas.length) conta.semCotaValida++;
    const ult = validas.length ? validas[validas.length - 1][0] : dias[dias.length - 1][0];
    const defasado = (Date.parse(dataBase) - Date.parse(ult)) / 864e5 > 5; // sem cota até 5 dias antes da data-base
    if (agregado) conta.agregados++; if (listado) conta.listados++; if (defasado) conta.defasados++;
    const flags = (listado ? 'L' : '') + (agregado ? 'A' : '') + (sb && sb.previdenciario ? 'P' : '') + (defasado ? 'D' : '');
    const sit = (sb && sb.situacao) || base.situacao || '';
    const trib = { S: 'S', N: 'N' }[base.tributacaoLP] || '';
    itens.push([f.id, String(nome).replace(/\s+/g, ' ').trim().slice(0, 90), tipo, base.classificacao || '', COND[(sb && sb.condominio) || base.condominio] || '', SIT[sit] || (sit ? 'O' : ''), PUB[(sb && sb.publico) || base.publico] || '', (sb && sb.exclusivo) || base.exclusivo || '', trib, ult, flags]);
    // histórico compacto: d = [data, cota] dos dias recentes; u = último dia completo; m = por mês [AAAA-MM, último dia, cota, PL, captação, resgate, cotistas]
    const d = validas.filter((x) => x[0] >= corte).map((x) => [x[0], x[1]]);
    const meses = new Map();
    for (const x of dias) { const k = x[0].slice(0, 7); const o = meses.get(k) || [k, null, null, null, 0, 0, null]; if (x[1] != null && F.dec(x[1]) > 0n) { o[1] = x[0]; o[2] = x[1]; o[3] = x[2] == null ? null : Math.round(x[2]); o[6] = x[5]; } o[4] += x[3] || 0; o[5] += x[4] || 0; meses.set(k, o); }
    const m = [...meses.values()].filter((o) => o[1]).map((o) => { o[4] = Math.round(o[4]); o[5] = Math.round(o[5]); return o; }).slice(-14);
    const uu = validas.length ? validas[validas.length - 1] : null;
    // âncoras da rentabilidade, calculadas aqui com o diário completo: última cota até a data-alvo (com tolerância)
    const ancora = (alvo, tol) => { let r = null; for (const x of validas) if (x[0] <= alvo) r = x; return r && (Date.parse(alvo) - Date.parse(r[0])) / 864e5 <= tol ? [r[0], r[1]] : null; };
    const a = {};
    if (uu) { const ref = uu[0]; const y = +ref.slice(0, 4), mo = +ref.slice(5, 7);
      const fimMesAnt = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10); const fimAnoAnt = (y - 1) + '-12-31';
      const dd = Math.min(+ref.slice(8, 10), new Date(Date.UTC(y - 1, mo, 0)).getUTCDate()); const m12 = `${y - 1}-${ref.slice(5, 7)}-${String(dd).padStart(2, '0')}`;
      const x1 = ancora(fimMesAnt, 7), x2 = ancora(fimAnoAnt, 10), x3 = ancora(m12, 10); if (x1) a.mes = x1; if (x2) a.ano = x2; if (x3) a.m12 = x3; }
    const arq = F.arqShard(f.id);
    (shards[arq] = shards[arq] || { formato: 'eagles-inv-fundos-hist-v1', fonte: 'cvm_fundos', licenca: F.LICENCA, atribuicao: F.ATRIBUICAO, competencia, coleta, campos: { a: 'âncoras da rentabilidade { mes, ano, m12: [data, cota] }', d: ['data', 'cota'], u: ['data', 'cota', 'pl', 'captacao', 'resgate', 'cotistas'], m: ['mes', 'ultimoDia', 'cota', 'plFim', 'captacaoMes', 'resgateMes', 'cotistasFim'] }, fundos: {} }).fundos[f.id] = { d, u: uu, m, a };
  }
  const indice = { formato: 'eagles-inv-fundos-indice-v1', fonte: 'cvm_fundos', licenca: F.LICENCA, atribuicao: F.ATRIBUICAO,
    transformacoes: 'Junção do Cadastro de Fundos (registro de fundo, classe e subclasse) com o Informe Diário pela chave (CNPJ da classe, ID da subclasse); nomes encurtados; códigos curtos (situação N/P/L/C/O, público G/Q/R, condomínio A/F); cota mantida como texto decimal; histórico: cotas diárias das últimas ~5 semanas, o último dia completo e um resumo por mês (cota e PL do último dia, captação e resgate somados, cotistas); classes sem informe nos últimos 62 dias ficam fora do índice. Base derivada aberta sob ODbL.',
    competencia, dataBase, coleta, campos: F.CAMPOS, itens, contagem: Object.assign({ chaves: itens.length, cnpjs: new Set(itens.map((l) => l[0].slice(9, 23))).size, linhasInforme: I.linhas, descartadas: I.descartadas, futuras: I.futuras, classesDuplicadasNoCadastro: C.duplicadas }, conta) };
  for (const s of Object.values(shards)) s.competencia = competencia;
  return { indice, shards };
}

// ---------- FII: informe mensal (geral + complemento) ----------
export function gerarFII({ zips, hoje, coleta, catalogo }) {
  const geral = new Map(); const comp = new Map();
  const melhor = (m, k, v, ver) => { const ex = m.get(k); if (!ex || ver > ex._v) m.set(k, Object.assign(v, { _v: ver })); };
  for (const zb of zips) for (const [nome, csv] of lerZip(zb)) {
    if (/geral/.test(nome)) { const t = tabela(csv, ['CNPJ_Fundo_Classe', 'Data_Referencia', 'Versao', 'Nome_Fundo_Classe', 'Codigo_ISIN', 'Segmento_Atuacao', 'Mandato', 'Mercado_Negociacao_Bolsa']); const x = t.ix;
      for (const r of t.linhas) { const dt = r[x.Data_Referencia]; if (!/^\d{4}-\d{2}-01$/.test(dt) || dt > hoje) continue; melhor(geral, so(r[x.CNPJ_Fundo_Classe]) + '|' + dt, { cnpj: so(r[x.CNPJ_Fundo_Classe]), dt, nome: r[x.Nome_Fundo_Classe], isin: String(r[x.Codigo_ISIN] || '').trim().toUpperCase(), segmento: r[x.Segmento_Atuacao] || '', mandato: r[x.Mandato] || '', bolsa: r[x.Mercado_Negociacao_Bolsa] === 'S' }, Number(r[x.Versao]) || 1); } }
    if (/complemento/.test(nome)) { const t = tabela(csv, ['CNPJ_Fundo_Classe', 'Data_Referencia', 'Versao', 'Total_Numero_Cotistas', 'Patrimonio_Liquido', 'Cotas_Emitidas', 'Valor_Patrimonial_Cotas']); const x = t.ix;
      for (const r of t.linhas) { const dt = r[x.Data_Referencia]; if (!/^\d{4}-\d{2}-01$/.test(dt) || dt > hoje) continue;
        melhor(comp, so(r[x.CNPJ_Fundo_Classe]) + '|' + dt, { cnpj: so(r[x.CNPJ_Fundo_Classe]), dt, cotistas: numF(r[x.Total_Numero_Cotistas]), pl: num2(r[x.Patrimonio_Liquido]), cotas: numF(r[x.Cotas_Emitidas]), vpa: numF(r[x.Valor_Patrimonial_Cotas]),
          rentEfetiva: numF(r[x.Percentual_Rentabilidade_Efetiva_Mes]), rentPatrimonial: numF(r[x.Percentual_Rentabilidade_Patrimonial_Mes]), dy: numF(r[x.Percentual_Dividend_Yield_Mes]), taxaAdm: numF(r[x.Percentual_Despesas_Taxa_Administracao]), amortizacao: numF(r[x.Percentual_Amortizacao_Cotas_Mes]) }, Number(r[x.Versao]) || 1); } }
  }
  const porIsin = new Map(); const porCnpj = new Map();
  for (const a of ((catalogo && catalogo.itens) || []).filter((a) => a.classe === 'fii')) { if (a.ids && a.ids.isin) porIsin.set(a.ids.isin, a.assetId); if (a.ids && a.ids.cnpj) porCnpj.set(a.ids.cnpj, a.assetId); }
  const fundos = {}; let competencia = '';
  const fimMes = (dt) => new Date(Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7), 0)).toISOString().slice(0, 10);
  for (const c of comp.values()) {
    if (!(c.pl != null)) continue;
    const g = geral.get(c.cnpj + '|' + c.dt) || {};
    const f = (fundos[c.cnpj] = fundos[c.cnpj] || { cnpj: c.cnpj, nome: '', isin: '', segmento: '', mandato: '', bolsa: false, assetId: null, historico: [] });
    if (g.nome) Object.assign(f, { nome: String(g.nome).slice(0, 110), isin: g.isin, segmento: g.segmento, mandato: g.mandato, bolsa: g.bolsa });
    f.assetId = porIsin.get(f.isin) || porCnpj.get(c.cnpj) || f.assetId;
    // VPA: o informado; se ausente, PL ÷ cotas (marcado como calculado). Nunca chamado de cotação.
    let vpa = c.vpa > 0 ? c.vpa : null; let vpaCalc = false; if (!vpa && c.pl > 0 && c.cotas > 0) { vpa = Math.round((c.pl / c.cotas) * 1e6) / 1e6; vpaCalc = true; }
    const f6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
    f.historico.push({ competencia: c.dt.slice(0, 7), competenciaFim: fimMes(c.dt), pl: c.pl == null ? null : Math.round(c.pl), cotas: c.cotas, vpa, vpaCalculado: vpaCalc || undefined, cotistas: c.cotistas, rentEfetiva: f6(c.rentEfetiva), rentPatrimonial: f6(c.rentPatrimonial), dy: f6(c.dy), taxaAdm: f6(c.taxaAdm), amortizacao: c.amortizacao ? f6(c.amortizacao) : undefined });
    if (fimMes(c.dt) > competencia) competencia = fimMes(c.dt);
  }
  for (const f of Object.values(fundos)) { f.historico.sort((a, b) => (a.competencia < b.competencia ? -1 : 1)); f.historico = f.historico.slice(-13).map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v != null))); }
  const sem = Object.values(fundos).filter((f) => !f.assetId).length;
  return { formato: 'eagles-inv-fii-mensal-v1', fonte: 'cvm_fii', licenca: F.LICENCA, atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Informe Mensal de FII', competencia: competencia > hoje ? hoje : competencia, coleta,
    transformacoes: 'Versão mais recente de cada entrega; VPA informado (ou PL ÷ cotas, marcado); percentuais da CVM guardados como fração (0,01 = 1%); vínculo com o catálogo por ISIN e depois CNPJ. VPA é valor patrimonial, NÃO é cotação.',
    contagem: { fundos: Object.keys(fundos).length, semVinculoNoCatalogo: sem }, fundos };
}
