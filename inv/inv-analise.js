/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — Analytics Engine (Etapa 08)
   Insights e boletins DETERMINÍSTICOS: regras fixas e números conferíveis.
   Sem IA, sem rede. Cada insight diz a REGRA usada e o ESTADO dos dados
   (simulado, manual...). Nada aqui é recomendação de compra ou venda.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.analise = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const pctTxt = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(r2(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const LIM = { ativo: 25, top3: 60, setor: 40, cambioAlto: 50, movimento: 3, hhiAlto: 0.25 };

  // av: resultado de INVEST.carteira.avaliar; base: de calcular; ev: de evolucao; mercado: { cdiAA, ibovRet, spxRet, cdiPeriodoPct, estados }
  function insightsCarteira(av, base, ev, mercado, op = {}) {
    const out = []; const est = (av.estados || []).join(', ') || 'indisponível';
    const add = (nivel, tipo, titulo, texto, regra) => out.push({ nivel, tipo, titulo, texto, regra, estado: est });
    // auditoria: só avaliação com preço autorizado ou manual; nada de simulado em carteira real
    if (av.situacao === 'inconsistente') { add('atencao', 'dados', 'Carteira com operações inconsistentes', 'Há venda acima da posição, retirada acima do caixa ou estorno inválido. Corrija com estorno; até lá nenhum cálculo de patrimônio é feito.', 'livro-razão inconsistente'); return out; }
    if (av.situacao === 'indisponivel') { add('info', 'dados', 'Carteira sem avaliação', 'Nenhum ativo tem preço autorizado ou manual. Informe preços manuais (Diretor ou Financeiro) para avaliar.', 'sem preço autorizado ou manual'); return out; }
    if (av.situacao === 'parcial') add('atencao', 'dados', `Avaliação parcial: ${av.cobertura.ativos} de ${av.cobertura.de} ativos (${r1(av.cobertura.custoPct).toLocaleString('pt-BR')}% do custo)`, 'Os pesos abaixo consideram só os ativos com preço autorizado ou manual.', 'cobertura da avaliação < 100%');
    const itens = av.itens.filter((i) => i.valorBRL != null && i.valorBRL > 0);
    if (!itens.length) return out;
    const top = itens[0];
    if (top.peso > LIM.ativo) add('atencao', 'concentracao', `${top.ticker} é ${pctTxt(top.peso).replace('+', '')} da carteira`, `Um único ativo acima de ${LIM.ativo}% concentra o risco da carteira nele.`, `peso do maior ativo > ${LIM.ativo}%`);
    const top3 = itens.slice(0, 3).reduce((s, i) => s + i.peso, 0);
    if (itens.length > 3 && top3 > LIM.top3) add('info', 'concentracao', `Os 3 maiores ativos somam ${r1(top3).toLocaleString('pt-BR')}%`, 'A maior parte do patrimônio está em poucos ativos.', `soma dos 3 maiores > ${LIM.top3}%`);
    const hhi = itens.reduce((s, i) => s + (i.peso / 100) ** 2, 0);
    out.push({ nivel: 'info', tipo: 'diversificacao', titulo: `Equivale a ${r1(1 / hhi).toLocaleString('pt-BR')} ativos de mesmo peso`, texto: `Índice de concentração (HHI) ${r2(hhi).toLocaleString('pt-BR')}: quanto menor, mais diversificada.${hhi > LIM.hhiAlto ? ' Acima de 0,25 é considerado concentrado.' : ''}`, regra: 'HHI = soma dos pesos ao quadrado', estado: est });
    const setores = new Map(); itens.forEach((i) => setores.set(i.setor || 'Sem setor', (setores.get(i.setor || 'Sem setor') || 0) + i.peso));
    const [setorTop, pesoSetor] = [...setores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (pesoSetor > LIM.setor) add('atencao', 'setor', `${r1(pesoSetor).toLocaleString('pt-BR')}% em ${setorTop}`, `Mais de ${LIM.setor}% num setor só: um problema no setor pesa na carteira toda.`, `peso do maior setor > ${LIM.setor}%`);
    if (av.exposicaoCambial == null) { /* sem avaliação completa: exposição cambial não é calculada */ }
    else if (av.exposicaoCambial > LIM.cambioAlto) add('info', 'cambio', `${r1(av.exposicaoCambial).toLocaleString('pt-BR')}% do patrimônio em dólar`, 'A variação do dólar afeta mais da metade da carteira (para cima ou para baixo).', `exposição cambial > ${LIM.cambioAlto}%`);
    else if (av.exposicaoCambial === 0 && itens.length >= 3) add('info', 'cambio', 'Nenhuma exposição ao dólar', 'Todos os ativos com preço estão em reais.', 'exposição cambial = 0%');
    if (ev && ev.twr != null && mercado && mercado.cdiPeriodoPct != null) {
      const d = ev.twr * 100 - mercado.cdiPeriodoPct;
      add(d >= 0 ? 'info' : 'atencao', 'benchmark', `Rentabilidade ${pctTxt(ev.twr * 100)} contra ${pctTxt(mercado.cdiPeriodoPct)} do CDI no mesmo período`, d >= 0 ? `A carteira ficou ${pctTxt(d).replace('+', '')} acima do CDI (pontos percentuais).` : `A carteira ficou ${pctTxt(-d).replace('+', '')} abaixo do CDI (pontos percentuais).`, 'TWR da carteira comparado ao CDI acumulado no mesmo período');
    }
    if (mercado && mercado.ibovRet != null && ev && ev.twr != null) add('info', 'benchmark', `Ibovespa no mesmo período: ${pctTxt(mercado.ibovRet)}`, 'Comparação com o principal índice da bolsa brasileira.', 'retorno do Ibovespa entre a primeira operação e hoje');
    const custo = itens.reduce((s, i) => s + i.custoBRL, 0);
    if (base.proventos > 0 && custo > 0) add('info', 'proventos', `Proventos de ${(base.proventos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} desde o início`, `Equivalem a ${pctTxt((base.proventos / custo) * 100).replace('+', '')} do custo das posições atuais. São lançados por você e entram uma vez só no caixa.`, 'proventos líquidos ÷ custo das posições');
    for (const i of itens) if (op.cotacoes && op.cotacoes[i.assetId] && Math.abs(op.cotacoes[i.assetId].variacaoPct || 0) >= LIM.movimento) { const v = op.cotacoes[i.assetId].variacaoPct; add('atencao', 'movimento', `${i.ticker} ${pctTxt(v)} no dia`, `Variação de ${LIM.movimento}% ou mais em um ativo da carteira.`, `|variação do dia| ≥ ${LIM.movimento}%`); }
    return out;
  }

  // impacto dos indicadores: só descreve o número e o efeito mecânico (sem previsão)
  function insightsIndicadores(macro) {
    const out = []; const q = (k) => macro[k];
    if (q('SELIC') && q('SELIC').preco != null) out.push({ nivel: 'info', tipo: 'indicador', titulo: `Selic em ${q('SELIC').preco.toLocaleString('pt-BR')}% ao ano`, texto: 'Aplicações pós-fixadas (Tesouro Selic, CDBs atrelados ao CDI) acompanham essa taxa; títulos prefixados e com IPCA têm o preço afetado quando os juros mudam.', regra: 'descrição do indicador', estado: q('SELIC').estado });
    if (q('IPCA12M') && q('SELIC') && q('IPCA12M').preco != null) { const real = ((1 + q('SELIC').preco / 100) / (1 + q('IPCA12M').preco / 100) - 1) * 100; out.push({ nivel: 'info', tipo: 'indicador', titulo: `Juro real aproximado: ${r2(real).toLocaleString('pt-BR')}% ao ano`, texto: `Selic de ${q('SELIC').preco.toLocaleString('pt-BR')}% descontada a inflação de 12 meses (${q('IPCA12M').preco.toLocaleString('pt-BR')}%).`, regra: '(1 + Selic) ÷ (1 + IPCA 12m) − 1', estado: q('IPCA12M').estado }); }
    if (q('USDBRL') && q('USDBRL').variacaoPct != null) out.push({ nivel: Math.abs(q('USDBRL').variacaoPct) >= 1 ? 'atencao' : 'info', tipo: 'indicador', titulo: `Dólar ${pctTxt(q('USDBRL').variacaoPct)} no dia`, texto: 'Afeta o valor em reais dos ativos dos EUA e das BDRs.', regra: 'variação do USD/BRL', estado: q('USDBRL').estado });
    return out;
  }

  // alertas configurados pela pessoa: acima / abaixo de um preço, variação do dia
  function avaliarAlertas(alertas, cotacao) {
    const out = [];
    for (const a of alertas || []) {
      if (!a || a.ativo === false) continue;
      const q = cotacao(a.assetId); if (!q || q.preco == null) { out.push({ alerta: a, disparou: false, motivo: 'sem cotação' }); continue; }
      const disp = a.tipo === 'acima' ? q.preco >= a.valor : a.tipo === 'abaixo' ? q.preco <= a.valor : a.tipo === 'variacao' ? Math.abs(q.variacaoPct || 0) >= a.valor : false;
      out.push({ alerta: a, disparou: disp, preco: q.preco, variacaoPct: q.variacaoPct, estado: q.estado });
    }
    return out;
  }
  function validarAlerta(a) {
    return !!a && /^[A-Z]+:[A-Z0-9-]+:[A-Z0-9.\-]+$/.test(a.assetId || '') && ['acima', 'abaixo', 'variacao'].includes(a.tipo) && a.valor > 0 && a.valor < 1e9;
  }

  // boletins por regra: abertura, intradiário e fechamento (o tipo muda o texto; os números vêm do Market Engine)
  function boletim(tipo, dados) {
    const nome = { abertura: 'Boletim de abertura', intradiario: 'Boletim intradiário', fechamento: 'Boletim de fechamento' }[tipo];
    const linhas = []; const fontes = new Set(); const estados = new Set();
    const usa = (q) => { if (q) { fontes.add(q.fonteNome || q.fonte); estados.add(q.estado); } return q; };
    const ind = (dados.indices || []).map(usa).filter((q) => q && q.preco != null);
    if (ind.length) linhas.push((tipo === 'abertura' ? 'Referência do último fechamento: ' : tipo === 'intradiario' ? 'Até agora: ' : 'No fechamento: ') + ind.map((q) => `${q.nome} ${pctTxt(q.variacaoPct || 0)}`).join('; ') + '.');
    const mac = (dados.macro || []).map(usa).filter((q) => q && q.preco != null);
    if (mac.length) linhas.push('Indicadores: ' + mac.map((q) => `${q.nome} ${q.unidade === '%aa' ? q.preco.toLocaleString('pt-BR') + '% a.a.' : q.unidade === '%' ? q.preco.toLocaleString('pt-BR') + '%' : q.unidade === '%am' ? q.preco.toLocaleString('pt-BR') + '% no mês' : q.unidade === 'BRL_MI' ? 'R$ ' + (q.preco / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi' : 'R$ ' + q.preco.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}`).join('; ') + '.');
    const al = (dados.altas || []).slice(0, 3).map(usa), bx = (dados.baixas || []).slice(0, 3).map(usa);
    if (al.length) linhas.push('Maiores altas: ' + al.map((q) => `${q.ticker} ${pctTxt(q.variacaoPct)}`).join(', ') + '.');
    if (bx.length) linhas.push('Maiores baixas: ' + bx.map((q) => `${q.ticker} ${pctTxt(q.variacaoPct)}`).join(', ') + '.');
    if (dados.carteira) linhas.push(`Sua carteira selecionada: ${dados.carteira}.`);
    if (dados.noticias && dados.noticias.length) linhas.push('Notícias: ' + dados.noticias.slice(0, 3).map((n) => n.titulo).join(' · ') + '.');
    return { tipo, titulo: nome, linhas, fontes: [...fontes].filter(Boolean), estados: [...estados], geradoPor: 'regras fixas (sem IA)', simulado: estados.has('simulado') };
  }
  const tipoBoletimAgora = (hora) => (hora < 10 ? 'abertura' : hora < 17 ? 'intradiario' : 'fechamento');

  return { LIM, insightsCarteira, insightsIndicadores, avaliarAlertas, validarAlerta, boletim, tipoBoletimAgora, pctTxt };
});
