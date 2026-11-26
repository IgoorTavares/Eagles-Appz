/* =====================================================================
   Investimentos · Etapa 05 — Biblioteca de Ativos (interface nativa do Eagles Labz)
   Usa a barra, o menu, os temas e os componentes do sistema (script.js + style.css).
   Dados:
   - catálogo: arquivo estático publicado com o site (inv/catalogo/*.json) → pesquisar NÃO lê o banco;
   - favoritos: tenants/{empresa}/inv_favoritos/{uid} (só a própria pessoa);
   - liberação do Administrativo: tenants/{empresa}/inv_acesso/{uid} (só o Diretor grava);
   - consumo do dia: inv_admin_uso/{AAAA-MM-DD} (soma cooperativa de todos os aparelhos).
   TODO acesso ao Firestore passa por invDb (mede leituras, gravações e exclusões).
   Sem IA, sem chaves, sem chamadas externas: as pesquisas externas são links que a pessoa abre.
   ===================================================================== */
(function () {
  'use strict';
  const M = window.INVEST.motor;
  const E = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const ABAS = [
    ['visao', 'Visão geral', ''], ['carteira', 'Minha carteira', ''], ['br', 'Mercado BR', ''], ['us', 'Mercado US', ''],
    ['biblioteca', 'Biblioteca', ''], ['favoritos', 'Favoritos', ''], ['noticias', 'Notícias e insights', ''], ['projecoes', 'Projeções', ''],
  ];
  const TELAS = (window.INVEST.telas = window.INVEST.telas || {}); // as abas das Etapas 06–08 se registram aqui
  const S = { cat: null, meta: null, indice: null, estadoCat: 'carregando', erroCat: '', fav: null, estadoFav: 'carregando', acesso: null, consumo: { estado: 'normal', frac: 0, uso: null }, filtros: {}, busca: '', mostrar: 50 };
  const medidor = M.criarMedidor();
  window.INVEST.estado = S; window.INVEST.medidor = medidor; // para os testes

  // ---------- acesso ao banco (único ponto; mede tudo) ----------
  const ehNuvem = () => typeof FIREBASE_PRONTO !== 'undefined' && FIREBASE_PRONTO && typeof firestoreDb !== 'undefined' && firestoreDb;
  const ref = (cam) => firestoreDb.doc(cam);
  const RG = M.LEITURAS_DAS_REGRAS; // leituras feitas pelas regras em cada operação (contam na cota)
  const invDb = {
    async ler(cam, op) { if (!M.podeExecutar(op, S.consumo.estado)) throw Object.assign(new Error('pausado'), { code: 'contencao' }); const s = await ref(cam).get(); medidor.contar('leituras', 1 + RG, op); return s; },
    async gravar(cam, dados, op, merge) { if (!M.podeExecutar(op, S.consumo.estado)) throw Object.assign(new Error('pausado'), { code: 'contencao' }); await ref(cam).set(dados, merge ? { merge: true } : undefined); medidor.contar('gravacoes', 1, op); medidor.contar('leituras', RG, op); },
    async apagar(cam, op) { if (!M.podeExecutar(op, S.consumo.estado)) throw Object.assign(new Error('pausado'), { code: 'contencao' }); await ref(cam).delete(); medidor.contar('exclusoes', 1, op); medidor.contar('leituras', RG, op); },
    async consultar(q, op) { if (!M.podeExecutar(op, S.consumo.estado)) throw Object.assign(new Error('pausado'), { code: 'contencao' }); const s = await q.get(); medidor.contar('leituras', Math.max(1, s.size) + RG, op); return s; },
  };

  // ---------- quem pode usar (D-02) ----------
  async function resolverAcesso() {
    const nivel = typeof nivelUsuario === 'function' ? nivelUsuario() : 'diretor';
    const modulo = !!(typeof TENANT_MODULOS !== 'undefined' && TENANT_MODULOS && TENANT_MODULOS.investimentos === true);
    // D-02 (revisada em 26/11/2026): o Super Admin habilita e acompanha; não tem favoritos; tem a PRÓPRIA carteira pessoal
    // só se estiver vinculado a uma empresa com o módulo ligado (as regras garantem que ele nunca lê a de outra pessoa)
    if (nivel === 'superadmin') return { ok: true, nivel, admin: true, favoritos: false, modulo, carteiraPropria: !!(ehNuvem() && typeof TENANT_ID !== 'undefined' && TENANT_ID && modulo) };
    if (!ehNuvem()) return { ok: true, nivel, favoritos: false, modulo: true, local: true };
    if (!modulo) return { ok: false, nivel, motivo: 'modulo' };
    if (nivel === 'diretor' || nivel === 'financeiro') return { ok: true, nivel, favoritos: true, modulo, configura: nivel === 'diretor' };
    if (nivel === 'administrativo') {
      try { const s = await invDb.ler(`tenants/${TENANT_ID}/inv_acesso/${USUARIO_UID}`, 'abrir-favoritos'); if (s.exists) return { ok: true, nivel, favoritos: true, modulo }; } catch (e) { /* sem permissão = sem liberação */ }
      return { ok: false, nivel, motivo: 'liberacao' };
    }
    return { ok: false, nivel, motivo: 'perfil' };
  }

  // ---------- consumo (D-03) ----------
  async function lerConsumo() {
    if (!ehNuvem()) return;
    try { const s = await invDb.ler(`inv_admin_uso/${M.diaHoje()}`, 'ler-uso'); const uso = s.exists ? s.data() : {}; S.consumo = Object.assign(M.estadoConsumo(uso), { uso }); }
    catch (e) { S.consumo = { estado: 'normal', frac: 0, uso: null, erro: true }; }
  }
  let enviando = false;
  async function enviarConsumo() {
    if (!ehNuvem() || enviando) return;
    const p = medidor.pendente(); if (!p.leituras && !p.gravacoes && !p.exclusoes) return;
    enviando = true; medidor.zerar();
    const FV = firebase.firestore.FieldValue;
    const inc = { leituras: FV.increment(Math.min(500, p.leituras + RG)), gravacoes: FV.increment(Math.min(500, p.gravacoes + 1)), exclusoes: FV.increment(Math.min(500, p.exclusoes)), atualizadoEm: FV.serverTimestamp() };
    try { await ref(`inv_admin_uso/${M.diaHoje()}`).set(inc, { merge: true }); } catch (e) { const v = medidor; v.leituras += p.leituras; v.gravacoes += p.gravacoes; v.exclusoes += p.exclusoes; }
    enviando = false;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarConsumo(); });
  setInterval(enviarConsumo, 5 * 60 * 1000);

  // ---------- catálogo (Market Engine: cadastro) ----------
  // criptomoedas de referência (código e nome são de conhecimento público; NENHUM preço vem daqui: na carteira o preço é o manual)
  const CRIPTOS = [['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['SOL', 'Solana']].map(([t, n]) => ({ assetId: `CRYPTO:-:${t}`, ticker: t, nome: n, nomeCurto: n, pais: 'CRYPTO', bolsa: '-', classe: 'cripto', moeda: 'BRL', setor: 'Criptomoedas', segmento: '', ids: {}, fontes: [{ id: 'manual', dataRef: null, arquivo: 'Referência de mercado cadastrada pelo Eagles Labz' }], situacao: 'ativo', teste: false, codigoConfirmado: true }));
  async function carregarCatalogo() {
    S.estadoCat = 'carregando'; S.erroCat = ''; desenhar();
    try {
      const r1 = await fetch('inv/catalogo/meta.json', { cache: 'no-cache' });
      if (!r1.ok) throw new Error('catálogo indisponível (' + r1.status + ')');
      const meta = await r1.json();
      const r2 = await fetch('inv/catalogo/ativos.json?v=' + encodeURIComponent(meta.versao || ''));
      if (!r2.ok) throw new Error('lista de ativos indisponível (' + r2.status + ')');
      const lista = await r2.json();
      const v = M.validarCatalogo(meta, lista && lista.itens);
      if (!v.ok) throw new Error('catálogo com formato inválido: ' + v.erros.join(', '));
      // Etapa 11.18: símbolos do TradingView confirmados (arquivo opcional; sem ele, só as referências fixas têm gráfico)
      try { const r3 = await fetch('inv/catalogo/tradingview.json?v=' + encodeURIComponent(meta.versao || '')); if (r3.ok) M.definirConfirmadosTV(await r3.json()); } catch (e) { /* sem confirmações: nenhum gráfico "no chute" */ }
      S.meta = meta; S.cat = lista.itens.concat(CRIPTOS.filter((c) => !lista.itens.some((a) => a.assetId === c.assetId))); S.indice = M.indexar(S.cat); S.porId = new Map(S.cat.map((a) => [a.assetId, a])); S.estadoCat = 'ok';
      montarMotor();
      carregarDadosReais();
    } catch (e) { S.estadoCat = 'erro'; S.erroCat = String(e.message || e); }
    desenhar();
  }
  // índices e indicadores econômicos também têm página (não estão no catálogo de ativos negociáveis)
  const porId = (id) => (S.porId && S.porId.get(id)) || (K ? [...K.INDICES.BR, ...K.INDICES.US, ...K.MACRO.BR, ...K.MACRO.US].find((a) => a.assetId === id) : null) || null;

  // ---------- Market Engine (Etapa 06): simulador + preço manual da empresa; os provedores reais ficam desligados ----------
  const K = window.INVEST.mercado;
  const PREF = 'eagles_inv_pref_v1';
  const pref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { return {}; } };
  const salvarPref = (x) => { try { localStorage.setItem(PREF, JSON.stringify(Object.assign(pref(), x))); } catch (e) { /* sem armazenamento: vale só nesta visita */ } };
  S.precosManuais = {};
  function montarMotor() {
    if (!K) return;
    const hoje = typeof isoHoje === 'function' ? isoHoje() : M.diaHoje();
    // Auditoria: o simulador vem DESLIGADO por padrão; só a pessoa liga (só neste navegador), para ver uma demonstração.
    // a demonstração só existe se o catálogo publicado permitir (em produção, meta.demonstracao = false)
    S.demoPermitida = !!(S.meta && S.meta.demonstracao === true);
    S.simulador = S.demoPermitida && pref().simulador === true;
    // Etapa 11: dados REAIS das fontes aprovadas (Banco Central, Tesouro Direto, Tesouro dos EUA) entram ANTES do manual e do simulador
    const DR = window.INVEST.dados; const ret = S.dadosReais;
    const reais = {}; const ligados = {};
    if (DR && ret) {
      const regs = Object.values(ret.registros || {}); const tem = (f) => regs.some((r) => r && f.includes(r.fonte));
      if (tem(['bcb_sgs', 'bcb_ptax'])) { reais.bcb = DR.criarAdaptadorRetrato(ret, ['bcb_sgs', 'bcb_ptax']); ligados.bcb = true; }
      if (tem(['ust_curva'])) { reais.ust = DR.criarAdaptadorRetrato(ret, ['ust_curva']); ligados.ust = true; }
      if (tem(['fred'])) { reais.fred = DR.criarAdaptadorRetrato(ret, ['fred']); ligados.fred = true; }
      if (ret.tesouro && ret.tesouro.titulos) { reais.tesouro = DR.criarAdaptadorTesouro(ret.tesouro, hoje); ligados.tesouro = true; }
    }
    S.motor = K.criarMotor({ adaptadores: Object.assign({ simulador: K.criarSimulador({ dataRef: hoje }), manual: K.criarManual(S.precosManuais) }, reais), ligados, simulador: S.simulador });
    // motor de AVALIAÇÃO (carteiras reais, alertas, insights, projeções): NUNCA usa o simulador; usa os dados reais quando existem
    S.motorReal = K.criarMotor({ adaptadores: Object.assign({ manual: K.criarManual(S.precosManuais) }, reais), ligados, simulador: false });
  }
  // ---------- Etapa 11: carregador de dados reais (sem banco: 0 leituras do Firestore; cache local com prazo) ----------
  S.dadosReais = null; S.estadoDados = 'parado';
  function carregadorDados() {
    const DR = window.INVEST.dados; if (!DR) return null;
    if (!S.carregador) {
      let desligadas = {}; try { desligadas = JSON.parse(sessionStorage.getItem('eagles_inv_fontes_desligadas') || '{}') || {}; } catch (e) { desligadas = {}; }
      S.carregador = DR.criarCarregador({ fetch: (u, o) => fetch(u, o), armazenamento: (() => { try { return window.localStorage; } catch (e) { return null; } })(), hoje: typeof isoHoje === 'function' ? isoHoje() : M.diaHoje(), base: '', desligadas });
    }
    return S.carregador;
  }
  async function carregarDadosReais(forcar) {
    if (!S.acesso || !S.acesso.ok) return;
    const c = carregadorDados(); if (!c) return;
    if (S.estadoDados === 'carregando') return;
    if (forcar) c.limparCache();
    S.estadoDados = 'carregando';
    try { S.dadosReais = await c.carregarTudo(); S.estadoDados = 'ok'; juntarCatalogoUS(S.dadosReais.catalogoUS); }
    catch (e) { S.estadoDados = 'erro'; }
    montarMotor(); desenhar();
  }
  // Etapa 11.18: ações dos EUA do catálogo oficial da SEC (arquivo do robô) entram na Biblioteca; nunca substituem um ativo já existente
  function juntarCatalogoUS(lista) {
    if (!Array.isArray(lista) || !S.cat || S._usJunto === lista.length) return;
    const novos = [];
    for (const x of lista) {
      const id = M.montarAssetId('US', x.bolsa, x.ticker);
      if (S.porId.has(id)) continue;
      novos.push({ assetId: id, ticker: x.ticker, nome: x.nome, nomeCurto: x.nome, pais: 'US', bolsa: x.bolsa, classe: 'acao', moeda: 'USD', setor: '', segmento: '', ids: { cik: x.cik }, fontes: [{ id: 'sec', dataRef: String((S.dadosReais && S.dadosReais.coleta) || '').slice(0, 10) || null, arquivo: 'company_tickers_exchange.json' }], situacao: 'ativo', teste: false, codigoConfirmado: true });
      const v = M.validarAtivo(novos[novos.length - 1]); if (v && v.ok === false) novos.pop();
    }
    if (!novos.length) return;
    S.cat = S.cat.concat(novos); S.indice = M.indexar(S.cat); novos.forEach((a) => S.porId.set(a.assetId, a)); S._usJunto = lista.length;
  }
  // preços manuais: UM documento por empresa (1 leitura), só quando alguma tela precisa
  let manuaisLidos = false;
  async function carregarPrecosManuais(forcar) {
    if ((manuaisLidos && !forcar) || !ehNuvem() || !S.acesso || !(S.acesso.favoritos || S.acesso.carteiraPropria)) return;
    manuaisLidos = true;
    // os preços manuais incluem o câmbio manual (BR:MACRO:USDBRL)
    try { const s = await invDb.ler(`tenants/${TENANT_ID}/inv_precos/manual`, 'abrir-favoritos'); const d = s.exists ? s.data() : {}; S.precosManuais = {}; (d.itens || []).forEach((x) => { if (x && x.assetId && x.preco > 0) S.precosManuais[x.assetId] = x; }); montarMotor(); }
    catch (e) { manuaisLidos = false; }
  }

  // ---------- favoritos ----------
  async function carregarFavoritos() {
    if (!S.acesso || !S.acesso.favoritos) { S.estadoFav = 'indisponivel'; return; }
    try { const s = await invDb.ler(`tenants/${TENANT_ID}/inv_favoritos/${USUARIO_UID}`, 'abrir-favoritos'); const d = s.exists ? s.data() : null; S.fav = d && M.favoritosValidos(d) ? { listas: d.listas } : M.favoritosPadrao(); S.estadoFav = 'ok'; }
    catch (e) { S.estadoFav = 'erro'; }
  }
  async function salvarFavoritos(novo, msgOk) {
    if (!M.favoritosValidos(novo)) { avisarSimples('Limite atingido: até ' + M.FAV_MAX_LISTAS + ' listas e ' + M.FAV_MAX_ATIVOS + ' ativos no total.'); return false; }
    const antes = S.fav; S.fav = novo; desenhar();
    try { await invDb.gravar(`tenants/${TENANT_ID}/inv_favoritos/${USUARIO_UID}`, { listas: novo.listas, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, 'salvar-favorito'); if (msgOk) toastInv(msgOk); return true; }
    catch (e) { S.fav = antes; desenhar(); avisarSimples(e.code === 'contencao' ? 'O módulo atingiu o limite de uso do dia. Tente amanhã.' : 'Não foi possível salvar o favorito agora. Confira a internet e tente de novo.'); return false; }
  }
  function alternarFav(assetId, listaId) {
    if (!S.fav) return;
    const era = M.ehFavorito(S.fav, assetId);
    salvarFavoritos(M.alternarFavorito(S.fav, listaId || S.fav.listas[0].id, assetId), era ? 'Removido dos favoritos.' : 'Adicionado aos favoritos.');
  }
  window.invAlternarFav = alternarFav;

  // ---------- utilidades de tela ----------
  const avisarSimples = (m) => (typeof avisar === 'function' ? avisar(m) : alert(m));
  let tToast;
  function toastInv(m) { let t = document.getElementById('inv-toast'); if (!t) { t = document.createElement('div'); t.id = 'inv-toast'; t.className = 'inv-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('on'), 2600); }
  const rota = () => { const [, a, ...r] = (location.hash || '#/visao').split('/'); return { aba: a || 'visao', param: r.length ? decodeURIComponent(r.join('/')) : '' }; };
  const ir = (aba, param) => { location.hash = '#/' + aba + (param ? '/' + encodeURIComponent(param) : ''); };
  window.invIr = ir;
  const estrela = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="inv-estrela${on ? ' on' : ''}"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`;
  const tagEstado = (e, txt) => `<span class="inv-estado inv-estado-${E(e)}">${E(txt || M.ESTADOS[e] || (K && K.ESTADOS[e] ? K.ESTADOS[e].rotulo : e))}</span>`;
  const estado = (tipo, titulo, texto, botao) => `<div class="inv-estado-tela" ${tipo === 'erro' ? 'role="alert"' : ''}><div class="inv-estado-ic inv-${tipo}" aria-hidden="true">${tipo === 'erro' ? '!' : tipo === 'carregando' ? '' : 'i'}</div><h3>${E(titulo)}</h3>${texto ? `<p>${E(texto)}</p>` : ''}${botao || ''}</div>`;

  // ---------- desenho ----------
  function desenhar() {
    const host = document.getElementById('inv-conteudo'); if (!host) return;
    const r = rota();
    desenharAbas(r.aba === 'ativo' ? 'biblioteca' : r.aba);
    desenharAvisos();
    if (!S.acesso) { host.innerHTML = estado('carregando', 'Carregando Investimentos…'); return; }
    if (!S.acesso.ok) { host.innerHTML = telaNegada(); return; }
    if (window.INVEST.graficos) window.INVEST.graficos.destruirTodos();
    if (TELAS[r.aba] && r.aba !== 'biblioteca') return TELAS[r.aba](host, r.param);
    if (r.aba === 'ativo') return telaAtivo(host, r.param);
    if (r.aba === 'config') return telaConfig(host);
    if (r.aba !== 'biblioteca') { const a = ABAS.find((x) => x[0] === r.aba); host.innerHTML = estado('info', (a ? a[1] : 'Seção') + ' — em construção', a && a[2] ? `Esta aba chega na ${a[2]} do plano de Investimentos.` : ''); return; }
    return telaBiblioteca(host);
  }
  function desenharAbas(atual) {
    const nav = document.getElementById('inv-abas'); if (!nav) return;
    const extra = S.acesso && (S.acesso.admin || S.acesso.configura) ? [['config', S.acesso.admin ? 'Administração' : 'Configurações', '']] : [];
    nav.innerHTML = ABAS.concat(extra).map(([k, n, etapa]) => etapa
      ? `<span class="inv-aba inv-aba-off" aria-disabled="true" title="Chega na ${E(etapa)}">${E(n)}<small>${E(etapa)}</small></span>`
      : `<a href="#/${k}" class="inv-aba${k === atual ? ' active' : ''}"${k === atual ? ' aria-current="page"' : ''}>${E(n)}</a>`).join('');
  }
  function desenharAvisos() {
    const el = document.getElementById('inv-avisos'); if (!el) return;
    const av = [];
    if (S.meta && S.meta.teste) av.push(['aviso', `<strong>DADOS DE TESTE:</strong> ${E(String(S.meta.aviso || '').replace(/^DADOS DE TESTE:\s*/i, '') || 'empresas e códigos fictícios, sem valor real.')}`]);
    else if (S.meta && S.meta.totalTeste) av.push(['aviso', `<strong>Atenção:</strong> ${E(S.meta.aviso || '')} Os ativos de teste aparecem com a etiqueta “Teste”.`]);
    if (S.consumo.estado === 'contencao') av.push(['perigo', '<strong>Modo econômico.</strong> O módulo atingiu o limite de uso do dia: pesquisas e atualizações não essenciais estão pausadas. A Biblioteca continua funcionando com o catálogo já carregado.']);
    else if (S.consumo.estado === 'aviso' && S.acesso && (S.acesso.admin || S.acesso.configura)) av.push(['aviso', `<strong>Atenção ao consumo:</strong> o módulo já usou ${Math.round(S.consumo.frac * 100)}% do limite diário.`]);
    el.innerHTML = av.map(([t, h]) => `<div class="inv-faixa inv-faixa-${t}" role="note">${h}</div>`).join('');
  }
  function telaNegada() {
    const m = S.acesso.motivo === 'modulo' ? ['Investimentos não está habilitado para a sua empresa', 'O módulo é liberado empresa por empresa pela equipe da Eagles Labz.']
      : S.acesso.motivo === 'liberacao' ? ['Seu acesso a Investimentos ainda não foi liberado', 'Peça ao Diretor da sua empresa para liberar em Investimentos → Configurações.']
        : ['Seu perfil não tem acesso a Investimentos', ''];
    return estado('info', m[0], m[1]);
  }

  function telaBiblioteca(host) {
    if (S.estadoCat === 'carregando') { host.innerHTML = cabecalho('Biblioteca de ativos', 'Carregando o catálogo…') + `<div class="panel">${estado('carregando', 'Carregando o catálogo de ativos…')}</div>`; return; }
    if (S.estadoCat === 'erro') { host.innerHTML = cabecalho('Biblioteca de ativos', '') + `<div class="panel">${estado('erro', 'Catálogo indisponível no momento', S.erroCat + '. Nada foi perdido: tente de novo em instantes.', '<button type="button" class="btn btn-primary" id="inv-tentar">Tentar de novo</button>')}</div>`; document.getElementById('inv-tentar').onclick = carregarCatalogo; return; }
    const op = M.opcoesFiltro(S.cat.filter((a) => S.filtros.incluirInativos || !a.situacao || a.situacao === 'ativo'));
    const res = M.buscar(S.indice, S.busca, S.filtros, { limite: S.mostrar });
    const sel = (k, rot, ops, nomes) => `<label class="inv-campo"><span>${rot}</span><select data-filtro="${k}" class="inv-select"><option value="">Todos</option>${ops.map(([v, n]) => `<option value="${E(v)}"${S.filtros[k] === v ? ' selected' : ''}>${E((nomes && nomes[v]) || v)} (${n})</option>`).join('')}</select></label>`;
    host.innerHTML = cabecalho('Biblioteca de ativos', `${S.cat.length} ativos no catálogo · atualizado em ${dataBr(S.meta.geradoEm)} · fontes oficiais e autorizadas`) + `
      <div class="panel inv-filtros">
        <div class="topbar-search inv-busca"><input type="search" id="inv-busca" placeholder="Pesquisar por código (ticker), nome, CNPJ, CIK ou ISIN…" value="${E(S.busca)}" aria-label="Pesquisar ativos" maxlength="80" autocomplete="off"></div>
        <div class="inv-filtros-linha">
          ${sel('pais', 'País', op.pais, M.PAISES)}${sel('bolsa', 'Bolsa', op.bolsa, M.BOLSAS)}${sel('classe', 'Classe', op.classe, M.CLASSES)}${sel('setor', 'Setor', op.setor)}
          <label class="inv-check"><input type="checkbox" id="inv-inativos"${S.filtros.incluirInativos ? ' checked' : ''}> Incluir inativos (cancelados, suspensos e encerrados)</label>
          <button type="button" class="btn btn-small btn-ghost" id="inv-limpar">Limpar filtros</button>
        </div>
      </div>
      <div class="panel">
        <div class="inv-res-cab" aria-live="polite">${res.total ? `${res.total} resultado(s)${res.total > res.itens.length ? ` · mostrando ${res.itens.length}` : ''}` : ''}</div>
        ${res.total ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Ativo</th><th>Classe</th><th>País · Bolsa</th><th>Setor</th><th>Fonte</th><th><span class="sr-only">Favorito</span></th></tr></thead><tbody>
          ${res.itens.map(linhaAtivo).join('')}</tbody></table></div>
          ${res.total > res.itens.length ? '<div class="inv-mais"><button type="button" class="btn btn-small" id="inv-mais">Mostrar mais</button></div>' : ''}`
        : S.cat.length === 0 ? estado('info', 'Nenhum ativo liberado ainda', 'A Biblioteca mostra só ativos de fontes com uso autorizado comprovado. As fontes oficiais (CVM, Tesouro) aguardam a confirmação dos termos de uso; até lá, a lista fica vazia. Carteiras, preços manuais, projeções e favoritos continuam funcionando.')
        : estado('info', 'Nenhum ativo encontrado', 'Confira o código ou o nome, ou limpe os filtros. Se o ativo existir e não estiver aqui, ele ainda não está no catálogo das fontes autorizadas.')}
      </div>
      <p class="inv-muda inv-atribuicao">${Object.values(S.meta.fontes || {}).filter((f) => f.usada && f.atribuicao).map((f) => E(f.atribuicao)).join(' · ')}${S.meta.naoConfirmados ? ` · ${S.meta.naoConfirmados} código(s) de FII montados a partir do ISIN, não confirmados` : ''}. Licenças e termos de uso de cada fonte: página de cada ativo.</p>`;
    const b = document.getElementById('inv-busca');
    b.addEventListener('input', () => { clearTimeout(S._t); S._t = setTimeout(() => { S.busca = b.value; S.mostrar = 50; desenhar(); const n = document.getElementById('inv-busca'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); });
    host.querySelectorAll('[data-filtro]').forEach((s) => s.addEventListener('change', () => { S.filtros[s.dataset.filtro] = s.value || undefined; S.mostrar = 50; desenhar(); }));
    document.getElementById('inv-inativos').addEventListener('change', (e) => { S.filtros.incluirInativos = e.target.checked; desenhar(); });
    document.getElementById('inv-limpar').addEventListener('click', () => { S.filtros = {}; S.busca = ''; S.mostrar = 50; desenhar(); });
    const mais = document.getElementById('inv-mais'); if (mais) mais.addEventListener('click', () => { S.mostrar += 50; desenhar(); });
    ligarLinhas(host);
  }
  function linhaAtivo(a) {
    const fav = S.fav && M.ehFavorito(S.fav, a.assetId);
    return `<tr class="inv-linha" data-id="${E(a.assetId)}" tabindex="0">
      <td data-label="Ativo"><div class="inv-ativo"><span class="inv-logo" aria-hidden="true">${E(a.ticker.slice(0, 4))}</span><div><strong>${E(a.ticker)}</strong><span>${E(a.nomeCurto || a.nome)}</span></div></div></td>
      <td data-label="Classe"><span class="badge badge-neutral">${E(M.CLASSES[a.classe] || a.classe)}</span>${tagSituacao(a)}${a.codigoConfirmado === false ? ' <span class="badge badge-warning" title="Código derivado, ainda não confirmado por uma fonte">Código não confirmado</span>' : ''}</td>
      <td data-label="País · Bolsa">${E(M.PAISES[a.pais])} · ${E(M.BOLSAS[a.bolsa] || a.bolsa)}</td>
      <td data-label="Setor">${E(a.setor || '—')}</td>
      <td data-label="Fonte">${a.fontes.map((f) => `<span class="inv-fonte">${E((M.FONTES[f.id] || {}).tipo === 'oficial' ? f.id.toUpperCase() : f.id)}</span>`).join(' ')}${a.teste ? ' ' + tagEstado('teste') : ''}</td>
      <td class="cad-acoes">${S.acesso.favoritos && S.fav ? `<button type="button" class="btn btn-small btn-ghost inv-fav" data-fav="${E(a.assetId)}" aria-pressed="${fav}" aria-label="${fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}: ${E(a.ticker)}">${estrela(fav)}</button>` : ''}</td></tr>`;
  }
  function ligarLinhas(host) {
    host.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); alternarFav(b.dataset.fav); }));
    host.querySelectorAll('.inv-linha').forEach((tr) => { const abrir = (e) => { if (e.target.closest('button,a,input,select')) return; ir('ativo', tr.dataset.id); }; tr.addEventListener('click', abrir); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(e); }); });
  }
  const SITUACAO = { cancelado: ['danger', 'Registro cancelado na CVM'], suspenso: ['warning', 'Registro suspenso na CVM'], encerrado: ['neutral', 'Negociação encerrada'] };
  const tagSituacao = (a) => (SITUACAO[a.situacao] ? ` <span class="badge badge-${SITUACAO[a.situacao][0]}">${E(SITUACAO[a.situacao][1])}${a.fimNegociacao ? ' em ' + E(dataBr(a.fimNegociacao)) : ''}</span>` : '');
  const dataBr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };
  const cabecalho = (t, sub, acoes) => `<div class="page-header"><div><h1>${E(t)}</h1>${sub ? `<p>${E(sub)}</p>` : ''}</div>${acoes || ''}</div>`;

  // Etapa 11.18: gráfico do TradingView numa janela ISOLADA: iframe direto do domínio do TradingView (outra origem),
  // sem nenhum script dele na nossa página, com sandbox e sem referenciador completo. O sistema NÃO lê nenhum número do gráfico.
  const corHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || ''); if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null; return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join(''); };
  function fundoDe(el) { let e = el; while (e && e !== document.documentElement) { const c = corHex(getComputedStyle(e).backgroundColor); if (c) return c; e = e.parentElement; } return corHex(getComputedStyle(document.body).backgroundColor); }
  const temaEscuro = () => document.documentElement.getAttribute('data-theme') === 'dark';
  function graficoTV(a, op) {
    op = op || {};
    const DR = window.INVEST && window.INVEST.dados;
    if (!DR || !DR.ligada('tradingview') || !M.opcoesTradingView || deDesligadas().tradingview) return '';
    const opcoes = M.opcoesTradingView(a);
    if (!opcoes.length) return M.TV_NAO_DISPONIVEL && M.TV_NAO_DISPONIVEL[a.assetId] ? `<div class="panel inv-largo"><div class="panel-title"><h2>Gráfico</h2></div><p class="inv-muda">${E(M.TV_NAO_DISPONIVEL[a.assetId])}</p></div>` : '';
    const sel = opcoes.length > 1 ? `<div class="inv-tv-pares" role="group" aria-label="Escolher a fonte do gráfico">${opcoes.map((o, i) => `<button type="button" class="btn btn-small ${i ? 'btn-ghost' : 'btn-primary'}" data-tv-op="${i}" aria-pressed="${!i}" title="${E(o.par || o.s)}">${E(o.curto || o.par || o.s)}</button>`).join('')}</div>` : '';
    return `<div class="panel inv-largo inv-tv" data-tv-ativo="${E(a.assetId)}"><div class="panel-title"><h2>${E(op.titulo || 'Gráfico')}</h2><span class="badge badge-neutral" data-tv-atraso>${E(M.TV_ATRASO[opcoes[0].atraso])}</span></div>
      ${sel}<p class="inv-tv-fonte inv-muda" data-tv-fonte>${E(tvFonteTxt(opcoes[0]))}</p>
      <div class="inv-tv-caixa" data-tv-caixa><p class="inv-tv-carregando inv-muda">Carregando o gráfico…</p></div>
      <p class="inv-tv-atrib"><a data-tv-link href="${E(tvLink(opcoes[0].s))}" rel="noopener nofollow noreferrer" target="_blank">Gráfico de ${E(opcoes[0].par || a.ticker)} por TradingView</a></p>
      <p class="inv-muda">Desenhado pelo TradingView (linha, candles, volume, períodos, indicadores e zoom ficam no próprio gráfico). Os números do gráfico não entram na sua carteira: lá vale o preço de fonte oficial ou o informado por você.</p></div>`;
  }
  const gfLink = (a) => { const u = M.linkGoogleFinance(a); return u ? `<p class="inv-tv-gf"><a href="${E(u)}" target="_blank" rel="noopener noreferrer">Ver no Google Finance ↗</a> <span class="inv-muda">(abre em outra aba; o sistema não lê nada de lá)</span></p>` : ''; };
  const tvFonteTxt = (o) => `Símbolo ${o.s}${o.fonte ? ' · fonte: ' + o.fonte : ''}${o.par ? ' · ' + o.par : ''}`;
  const tvLink = (s) => 'https://br.tradingview.com/symbols/' + encodeURIComponent(String(s).replace(':', '-')) + '/';
  // liga os gráficos desenhados em "host": cria o iframe, troca de par, acompanha o tema e trata falha de carregamento
  function ligarGraficosTV(host) {
    host.querySelectorAll('.inv-tv[data-tv-ativo]').forEach((p) => {
      const a = porId(p.dataset.tvAtivo) || { assetId: p.dataset.tvAtivo };
      const opcoes = M.opcoesTradingView(a); if (!opcoes.length) return;
      let atual = 0; const caixa = p.querySelector('[data-tv-caixa]');
      const chave = () => [atual, temaEscuro(), fundoDe(p), innerWidth < 600].join('|');
      const montar = () => {
        const o = opcoes[atual]; p._tvChave = chave();
        const url = M.urlGraficoTradingView(o.s, { tema: temaEscuro() ? 'dark' : 'light', fundo: fundoDe(p), compacto: innerWidth < 600 });
        if (!url) return;
        caixa.innerHTML = '';
        const f = document.createElement('iframe');
        f.title = `Gráfico ${o.par || o.s} por TradingView`; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        f.setAttribute('allow', 'fullscreen'); f.setAttribute('credentialless', '');
        // o gráfico avisa por mensagem quando ficou pronto ("tv-widget-ready") ou quando o símbolo não tem dados ("tv-widget-no-data").
        // Só o NOME do aviso é lido (nunca preços); mensagens de outra origem ou de outra janela são ignoradas.
        let pronto = false;
        const aviso = (txt) => { if (caixa.querySelector('.inv-tv-erro')) return; p.classList.add('inv-tv-falhou'); const av = document.createElement('p'); av.className = 'inv-tv-erro'; av.setAttribute('role', 'status'); av.textContent = txt; caixa.appendChild(av); };
        if (p._tvOuvinte) window.removeEventListener('message', p._tvOuvinte);
        p._tvOuvinte = (ev) => {
          if (ev.origin !== 'https://www.tradingview-widget.com' || ev.source !== f.contentWindow) return;
          let d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
          const nome = d && typeof d.name === 'string' ? d.name : '';
          if (nome === 'tv-widget-ready' || nome === 'tv-widget-load') { pronto = true; p.classList.remove('inv-tv-falhou'); const c = caixa.querySelector('.inv-tv-carregando'); if (c) c.remove(); }
          else if (nome === 'tv-widget-no-data') aviso('O TradingView não tem dados para este símbolo agora.');
        };
        window.addEventListener('message', p._tvOuvinte);
        f.src = url; caixa.appendChild(f);
        clearTimeout(p._tvTimer);
        p._tvTimer = setTimeout(() => { if (!p.isConnected) { window.removeEventListener('message', p._tvOuvinte); return; } if (!pronto || !navigator.onLine) { aviso(navigator.onLine ? 'O gráfico do TradingView não respondeu. Tente de novo mais tarde; os outros dados da tela continuam valendo.' : 'Sem internet: o gráfico do TradingView não pode ser carregado agora.'); } }, 20000);
        p.querySelector('[data-tv-atraso]').textContent = M.TV_ATRASO[o.atraso];
        p.querySelector('[data-tv-fonte]').textContent = tvFonteTxt(o);
        const ln = p.querySelector('[data-tv-link]'); ln.href = tvLink(o.s); ln.textContent = `Gráfico de ${o.par || a.ticker || o.s} por TradingView`;
        p.querySelectorAll('[data-tv-op]').forEach((b) => { const on = Number(b.dataset.tvOp) === atual; b.classList.toggle('btn-primary', on); b.classList.toggle('btn-ghost', !on); b.setAttribute('aria-pressed', on); });
      };
      p.querySelectorAll('[data-tv-op]').forEach((b) => b.addEventListener('click', () => { atual = Number(b.dataset.tvOp) || 0; montar(); }));
      p._tvMontar = montar; p._tvChaveAgora = chave; montar();
    });
  }
  window.INVEST.tv = { html: graficoTV, ligar: ligarGraficosTV };
  // troca de tema (claro/escuro/personalizado) redesenha os gráficos abertos com o fundo da tela
  let tvTema = null;
  new MutationObserver(() => { clearTimeout(tvTema); tvTema = setTimeout(() => document.querySelectorAll('.inv-tv[data-tv-ativo]').forEach((p) => p._tvMontar && p._tvChaveAgora && p._tvChaveAgora() !== p._tvChave && p._tvMontar()), 300); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tema-custom', 'style'] });
  // ---------- Etapa 11.18: fundamentos (CVM: DFP/ITR consolidadas · SEC: 10-K) ----------
  const fundTemFonte = (a) => !!((a.pais === 'BR' && a.classe === 'acao' && a.ids && a.ids.cnpj) || (a.pais === 'US' && a.ids && a.ids.cik));
  const fundSemFonteTxt = (a) => a.classe === 'fii' ? 'Os fundos imobiliários não publicam DFP/ITR; os informes mensais de FII entram numa próxima etapa.' : a.classe === 'cripto' ? 'Criptomoedas não têm demonstrações financeiras.' : a.classe === 'tesouro' ? 'Títulos públicos não têm demonstrações financeiras.' : 'Sem demonstrações de fonte autorizada para este ativo. Nada é estimado.';
  const fmtMoeda = (v, moeda) => { if (v == null || !Number.isFinite(v)) return '—'; const s = moeda === 'USD' ? 'US$ ' : 'R$ '; const a = Math.abs(v); const n = (x, c) => x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); return (v < 0 ? '−' : '') + s + (a >= 1e9 ? n(a / 1e9, 2) + ' bi' : a >= 1e6 ? n(a / 1e6, 1) + ' mi' : n(a, 0)); };
  const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  async function desenharFundamentos(el, a) {
    const c = carregadorDados(); if (!el || !c || !c.fundamentos) return;
    const pais = a.pais === 'US' ? 'US' : 'BR';
    let j = null; try { j = await c.fundamentos(pais); } catch (e) { j = null; }
    if (!el.isConnected) return;
    const chave = pais === 'US' ? String(Number(a.ids.cik)) : String(a.ids.cnpj).replace(/\D/g, '');
    const emp = j && j.empresas && j.empresas[chave];
    const tit = '<div class="panel-title"><h2>Fundamentos</h2></div>';
    if (!j) { el.innerHTML = tit + estado('info', 'Demonstrativos indisponíveis agora', pais === 'US' ? 'O arquivo da SEC é gerado pelo robô quando o contato do robô (SEC_CONTACT_EMAIL) está configurado no GitHub.' : 'O arquivo dos demonstrativos da CVM não foi carregado. Tente de novo mais tarde.'); return; }
    if (!emp || !Array.isArray(emp.anual) || !emp.anual.length) { el.innerHTML = tit + estado('info', 'Sem demonstrativos para esta empresa', 'A fonte oficial não trouxe demonstrações consolidadas de 12 meses para esta empresa no período coberto. Nada é estimado.'); return; }
    const moeda = pais === 'US' ? 'USD' : 'BRL';
    const anos = emp.anual.slice(-4);
    const linha = (rot, f) => `<tr><th scope="row">${E(rot)}</th>${anos.map((x) => `<td data-label="${E(x.ano)}" class="cad-num">${f(x)}</td>`).join('')}</tr>`;
    const tabAnual = `<div class="table-scroll"><table class="inv-tabela inv-fund"><thead><tr><th scope="col">Anual (12 meses)</th>${anos.map((x) => `<th scope="col" class="cad-num">${E(x.ano)}${x.fim ? `<br><small class="inv-muda">até ${E(dataBr(x.fim))}</small>` : ''}</th>`).join('')}</tr></thead><tbody>
      ${linha('Receita', (x) => fmtMoeda(x.receita, moeda))}${linha('Lucro líquido', (x) => fmtMoeda(x.lucro, moeda))}${linha('Margem líquida', (x) => fmtPct(x.margemLiquida))}
      ${linha('ROE (sobre o PL médio)', (x) => fmtPct(x.roe))}${linha('Patrimônio líquido', (x) => fmtMoeda(x.pl, moeda))}${linha('Ativo total', (x) => fmtMoeda(x.ativo, moeda))}
      ${linha('Passivo (sem o PL)', (x) => fmtMoeda(x.passivo, moeda))}${linha(pais === 'US' ? 'Dívida de longo prazo' : 'Empréstimos e financiamentos', (x) => fmtMoeda(x.divida, moeda))}
      ${linha('Dívida ÷ PL', (x) => (x.divida != null && x.pl > 0 ? fmtPct((x.divida / x.pl) * 100) : '—'))}${linha('Caixa das operações', (x) => fmtMoeda(x.fco, moeda))}
      ${linha('Crescimento da receita', (x) => fmtPct(x.crescReceita))}${linha('Crescimento do lucro', (x) => fmtPct(x.crescLucro))}</tbody></table></div>`;
    const tri = Array.isArray(emp.trimestral) ? emp.trimestral.slice(-4) : [];
    const tabTri = tri.length ? `<h3 class="inv-fund-sub">Trimestres (3 meses)</h3><div class="table-scroll"><table class="inv-tabela inv-fund"><thead><tr><th scope="col">Trimestre</th>${tri.map((x) => `<th scope="col" class="cad-num">${E(dataBr(x.inicio))} a ${E(dataBr(x.fim))}</th>`).join('')}</tr></thead><tbody>
      <tr><th scope="row">Receita</th>${tri.map((x) => `<td class="cad-num" data-label="${E(dataBr(x.fim))}">${fmtMoeda(x.receita, moeda)}</td>`).join('')}</tr>
      <tr><th scope="row">Lucro líquido</th>${tri.map((x) => `<td class="cad-num" data-label="${E(dataBr(x.fim))}">${fmtMoeda(x.lucro, moeda)}</td>`).join('')}</tr></tbody></table></div>` : '';
    el.innerHTML = tit + tabAnual + tabTri + `<p class="inv-muda inv-fund-nota">${E(j.atribuicao || '')}. ${pais === 'BR' ? 'Demonstrações consolidadas; individuais não são misturadas.' : 'Formulários 10-K.'} “—” = a fonte não informou ou não dá para calcular (nunca vira zero). P/L e P/VP não são mostrados: dependem de cotação licenciada. Licença: ${E(j.licenca || '')}. Coleta: ${E(dataBr(String(j.coleta || '').slice(0, 10)))}.</p>`;
  }
  function telaAtivo(host, id) {
    if (S.estadoCat !== 'ok') return telaBiblioteca(host);
    const a = porId(id);
    if (a && (a.classe === 'indice' || a.classe === 'macro') && TELAS._ativoMercado) { host.innerHTML = `<a href="#/${a.pais === 'US' ? 'us' : 'br'}" class="inv-voltar">‹ Mercado ${a.pais === 'US' ? 'US' : 'BR'}</a>` + cabecalho(a.ticker + ' · ' + a.nome, `${a.classe === 'indice' ? 'Índice' : 'Indicador econômico'} · ${M.PAISES[a.pais]}`) + '<div class="panel" id="inv-ativo-mercado"></div>' + graficoTV(a, { titulo: 'Gráfico' }) + gfLink(a); TELAS._ativoMercado(document.getElementById('inv-ativo-mercado'), a); ligarGraficosTV(host); return; }
    if (!a) { host.innerHTML = cabecalho('Ativo não encontrado', '') + `<div class="panel">${estado('info', 'Este ativo não está no catálogo', 'O código pode estar errado ou o ativo ainda não vem de nenhuma fonte autorizada.', '<a class="btn" href="#/biblioteca">Voltar à Biblioteca</a>')}</div>`; return; }
    const fav = S.fav && M.ehFavorito(S.fav, a.assetId);
    const q = M.cotacaoDaBiblioteca(a);
    const linha = (rot, val) => `<tr><td data-label="${E(rot)}">${E(rot)}</td><td data-label="">${val ? E(val) : '<span class="inv-muda">— não informado pela fonte</span>'}</td></tr>`;
    host.innerHTML = `
      <a href="#/biblioteca" class="inv-voltar">‹ Biblioteca</a>
      <div class="page-header inv-ativo-cab"><div class="inv-ativo"><span class="inv-logo inv-logo-g" aria-hidden="true">${E(a.ticker.slice(0, 4))}</span><div><h1>${E(a.ticker)} <span class="inv-nome">${E(a.nome)}</span></h1>
        <p><span class="badge badge-blue">${E(M.CLASSES[a.classe])}</span> <span class="badge badge-neutral">${E(M.PAISES[a.pais])}</span> <span class="badge badge-neutral">${E(M.BOLSAS[a.bolsa] || a.bolsa)}</span> <span class="badge badge-neutral">${E(a.moeda)}</span>${a.teste ? ' ' + tagEstado('teste') : ''}${tagSituacao(a)}${a.codigoConfirmado === false ? ' <span class="badge badge-warning">Código não confirmado</span>' : ''}</p></div></div>
        ${S.acesso.favoritos && S.fav ? `<div class="inv-fav-acoes">${S.fav.listas.length > 1 ? `<label class="inv-campo"><span>Lista</span><select id="inv-lista-fav" class="inv-select">${S.fav.listas.map((l) => `<option value="${E(l.id)}">${E(l.nome)}</option>`).join('')}</select></label>` : ''}
          <button type="button" class="btn ${fav ? '' : 'btn-primary'}" id="inv-fav-ativo" aria-pressed="${fav}">${estrela(fav)} ${fav ? 'Nos favoritos' : 'Favoritar'}</button></div>` : ''}
      </div>
      ${a.codigoDerivado ? `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Código não confirmado.</strong> A CVM não publica o código de negociação dos fundos imobiliários: “${E(a.ticker)}” foi montado a partir do ISIN (${E(a.ids.isin || '')}), pelo padrão das cotas de FII, e pode não ser o código usado na bolsa. Confira antes de usar.</div>` : ''}
      <div class="inv-grade">
        <div class="panel inv-largo" id="inv-ativo-mercado"><div class="panel-title"><h2>Cotação</h2></div>
          <div class="inv-cotacao">${tagEstado(q.estado)}<p>${E(q.motivo)}</p><p class="inv-muda">Nenhum preço é mostrado sem uma fonte autorizada.</p></div></div>
        ${graficoTV(a, { titulo: 'Gráfico ao vivo' })}
        <div class="panel"><div class="panel-title"><h2>Identificação</h2></div>
          <div class="table-scroll"><table class="inv-tabela inv-ident"><tbody>
            ${linha('Identificador único', a.assetId)}${linha('Código', a.ticker)}${linha('Nome', a.nome)}${a.nomeCurto ? linha('Nome comercial', a.nomeCurto) : ''}
            ${linha('Setor', a.setor)}${linha('Segmento', a.segmento)}${a.ids.cnpj ? linha('CNPJ', M.fmtCnpj(a.ids.cnpj)) : ''}${a.ids.cvm ? linha('Código CVM', a.ids.cvm) : ''}
            ${a.ids.cik ? linha('CIK (SEC)', a.ids.cik) : ''}${a.ids.isin ? linha('ISIN', a.ids.isin) : ''}${a.vencimento ? linha('Vencimento', dataBr(a.vencimento)) : ''}${a.indexador ? linha('Indexador', a.indexador) : ''}
          </tbody></table></div></div>
        <div class="panel"><div class="panel-title"><h2>Fontes dos dados</h2></div>
          <ul class="inv-lista">${a.fontes.map((f) => { const F = M.FONTES[f.id] || {}; return `<li><strong>${E(F.nome || f.id)}</strong><span>${E(F.licenca || '')}</span><span class="inv-muda">${f.dataRef ? 'Data de referência: ' + E(dataBr(f.dataRef)) : ''}${f.arquivo ? ' · arquivo ' + E(f.arquivo) : ''}</span></li>`; }).join('')}</ul></div>
        <div class="panel"><div class="panel-title"><h2>Pesquisar fora do sistema</h2></div>
          <p class="inv-muda">Abre em outra aba. O sistema não coleta nada dessas páginas e envia só o código e o nome do ativo.</p>
          <ul class="inv-links">${M.linksExternos(a).map((l) => `<li><a href="${E(l.url)}" target="_blank" rel="noopener noreferrer">${E(l.rotulo)} ↗</a></li>`).join('')}</ul></div>
        <div class="panel" id="inv-ativo-noticias"><div class="panel-title"><h2>Notícias relacionadas</h2></div>${estado('info', 'Sem notícias', 'As notícias aparecem aqui quando houver uma fonte autorizada ligada.')}</div>
        <div class="panel inv-largo" id="inv-ativo-fund"><div class="panel-title"><h2>Fundamentos</h2></div>${fundTemFonte(a) ? estado('carregando', 'Carregando os demonstrativos…') : estado('info', 'Indisponível', fundSemFonteTxt(a))}</div>
      </div>`;
    if (TELAS._ativoMercado) TELAS._ativoMercado(document.getElementById('inv-ativo-mercado'), a);
    ligarGraficosTV(host);
    if (fundTemFonte(a)) desenharFundamentos(document.getElementById('inv-ativo-fund'), a);
    if (TELAS._ativoNoticias) TELAS._ativoNoticias(document.getElementById('inv-ativo-noticias'), a);
    const b = document.getElementById('inv-fav-ativo');
    if (b) b.addEventListener('click', () => { const s = document.getElementById('inv-lista-fav'); alternarFav(a.assetId, s ? s.value : null); });
  }

  // ---------- Etapa 11: painel EAGLES DATA ENGINE (Super Admin) ----------
  const DE_TESTE = {
    bcb_sgs: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json',
    bcb_ptax: "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/Moedas?$top=1&$format=json",
    bcb_focus: "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=1&$format=json",
    ust_curva: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${new Date().getFullYear()}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${new Date().getFullYear()}&page&_format=csv`,
    fiscaldata: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?page%5Bsize%5D=1',
    tesouro_direto: 'inv/dados/tesouro.json', noticias_fed: 'inv/dados/noticias.json', fred: 'inv/dados/macro-us.json', sec_edgar: 'inv/dados/catalogo-us.json',
  };
  const DE_LIMITE = { bcb_sgs: 'sem limite publicado · 1 requisição por série a cada 6 h por aparelho', bcb_ptax: 'sem limite publicado · cache 1 h', bcb_focus: 'sem limite publicado · cache 12 h', ust_curva: 'sem limite publicado · cache 6 h', fiscaldata: 'sem limite publicado', tesouro_direto: 'arquivo do site (robô diário)', noticias_fed: 'arquivo do site (robô)', tradingview: 'sem limite publicado · carregado pelo navegador de quem abre o ativo', google_finance: 'só link', noticias_sec: '10 requisições/s com identificação', sec_edgar: '10 requisições/s com identificação', bls: 'v2: 500 consultas/dia com chave', fred: '120 requisições/min com chave · robô 1×/dia (13 séries)', coingecko: 'plano Demo: 30 req/min, 10 mil/mês', brapi: 'plano gratuito limitado', b3: '—', ibge: 'sem limite publicado', noticias_bcb: '—', noticias_cvm: '—', cvm: 'arquivos do portal (catálogo)' };
  const DE_ALTERNATIVA = { bcb_sgs: 'PTAX (câmbio)', ibge: 'IPCA pelo Banco Central (SGS 433 e 13522)', bls: 'FRED (ligado: mesmos números do BLS)', fred: 'Tesouro dos EUA (juros) · BLS (reserva)', brapi: 'preço manual', b3: 'preço manual', coingecko: 'preço manual', sec_edgar: '—', noticias_sec: 'Federal Reserve' };
  const DE_ROT = { aprovada: 'Aprovada', 'aprovada-condicoes': 'Aprovada com condições', aguardando: 'Aguardando confirmação', incompativel: 'Incompatível', indisponivel: 'Indisponível' };
  const deDesligadas = () => { try { return JSON.parse(sessionStorage.getItem('eagles_inv_fontes_desligadas') || '{}') || {}; } catch (e) { return {}; } };
  function dataEnginePainel() {
    const DR = window.INVEST.dados; if (!DR) return '';
    const c = carregadorDados(); const st = c ? c.status() : {}; const desl = deDesligadas();
    const ret = S.dadosReais || { registros: {} };
    const desat = Object.values(ret.registros || {}).filter((r) => r && r.estado === 'desatualizado').map((r) => r.ticker || r.id);
    const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
    const linhas = Object.entries(DR.FONTES).map(([id, F]) => {
      const s = st[id] || {}; const ok = DR.ligada(id); const off = !!desl[id];
      const prox = s.ultimaOk && F.ttlSeg ? dt(new Date(Date.parse(s.ultimaOk) + F.ttlSeg * 1000).toISOString()) : (ok ? 'ao abrir o módulo' : '—');
      const integ = ok && F.modo === 'incorporado' ? (off ? '<span class="badge badge-neutral">Desligada nesta sessão</span>' : '<span class="badge badge-blue">Funcionando</span> <small>gráfico na tela do ativo</small>') : ok && F.modo === 'catalogo' ? (S.meta && (S.meta.porFonte || {})[id] ? '<span class="badge badge-blue">Funcionando</span> <small>catálogo de ativos</small>' : '<span class="badge badge-neutral">Catálogo sem esta fonte</span>') : !ok ? `<span class="badge badge-neutral">Desligada</span> <small>${E(F.motivo || '')}</small>` : off ? '<span class="badge badge-neutral">Desligada nesta sessão</span>' : s.erros && !s.ultimaOk ? `<span class="badge badge-red">Erro</span> <small>${E(s.ultimoErro || '')}</small>` : s.ultimaOk || s.doCache ? '<span class="badge badge-blue">Funcionando</span>' : '<span class="badge badge-neutral">Aguardando</span>';
      return `<tr><td data-label="Fonte"><strong>${E(F.nome)}</strong><br><small class="inv-muda">${E(F.modo === 'navegador' ? 'lida direto pelo navegador' : F.modo === 'arquivo' ? 'arquivo pronto (robô)' : F.modo === 'catalogo' ? 'catálogo de ativos' : F.modo === 'incorporado' ? 'janela incorporada (o sistema não lê os dados)' : 'sem integração')}</small></td>
        <td data-label="Licença"><span class="pm-sit">${E(DE_ROT[F.estado] || F.estado)}</span><br><small class="inv-muda">${E(F.evidencia || '')}</small></td>
        <td data-label="Integração">${integ}</td>
        <td data-label="Última / próxima">${E(dt(s.ultimaOk))}<br><small class="inv-muda">próxima: ${E(prox)}</small></td>
        <td data-label="Registros" class="cad-num">${s.registros || (id === 'cvm' && S.meta ? (S.meta.porFonte || {}).cvm || 0 : 0)}</td>
        <td data-label="Requisições / erros" class="cad-num">${s.requisicoes || 0} / ${s.erros || 0}${s.doCache ? `<br><small class="inv-muda">${s.doCache} do cache</small>` : ''}</td>
        <td data-label="Latência" class="cad-num">${s.latenciaMs != null ? s.latenciaMs + ' ms' : '—'}</td>
        <td data-label="Limites"><small>${E(DE_LIMITE[id] || '—')}</small>${DE_ALTERNATIVA[id] ? `<br><small class="inv-muda">alternativa: ${E(DE_ALTERNATIVA[id])}</small>` : ''}</td>
        <td class="cad-acoes">${ok && DE_TESTE[id] ? `<button type="button" class="btn btn-small btn-ghost" data-de-testar="${E(id)}">Testar conexão</button>` : ''}${ok && F.modo === 'navegador' ? `<button type="button" class="btn btn-small btn-ghost" data-de-sessao="${E(id)}" data-on="${off}">${off ? 'Ligar nesta sessão' : 'Desligar nesta sessão'}</button>` : ok ? '' : '<small class="inv-muda">só liga com licença confirmada</small>'}<span data-de-res="${E(id)}" class="inv-muda"></span></td></tr>`;
    }).join('');
    return `<div class="panel"><div class="panel-title"><h2>EAGLES DATA ENGINE — fontes de dados</h2><span>Licenças consultadas em ${E(DR.CONSULTA.split('-').reverse().join('/'))} · dados reais sem gravar no banco (0 leituras do Firestore)</span></div>
      <p><button type="button" class="btn btn-small" id="inv-de-atualizar">Atualizar agora</button> <span class="inv-muda">Situação: ${E(S.estadoDados)}${ret.coleta ? ' · última coleta ' + E(dt(ret.coleta)) : ''}${desat.length ? ' · <strong>desatualizados:</strong> ' + E(desat.join(', ')) : ' · nenhum dado desatualizado'}</span></p>
      <div class="table-scroll"><table class="inv-tabela cad-tabela"><thead><tr><th>Fonte</th><th>Licença</th><th>Integração</th><th>Última / próxima</th><th class="cad-num">Registros</th><th class="cad-num">Requisições / erros</th><th class="cad-num">Latência</th><th>Limites</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div id="inv-de-robo" class="inv-de-robo"><p class="inv-muda">Carregando o estado do robô de dados…</p></div>
      <p class="inv-muda">"Desligar nesta sessão" vale só neste navegador (diagnóstico). Ligar uma fonte nova exige licença confirmada e uma nova versão do sistema. Nenhuma chave é usada ou mostrada aqui.</p></div>`;
  }
  // estado do robô (arquivo inv/dados/status.json): credenciais só como "configurada"/"ausente" (o robô nunca grava valores),
  // última coleta por fonte e histórico de falhas. Nada aqui permite ver, copiar ou trocar uma chave.
  async function desenharRobo(host) {
    const el = host.querySelector('#inv-de-robo'); if (!el) return;
    let j = null; try { const r = await fetch('inv/dados/status.json', { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch (e) { j = null; }
    if (!el.isConnected) return;
    if (!j || j.formato !== 'eagles-inv-status-v1') { el.innerHTML = '<p class="inv-muda">Estado do robô indisponível (o arquivo de estado não foi publicado ainda).</p>'; return; }
    const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
    const NOMES = { 'FRED_API_KEY': 'FRED (chave da API)', 'SEC_CONTACT_EMAIL': 'SEC (contato do robô)', 'BLS_API_KEY': 'BLS (chave da API)', 'BRAPI_TOKEN': 'brapi (token)' }; // só os NOMES dos segredos
    const cred = Object.entries(NOMES).map(([k, n]) => { const v = j.credenciais && j.credenciais[k] === 'configurada' ? 'configurada' : 'ausente'; return `<li><strong>${E(n)}</strong> <span class="badge ${v === 'configurada' ? 'badge-blue' : 'badge-neutral'}">${v === 'configurada' ? 'Configurada' : 'Ausente'}</span></li>`; }).join('');
    const fontes = Object.entries(j.fontes || {}).map(([id, x]) => `<tr><td data-label="Fonte">${E(id)}</td><td data-label="Situação">${x && x.ok ? '<span class="badge badge-blue">OK</span>' : x && x.desligada ? '<span class="badge badge-neutral">Desligada</span>' : '<span class="badge badge-red">Falhou</span>'}${x && !x.ok && x.mantido ? ' <small>(mantido o último arquivo válido)</small>' : ''}</td><td data-label="Registros" class="cad-num">${E(String(x && x.registros != null ? x.registros : '—'))}</td><td data-label="Última com sucesso">${E(dt(x && x.ultimaOk))}</td><td data-label="Detalhe"><small>${E(String((x && (x.erro || x.origem)) || ''))}</small></td></tr>`).join('');
    const falhas = (Array.isArray(j.historicoFalhas) ? j.historicoFalhas : []).slice(0, 15).map((f) => `<li><small>${E(dt(f.quando))}</small> · <strong>${E(String(f.fonte || ''))}</strong> · ${E(String(f.erro || '').slice(0, 160))}${f.mantido ? ' · <em>último arquivo válido mantido</em>' : ''}</li>`).join('');
    el.innerHTML = `<h3>Robô de dados (GitHub Actions)</h3><p class="inv-muda">Última execução: ${E(dt(j.coleta))}. O robô gera só arquivos de dados validados; não publica código.</p>
      <h4>Credenciais (segredos do GitHub)</h4><ul class="inv-lista inv-de-cred">${cred}</ul>
      <div class="table-scroll"><table class="inv-tabela cad-tabela"><thead><tr><th>Fonte</th><th>Situação</th><th class="cad-num">Registros</th><th>Última com sucesso</th><th>Detalhe</th></tr></thead><tbody>${fontes}</tbody></table></div>
      <h4>Histórico de falhas</h4>${falhas ? `<ul class="inv-lista">${falhas}</ul>` : '<p class="inv-muda">Nenhuma falha registrada.</p>'}`;
  }
  function ligarDataEngine(host) {
    desenharRobo(host);
    const b = host.querySelector('#inv-de-atualizar'); if (b) b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'Atualizando…'; await carregarDadosReais(true); telaConfig(host); });
    host.querySelectorAll('[data-de-sessao]').forEach((x) => x.addEventListener('click', () => {
      const d = deDesligadas(); if (x.dataset.on === 'true') delete d[x.dataset.deSessao]; else d[x.dataset.deSessao] = true;
      try { sessionStorage.setItem('eagles_inv_fontes_desligadas', JSON.stringify(d)); } catch (e) { /* sem armazenamento */ }
      S.carregador = null; carregarDadosReais(true).then(() => telaConfig(host));
    }));
    host.querySelectorAll('[data-de-testar]').forEach((x) => x.addEventListener('click', async () => {
      const id = x.dataset.deTestar; const out = host.querySelector(`[data-de-res="${id}"]`); const t0 = performance.now();
      out.textContent = ' testando…';
      try { const r = await fetch(DE_TESTE[id], { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined }); out.textContent = r.ok ? ` ✓ respondeu em ${Math.round(performance.now() - t0)} ms` : ` ✗ HTTP ${r.status}`; }
      catch (e) { out.textContent = ' ✗ sem resposta (' + String(e.message || e).slice(0, 60) + ')'; }
    }));
  }

  async function telaConfig(host) {
    if (!S.acesso.admin && !S.acesso.configura) { ir('biblioteca'); return; }
    host.innerHTML = cabecalho(S.acesso.admin ? 'Administração de Investimentos' : 'Configurações de Investimentos', S.acesso.admin ? 'Super Admin · habilitação por empresa e consumo do dia' : 'Diretor · acesso da equipe') + `<div class="panel">${estado('carregando', 'Carregando…')}</div>`;
    const uso = S.consumo.uso || {};
    const L = M.LIMITES;
    const barra = (rot, v, lim) => { const p = Math.min(100, Math.round(((v || 0) / lim) * 100)); return `<div class="inv-uso"><div class="inv-uso-rot"><span>${E(rot)}</span><strong>${(v || 0).toLocaleString('pt-BR')} de ${lim.toLocaleString('pt-BR')}</strong></div><div class="inv-uso-barra" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${E(rot)}"><i style="width:${p}%" class="${p >= 100 ? 'cheio' : p >= 70 ? 'alto' : ''}"></i></div></div>`; };
    let corpo = `<div class="panel"><div class="panel-title"><h2>Consumo de hoje (todas as empresas)</h2><span>${E(M.diaHoje())}</span></div>
      ${barra('Leituras', uso.leituras, L.leituras)}${barra('Gravações', uso.gravacoes, L.gravacoes)}${barra('Exclusões', uso.exclusoes, L.exclusoes)}
      <p class="inv-muda">Soma enviada pelos aparelhos que usam o módulo. Aviso em 70%; no limite, as buscas não essenciais param. É um controle <strong>cooperativo</strong>: a garantia completa precisa de um servidor (decisão D-10).</p></div>`;
    try {
      if (S.acesso.admin) {
        const s = await invDb.consultar(firestoreDb.collection('tenants'), 'listar-empresas');
        const linhas = s.docs.map((d) => { const t = d.data(); const on = !!(t.modulos && t.modulos.investimentos); return `<tr><td data-label="Empresa"><strong>${E(t.nomeEmpresa || t.nome || d.id)}</strong></td><td data-label="Plano">${E(t.plano || 'erp')}</td><td data-label="Investimentos">${on ? '<span class="badge badge-blue">Habilitado</span>' : '<span class="badge badge-neutral">Desligado</span>'}</td><td class="cad-acoes"><button type="button" class="btn btn-small" data-modulo="${E(d.id)}" data-on="${on}">${on ? 'Desligar' : 'Habilitar'}</button></td></tr>`; }).join('');
        corpo += dataEnginePainel();
        corpo += `<div class="panel"><div class="panel-title"><h2>Empresas</h2><span>O Super Admin habilita o módulo; não vê carteiras nem favoritos.</span></div><div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Empresa</th><th>Plano</th><th>Investimentos</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
      } else {
        const s = await invDb.consultar(firestoreDb.collection('usuarios').where('tenantId', '==', TENANT_ID), 'listar-equipe');
        const adms = s.docs.filter((d) => d.data().role === 'Administrativo');
        const lib = await Promise.all(adms.map((d) => invDb.ler(`tenants/${TENANT_ID}/inv_acesso/${d.id}`, 'listar-equipe').then((x) => x.exists).catch(() => false)));
        corpo += `<div class="panel"><div class="panel-title"><h2>Acesso da equipe</h2><span>Diretor e Financeiro já têm acesso. O Administrativo só com a sua liberação.</span></div>${adms.length ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Pessoa</th><th>Situação</th><th></th></tr></thead><tbody>${adms.map((d, i) => `<tr><td data-label="Pessoa"><strong>${E(d.data().nome || 'Sem nome')}</strong></td><td data-label="Situação">${lib[i] ? '<span class="badge badge-blue">Liberado</span>' : '<span class="badge badge-neutral">Sem acesso</span>'}</td><td class="cad-acoes"><button type="button" class="btn btn-small" data-liberar="${E(d.id)}" data-on="${lib[i]}">${lib[i] ? 'Retirar acesso' : 'Liberar'}</button></td></tr>`).join('')}</tbody></table></div>` : estado('info', 'Nenhuma pessoa com o perfil Administrativo', '')}</div>`;
      }
    } catch (e) { corpo += `<div class="panel">${estado('erro', e.code === 'contencao' ? 'Pausado pelo limite de uso do dia' : 'Não foi possível carregar', e.code === 'contencao' ? 'Volte amanhã.' : 'Confira a internet e tente de novo.')}</div>`; }
    if (rota().aba !== 'config') return;
    host.innerHTML = cabecalho(S.acesso.admin ? 'Administração de Investimentos' : 'Configurações de Investimentos', S.acesso.admin ? 'Super Admin · habilitação por empresa e consumo do dia' : 'Diretor · acesso da equipe') + corpo;
    if (S.acesso.admin) ligarDataEngine(host);
    host.querySelectorAll('[data-modulo]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.on !== 'true'; b.disabled = true;
      try { await invDb.gravar(`tenants/${b.dataset.modulo}`, { modulos: { investimentos: on } }, 'alterar-modulo', true); toastInv(on ? 'Investimentos habilitado.' : 'Investimentos desligado.'); } catch (e) { avisarSimples('Não foi possível alterar agora.'); }
      telaConfig(host);
    }));
    host.querySelectorAll('[data-liberar]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.on !== 'true'; b.disabled = true; const cam = `tenants/${TENANT_ID}/inv_acesso/${b.dataset.liberar}`;
      try { if (on) await invDb.gravar(cam, { liberadoPor: USUARIO_UID, em: firebase.firestore.FieldValue.serverTimestamp() }, 'alterar-acesso'); else await invDb.apagar(cam, 'alterar-acesso'); toastInv(on ? 'Acesso liberado.' : 'Acesso retirado.'); } catch (e) { avisarSimples('Não foi possível alterar agora.'); }
      telaConfig(host);
    }));
  }

  // ---------- início ----------
  async function iniciar() {
    window.addEventListener('hashchange', () => { desenhar(); window.scrollTo(0, 0); });
    desenhar();
    S.acesso = await resolverAcesso();
    if (!S.acesso.ok) { desenhar(); return; }
    await lerConsumo();
    await Promise.all([carregarCatalogo(), carregarFavoritos(), carregarPrecosManuais()]);
    desenhar();
  }
  // contexto compartilhado com as abas das Etapas 06–08 (mesmas funções, mesmo medidor, mesmo visual)
  window.INVEST.ctx = { S, M, E, invDb, ehNuvem, estado, cabecalho, tagEstado, tagSituacao: (a) => tagSituacao(a), porId, ir, rota, toastInv, avisarSimples, estrela, dataBr, desenhar, ligarLinhas, alternarFav, salvarFavoritos, carregarFavoritos, carregarPrecosManuais, montarMotor, pref, salvarPref, RG, carregarDadosReais, carregadorDados };
  window.INVEST.iniciar = iniciar;
  window.INVEST.enviarConsumo = enviarConsumo;
})();
