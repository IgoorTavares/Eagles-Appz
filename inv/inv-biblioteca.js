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
      S.meta = meta; S.cat = lista.itens; S.indice = M.indexar(S.cat); S.porId = new Map(S.cat.map((a) => [a.assetId, a])); S.estadoCat = 'ok';
      montarMotor();
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
    S.motor = K.criarMotor({ adaptadores: { simulador: K.criarSimulador({ dataRef: hoje }), manual: K.criarManual(S.precosManuais) }, simulador: S.simulador });
    // motor de AVALIAÇÃO (carteiras reais, alertas, insights, projeções): NUNCA usa o simulador
    S.motorReal = K.criarMotor({ adaptadores: { manual: K.criarManual(S.precosManuais) }, simulador: false });
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

  function telaAtivo(host, id) {
    if (S.estadoCat !== 'ok') return telaBiblioteca(host);
    const a = porId(id);
    if (a && (a.classe === 'indice' || a.classe === 'macro') && TELAS._ativoMercado) { host.innerHTML = `<a href="#/${a.pais === 'US' ? 'us' : 'br'}" class="inv-voltar">‹ Mercado ${a.pais === 'US' ? 'US' : 'BR'}</a>` + cabecalho(a.ticker + ' · ' + a.nome, `${a.classe === 'indice' ? 'Índice' : 'Indicador econômico'} · ${M.PAISES[a.pais]}`) + '<div class="panel" id="inv-ativo-mercado"></div>'; TELAS._ativoMercado(document.getElementById('inv-ativo-mercado'), a); return; }
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
        <div class="panel"><div class="panel-title"><h2>Fundamentos</h2></div>${estado('info', 'Indisponível', 'Lucro, dividendos por ação, P/L e outros fundamentos dependem de uma fonte autorizada (D-06/D-10). Nada é estimado.')}</div>
      </div>`;
    if (TELAS._ativoMercado) TELAS._ativoMercado(document.getElementById('inv-ativo-mercado'), a);
    if (TELAS._ativoNoticias) TELAS._ativoNoticias(document.getElementById('inv-ativo-noticias'), a);
    const b = document.getElementById('inv-fav-ativo');
    if (b) b.addEventListener('click', () => { const s = document.getElementById('inv-lista-fav'); alternarFav(a.assetId, s ? s.value : null); });
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
  window.INVEST.ctx = { S, M, E, invDb, ehNuvem, estado, cabecalho, tagEstado, tagSituacao: (a) => tagSituacao(a), porId, ir, rota, toastInv, avisarSimples, estrela, dataBr, desenhar, ligarLinhas, alternarFav, salvarFavoritos, carregarFavoritos, carregarPrecosManuais, montarMotor, pref, salvarPref, RG };
  window.INVEST.iniciar = iniciar;
  window.INVEST.enviarConsumo = enviarConsumo;
})();
