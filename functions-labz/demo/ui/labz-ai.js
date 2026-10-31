// LABZ AI — interface do módulo exclusivo do Super Admin (Fase 5A + Fase S4).
// Tudo o que vem do servidor entra na página como TEXTO (textContent), nunca como HTML.
// Modos:
//  - "demo":      só no servidor de demonstração local (functions-labz/demo/servidor-local.js),
//                 que serve uma configuração própria (LABZ_DEMO_LOCAL) e o backend real em memória;
//  - "https":     Super Admin logado no Eagles Labz + LABZ_API_URL (labz-config.js) preenchido:
//                 fala com a Edge Function labz-api do Supabase mandando o ID token do Firebase
//                 (Authorization: Bearer). O servidor confere TUDO de novo (token, Super Admin, listas);
//                 a tela só esconde o que não é para o usuário ver, ela não é a proteção.
//  - "desligado": Super Admin logado, mas o servidor ainda não foi ligado (LABZ_API_URL vazio):
//                 a tela avisa e não chama nada.
// Nenhuma credencial privada no navegador: só o token do próprio login, que o Firebase renova sozinho.
// Nada aqui chama modelos de IA, gasta dinheiro ou publica algo: os agentes são SIMULADOS.
(function () {
  'use strict';

  const ESTRUTURA = {
    marca: '01-guia-marca',
    estrategista: '08-estrategista',
    linha1: ['04-roteirista', '05-dev-web', '02-designer'],
    linha2: ['03-carrosseis', '07-trafego', '06-engenheiro'],
  };
  const DOCUMENTOS = {
    'diretrizes-marca': 'Diretrizes de marca', 'briefing-design': 'Briefing de design', 'estrutura-carrossel': 'Carrossel',
    'roteiro-reels': 'Roteiro de Reels', 'legenda-social': 'Legendas', 'plano-trafego': 'Plano de tráfego',
    'documentacao-tecnica': 'Documentação técnica', 'relatorio-tecnico': 'Relatório técnico',
    'plano-estrategico': 'Plano estratégico', 'consolidacao-final': 'Consolidação final',
  };
  const STATUS = {
    livre: { rotulo: 'Disponível', tom: 'neutro' },
    fila: { rotulo: 'Na fila', tom: 'neutro' },
    trabalhando: { rotulo: 'Trabalhando', tom: 'ativo' },
    aguardando: { rotulo: 'Aguardando sua aprovação', tom: 'alerta' },
    concluido: { rotulo: 'Concluído', tom: 'ok' },
    falhou: { rotulo: 'Falhou', tom: 'erro' },
  };
  const ESTADOS = {
    CREATED: 'Criada', PLANNING: 'Planejando', READY: 'Na fila', RUNNING: 'Em execução', WAITING_APPROVAL: 'Aguardando sua aprovação',
    REVISION_REQUIRED: 'Parada para revisão', COMPLETED: 'Concluída', FAILED: 'Falhou', CANCELLED: 'Cancelada',
  };
  const ENTREGA_ESTADOS = { rascunho: 'rascunho', 'em-revisao': 'aguardando aprovação', aprovada: 'aprovada', rejeitada: 'rejeitada', substituida: 'substituída', arquivada: 'arquivada' };
  const EXEMPLOS = [
    { nome: 'Campanha completa', texto: 'Campanha completa: diretrizes de marca, posts, carrosséis, roteiro de Reels, legendas para o Instagram e anúncios no Meta Ads' },
    { nome: 'Landing page', texto: 'Landing page com a identidade da marca e formulário integrado à API do CRM' },
    { nome: 'Só um roteiro', texto: 'Roteiro de Reels de 30 segundos sobre o lançamento do produto' },
  ];
  const FINAIS = ['COMPLETED', 'FAILED', 'CANCELLED'];
  // Ritmo das atualizações. No modo https cabe folgado no limite do servidor (60 pedidos/min):
  // tarefa ativa = 1 pedido a cada 3 s (o relatório só quando algo muda) + painéis a cada 30 s.
  const RITMO = {
    demo: { ativo: 900, parado: 2500, paineis: 8000 },
    https: { ativo: 3000, parado: 6000, paineis: 30000 },
  };
  const ERRO_MAX_MS = 30000;
  const LIMITE_MS = 60000;
  const TEMPO_PEDIDO_MS = 20000;

  const estado = {
    modo: null, agentes: [], porId: {}, empresas: {}, selecionado: '08-estrategista',
    exe: null, diag: null, rel: null, assinDiag: '', timer: null, emCurso: false, falhas: 0,
    ocupado: false, painelTimer: null, painelEmCurso: false, assinPaineis: '',
    hist: { itens: [], proximo: null, filtro: { empresaId: '', estado: '' }, aberto: null }, pend: [],
  };
  const $ = (id) => document.getElementById(id);

  // ---------- pequenos ajudantes de DOM (sempre texto, nunca HTML) ----------
  function el(tag, props, ...filhos) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'texto') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f instanceof Node ? f : document.createTextNode(String(f)));
    return n;
  }
  const limpar = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); return n; };
  const chip = (texto, tom) => el('span', { class: 'lz-status', 'data-tom': tom }, el('span', { class: 'lz-status-ponto', 'aria-hidden': 'true' }), texto);
  const tomDoEstado = (e, espera) => (espera ? 'alerta' : e === 'COMPLETED' ? 'ok' : e === 'FAILED' || e === 'CANCELLED' ? 'erro' : ['WAITING_APPROVAL', 'REVISION_REQUIRED'].includes(e) ? 'alerta' : 'ativo');
  function dataCurta(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    try { return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  const nomeEmpresa = (id) => (id ? estado.empresas[id] || 'Cliente' : 'Sem cliente');

  // ---------- comunicação ----------
  class ErroApi extends Error {
    constructor(e, status) { super((e && e.mensagem) || 'Não foi possível falar com a LABZ AI.'); this.codigo = (e && e.codigo) || 'internal'; this.status = status || 0; }
  }

  // Endereço da API (labz-config.js). Só https (http apenas entre 127.0.0.1/localhost, nos testes).
  function urlDaApi() {
    const bruto = typeof LABZ_API_URL === 'string' ? LABZ_API_URL.trim() : '';
    if (!bruto) return null;
    try {
      const u = new URL(bruto);
      const local = (h) => /^(127\.0\.0\.1|localhost)$/.test(h);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u.hostname) && local(location.hostname))) return null;
      if (u.username || u.password || u.search || u.hash) return null;
      return u.toString();
    } catch (e) { return null; }
  }

  async function tokenDoLogin(forcar) {
    const u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!u) throw new ErroApi({ codigo: 'unauthenticated', mensagem: 'Seu login expirou. Entre de novo no Eagles Labz.' }, 401);
    return u.getIdToken(!!forcar); // o Firebase renova o token sozinho; "forcar" pede um novo
  }

  async function postarHttps(acao, dados, forcarToken) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), TEMPO_PEDIDO_MS) : null;
    try {
      const r = await fetch(urlDaApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenDoLogin(forcarToken)}` },
        body: JSON.stringify({ acao, dados: dados || {} }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors',
        signal: ctrl ? ctrl.signal : undefined,
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, j };
    } catch (e) {
      if (e instanceof ErroApi) throw e;
      throw new ErroApi({ codigo: 'indisponivel', mensagem: 'Sem resposta do servidor da LABZ AI. Confira a internet e tente de novo.' }, 0);
    } finally { if (t) clearTimeout(t); }
  }

  async function chamar(acao, dados) {
    if (estado.modo === 'demo') {
      const r = await fetch('/__labz_local/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao, dados: dados || {} }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new ErroApi(j.erro, r.status);
      return j.resultado;
    }
    if (estado.modo === 'https') {
      let { status, j } = await postarHttps(acao, dados, false);
      if (status === 401) ({ status, j } = await postarHttps(acao, dados, true)); // token vencido: pede um novo UMA vez
      if (status === 200 && j && j.ok) return j.resultado;
      throw new ErroApi((j && j.erro) || { codigo: status === 429 ? 'resource-exhausted' : 'internal' }, status);
    }
    throw new ErroApi({ codigo: 'permission-denied', mensagem: 'Acesso negado.' }, 403);
  }

  async function detectarModo() {
    const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    if (local && typeof LABZ_DEMO_LOCAL !== 'undefined' && LABZ_DEMO_LOCAL === true) {
      try { const r = await fetch('/__labz_local/estado', { cache: 'no-store' }); const j = await r.json(); if (j && j.demo === true) return 'demo'; } catch (e) { /* sem demonstração */ }
    }
    // só esconde/mostra a tela; quem decide o acesso é o servidor (a cada pedido)
    if (typeof FIREBASE_PRONTO !== 'undefined' && FIREBASE_PRONTO && typeof USUARIO_ROLE !== 'undefined' && USUARIO_ROLE === 'SuperAdmin') return urlDaApi() ? 'https' : 'desligado';
    return null;
  }

  function aviso(texto, tom) {
    const a = $('lz-aviso');
    if (!a) return;
    a.textContent = texto || '';
    a.hidden = !texto;
    a.dataset.tom = tom || 'info';
  }
  const negado = (e) => e && (e.codigo === 'permission-denied' || e.codigo === 'unauthenticated');

  // ---------- status de cada agente a partir da execução (dados reais do motor) ----------
  function statusDoAgente(id) {
    const d = estado.diag;
    if (!d) return 'livre';
    const etapas = (d.etapas || []).filter((x) => x.agenteId === id);
    if (!etapas.length) return 'livre';
    const aguardaDoc = d.estado === 'REVISION_REQUIRED' && d.diagnostico && d.diagnostico.motivo === 'dependencia-aguarda-aprovacao'
      && (d.etapas || []).some((x) => x.id === d.diagnostico.dependencia && x.agenteId === id);
    const aguardaAcao = d.estado === 'WAITING_APPROVAL' && (d.aprovacoesPendentes || []).some((p) => etapas.some((x) => x.id === p.etapaId));
    if (aguardaDoc || aguardaAcao) return 'aguardando';
    if (etapas.some((x) => x.status === 'executando')) return 'trabalhando';
    if (etapas.some((x) => x.status === 'falhou')) return 'falhou';
    if (etapas.some((x) => x.status === 'pendente')) return 'fila';
    return 'concluido';
  }

  // ---------- organograma (os 8 agentes) ----------
  function cartao(id) {
    const a = estado.porId[id];
    if (!a) return null;
    const st = STATUS[statusDoAgente(id)];
    const funcao = a.missao.split(/[,.]/)[0];
    return el('button', {
      type: 'button', class: 'lz-card' + (estado.selecionado === id ? ' lz-card-ativo' : ''), 'data-agente': id,
      'aria-pressed': estado.selecionado === id ? 'true' : 'false', 'aria-label': `${a.nome}: ${st.rotulo}`,
      onclick: () => selecionar(id),
    },
    el('span', { class: 'lz-card-num', 'aria-hidden': 'true', texto: String(a.numero).padStart(2, '0') }),
    el('span', { class: 'lz-card-nome', texto: a.nome }),
    el('span', { class: 'lz-card-funcao', texto: funcao }),
    chip(st.rotulo, st.tom));
  }

  function renderOrg() {
    const org = limpar($('lz-org'));
    if (!org) return;
    const pendencias = estado.pend.length > 0 || (estado.diag && (estado.diag.estado === 'WAITING_APPROVAL' || (estado.diag.estado === 'REVISION_REQUIRED' && estado.diag.diagnostico && estado.diag.diagnostico.motivo === 'dependencia-aguarda-aprovacao')));
    const sa = el('button', { type: 'button', class: 'lz-card lz-card-sa' + (estado.selecionado === 'superadmin' ? ' lz-card-ativo' : ''), 'aria-pressed': estado.selecionado === 'superadmin' ? 'true' : 'false', onclick: () => selecionar('superadmin') },
      el('span', { class: 'lz-card-nome', texto: 'Super Admin — você' }),
      el('span', { class: 'lz-card-funcao', texto: 'Aprova entregas sensíveis e ações de risco' }),
      chip(pendencias ? 'Há decisão esperando você' : 'No comando', pendencias ? 'alerta' : 'ok'));
    org.append(
      el('div', { class: 'lz-nivel' }, sa),
      el('div', { class: 'lz-nivel' }, cartao(ESTRUTURA.marca)),
      el('div', { class: 'lz-nivel' }, cartao(ESTRUTURA.estrategista)),
      el('div', { class: 'lz-nivel lz-especialistas' },
        el('div', { class: 'lz-linha', role: 'group', 'aria-label': 'Agentes especializados, primeira linha' }, ESTRUTURA.linha1.map(cartao)),
        el('div', { class: 'lz-linha lz-linha-2', role: 'group', 'aria-label': 'Agentes especializados, segunda linha' }, ESTRUTURA.linha2.map(cartao)),
        el('div', { class: 'lz-rotulo-grupo', texto: 'Agentes especializados' })),
    );
  }

  // ---------- painel do agente ----------
  function lista(titulo, itens, classe) {
    if (!itens || !itens.length) return null;
    return el('div', { class: 'lz-bloco' }, el('h3', { texto: titulo }), el('ul', { class: classe || 'lz-lista' }, itens.map((t) => el('li', { texto: t }))));
  }

  function renderPainel() {
    const p = limpar($('lz-agente'));
    if (!p) return;
    if (estado.selecionado === 'superadmin') {
      p.append(el('div', { class: 'panel-title' }, el('h2', { texto: 'Super Admin — você' }), el('span', { texto: 'Quem decide' })),
        el('p', { class: 'lz-missao', texto: 'Você é o único que aprova. Os agentes propõem; nenhum deles aprova entregas, memórias ou ações.' }),
        lista('O que só você faz', ['Aprovar documentos sensíveis (plano de tráfego e documentação técnica)', 'Aprovar ou recusar ações de risco (publicar, gastar, enviar para fora)', 'Aprovar a entrega final', 'Aprovar memórias e aprendizados']),
        el('p', { class: 'lz-nota', texto: estado.pend.length ? `Agora: ${estado.pend.length} decisão(ões) esperando você (veja "Esperando você").` : 'Nenhuma decisão esperando você agora.' }),
        el('p', { class: 'lz-nota', texto: 'Nesta fase, até as ações aprovadas só são simuladas: nada é publicado, enviado ou cobrado.' }));
      return;
    }
    const a = estado.porId[estado.selecionado];
    if (!a) return;
    const st = STATUS[statusDoAgente(a.id)];
    const etapas = estado.diag ? (estado.diag.etapas || []).filter((x) => x.agenteId === a.id) : [];
    const porAgente = estado.diag && estado.diag.custos && estado.diag.custos.porAgente ? estado.diag.custos.porAgente[a.id] : null;
    p.append(
      el('div', { class: 'panel-title' }, el('h2', { texto: a.nome }), el('span', { texto: `Agente ${String(a.numero).padStart(2, '0')}` })),
      chip(st.rotulo, st.tom),
      el('p', { class: 'lz-missao', texto: a.missao }),
      lista('Responsabilidades', a.responsabilidades),
      lista('Capacidades (ferramentas previstas)', a.ferramentas, 'lz-chips'),
      lista('Entregas', a.entregaveis, 'lz-chips'),
      lista('Critérios de qualidade', a.criteriosQualidade),
      el('div', { class: 'lz-bloco' }, el('h3', { texto: 'Na tarefa aberta' }),
        etapas.length
          ? el('ul', { class: 'lz-lista' }, etapas.map((x) => el('li', { texto: `Etapa "${x.id}": ${rotuloEtapa(x.status)}${x.tentativas ? ` · ${x.tentativas} tentativa(s)` : ''}` })))
          : el('p', { class: 'lz-nota', texto: estado.diag ? 'Este agente não participa da tarefa aberta.' : 'Nenhuma tarefa aberta. Inicie uma abaixo ou abra uma do histórico.' }),
        porAgente && porAgente.tokens ? el('p', { class: 'lz-nota', texto: `Consumo simulado nesta tarefa: ${porAgente.tokens} tokens (unidade simulada, sem cobrança).` }) : null),
      el('p', { class: 'lz-nota', texto: `Modelo: ${a.modelo === 'simulado' ? 'simulado (nenhum modelo real ligado)' : a.modelo}. Modos: ${a.modos.join(' e ')}.` }),
    );
  }

  function selecionar(id) {
    estado.selecionado = id;
    renderOrg();
    renderPainel();
    const alvo = document.querySelector('.lz-card[aria-pressed="true"]');
    if (alvo && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('lz-card')) alvo.focus();
    if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) { const p = $('lz-agente'); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // ---------- tarefa ----------
  const rotuloEtapa = (s) => ({ pendente: 'na fila', executando: 'trabalhando', concluida: 'concluída', falhou: 'falhou' }[s] || s);
  const nomeAgente = (id) => (estado.porId[id] ? estado.porId[id].nome : id);

  async function carregarEmpresas() {
    try {
      const r = await chamar('empresas.listar', { status: 'ativa', limite: 50 });
      (r.itens || []).forEach((e) => { estado.empresas[e.id] = e.nome; });
    } catch (e) { /* sem empresas: as tarefas seguem sem cliente */ }
    for (const id of ['lz-empresa', 'lz-hist-empresa']) {
      const sel = $(id);
      if (!sel) continue;
      Object.entries(estado.empresas).forEach(([eid, nome]) => sel.append(el('option', { value: eid, texto: nome })));
    }
  }

  async function iniciar(ev) {
    ev.preventDefault();
    if (estado.ocupado) return;
    const objetivo = $('lz-objetivo').value.trim();
    if (objetivo.length < 5) { aviso('Descreva a tarefa com pelo menos 5 caracteres.', 'erro'); return; }
    estado.ocupado = true;
    $('lz-iniciar').disabled = true;
    aviso('O Estrategista (simulado) está planejando a tarefa…', 'info');
    try {
      const exe = await chamar('execucoes.pedido', { empresaId: $('lz-empresa').value || null, objetivo });
      abrirTarefa(exe.id, { rolar: false });
      aviso('Plano criado. Os agentes simulados estão trabalhando.', 'ok');
      atualizarPaineis(true);
    } catch (e) {
      aviso(e.codigo === 'resource-exhausted' ? `O servidor pediu uma pausa: ${e.message}` : `Não deu para iniciar: ${e.message}`, 'erro');
    } finally {
      $('lz-iniciar').disabled = false;
      estado.ocupado = false;
    }
  }

  // Abre uma tarefa (nova, do histórico ou das pendências) e passa a acompanhá-la.
  function abrirTarefa(id, { rolar = true } = {}) {
    estado.exe = { id };
    estado.diag = null; estado.rel = null; estado.assinDiag = ''; estado.falhas = 0;
    $('lz-execucao').hidden = false;
    limpar($('lz-resultado'));
    limpar($('lz-etapas'));
    limpar($('lz-decisoes'));
    $('lz-execucao-id').textContent = `Tarefa ${id}`;
    acompanhar();
    if (rolar) { const s = $('lz-execucao'); if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // Acompanhamento EFICIENTE: um pedido por vez; o relatório só quando o diagnóstico muda;
  // pausa com a aba escondida; espera crescente em erro; pausa longa quando o servidor pede (429).
  function agendar(ms) {
    clearTimeout(estado.timer);
    if (document.hidden) return; // volta sozinho no "visibilitychange"
    estado.timer = setTimeout(passoAcompanhar, ms);
  }
  function acompanhar() { clearTimeout(estado.timer); passoAcompanhar(); }

  async function passoAcompanhar() {
    if (!estado.exe || estado.emCurso) return;
    estado.emCurso = true;
    const id = estado.exe.id;
    const ritmo = RITMO[estado.modo] || RITMO.https;
    let proximo = ritmo.ativo;
    try {
      const d = await chamar('execucoes.diagnostico', { execucaoId: id });
      if (!estado.exe || estado.exe.id !== id) return; // abriram outra tarefa enquanto esperava
      const assin = JSON.stringify(d);
      if (assin !== estado.assinDiag) {
        estado.assinDiag = assin;
        estado.diag = d;
        estado.rel = await chamar('execucoes.relatorio', { execucaoId: id });
        renderOrg(); renderPainel(); renderExecucao();
        if (FINAIS.includes(d.estado)) await mostrarResultado();
      }
      estado.falhas = 0;
      if (FINAIS.includes(d.estado)) proximo = null;
      else if (['WAITING_APPROVAL', 'REVISION_REQUIRED'].includes(d.estado)) proximo = ritmo.parado;
    } catch (e) {
      estado.falhas += 1;
      if (negado(e)) { aviso(`O servidor recusou o acesso: ${e.message}`, 'erro'); proximo = null; }
      else if (e.codigo === 'resource-exhausted') { aviso('Muitos pedidos em pouco tempo: a tela vai esperar um minuto.', 'alerta'); proximo = LIMITE_MS; }
      else { aviso(`Falha ao acompanhar (vou tentar de novo): ${e.message}`, 'erro'); proximo = Math.min(ERRO_MAX_MS, ritmo.ativo * 2 ** estado.falhas); }
    } finally {
      estado.emCurso = false;
    }
    if (proximo && estado.exe && estado.exe.id === id) agendar(proximo);
  }

  function renderExecucao() {
    const d = estado.diag;
    const box = limpar($('lz-etapas'));
    const acoes = limpar($('lz-decisoes'));
    if (!d) return;
    $('lz-estado').textContent = ESTADOS[d.estado] || d.estado;
    $('lz-estado').dataset.tom = tomDoEstado(d.estado);
    const total = (d.etapas || []).length;
    const feitas = (d.etapas || []).filter((x) => x.status === 'concluida').length;
    const prog = $('lz-progresso');
    if (prog) {
      prog.max = Math.max(1, total);
      prog.value = feitas;
      prog.setAttribute('aria-valuetext', `${feitas} de ${total} etapas concluídas`);
    }
    $('lz-progresso-texto').textContent = total ? `${feitas} de ${total} etapas concluídas` : 'Planejando as etapas…';
    const docs = estado.rel ? estado.rel.documentos || [] : [];
    const planejadas = estado.rel ? estado.rel.etapasPlanejadas || [] : [];
    (d.etapas || []).forEach((x, i) => {
      const plano = planejadas.find((p) => p.id === x.id) || {};
      const nomeDoc = plano.documento ? (DOCUMENTOS[plano.documento] || plano.documento) : x.id;
      const doc = docs.find((dd) => dd.etapaId === x.id);
      const aguarda = d.diagnostico && d.diagnostico.dependencia === x.id && d.diagnostico.motivo === 'dependencia-aguarda-aprovacao';
      const tom = aguarda ? 'alerta' : x.status === 'concluida' ? 'ok' : x.status === 'executando' ? 'ativo' : x.status === 'falhou' ? 'erro' : 'neutro';
      box.append(el('li', { class: 'lz-etapa', 'data-tom': tom },
        el('span', { class: 'lz-etapa-num', 'aria-hidden': 'true', texto: String(i + 1) }),
        el('span', { class: 'lz-etapa-corpo' },
          el('strong', { texto: nomeDoc }),
          el('span', { class: 'lz-etapa-agente', texto: nomeAgente(x.agenteId) + (x.dependeDe && x.dependeDe.length ? ` · depende de ${x.dependeDe.join(', ')}` : '') }),
          doc ? el('span', { class: 'lz-etapa-doc', texto: `versão ${doc.versaoAtual} · ${doc.versaoAprovada ? 'aprovada por você' : doc.sensivel ? 'sensível: precisa da sua aprovação' : 'validação interna'}` }) : null),
        chip(aguarda ? 'aguardando você' : rotuloEtapa(x.status), tom)));
    });
    // decisões que só o Super Admin toma
    if (d.estado === 'REVISION_REQUIRED' && d.diagnostico && d.diagnostico.motivo === 'dependencia-aguarda-aprovacao') {
      const doc = docs.find((dd) => dd.etapaId === d.diagnostico.dependencia);
      if (doc) acoes.append(el('div', { class: 'lz-decisao' },
        el('p', { texto: `${DOCUMENTOS[doc.documento] || doc.documento} (versão ${doc.versaoAtual}) é um documento sensível. Ele só segue para os outros agentes depois da sua aprovação.` }),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => decidirEntrega(e.currentTarget, doc, 'aprovar') }, 'Aprovar esta versão (simulação)')));
    }
    if (d.estado === 'WAITING_APPROVAL') {
      (d.aprovacoesPendentes || []).forEach((p) => acoes.append(el('div', { class: 'lz-decisao' },
        el('p', { texto: `A etapa "${p.etapaId}" pediu uma ação de risco: ${p.ferramentaId}. Mesmo aprovada, nesta fase ela só é simulada.` }),
        el('div', { class: 'lz-botoes' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => decidirAcao(e.currentTarget, p, 'aprovar') }, 'Aprovar (simulação)'),
          el('button', { type: 'button', class: 'btn', onclick: (e) => decidirAcao(e.currentTarget, p, 'recusar') }, 'Recusar')))));
    }
    if (d.estado === 'FAILED') acoes.append(el('p', { class: 'lz-nota', texto: `A tarefa parou: ${(d.diagnostico && d.diagnostico.motivo) || 'motivo não informado'}.` }));
  }

  async function decidirEntrega(botao, doc, decisao) {
    botao.disabled = true;
    try {
      await chamar('entregas.decidir', { entregaId: doc.entregaId, decisao: { decisao, versao: doc.versaoAtual, hash: doc.hash } });
      aviso('Aprovado. A tarefa continua sozinha.', 'ok');
      acompanhar(); atualizarPaineis(true);
    } catch (e) { aviso(`Não deu para decidir: ${e.message}`, 'erro'); botao.disabled = false; }
  }
  async function decidirAcao(botao, p, decisao) {
    botao.disabled = true;
    try {
      await chamar('execucoes.decidirAprovacao', { execucaoId: estado.exe.id, aprovacaoId: p.id, decisao, assinatura: p.assinatura, justificativa: 'Decisão do Super Admin na interface da LABZ AI (simulação).' });
      aviso(decisao === 'aprovar' ? 'Ação aprovada (só simulada).' : 'Ação recusada.', 'ok');
      acompanhar(); atualizarPaineis(true);
    } catch (e) { aviso(`Não deu para decidir: ${e.message}`, 'erro'); botao.disabled = false; }
  }

  // Markdown do sistema (já escapado) → elementos de TEXTO
  function renderMarkdown(md) {
    const raiz = el('div', { class: 'lz-doc' });
    let ul = null;
    String(md || '').split('\n').forEach((linha) => {
      if (/^\s*<!--/.test(linha) || !linha.trim()) { ul = null; return; }
      const texto = (s) => s.replace(/\\(.)/g, '$1');
      let m;
      if ((m = linha.match(/^#\s+(.*)/))) { ul = null; raiz.append(el('h3', { texto: texto(m[1]) })); }
      else if ((m = linha.match(/^#{2,}\s+(.*)/))) { ul = null; raiz.append(el('h4', { texto: texto(m[1]) })); }
      else if ((m = linha.match(/^\s*[-*]\s+(.*)/))) { if (!ul) { ul = el('ul'); raiz.append(ul); } ul.append(el('li', { texto: texto(m[1]) })); }
      else { ul = null; raiz.append(el('p', { texto: texto(linha) })); }
    });
    return raiz;
  }

  async function mostrarResultado() {
    const box = limpar($('lz-resultado'));
    const d = estado.diag;
    if (!d || d.estado !== 'COMPLETED' || !estado.rel) return;
    const c = estado.rel.entregaConsolidada;
    const consumo = estado.rel.consumo || {};
    box.append(el('div', { class: 'lz-selo', role: 'note', texto: 'SIMULAÇÃO — conteúdo gerado por agentes simulados, sem modelo de IA real. Não use como entrega para cliente.' }));
    box.append(el('p', { class: 'lz-nota', texto: `${(estado.rel.etapasExecutadas || []).length} etapa(s) concluída(s) por ${(estado.rel.agentes || []).length} agente(s). Consumo simulado: ${consumo.tokens || 0} tokens (${consumo.unidade || 'unidade simulada'}; cobrança real: não).` }));
    if (!c) return;
    try {
      const doc = await chamar('entregas.documento', { entregaId: c.entregaId, versao: c.versao });
      box.append(el('h3', { texto: 'Entrega consolidada (simulada)' }), renderMarkdown(doc.markdown));
      if (c.estado === 'em-revisao') {
        const docRel = (estado.rel.documentos || []).find((x) => x.entregaId === c.entregaId);
        box.append(el('div', { class: 'lz-decisao' },
          el('p', { texto: 'A entrega final aguarda a sua aprovação.' }),
          el('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            try { await chamar('entregas.decidir', { entregaId: c.entregaId, decisao: { decisao: 'aprovar', versao: c.versao, hash: (docRel && docRel.hash) || c.hash } }); aviso('Entrega final aprovada (simulação).', 'ok'); estado.rel = await chamar('execucoes.relatorio', { execucaoId: estado.exe.id }); mostrarResultado(); atualizarPaineis(true); } catch (er) { aviso(`Não deu para aprovar: ${er.message}`, 'erro'); b.disabled = false; }
          } }, 'Aprovar entrega final (simulação)')));
      } else if (c.estado === 'aprovada') {
        box.append(el('p', { class: 'lz-nota', texto: 'Entrega final aprovada por você (simulação).' }));
      }
    } catch (e) { box.append(el('p', { class: 'lz-nota', texto: `Não deu para abrir o documento: ${e.message}` })); }
  }

  // ---------- "Esperando você" + resumo + histórico (painéis) ----------
  async function buscarPaineis() {
    const f = estado.hist.filtro;
    const [recentes, aguardando, revisao, entregas] = await Promise.all([
      chamar('execucoes.historico', Object.assign({ limite: 20 }, f.empresaId ? { empresaId: f.empresaId } : {}, f.estado ? { estado: f.estado } : {})),
      chamar('execucoes.historico', { estado: 'WAITING_APPROVAL', limite: 20 }),
      chamar('execucoes.historico', { estado: 'REVISION_REQUIRED', limite: 20 }),
      chamar('entregas.aguardandoAprovacao', { limite: 20 }).catch(() => ({ itens: [] })),
    ]);
    return { recentes, aguardando, revisao, entregas };
  }

  async function atualizarPaineis(agora) {
    clearTimeout(estado.painelTimer);
    if (estado.painelEmCurso) { if (agora) estado.painelDeNovo = true; return; }
    if (document.hidden) return;
    if (!agora) { estado.painelTimer = setTimeout(() => atualizarPaineis(true), (RITMO[estado.modo] || RITMO.https).paineis); return; }
    estado.painelEmCurso = true;
    try {
      const p = await buscarPaineis();
      const assin = JSON.stringify(p);
      if (assin !== estado.assinPaineis) {
        estado.assinPaineis = assin;
        estado.pend = [...p.aguardando.itens, ...p.revisao.itens.filter((x) => x.esperaSuperAdmin)].map((x) => ({ tipo: 'tarefa', item: x }))
          .concat((p.entregas.itens || []).filter((e) => !p.aguardando.itens.concat(p.revisao.itens).some((x) => x.id === e.execucaoId)).map((e) => ({ tipo: 'entrega', item: e })));
        estado.hist.itens = p.recentes.itens;
        estado.hist.proximo = p.recentes.proximo;
        renderPendencias(); renderResumo(); renderHistorico();
        if (estado.selecionado === 'superadmin') renderPainel();
        renderOrg();
      }
    } catch (e) {
      if (negado(e)) aviso(`O servidor recusou o acesso: ${e.message}`, 'erro');
    } finally {
      estado.painelEmCurso = false;
      const deNovo = estado.painelDeNovo;
      estado.painelDeNovo = false;
      atualizarPaineis(deNovo);
    }
  }

  function renderResumo() {
    const box = limpar($('lz-resumo'));
    if (!box) return;
    const itens = estado.hist.itens;
    const ativos = itens.filter((x) => ['CREATED', 'PLANNING', 'READY', 'RUNNING'].includes(x.estado)).length;
    const feitos = itens.filter((x) => x.estado === 'COMPLETED').length;
    const caixa = (rotulo, valor, tom) => el('div', { class: 'lz-resumo-item', 'data-tom': tom }, el('span', { class: 'lz-resumo-valor', texto: String(valor) }), el('span', { class: 'lz-resumo-rotulo', texto: rotulo }));
    box.append(
      caixa('Esperando você', estado.pend.length, estado.pend.length ? 'alerta' : 'neutro'),
      caixa('Em andamento', ativos, ativos ? 'ativo' : 'neutro'),
      caixa(estado.hist.filtro.empresaId || estado.hist.filtro.estado ? 'Concluídas (filtro)' : 'Concluídas (recentes)', feitos, 'ok'),
    );
  }

  function renderPendencias() {
    const box = limpar($('lz-pendencias'));
    if (!box) return;
    if (!estado.pend.length) { box.append(el('p', { class: 'lz-nota', texto: 'Nada esperando você agora.' })); return; }
    box.append(el('ul', { class: 'lz-itens' }, estado.pend.map(({ tipo, item }) => {
      if (tipo === 'tarefa') {
        const motivo = item.estado === 'WAITING_APPROVAL' ? 'Ação de risco esperando sua decisão' : 'Documento sensível esperando sua aprovação';
        return el('li', { class: 'lz-item' },
          el('span', { class: 'lz-item-corpo' }, el('strong', { texto: item.objetivo || item.id }), el('span', { class: 'lz-item-meta', texto: `${nomeEmpresa(item.empresaId)} · ${motivo} · ${dataCurta(item.atualizadoEm)}` })),
          el('button', { type: 'button', class: 'btn btn-small', onclick: () => abrirTarefa(item.id) }, 'Abrir'));
      }
      return el('li', { class: 'lz-item' },
        el('span', { class: 'lz-item-corpo' }, el('strong', { texto: `Entrega ${DOCUMENTOS[item.documento] || item.tipo || ''} v${item.versaoAtual || ''}` }), el('span', { class: 'lz-item-meta', texto: `${nomeEmpresa(item.empresaId)} · aguardando sua aprovação` })),
        item.execucaoId ? el('button', { type: 'button', class: 'btn btn-small', onclick: () => abrirTarefa(item.execucaoId) }, 'Abrir') : null);
    })));
  }

  function renderHistorico() {
    const box = limpar($('lz-hist-lista'));
    if (!box) return;
    const itens = estado.hist.itens;
    if (!itens.length) { box.append(el('p', { class: 'lz-nota', texto: 'Nenhuma tarefa encontrada.' })); }
    else box.append(el('ul', { class: 'lz-itens' }, itens.map((x) => el('li', { class: 'lz-item' + (estado.exe && estado.exe.id === x.id ? ' lz-item-aberto' : '') },
      el('span', { class: 'lz-item-corpo' },
        el('strong', { texto: x.objetivo || x.id }),
        el('span', { class: 'lz-item-meta', texto: `${nomeEmpresa(x.empresaId)} · ${dataCurta(x.criadoEm)} · ${x.etapas.concluidas} de ${x.etapas.total} etapas` })),
      chip(x.esperaSuperAdmin ? 'esperando você' : (ESTADOS[x.estado] || x.estado), tomDoEstado(x.estado, x.esperaSuperAdmin)),
      el('span', { class: 'lz-item-acoes' },
        el('button', { type: 'button', class: 'btn btn-small', onclick: () => abrirTarefa(x.id) }, 'Abrir'),
        el('button', { type: 'button', class: 'btn btn-small', 'aria-expanded': estado.hist.aberto === x.id ? 'true' : 'false', onclick: () => alternarEntregas(x.id) }, 'Entregas'))))));
    $('lz-hist-mais').hidden = !estado.hist.proximo;
    renderEntregasDaTarefa();
  }

  async function verMais() {
    const b = $('lz-hist-mais');
    if (!estado.hist.proximo) return;
    b.disabled = true;
    try {
      const f = estado.hist.filtro;
      const r = await chamar('execucoes.historico', Object.assign({ limite: 20, depoisDe: estado.hist.proximo }, f.empresaId ? { empresaId: f.empresaId } : {}, f.estado ? { estado: f.estado } : {}));
      estado.hist.itens = estado.hist.itens.concat(r.itens);
      estado.hist.proximo = r.proximo;
      renderHistorico();
    } catch (e) { aviso(`Não deu para carregar mais: ${e.message}`, 'erro'); } finally { b.disabled = false; }
  }

  const entregasCache = {};
  async function alternarEntregas(id) {
    estado.hist.aberto = estado.hist.aberto === id ? null : id;
    if (estado.hist.aberto && !entregasCache[id]) {
      try { entregasCache[id] = (await chamar('entregas.listar', { execucaoId: id, limite: 50 })).itens || []; } catch (e) { entregasCache[id] = null; aviso(`Não deu para ver as entregas: ${e.message}`, 'erro'); }
    }
    renderHistorico();
  }

  function renderEntregasDaTarefa() {
    const box = limpar($('lz-hist-entregas'));
    if (!box) return;
    const id = estado.hist.aberto;
    box.hidden = !id;
    if (!id) return;
    const itens = entregasCache[id];
    box.append(el('h3', { texto: 'Entregas da tarefa' }));
    if (!itens) { box.append(el('p', { class: 'lz-nota', texto: 'Não foi possível carregar.' })); return; }
    if (!itens.length) { box.append(el('p', { class: 'lz-nota', texto: 'Esta tarefa ainda não tem entregas registradas.' })); return; }
    box.append(el('ul', { class: 'lz-lista' }, itens.map((e) => el('li', { texto: `${DOCUMENTOS[e.documento] || e.tipo || 'Entrega'} · versão ${e.versaoAtual} · ${ENTREGA_ESTADOS[e.estadoAtual] || e.estadoAtual} · ${nomeAgente(e.agenteId)}` }))));
  }

  function aplicarFiltros() {
    estado.hist.filtro = { empresaId: $('lz-hist-empresa').value || '', estado: $('lz-hist-estado').value || '' };
    estado.hist.aberto = null;
    estado.assinPaineis = '';
    atualizarPaineis(true);
  }

  // ---------- início ----------
  function aoMudarVisibilidade() {
    if (document.hidden) { clearTimeout(estado.timer); clearTimeout(estado.painelTimer); return; }
    if (estado.exe && !(estado.diag && FINAIS.includes(estado.diag.estado))) acompanhar();
    atualizarPaineis(true);
  }

  function prepararFormularios() {
    const ex = $('lz-exemplos');
    EXEMPLOS.forEach((x) => ex.append(el('button', { type: 'button', class: 'btn btn-small', onclick: () => { $('lz-objetivo').value = x.texto; $('lz-objetivo').focus(); } }, x.nome)));
    $('lz-form').addEventListener('submit', iniciar);
    const est = $('lz-hist-estado');
    Object.entries(ESTADOS).forEach(([k, v]) => est.append(el('option', { value: k, texto: v })));
    $('lz-hist-empresa').addEventListener('change', aplicarFiltros);
    est.addEventListener('change', aplicarFiltros);
    $('lz-hist-mais').addEventListener('click', verMais);
  }

  function desligarTela(texto) {
    aviso(texto, 'erro');
    document.querySelectorAll('#labz-conteudo textarea, #labz-conteudo select, #labz-conteudo button').forEach((n) => { n.disabled = true; });
  }

  async function labzIniciar() {
    const modo = await detectarModo();
    if (!modo) { $('labz-sem-permissao').hidden = false; return; }
    estado.modo = modo;
    $('labz-conteudo').hidden = false;
    const m = $('lz-modo');
    m.textContent = { demo: 'Demonstração local · tudo simulado', https: 'Super Admin · servidor LABZ AI · agentes simulados', desligado: 'Super Admin · servidor não ligado' }[modo];
    m.dataset.tom = modo === 'https' ? 'ok' : 'alerta';
    prepararFormularios();
    if (modo === 'desligado') {
      desligarTela('O servidor da LABZ AI ainda não foi ligado (Supabase, Fase S5). Nada foi chamado e nada foi alterado.');
      return;
    }
    try {
      estado.agentes = await chamar('catalogo.agentes');
      estado.porId = Object.fromEntries(estado.agentes.map((a) => [a.id, a]));
    } catch (e) {
      if (negado(e)) {
        // a tela pode ter achado que era Super Admin; quem decide é o servidor
        $('labz-conteudo').hidden = true;
        const s = $('labz-sem-permissao');
        s.hidden = false;
        s.textContent = 'A LABZ AI é exclusiva do Super Admin autorizado. O servidor recusou este acesso.';
        return;
      }
      desligarTela(modo === 'https' ? `O servidor da LABZ AI não respondeu: ${e.message} Nada foi alterado.` : `A demonstração não respondeu: ${e.message}`);
      return;
    }
    if (modo === 'demo') aviso('Demonstração local: o backend real da LABZ AI roda em memória neste computador; o Estrategista e os agentes são simulados. Nada é publicado, enviado ou cobrado.', 'info');
    renderOrg();
    renderPainel();
    await carregarEmpresas();
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    atualizarPaineis(true);
  }

  window.labzIniciar = labzIniciar;
})();
