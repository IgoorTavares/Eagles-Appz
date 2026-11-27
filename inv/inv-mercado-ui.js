/* =====================================================================
   Investimentos · Etapa 06 — abas Mercado BR e Mercado US (interface nativa)
   Tudo vem do Market Engine (INVEST.mercado) já montado pela página: nenhuma
   leitura no banco para dados de mercado (0 leituras), nada gravado por empresa.
   Cada número aparece com o ESTADO (simulado, manual, atrasado...) e a FONTE.
   ===================================================================== */
(function () {
  'use strict';
  const K = window.INVEST.mercado, G = window.INVEST.graficos;
  const T = (window.INVEST.telas = window.INVEST.telas || {});
  const C = () => window.INVEST.ctx;

  // ---------- formatos ----------
  const nf = (v, c = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
  const valor = (q, a) => {
    if (!q || q.preco == null) return '—';
    const u = (a && a.unidade) || q.unidade;
    if (u === '%aa') return nf(q.preco) + '% a.a.'; if (u === '%') return nf(q.preco) + '%'; if (u === '%am') return nf(q.preco) + '% no mês';
    if (u === 'BRL_MI') return 'R$ ' + nf(q.preco / 1000, 1) + ' bi';
    if (u === 'MIL') return (a && a.ticker === 'PAYROLL' && q.preco > 0 ? '+' : '') + nf(q.preco, 0) + ' mil';
    if (u === 'BRL') return 'R$ ' + nf(q.preco, 4);
    if (q.classe === 'indice') return nf(q.preco, 0) + ' pts';
    return (q.moeda === 'USD' ? 'US$ ' : 'R$ ') + nf(q.preco);
  };
  const casasDe = (a) => (a.classe === 'indice' ? 0 : a.unidade === 'BRL' ? 4 : 2);
  // taxas (% a.a., % no mês, %) variam em PONTOS PERCENTUAIS; "+1% de 4,6%" confundiria
  const ehTaxa = (q, a) => ['%aa', '%am', '%'].includes((a && a.unidade) || (q && q.unidade));
  const varTxt = (q, a) => {
    if (q && ehTaxa(q, a) && q.variacao != null) return `${q.variacao > 0 ? '+' : q.variacao < 0 ? '−' : ''}${nf(Math.abs(q.variacao))} p.p.`;
    return q && q.variacaoPct != null ? `${q.variacaoPct > 0 ? '+' : q.variacaoPct < 0 ? '−' : ''}${nf(Math.abs(q.variacaoPct))}%` : '—';
  };
  const varCls = (q) => (q && q.variacaoPct > 0 ? 'inv-sobe' : q && q.variacaoPct < 0 ? 'inv-desce' : 'inv-neutro');
  const dataHora = (q) => (q && q.data ? q.data.split('-').reverse().join('/') : '—');
  const volTxt = (v) => (v == null ? '—' : v >= 1e9 ? nf(v / 1e9, 1) + ' bi' : v >= 1e6 ? nf(v / 1e6, 1) + ' mi' : v >= 1e3 ? nf(v / 1e3, 0) + ' mil' : nf(v, 0));

  function faixaSimulado(cot) {
    const { E } = C();
    const est = [...new Set(cot.filter(Boolean).map((q) => q.estado))];
    if (est.includes('simulado')) return `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Números SIMULADOS para demonstração.</strong> Nenhuma fonte de cotações está contratada (decisões D-06 e D-10): preços, variações, volumes e gráficos desta aba são fictícios e servem só para mostrar como a tela funciona. Não use para decidir investimentos.</div>`;
    if (est.every((e) => e === 'indisponivel')) return `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Cotações de bolsa indisponíveis.</strong> Não há fonte autorizada de cotações de ações, FIIs, ETFs e índices de bolsa (as bolsas exigem licença paga). Os indicadores econômicos e os títulos públicos desta tela são reais, com a data de referência de cada um.</div>`;
    return est.length ? `<p class="inv-muda">Estados dos dados nesta tela: ${est.map((e) => E((K.ESTADOS[e] || {}).rotulo || e)).join(', ')}.</p>` : '';
  }

  // ---------- cartões de índices / indicadores ----------
  function cartao(a, q) {
    const { E, tagEstado } = C();
    return `<a class="inv-card-q" href="#/ativo/${encodeURIComponent(a.assetId)}" data-grafico="${E(a.assetId)}">
      <span class="inv-card-nome">${E(a.nome)}</span>
      <strong class="inv-card-valor">${E(valor(q, a))}</strong>
      <span class="inv-card-pe"><span class="${varCls(q)}">${E(varTxt(q, a))}</span>${tagEstado(q.estado)}</span>${q && q.real && q.data ? `<span class="inv-card-ref">ref. ${E(dataHora(q))}</span>` : ''}</a>`;
  }
  // Etapa 11: rodapé com a origem dos dados reais da tela (atribuição exigida pela licença, data de coleta)
  function rodapeFontes(cot) {
    const { E, S } = C(); const DR = window.INVEST.dados; if (!DR) return '';
    const ret = S.dadosReais; const ids = new Set();
    (cot || []).forEach((q) => { if (!q || !q.real) return; const r = ret && ret.registros && (ret.registros[q.assetId] || (q.assetId === 'BR:MACRO:USDBRL' && ret.registros['BR:MACRO:PTAX'])); if (r && r.fonte) ids.add(r.fonte); else if (q.fonte === 'tesouro') ids.add('tesouro_direto'); });
    if (!ids.size) return '';
    const col = ret && ret.coleta ? new Date(ret.coleta).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return `<p class="inv-muda inv-atribuicao">${[...ids].map((id) => E((DR.FONTES[id] || {}).atribuicao || id)).join(' · ')}. Licença: ${[...ids].map((id) => /ODbL/.test((DR.FONTES[id] || {}).licenca || '') ? 'ODbL' : 'domínio público').filter((v, i, a) => a.indexOf(v) === i).join(', ')}. Coletado em ${E(col)}; cada número mostra a data de referência da fonte.</p>`;
  }

  // ---------- painel de gráfico (reaproveitado na página do ativo) ----------
  const est = { periodo: '6M', tipo: 'candle', medias: [20, 50], bollinger: false, inferior: 'volume', comparar: [] };
  function painelGrafico(host, a, op = {}) {
    const { E, S, tagEstado } = C();
    const id = 'g' + K.hash(a.assetId + (op.sufixo || ''));
    const macro = a.classe === 'macro';
    const opc = Object.assign({}, est, macro ? { tipo: 'linha', medias: [], inferior: 'nenhum' } : {}, op.inicial || {});
    const bt = (grupo, v, rot, on) => `<button type="button" class="inv-seg${on ? ' on' : ''}" data-${grupo}="${E(v)}" aria-pressed="${on}">${E(rot)}</button>`;
    host.innerHTML = `
      <div class="inv-graf-ctl" role="toolbar" aria-label="Opções do gráfico">
        <div class="inv-seg-grupo" aria-label="Período">${Object.keys(K.PERIODOS).map((p) => bt('periodo', p, p === 'YTD' ? 'No ano' : p === 'MAX' ? 'Máx.' : p, p === opc.periodo)).join('')}</div>
        ${macro ? '' : `<div class="inv-seg-grupo" aria-label="Tipo">${bt('tipo', 'candle', 'Candle', opc.tipo === 'candle')}${bt('tipo', 'linha', 'Linha', opc.tipo === 'linha')}</div>`}
      </div>
      ${macro ? '' : `<div class="inv-graf-ctl inv-graf-ctl2">
        <label class="inv-check"><input type="checkbox" data-media="20"${opc.medias.includes(20) ? ' checked' : ''}> Média 20</label>
        <label class="inv-check"><input type="checkbox" data-media="50"${opc.medias.includes(50) ? ' checked' : ''}> Média 50</label>
        <label class="inv-check"><input type="checkbox" data-media="200"${opc.medias.includes(200) ? ' checked' : ''}> Média 200</label>
        <label class="inv-check"><input type="checkbox" data-boll${opc.bollinger ? ' checked' : ''}> Bollinger</label>
        <label class="inv-campo inv-campo-curto"><span>Painel de baixo</span><select data-inferior class="inv-select">${[['volume', 'Volume'], ['rsi', 'IFR (14)'], ['macd', 'MACD'], ['nenhum', 'Nenhum']].map(([v, n]) => `<option value="${v}"${opc.inferior === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="inv-campo inv-campo-curto"><span>Comparar com</span><input type="text" data-comparar list="${id}-lista" placeholder="Código ou índice" maxlength="20" autocomplete="off" aria-label="Comparar com outro ativo ou índice"><datalist id="${id}-lista"></datalist></label>
      </div>`}
      <div class="inv-graf-comp" data-chips></div>
      <div class="inv-graf-area"><canvas id="${id}-p" role="img" aria-label="Gráfico de ${E(a.ticker)}"></canvas></div>
      <div class="inv-graf-area inv-graf-inf" data-inf-area><canvas id="${id}-i" role="img" aria-label="Indicador do gráfico de ${E(a.ticker)}"></canvas></div>
      <div class="inv-graf-rod" data-rodape></div>`;
    const lista = host.querySelector('datalist');
    if (lista) lista.innerHTML = [...K.INDICES[a.pais] || [], ...(S.cat || []).filter((x) => x.pais === a.pais && x.situacao === 'ativo' && x.assetId !== a.assetId).slice(0, 400)].map((x) => `<option value="${E(x.ticker)}">${E(x.nome)}</option>`).join('');
    const desenhar = () => {
      const h = S.motor.historico(a, opc.periodo);
      const rod = host.querySelector('[data-rodape]'); const inf = host.querySelector('[data-inf-area]');
      if (!h.pontos.length) { G.destruir(id + '-p'); G.destruir(id + '-i'); host.querySelector('.inv-graf-area').innerHTML = ''; host.querySelector('.inv-graf-area').classList.add('inv-graf-sem'); rod.innerHTML = `${tagEstado('indisponivel')} Sem histórico: nenhuma fonte autorizada para ${E(a.ticker)}.`; inf.hidden = true; return; }
      const comps = opc.comparar.map((x) => ({ a: x, h: S.motor.historico(x, opc.periodo) })).filter((x) => x.h.pontos.length);
      if (comps.length) G.principal(document.getElementById(id + '-p'), { comparar: K.comparar([{ assetId: a.assetId, rotulo: a.ticker, pontos: h.pontos }, ...comps.map((x) => ({ assetId: x.a.assetId, rotulo: x.a.ticker, pontos: x.h.pontos }))]) });
      else G.principal(document.getElementById(id + '-p'), { tipo: opc.tipo, pontos: h.pontos, medias: opc.medias, bollinger: opc.bollinger, casas: casasDe(a) });
      const temVol = h.pontos.some((p) => p.volume > 0);
      const tipoInf = opc.inferior === 'volume' && !temVol ? 'nenhum' : opc.inferior;
      inf.hidden = tipoInf === 'nenhum' || !!comps.length;
      if (!inf.hidden) G.inferior(document.getElementById(id + '-i'), tipoInf, h.pontos); else G.destruir(id + '-i');
      const ret = K.retorno(h.pontos);
      const ch = host.querySelector('[data-chips]');
      ch.innerHTML = comps.map((x) => `<button type="button" class="badge badge-neutral inv-chip" data-tirar-comp="${E(x.a.assetId)}" aria-label="Tirar ${E(x.a.ticker)} da comparação">${E(x.a.ticker)} ×</button>`).join('');
      rod.innerHTML = `${tagEstado(h.estado)} <span>Fonte: ${E(h.fonteNome || '—')}</span> · <span>${h.pontos.length} pregões${G.semanal && opc.tipo === 'candle' && h.pontos.length > 300 && !comps.length ? ' (candles semanais)' : ''}</span> · <span>Variação no período: <strong class="${ret > 0 ? 'inv-sobe' : ret < 0 ? 'inv-desce' : ''}">${ret == null ? '—' : (ret > 0 ? '+' : '') + nf(ret) + '%'}</strong></span>${h.estado === 'simulado' ? ' · <strong>números fictícios</strong>' : ''}`;
      ch.querySelectorAll('[data-tirar-comp]').forEach((b) => b.addEventListener('click', () => { opc.comparar = opc.comparar.filter((x) => x.assetId !== b.dataset.tirarComp); desenhar(); }));
    };
    host.querySelectorAll('[data-periodo]').forEach((b) => b.addEventListener('click', () => { opc.periodo = est.periodo = b.dataset.periodo; host.querySelectorAll('[data-periodo]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); desenhar(); }));
    host.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => { opc.tipo = est.tipo = b.dataset.tipo; host.querySelectorAll('[data-tipo]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); desenhar(); }));
    host.querySelectorAll('[data-media]').forEach((c) => c.addEventListener('change', () => { const n = +c.dataset.media; opc.medias = c.checked ? [...opc.medias, n].sort((x, y) => x - y) : opc.medias.filter((x) => x !== n); est.medias = opc.medias; desenhar(); }));
    const bo = host.querySelector('[data-boll]'); if (bo) bo.addEventListener('change', () => { opc.bollinger = est.bollinger = bo.checked; desenhar(); });
    const inf = host.querySelector('[data-inferior]'); if (inf) inf.addEventListener('change', () => { opc.inferior = est.inferior = inf.value; desenhar(); });
    const cmp = host.querySelector('[data-comparar]');
    if (cmp) cmp.addEventListener('change', () => {
      const t = cmp.value.trim().toUpperCase(); cmp.value = ''; if (!t) return;
      const x = [...K.INDICES.BR, ...K.INDICES.US].find((i) => i.ticker === t) || (S.cat || []).find((i) => i.ticker === t);
      if (!x) { C().toastInv('Ativo não encontrado no catálogo.'); return; }
      if (x.assetId === a.assetId || opc.comparar.some((y) => y.assetId === x.assetId)) return;
      if (opc.comparar.length >= 4) { C().toastInv('Compare até 4 ativos por vez.'); return; }
      opc.comparar.push(x); desenhar();
    });
    desenhar();
  }

  // resumo técnico e retornos do ativo (página do ativo)
  function resumoTecnico(a) {
    const { S, E } = C();
    const h = S.motor.historico(a, 'MAX'); if (h.pontos.length < 30) return '';
    const f = h.pontos.map((p) => p.fechamento); const n = f.length - 1;
    const m = (k) => { const v = K.sma(f, k)[n]; return v == null ? '—' : nf(v, casasDe(a)); };
    const r = K.rsi(f, 14)[n];
    const per = ['1M', '6M', 'YTD', '1A', '5A'].map((p) => [p === 'YTD' ? 'No ano' : p, K.retorno(K.recortar(h.pontos, p))]);
    const max = Math.max(...h.pontos.slice(-252).map((p) => p.maxima)), min = Math.min(...h.pontos.slice(-252).map((p) => p.minima));
    return `<div class="inv-tec">
      <div><span>Média 20 · 50 · 200</span><strong>${m(20)} · ${m(50)} · ${m(200)}</strong></div>
      <div><span>IFR (14)</span><strong>${r == null ? '—' : nf(r)}</strong></div>
      <div><span>Máx. e mín. em 12 meses</span><strong>${nf(max, casasDe(a))} · ${nf(min, casasDe(a))}</strong></div>
      ${per.map(([rot, v]) => `<div><span>Retorno ${E(rot)}</span><strong class="${v > 0 ? 'inv-sobe' : v < 0 ? 'inv-desce' : ''}">${v == null ? '—' : (v > 0 ? '+' : '') + nf(v) + '%'}</strong></div>`).join('')}
    </div><p class="inv-muda">Indicadores calculados por regra sobre o histórico mostrado (${E((K.ESTADOS[h.estado] || {}).rotulo || h.estado)}). Não são recomendação de compra ou venda.</p>`;
  }

  T._ativoMercado = function (host, a) {
    const { S, E, tagEstado } = C();
    if (!host || !S.motor) return;
    const q = S.motor.cotacao(a);
    host.innerHTML = `<div class="panel-title"><h2>Cotação e gráfico</h2>${tagEstado(q.estado)}</div>
      ${q.preco == null ? `<div class="inv-cotacao"><p>${E(q.motivo || 'Sem fonte autorizada.')}</p><p class="inv-muda">Nenhum preço é mostrado sem uma fonte autorizada.</p></div>` : `
      <div class="inv-cot-topo"><strong class="inv-cot-preco">${E(valor(q, a))}</strong><span class="${varCls(q)} inv-cot-var">${E(varTxt(q, a))}</span>
        <span class="inv-muda">em ${E(dataHora(q))} · ${E(q.fonteNome)}</span></div>
      ${q.estado === 'simulado' ? '<div class="inv-faixa inv-faixa-aviso" role="note"><strong>SIMULADO:</strong> preço e gráfico fictícios, só para demonstração. Nenhuma fonte de cotações está contratada (D-06/D-10).</div>' : ''}
      ${q.estado === 'manual' ? '<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Preço manual</strong> informado pela sua empresa (sem histórico).</div>' : ''}
      ${q.detalhe && a.classe === 'tesouro' ? `<dl class="inv-cot-dl"><div><dt>PU de compra (você compra)</dt><dd>${q.detalhe.puCompra ? 'R$ ' + nf(q.detalhe.puCompra) : '—'}</dd></div><div><dt>PU de venda (resgate antecipado)</dt><dd>${q.detalhe.puVenda ? 'R$ ' + nf(q.detalhe.puVenda) : '—'}</dd></div><div><dt>PU base (referência)</dt><dd>${q.detalhe.puBase ? 'R$ ' + nf(q.detalhe.puBase) : '—'}</dd></div><div><dt>Taxa compra / venda</dt><dd>${q.detalhe.taxaCompra != null ? nf(q.detalhe.taxaCompra) + '%' : '—'} / ${q.detalhe.taxaVenda != null ? nf(q.detalhe.taxaVenda) + '%' : '—'}</dd></div></dl>
      <p class="inv-muda">${q.tipoPreco === 'pu-venda' ? 'O preço acima é o <strong>PU de venda</strong>: valor estimado de resgate antecipado, bruto (antes de IR, IOF e taxas da corretora). É ele que avalia a carteira.' : 'Sem PU de venda nesta data: o preço acima é o <strong>PU base</strong>, só uma referência (não é o valor de resgate).'} O gráfico mostra o histórico do PU base (referência diária do Tesouro). Data-base ${E(String(q.detalhe.dataBase).split('-').reverse().join('/'))}.</p>` : ''}
      ${q.volume != null || q.maxima != null ? `<dl class="inv-cot-dl"><div><dt>Abertura</dt><dd>${nf(q.abertura, casasDe(a))}</dd></div><div><dt>Máxima</dt><dd>${nf(q.maxima, casasDe(a))}</dd></div><div><dt>Mínima</dt><dd>${nf(q.minima, casasDe(a))}</dd></div><div><dt>Fech. anterior</dt><dd>${nf(q.fechamentoAnterior, casasDe(a))}</dd></div>${q.volume ? `<div><dt>Volume</dt><dd>${volTxt(q.volume)}</dd></div>` : ''}</dl>` : ''}`}
      <div data-graf></div><div data-tec></div>`;
    const g = host.querySelector('[data-graf]');
    if (q.estado !== 'manual' && q.preco != null) { painelGrafico(g, a, { sufixo: 'ativo' }); host.querySelector('[data-tec]').innerHTML = a.classe === 'macro' ? '' : resumoTecnico(a); }
  };

  // ---------- tabelas de ranking ----------
  function tabelaRank(lista, tipo) {
    const { E, tagEstado } = C();
    if (!lista.length) return C().estado('info', 'Sem dados', 'Nenhum ativo desta classe com cotação disponível.');
    return `<div class="table-scroll"><table class="inv-tabela inv-rank"><thead><tr><th>Ativo</th><th class="cad-num">Preço</th><th class="cad-num">${tipo === 'volume' ? 'Volume financeiro' : 'Variação'}</th></tr></thead><tbody>
      ${lista.map((q) => `<tr class="inv-linha" data-id="${E(q.assetId)}" tabindex="0"><td data-label="Ativo"><div class="inv-ativo"><div><strong>${E(q.ticker)}</strong><span>${E(q.nome)}</span></div></div></td>
        <td data-label="Preço" class="cad-num">${E(valor(q))}</td>
        <td data-label="${tipo === 'volume' ? 'Volume financeiro' : 'Variação'}" class="cad-num">${tipo === 'volume' ? E((q.moeda === 'USD' ? 'US$ ' : 'R$ ') + volTxt(q.financeiro)) : `<span class="${varCls(q)}">${E(varTxt(q))}</span>`}</td></tr>`).join('')}
    </tbody></table></div><p class="inv-muda inv-rank-pe">${[...new Set(lista.map((q) => q.estado))].map((e) => tagEstado(e)).join(' ')}</p>`;
  }

  function mapaCalorHtml(grupos) {
    const { E } = C();
    if (!grupos.length) return C().estado('info', 'Sem dados para o mapa', '');
    const tom = (v) => { const x = Math.max(-1, Math.min(1, v / 3)); return x >= 0 ? `color-mix(in srgb, var(--success) ${Math.round(12 + x * 60)}%, var(--bg-elevated))` : `color-mix(in srgb, var(--danger) ${Math.round(12 - x * 60)}%, var(--bg-elevated))`; };
    return `<div class="inv-mapa">${grupos.slice(0, 16).map((g) => `<section class="inv-mapa-setor"><h3><span>${E(g.setor)}</span><span class="${g.variacaoPct > 0 ? 'inv-sobe' : g.variacaoPct < 0 ? 'inv-desce' : ''}">${E(varTxt({ variacaoPct: g.variacaoPct }))}</span></h3>
      <div class="inv-mapa-itens">${g.itens.map((q) => `<a href="#/ativo/${encodeURIComponent(q.assetId)}" class="inv-mapa-item" style="background:${tom(q.variacaoPct)}" title="${E(q.nome)}: ${E(varTxt(q))}"><strong>${E(q.ticker)}</strong><span>${E(varTxt(q))}</span></a>`).join('')}</div></section>`).join('')}</div>
      <p class="inv-muda">Cor pela variação do dia (verde sobe, vermelho cai; mais forte = maior variação). Setores ordenados pelo volume financeiro; até 12 ativos por setor.</p>`;
  }

  function radarHtml(r) {
    const { E, tagEstado } = C();
    if (!r.length) return C().estado('info', 'Nenhum sinal hoje', 'O radar mostra cruzamentos de médias, IFR extremo, volume fora do normal e máximas/mínimas.');
    return `<ul class="inv-radar">${r.slice(0, 12).map((x) => `<li><a href="#/ativo/${encodeURIComponent(x.assetId)}"><strong>${E(x.ticker)}</strong> <span class="inv-muda">${E(x.nome)}</span></a><span>${x.sinais.map((s) => E(s.texto)).join(' · ')}</span>${tagEstado(x.estado)}</li>`).join('')}</ul>
      <p class="inv-muda">Sinais objetivos calculados por regra sobre o histórico. Não são recomendação.</p>`;
  }

  function fontesHtml(pais) {
    const { E, S } = C();
    const pv = S.motor.provedores().filter((p) => p.mercados.includes(pais));
    return `<ul class="inv-lista">${pv.map((p) => `<li><strong>${E(p.nome)}</strong><span>${p.ativo ? '<span class="badge badge-blue">Ligado</span>' : '<span class="badge badge-neutral">Desligado</span>'} ${E(p.ativo ? '' : p.motivo || '')}</span><span class="inv-muda">Licença: ${E(p.licenca)} · estado do dado: ${E((K.ESTADOS[p.estado] || {}).rotulo || p.estado)}${p.credencial ? ' · exige chave (só no servidor)' : ''}</span></li>`).join('')}</ul>`;
  }

  // ---------- a aba ----------
  const CLASSES_RANK = { BR: [['acao', 'Ações'], ['fii', 'FIIs'], ['bdr', 'BDRs'], ['etf', 'ETFs']], US: [['acao', 'Ações'], ['etf', 'ETFs'], ['reit', 'REITs']] };
  const estAba = { BR: { classe: 'acao', grafico: 'BR:INDICE:IBOV' }, US: { classe: 'acao', grafico: 'US:INDICE:SPX' } };
  // Etapa 11: painéis com dados reais do Tesouro Direto e do Focus
  function tesouroHtml() {
    const { E, S, estado, tagEstado } = C(); const t = S.dadosReais && S.dadosReais.tesouro;
    if (!t || !t.titulos) return estado('info', 'Preços do Tesouro Direto indisponíveis', 'O arquivo do Tesouro Transparente ainda não foi carregado.');
    const hoje = typeof isoHoje === 'function' ? isoHoje() : new Date().toISOString().slice(0, 10);
    const est = window.INVEST.dados.estadoPelaIdade(t.dataBase, hoje, 10);
    const linhas = Object.entries(t.titulos).sort((a, b) => (a[1].indexador + a[1].vencimento).localeCompare(b[1].indexador + b[1].vencimento));
    const tx = (v) => (v == null ? '—' : nf(v) + '%');
    return `<p class="inv-muda">Data-base ${E(t.dataBase.split('-').reverse().join('/'))} ${tagEstado(est)} · ${linhas.length} títulos em oferta · PU = preço unitário</p>
      <div class="cad-tabela-wrap"><table class="cad-tabela inv-tabela"><thead><tr><th>Título</th><th>Vencimento</th><th class="cad-num">Taxa (compra)</th><th class="cad-num">PU (compra)</th><th class="cad-num">Taxa (venda)</th><th class="cad-num">PU (venda)</th></tr></thead><tbody>
      ${linhas.map(([tk, x]) => `<tr><td data-label="Título"><a href="#/ativo/${encodeURIComponent('BR:TESOURO:' + tk)}">${E(x.nome)}</a></td><td data-label="Vencimento">${E(x.vencimento.split('-').reverse().join('/'))}</td><td data-label="Taxa (compra)" class="cad-num">${E(tx(x.taxaCompra))}</td><td data-label="PU (compra)" class="cad-num">${x.puCompra ? 'R$ ' + E(nf(x.puCompra)) : '—'}</td><td data-label="Taxa (venda)" class="cad-num">${E(tx(x.taxaVenda))}</td><td data-label="PU (venda)" class="cad-num">${x.puVenda ? 'R$ ' + E(nf(x.puVenda)) : '—'}</td></tr>`).join('')}
      </tbody></table></div><p class="inv-muda inv-atribuicao">${E(t.atribuicao)}. Licença ODbL. Títulos sem compra no dia aparecem com "—".</p>`;
  }
  function focusHtml() {
    const { E, S, estado } = C(); const f = S.dadosReais && S.dadosReais.registros && S.dadosReais.registros['BR:FOCUS'];
    if (!f) return estado('info', 'Expectativas indisponíveis', 'O Boletim Focus não foi carregado.');
    const ind = [['IPCA', 'IPCA (%)'], ['Selic', 'Selic (% a.a.)'], ['PIB Total', 'PIB (%)'], ['Câmbio', 'Câmbio (R$/US$)']];
    const anos = [...new Set(Object.values(f.expectativas).flatMap((o) => Object.keys(o)))].sort();
    const dt = Object.values(f.expectativas).flatMap((o) => Object.values(o).map((x) => x.data)).sort().pop();
    return `<p class="inv-muda">EXPECTATIVAS de mercado (mediana das instituições), não são valores realizados nem garantia. Atualizado em ${E((dt || '').split('-').reverse().join('/'))}.</p>
      <div class="cad-tabela-wrap"><table class="cad-tabela inv-tabela"><thead><tr><th>Indicador</th>${anos.map((a) => `<th class="cad-num">${E(a)}</th>`).join('')}</tr></thead><tbody>
      ${ind.map(([k, rot]) => `<tr><td data-label="Indicador">${E(rot)}</td>${anos.map((a) => { const x = (f.expectativas[k] || {})[a]; return `<td data-label="${E(a)}" class="cad-num">${x ? E(nf(x.mediana, k === 'Câmbio' ? 2 : 2)) : '—'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div><p class="inv-muda inv-atribuicao">${E(f.atribuicao)}. Licença ODbL.</p>`;
  }
  // Etapa 11.18: gráficos de mercado do TradingView (só símbolos confirmados; o gráfico é desenhado por eles, numa janela isolada)
  const TV_POR_PAIS = { BR: ['BR:INDICE:IBOV', 'BR:INDICE:IFIX', 'BR:MACRO:USDBRL', 'BR:MACRO:EURBRL', 'CRYPTO:-:BTC', 'CRYPTO:-:ETH', 'CRYPTO:-:SOL', 'REF:OURO', 'REF:PETROLEO'],
    US: ['US:INDICE:SPX', 'US:INDICE:NDX', 'CRYPTO:-:BTC', 'CRYPTO:-:ETH', 'CRYPTO:-:SOL', 'REF:OURO', 'REF:PETROLEO'] };
  const TV_ROTULO = { 'BR:INDICE:IFIX': 'IFIX' };
  const estTV = { BR: null, US: null };
  const M = () => window.INVEST.motor;
  const refTV = (id) => { const a = C().porId(id); if (a) return a; const p = (M().TV_PAINEL || []).find((x) => x.id === id); return { assetId: id, ticker: p ? p.rotulo : id, nome: p ? p.rotulo : id }; };
  function graficosMercadoHtml(pais) {
    const tv = window.INVEST.tv; if (!tv || !M().opcoesTradingView) return '';
    const ids = TV_POR_PAIS[pais].filter((id) => M().opcoesTradingView({ assetId: id }).length);
    if (!ids.length) return '';
    const atual = estTV[pais] && ids.includes(estTV[pais]) ? estTV[pais] : ids[0];
    const rot = (id) => TV_ROTULO[id] || ((M().TV_PAINEL || []).find((x) => x.id === id) || {}).rotulo || id;
    const corpo = tv.html(refTV(atual), { titulo: 'Gráficos de mercado · ' + rot(atual) });
    return `<div class="inv-largo inv-tv-mercado" data-tv-mercado="${pais}"><div class="inv-seg-grupo inv-tv-escolha" role="group" aria-label="Escolher o gráfico de mercado">${ids.map((id) => `<button type="button" class="inv-seg${id === atual ? ' on' : ''}" data-tv-ref="${C().E(id)}" aria-pressed="${id === atual}">${C().E(rot(id))}</button>`).join('')}</div>${corpo}</div>`;
  }
  function ligarGraficosMercado(host, pais) {
    const w = host.querySelector(`[data-tv-mercado="${pais}"]`); if (!w) return;
    window.INVEST.tv.ligar(w);
    w.querySelectorAll('[data-tv-ref]').forEach((b) => b.addEventListener('click', () => { estTV[pais] = b.dataset.tvRef; const n = document.createElement('div'); n.innerHTML = graficosMercadoHtml(pais); const novo = n.firstElementChild; w.replaceWith(novo); ligarGraficosMercado(novo.parentElement, pais); }));
  }
  function telaMercado(host, pais) {
    const ctx = C(); const { S, E, estado, cabecalho } = ctx;
    const titulo = pais === 'BR' ? 'Mercado Brasil' : 'Mercado Estados Unidos';
    if (S.estadoCat !== 'ok' || !S.motor) { host.innerHTML = cabecalho(titulo, '') + `<div class="panel">${S.estadoCat === 'erro' ? estado('erro', 'Catálogo indisponível', S.erroCat) : estado('carregando', 'Carregando o mercado…')}</div>`; return; }
    const ea = estAba[pais];
    const ind = K.INDICES[pais], mac = K.MACRO[pais];
    // sem fonte para os índices de bolsa: o gráfico inicial passa para um indicador com dado real
    if (!ea.escolhido && S.dadosReais) { const alvo = mac.find((x) => x.assetId === (pais === 'BR' ? 'BR:MACRO:USDBRL' : 'US:MACRO:UST10Y')); const q0 = alvo && S.motor.cotacao(alvo); if (q0 && q0.real) ea.grafico = alvo.assetId; }
    const cInd = S.motor.cotacoes(ind), cMac = S.motor.cotacoes(mac);
    const univ = S.cat.filter((a) => a.pais === pais && a.situacao === 'ativo' && a.classe !== 'tesouro');
    const cUniv = S.motor.cotacoes(univ);
    const porClasse = (cl) => cUniv.filter((q) => q.classe === cl);
    const rk = K.rankings(porClasse(ea.classe), 8);
    const temTeste = univ.some((a) => a.teste);
    const sel = [...ind, ...mac].find((x) => x.assetId === ea.grafico) || ind[0];
    const amplos = ind.filter((i) => i.segmento !== 'Setorial'), setoriais = ind.filter((i) => i.segmento === 'Setorial');
    const contagem = (cl) => univ.filter((a) => a.classe === cl).length;
    host.innerHTML = cabecalho(titulo, `${univ.length} ativos acompanhados · ${ind.length} índices · ${mac.length} indicadores econômicos`) +
      faixaSimulado([...cInd, ...cUniv]) +
      (temTeste ? `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Ativos de TESTE:</strong> o catálogo dos EUA ainda usa empresas fictícias (o arquivo oficial da SEC não foi recebido — pendência da 05.1).</div>` : '') + `
      <div class="panel"><div class="panel-title"><h2>Principais índices</h2></div><div class="inv-cards">${amplos.map((a, i) => cartao(a, cInd[ind.indexOf(a)])).join('')}</div></div>
      <div class="inv-grade">
        ${graficosMercadoHtml(pais)}
        <div class="panel inv-largo"><div class="panel-title"><h2>Gráfico · <span data-graf-nome>${E(sel.nome)}</span></h2>
          <label class="inv-campo inv-campo-curto"><span class="sr-only">Escolher índice ou indicador</span><select class="inv-select" data-graf-sel>${[...ind, ...mac].map((x) => `<option value="${E(x.assetId)}"${x.assetId === sel.assetId ? ' selected' : ''}>${E(x.nome)}</option>`).join('')}</select></label></div>
          <div data-graf></div></div>
        <div class="panel"><div class="panel-title"><h2>${pais === 'BR' ? 'Juros, inflação e câmbio' : 'Juros, inflação e Treasuries'}</h2></div>
          <ul class="inv-macro">${mac.map((a, i) => `<li><a href="#/ativo/${encodeURIComponent(a.assetId)}">${E(a.nome)}</a><strong>${E(valor(cMac[i], a))}</strong>${C().tagEstado(cMac[i].estado)}${cMac[i].real && cMac[i].data ? `<small class="inv-muda">ref. ${E(dataHora(cMac[i]))}</small>` : ''}</li>`).join('')}</ul>${rodapeFontes(cMac)}</div>
        ${window.INVEST.internacional ? (pais === 'BR' ? `<div class="panel inv-largo"><div class="panel-title"><h2>Câmbio: PTAX e referências internacionais</h2></div>${window.INVEST.internacional.cambioHtml('BR')}</div>`
          : `<div class="panel"><div class="panel-title"><h2>Energia (EIA)</h2></div>${window.INVEST.internacional.energiaHtml()}</div>
             <div class="panel inv-largo"><div class="panel-title"><h2>Câmbio internacional</h2></div>${window.INVEST.internacional.cambioHtml('US')}</div>
             <div class="panel inv-largo"><div class="panel-title"><h2>Macroeconomia internacional (Banco Mundial)</h2></div>${window.INVEST.internacional.macroIntHtml()}</div>`) : ''}
        ${pais === 'BR' ? `<div class="panel inv-largo"><div class="panel-title"><h2>Tesouro Direto — preços e taxas</h2></div>${tesouroHtml()}</div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Expectativas de mercado (Boletim Focus)</h2></div>${focusHtml()}</div>` : ''}
        <div class="panel"><div class="panel-title"><h2>Índices setoriais</h2></div>
          <ul class="inv-macro">${setoriais.map((a) => { const q = cInd[ind.indexOf(a)]; return `<li><a href="#/ativo/${encodeURIComponent(a.assetId)}">${E(a.nome)}</a><strong class="${varCls(q)}">${E(varTxt(q))}</strong>${C().tagEstado(q.estado)}</li>`; }).join('')}</ul></div>
        <div class="panel inv-largo"><div class="panel-title inv-lista-cab"><h2>Destaques do dia</h2>
          <div class="inv-seg-grupo" role="group" aria-label="Classe">${CLASSES_RANK[pais].map(([k, n]) => `<button type="button" class="inv-seg${ea.classe === k ? ' on' : ''}" data-rank-classe="${k}" aria-pressed="${ea.classe === k}">${E(n)} <small>${contagem(k)}</small></button>`).join('')}</div></div>
          ${contagem(ea.classe) ? `<div class="inv-rank-grade"><div><h3>Maiores altas</h3>${tabelaRank(rk.altas)}</div><div><h3>Maiores baixas</h3>${tabelaRank(rk.baixas)}</div><div><h3>Maior volume</h3>${tabelaRank(rk.volume, 'volume')}</div></div>`
          : estado('info', `Sem ${CLASSES_RANK[pais].find((x) => x[0] === ea.classe)[1]} no catálogo`, ea.classe === 'etf' && pais === 'BR' ? 'Os ETFs brasileiros só entram com o cadastro da B3, que depende da licença por escrito (D-06).' : pais === 'US' ? 'O catálogo dos EUA depende do arquivo oficial da SEC, que exige um e-mail de contato da empresa para o robô (pendência da Etapa 11), e, para ETFs, de uma fonte com licença.' : 'Nenhum ativo desta classe nas fontes recebidas.')}</div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Mapa de calor por setor</h2></div><div data-mapa>${estado('carregando', 'Montando o mapa…')}</div></div>
        <div class="panel"><div class="panel-title"><h2>Radar</h2></div><div data-radar>${estado('carregando', 'Procurando sinais…')}</div></div>
        <div class="panel"><div class="panel-title"><h2>Fontes de dados</h2></div>${fontesHtml(pais)}
          ${ctx.S.demoPermitida ? `<label class="inv-check"><input type="checkbox" id="inv-simulador"${ctx.S.simulador ? ' checked' : ''}> Modo demonstração: mostrar números SIMULADOS (só neste navegador; nunca entram em carteiras reais)</label>` : '<p class="inv-muda">Indicadores de juros, inflação, câmbio e Tesouro vêm de fontes oficiais (dados reais, com a data de referência de cada um). Cotações de ações, FIIs, ETFs, BDRs e índices de bolsa: sem fonte autorizada (indisponíveis).</p>'}</div>
      </div>`;
    ligarGraficosMercado(host, pais);
    painelGrafico(host.querySelector('[data-graf]'), sel, { sufixo: 'mercado' + pais });
    host.querySelector('[data-graf-sel]').addEventListener('change', (e) => { ea.grafico = e.target.value; ea.escolhido = true; const x = [...ind, ...mac].find((y) => y.assetId === ea.grafico); host.querySelector('[data-graf-nome]').textContent = x.nome; painelGrafico(host.querySelector('[data-graf]'), x, { sufixo: 'mercado' + pais }); });
    host.querySelectorAll('[data-rank-classe]').forEach((b) => b.addEventListener('click', () => { ea.classe = b.dataset.rankClasse; telaMercado(host, pais); }));
    ctx.ligarLinhas(host);
    const simEl = host.querySelector('#inv-simulador'); if (simEl) simEl.addEventListener('change', (e) => { ctx.salvarPref({ simulador: e.target.checked }); ctx.montarMotor(); telaMercado(host, pais); });
    // mapa e radar: depois do primeiro desenho (não travam a tela)
    setTimeout(() => {
      if (!host.isConnected) return;
      const m = host.querySelector('[data-mapa]'); if (m) m.innerHTML = mapaCalorHtml(K.mapaCalor(cUniv, univ));
      const r = host.querySelector('[data-radar]'); if (r) r.innerHTML = radarHtml(K.radar(univ.filter((a) => a.classe === 'acao' || a.classe === 'fii'), S.motor, { limite: 8 }));
    }, 30);
  }
  T.br = (host) => telaMercado(host, 'BR');
  T.us = (host) => telaMercado(host, 'US');
  window.INVEST.mercadoUi = { valor, varTxt, varCls, nf, volTxt, painelGrafico, faixaSimulado, cartao, dataHora, rodapeFontes, tesouroHtml, focusHtml };
})();
