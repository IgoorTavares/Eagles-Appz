/* =====================================================================
   Investimentos · telas da v160 (Etapa 12.10): fundos (CVM), FII (informe mensal), energia, câmbio internacional,
   macro internacional e a calculadora do motor de renda fixa. Integra-se às abas existentes (sem aba nova):
   - Biblioteca: pesquisa de fundos (nome, CNPJ, subclasse) e a página do fundo;
   - Mercado BR: câmbio (PTAX × referências internacionais); Mercado US: energia, câmbio e macro internacional;
   - Visão geral: resumo internacional; Projeções: calculadora de renda fixa (contrato), sem gravar nada;
   - página do FII: PL, VPA, cotistas e P/VP só com preço de negociação compatível.
   Nada aqui inventa número: sem dado, o estado é "indisponível" com o motivo.
   ===================================================================== */
(function () {
  'use strict';
  const T = (window.INVEST.telas = window.INVEST.telas || {});
  const C = () => window.INVEST.ctx; const F = () => window.INVEST.fundos; const RF = () => window.INVEST.rendafixa;
  const nf = (v, c = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
  const pctTxt = (v, c = 2) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%');
  const brl = (v) => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '−' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const brlCurto = (v) => { if (v == null || !Number.isFinite(v)) return '—'; const a = Math.abs(v); const n = (x, c) => x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); return (v < 0 ? '−' : '') + 'R$ ' + (a >= 1e9 ? n(a / 1e9, 2) + ' bi' : a >= 1e6 ? n(a / 1e6, 1) + ' mi' : n(a, 0)); };
  const cent = (c) => brl(c / 100);
  const dBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  const cotaTxt = (txt) => { if (!txt) return '—'; const [i, d = ''] = String(txt).split('.'); return Number(i).toLocaleString('pt-BR') + (d ? ',' + d : ''); }; // mostra TODAS as casas publicadas
  const hoje = () => (typeof isoHoje === 'function' ? isoHoje() : new Date().toISOString().slice(0, 10));

  // ---------- Biblioteca: pesquisa de fundos ----------
  const BF = { aberto: false };
  T._buscaFundos = function (el, termo) {
    if (!el) return; const { E, S, estado } = C(); const c = C().carregadorDados(); const disp = c && c.fundos && c.fundos.disponivel();
    const titulo = '<div class="panel-title"><h2>Fundos de investimento (CVM)</h2></div>';
    if (!disp) { el.innerHTML = titulo + estado('info', 'Pesquisa de fundos indisponível', (c && c.fundos && c.fundos.motivo()) || 'Fonte desligada.'); return; }
    if (!BF.aberto && !S.fundos.indice) { el.innerHTML = titulo + `<p class="inv-muda">São cerca de 26 mil classes e subclasses de fundos com cota informada à CVM. A lista é baixada só quando você pede (cerca de 0,5 MB).</p><button type="button" class="btn" id="inv-fundos-abrir">Pesquisar também em fundos</button>`; el.querySelector('#inv-fundos-abrir').onclick = () => { BF.aberto = true; T._buscaFundos(el, termo); }; return; }
    if (!S.fundos.indice) { el.innerHTML = titulo + estado(S.fundos.estado === 'erro' ? 'erro' : 'carregando', S.fundos.estado === 'erro' ? 'Não foi possível carregar a lista de fundos' : 'Carregando a lista de fundos…', S.fundos.erro || ''); C().carregarIndiceFundos().then(() => { if (el.isConnected) T._buscaFundos(el, termo); }); return; }
    const t = String(termo || '').trim();
    const ix = S.fundos.indice; const res = t.length >= 3 ? F().pesquisar(ix, t, { limite: 30 }) : [];
    const integ = ix._integridade || {};
    el.innerHTML = titulo + `<p class="inv-muda">Base da CVM de ${E(dBr(ix.dataBase || ix.competencia))} · ${ix.itens.length.toLocaleString('pt-BR')} classes e subclasses com cota recente${integ.estado && integ.estado !== 'atual' ? ' · ' + C().tagEstado('desatualizado', 'último dado válido') : ''}. Pesquise por nome, CNPJ ou código da subclasse no campo acima.</p>` +
      (t.length < 3 ? '' : res.length ? `<div class="table-scroll"><table class="inv-tabela inv-tab-v160"><thead><tr><th>Fundo</th><th>Tipo</th><th>Situação</th><th>Última cota</th></tr></thead><tbody>${res.map((f) => `<tr class="inv-linha" data-id="${E(f.assetId)}" tabindex="0"><td data-label="Fundo"><strong>${E(f.nome)}</strong><span class="inv-muda"> · CNPJ ${E(window.INVEST.motor.fmtCnpj(f.cnpj))}${f.sub ? ' · subclasse ' + E(f.sub) : ''}</span>${f.agregado ? ' <span class="badge badge-neutral">classe (soma das subclasses)</span>' : ''}${f.listado ? ' <span class="badge badge-warning">negociado em bolsa</span>' : ''}</td><td data-label="Tipo">${E(f.tipo)}${f.classificacao ? ' · ' + E(f.classificacao) : ''}${f.condominio ? ' · ' + E(f.condominio) : ''}</td><td data-label="Situação">${E(f.situacao || '—')}</td><td data-label="Última cota">${E(dBr(f.ultimaData))}${f.defasado ? ' ' + C().tagEstado('desatualizado', 'sem cota recente') : ''}</td></tr>`).join('')}</tbody></table></div>`
        : estado('info', 'Nenhum fundo encontrado', 'Confira o nome ou o CNPJ. Fundos que pararam de informar cotas há mais de 2 meses não entram na lista.')) +
      `<p class="inv-muda inv-atribuicao">${E(ix.atribuicao)}. Licença: ${E(ix.licenca)}.</p>`;
    C().ligarLinhas(el);
  };

  // ---------- página do fundo ----------
  T._fundo = async function (host, id) {
    const { E, S, estado, cabecalho } = C();
    host.innerHTML = '<a href="#/biblioteca" class="inv-voltar">‹ Biblioteca</a>' + cabecalho('Fundo de investimento', 'Carregando os dados da CVM…') + `<div class="panel">${estado('carregando', 'Carregando…')}</div>`;
    const c = C().carregadorDados();
    if (!c || !c.fundos || !c.fundos.disponivel()) { host.innerHTML = '<a href="#/biblioteca" class="inv-voltar">‹ Biblioteca</a>' + cabecalho('Fundo de investimento', '') + `<div class="panel">${estado('info', 'Dados de fundos indisponíveis', (c && c.fundos && c.fundos.motivo()) || '')}</div>`; return; }
    const ok = await C().garantirFundos([id]);
    if (!host.isConnected) return;
    const a = C().porId(id);
    if (!a || !a.fundo) { host.innerHTML = '<a href="#/biblioteca" class="inv-voltar">‹ Biblioteca</a>' + cabecalho('Fundo não encontrado', '') + `<div class="panel">${estado('info', 'Este fundo não está na base atual da CVM', 'Ele pode ter parado de informar cotas, ter sido encerrado ou incorporado.')}</div>`; return; }
    const f = a.fundo; const h = S.fundos.hist.get(id); const nat = F().natureza(f); const disp = F().disponibilidade(f);
    const u = h ? F().ultima(h) : null; const r = h ? F().rentabilidades(h) : null; const meses = h ? F().meses(h) : [];
    const fav = S.fav && window.INVEST.motor.ehFavorito(S.fav, id);
    const q = S.motorReal ? S.motorReal.cotacao(a) : null;
    host.innerHTML = `<a href="#/biblioteca" class="inv-voltar">‹ Biblioteca</a>
      <div class="page-header inv-ativo-cab"><div class="inv-ativo"><span class="inv-logo inv-logo-g" aria-hidden="true">${E((f.tipo || 'FI').slice(0, 4))}</span><div><h1>${E(f.nome)}</h1>
        <p><span class="badge badge-blue">Fundo ${E(f.tipo || '')}</span>${f.classificacao ? ` <span class="badge badge-neutral">${E(f.classificacao)}</span>` : ''} <span class="badge badge-neutral">${E(f.condominio || 'Condomínio não informado')}</span>${f.agregado ? ' <span class="badge badge-neutral">Classe (soma das subclasses)</span>' : ''}${f.listado ? ' <span class="badge badge-warning">Negociado em bolsa</span>' : ''}</p></div></div>
        ${S.acesso.favoritos && S.fav ? `<div class="inv-fav-acoes"><button type="button" class="btn ${fav ? '' : 'btn-primary'}" id="inv-fav-fundo" aria-pressed="${fav}">${C().estrela(fav)} ${fav ? 'Nos favoritos' : 'Favoritar'}</button></div>` : ''}</div>
      ${nat.motivo ? `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>A cota da CVM não avalia a carteira.</strong> ${E(nat.motivo)}.</div>` : ''}
      ${disp.length ? `<div class="inv-faixa inv-faixa-info" role="note"><strong>Disponibilidade:</strong> ${disp.map(E).join(' · ')}. Estar na base da CVM não significa que o fundo aceita novas aplicações.</div>` : ''}
      <div class="inv-grade">
        <div class="panel inv-largo"><div class="panel-title"><h2>Cota oficial</h2></div>${u ? `<div class="inv-cards">
          <div class="inv-card"><span>Cota em ${E(dBr(u[0]))}</span><strong>R$ ${E(cotaTxt(u[1]))}</strong>${C().tagEstado(q && q.estado === 'desatualizado' || f.defasado ? 'desatualizado' : 'fechamento', q && q.estado === 'desatualizado' || f.defasado ? 'sem cota recente' : 'fechamento (D-1)')}</div>
          <div class="inv-card"><span>Patrimônio líquido</span><strong>${E(brlCurto(u[2]))}</strong></div>
          <div class="inv-card"><span>Captação no dia</span><strong>${E(brlCurto(u[3]))}</strong></div><div class="inv-card"><span>Resgates no dia</span><strong>${E(brlCurto(u[4]))}</strong></div>
          <div class="inv-card"><span>Cotistas</span><strong>${u[5] == null ? '—' : E(u[5].toLocaleString('pt-BR'))}</strong></div></div>
          <p class="inv-muda">Cota com todas as casas decimais publicadas pela CVM. É líquida das taxas do fundo e bruta de IR e IOF de quem investe. Data de competência: ${E(dBr(u[0]))}.</p>`
          : estado('info', 'Sem cota válida', ok ? 'O fundo não informou cota positiva no período coberto.' : 'O histórico deste fundo não pôde ser carregado agora.')}</div>
        <div class="panel"><div class="panel-title"><h2>Rentabilidade pela cota</h2></div>${r ? `<ul class="inv-macro inv-macro-v160">
          <li>No mês (desde ${E(dBr(r.mes && r.mes.de))})<strong>${E(pctTxt(r.mes && r.mes.valor))}</strong></li>
          <li>No ano (desde ${E(dBr(r.ano && r.ano.de))})<strong>${E(pctTxt(r.ano && r.ano.valor))}</strong></li>
          <li>Em 12 meses (desde ${E(dBr(r.m12 && r.m12.de))})<strong>${E(pctTxt(r.m12 && r.m12.valor))}</strong></li></ul>
          <p class="inv-muda">"—" = falta a cota da data de partida na base (não estimamos). Rentabilidade passada não garante resultado futuro.</p>` : estado('info', 'Indisponível', '')}</div>
        <div class="panel"><div class="panel-title"><h2>Identificação</h2></div><div class="table-scroll"><table class="inv-tabela inv-ident inv-tab-v160"><tbody>
          <tr><td>Identificador único</td><td>${E(id)}</td></tr><tr><td>CNPJ da classe</td><td>${E(window.INVEST.motor.fmtCnpj(f.cnpj))}</td></tr>${f.sub ? `<tr><td>Subclasse (ID CVM)</td><td>${E(f.sub)}</td></tr>` : ''}
          <tr><td>Situação na CVM</td><td>${E(f.situacao || '—')}</td></tr><tr><td>Público-alvo</td><td>${E(f.publico || '—')}</td></tr><tr><td>Exclusivo</td><td>${f.exclusivo === 'S' ? 'Sim' : f.exclusivo === 'N' ? 'Não' : '—'}</td></tr>
          <tr><td>Tributação</td><td>${E(f.tributacaoLP)}</td></tr><tr><td>Previdenciário</td><td>${f.previdenciario ? 'Sim' : 'Não informado'}</td></tr></tbody></table></div></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Gráfico da cota</h2></div><div id="inv-fundo-graf"></div></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Mês a mês</h2></div>${meses.length ? `<div class="table-scroll"><table class="inv-tabela inv-tab-v160"><thead><tr><th>Mês</th><th class="cad-num">Cota (último dia)</th><th class="cad-num">PL no fim</th><th class="cad-num">Captação</th><th class="cad-num">Resgates</th><th class="cad-num">Cotistas</th></tr></thead><tbody>
          ${meses.slice().reverse().map((m) => `<tr><td data-label="Mês">${E(m.mes.split('-').reverse().join('/'))}</td><td data-label="Cota" class="cad-num">${E(cotaTxt(m.cota))}</td><td data-label="PL" class="cad-num">${E(brlCurto(m.pl))}</td><td data-label="Captação" class="cad-num">${E(brlCurto(m.captacao))}</td><td data-label="Resgates" class="cad-num">${E(brlCurto(m.resgate))}</td><td data-label="Cotistas" class="cad-num">${m.cotistas == null ? '—' : E(m.cotistas.toLocaleString('pt-BR'))}</td></tr>`).join('')}</tbody></table></div>` : estado('info', 'Sem histórico mensal', '')}</div>
        <div class="panel"><div class="panel-title"><h2>Na carteira</h2></div><p>${nat.avalia ? `Para lançar, abra <a href="#/carteira">Minha carteira</a> → Lançar operação e escolha o código <strong>${E(a.ticker)}</strong> (quantidade de cotas e valor da cota da nota de aplicação). A carteira passa a ser avaliada pela cota oficial.` : 'Este fundo pode ser lançado na carteira, mas fica sem avaliação automática (o motivo está no aviso acima): informe o preço manualmente se quiser acompanhar.'}</p></div>
      </div>
      <p class="inv-muda inv-atribuicao">${E(F().ATRIBUICAO)}. Licença: ${E(F().LICENCA)}. A base derivada usada aqui também é aberta (ODbL).</p>`;
    const g = host.querySelector('#inv-fundo-graf'); const mu = window.INVEST.mercadoUi;
    if (g && mu && mu.painelGrafico) mu.painelGrafico(g, a, { sufixo: 'fundo' });
    const b = host.querySelector('#inv-fav-fundo'); if (b) b.onclick = () => C().alternarFav(id, null);
  };

  // ---------- página do FII: informe mensal da CVM ----------
  T._fiiMensal = async function (el, a) {
    const { E, S, estado } = C(); const c = C().carregadorDados(); const tit = '<div class="panel-title"><h2>Informe mensal (CVM)</h2></div>';
    if (!c || !c.fundos || !c.fundos.disponivel()) { el.innerHTML = tit + estado('info', 'Indisponível', (c && c.fundos && c.fundos.motivo()) || ''); return; }
    el.innerHTML = tit + estado('carregando', 'Carregando o informe mensal…');
    if (!S._fii) S._fii = c.fundos.fii(); const j = await S._fii; if (!el.isConnected) return;
    if (!j) { S._fii = null; el.innerHTML = tit + estado('erro', 'Informe mensal indisponível agora', 'Falha de rede ou de conferência de integridade. Tente de novo mais tarde.'); return; }
    const cnpj = String((a.ids && a.ids.cnpj) || '').replace(/\D/g, ''); const x = j.fundos[cnpj] || Object.values(j.fundos).find((y) => y.assetId === a.assetId);
    if (!x || !x.historico.length) { el.innerHTML = tit + estado('info', 'Sem informe para este FII', 'A CVM não trouxe informe mensal deste fundo no período coberto.'); return; }
    const u = x.historico[x.historico.length - 1];
    const q = S.motorReal ? S.motorReal.cotacao(a) : null; const pv = F().pvp(u, q && q.real ? q : null);
    el.innerHTML = tit + `<div class="inv-cards">
      <div class="inv-card"><span>Patrimônio líquido</span><strong>${E(brlCurto(u.pl))}</strong></div>
      <div class="inv-card"><span>Valor patrimonial por cota (VPA)</span><strong>${u.vpa == null ? '—' : 'R$ ' + E(nf(u.vpa, 2))}</strong>${u.vpaCalculado ? '<small class="inv-muda">PL ÷ cotas</small>' : ''}</div>
      <div class="inv-card"><span>Cotistas</span><strong>${u.cotistas == null ? '—' : E(u.cotistas.toLocaleString('pt-BR'))}</strong></div>
      <div class="inv-card"><span>P/VP</span><strong>${pv.valor == null ? '—' : E(nf(pv.valor, 2))}</strong><small class="inv-muda">${E(pv.valor == null ? pv.motivo : 'preço de ' + dBr(pv.base.precoData))}</small></div></div>
      <p class="inv-muda">Competência ${E(u.competencia.split('-').reverse().join('/'))}. <strong>VPA não é cotação:</strong> é o patrimônio dividido pelas cotas; o preço na bolsa pode ser bem diferente.</p>
      <div class="table-scroll"><table class="inv-tabela inv-tab-v160"><thead><tr><th>Competência</th><th class="cad-num">PL</th><th class="cad-num">VPA</th><th class="cad-num">Cotistas</th><th class="cad-num">Rend. distribuído (mês)</th><th class="cad-num">Rentab. patrimonial</th></tr></thead><tbody>
      ${x.historico.slice().reverse().map((m) => `<tr><td data-label="Competência">${E(m.competencia.split('-').reverse().join('/'))}</td><td data-label="PL" class="cad-num">${E(brlCurto(m.pl))}</td><td data-label="VPA" class="cad-num">${m.vpa == null ? '—' : E(nf(m.vpa, 2))}</td><td data-label="Cotistas" class="cad-num">${m.cotistas == null ? '—' : E(m.cotistas.toLocaleString('pt-BR'))}</td><td data-label="Rendimento" class="cad-num">${E(pctTxt(m.dy, 2))}</td><td data-label="Rentab." class="cad-num">${E(pctTxt(m.rentPatrimonial, 2))}</td></tr>`).join('')}</tbody></table></div>
      <p class="inv-muda inv-atribuicao">${E(j.atribuicao)}. Licença: ${E(j.licenca)}. Percentuais como informados pelo fundo à CVM.</p>`;
  };

  // ---------- painéis internacionais (Mercado BR/US e Visão geral) ----------
  const FONTE_NOME = { bce: 'BCE', h10: 'Fed H.10', boc: 'Banco do Canadá' };
  function energiaHtml() {
    const { E, S, estado, tagEstado } = C(); const e = S.dadosReais && S.dadosReais.energia;
    if (!e) return estado('info', 'Energia indisponível', 'O arquivo de energia (EIA via FRED) não foi carregado.');
    const est = (d) => window.INVEST.dados.estadoPelaIdade(d, hoje(), 7);
    return `<ul class="inv-macro inv-macro-v160">${Object.values(e.series).map((x) => `<li><span>${E(x.nome)}<small class="inv-muda"> · ${E(x.unidade)}</small></span><strong>US$ ${E(nf(x.valor, 2))}</strong>${tagEstado(est(x.dataRef))}<small class="inv-muda">ref. ${E(dBr(x.dataRef))}</small></li>`).join('')}
      ${Object.entries(e.desligadas || {}).map(([k, m]) => `<li><span>${k === 'GAS_HH' ? 'Gás natural Henry Hub' : E(k)}</span><strong>—</strong><span class="badge badge-neutral">Desligado</span><small class="inv-muda">${E(m)}</small></li>`).join('')}</ul>
      <p class="inv-muda">Preços À VISTA (spot) de referência publicados pela EIA. Não são contratos futuros nem preço de negociação. ${E((Object.values(e.series)[0] || {}).atribuicao || '')}. Domínio público.</p>`;
  }
  function cambioHtml(pais) {
    const { E, S, estado } = C(); const ci = S.dadosReais && S.dadosReais.cambioInt; const regs = (S.dadosReais && S.dadosReais.registros) || {};
    if (!ci) return estado('info', 'Câmbio internacional indisponível', 'O arquivo de câmbio internacional não foi carregado.');
    const ptax = regs['BR:MACRO:PTAX'];
    const lin = Object.entries(ci.pares).filter(([, p]) => (pais === 'BR' ? p.cotada === 'BRL' || p.base === 'BRL' : true)).sort((a, b) => (a[1].base + a[1].cotada).localeCompare(b[1].base + b[1].cotada));
    return (pais === 'BR' && ptax ? `<p><strong>Referência oficial no Brasil: PTAX</strong> (Banco Central) — dólar ${E(nf(ptax.valor, 4))} em ${E(dBr(ptax.dataRef))}. As taxas abaixo são referências de outros bancos centrais, de outros horários: servem para comparar, não substituem a PTAX.</p>` : '') +
      `<div class="table-scroll"><table class="inv-tabela inv-tab-v160"><thead><tr><th>Par</th><th class="cad-num">Valor</th><th>Tipo</th><th>Fonte</th><th>Data</th></tr></thead><tbody>${lin.map(([, p]) => `<tr><td data-label="Par">1 ${E(p.base)} = … ${E(p.cotada)}</td><td data-label="Valor" class="cad-num">${E(nf(p.valor, 4))}</td><td data-label="Tipo">${E(p.tipo === 'compra' ? 'compra (meio-dia, NY)' : p.tipo === 'media' ? 'média diária' : 'referência')}</td><td data-label="Fonte">${E(FONTE_NOME[p.fonte] || p.fonte)}</td><td data-label="Data">${E(dBr(p.dataRef))}</td></tr>`).join('')}</tbody></table></div>
      ${ci.conferencias && ci.conferencias.length ? `<p class="inv-muda">Conferência cruzada (mesma data, caminhos diferentes): ${ci.conferencias.map((c) => `${E(c.teste)}: diferença de ${E(nf(c.difPct, 2))}% ${c.ok ? '✓' : '⚠'}`).join(' · ')}.</p>` : ''}
      <p class="inv-muda inv-atribuicao">${E(ci.nota)} Fontes: Banco Central Europeu (reutilização com citação); Federal Reserve H.10 via FRED® (domínio público); Bank of Canada (uso livre com atribuição).</p>`;
  }
  const IND_ORDEM = ['PIB_CRESC', 'INFLACAO', 'DESEMPREGO', 'DIVIDA', 'CONTA_CORRENTE', 'PIB_USD', 'PIB_PC', 'POPULACAO'];
  function macroIntHtml() {
    const { E, S, estado } = C(); const m = S.dadosReais && S.dadosReais.macroInt;
    if (!m) return estado('info', 'Macro internacional indisponível', 'O arquivo do Banco Mundial não foi carregado.');
    const paises = Object.entries(m.paises); const inds = IND_ORDEM.filter((k) => paises.some(([, p]) => p.indicadores[k]));
    const fmt = (k, i) => { if (!i) return '—'; if (k === 'PIB_USD') return 'US$ ' + nf(i.valor / 1e12, 2) + ' tri'; if (k === 'PIB_PC') return 'US$ ' + nf(i.valor, 0); if (k === 'POPULACAO') return nf(i.valor / 1e6, 1) + ' mi'; return nf(i.valor, 1) + '%'; };
    const nome = (k) => { const i = paises.map(([, p]) => p.indicadores[k]).find(Boolean); return i ? i.nome : k; };
    return `<div class="table-scroll"><table class="inv-tabela inv-tab-v160"><thead><tr><th>País</th>${inds.map((k) => `<th class="cad-num">${E(nome(k))}</th>`).join('')}</tr></thead><tbody>
      ${paises.map(([, p]) => `<tr><td data-label="País">${E(p.nome)}</td>${inds.map((k) => { const i = p.indicadores[k]; return `<td data-label="${E(nome(k))}" class="cad-num">${E(fmt(k, i))}${i ? `<small class="inv-muda"> ${E(i.ano)}</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="inv-muda">Indicadores ANUAIS (o ano aparece ao lado de cada número), revisados pela fonte de tempos em tempos — não são dados em tempo real. Revisão do Banco Mundial: ${E(dBr((paises[0] && Object.values(paises[0][1].indicadores)[0] || {}).revisao))}.</p>
      <p class="inv-muda inv-atribuicao">${E(m.atribuicao)}. Licença conferida em cada indicador.</p>`;
  }
  function resumoInternacionalHtml() {
    const { E, S } = C(); const e = S.dadosReais && S.dadosReais.energia; const ci = S.dadosReais && S.dadosReais.cambioInt;
    const itens = [];
    if (e) for (const x of Object.values(e.series)) itens.push([x.nome.split(' — ')[0], 'US$ ' + nf(x.valor, 2), x.dataRef]);
    if (ci) for (const k of ['EURUSD:bce', 'USDJPY:h10', 'GBPUSD:h10']) { const p = ci.pares[k]; if (p) itens.push([`${p.base}/${p.cotada} (${FONTE_NOME[p.fonte]})`, nf(p.valor, 4), p.dataRef]); }
    if (!itens.length) return '';
    return `<div class="panel"><div class="panel-title"><h2>Mercados internacionais</h2></div><ul class="inv-macro inv-macro-v160">${itens.map(([n, v, d]) => `<li><span>${E(n)}</span><strong>${E(v)}</strong><small class="inv-muda">ref. ${E(dBr(d))}</small></li>`).join('')}</ul><p class="inv-muda">Referências oficiais (EIA, BCE, Fed). Detalhes em <a href="#/us">Mercado US</a>.</p></div>`;
  }
  window.INVEST.internacional = { energiaHtml, cambioHtml, macroIntHtml, resumoInternacionalHtml };

  // ---------- Projeções: calculadora de renda fixa (contrato) — biblioteca pura, nada é gravado ----------
  const RFS = { form: null, res: null };
  function seriesDoRetrato() {
    const S = C().S; const pts = (S.dadosReais && S.dadosReais.series) || {}; const out = { cdi: {}, ipca: {} };
    for (const p of pts['BR:MACRO:CDI'] || []) out.cdi[p.data] = p.valor;
    for (const p of pts['BR:MACRO:IPCA'] || []) out.ipca[p.data.slice(0, 7)] = p.valor;
    return out;
  }
  T._calcRendaFixa = function (el) {
    if (!el || !RF()) return; const { E, estado } = C();
    const f = RFS.form || { tipo: 'CDB', indexador: 'CDI_PCT', taxa: 100, aplicacao: '', valor: 10000, data: hoje(), vencimento: '', liquidez: 'diaria', investidor: 'PF', isencao: false, carencia: '' };
    const tipos = RF().TIPOS.filter((t) => t !== 'OUTRO'); const idx = [['PRE', 'Prefixado (% a.a.)'], ['CDI_PCT', '% do CDI'], ['CDI_SPREAD', 'CDI + taxa (% a.a.)'], ['IPCA_SPREAD', 'IPCA + taxa (% a.a.)']];
    const sr = seriesDoRetrato(); const temCdi = Object.keys(sr.cdi).length > 0;
    el.innerHTML = `<div class="panel-title"><h2>Calculadora de renda fixa (contrato)</h2></div>
      <p class="inv-muda">Calcula o saldo de um CDB, LCI, LCA, LC, LF, debênture, CRI ou CRA pelo CONTRATO, com o CDI e o IPCA oficiais do Banco Central já publicados. Nada é gravado. ${temCdi ? '' : 'Os índices do Banco Central ainda não carregaram: o cálculo pós-fixado fica indisponível.'}</p>
      <form class="form-grid" id="inv-rf-form">
        <div class="field"><label>Tipo<select name="tipo">${tipos.map((t) => `<option${t === f.tipo ? ' selected' : ''}>${E(t)}</option>`).join('')}</select></label></div>
        <div class="field"><label>Indexador<select name="indexador">${idx.map(([k, n]) => `<option value="${k}"${k === f.indexador ? ' selected' : ''}>${E(n)}</option>`).join('')}</select></label></div>
        <div class="field"><label>Taxa do contrato<input name="taxa" type="number" step="0.01" min="-10" max="300" value="${E(f.taxa)}" required></label></div>
        <div class="field"><label>Valor aplicado (R$)<input name="valor" type="number" step="0.01" min="1" max="100000000" value="${E(f.valor)}" required></label></div>
        <div class="field"><label>Data da aplicação<input name="aplicacao" type="date" max="${hoje()}" value="${E(f.aplicacao)}" required></label></div>
        <div class="field"><label>Vencimento<input name="vencimento" type="date" value="${E(f.vencimento)}" required></label></div>
        <div class="field"><label>Calcular em<input name="data" type="date" max="${hoje()}" value="${E(f.data)}" required></label></div>
        <div class="field"><label>Liquidez<select name="liquidez"><option value="diaria"${f.liquidez === 'diaria' ? ' selected' : ''}>Diária</option><option value="carencia"${f.liquidez === 'carencia' ? ' selected' : ''}>Depois da carência</option><option value="vencimento"${f.liquidez === 'vencimento' ? ' selected' : ''}>Só no vencimento</option></select></label></div>
        <div class="field"><label>Carência até (opcional)<input name="carencia" type="date" value="${E(f.carencia)}"></label></div>
        <div class="field"><label>Investidor<select name="investidor"><option value="PF"${f.investidor === 'PF' ? ' selected' : ''}>Pessoa física</option><option value="PJ"${f.investidor === 'PJ' ? ' selected' : ''}>Pessoa jurídica</option></select></label></div>
        <div class="field full"><label class="inv-check"><input type="checkbox" name="isencao"${f.isencao ? ' checked' : ''}> A isenção de IR está confirmada na nota/contrato deste título (só vale para pessoa física e só para os tipos que a lei permite)</label></div>
        <div class="field full"><button class="btn btn-primary" type="submit">Calcular</button></div>
      </form><div id="inv-rf-res" aria-live="polite">${RFS.res || ''}</div>
      <p class="inv-muda">Regras: ${E(RF().TRIBUTOS[0].versao)} (conferidas em ${E(dBr(RF().TRIBUTOS[0].conferidaEm))}): ${E(RF().TRIBUTOS[0].fontes.slice(0, 3).join('; '))}. Simulação, não é recomendação nem extrato do banco.</p>`;
    el.querySelector('#inv-rf-form').addEventListener('submit', (ev) => {
      ev.preventDefault(); const x = Object.fromEntries(new FormData(ev.target).entries());
      RFS.form = { tipo: x.tipo, indexador: x.indexador, taxa: Number(x.taxa), valor: Number(x.valor), aplicacao: x.aplicacao, vencimento: x.vencimento, data: x.data, liquidez: x.liquidez, carencia: x.carencia, investidor: x.investidor, isencao: !!x.isencao };
      RFS.res = calcular(RFS.form); T._calcRendaFixa(el);
    });
  };
  function calcular(f) {
    const { E, estado } = C();
    try {
      const c = { tipo: f.tipo, emissao: f.aplicacao, vencimento: f.vencimento, indexador: f.indexador, taxa: f.taxa, liquidez: f.liquidez, isencaoConfirmada: f.isencao };
      if (f.carencia) c.carencia = f.carencia;
      const v = RF().validarContrato(c); if (!v.ok) return estado('erro', 'Confira o contrato', v.erros.join('; '));
      const valor = Math.round(f.valor * 100); if (!(valor > 0)) return estado('erro', 'Valor inválido', '');
      const p = RF().posicao(c, [{ data: f.aplicacao, valor }], seriesDoRetrato(), f.data, { investidor: f.investidor });
      const l = p.lotes[0] || {};
      const linha = (n, v, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${E(n)}</td><td class="cad-num">${v}</td></tr>`;
      return `<div class="table-scroll"><table class="inv-tabela inv-ident inv-tab-v160"><tbody>
        ${linha('Capital aplicado', E(cent(p.capitalAplicado)))}${linha('Principal remanescente', E(cent(p.principalRemanescente)))}
        ${linha('Saldo contratual bruto (curva)', '<strong>' + E(cent(p.saldoContratualBruto)) + '</strong>')}${linha('Rendimento bruto', E(cent(p.rendimento)))}
        ${linha('Juros pagos / amortizações', E(cent(p.jurosPagos)) + ' / ' + E(cent(p.amortizacoesPagas)))}
        ${linha(`IOF (${nf(l.percIOF, 0)}% do rendimento)`, E(cent(p.iof)))}${linha(`IR (${nf(l.aliquotaIR, 1)}%${l.tributacaoConfirmada === false ? ', isenção não confirmada' : ''})`, E(cent(p.ir)))}${linha('Taxas', E(cent(p.taxas)))}
        ${linha('Saldo líquido estimado', '<strong>' + E(cent(p.saldoLiquidoEstimado)) + '</strong>')}${linha('Valor estimado de resgate', p.valorEstimadoResgate == null ? 'indisponível' : E(cent(p.valorEstimadoResgate)))}
        ${linha('Marcação a mercado', E(p.marcacaoMercado.valor == null ? 'indisponível' : cent(p.marcacaoMercado.valor)))}${linha('Calculado até', E(dBr(p.calculadoAte)) + (p.completo ? '' : ' (índice ainda não publicado depois disso)'))}
        </tbody></table></div>${p.avisos.length ? `<ul class="inv-lista">${p.avisos.map((a) => `<li>${E(a)}</li>`).join('')}</ul>` : ''}
        <p class="inv-muda">${E(p.marcacaoMercado.motivo)}</p>`;
    } catch (e) { return estado('erro', 'Não foi possível calcular', String(e.message || e)); }
  }
})();
