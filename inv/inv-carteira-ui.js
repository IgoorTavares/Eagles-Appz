/* =====================================================================
   Investimentos · Etapa 07 (revisada na auditoria de 26/11/2026) — Minha Carteira
   Dados (regras em firestore.rules):
   - tenants/{t}/inv_carteiras/{cid}               carteira (pessoal: só o dono; empresa: Diretor e Financeiro)
   - .../inv_carteiras/{cid}/operacoes/{N}         operação NUMERADA (N = contador + 1), imutável
   - .../inv_carteiras/{cid}/estornos/{alvo}       marcador: cada operação só pode ser estornada uma vez
   - tenants/{t}/inv_precos/manual                 preços informados pela empresa (inclui o câmbio manual)
   Gravação: TRANSAÇÃO que relê o contador da carteira; se outra gravação entrou antes, as operações novas são
   lidas, a validação é refeita sobre a linha do tempo completa e só então grava (duas vendas simultâneas acima
   do saldo: a segunda é recusada). Avaliação: SÓ com preço autorizado ou manual (nunca simulado).
   Leitura: as operações são imutáveis; o aparelho reaproveita as que já leu (cache do próprio Firebase) e busca
   só as de número maior. NÃO integra com o Financeiro do ERP e NÃO envia ordens a corretoras.
   ===================================================================== */
(function () {
  'use strict';
  const K = window.INVEST.mercado, CT = window.INVEST.carteira, G = window.INVEST.graficos;
  const T = (window.INVEST.telas = window.INVEST.telas || {});
  const C = () => window.INVEST.ctx;
  const U = () => window.INVEST.mercadoUi;
  const W = (window.INVEST.carteiraEstado = { carteiras: null, estado: 'nao-lido', ops: {}, atual: null, erro: '', demo: false });

  // ---------- formatos ----------
  const brl = (cent) => (cent == null ? '—' : (cent < 0 ? '−' : '') + 'R$ ' + (Math.abs(cent) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (v, sinal = true) => (v == null || !isFinite(v) ? '—' : (sinal && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
  const cls = (v) => (v > 0 ? 'inv-sobe' : v < 0 ? 'inv-desce' : '');
  const qtdTxt = (q) => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
  const dataBr = (d) => String(d || '').split('-').reverse().join('/');
  const hoje = () => (typeof isoHoje === 'function' ? isoHoje() : C().M.diaHoje());
  const podeEmpresa = () => { const a = C().S.acesso || {}; return a.nivel === 'diretor' || a.nivel === 'financeiro'; };
  const numBr = (v) => (v == null || String(v).trim() === '' ? null : Number(String(v).trim().replace(/\./g, '').replace(',', '.')));

  // ---------- leitura (uma consulta por vez: pedidos repetidos aproveitam a mesma) ----------
  let emCurso = null;
  function carregarCarteiras(forcar) {
    if (W.estado === 'ok' && !forcar) return Promise.resolve();
    if (emCurso) return emCurso;
    emCurso = (async () => {
      const { S, invDb, ehNuvem } = C();
      if (!ehNuvem() || !(S.acesso.favoritos || S.acesso.carteiraPropria)) { W.carteiras = []; W.estado = 'sem-nuvem'; return; }
      W.estado = 'carregando';
      try {
        const col = firestoreDb.collection(`tenants/${TENANT_ID}/inv_carteiras`);
        const [p, e] = await Promise.all([
          invDb.consultar(col.where('dono', '==', USUARIO_UID).where('tipo', '==', 'pessoal'), 'abrir-carteira'),
          podeEmpresa() ? invDb.consultar(col.where('tipo', '==', 'empresa'), 'abrir-carteira') : Promise.resolve({ docs: [] }),
        ]);
        W.carteiras = [...p.docs, ...e.docs].map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.ativa === b.ativa ? a.nome.localeCompare(b.nome) : a.ativa ? -1 : 1));
        W.estado = 'ok';
        const salva = C().pref().carteira; W.atual = W.carteiras.find((c) => c.id === salva) ? salva : (W.carteiras.find((c) => c.ativa) || W.carteiras[0] || {}).id || null;
      } catch (err) { W.estado = 'erro'; W.erro = err.code === 'contencao' ? 'O módulo atingiu o limite de uso do dia.' : 'Não foi possível abrir as carteiras. Confira a internet.'; }
    })().finally(() => { emCurso = null; });
    return emCurso;
  }
  const opDeDoc = (d) => Object.assign({ id: d.id }, d.data());
  const contigua = (ops) => ops.every((o, i) => o.seq === i + 1 && o.id === String(i + 1));
  const opsEmCurso = {};
  // ate = número de operações que a carteira tem (contador lido do banco). Busca só o que falta.
  function carregarOps(c, ate, op = {}) {
    if (opsEmCurso[c.id]) return opsEmCurso[c.id];
    opsEmCurso[c.id] = (async () => {
      const { invDb } = C();
      const col = firestoreDb.collection(`tenants/${TENANT_ID}/inv_carteiras/${c.id}/operacoes`);
      const alvo = ate != null ? ate : c.opsN || 0;
      let ops = op.forcar ? [] : (W.ops[c.id] || null);
      if (!ops) { // 1º: o que o próprio Firebase já guardou neste aparelho (sem custo de leitura; operações não mudam)
        try { const sc = await col.where('seq', '<=', alvo).get({ source: 'cache' }); ops = sc.docs.map(opDeDoc).sort((a, b) => a.seq - b.seq); } catch (e) { ops = []; }
        const corte = ops.findIndex((o, i) => o.seq !== i + 1 || o.id !== String(i + 1)); if (corte >= 0) ops = ops.slice(0, corte);
      }
      if (ops.length < alvo) { // 2º: só as que faltam
        const s = await invDb.consultar(col.where('seq', '>', ops.length), 'abrir-carteira');
        const novas = s.docs.map(opDeDoc).filter((o) => o.seq > ops.length).sort((a, b) => a.seq - b.seq);
        ops = ops.concat(novas);
      }
      if (!contigua(ops) || ops.length < alvo) { // conferência: se faltar algo, lê tudo de novo (precisão acima de economia)
        const s = await invDb.consultar(col, 'abrir-carteira'); ops = s.docs.map(opDeDoc).sort((a, b) => (a.seq || 0) - (b.seq || 0));
      }
      W.ops[c.id] = ops; W.leiturasOps = (W.leiturasOps || 0);
      return ops;
    })().finally(() => { delete opsEmCurso[c.id]; });
    return opsEmCurso[c.id];
  }

  // ---------- preços: carteira REAL usa só o motor de avaliação (manual + fontes autorizadas; nunca simulado) ----------
  const USDBRL = () => K.MACRO.BR.find((x) => x.ticker === 'USDBRL');
  const motorDe = (demo) => (demo ? C().S.motor : C().S.motorReal);
  function precoEmFabrica(demo) {
    const m = motorDe(demo); const memo = new Map();
    const serie = (id) => { if (!memo.has(id)) { const a = C().porId(id); memo.set(id, a ? m.historico(a, 'MAX') : { pontos: [] }); } return memo.get(id); };
    const ultimoAte = (pts, d) => { let lo = 0, hi = pts.length - 1, r = -1; while (lo <= hi) { const k = (lo + hi) >> 1; if (pts[k].data <= d) { r = k; lo = k + 1; } else hi = k - 1; } return r >= 0 ? pts[r] : null; };
    return {
      precoEm: (id, d) => { const s = serie(id); const p = ultimoAte(s.pontos, d); return p ? { preco: p.fechamento, estado: s.estado } : null; },
      cambioEm: (d) => { const s = serie(USDBRL().assetId); const p = ultimoAte(s.pontos, d); return p ? { preco: p.fechamento, estado: s.estado } : null; },
    };
  }
  function resumo(c, ops, demo) {
    const m = motorDe(demo);
    const base = CT.calcular(ops, { saldoCarteira: c.demo ? null : c.saldo });
    const av = CT.avaliar(base, (id) => m.cotacao(C().porId(id) || { assetId: id, ticker: id.split(':')[2], pais: id.split(':')[0] }), m.cotacao(USDBRL()), (id) => C().porId(id), { aceitarSimulado: !!demo });
    return { base, av };
  }
  window.INVEST.carteiraResumo = resumo;

  // ---------- janela (padrão de janela do sistema) ----------
  function janela(titulo, corpo, aoSalvar, rotulo = 'Salvar') {
    let ov = document.getElementById('inv-modal');
    if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'inv-modal'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="modal inv-modal" role="dialog" aria-modal="true" aria-labelledby="inv-modal-tit"><div class="modal-header"><h2 id="inv-modal-tit">${C().E(titulo)}</h2><button type="button" class="close-btn" aria-label="Fechar" data-fechar>&times;</button></div>
      <form id="inv-modal-form" novalidate>${corpo}<p class="inv-modal-erro" role="alert" hidden></p><div class="modal-actions"><button type="button" class="btn" data-fechar>Cancelar</button><button type="submit" class="btn btn-primary">${C().E(rotulo)}</button></div></form></div>`;
    ov.classList.add('open');
    const fechar = () => ov.classList.remove('open');
    ov.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    const f = ov.querySelector('form'); const primeiro = f.querySelector('input,select'); if (primeiro) primeiro.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const er = f.querySelector('.inv-modal-erro'); er.hidden = true;
      const bt = f.querySelector('[type=submit]'); bt.disabled = true;
      try { const msg = await aoSalvar(f); if (msg === true || msg == null) fechar(); else { er.textContent = msg; er.hidden = false; } }
      catch (err) { er.textContent = mensagemErro(err); er.hidden = false; }
      bt.disabled = false;
    });
    return ov;
  }
  const mensagemErro = (err) => (err && err.code === 'contencao' ? 'O módulo atingiu o limite de uso do dia.' : err && err.code === 'permission-denied' ? 'O banco recusou a gravação (sem permissão, carteira arquivada ou dados fora do padrão).'
    : err && err.code === 'invalida' ? err.message : err && err.code === 'limite' ? 'Limite de 5.000 operações nesta carteira.' : 'Não foi possível salvar. Confira a internet e tente de novo.');
  const campo = (rot, html, full) => `<div class="field${full ? ' full' : ''}"><label>${C().E(rot)}${html}</label></div>`;

  function novaCarteira() {
    janela('Nova carteira', `<div class="form-grid">
      ${campo('Nome', '<input name="nome" maxlength="60" required placeholder="Ex.: Aposentadoria">', true)}
      <div class="field full"><label>Tipo</label><select name="tipo"><option value="pessoal">Pessoal — só você vê (nem o Diretor nem o Super Admin)</option>${podeEmpresa() ? '<option value="empresa">Da empresa — Diretor e Financeiro veem</option>' : ''}</select></div>
      ${campo('Corretoras (separe por vírgula)', '<input name="corretoras" maxlength="200" placeholder="Ex.: XP, Rico">', true)}
      <div class="field full"><label class="inv-check"><input type="checkbox" name="caixa" checked> Compra sem caixa registrado conta como aporte (recomendado)</label></div></div>`, async (f) => {
      const nome = f.nome.value.trim(); if (!nome) return 'Informe o nome.';
      const corretoras = f.corretoras.value.split(',').map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
      const FV = firebase.firestore.FieldValue;
      const ref = firestoreDb.collection(`tenants/${TENANT_ID}/inv_carteiras`).doc();
      await C().invDb.gravar(ref.path, { nome: nome.slice(0, 60), tipo: f.tipo.value, dono: USUARIO_UID, corretoras, moedaBase: 'BRL', caixaAutomatico: f.caixa.checked, ativa: true, opsN: 0, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01', criadoEm: FV.serverTimestamp(), atualizadoEm: FV.serverTimestamp() }, 'salvar-carteira');
      C().salvarPref({ carteira: ref.id }); W.estado = 'nao-lido'; W.ops[ref.id] = []; W.demo = false;
      C().toastInv('Carteira criada.'); render(); return true;
    }, 'Criar carteira');
  }
  function editarCarteira(c) {
    janela('Editar carteira', `<div class="form-grid">${campo('Nome', `<input name="nome" maxlength="60" value="${C().E(c.nome)}">`, true)}${campo('Corretoras (separe por vírgula)', `<input name="corretoras" maxlength="200" value="${C().E((c.corretoras || []).join(', '))}">`, true)}
      <div class="field full"><label class="inv-check"><input type="checkbox" name="ativa"${c.ativa ? ' checked' : ''}> Carteira ativa (desmarque para arquivar: nada é apagado e nenhuma operação nova é aceita)</label></div></div>`, async (f) => {
      const nome = f.nome.value.trim(); if (!nome) return 'Informe o nome.';
      await C().invDb.gravar(`tenants/${TENANT_ID}/inv_carteiras/${c.id}`, { nome: nome.slice(0, 60), corretoras: f.corretoras.value.split(',').map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20), ativa: f.ativa.checked, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, 'salvar-carteira', true);
      Object.assign(c, { nome: nome.slice(0, 60), ativa: f.ativa.checked }); C().toastInv('Carteira atualizada.'); render(); return true;
    });
  }

  // ---------- gravação segura: transação + número sequencial + validação sobre a linha do tempo completa ----------
  // Etapa 10: a validação usa o SALDO guardado na carteira (lido dentro da transação): não precisa carregar as operações.
  // As regras do banco refazem a mesma conta; se outra gravação entrou antes, a transação relê e confere de novo.
  async function gravarOp(c, o) {
    const { S } = C();
    if (!C().M.podeExecutar('salvar-operacao', S.consumo.estado)) throw Object.assign(new Error('pausado'), { code: 'contencao' });
    if (!c.ativa) throw Object.assign(new Error('Carteira arquivada: reative para lançar.'), { code: 'invalida' });
    const v0 = CT.validarOperacao(o, hoje()); if (!v0.ok) throw Object.assign(new Error('Confira: ' + v0.erros.join('; ') + '.'), { code: 'invalida' });
    const FV = firebase.firestore.FieldValue;
    const cartRef = firestoreDb.doc(`tenants/${TENANT_ID}/inv_carteiras/${c.id}`);
    let alvo = null;
    if (o.tipo === 'estorno') {
      const ops = W.ops[c.id] || []; const x = ops.find((y) => y.id === o.estorna);
      if (x) alvo = x; else { const sn = await cartRef.collection('operacoes').doc(o.estorna).get(); window.INVEST.medidor.contar('leituras', 1 + C().RG, 'salvar-operacao'); if (sn.exists) alvo = Object.assign({ id: sn.id }, sn.data()); }
      if (!alvo) throw Object.assign(new Error('Operação a estornar não encontrada.'), { code: 'invalida' });
    }
    let pronto = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        pronto = await firestoreDb.runTransaction(async (tx) => {
          const snap = await tx.get(cartRef);
          const d = snap.data();
          if (!d || d.ativa !== true) throw Object.assign(new Error('Carteira arquivada.'), { code: 'invalida' });
          if (d.opsN >= 5000) throw Object.assign(new Error('limite'), { code: 'limite' });
          const p = CT.prepararOperacao(d, o, { hoje: hoje(), alvo });
          if (!p.ok) throw Object.assign(new Error('Não foi possível lançar: ' + p.erros.join('; ') + '.'), { code: 'invalida' });
          const num = d.opsN + 1; const id = String(num);
          tx.set(cartRef.collection('operacoes').doc(id), Object.assign({}, p.gravar, { seq: num, criadoPor: USUARIO_UID, criadoEm: FV.serverTimestamp() }));
          tx.update(cartRef, { opsN: num, saldo: p.saldo, ultimaData: p.ultimaData, atualizadoEm: FV.serverTimestamp() });
          if (o.tipo === 'estorno') tx.set(cartRef.collection('estornos').doc(o.estorna), { op: id, criadoPor: USUARIO_UID, criadoEm: FV.serverTimestamp() });
          return { num, p };
        });
        break;
      } catch (err) {
        // número já ocupado por outra gravação simultânea: as regras recusam (permission-denied). Se o contador mudou,
        // tenta de novo (a transação relê o saldo atualizado e refaz a conta). Se não mudou, o erro é real e sobe.
        if (err.code !== 'permission-denied') throw err;
        let mudou = false;
        try { const d = (await cartRef.get({ source: 'server' })).data(); window.INVEST.medidor.contar('leituras', 1 + C().RG, 'salvar-operacao'); mudou = !!(d && d.opsN !== c.opsN && d.ativa === true); if (mudou) Object.assign(c, { opsN: d.opsN, saldo: d.saldo, ultimaData: d.ultimaData }); } catch (e2) { /* sem rede */ }
        if (!mudou) throw err;
      }
    }
    if (!pronto) throw new Error('Muitas gravações ao mesmo tempo nesta carteira. Tente de novo.');
    window.INVEST.medidor.contar('leituras', 1 + C().RG + (o.tipo === 'estorno' ? 4 : 2), 'salvar-operacao');
    window.INVEST.medidor.contar('gravacoes', o.tipo === 'estorno' ? 3 : 2, 'salvar-operacao');
    const { num, p } = pronto;
    const antes = W.ops[c.id];
    Object.assign(c, { opsN: num, saldo: p.saldo, ultimaData: p.ultimaData });
    if (antes && antes.length === num - 1) W.ops[c.id] = antes.concat([Object.assign({ id: String(num), seq: num }, p.gravar)]);
    else delete W.ops[c.id]; // as operações em memória estavam incompletas: relê só as que faltam na próxima abertura
    return num;
  }
  window.INVEST.carteiraGravarOp = gravarOp; // para os testes de concorrência

  function lancar(c, inicial) {
    const { E, S } = C();
    const tipos = Object.entries(CT.TIPOS).filter(([k]) => k !== 'estorno');
    const lista = (S.cat || []).filter((a) => a.situacao === 'ativo' || a.situacao == null).slice(0, 3000);
    const ov = janela('Lançar operação · ' + c.nome, `<div class="form-grid">
      <div class="field"><label>Tipo<select name="tipo">${tipos.map(([k, t]) => `<option value="${k}"${(inicial && inicial.tipo) === k ? ' selected' : ''}>${E(t.nome)}</option>`).join('')}</select></label></div>
      <div class="field"><label>Data<input type="date" name="data" value="${hoje()}" min="${E(c.ultimaData && c.ultimaData > '1900-01-01' ? c.ultimaData : '1990-01-01')}" max="${hoje()}" required></label>${c.ultimaData && c.ultimaData > '1900-01-01' ? `<small class="inv-muda">Lançamentos em ordem de data: a última operação é de ${E(c.ultimaData.split('-').reverse().join('/'))}.</small>` : ''}</div>
      <div class="field full" data-c="ativo"><label>Ativo (código)<input name="ativo" list="inv-op-ativos" maxlength="20" autocomplete="off" placeholder="Ex.: PETR4" value="${E((inicial && inicial.ticker) || '')}"></label><datalist id="inv-op-ativos">${lista.map((a) => `<option value="${E(a.ticker)}">${E(a.nome)}${a.teste ? ' (TESTE)' : ''}</option>`).join('')}</datalist></div>
      <div class="field" data-c="qtd"><label>Quantidade<input name="qtd" inputmode="decimal" placeholder="0"></label></div>
      <div class="field" data-c="preco"><label>Preço unitário<input name="preco" inputmode="decimal" placeholder="0,00"></label></div>
      <div class="field" data-c="valor"><label><span data-rot-valor>Valor</span><input name="valor" inputmode="decimal" placeholder="0,00"></label></div>
      <div class="field" data-c="fator"><label>Fator (ex.: 2 = cada 1 vira 2)<input name="fator" inputmode="decimal" placeholder="2"></label></div>
      <div class="field" data-c="taxas"><label>Taxas e corretagem<input name="taxas" inputmode="decimal" placeholder="0,00"></label></div>
      <div class="field" data-c="ir"><label>IR retido na fonte<input name="ir" inputmode="decimal" placeholder="0,00"></label></div>
      <div class="field" data-c="cambio"><label>Câmbio do dia (R$ por US$)<input name="cambio" inputmode="decimal" placeholder="5,40"></label></div>
      <div class="field"><label>Corretora<input name="corretora" list="inv-op-corr" maxlength="40"></label><datalist id="inv-op-corr">${(c.corretoras || []).map((x) => `<option value="${E(x)}">`).join('')}</datalist></div>
      <div class="field full"><label>Observação<input name="nota" maxlength="200"></label></div>
      <p class="inv-muda full" data-dica></p></div>`, async (f) => {
      const t = f.tipo.value; const def = CT.TIPOS[t];
      const a = def.ativo ? (S.cat || []).find((x) => x.ticker === f.ativo.value.trim().toUpperCase()) : null;
      if (def.ativo && !a) return 'Ativo não encontrado no catálogo. Escolha da lista.';
      const o = { tipo: t, data: f.data.value, assetId: a ? a.assetId : undefined, qtd: numBr(f.qtd.value), preco: numBr(f.preco.value), valor: numBr(f.valor.value), fator: numBr(f.fator.value), taxas: numBr(f.taxas.value) || 0, irRetido: numBr(f.ir.value) || 0, moeda: a && a.moeda === 'USD' ? 'USD' : 'BRL', cambio: numBr(f.cambio.value), corretora: f.corretora.value.trim(), nota: f.nota.value.trim() };
      await gravarOp(c, o); C().toastInv('Operação lançada.'); render(); return true;
    }, 'Lançar');
    const f = ov.querySelector('form');
    const ajustar = () => {
      const t = CT.TIPOS[f.tipo.value]; const a = (S.cat || []).find((x) => x.ticker === f.ativo.value.trim().toUpperCase());
      const mostra = { ativo: !!t.ativo, qtd: !!t.qtd, preco: !!t.preco, valor: !!(t.valor || t.valorOpcional), fator: !!t.fator, taxas: !!(t.preco), ir: !!t.provento, cambio: !!(a && a.moeda === 'USD') };
      f.querySelectorAll('[data-c]').forEach((el) => { el.hidden = !mostra[el.dataset.c]; });
      f.querySelector('[data-rot-valor]').textContent = t.valorOpcional ? 'Custo atribuído (opcional)' : t.provento ? 'Valor bruto recebido' : 'Valor';
      f.querySelector('[data-dica]').textContent = t.provento ? 'Lance cada provento uma vez só. O valor líquido (bruto − IR) entra no caixa da carteira.'
        : f.tipo.value === 'aporte' ? 'Aporte é dinheiro que entrou na carteira: não conta como rentabilidade.' : f.tipo.value === 'compra' ? 'Se a carteira não tiver caixa, a compra conta como aporte (dinheiro que veio de fora).'
          : f.tipo.value === 'venda' || f.tipo.value === 'retirada' ? 'O saldo é conferido pelo banco: vender ou retirar mais do que há na carteira é recusado.' : a && a.teste ? 'Atenção: este é um ativo de TESTE (fictício).' : '';
    };
    f.tipo.addEventListener('change', ajustar); f.ativo.addEventListener('input', ajustar); ajustar();
  }

  function estornar(c, o) {
    const { E } = C();
    janela('Estornar operação', `<p>Isto anula a operação abaixo nos cálculos. Ela continua no histórico, marcada como estornada, e o estorno fica registrado com seu nome e horário. Cada operação só pode ser estornada uma vez. Para corrigir, lance a operação certa depois.</p>
      <p class="inv-modal-op"><strong>${E(CT.TIPOS[o.tipo].nome)}</strong> · ${E(dataBr(o.data))}${o.assetId ? ' · ' + E(o.assetId.split(':')[2]) : ''}${o.qtd ? ' · ' + E(qtdTxt(o.qtd)) : ''}${o.preco != null ? ' × ' + E(o.preco) : ''}${o.valor ? ' · ' + E(brl(Math.round(o.valor * 100))) : ''}</p>
      <div class="field"><label>Motivo (opcional)<input name="nota" maxlength="200"></label></div>`, async (f) => {
      await gravarOp(c, { tipo: 'estorno', data: hoje(), estorna: o.id, moeda: 'BRL', nota: f.nota.value.trim() }); C().toastInv('Operação estornada.'); render(); return true;
    }, 'Estornar');
  }

  function precosManuais() {
    const { E, S, invDb } = C();
    const itens = Object.values(S.precosManuais || {});
    const codigo = (id) => (id === USDBRL().assetId ? 'USDBRL' : id.split(':')[2]);
    janela('Preços informados pela empresa', `<p class="inv-muda">Para avaliar carteiras sem uma fonte de cotações contratada. Valem para toda a empresa e aparecem como <strong>Manual</strong>, com a data. Um por linha: <code>CÓDIGO;PREÇO;AAAA-MM-DD</code>. Para o câmbio do dólar use o código <code>USDBRL</code>.</p>
      <div class="field"><label>Preços<textarea name="lista" rows="8" maxlength="12000">${E(itens.map((x) => `${codigo(x.assetId)};${String(x.preco).replace('.', ',')};${x.data}`).join('\n'))}</textarea></label></div>`, async (f) => {
      const out = []; const erros = [];
      f.lista.value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
        const [tk, pr, dt] = l.split(';').map((x) => (x || '').trim());
        const a = tk.toUpperCase() === 'USDBRL' ? USDBRL() : (S.cat || []).find((x) => x.ticker === tk.toUpperCase()); const preco = numBr(pr);
        if (!a || !(preco > 0) || preco > CT.LIM.preco || !/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt > hoje()) erros.push(i + 1); else out.push({ assetId: a.assetId, preco, data: dt, moeda: a.moeda || 'BRL' });
      });
      if (erros.length) return 'Confira as linhas ' + erros.join(', ') + ' (código do catálogo ou USDBRL; preço maior que zero; data AAAA-MM-DD até hoje).';
      if (out.length > 300) return 'Até 300 preços.';
      await invDb.gravar(`tenants/${TENANT_ID}/inv_precos/manual`, { itens: out, por: USUARIO_UID, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, 'salvar-precos');
      S.precosManuais = {}; out.forEach((x) => { S.precosManuais[x.assetId] = x; }); C().montarMotor(); C().toastInv('Preços salvos.'); render(); return true;
    });
  }

  // exportação (pedido da própria pessoa; LGPD): arquivo CSV com todas as operações, gerado no próprio aparelho
  function exportar(c, ops) {
    const col = ['numero', 'data', 'tipo', 'ativo', 'quantidade', 'preco', 'valor', 'taxas', 'ir_retido', 'fator', 'moeda', 'cambio', 'estorna', 'corretora', 'observacao'];
    const q = (v) => { const t = v == null ? '' : String(v); return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? '"' + t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : t; };
    const linhas = [col.join(';')].concat(ops.map((o) => [o.seq, o.data, o.tipo, o.assetId, o.qtd, o.preco, o.valor, o.taxas, o.irRetido, o.fator, o.moeda, o.cambio, o.estorna, o.corretora, o.nota].map(q).join(';')));
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `carteira-${c.nome.replace(/[^\w-]+/g, '_').slice(0, 40)}-${hoje()}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- cópia de segurança da carteira (compatível com o plano gratuito, sem exportação gerenciada) ----------
  // Exportar: arquivo .json com a carteira e TODAS as operações (com o efeito de cada uma e o saldo conferido).
  // Importar: cria uma carteira NOVA e relança as operações uma a uma pelo mesmo caminho da tela (as regras conferem
  // cada uma); no fim, o saldo tem que bater com o do arquivo. Não sobrescreve nada que já exista.
  function exportarJson(c, ops) {
    const obj = { app: 'eagles-labz', tipo: 'inv-carteira', versao: 1, geradoEm: new Date().toISOString(),
      carteira: { nome: c.nome, tipo: c.tipo, corretoras: c.corretoras || [], caixaAutomatico: c.caixaAutomatico !== false, saldo: c.saldo, ultimaData: c.ultimaData, opsN: c.opsN },
      operacoes: ops.map((o) => { const x = Object.assign({}, o); delete x.criadoEm; delete x.criadoPor; return x; }) };
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `carteira-${c.nome.replace(/[^\w-]+/g, '_').slice(0, 40)}-${hoje()}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return obj;
  }
  async function importarObjeto(obj, opcoes = {}) {
    if (!obj || obj.app !== 'eagles-labz' || obj.tipo !== 'inv-carteira' || !Array.isArray(obj.operacoes) || !obj.carteira) throw Object.assign(new Error('Arquivo inválido: não é uma cópia de carteira do Eagles Labz.'), { code: 'invalida' });
    if (obj.operacoes.length > 5000) throw Object.assign(new Error('Arquivo com mais de 5.000 operações.'), { code: 'invalida' });
    const tipo = obj.carteira.tipo === 'empresa' && podeEmpresa() ? 'empresa' : 'pessoal';
    const FV = firebase.firestore.FieldValue; const ref = firestoreDb.collection(`tenants/${TENANT_ID}/inv_carteiras`).doc();
    const nome = String((opcoes.nome || obj.carteira.nome || 'Carteira') + ' (restaurada)').slice(0, 60);
    await C().invDb.gravar(ref.path, { nome, tipo, dono: USUARIO_UID, corretoras: (obj.carteira.corretoras || []).slice(0, 20).map((x) => String(x).slice(0, 40)), moedaBase: 'BRL', caixaAutomatico: obj.carteira.caixaAutomatico !== false, ativa: true, opsN: 0, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01', criadoEm: FV.serverTimestamp(), atualizadoEm: FV.serverTimestamp() }, 'salvar-carteira');
    const c = { id: ref.id, nome, tipo, dono: USUARIO_UID, ativa: true, opsN: 0, caixaAutomatico: obj.carteira.caixaAutomatico !== false, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01', corretoras: obj.carteira.corretoras || [] };
    W.ops[c.id] = [];
    const novoId = {}; const campos = ['tipo', 'data', 'assetId', 'qtd', 'preco', 'valor', 'taxas', 'irRetido', 'fator', 'moeda', 'cambio', 'corretora', 'nota'];
    const lista = obj.operacoes.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    for (const [i, o] of lista.entries()) {
      const x = {}; campos.forEach((k) => { if (o[k] != null) x[k] = o[k]; });
      if (o.tipo === 'estorno') { x.estorna = novoId[o.estorna]; if (!x.estorna) throw Object.assign(new Error(`Operação nº ${o.seq}: estorno de uma operação que não está no arquivo.`), { code: 'invalida' }); }
      const n = await gravarOp(c, x);
      novoId[o.id] = String(n);
      if (opcoes.progresso) opcoes.progresso(i + 1, lista.length);
    }
    const igual = JSON.stringify(c.saldo) === JSON.stringify({ caixa: obj.carteira.saldo.caixa, pos: obj.carteira.saldo.pos }) || (c.saldo.caixa === obj.carteira.saldo.caixa && Object.keys(Object.assign({}, c.saldo.pos, obj.carteira.saldo.pos)).every((k) => (c.saldo.pos[k] || 0) === (obj.carteira.saldo.pos[k] || 0)));
    W.estado = 'nao-lido'; C().salvarPref({ carteira: c.id });
    return { carteira: c, conferido: igual };
  }
  window.INVEST.carteiraBackup = { exportarJson, importarObjeto };
  function importar() {
    janela('Importar carteira (cópia de segurança)', `<p class="inv-muda">Escolha um arquivo <strong>.json</strong> exportado por “Exportar (cópia)”. Uma carteira NOVA é criada e as operações são relançadas uma a uma, conferidas pelo banco. Nada que já existe é alterado. Cada operação gasta 2 gravações.</p>
      <div class="field"><label>Arquivo<input type="file" name="arq" accept="application/json,.json"></label></div><p class="inv-muda" data-prog></p>`, async (f) => {
      const arq = f.arq.files && f.arq.files[0]; if (!arq) return 'Escolha o arquivo.';
      let obj; try { obj = JSON.parse(await arq.text()); } catch (e) { return 'Esse arquivo não é uma cópia válida.'; }
      const r = await importarObjeto(obj, { progresso: (i, n) => { const el = f.querySelector('[data-prog]'); if (el) el.textContent = `Relançando ${i} de ${n}…`; } });
      C().toastInv(r.conferido ? 'Carteira restaurada e conferida.' : 'Carteira restaurada, mas o saldo não bateu com o arquivo: confira.'); render(); return true;
    }, 'Importar');
  }

  // ---------- carteira de DEMONSTRAÇÃO: só em memória, números fictícios, nunca gravada nem misturada ----------
  function carteiraDemo() {
    const { S } = C();
    const pega = (cl, n) => (S.cat || []).filter((a) => a.classe === cl && a.situacao === 'ativo' && a.pais === 'BR').slice(0, n);
    const [a1, a2] = pega('acao', 2); const [f1] = pega('fii', 1);
    const c = { id: '__demo__', nome: 'Demonstração (fictícia)', tipo: 'demo', ativa: false, caixaAutomatico: true, corretoras: ['Corretora fictícia'], demo: true };
    const m = S.motor; const p = (a, d) => { const h = m.historico(a, 'MAX').pontos; const x = h.find((y) => y.data >= d) || h[h.length - 1]; return x ? x.fechamento : 10; };
    const ops = [];
    const dc = { caixaAutomatico: true, saldo: { caixa: 0, pos: {} }, ultimaData: '1900-01-01' };
    const add = (o) => { const r = CT.prepararOperacao(dc, Object.assign({ moeda: 'BRL' }, o), {}); if (!r.ok) return; ops.push(Object.assign({ id: String(ops.length + 1), seq: ops.length + 1 }, r.gravar)); dc.saldo = r.saldo; dc.ultimaData = r.ultimaData; };
    add({ tipo: 'aporte', data: '2025-02-03', valor: 20000 });
    if (a1) add({ tipo: 'compra', data: '2025-02-04', assetId: a1.assetId, qtd: 200, preco: p(a1, '2025-02-04'), taxas: 5 });
    if (f1) add({ tipo: 'compra', data: '2025-03-10', assetId: f1.assetId, qtd: 50, preco: p(f1, '2025-03-10'), taxas: 3 });
    if (a2) add({ tipo: 'compra', data: '2025-05-12', assetId: a2.assetId, qtd: 100, preco: p(a2, '2025-05-12') });
    if (f1) add({ tipo: 'rendimento', data: '2025-06-15', assetId: f1.assetId, valor: 50 });
    if (a1) add({ tipo: 'venda', data: '2025-09-01', assetId: a1.assetId, qtd: 50, preco: p(a1, '2025-09-01'), taxas: 2 });
    return { c, ops };
  }

  // ---------- resumo pelo saldo (carteiras grandes) ----------
  const LIMITE_RESUMO = 300;
  function telaResumo(host, c, acoesTopo, ligarTopo) {
    const { E, cabecalho, tagEstado } = C(); const m = C().S.motorReal;
    const itens = Object.entries((c.saldo || {}).pos || {}).filter(([, q]) => q > 0).map(([id, q]) => {
      const a = C().porId(id) || { assetId: id, ticker: id.split(':')[2], pais: id.split(':')[0] }; const cot = m.cotacao(a);
      const ok = CT.precoValido(cot) && (a.moeda !== 'USD');
      return { a, q, cot, valor: ok ? CT.valorCentavos(q, CT.paraE8(cot.preco)) : null };
    });
    const cobertos = itens.filter((i) => i.valor != null); const soma = cobertos.reduce((t, i) => t + i.valor, 0);
    host.innerHTML = cabecalho('Minha carteira', `${c.nome} · ${c.opsN} operações · resumo pelo saldo conferido pelo banco`, acoesTopo) + `
      <div class="inv-faixa inv-faixa-aviso" role="note"><strong>Resumo rápido.</strong> Esta carteira tem ${c.opsN} operações. Para economizar o limite diário do Firebase, mostramos o saldo (quantidades e caixa) guardado na carteira, que o banco confere a cada lançamento. Preço médio, resultado, proventos e histórico precisam ler todas as operações (cerca de ${c.opsN} leituras, só na primeira vez neste aparelho).</div>
      <div class="inv-kpis"><div class="inv-kpi"><span>Caixa</span><strong>${brl((c.saldo || {}).caixa || 0)}</strong></div>
        <div class="inv-kpi"><span>Patrimônio</span><strong>${cobertos.length === itens.length ? brl(soma + ((c.saldo || {}).caixa || 0)) : cobertos.length ? brl(soma + ((c.saldo || {}).caixa || 0)) : 'Indisponível'}</strong><small>${cobertos.length === itens.length ? 'avaliação completa' : `${cobertos.length} de ${itens.length} ativos com preço autorizado ou manual`}</small></div>
        <div class="inv-kpi"><span>Última operação</span><strong>${E(String(c.ultimaData || '').split('-').reverse().join('/'))}</strong></div></div>
      <div class="panel"><div class="panel-title"><h2>Posições (quantidades)</h2></div><div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Ativo</th><th class="cad-num">Quantidade</th><th class="cad-num">Preço</th><th class="cad-num">Valor</th></tr></thead><tbody>
        ${itens.map((i) => `<tr><td data-label="Ativo"><strong>${E(i.a.ticker)}</strong></td><td data-label="Quantidade" class="cad-num">${E(qtdTxt(i.q / 1e8))}</td><td data-label="Preço" class="cad-num">${i.valor == null ? '—' : E(U().nf(i.cot.preco))} ${tagEstado(i.valor == null ? 'indisponivel' : i.cot.estado)}</td><td data-label="Valor" class="cad-num">${brl(i.valor)}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="panel"><button type="button" class="btn btn-primary" id="inv-ct-completo">Carregar o histórico completo (${c.opsN} leituras)</button> <button type="button" class="btn" id="inv-ct-lancar2"${c.ativa ? '' : ' disabled'}>+ Lançar operação</button></div>`;
    ligarTopo();
    host.querySelector('#inv-ct-completo').onclick = () => { W.completo = Object.assign(W.completo || {}, { [c.id]: true }); render(); };
    host.querySelector('#inv-ct-lancar2').onclick = () => lancar(c);
  }

  // ---------- tela ----------
  let hostAtual = null;
  function render() { if (hostAtual && hostAtual.isConnected && C().rota().aba === 'carteira') T.carteira(hostAtual); }

  T.carteira = async function (host) {
    hostAtual = host;
    const { S, E, estado, cabecalho, tagEstado } = C();
    const tit = 'Minha carteira';
    if (!(S.acesso.favoritos || S.acesso.carteiraPropria)) { host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('info', 'Carteiras indisponíveis para este acesso', S.acesso.admin ? 'O Super Admin só tem carteira própria quando está vinculado a uma empresa com o módulo ligado, e não vê as carteiras de outras pessoas nem as da empresa (privacidade).' : 'Entre com o login da empresa para usar carteiras.')}</div>`; return; }
    if (S.estadoCat !== 'ok') { host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('carregando', 'Carregando…')}</div>`; return; }
    if (W.demo && !S.simulador) W.demo = false;
    if (W.estado !== 'ok' && !W.demo) {
      host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('carregando', 'Abrindo suas carteiras…')}</div>`;
      await carregarCarteiras(); if (C().rota().aba !== 'carteira') return;
      if (W.estado === 'erro') { host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('erro', 'Carteiras indisponíveis', W.erro, '<button class="btn btn-primary" id="inv-ct-tentar" type="button">Tentar de novo</button>')}</div>`; host.querySelector('#inv-ct-tentar').onclick = () => { W.estado = 'nao-lido'; render(); }; return; }
    }
    const btDemo = S.simulador ? `<button type="button" class="btn btn-small btn-ghost" id="inv-ct-demo" aria-pressed="${W.demo}">${W.demo ? 'Sair da demonstração' : 'Ver demonstração'}</button>` : '';
    const acoesTopo = `<div class="inv-acoes-topo">${btDemo}${W.demo ? '' : '<button type="button" class="btn btn-small btn-ghost" id="inv-ct-importar">Importar carteira</button>'}${podeEmpresa() && !W.demo ? '<button type="button" class="btn btn-small btn-ghost" id="inv-ct-precos">Preços manuais</button>' : ''}${W.demo ? '' : '<button type="button" class="btn btn-small" id="inv-ct-nova">+ Nova carteira</button>'}</div>`;
    const ligarTopo = () => {
      const d = host.querySelector('#inv-ct-demo'); if (d) d.onclick = () => { W.demo = !W.demo; render(); };
      const n = host.querySelector('#inv-ct-nova'); if (n) n.onclick = novaCarteira;
      const im = host.querySelector('#inv-ct-importar'); if (im) im.onclick = importar;
      const pm = host.querySelector('#inv-ct-precos'); if (pm) pm.onclick = precosManuais;
    };
    if (!W.demo && !W.carteiras.length) {
      host.innerHTML = cabecalho(tit, 'Pessoal e da empresa · avaliadas só com preços autorizados ou manuais', acoesTopo) + `<div class="panel">${estado('info', 'Nenhuma carteira ainda', 'Crie uma carteira pessoal (só você vê) ou, se você for Diretor ou Financeiro, uma carteira da empresa.', '<button class="btn btn-primary" type="button" id="inv-ct-nova2">Criar carteira</button>')}</div>`;
      host.querySelector('#inv-ct-nova2').onclick = novaCarteira; ligarTopo(); return;
    }
    let c, ops; const demo = W.demo;
    if (demo) ({ c, ops } = carteiraDemo());
    else {
      c = W.carteiras.find((x) => x.id === W.atual) || W.carteiras[0]; W.atual = c.id;
      // carteira GRANDE e ainda não lida neste aparelho: mostra o resumo pelo SALDO guardado (2 leituras) e só lê as
      // operações (uma leitura por operação) quando a pessoa pede o histórico completo
      if (!W.ops[c.id] && (c.opsN || 0) > LIMITE_RESUMO && !(W.completo || {})[c.id]) { telaResumo(host, c, acoesTopo, ligarTopo); return; }
      if (!W.ops[c.id] || W.ops[c.id].length < (c.opsN || 0)) host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('carregando', 'Calculando a carteira…')}</div>`;
      try { ops = await carregarOps(c); } catch (err) { host.innerHTML = cabecalho(tit, '') + `<div class="panel">${estado('erro', 'Não foi possível abrir as operações', err.code === 'contencao' ? 'Limite de uso do dia atingido.' : 'Confira a internet e tente de novo.')}</div>`; return; }
      if (C().rota().aba !== 'carteira') return;
    }
    const { base, av } = resumo(c, ops, demo);
    const pe = precoEmFabrica(demo);
    const ev = CT.evolucao(ops, pe.precoEm, pe.cambioEm, (id) => C().porId(id), hoje(), { caixaAutomatico: c.caixaAutomatico !== false, aceitarSimulado: demo });
    const xi = demo ? { taxa: ev.xirr, motivo: ev.motivo } : CT.xirrCarteira(base, av, hoje());
    const kpi = (rot, val, extra, cl) => `<div class="inv-kpi"><span>${E(rot)}</span><strong class="${cl || ''}">${val}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
    const R = (k) => ({ acao: 'Ações', fii: 'FIIs', etf: 'ETFs', bdr: 'BDRs', reit: 'REITs', tesouro: 'Tesouro Direto', renda_fixa: 'Renda fixa', cripto: 'Cripto', fundo: 'Fundos' }[k] || k);
    const distr = (titulo, d) => `<div><h3>${E(titulo)}</h3>${d.length ? `<ul class="inv-barras">${d.map((x) => `<li><span>${E(x.rotulo)}</span><span class="inv-barra"><i style="width:${Math.max(1, x.pct)}%"></i></span><strong>${pct(x.pct, false)}</strong></li>`).join('')}</ul>` : '<p class="inv-muda">Sem posições avaliadas.</p>'}</div>`;
    const tipoOp = (o) => (CT.TIPOS[o.tipo] ? CT.TIPOS[o.tipo].nome : o.tipo);
    const estornadas = new Set(ops.filter((o) => o.tipo === 'estorno' && !base.inconsistencias.some((i) => i.id === o.id)).map((o) => o.estorna));
    const inconsistentes = new Set(base.inconsistencias.map((i) => i.id));
    const hist = ops.slice().sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.seq || 0) - (a.seq || 0)));
    const ult12 = (() => { const m = new Map(); ops.filter((o) => CT.TIPOS[o.tipo] && CT.TIPOS[o.tipo].provento && !estornadas.has(o.id)).forEach((o) => { const k = o.data.slice(0, 7); m.set(k, (m.get(k) || 0) + Math.round(((o.valor || 0) - (o.irRetido || 0)) * 100 * (o.moeda === 'USD' ? o.cambio || 0 : 1))); }); return m; })();
    const sit = av.situacao;
    const patTxt = sit === 'inconsistente' ? 'Indisponível' : sit === 'indisponivel' ? 'Indisponível' : brl(av.patrimonio);
    const patExtra = sit === 'parcial' ? `<strong>parcial</strong>: ${av.cobertura.ativos} de ${av.cobertura.de} ativos avaliados (${pct(av.cobertura.custoPct, false)} do custo) + caixa ${brl(av.caixa)}`
      : sit === 'indisponivel' ? 'nenhum ativo com preço autorizado ou manual' : sit === 'inconsistente' ? 'carteira com operações inconsistentes' : `posições ${brl(av.posicoesBRL)} + caixa ${brl(av.caixa)}`;
    const faixa = demo ? '<div class="inv-faixa inv-faixa-perigo" role="note"><strong>DEMONSTRAÇÃO — carteira FICTÍCIA.</strong> Operações e preços inventados para mostrar a tela. Nada aqui é seu, nada é gravado e nada se mistura com as suas carteiras reais.</div>'
      : sit === 'indisponivel' ? '<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Avaliação indisponível.</strong> Nenhum ativo desta carteira tem preço de fonte autorizada ou preço manual. Operações, aportes, proventos e lucro realizado continuam corretos; patrimônio e rentabilidade só aparecem com preço. ' + (podeEmpresa() ? 'Use “Preços manuais”.' : 'Peça ao Diretor ou ao Financeiro para informar preços manuais.') + ' Preços simulados nunca são usados em carteiras reais.</div>'
        : sit === 'parcial' ? `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Avaliação parcial:</strong> ${av.cobertura.ativos} de ${av.cobertura.de} ativos têm preço autorizado ou manual (${pct(av.cobertura.custoPct, false)} do custo). Resultado total, exposição ao dólar e taxa anual ficam indisponíveis até a avaliação ser completa.</div>` : '';
    host.innerHTML = cabecalho(tit, demo ? 'Demonstração com números fictícios' : `${c.tipo === 'pessoal' ? 'Carteira pessoal · só você vê (nem o Diretor nem o Super Admin)' : 'Carteira da empresa · Diretor e Financeiro veem'}${c.ativa ? '' : ' · ARQUIVADA (não aceita operações)'}`, acoesTopo) + `
      ${demo ? '' : `<div class="panel inv-ct-barra">
        <label class="inv-campo"><span>Carteira</span><select id="inv-ct-sel" class="inv-select">${W.carteiras.map((x) => `<option value="${E(x.id)}"${x.id === c.id ? ' selected' : ''}>${E(x.nome)} · ${x.tipo === 'pessoal' ? 'pessoal' : 'empresa'}${x.ativa ? '' : ' (arquivada)'}</option>`).join('')}</select></label>
        <div class="inv-acoes-topo"><button type="button" class="btn btn-small btn-ghost" id="inv-ct-exportar">Exportar (CSV)</button><button type="button" class="btn btn-small btn-ghost" id="inv-ct-copia">Exportar (cópia)</button><button type="button" class="btn btn-small btn-ghost" id="inv-ct-editar">Editar</button><button type="button" class="btn btn-primary" id="inv-ct-lancar"${c.ativa ? '' : ' disabled'}>+ Lançar operação</button></div>
      </div>`}
      ${faixa}
      ${base.inconsistencias.length ? `<div class="inv-faixa inv-faixa-perigo" role="alert"><strong>Carteira inconsistente — corrija com estorno.</strong> Enquanto houver estas operações, patrimônio e rentabilidade não são calculados (nada é "cortado" em silêncio):<ul class="inv-avisos-lista">${base.inconsistencias.slice(0, 8).map((a) => `<li>Operação nº ${E(a.id)} · ${E(dataBr(a.data))}${a.assetId ? ' · ' + E(a.assetId.split(':')[2]) : ''}: ${E(a.texto)}</li>`).join('')}</ul></div>` : ''}
      ${base.avisos.length ? `<div class="inv-faixa inv-faixa-aviso" role="note"><strong>Confira:</strong><ul class="inv-avisos-lista">${base.avisos.slice(0, 6).map((a) => `<li>${E(dataBr(a.data))}${a.assetId ? ' · ' + E(a.assetId.split(':')[2]) : ''}: ${E(a.texto)}</li>`).join('')}</ul></div>` : ''}
      <div class="inv-kpis">
        ${kpi('Patrimônio', patTxt, patExtra)}
        ${kpi('Aportado (líquido)', brl(av.aportado), `aportes ${brl(base.aportes + base.aportesImplicitos)} − retiradas ${brl(base.retiradas)}`)}
        ${kpi('Resultado total', brl(av.resultadoTotal), av.resultadoTotal == null ? 'precisa de avaliação completa' : av.aportado > 0 ? pct((av.resultadoTotal / av.aportado) * 100) + ' sobre o aportado' : '', cls(av.resultadoTotal))}
        ${kpi('Lucro realizado', brl(av.lucroRealizado), 'vendas já feitas (não depende de cotação)', cls(av.lucroRealizado))}
        ${kpi('Não realizado', brl(av.naoRealizado), av.naoRealizado == null ? (sit === 'parcial' ? 'parcial: ' + brl(av.naoRealizadoParcial) + ' nos ativos avaliados' : 'precisa de preço') : 'posições abertas a mercado', cls(av.naoRealizado))}
        ${kpi('Proventos recebidos', brl(av.proventos), `líquidos · IR retido ${brl(base.irRetido)}`)}
        ${kpi('Rentabilidade (TWR, aproximação)', ev.twr == null ? '—' : pct(ev.twr * 100), ev.twr == null ? E(ev.motivo || 'dados insuficientes') : E(ev.metodo), ev.twr == null ? '' : cls(ev.twr))}
        ${kpi('Taxa anual (XIRR)', xi.taxa == null ? '—' : pct(xi.taxa * 100), xi.taxa == null ? E(xi.motivo || 'dados insuficientes') : 'datas e valores de cada aporte + patrimônio de hoje', xi.taxa == null ? '' : cls(xi.taxa))}
        ${kpi('Exposição ao dólar', av.exposicaoCambial == null ? '—' : pct(av.exposicaoCambial, false), av.exposicaoCambial == null ? 'precisa de avaliação completa (inclusive câmbio)' : av.efeitoCambial ? 'efeito cambial ' + brl(av.efeitoCambial) : '')}
      </div>
      <div class="inv-grade">
        <div class="panel inv-largo"><div class="panel-title"><h2>Evolução do patrimônio</h2>${tagEstado(demo ? 'simulado' : ev.pontos.length ? (ev.estados[0] || 'manual') : 'indisponivel')}</div>
          ${ev.pontos.length > 1 ? `<div class="inv-graf-area inv-graf-media"><canvas id="inv-ct-evo" role="img" aria-label="Evolução mensal do patrimônio e do valor aportado"></canvas></div><p class="inv-muda">Fim de cada mês. A linha tracejada é o que entrou de dinheiro (aportado). Rentabilidade: ${E(ev.metodo)}.</p>` : estado('info', 'Evolução indisponível', ev.motivo || 'Aparece a partir do segundo mês.')}</div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Posições</h2><span>${av.itens.length} ativo(s)</span></div>
          ${demo ? '' : (() => { const f = {}; av.itens.filter((i) => i.preco != null).forEach((i) => { f[i.precoFonte || i.estado] = (f[i.precoFonte || i.estado] || 0) + 1; }); const ok = av.itens.filter((i) => i.preco != null).length; return `<p class="inv-muda">Cobertura da avaliação: ${ok} de ${av.itens.length} ativo(s) com preço${Object.keys(f).length ? ' · ' + Object.entries(f).map(([k, n]) => `${E(k)} (${n})`).join(' · ') : ''}. Preço manual é informado pela empresa; os demais vêm das fontes oficiais com a data de referência ao lado.</p>`; })()}
          ${av.itens.length ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Ativo</th><th class="cad-num">Quantidade</th><th class="cad-num">Preço médio</th><th class="cad-num">Preço</th><th class="cad-num">Valor (R$)</th><th class="cad-num">Resultado</th><th class="cad-num">Peso</th><th class="cad-num">Proventos</th></tr></thead><tbody>
            ${av.itens.map((i) => `<tr class="inv-linha" data-id="${E(i.assetId)}" tabindex="0"><td data-label="Ativo"><div class="inv-ativo"><div><strong>${E(i.ticker)}</strong><span>${E(i.nome || R(i.classe))}</span></div></div></td>
              <td data-label="Quantidade" class="cad-num">${E(qtdTxt(i.qtd))}</td><td data-label="Preço médio" class="cad-num">${E((i.moeda === 'USD' ? 'US$ ' : 'R$ ') + U().nf(i.precoMedio))}</td>
              <td data-label="Preço" class="cad-num">${i.preco == null ? '—' : E((i.moeda === 'USD' ? 'US$ ' : 'R$ ') + U().nf(i.preco))} ${tagEstado(i.estado)}${i.preco != null && i.precoData ? `<small class="inv-muda inv-bloco" title="${E(i.precoFonte || '')}">ref. ${E(String(i.precoData).split('-').reverse().join('/'))}</small>` : ''}${i.preco == null ? `<small class="inv-muda inv-bloco">${E(i.motivo)}</small>` : ''}</td><td data-label="Valor (R$)" class="cad-num">${brl(i.valorBRL)}</td>
              <td data-label="Resultado" class="cad-num"><span class="${cls(i.resultado)}">${brl(i.resultado)}</span>${i.resultadoPct == null ? '' : `<small class="inv-muda"> ${pct(i.resultadoPct)}</small>`}</td><td data-label="Peso" class="cad-num">${pct(i.peso, false)}</td><td data-label="Proventos" class="cad-num">${brl(i.proventos)}</td></tr>`).join('')}
          </tbody></table></div>${sit === 'parcial' ? '<p class="inv-muda">Peso: sobre os ativos avaliados.</p>' : ''}` : estado('info', 'Sem posições abertas', 'Lance uma compra para começar.')}</div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Distribuição</h2>${sit === 'parcial' ? '<span>só ativos avaliados</span>' : ''}</div><div class="inv-distr">
          ${distr('Por classe', CT.distribuir(av.itens, 'classe').map((x) => Object.assign(x, { rotulo: R(x.chave) })))}${distr('Por país', CT.distribuir(av.itens, 'pais', { BR: 'Brasil', US: 'Estados Unidos', CRYPTO: 'Cripto' }))}${distr('Por setor', CT.distribuir(av.itens, 'setor').slice(0, 8))}</div></div>
        <div class="panel"><div class="panel-title"><h2>Proventos</h2></div>
          <dl class="inv-cot-dl"><div><dt>Dividendos</dt><dd>${brl(base.proventosPorTipo.dividendo)}</dd></div><div><dt>JCP (líquido)</dt><dd>${brl(base.proventosPorTipo.jcp)}</dd></div><div><dt>Rendimentos</dt><dd>${brl(base.proventosPorTipo.rendimento)}</dd></div></dl>
          ${ult12.size ? '<div class="inv-graf-area inv-graf-baixa"><canvas id="inv-ct-prov" role="img" aria-label="Proventos por mês"></canvas></div>' : '<p class="inv-muda">Nenhum provento lançado. Os proventos não são buscados automaticamente: lance cada um quando receber.</p>'}</div>
        <div class="panel"><div class="panel-title"><h2>Sobre esta carteira</h2></div><ul class="inv-lista">
          <li><strong>Privacidade</strong><span>${demo ? 'Demonstração: só na tela, nada é gravado.' : c.tipo === 'pessoal' ? 'Só você lê e altera pelo sistema; o Diretor e o Super Admin não têm acesso (regras do banco). Quem administra o projeto no console do Firebase tem acesso técnico ao banco (ver relatório).' : 'Diretor e Financeiro da empresa leem e lançam.'}</span></li>
          <li><strong>Corretoras</strong><span>${E((c.corretoras || []).join(', ') || 'não informadas')}</span></li>
          <li><strong>Operações</strong><span>${ops.length} lançadas · ${base.estornadas} estornada(s) · ${base.inconsistencias.length} inconsistente(s) · limite de 5.000</span></li>
          <li><strong>Não integra</strong><span>Nada daqui vai para o Financeiro do ERP, e o sistema não envia ordens para corretoras.</span></li></ul></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Histórico de operações</h2><span>imutável · numeradas · correções por estorno</span></div>
          ${hist.length ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Nº</th><th>Data</th><th>Operação</th><th>Ativo</th><th class="cad-num">Qtd.</th><th class="cad-num">Preço / valor</th><th>Corretora</th><th></th></tr></thead><tbody>
            ${hist.slice(0, 300).map((o) => `<tr class="${estornadas.has(o.id) ? 'inv-estornada' : ''}${inconsistentes.has(o.id) ? ' inv-inconsistente' : ''}"><td data-label="Nº">${E(o.seq || o.id)}</td><td data-label="Data">${E(dataBr(o.data))}</td><td data-label="Operação">${E(tipoOp(o))}${o.tipo === 'estorno' ? ` <span class="inv-muda">da nº ${E(o.estorna)}</span>` : ''}${estornadas.has(o.id) ? ' <span class="badge badge-neutral">Estornada</span>' : ''}${inconsistentes.has(o.id) ? ' <span class="badge badge-danger">Inconsistente</span>' : ''}${o.nota ? `<br><small class="inv-muda">${E(o.nota)}</small>` : ''}</td>
              <td data-label="Ativo">${o.assetId ? E(o.assetId.split(':')[2]) : '—'}</td><td data-label="Qtd." class="cad-num">${o.qtd ? E(qtdTxt(o.qtd)) : o.fator ? '×' + E(o.fator) : '—'}</td>
              <td data-label="Preço / valor" class="cad-num">${o.preco != null ? E((o.moeda === 'USD' ? 'US$ ' : 'R$ ') + U().nf(o.preco)) : o.valor ? E((o.moeda === 'USD' ? 'US$ ' : 'R$ ') + U().nf(o.valor)) : '—'}${o.taxas ? `<br><small class="inv-muda">taxas ${E(U().nf(o.taxas))}</small>` : ''}</td>
              <td data-label="Corretora">${E(o.corretora || '—')}</td><td class="cad-acoes">${!demo && o.tipo !== 'estorno' && !estornadas.has(o.id) && c.ativa ? `<button type="button" class="btn btn-small btn-ghost" data-estornar="${E(o.id)}">Estornar</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>${hist.length > 300 ? '<p class="inv-muda">Mostrando as 300 mais recentes (o cálculo usa todas). Use “Exportar (CSV)” para ver todas.</p>' : ''}` : estado('info', 'Nenhuma operação', 'Use “Lançar operação”. Para registrar um histórico antigo, lance da operação mais antiga para a mais recente (o banco aceita só datas iguais ou posteriores à última).')}</div>
      </div>`;
    ligarTopo();
    if (!demo) {
      host.querySelector('#inv-ct-sel').addEventListener('change', (e) => { W.atual = e.target.value; C().salvarPref({ carteira: W.atual }); render(); });
      host.querySelector('#inv-ct-editar').onclick = () => editarCarteira(c);
      host.querySelector('#inv-ct-lancar').onclick = () => lancar(c);
      host.querySelector('#inv-ct-exportar').onclick = () => exportar(c, ops);
      host.querySelector('#inv-ct-copia').onclick = () => exportarJson(c, ops);
      host.querySelectorAll('[data-estornar]').forEach((b) => b.addEventListener('click', () => estornar(c, ops.find((o) => o.id === b.dataset.estornar))));
    }
    C().ligarLinhas(host);
    if (ev.pontos.length > 1) G.padrao(document.getElementById('inv-ct-evo'), 'line', (P, rgba) => ({ labels: ev.pontos.map((p) => p.data.slice(5, 7) + '/' + p.data.slice(2, 4)), datasets: [
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.destaque, P, true) : { borderColor: rgba(P.destaque) }, { label: 'Patrimônio', data: ev.pontos.map((p) => p.patrimonio / 100) }),
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.suave, P, false, true) : { borderColor: rgba(P.suave) }, { label: 'Aportado', data: ev.pontos.map((p) => p.aportado / 100) })] }),
      { dica: { label: (x) => `${x.dataset.label}: ${brl(Math.round(x.raw * 100))}` } });
    if (ult12.size) { const ks = [...ult12.keys()].sort().slice(-12); G.padrao(document.getElementById('inv-ct-prov'), 'bar', (P) => ({ labels: ks.map((k) => k.slice(5) + '/' + k.slice(2, 4)), datasets: [Object.assign(typeof mnBarras === 'function' ? mnBarras(P) : {}, { label: 'Proventos líquidos', data: ks.map((k) => ult12.get(k) / 100) })] }), { semLegenda: true, dica: { label: (x) => brl(Math.round(x.raw * 100)) } }); }
  };

  window.INVEST.carteiraUi = { LIMITE_RESUMO, grande: (c) => !W.ops[c.id] && (c.opsN || 0) > LIMITE_RESUMO && !(W.completo || {})[c.id], carregarCarteiras, carregarOps, resumo, precoEmFabrica, brl, pct, lancar, gravarOp, carteiraDemo };
})();
