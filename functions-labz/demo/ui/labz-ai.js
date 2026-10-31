// LABZ AI — Fase 5A: interface (MVP) do módulo exclusivo do Super Admin.
// Tudo o que vem do servidor entra na página como TEXTO (textContent), nunca como HTML.
// Modos:
//  - "demo": só no servidor de demonstração local (functions-labz/demo/servidor-local.js),
//            que serve uma configuração própria (LABZ_DEMO_LOCAL) e o backend real em memória;
//  - "servidor": produção, só para o Super Admin logado; fala com a função labzApi (que confere
//            de novo o Super Admin no servidor). Enquanto a função não estiver ligada, a tela avisa.
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
  const EXEMPLOS = [
    { nome: 'Campanha completa', texto: 'Campanha completa: diretrizes de marca, posts, carrosséis, roteiro de Reels, legendas para o Instagram e anúncios no Meta Ads' },
    { nome: 'Landing page', texto: 'Landing page com a identidade da marca e formulário integrado à API do CRM' },
    { nome: 'Só um roteiro', texto: 'Roteiro de Reels de 30 segundos sobre o lançamento do produto' },
  ];
  const FINAIS = ['COMPLETED', 'FAILED', 'CANCELLED'];

  const estado = { modo: null, agentes: [], porId: {}, selecionado: '08-estrategista', exe: null, diag: null, rel: null, timer: null, ocupado: false };
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

  // ---------- comunicação ----------
  class ErroApi extends Error { constructor(e) { super((e && e.mensagem) || 'Não foi possível falar com a LABZ AI.'); this.codigo = (e && e.codigo) || 'internal'; } }
  async function chamar(acao, dados) {
    if (estado.modo === 'demo') {
      const r = await fetch('/__labz_local/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao, dados: dados || {} }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new ErroApi(j.erro);
      return j.resultado;
    }
    if (estado.modo === 'servidor') {
      if (!firebase.functions) throw new ErroApi({ mensagem: 'O módulo de funções do Firebase não carregou.' });
      const fn = firebase.app().functions('southamerica-east1').httpsCallable('labzApi');
      try { const r = await fn({ acao, dados: dados || {} }); return r.data.resultado; } catch (e) { throw new ErroApi({ codigo: e.code, mensagem: e.message }); }
    }
    throw new ErroApi({ codigo: 'permission-denied', mensagem: 'Acesso negado.' });
  }

  async function detectarModo() {
    const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    if (local && typeof LABZ_DEMO_LOCAL !== 'undefined' && LABZ_DEMO_LOCAL === true) {
      try { const r = await fetch('/__labz_local/estado', { cache: 'no-store' }); const j = await r.json(); if (j && j.demo === true) return 'demo'; } catch (e) { /* sem demonstração */ }
    }
    if (typeof FIREBASE_PRONTO !== 'undefined' && FIREBASE_PRONTO && typeof USUARIO_ROLE !== 'undefined' && USUARIO_ROLE === 'SuperAdmin') return 'servidor';
    return null;
  }

  function aviso(texto, tom) {
    const a = $('lz-aviso');
    if (!a) return;
    a.textContent = texto || '';
    a.hidden = !texto;
    a.dataset.tom = tom || 'info';
  }

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

  // ---------- organograma ----------
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
    el('span', { class: 'lz-status', 'data-tom': st.tom }, el('span', { class: 'lz-status-ponto', 'aria-hidden': 'true' }), st.rotulo));
  }

  function renderOrg() {
    const org = limpar($('lz-org'));
    if (!org) return;
    const pendencias = estado.diag && (estado.diag.estado === 'WAITING_APPROVAL' || (estado.diag.estado === 'REVISION_REQUIRED' && estado.diag.diagnostico && estado.diag.diagnostico.motivo === 'dependencia-aguarda-aprovacao'));
    const sa = el('button', { type: 'button', class: 'lz-card lz-card-sa' + (estado.selecionado === 'superadmin' ? ' lz-card-ativo' : ''), 'aria-pressed': estado.selecionado === 'superadmin' ? 'true' : 'false', onclick: () => selecionar('superadmin') },
      el('span', { class: 'lz-card-nome', texto: 'Super Admin — você' }),
      el('span', { class: 'lz-card-funcao', texto: 'Aprova entregas sensíveis e ações de risco' }),
      el('span', { class: 'lz-status', 'data-tom': pendencias ? 'alerta' : 'ok' }, el('span', { class: 'lz-status-ponto', 'aria-hidden': 'true' }), pendencias ? 'Há decisão esperando você' : 'No comando'));
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
      el('span', { class: 'lz-status', 'data-tom': st.tom }, el('span', { class: 'lz-status-ponto', 'aria-hidden': 'true' }), st.rotulo),
      el('p', { class: 'lz-missao', texto: a.missao }),
      lista('Responsabilidades', a.responsabilidades),
      lista('Capacidades (ferramentas previstas)', a.ferramentas, 'lz-chips'),
      lista('Entregas', a.entregaveis, 'lz-chips'),
      lista('Critérios de qualidade', a.criteriosQualidade),
      el('div', { class: 'lz-bloco' }, el('h3', { texto: 'Execução simulada' }),
        etapas.length
          ? el('ul', { class: 'lz-lista' }, etapas.map((x) => el('li', { texto: `Etapa "${x.id}": ${rotuloEtapa(x.status)}${x.tentativas ? ` · ${x.tentativas} tentativa(s)` : ''}` })))
          : el('p', { class: 'lz-nota', texto: estado.diag ? 'Este agente não participa da tarefa atual.' : 'Nenhuma tarefa em andamento. Inicie uma simulação abaixo.' }),
        porAgente && porAgente.tokens ? el('p', { class: 'lz-nota', texto: `Consumo simulado nesta tarefa: ${porAgente.tokens} tokens (unidade simulada, sem cobrança).` }) : null),
      el('p', { class: 'lz-nota', texto: `Modelo: ${a.modelo === 'simulado' ? 'simulado (nenhum modelo real ligado)' : a.modelo}. Modos: ${a.modos.join(' e ')}.` }),
    );
  }

  function selecionar(id) {
    estado.selecionado = id;
    renderOrg();
    renderPainel();
    const alvo = document.querySelector(`.lz-card[aria-pressed="true"]`);
    if (alvo && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('lz-card')) alvo.focus();
    if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) { const p = $('lz-agente'); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // ---------- tarefa ----------
  const rotuloEtapa = (s) => ({ pendente: 'na fila', executando: 'trabalhando', concluida: 'concluída', falhou: 'falhou' }[s] || s);
  const nomeAgente = (id) => (estado.porId[id] ? estado.porId[id].nome : id);

  async function carregarEmpresas() {
    const sel = $('lz-empresa');
    try {
      const r = await chamar('empresas.listar', { status: 'ativa', limite: 50 });
      (r.itens || []).forEach((e) => sel.append(el('option', { value: e.id, texto: e.nome })));
    } catch (e) { /* sem empresas: a tarefa segue sem cliente */ }
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
      estado.exe = exe; estado.diag = null; estado.rel = null;
      $('lz-execucao').hidden = false;
      limpar($('lz-resultado'));
      aviso('Plano criado. Os agentes simulados estão trabalhando.', 'ok');
      acompanhar();
    } catch (e) {
      aviso(`Não deu para iniciar: ${e.message}`, 'erro');
      $('lz-iniciar').disabled = false;
      estado.ocupado = false;
    }
  }

  function acompanhar() {
    clearTimeout(estado.timer);
    const passo = async () => {
      if (!estado.exe) return;
      try {
        estado.diag = await chamar('execucoes.diagnostico', { execucaoId: estado.exe.id });
        estado.rel = await chamar('execucoes.relatorio', { execucaoId: estado.exe.id });
      } catch (e) { aviso(`Falha ao acompanhar: ${e.message}`, 'erro'); }
      renderOrg(); renderPainel(); renderExecucao();
      const fim = estado.diag && FINAIS.includes(estado.diag.estado);
      const parado = estado.diag && (estado.diag.estado === 'WAITING_APPROVAL' || estado.diag.estado === 'REVISION_REQUIRED');
      if (!fim) estado.timer = setTimeout(passo, parado ? 2500 : 900);
      else { estado.ocupado = false; $('lz-iniciar').disabled = false; await mostrarResultado(); }
    };
    passo();
  }

  function renderExecucao() {
    const d = estado.diag;
    const box = limpar($('lz-etapas'));
    const acoes = limpar($('lz-decisoes'));
    if (!d) return;
    $('lz-estado').textContent = ({ READY: 'Pronta', RUNNING: 'Em execução', WAITING_APPROVAL: 'Aguardando sua aprovação', REVISION_REQUIRED: 'Parada para revisão', COMPLETED: 'Concluída', FAILED: 'Falhou', CANCELLED: 'Cancelada', PLANNING: 'Planejando' }[d.estado] || d.estado);
    $('lz-estado').dataset.tom = d.estado === 'COMPLETED' ? 'ok' : d.estado === 'FAILED' ? 'erro' : (d.estado === 'WAITING_APPROVAL' || d.estado === 'REVISION_REQUIRED') ? 'alerta' : 'ativo';
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
        el('span', { class: 'lz-status', 'data-tom': tom }, el('span', { class: 'lz-status-ponto', 'aria-hidden': 'true' }), aguarda ? 'aguardando você' : rotuloEtapa(x.status))));
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
      acompanhar();
    } catch (e) { aviso(`Não deu para decidir: ${e.message}`, 'erro'); botao.disabled = false; }
  }
  async function decidirAcao(botao, p, decisao) {
    botao.disabled = true;
    try {
      await chamar('execucoes.decidirAprovacao', { execucaoId: estado.exe.id, aprovacaoId: p.id, decisao, assinatura: p.assinatura, justificativa: 'Decisão do Super Admin na interface da LABZ AI (simulação).' });
      aviso(decisao === 'aprovar' ? 'Ação aprovada (só simulada).' : 'Ação recusada.', 'ok');
      acompanhar();
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
            e.currentTarget.disabled = true;
            try { await chamar('entregas.decidir', { entregaId: c.entregaId, decisao: { decisao: 'aprovar', versao: c.versao, hash: (docRel && docRel.hash) || c.hash } }); aviso('Entrega final aprovada (simulação).', 'ok'); estado.rel = await chamar('execucoes.relatorio', { execucaoId: estado.exe.id }); mostrarResultado(); } catch (er) { aviso(`Não deu para aprovar: ${er.message}`, 'erro'); e.currentTarget.disabled = false; }
          } }, 'Aprovar entrega final (simulação)')));
      } else if (c.estado === 'aprovada') {
        box.append(el('p', { class: 'lz-nota', texto: 'Entrega final aprovada por você (simulação).' }));
      }
    } catch (e) { box.append(el('p', { class: 'lz-nota', texto: `Não deu para abrir o documento: ${e.message}` })); }
  }

  // ---------- início ----------
  async function labzIniciar() {
    const modo = await detectarModo();
    if (!modo) { $('labz-sem-permissao').hidden = false; return; }
    estado.modo = modo;
    $('labz-conteudo').hidden = false;
    const m = $('lz-modo');
    m.textContent = modo === 'demo' ? 'Demonstração local · tudo simulado' : 'Super Admin · agentes simulados';
    m.dataset.tom = modo === 'demo' ? 'alerta' : 'ok';
    const ex = $('lz-exemplos');
    EXEMPLOS.forEach((x) => ex.append(el('button', { type: 'button', class: 'btn btn-small', onclick: () => { $('lz-objetivo').value = x.texto; $('lz-objetivo').focus(); } }, x.nome)));
    $('lz-form').addEventListener('submit', iniciar);
    try {
      estado.agentes = await chamar('catalogo.agentes');
      estado.porId = Object.fromEntries(estado.agentes.map((a) => [a.id, a]));
    } catch (e) {
      aviso(modo === 'servidor' ? 'O servidor da LABZ AI ainda não está ligado (precisa do plano Blaze e da publicação da função). Nada foi alterado.' : `A demonstração não respondeu: ${e.message}`, 'erro');
      $('lz-form').querySelectorAll('textarea, select, button').forEach((n) => { n.disabled = true; });
      return;
    }
    if (modo === 'demo') aviso('Demonstração local: o backend real da LABZ AI roda em memória neste computador; o Estrategista e os agentes são simulados. Nada é publicado, enviado ou cobrado.', 'info');
    renderOrg();
    renderPainel();
    carregarEmpresas();
  }

  window.labzIniciar = labzIniciar;
})();
