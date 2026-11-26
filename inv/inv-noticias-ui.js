/* =====================================================================
   Investimentos · Etapa 08 — Visão geral, Favoritos (com gráficos, comparação,
   alertas e calendário), Notícias e insights, e a IA (preparada, desligada).
   Leituras no banco: favoritos (1), alertas (1, só ao abrir Favoritos ou a Visão
   geral), carteira selecionada (já em memória se a aba Carteira foi aberta).
   Notícias: arquivo estático de TESTE (0 leituras); fontes reais dependem do servidor.
   ===================================================================== */
(function () {
  'use strict';
  const K = window.INVEST.mercado, CT = window.INVEST.carteira, N = window.INVEST.noticias, AN = window.INVEST.analise, IA = window.INVEST.ia, G = window.INVEST.graficos;
  const T = (window.INVEST.telas = window.INVEST.telas || {});
  const C = () => window.INVEST.ctx; const U = () => window.INVEST.mercadoUi; const CU = () => window.INVEST.carteiraUi; const W = () => window.INVEST.carteiraEstado;
  const hoje = () => (typeof isoHoje === 'function' ? isoHoje() : C().M.diaHoje());

  // ---------- notícias (News Engine) ----------
  const NT = { estado: 'nao-lido', itens: [], removidas: 0, erros: [], teste: false, cat: 'todas' };
  function favoritosAtivos() { const { S } = C(); if (!S.fav) return []; const ids = new Set(S.fav.listas.flatMap((l) => l.ativos)); return [...ids].map((id) => C().porId(id)).filter(Boolean); }
  let noticiasEmCurso = null;
  function carregarNoticias() { if (!noticiasEmCurso) noticiasEmCurso = carregarNoticias0().finally(() => { noticiasEmCurso = null; }); return noticiasEmCurso; }
  async function carregarNoticias0() {
    if (NT.estado === 'ok') return;
    // sem servidor, nenhuma fonte real de notícias está ligada; as notícias FICTÍCIAS de teste só aparecem no modo
    // demonstração (que não existe no site publicado)
    if (!C().S.simulador) { Object.assign(NT, { estado: 'ok', itens: [], removidas: 0, erros: [], teste: false, semFonte: true }); return; }
    NT.estado = 'carregando';
    try {
      const r = await fetch('inv/noticias-teste.xml', { cache: 'no-cache' });
      if (!r.ok) throw new Error('feed indisponível (' + r.status + ')');
      const p = N.processar({ teste: await r.text() }, favoritosAtivos());
      Object.assign(NT, p, { estado: 'ok' });
    } catch (e) { NT.estado = 'erro'; NT.erros = [String(e.message || e)]; }
  }
  const reclassificar = () => { if (NT.estado === 'ok') NT.itens = NT.itens.map((n) => N.classificar(n, favoritosAtivos())); };
  function itemNoticia(n) {
    const { E } = C(); const F = N.FONTES[n.fonte] || {};
    return `<li class="inv-noticia"><a href="${E(n.link)}" target="_blank" rel="noopener noreferrer nofollow">${E(n.titulo)} ↗</a>
      <p>${E(n.resumo)}</p>
      <span class="inv-muda">${E(F.nome || n.fonte)} · ${n.data ? E(n.data.slice(0, 10).split('-').reverse().join('/')) + ' ' + E(n.data.slice(11, 16)) : 'sem data'}${n.repetidaEm ? ' · ' + n.repetidaEm.length + ' cópia(s) repetida(s) removida(s)' : ''}</span>
      <span class="inv-tags">${n.categorias.map((c) => `<span class="badge badge-neutral">${E(N.NOME_CAT[c] || c)}</span>`).join(' ')}${F.tipo === 'teste' ? ' <span class="inv-estado inv-estado-teste">Teste</span>' : ''}</span></li>`;
  }
  T._ativoNoticias = async function (host, a) {
    if (!host) return; await carregarNoticias(); if (!host.isConnected) return;
    const lista = N.classificar ? NT.itens.map((n) => N.classificar(n, [a])).filter((n) => n.ativos.includes(a.assetId)) : [];
    host.innerHTML = `<div class="panel-title"><h2>Notícias relacionadas</h2></div>` + (lista.length ? `<ul class="inv-noticias">${lista.slice(0, 5).map(itemNoticia).join('')}</ul>` : C().estado('info', 'Nenhuma notícia sobre este ativo', NT.teste ? 'Só as notícias de TESTE estão ligadas; as fontes oficiais dependem do servidor (D-10).' : 'Sem fonte de notícias ligada.'));
  };

  // ---------- alertas (um documento por pessoa) ----------
  const AL = { estado: 'nao-lido', itens: [] };
  let alertasEmCurso = null; // pedidos repetidos (Visão geral + Favoritos) aproveitam a mesma leitura
  function carregarAlertas() { if (!alertasEmCurso) alertasEmCurso = carregarAlertas0().finally(() => { alertasEmCurso = null; }); return alertasEmCurso; }
  async function carregarAlertas0() {
    const { S, invDb, ehNuvem } = C();
    if (AL.estado === 'ok' || !ehNuvem() || !S.acesso.favoritos) return;
    try { const s = await invDb.ler(`tenants/${TENANT_ID}/inv_alertas/${USUARIO_UID}`, 'abrir-alertas'); AL.itens = s.exists && Array.isArray(s.data().itens) ? s.data().itens.filter(AN.validarAlerta) : []; AL.estado = 'ok'; }
    catch (e) { AL.estado = 'erro'; }
  }
  async function salvarAlertas(novos) {
    const { invDb } = C();
    await invDb.gravar(`tenants/${TENANT_ID}/inv_alertas/${USUARIO_UID}`, { itens: novos, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, 'salvar-alertas');
    AL.itens = novos;
  }
  // alertas e insights usam SÓ preço autorizado ou manual (motor de avaliação); simulado nunca dispara alerta
  const cotacaoDe = (id) => { const a = C().porId(id); return a ? C().S.motorReal.cotacao(a) : null; };
  function alertasDisparados() { return AN.avaliarAlertas(AL.itens, cotacaoDe).filter((x) => x.disparou); }
  const textoAlerta = (a) => { const at = C().porId(a.assetId); const tk = at ? at.ticker : a.assetId; return a.tipo === 'acima' ? `${tk} acima de ${U().nf(a.valor)}` : a.tipo === 'abaixo' ? `${tk} abaixo de ${U().nf(a.valor)}` : `${tk} variar ${U().nf(a.valor)}% ou mais no dia`; };

  // ---------- FAVORITOS (substitui a tela da Etapa 05: mesmas listas, agora com cotação, gráficos e alertas) ----------
  const FV = { lista: null, comparar: false };
  T.favoritos = async function (host) {
    const ctx = C(); const { S, E, estado, cabecalho, tagEstado } = ctx;
    if (!S.acesso.favoritos) { host.innerHTML = cabecalho('Favoritos', '') + `<div class="panel">${estado('info', 'Favoritos indisponíveis para este acesso', S.acesso.admin ? 'O Super Admin usa a Biblioteca e os Mercados sem favoritos (eles pertencem às pessoas de cada empresa).' : 'Entre com o login da empresa para usar favoritos.')}</div>`; return; }
    if (S.estadoFav === 'carregando' || S.estadoCat !== 'ok') { host.innerHTML = cabecalho('Favoritos', '') + `<div class="panel">${estado('carregando', 'Carregando seus favoritos…')}</div>`; return; }
    if (S.estadoFav === 'erro') { host.innerHTML = cabecalho('Favoritos', '') + `<div class="panel">${estado('erro', 'Não foi possível abrir seus favoritos', 'Confira a internet e tente de novo.', '<button type="button" class="btn btn-primary" id="inv-tentar-fav">Tentar de novo</button>')}</div>`; host.querySelector('#inv-tentar-fav').onclick = async () => { S.estadoFav = 'carregando'; ctx.desenhar(); await ctx.carregarFavoritos(); ctx.desenhar(); }; return; }
    await Promise.all([carregarAlertas(), carregarNoticias()]); reclassificar();
    if (ctx.rota().aba !== 'favoritos') return;
    const lista = S.fav.listas.find((l) => l.id === FV.lista) || S.fav.listas[0]; FV.lista = lista.id;
    const ativos = lista.ativos.map((id) => ({ id, a: C().porId(id) }));
    const cot = ativos.map((x) => (x.a ? S.motor.cotacao(x.a) : null));
    const disparos = alertasDisparados();
    const total = S.fav.listas.reduce((s, l) => s + l.ativos.length, 0);
    const noticias = NT.itens.filter((n) => n.ativos.some((id) => lista.ativos.includes(id)));
    // calendário: proventos que VOCÊ lançou nas carteiras (dados reais seus); eventos futuros dependem de fonte autorizada
    const opsTodas = Object.values(W().ops || {}).flat();
    const proventos = opsTodas.filter((o) => CT.TIPOS[o.tipo] && CT.TIPOS[o.tipo].provento && lista.ativos.includes(o.assetId)).sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 8);
    host.innerHTML = cabecalho('Favoritos', `${S.fav.listas.length} lista(s) · ${total} ativo(s) · só você vê`, '<button type="button" class="btn btn-primary" id="inv-nova-lista">+ Nova lista</button>') +
      U().faixaSimulado(cot) +
      (disparos.length ? `<div class="inv-faixa inv-faixa-aviso" role="status"><strong>Alertas disparados:</strong> ${disparos.map((d) => E(textoAlerta(d.alerta)) + ` (agora ${E(U().nf(d.preco))}, ${E((K.ESTADOS[d.estado] || {}).rotulo || d.estado)})`).join(' · ')}</div>` : '') + `
      <div class="panel inv-ct-barra"><div class="inv-seg-grupo" role="group" aria-label="Listas">${S.fav.listas.map((l) => `<button type="button" class="inv-seg${l.id === lista.id ? ' on' : ''}" data-lista-sel="${E(l.id)}" aria-pressed="${l.id === lista.id}">${E(l.nome)} <small>${l.ativos.length}</small></button>`).join('')}</div>
        <div class="inv-acoes-topo"><button type="button" class="btn btn-small btn-ghost" data-renomear="${E(lista.id)}">Renomear</button>${S.fav.listas.length > 1 ? `<button type="button" class="btn btn-small btn-ghost inv-perigo" data-excluir="${E(lista.id)}">Excluir lista</button>` : ''}${lista.ativos.length > 1 ? `<button type="button" class="btn btn-small" id="inv-fav-comparar" aria-pressed="${FV.comparar}">${FV.comparar ? 'Fechar comparação' : 'Comparar a lista'}</button>` : ''}</div></div>
      ${FV.comparar && lista.ativos.length > 1 ? '<div class="panel"><div class="panel-title"><h2>Comparação</h2><span>variação % no período</span></div><div data-comp></div></div>' : ''}
      <div class="panel">${ativos.length ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Ativo</th><th class="cad-num">Preço</th><th class="cad-num">Dia</th><th>3 meses</th><th></th></tr></thead><tbody>
        ${ativos.map((x, i) => { const q = cot[i]; const a = x.a; return `<tr class="inv-linha" data-id="${E(x.id)}" tabindex="0">
          <td data-label="Ativo">${a ? `<div class="inv-ativo"><span class="inv-logo" aria-hidden="true">${E(a.ticker.slice(0, 4))}</span><div><strong>${E(a.ticker)}</strong><span>${E(a.nomeCurto || a.nome)}</span></div></div>` : `<span class="inv-muda">${E(x.id)} — não está mais no catálogo</span>`}</td>
          <td data-label="Preço" class="cad-num">${q ? E(U().valor(q, a)) + ' ' + tagEstado(q.estado) : '—'}</td>
          <td data-label="Dia" class="cad-num"><span class="${U().varCls(q)}">${E(U().varTxt(q))}</span></td>
          <td data-label="3 meses"><div class="inv-mini"><canvas id="inv-mini-${i}" aria-hidden="true"></canvas></div></td>
          <td class="cad-acoes"><button type="button" class="btn btn-small btn-ghost" data-alerta="${E(x.id)}" aria-label="Criar alerta para ${E(a ? a.ticker : x.id)}">Alerta</button><button type="button" class="btn btn-small btn-ghost" data-tirar="${E(x.id)}" aria-label="Remover ${E(a ? a.ticker : x.id)} desta lista">Remover</button></td></tr>`; }).join('')}
      </tbody></table></div>` : estado('info', 'Lista vazia', 'Na Biblioteca ou nos Mercados, toque na estrela de um ativo para adicioná-lo.', '<a class="btn" href="#/biblioteca">Abrir a Biblioteca</a>')}</div>
      <div class="inv-grade">
        <div class="panel"><div class="panel-title"><h2>Alertas de preço</h2><span>${AL.itens.length} de 50</span></div>
          ${AL.itens.length ? `<ul class="inv-macro">${AN.avaliarAlertas(AL.itens, cotacaoDe).map((r, i) => `<li><span>${E(textoAlerta(r.alerta))}</span><strong>${r.disparou ? '<span class="badge badge-warning">Disparado</span>' : '<span class="badge badge-neutral">Aguardando</span>'}</strong><button type="button" class="btn btn-small btn-ghost" data-tirar-alerta="${i}" aria-label="Excluir alerta ${E(textoAlerta(r.alerta))}">Excluir</button></li>`).join('')}</ul>` : '<p class="inv-muda">Nenhum alerta. Use o botão “Alerta” de um ativo.</p>'}
          <p class="inv-muda">Os alertas são conferidos quando você abre o módulo (sem servidor, não há aviso com o sistema fechado). Com dados simulados, disparam sobre números fictícios.</p></div>
        <div class="panel"><div class="panel-title"><h2>Calendário</h2></div>
          ${proventos.length ? `<h3 class="inv-sub">Proventos que você lançou</h3><ul class="inv-macro">${proventos.map((o) => `<li><span>${E(o.data.split('-').reverse().join('/'))} · ${E(o.assetId.split(':')[2])}</span><strong>${E(CT.TIPOS[o.tipo].nome)}</strong><span>${E(U().nf(o.valor))}</span></li>`).join('')}</ul>` : ''}
          ${estado('info', 'Datas de resultados e de dividendos futuros: indisponível', 'Dependem de uma fonte autorizada (D-06/D-10). Nada é estimado.')}</div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Notícias dos favoritos</h2></div>${noticias.length ? `<ul class="inv-noticias">${noticias.slice(0, 6).map(itemNoticia).join('')}</ul>` : estado('info', NT.semFonte ? 'Nenhuma fonte de notícias ligada' : 'Nenhuma notícia sobre os ativos desta lista', NT.semFonte ? 'As notícias dependem de um servidor e de fontes com termos confirmados.' : '')}</div>
      </div>`;
    ativos.forEach((x, i) => { const cv = document.getElementById('inv-mini-' + i); const h = x.a ? S.motor.historico(x.a, '3M') : { pontos: [] };
      if (h.pontos.length > 1) G.mini(cv, h.pontos); else if (cv) cv.parentNode.innerHTML = '<span class="inv-muda">sem histórico</span>'; });
    if (FV.comparar && lista.ativos.length > 1) {
      const hostC = host.querySelector('[data-comp]'); const as = ativos.filter((x) => x.a).slice(0, 5).map((x) => x.a);
      hostC.innerHTML = '<div class="inv-graf-area"><canvas id="inv-fav-comp" role="img" aria-label="Comparação dos favoritos"></canvas></div><div class="inv-graf-rod"></div>';
      const hs = as.map((a) => ({ assetId: a.assetId, rotulo: a.ticker, pontos: S.motor.historico(a, '6M').pontos })).filter((h) => h.pontos.length);
      if (hs.length > 1) { G.principal(document.getElementById('inv-fav-comp'), { comparar: K.comparar(hs) }); hostC.querySelector('.inv-graf-rod').innerHTML = `${C().tagEstado(S.motor.historico(as[0], '6M').estado)} 6 meses · até 5 ativos · base 0% no primeiro dia comum`; }
    }
    host.querySelectorAll('[data-lista-sel]').forEach((b) => b.addEventListener('click', () => { FV.lista = b.dataset.listaSel; T.favoritos(host); }));
    const cmp = host.querySelector('#inv-fav-comparar'); if (cmp) cmp.onclick = () => { FV.comparar = !FV.comparar; T.favoritos(host); };
    host.querySelector('#inv-nova-lista').addEventListener('click', () => { const nome = (prompt('Nome da nova lista:') || '').trim().slice(0, 60); if (!nome) return; const n = JSON.parse(JSON.stringify(S.fav)); const id = 'l' + Date.now().toString(36); n.listas.push({ id, nome, ativos: [] }); FV.lista = id; ctx.salvarFavoritos(n, 'Lista criada.'); });
    host.querySelectorAll('[data-renomear]').forEach((b) => b.addEventListener('click', () => { const n = JSON.parse(JSON.stringify(S.fav)); const l = n.listas.find((x) => x.id === b.dataset.renomear); const nome = (prompt('Novo nome da lista:', l.nome) || '').trim().slice(0, 60); if (!nome) return; l.nome = nome; ctx.salvarFavoritos(n, 'Lista renomeada.'); }));
    host.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => { const fazer = () => { const n = JSON.parse(JSON.stringify(S.fav)); n.listas = n.listas.filter((x) => x.id !== b.dataset.excluir); FV.lista = null; ctx.salvarFavoritos(n, 'Lista excluída.'); }; typeof confirmarAcao === 'function' ? confirmarAcao('Excluir esta lista de favoritos? Os ativos continuam na Biblioteca.', fazer, 'Excluir lista') : (confirm('Excluir esta lista?') && fazer()); }));
    host.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ctx.alternarFav(b.dataset.tirar, lista.id); }));
    host.querySelectorAll('[data-tirar-alerta]').forEach((b) => b.addEventListener('click', async () => { const n = AL.itens.filter((_, i) => i !== +b.dataset.tirarAlerta); try { await salvarAlertas(n); ctx.toastInv('Alerta excluído.'); } catch (e) { ctx.avisarSimples('Não foi possível excluir agora.'); } T.favoritos(host); }));
    host.querySelectorAll('[data-alerta]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); novoAlerta(b.dataset.alerta, host); }));
    ctx.ligarLinhas(host);
  };
  function novoAlerta(assetId, host) {
    const ctx = C(); const a = ctx.porId(assetId); const q = cotacaoDe(assetId);
    if (AL.itens.length >= 50) { ctx.avisarSimples('Limite de 50 alertas.'); return; }
    const tipo = (prompt(`Alerta para ${a.ticker}${q && q.preco != null ? ` (agora ${U().nf(q.preco)}, ${(K.ESTADOS[q.estado] || {}).rotulo})` : ''}:\n1 = preço ACIMA de\n2 = preço ABAIXO de\n3 = variação do dia de pelo menos (%)`) || '').trim();
    const t = { 1: 'acima', 2: 'abaixo', 3: 'variacao' }[tipo]; if (!t) return;
    const v = Number(String(prompt(t === 'variacao' ? 'Variação em % (ex.: 3):' : 'Preço:') || '').replace(/\./g, '').replace(',', '.'));
    const al = { assetId, tipo: t, valor: v, criadoEm: hoje() };
    if (!AN.validarAlerta(al)) { ctx.avisarSimples('Valor inválido.'); return; }
    salvarAlertas(AL.itens.concat([al])).then(() => { ctx.toastInv('Alerta criado.'); T.favoritos(host); }).catch(() => ctx.avisarSimples('Não foi possível salvar o alerta agora.'));
  }

  // ---------- dados de mercado comuns (Visão geral, Notícias e insights) ----------
  function mercadoAgora() {
    const { S } = C();
    const ind = [...K.INDICES.BR.filter((i) => ['IBOV', 'IFIX'].includes(i.ticker)), ...K.INDICES.US.filter((i) => ['SPX', 'IXIC'].includes(i.ticker))].map((a) => S.motor.cotacao(a));
    const macroBR = Object.fromEntries(K.MACRO.BR.map((a) => [a.ticker, Object.assign({ unidade: a.unidade }, S.motor.cotacao(a))]));
    const acoes = S.cat.filter((a) => a.pais === 'BR' && a.classe === 'acao' && a.situacao === 'ativo');
    const rk = K.rankings(S.motor.cotacoes(acoes), 5);
    return { ind, macroBR, rk };
  }
  // CDI acumulado entre duas datas (série diária do Market Engine; % a.a. → fator diário em 252 pregões)
  // benchmarks SÓ com histórico autorizado (o CDI simulado não é usado como referência real)
  function cdiNoPeriodo(ini) {
    const { S } = C(); const h = S.motorReal.historico(K.MACRO.BR.find((x) => x.ticker === 'CDI'), 'MAX');
    if (!h.pontos.length) return null;
    let f = 1; for (const p of h.pontos) if (p.data > ini) f *= Math.pow(1 + p.fechamento / 100, 1 / 252);
    return { pct: (f - 1) * 100, estado: h.estado };
  }
  function retornoDesde(a, ini) { const { S } = C(); const h = S.motorReal.historico(a, 'MAX'); const p = h.pontos.filter((x) => x.data >= ini); return p.length > 1 ? K.retorno(p) : null; }

  async function carteiraSelecionada() {
    const { S } = C();
    if (!(S.acesso.favoritos || S.acesso.carteiraPropria) || !CU()) return null;
    await CU().carregarCarteiras();
    const w = W(); if (w.estado !== 'ok' || !w.carteiras.length) return null;
    const c = w.carteiras.find((x) => x.id === w.atual) || w.carteiras[0];
    if (CU().grande(c)) return null; // carteira grande ainda não lida neste aparelho: a Visão geral não gasta milhares de leituras sozinha
    const ops = await CU().carregarOps(c);
    const { base, av } = CU().resumo(c, ops);
    const pe = CU().precoEmFabrica();
    const ev = CT.evolucao(ops, pe.precoEm, pe.cambioEm, (id) => C().porId(id), hoje(), { caixaAutomatico: c.caixaAutomatico !== false });
    const xi = CT.xirrCarteira(base, av, hoje());
    const ini = ops.filter((o) => o.tipo !== 'estorno').reduce((m, o) => (o.data < m ? o.data : m), '9999');
    const cdi = ini < '9999' ? cdiNoPeriodo(ini) : null;
    const ibov = ini < '9999' ? retornoDesde(K.INDICES.BR[0], ini) : null;
    const cotacoes = Object.fromEntries(av.itens.map((i) => [i.assetId, cotacaoDe(i.assetId)]));
    const insights = AN.insightsCarteira(av, base, ev, { cdiPeriodoPct: cdi && cdi.pct, ibovRet: ibov }, { cotacoes });
    return { c, ops, base, av, ev, xi, insights, cdi };
  }

  // ---------- NOTÍCIAS E INSIGHTS ----------
  const NI = { secao: 'noticias' };
  T.noticias = async function (host) {
    const ctx = C(); const { S, E, estado, cabecalho } = ctx;
    if (S.estadoCat !== 'ok') { host.innerHTML = cabecalho('Notícias e insights', '') + `<div class="panel">${estado('carregando', 'Carregando…')}</div>`; return; }
    host.innerHTML = cabecalho('Notícias e insights', 'Fontes oficiais e autorizadas · insights por regras fixas · IA preparada e desligada') + `<div class="panel">${estado('carregando', 'Carregando…')}</div>`;
    await carregarNoticias(); reclassificar();
    let cart = null; try { if (NI.secao === 'insights' || NI.secao === 'boletins') cart = await carteiraSelecionada(); } catch (e) { cart = null; }
    if (ctx.rota().aba !== 'noticias') return;
    const secs = [['noticias', 'Notícias'], ['insights', 'Insights'], ['boletins', 'Boletins'], ['pesquisa', 'Pesquisa'], ['ia', 'IA']];
    const m = mercadoAgora();
    let corpo = '';
    if (NI.secao === 'noticias') {
      const cats = [['todas', 'Todas'], ...N.CATEGORIAS.map(([k, n]) => [k, n]), ['favoritos', 'Favoritos']];
      const lista = N.filtrar(NT.itens, NT.cat);
      corpo = (NT.semFonte ? '<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Nenhuma fonte de notícias ligada.</strong> As fontes oficiais (Banco Central, IBGE, CVM, Tesouro, Federal Reserve, SEC, BLS) já estão cadastradas, mas a leitura automática depende de um servidor (D-10) e da confirmação dos termos de uso. Não há atualização automática de notícias.</div>' : '') + (NT.teste ? '<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Notícias de TESTE (fictícias).</strong> As fontes oficiais (Banco Central, IBGE, CVM, Tesouro, Federal Reserve, SEC, BLS) já estão cadastradas, mas a leitura automática depende do servidor (D-10) e da confirmação dos termos de uso. Nenhuma matéria é copiada: só título, resumo curto e o link original.</div>' : '') + `
        <div class="panel"><div class="inv-chips" role="group" aria-label="Categorias">${cats.map(([k, n]) => { const q = k === 'todas' ? NT.itens.length : N.filtrar(NT.itens, k).length; return `<button type="button" class="inv-seg${NT.cat === k ? ' on' : ''}" data-cat="${E(k)}" aria-pressed="${NT.cat === k}">${E(n)} <small>${q}</small></button>`; }).join('')}</div></div>
        <div class="panel">${NT.estado === 'erro' ? estado('erro', 'Notícias indisponíveis', NT.erros.join('; ')) : lista.length ? `<ul class="inv-noticias">${lista.map(itemNoticia).join('')}</ul><p class="inv-muda">${NT.removidas} duplicada(s) removida(s) · classificação por palavras-chave (sem IA).</p>` : estado('info', 'Nenhuma notícia nesta categoria', NT.cat === 'favoritos' ? 'Nenhuma notícia cita os seus favoritos.' : '')}</div>
        <div class="panel"><div class="panel-title"><h2>Fontes de notícias</h2></div><ul class="inv-lista">${Object.entries(N.FONTES).map(([, f]) => `<li><strong>${E(f.nome)}</strong><span>${f.ligada ? '<span class="badge badge-blue">Ligada</span>' : '<span class="badge badge-neutral">Desligada</span>'} ${E(f.formato)} · ${E(f.pais)}</span><span class="inv-muda">${E(f.termos)}</span></li>`).join('')}</ul></div>`;
    } else if (NI.secao === 'insights') {
      const indReais = Object.fromEntries(Object.entries(m.macroBR).filter(([, q]) => q && q.real));
      const ind = AN.insightsIndicadores(indReais);
      const disp = (await carregarAlertas(), alertasDisparados());
      const bloco = (titulo, l) => `<div class="panel"><div class="panel-title"><h2>${E(titulo)}</h2></div>${l.length ? `<ul class="inv-insights">${l.map((i) => `<li class="inv-insight-${E(i.nivel)}"><strong>${E(i.titulo)}</strong><p>${E(i.texto)}</p><span class="inv-muda">Regra: ${E(i.regra)} · ${C().tagEstado(i.estado && i.estado.includes('simulado') ? 'simulado' : (i.estado || 'indisponivel').split(',')[0])}</span></li>`).join('')}</ul>` : estado('info', 'Nada a destacar', '')}</div>`;
      corpo = U().faixaSimulado(m.ind) +
        (cart ? bloco(`Sua carteira: ${cart.c.nome}`, cart.insights) : `<div class="panel">${estado('info', 'Sem carteira para analisar', S.acesso.favoritos ? 'Crie uma carteira na aba Minha carteira.' : 'O Super Admin não tem carteiras.')}</div>`) +
        bloco('Indicadores', ind) +
        bloco('Alertas disparados', disp.map((d) => ({ nivel: 'atencao', titulo: textoAlerta(d.alerta), texto: `Preço agora ${U().nf(d.preco)}; variação do dia ${U().varTxt(d)}.`, regra: 'alerta configurado por você', estado: d.estado }))) +
        '<p class="inv-muda">Insights calculados por regras fixas e conferíveis (sem IA). Não são recomendação de investimento.</p>';
    } else if (NI.secao === 'boletins') {
      const tipo = AN.tipoBoletimAgora(new Date().getHours());
      const linhaCart = cart ? `${cart.c.nome} — patrimônio ${cart.av.patrimonio == null ? 'indisponível (sem preço autorizado ou manual)' : CU().brl(cart.av.patrimonio) + (cart.av.situacao === 'parcial' ? ' (parcial)' : '')}${cart.av.resultadoTotal != null ? ', resultado ' + CU().brl(cart.av.resultadoTotal) : ''}` : null;
      const bs = ['abertura', 'intradiario', 'fechamento'].map((t) => AN.boletim(t, { indices: m.ind, macro: ['SELIC', 'IPCA12M', 'USDBRL'].map((k) => m.macroBR[k]), altas: m.rk.altas, baixas: m.rk.baixas, carteira: linhaCart, noticias: NT.itens.slice(0, 3) }));
      corpo = U().faixaSimulado(m.ind) + bs.map((b) => `<div class="panel${b.tipo === tipo ? ' inv-boletim-agora' : ''}"><div class="panel-title"><h2>${E(b.titulo)}</h2>${b.tipo === tipo ? '<span class="badge badge-blue">Agora</span>' : ''}</div>
        ${b.linhas.map((l) => `<p class="inv-boletim-linha">${E(l)}</p>`).join('')}
        <p class="inv-muda">Gerado por ${E(b.geradoPor)} · fontes: ${E(b.fontes.join(', ') || '—')}${b.simulado ? ' · <strong>números simulados</strong>' : ''}${linhaCart ? ' · os dados da sua carteira aparecem só para você' : ''}</p></div>`).join('') +
        `<div class="panel">${estado('info', 'Boletins escritos por IA: desligados', IA.MOTIVO)}</div>`;
    } else if (NI.secao === 'pesquisa') {
      corpo = `<div class="panel"><div class="panel-title"><h2>Pesquisa</h2></div><ul class="inv-lista">${Object.values(N.PESQUISA).map((p) => `<li><strong>${E(p.nome)}</strong><span>${p.ligado ? '<span class="badge badge-blue">Ligado</span>' : '<span class="badge badge-neutral">Desligado</span>'} ${p.automatico ? 'motor automático' : 'links manuais (não é motor automático)'}</span><span class="inv-muda">${E(p.nota)}</span></li>`).join('')}</ul>
        <form class="inv-filtros" id="inv-pesq"><div class="topbar-search inv-busca"><input type="search" name="q" maxlength="80" placeholder="Pesquisar um assunto (abre o Google Notícias em outra aba)" aria-label="Pesquisar um assunto"></div></form>
        <p class="inv-muda">O sistema não lê nem guarda o resultado da pesquisa: ele só monta o link e você abre. Para o link de um ativo, use a página do ativo (Biblioteca).</p></div>`;
    } else {
      corpo = `<div class="panel"><div class="panel-title"><h2>Inteligência artificial (preparada, desligada)</h2></div>
        <p>O módulo já tem o "encaixe" para vários provedores. Nada está ligado nesta etapa e nenhuma chave existe no sistema.</p>
        <ul class="inv-lista">${Object.values(IA.PROVEDORES).map((p) => `<li><strong>${E(p.nome)}</strong><span><span class="badge badge-neutral">Desligado</span></span></li>`).join('')}</ul>
        <h3 class="inv-sub">O que a IA fará quando for autorizada</h3><ul class="inv-lista">${Object.values(IA.TAREFAS).map((t) => `<li><span>${E(t)}</span></li>`).join('')}</ul>
        <h3 class="inv-sub">Privacidade</h3><p class="inv-muda">Os dados das carteiras não são enviados a provedores externos. Só com uma autorização específica sua, e mesmo assim só porcentagens (sem valores em reais, quantidades, corretoras ou operações). Toda resposta precisará trazer links de fontes verificáveis.</p>
        <p class="inv-muda">${E(IA.MOTIVO)}</p></div>`;
    }
    host.innerHTML = cabecalho('Notícias e insights', 'Fontes oficiais e autorizadas · insights por regras fixas · IA preparada e desligada') +
      `<div class="inv-seg-grupo inv-subabas" role="group" aria-label="Seção">${secs.map(([k, n]) => `<button type="button" class="inv-seg${NI.secao === k ? ' on' : ''}" data-secao="${k}" aria-pressed="${NI.secao === k}">${E(n)}</button>`).join('')}</div>` + corpo;
    host.querySelectorAll('[data-secao]').forEach((b) => b.addEventListener('click', () => { NI.secao = b.dataset.secao; T.noticias(host); }));
    host.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { NT.cat = b.dataset.cat; T.noticias(host); }));
    const fp = host.querySelector('#inv-pesq'); if (fp) fp.addEventListener('submit', (e) => { e.preventDefault(); const q = fp.q.value.trim().slice(0, 80); if (q) window.open('https://news.google.com/search?hl=pt-BR&q=' + encodeURIComponent(q), '_blank', 'noopener,noreferrer'); });
  };

  // ---------- VISÃO GERAL ----------
  T.visao = async function (host) {
    const ctx = C(); const { S, E, estado, cabecalho, tagEstado } = ctx;
    if (S.estadoCat !== 'ok' || !S.motor) { host.innerHTML = cabecalho('Visão geral', '') + `<div class="panel">${S.estadoCat === 'erro' ? estado('erro', 'Catálogo indisponível', S.erroCat) : estado('carregando', 'Carregando…')}</div>`; return; }
    host.innerHTML = cabecalho('Visão geral', '') + `<div class="panel">${estado('carregando', 'Montando a visão geral…')}</div>`;
    let cart = null; let erroCart = '';
    try { cart = await carteiraSelecionada(); } catch (e) { erroCart = e.code === 'contencao' ? 'Limite de uso do dia atingido.' : 'Não foi possível abrir a carteira.'; }
    await Promise.all([carregarNoticias(), carregarAlertas()]); reclassificar();
    if (ctx.rota().aba !== 'visao') return;
    const m = mercadoAgora();
    const fav = favoritosAtivos().slice(0, 8); const cf = fav.map((a) => S.motor.cotacao(a));
    const disp = alertasDisparados();
    const radar = K.radar(S.cat.filter((a) => a.pais === 'BR' && a.classe === 'acao' && a.situacao === 'ativo'), S.motor, { limite: 5 });
    const kpi = (rot, val, extra, cl) => `<div class="inv-kpi"><span>${E(rot)}</span><strong class="${cl || ''}">${val}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
    const cls = (v) => (v > 0 ? 'inv-sobe' : v < 0 ? 'inv-desce' : '');
    const brl = CU().brl, pct = CU().pct;
    const R = (k) => ({ acao: 'Ações', fii: 'FIIs', etf: 'ETFs', bdr: 'BDRs', reit: 'REITs', tesouro: 'Tesouro Direto', renda_fixa: 'Renda fixa', cripto: 'Cripto', fundo: 'Fundos' }[k] || k);
    host.innerHTML = cabecalho('Visão geral', cart ? `Carteira: ${cart.c.nome} (${cart.c.tipo === 'pessoal' ? 'pessoal' : 'empresa'}) · mesmos números da aba Minha carteira` : 'Mercado, favoritos, notícias e insights') +
      U().faixaSimulado([...m.ind, ...(cart ? cart.av.itens.map((i) => ({ estado: i.estado })) : [])]) +
      (disp.length ? `<div class="inv-faixa inv-faixa-aviso" role="status"><strong>Alertas disparados:</strong> ${disp.map((d) => E(textoAlerta(d.alerta))).join(' · ')} · <a href="#/favoritos">ver</a></div>` : '') +
      `<div class="panel"><div class="inv-cards">${m.ind.map((q) => U().cartao(ctx.porId(q.assetId), q)).join('')}${['SELIC', 'USDBRL'].map((k) => U().cartao(K.MACRO.BR.find((x) => x.ticker === k), m.macroBR[k])).join('')}</div></div>` +
      (cart ? `<div class="inv-kpis">
        ${kpi('Patrimônio', cart.av.patrimonio == null ? 'Indisponível' : brl(cart.av.patrimonio), cart.av.situacao === 'parcial' ? `<strong>parcial</strong>: ${cart.av.cobertura.ativos} de ${cart.av.cobertura.de} ativos avaliados` : cart.av.situacao === 'indisponivel' ? 'sem preço autorizado ou manual' : cart.av.situacao === 'inconsistente' ? 'carteira inconsistente' : `caixa ${brl(cart.av.caixa)}`)}
        ${kpi('Aportado (líquido)', brl(cart.av.aportado))}
        ${kpi('Resultado total', brl(cart.av.resultadoTotal), '', cls(cart.av.resultadoTotal))}
        ${kpi('Rentabilidade (TWR, aproximação)', cart.ev.twr == null ? '—' : pct(cart.ev.twr * 100), cart.cdi && cart.ev.twr != null ? `CDI no período ${pct(cart.cdi.pct)}` : E(cart.ev.motivo || ''), cart.ev.twr == null ? '' : cls(cart.ev.twr))}
        ${kpi('Proventos', brl(cart.av.proventos), 'líquidos, lançados por você')}
        ${kpi('Exposição ao dólar', cart.av.exposicaoCambial == null ? '—' : pct(cart.av.exposicaoCambial, false))}</div>` : '') + `
      <div class="inv-grade">
        ${cart ? `<div class="panel"><div class="panel-title"><h2>Evolução</h2>${tagEstado(cart.av.estados.includes('simulado') ? 'simulado' : (cart.av.estados[0] || 'indisponivel'))}</div>${cart.ev.pontos.length > 1 ? '<div class="inv-graf-area inv-graf-baixa"><canvas id="inv-vg-evo" role="img" aria-label="Evolução do patrimônio"></canvas></div>' : estado('info', 'Evolução indisponível', cart.ev.motivo || 'A partir do segundo mês.')}</div>
          <div class="panel"><div class="panel-title"><h2>Distribuição por classe</h2></div><ul class="inv-barras">${CT.distribuir(cart.av.itens, 'classe').map((x) => `<li><span>${E(R(x.chave))}</span><span class="inv-barra"><i style="width:${Math.max(1, x.pct)}%"></i></span><strong>${pct(x.pct, false)}</strong></li>`).join('') || '<li><span class="inv-muda">Sem posições</span></li>'}</ul><p><a href="#/carteira">Abrir a carteira</a></p></div>`
        : `<div class="panel inv-largo">${estado('info', erroCart || ((S.acesso.favoritos || S.acesso.carteiraPropria) ? 'Nenhuma carteira ainda' : 'O Super Admin não tem carteiras'), erroCart ? 'Tente de novo em instantes.' : S.acesso.favoritos ? 'Crie a primeira na aba Minha carteira.' : 'Mercados, Biblioteca e Notícias funcionam normalmente.', S.acesso.favoritos && !erroCart ? '<a class="btn btn-primary" href="#/carteira">Minha carteira</a>' : '')}</div>`}
        <div class="panel"><div class="panel-title"><h2>Insights</h2><a href="#/noticias" data-ir-insights>ver todos</a></div>${(cart ? cart.insights : []).concat(AN.insightsIndicadores(Object.fromEntries(Object.entries(m.macroBR).filter(([, q]) => q && q.real)))).slice(0, 5).map((i) => `<p class="inv-insight-curto inv-insight-${E(i.nivel)}"><strong>${E(i.titulo)}</strong><span class="inv-muda">${E(i.texto)}</span></p>`).join('') || estado('info', 'Nada a destacar', '')}</div>
        <div class="panel"><div class="panel-title"><h2>Favoritos</h2><a href="#/favoritos">abrir</a></div>${fav.length ? `<ul class="inv-macro">${fav.map((a, i) => `<li><a href="#/ativo/${encodeURIComponent(a.assetId)}">${E(a.ticker)}</a><strong class="${U().varCls(cf[i])}">${E(U().varTxt(cf[i]))}</strong>${tagEstado(cf[i].estado)}</li>`).join('')}</ul>` : estado('info', S.acesso.favoritos ? 'Nenhum favorito' : 'Sem favoritos para este acesso', '')}</div>
        <div class="panel"><div class="panel-title"><h2>Radar</h2><a href="#/br">Mercado BR</a></div>${radar.length ? `<ul class="inv-radar">${radar.map((x) => `<li><a href="#/ativo/${encodeURIComponent(x.assetId)}"><strong>${E(x.ticker)}</strong></a><span>${E(x.sinais[0].texto)}</span></li>`).join('')}</ul>` : estado('info', 'Nenhum sinal hoje', '')}</div>
        <div class="panel"><div class="panel-title"><h2>Destaques da bolsa</h2></div><ul class="inv-macro">${m.rk.altas.slice(0, 3).concat(m.rk.baixas.slice(0, 3)).map((q) => `<li><a href="#/ativo/${encodeURIComponent(q.assetId)}">${E(q.ticker)}</a><strong class="${U().varCls(q)}">${E(U().varTxt(q))}</strong>${tagEstado(q.estado)}</li>`).join('')}</ul></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Notícias</h2><a href="#/noticias">ver todas</a></div>${NT.itens.length ? `<ul class="inv-noticias">${NT.itens.slice(0, 4).map(itemNoticia).join('')}</ul>` : estado('info', 'Sem notícias', '')}</div>
      </div>`;
    const ii = host.querySelector('[data-ir-insights]'); if (ii) ii.addEventListener('click', () => { NI.secao = 'insights'; });
    if (cart && cart.ev.pontos.length > 1) G.padrao(document.getElementById('inv-vg-evo'), 'line', (P, rgba) => ({ labels: cart.ev.pontos.map((p) => p.data.slice(5, 7) + '/' + p.data.slice(2, 4)), datasets: [
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.destaque, P, true) : { borderColor: rgba(P.destaque) }, { label: 'Patrimônio', data: cart.ev.pontos.map((p) => p.patrimonio / 100) }),
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.suave, P, false, true) : { borderColor: rgba(P.suave) }, { label: 'Aportado', data: cart.ev.pontos.map((p) => p.aportado / 100) })] }),
      { dica: { label: (x) => `${x.dataset.label}: ${brl(Math.round(x.raw * 100))}` } });
  };

  window.INVEST.noticiasUi = { carregarNoticias, carregarAlertas, NT, AL, carteiraSelecionada };
})();
