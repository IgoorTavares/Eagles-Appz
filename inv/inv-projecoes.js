/* =====================================================================
   Investimentos · Etapa 09 — Projeções e simuladores: CÁLCULOS PUROS
   (sem tela, sem banco, sem rede; navegador e Node). Matemática financeira
   determinística a partir de PREMISSAS informadas pela pessoa. Não usa
   nenhum indicador (CDI, IPCA...) automaticamente e NÃO altera carteira.
   Convenções: taxas anuais em fração (0,10 = 10% a.a.), convertidas para
   mensais por juros compostos ((1+a)^(1/12) − 1); valores em reais (número
   de ponto flutuante) e arredondados a centavos só na saída. Projeção é
   estimativa, não garantia.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.projecoes = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const c2 = (x) => Math.round(x * 100) / 100;
  const mensal = (anual) => Math.pow(1 + (anual || 0), 1 / 12) - 1;

  // limites de sanidade das premissas (a tela e os cenários salvos passam por aqui)
  const LIMITES = {
    patrimonioInicial: [0, 1e10], aporteMensal: [0, 1e8], reajusteAnualAporte: [-0.5, 1], meses: [1, 1200],
    valorizacaoAnual: [-0.5, 1], dyAnual: [0, 0.5], inflacaoAnual: [-0.1, 1], taxaAdmAnual: [0, 0.1],
    aliquotaIRProventos: [0, 0.5], aliquotaIRGanho: [0, 0.5], custoAporte: [0, 0.1],
  };
  function validar(pr) {
    const e = [];
    for (const [k, [min, max]] of Object.entries(LIMITES)) {
      const v = pr[k]; if (v == null) continue;
      if (typeof v !== 'number' || !isFinite(v) || v < min || v > max) e.push(`${k} fora do intervalo (${min} a ${max})`);
    }
    if (!(pr.meses >= 1)) e.push('prazo: pelo menos 1 mês');
    for (const x of pr.aportesExtras || []) if (!(x && x.mes >= 1 && x.mes <= 1200 && x.valor >= -1e10 && x.valor <= 1e10)) e.push('aporte extraordinário inválido');
    if ((pr.aportesExtras || []).length > 60) e.push('até 60 aportes extraordinários');
    return { ok: !e.length, erros: e };
  }

  /* Simulação mês a mês. Premissas (todas informadas pela pessoa):
     patrimonioInicial, aporteMensal, reajusteAnualAporte (reajuste do aporte a cada 12 meses), aportesExtras [{mes, valor}]
     (valor negativo = retirada), meses, valorizacaoAnual (valorização do patrimônio, sem proventos), dyAnual (proventos/ano),
     reinvestir (proventos voltam para a carteira ou viram renda), inflacaoAnual, taxaAdmAnual (custos anuais sobre o
     patrimônio), aliquotaIRProventos (IR sobre os proventos, ex.: 15% de JCP; 0 para dividendos isentos), aliquotaIRGanho
     (IR estimado sobre o ganho, cobrado no fim), custoAporte (corretagem/custo de entrada em % de cada aporte). */
  function projetar(pr) {
    const v = validar(pr); if (!v.ok) throw new Error('Premissas inválidas: ' + v.erros.join('; '));
    const iV = mensal(pr.valorizacaoAnual), iDy = mensal(pr.dyAnual), adm = mensal(pr.taxaAdmAnual), inf = mensal(pr.inflacaoAnual);
    const reinv = pr.reinvestir !== false; const extras = new Map();
    for (const x of pr.aportesExtras || []) extras.set(x.mes, (extras.get(x.mes) || 0) + x.valor);
    let P = pr.patrimonioInicial || 0; let aportado = P; let pmt = pr.aporteMensal || 0;
    let proventos = 0, rendaRetirada = 0, custos = 0, irProventos = 0, valorizacao = 0;
    const serie = [{ mes: 0, nominal: P, real: P, aportado, proventos: 0, custos: 0 }];
    for (let k = 1; k <= pr.meses; k++) {
      if (k > 1 && (k - 1) % 12 === 0 && pr.reajusteAnualAporte) pmt *= 1 + pr.reajusteAnualAporte;
      const val = P * iV; const prov = P * iDy; const ir = prov * (pr.aliquotaIRProventos || 0); const custo = P * adm;
      const entrada = pmt + (extras.get(k) || 0); const custoEntrada = entrada > 0 ? entrada * (pr.custoAporte || 0) : 0;
      P = P + val - custo + (reinv ? prov - ir : 0) + entrada - custoEntrada;
      if (P < 0) P = 0; // retirada maior que o patrimônio: zera (a tela avisa)
      valorizacao += val; proventos += prov; irProventos += ir; custos += custo + custoEntrada; aportado += entrada;
      if (!reinv) rendaRetirada += prov - ir;
      serie.push({ mes: k, nominal: P, real: P / Math.pow(1 + inf, k), aportado, proventos, custos });
    }
    const ganho = P - aportado; const irGanho = Math.max(0, ganho) * (pr.aliquotaIRGanho || 0);
    const liquido = P - irGanho; const deflator = Math.pow(1 + inf, pr.meses);
    return {
      serie, meses: pr.meses, nominal: c2(P), real: c2(P / deflator), aportado: c2(aportado), ganho: c2(ganho), valorizacao: c2(valorizacao),
      proventos: c2(proventos), proventosLiquidos: c2(proventos - irProventos), rendaRetirada: c2(rendaRetirada), custos: c2(custos),
      impostos: c2(irProventos + irGanho), irGanho: c2(irGanho), irProventos: c2(irProventos), liquido: c2(liquido), liquidoReal: c2(liquido / deflator),
      // renda mensal que o patrimônio final paga só com os proventos (líquidos), sem consumir o principal
      rendaMensalProventos: c2(P * iDy * (1 - (pr.aliquotaIRProventos || 0))),
      zerou: serie.some((s, i) => i > 0 && s.nominal === 0),
    };
  }
  // fórmula fechada (conferência dos testes): VF = P0(1+i)^n + PMT·((1+i)^n − 1)/i
  function valorFuturo(p0, pmt, i, n) { const f = Math.pow(1 + i, n); return i === 0 ? p0 + pmt * n : p0 * f + pmt * (f - 1) / i; }

  // metas: em quantos meses o patrimônio (nominal ou real) chega ao alvo; null se não chega em 100 anos
  function mesesParaMeta(alvo, pr, op = {}) {
    const r = projetar(Object.assign({}, pr, { meses: 1200 }));
    const k = r.serie.findIndex((s) => (op.real ? s.real : s.nominal) >= alvo);
    return k < 0 ? null : k;
  }
  // patrimônio necessário para uma renda mensal (líquida) vivendo só dos proventos, ou com uma taxa de retirada anual
  function patrimonioParaRenda(rendaMensal, pr, op = {}) {
    if (op.taxaRetiradaAnual) { const m = mensal(op.taxaRetiradaAnual); return m > 0 ? c2(rendaMensal / m) : null; }
    const m = mensal(pr.dyAnual) * (1 - (pr.aliquotaIRProventos || 0)); return m > 0 ? c2(rendaMensal / m) : null;
  }

  // cenários: a mesma premissa com três valorizações (informadas pela pessoa)
  function cenarios(pr, taxas) {
    return ['pessimista', 'moderado', 'otimista'].filter((k) => taxas[k] != null).map((k) => Object.assign({ cenario: k, valorizacaoAnual: taxas[k] }, projetar(Object.assign({}, pr, { valorizacaoAnual: taxas[k] }))));
  }
  // comparação de estratégias: cada uma com as suas premissas (mesmo prazo para comparar)
  function compararEstrategias(lista) {
    const meses = Math.max(...lista.map((e) => e.premissas.meses));
    return lista.map((e) => Object.assign({ nome: e.nome }, projetar(Object.assign({}, e.premissas, { meses }))));
  }
  // projeção por classe/ativo: cada linha com valor atual e premissas próprias; o total é a soma
  function porClasse(linhas, comum) {
    const r = linhas.map((l) => Object.assign({ chave: l.chave, rotulo: l.rotulo || l.chave },
      projetar(Object.assign({}, comum, { patrimonioInicial: l.valor, aporteMensal: l.aporteMensal || 0, valorizacaoAnual: l.valorizacaoAnual, dyAnual: l.dyAnual || 0, aportesExtras: [] }))));
    const total = r.reduce((s, x) => ({ nominal: s.nominal + x.nominal, real: s.real + x.real, aportado: s.aportado + x.aportado }), { nominal: 0, real: 0, aportado: 0 });
    return { linhas: r, total: { nominal: c2(total.nominal), real: c2(total.real), aportado: c2(total.aportado) } };
  }

  /* rebalanceamento SIMULADO (não cria operação nenhuma):
     itens [{chave, valor}], alvoPct {chave: %} (soma 100), aporte (novo dinheiro).
     somenteCompras = true: distribui o aporte só nas classes abaixo do alvo (sem vender); senão, mostra compras e vendas. */
  function rebalancear(itens, alvoPct, aporte = 0, op = {}) {
    const soma = Object.values(alvoPct).reduce((s, x) => s + (+x || 0), 0);
    if (Math.abs(soma - 100) > 0.01) return { ok: false, erro: `Os percentuais-alvo somam ${c2(soma)}%, precisam somar 100%.` };
    const chaves = [...new Set([...itens.map((x) => x.chave), ...Object.keys(alvoPct)])];
    const atual = Object.fromEntries(chaves.map((k) => [k, (itens.find((x) => x.chave === k) || {}).valor || 0]));
    const total = Object.values(atual).reduce((s, x) => s + x, 0) + aporte;
    const alvo = Object.fromEntries(chaves.map((k) => [k, (total * (alvoPct[k] || 0)) / 100]));
    let ordens;
    if (op.somenteCompras) {
      const falta = Object.fromEntries(chaves.map((k) => [k, Math.max(0, alvo[k] - atual[k])]));
      const somaFalta = Object.values(falta).reduce((s, x) => s + x, 0);
      ordens = chaves.map((k) => ({ chave: k, atual: c2(atual[k]), alvo: c2(alvo[k]), ordem: c2(somaFalta > 0 ? (aporte * falta[k]) / somaFalta : (aporte * (alvoPct[k] || 0)) / 100) }));
      // ajusta o arredondamento para a soma das compras bater com o aporte
      const dif = c2(aporte - ordens.reduce((s, o) => s + o.ordem, 0)); if (dif && ordens.length) { const m = ordens.reduce((a, b) => (b.ordem > a.ordem ? b : a)); m.ordem = c2(m.ordem + dif); }
    } else ordens = chaves.map((k) => ({ chave: k, atual: c2(atual[k]), alvo: c2(alvo[k]), ordem: c2(alvo[k] - atual[k]) }));
    ordens.forEach((o) => { o.depois = c2(o.atual + o.ordem); o.pctDepois = total > 0 ? c2((o.depois / total) * 100) : 0; });
    return { ok: true, total: c2(total), ordens };
  }

  // cenário salvo: só premissas (nenhum dado da carteira), com nome — conferido antes de gravar
  const CENARIO_MAX = 20;
  function cenarioValido(c) {
    return !!c && typeof c.id === 'string' && c.id.length <= 40 && typeof c.nome === 'string' && c.nome.trim().length >= 1 && c.nome.length <= 60 && c.premissas && validar(c.premissas).ok;
  }

  return { LIMITES, mensal, validar, projetar, valorFuturo, mesesParaMeta, patrimonioParaRenda, cenarios, compararEstrategias, porClasse, rebalancear, CENARIO_MAX, cenarioValido, c2 };
});
