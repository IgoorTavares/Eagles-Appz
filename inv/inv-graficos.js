/* =====================================================================
   Investimentos · gráficos (Etapa 06) — usa o Chart.js 4.4.4 que o sistema JÁ carrega
   (nenhuma biblioteca nova, nenhum endereço novo). Cores sempre do tema ativo
   (mnPaleta do script.js), para valer nos 14 temas e no personalizado.
   - candle: barras flutuantes (pavio = mínima→máxima; corpo = abertura→fechamento);
   - linha, médias móveis, Bollinger, comparação (% desde o início do período);
   - painel inferior: volume, IFR(14) ou MACD.
   ===================================================================== */
(function () {
  'use strict';
  const K = window.INVEST.mercado;
  const vivos = new Map(); // canvas id → Chart (destruído antes de redesenhar: sem vazamento)

  function paleta() {
    if (typeof mnPaleta === 'function') { const p = mnPaleta(); return { p, rgba: typeof mnRgba === 'function' ? mnRgba : (c) => c, mistura: typeof mnMistura === 'function' ? mnMistura : (a) => a }; }
    const cs = getComputedStyle(document.documentElement); const v = (n, f) => (cs.getPropertyValue(n) || f).trim();
    const p = { destaque: v('--blue-strong', '#2563eb'), texto: v('--text', '#111'), suave: v('--text-soft', '#666'), fundo: v('--bg-elevated', '#fff'), linha: v('--border', '#ddd'), ok: v('--success', '#16a34a'), alerta: v('--warning', '#d97706'), erro: v('--danger', '#dc2626') };
    return { p, rgba: (c, a) => (a == null ? c : `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`), mistura: (a) => a };
  }
  function destruir(id) { const c = vivos.get(id); if (c) { try { c.destroy(); } catch (e) { /* já destruído */ } vivos.delete(id); } }
  function destruirTodos() { [...vivos.keys()].forEach(destruir); }

  // muitos pregões em candle ficam ilegíveis: agrupa por semana acima de 300 pontos
  function semanal(pontos) {
    const out = []; let g = null;
    for (const p of pontos) {
      const d = new Date(p.data + 'T12:00:00Z'); const seg = new Date(d); seg.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const k = seg.toISOString().slice(0, 10);
      if (!g || g.k !== k) { g = { k, data: p.data, abertura: p.abertura, maxima: p.maxima, minima: p.minima, fechamento: p.fechamento, volume: p.volume || 0 }; out.push(g); }
      else { g.maxima = Math.max(g.maxima, p.maxima); g.minima = Math.min(g.minima, p.minima); g.fechamento = p.fechamento; g.volume += p.volume || 0; g.data = p.data; }
    }
    return out;
  }
  const dataCurta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
  const num = (v, casas = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));

  function eixos(P, rgba, extra = {}) {
    const f = { family: 'Inter', size: 11 };
    return {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: rgba(P.suave), font: f, maxTicksLimit: 6, maxRotation: 0, autoSkip: true } },
      y: Object.assign({ position: 'right', grid: { color: rgba(P.linha, 0.6), drawTicks: false }, border: { display: false }, ticks: { color: rgba(P.suave), font: f, maxTicksLimit: 5, padding: 6 } }, extra.y || {}),
    };
  }
  function dica(P, rgba, cb) {
    return { backgroundColor: rgba(P.texto), titleColor: rgba(P.fundo), bodyColor: rgba(P.fundo), padding: 9, cornerRadius: 6, displayColors: false, titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter', size: 12 }, callbacks: cb };
  }

  // gráfico principal: op = { tipo:'candle'|'linha', pontos, medias:[20,50,200], bollinger:bool, casas, comparar: {datas, series} }
  function principal(canvas, op) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    destruir(canvas.id);
    const { p: P, rgba, mistura } = paleta();
    const casas = op.casas ?? 2;
    if (op.comparar) {
      const cores = [P.destaque, P.texto, P.alerta, P.suave, mistura(P.destaque, P.texto, 0.5)];
      const ch = new Chart(canvas, {
        type: 'line',
        data: { labels: op.comparar.datas.map(dataCurta), datasets: op.comparar.series.map((s, i) => ({ label: s.rotulo, data: s.valores, borderColor: rgba(cores[i % cores.length]), backgroundColor: rgba(cores[i % cores.length]), borderWidth: i ? 1.75 : 2.5, borderDash: i > 1 ? [5, 4] : [], pointRadius: 0, tension: 0.2 })) },
        options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { usePointStyle: true, pointStyle: 'line', color: rgba(P.texto), font: { family: 'Inter', size: 12 } } }, tooltip: dica(P, rgba, { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : (c.raw >= 0 ? '+' : '') + num(c.raw)}%` }) },
          scales: eixos(P, rgba, { y: { ticks: { color: rgba(P.suave), font: { family: 'Inter', size: 11 }, callback: (v) => v + '%' } } }) },
      });
      vivos.set(canvas.id, ch); return ch;
    }
    let pts = op.pontos || [];
    const agrupado = op.tipo === 'candle' && pts.length > 300;
    if (agrupado) pts = semanal(pts);
    const f = pts.map((p) => p.fechamento);
    const labels = pts.map((p) => dataCurta(p.data));
    const ds = [];
    if (op.tipo === 'candle') {
      const cor = pts.map((p) => rgba(p.fechamento >= p.abertura ? P.ok : P.erro));
      ds.push({ type: 'bar', label: 'Máx./mín.', data: pts.map((p) => [p.minima, p.maxima]), backgroundColor: cor, barThickness: 1.2, grouped: false, order: 3 });
      ds.push({ type: 'bar', label: 'Abertura/fechamento', data: pts.map((p) => (p.abertura === p.fechamento ? [p.abertura * 0.9995, p.fechamento * 1.0005] : [Math.min(p.abertura, p.fechamento), Math.max(p.abertura, p.fechamento)])), backgroundColor: cor, maxBarThickness: 9, categoryPercentage: 0.8, barPercentage: 0.8, grouped: false, order: 2 });
    } else {
      ds.push({ type: 'line', label: 'Fechamento', data: f, borderColor: rgba(P.destaque), backgroundColor: rgba(P.destaque, 0.08), fill: 'origin', borderWidth: 2.25, pointRadius: 0, tension: 0.15, order: 1 });
    }
    const coresMM = { 20: P.alerta, 50: P.texto, 200: P.suave };
    (op.medias || []).forEach((n) => ds.push({ type: 'line', label: `Média ${n}`, data: K.sma(f, n), borderColor: rgba(coresMM[n] || P.suave), borderWidth: 1.5, pointRadius: 0, spanGaps: true, order: 0 }));
    if (op.bollinger) { const b = K.bollinger(f, 20); ds.push({ type: 'line', label: 'Bollinger sup.', data: b.superior, borderColor: rgba(P.suave), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, order: 0 }, { type: 'line', label: 'Bollinger inf.', data: b.inferior, borderColor: rgba(P.suave), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, order: 0 }); }
    const yMin = Math.min(...pts.map((p) => p.minima ?? p.fechamento)), yMax = Math.max(...pts.map((p) => p.maxima ?? p.fechamento)); const folga = (yMax - yMin) * 0.06 || yMax * 0.01;
    const ch = new Chart(canvas, {
      data: { labels, datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: ds.length > (op.tipo === 'candle' ? 2 : 1), labels: { filter: (i) => !/^(Máx|Abertura)/.test(i.text), usePointStyle: true, pointStyle: 'line', color: rgba(P.texto), font: { family: 'Inter', size: 12 } } },
          tooltip: dica(P, rgba, {
            title: (it) => (it[0] ? (agrupado ? 'Semana até ' : '') + pts[it[0].dataIndex].data.split('-').reverse().join('/') : ''),
            label: (c) => { const p = pts[c.dataIndex]; if (c.dataset.label === 'Máx./mín.') return null; if (c.dataset.label === 'Abertura/fechamento' || c.dataset.label === 'Fechamento') return op.tipo === 'candle' ? [`Abertura ${num(p.abertura, casas)} · Fechamento ${num(p.fechamento, casas)}`, `Máxima ${num(p.maxima, casas)} · Mínima ${num(p.minima, casas)}`] : `Fechamento ${num(p.fechamento, casas)}`; return c.raw == null ? null : `${c.dataset.label}: ${num(c.raw, casas)}`; },
          }) },
        scales: eixos(P, rgba, { y: { min: yMin - folga, max: yMax + folga, ticks: { color: rgba(P.suave), font: { family: 'Inter', size: 11 }, maxTicksLimit: 5, callback: (v) => num(v, casas) } } }) },
    });
    ch.$agrupado = agrupado; vivos.set(canvas.id, ch); return ch;
  }

  // painel inferior: 'volume' | 'rsi' | 'macd'
  function inferior(canvas, tipo, pontos) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    destruir(canvas.id);
    if (!tipo || tipo === 'nenhum') return null;
    const { p: P, rgba } = paleta();
    const pts = pontos.length > 300 && tipo === 'volume' ? semanal(pontos) : pontos;
    const labels = pts.map((p) => dataCurta(p.data)); const f = pts.map((p) => p.fechamento);
    let ds, y = {};
    if (tipo === 'volume') { ds = [{ type: 'bar', label: 'Volume', data: pts.map((p) => p.volume || 0), backgroundColor: pts.map((p) => rgba(p.fechamento >= p.abertura ? P.ok : P.erro, 0.55)), maxBarThickness: 9 }]; y = { ticks: { color: rgba(P.suave), font: { family: 'Inter', size: 10 }, maxTicksLimit: 3, callback: (v) => (v >= 1e6 ? Math.round(v / 1e6) + ' mi' : v >= 1e3 ? Math.round(v / 1e3) + ' mil' : v) } }; }
    else if (tipo === 'rsi') { ds = [{ type: 'line', label: 'IFR (14)', data: K.rsi(f, 14), borderColor: rgba(P.destaque), borderWidth: 1.75, pointRadius: 0 }, { type: 'line', label: '70', data: f.map(() => 70), borderColor: rgba(P.erro, 0.6), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }, { type: 'line', label: '30', data: f.map(() => 30), borderColor: rgba(P.ok, 0.7), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }]; y = { min: 0, max: 100, ticks: { color: rgba(P.suave), font: { family: 'Inter', size: 10 }, stepSize: 30 } }; }
    else { const m = K.macd(f); ds = [{ type: 'bar', label: 'Histograma', data: m.histograma, backgroundColor: m.histograma.map((v) => rgba(v >= 0 ? P.ok : P.erro, 0.55)) }, { type: 'line', label: 'MACD', data: m.linha, borderColor: rgba(P.destaque), borderWidth: 1.5, pointRadius: 0 }, { type: 'line', label: 'Sinal', data: m.sinal, borderColor: rgba(P.alerta), borderWidth: 1.25, pointRadius: 0 }]; y = { ticks: { color: rgba(P.suave), font: { family: 'Inter', size: 10 }, maxTicksLimit: 3 } }; }
    const ch = new Chart(canvas, { data: { labels, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: dica(P, rgba, { label: (c) => (c.raw == null || /^(70|30)$/.test(c.dataset.label) ? null : `${c.dataset.label}: ${num(c.raw, tipo === 'volume' ? 0 : 2)}`) }) },
      scales: eixos(P, rgba, { y: Object.assign({ position: 'right', grid: { color: rgba(P.linha, 0.5), drawTicks: false }, border: { display: false } }, y) }) } });
    vivos.set(canvas.id, ch); return ch;
  }

  // linha pequena (favoritos, cartões): sem eixos
  function mini(canvas, pontos) {
    if (typeof Chart === 'undefined' || !canvas || !pontos || pontos.length < 2) return null;
    destruir(canvas.id);
    const { p: P, rgba } = paleta();
    const subiu = pontos[pontos.length - 1].fechamento >= pontos[0].fechamento;
    const ch = new Chart(canvas, { type: 'line', data: { labels: pontos.map((p) => p.data), datasets: [{ data: pontos.map((p) => p.fechamento), borderColor: rgba(subiu ? P.ok : P.erro), borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } } });
    vivos.set(canvas.id, ch); return ch;
  }

  // genérico no padrão do sistema (linhas, rosca, barras) — para Carteira e Visão geral
  function padrao(canvas, tipo, dados, extra = {}) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    destruir(canvas.id);
    const { p: P, rgba } = paleta();
    let o;
    if (typeof mnOpcoesGrafico === 'function') o = mnOpcoesGrafico(tipo, P, extra);
    else o = { responsive: true, maintainAspectRatio: false };
    o.animation = false;
    if (extra.ajustar) extra.ajustar(o, P, rgba);
    const ch = new Chart(canvas, { type: tipo, data: dados(P, rgba), options: o });
    vivos.set(canvas.id, ch); return ch;
  }

  window.INVEST.graficos = { principal, inferior, mini, padrao, destruir, destruirTodos, paleta, semanal };
})();
