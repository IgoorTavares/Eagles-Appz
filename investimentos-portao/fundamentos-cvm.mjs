// Investimentos · EAGLES DATA ENGINE — fundamentos das companhias abertas a partir dos arquivos OFICIAIS da CVM (ODbL)
// DFP (anual) e ITR (trimestral). Regras:
//  - SÓ demonstrações CONSOLIDADAS (arquivos *_con_*); individuais nunca entram nem se misturam.
//  - Versão mais recente de cada entrega (maior VERSAO por empresa e data de referência).
//  - Para um mesmo ano, vale o número da entrega MAIS NOVA (o "penúltimo exercício" da DFP seguinte traz as revisões).
//  - Conta escolhida pelo código E pela descrição oficial (bancos e seguradoras têm plano diferente); sem a conta certa, o
//    valor fica null (nunca zero). Indicadores (margem, ROE, crescimento) só com os dois lados presentes e períodos iguais.
//  - P/L, P/VP e outros que dependem de preço NÃO são calculados (sem cotação autorizada).
import { lerZip } from './importar.mjs';

const ESCALA = { MIL: 1000, UNIDADE: 1 };
const RX = {
  lucro: /^Lucro(\/| ou )Preju[ií]zo( L[ií]quido)? Consolidado do Per[ií]odo$/i,
  pl: /^Patrim[oô]nio L[ií]quido Consolidado$/i,
  divida: /^Empr[eé]stimos e Financiamentos$/i,
};
const profundidade = (c) => String(c).split('.').length;
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const digitos = (s) => String(s || '').replace(/\D/g, '');

// lê um CSV da CVM (latin1, ';'), devolvendo só as linhas que passam no filtro, já como objetos
function linhasCsv(buf, filtro) {
  const txt = buf.toString('latin1'); const linhas = txt.split(/\r?\n/);
  const cab = linhas[0].split(';'); const ix = Object.fromEntries(cab.map((c, i) => [c.trim(), i]));
  for (const c of ['CNPJ_CIA', 'DT_REFER', 'VERSAO', 'ESCALA_MOEDA', 'ORDEM_EXERC', 'DT_FIM_EXERC', 'CD_CONTA', 'DS_CONTA', 'VL_CONTA']) if (!(c in ix)) throw new Error('CVM: coluna ausente ' + c);
  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i]; if (!l) continue;
    const c = l.split(';');
    const conta = c[ix.CD_CONTA];
    if (!filtro(conta, c[ix.DS_CONTA])) continue;
    const esc = ESCALA[String(c[ix.ESCALA_MOEDA]).trim().toUpperCase()];
    const v = Number(c[ix.VL_CONTA]);
    if (!esc || !Number.isFinite(v)) continue;
    out.push({ cnpj: digitos(c[ix.CNPJ_CIA]), nome: c[ix.DENOM_CIA], ref: c[ix.DT_REFER], versao: Number(c[ix.VERSAO]) || 1, ordem: String(c[ix.ORDEM_EXERC]).toUpperCase().startsWith('Ú') || /^.LTIMO$/i.test(c[ix.ORDEM_EXERC]) ? 'ULTIMO' : 'PENULTIMO',
      ini: 'DT_INI_EXERC' in ix ? c[ix.DT_INI_EXERC] : null, fim: c[ix.DT_FIM_EXERC], conta, ds: String(c[ix.DS_CONTA]).trim(), valor: v * esc });
  }
  return out;
}
// mantém só a versão mais recente de cada (empresa, data de referência)
function ultimaVersao(regs) {
  const max = new Map();
  for (const r of regs) { const k = r.cnpj + '|' + r.ref; if (!max.has(k) || r.versao > max.get(k)) max.set(k, r.versao); }
  return regs.filter((r) => r.versao === max.get(r.cnpj + '|' + r.ref));
}

function lerDemonstracoes(zipBuf, tipo) {
  const arqs = lerZip(zipBuf); const pega = (re) => { for (const [n, b] of arqs) if (re.test(n)) return b; return null; };
  const dre = pega(new RegExp(`^${tipo}_cia_aberta_DRE_con_\\d{4}\\.csv$`)); const bpa = pega(new RegExp(`^${tipo}_cia_aberta_BPA_con_\\d{4}\\.csv$`));
  const bpp = pega(new RegExp(`^${tipo}_cia_aberta_BPP_con_\\d{4}\\.csv$`)); const dfcMi = pega(new RegExp(`^${tipo}_cia_aberta_DFC_MI_con_\\d{4}\\.csv$`)); const dfcMd = pega(new RegExp(`^${tipo}_cia_aberta_DFC_MD_con_\\d{4}\\.csv$`));
  if (!dre || !bpa || !bpp) throw new Error(`CVM ${tipo.toUpperCase()}: arquivos consolidados não encontrados no zip`);
  return {
    dre: ultimaVersao(linhasCsv(dre, (c, d) => c === '3.01' || (c.startsWith('3.') && profundidade(c) === 2 && RX.lucro.test(String(d).trim())))),
    bpa: ultimaVersao(linhasCsv(bpa, (c) => c === '1')),
    bpp: ultimaVersao(linhasCsv(bpp, (c, d) => c === '2' || (profundidade(c) === 2 && RX.pl.test(String(d).trim())) || (profundidade(c) === 3 && (c.startsWith('2.01.') || c.startsWith('2.02.')) && RX.divida.test(String(d).trim())))),
    dfc: ultimaVersao([...(dfcMi ? linhasCsv(dfcMi, (c) => c === '6.01') : []), ...(dfcMd ? linhasCsv(dfcMd, (c) => c === '6.01') : [])]),
  };
}

// monta os anos a partir das DFPs (a entrega mais nova vence para cada ano); trimestres pelas ITRs (só períodos de ~3 meses)
export function fundamentosCVM({ dfps = [], itrs = [], cnpjs = null, coleta = new Date().toISOString() }) {
  const anos = new Map(); // cnpj → Map(ano → {..., refEntrega})
  const nomes = new Map();
  const quer = (cnpj) => !cnpjs || cnpjs.has(cnpj);
  for (const buf of dfps) {
    const d = lerDemonstracoes(buf, 'dfp');
    const put = (cnpj, ano, ref, campo, valor) => {
      if (!quer(cnpj)) return;
      if (!anos.has(cnpj)) anos.set(cnpj, new Map());
      const m = anos.get(cnpj); const atual = m.get(ano);
      if (atual && atual._ref > ref) return; // já tem número de entrega mais nova para este ano
      if (!atual || atual._ref < ref) m.set(ano, { ano, _ref: ref });
      m.get(ano)[campo] = valor;
    };
    for (const r of d.dre) {
      nomes.set(r.cnpj, r.nome);
      if (!r.ini || Math.abs(dias(r.ini, r.fim) - 364) > 10) continue; // exercício de 12 meses
      const ano = r.fim.slice(0, 4);
      if (r.conta === '3.01') put(r.cnpj, ano, r.ref, 'receita', r.valor); else put(r.cnpj, ano, r.ref, 'lucro', r.valor);
    }
    for (const r of d.bpa) put(r.cnpj, r.fim.slice(0, 4), r.ref, 'ativo', r.valor);
    const dividas = new Map();
    for (const r of d.bpp) {
      const ano = r.fim.slice(0, 4);
      if (r.conta === '2') put(r.cnpj, ano, r.ref, 'passivoTotal', r.valor);
      else if (profundidade(r.conta) === 2) put(r.cnpj, ano, r.ref, 'pl', r.valor);
      else { const k = r.cnpj + '|' + ano + '|' + r.ref; dividas.set(k, (dividas.get(k) || 0) + r.valor); }
    }
    for (const [k, v] of dividas) { const [cnpj, ano, ref] = k.split('|'); const m = anos.get(cnpj); if (m && m.get(ano) && m.get(ano)._ref === ref) m.get(ano).divida = v; }
    for (const r of d.dfc) { if (r.ini && Math.abs(dias(r.ini, r.fim) - 364) <= 10) put(r.cnpj, r.fim.slice(0, 4), r.ref, 'fco', r.valor); }
  }
  const trimestres = new Map();
  for (const buf of itrs) {
    const d = lerDemonstracoes(buf, 'itr');
    for (const r of d.dre) {
      if (!quer(r.cnpj) || r.ordem !== 'ULTIMO' || !r.ini) continue;
      const dd = dias(r.ini, r.fim); if (dd < 85 || dd > 95) continue; // só o trimestre (não o acumulado do ano)
      if (!trimestres.has(r.cnpj)) trimestres.set(r.cnpj, new Map());
      const k = r.ini + '|' + r.fim; const t = trimestres.get(r.cnpj).get(k) || { inicio: r.ini, fim: r.fim };
      if (r.conta === '3.01') t.receita = r.valor; else t.lucro = r.valor;
      trimestres.get(r.cnpj).set(k, t); nomes.set(r.cnpj, nomes.get(r.cnpj) || r.nome);
    }
  }
  const empresas = {};
  const div = (a, b) => (a != null && b != null && b !== 0 ? Math.round((a / b) * 10000) / 100 : null);
  for (const [cnpj, m] of anos) {
    const lista = [...m.values()].sort((a, b) => (a.ano < b.ano ? -1 : 1)).map((x) => {
      const o = { ano: x.ano, entrega: x._ref, receita: x.receita ?? null, lucro: x.lucro ?? null, ativo: x.ativo ?? null, pl: x.pl ?? null, divida: x.divida ?? null, fco: x.fco ?? null };
      o.passivo = x.passivoTotal != null && x.pl != null ? x.passivoTotal - x.pl : null;
      return o;
    });
    lista.forEach((o, i) => {
      const ant = lista[i - 1] && Number(lista[i - 1].ano) === Number(o.ano) - 1 ? lista[i - 1] : null;
      o.margemLiquida = o.receita > 0 ? div(o.lucro, o.receita) : null;
      o.roe = ant && o.pl != null && ant.pl != null && (o.pl + ant.pl) > 0 ? div(o.lucro, (o.pl + ant.pl) / 2) : null; // PL médio do ano
      o.crescReceita = ant && ant.receita > 0 && o.receita != null ? div(o.receita - ant.receita, ant.receita) : null;
      o.crescLucro = ant && ant.lucro > 0 && o.lucro != null ? div(o.lucro - ant.lucro, ant.lucro) : null; // base negativa: sem crescimento %
    });
    const tri = trimestres.has(cnpj) ? [...trimestres.get(cnpj).values()].sort((a, b) => (a.fim < b.fim ? -1 : 1)).slice(-4) : [];
    if (lista.some((o) => o.receita != null || o.lucro != null)) empresas[cnpj] = { nome: nomes.get(cnpj) || '', anual: lista.slice(-4), trimestral: tri };
  }
  return { formato: 'eagles-inv-fundamentos-br-v1', fonte: 'cvm', atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Portal de Dados Abertos (DFP e ITR, demonstrações consolidadas)', licenca: 'ODbL', transformacoes: 'Contas selecionadas das demonstrações consolidadas; valores convertidos para reais (escala MIL × 1000); margem, ROE (sobre o PL médio) e crescimento calculados pelo Eagles Labz', coleta, empresas };
}
