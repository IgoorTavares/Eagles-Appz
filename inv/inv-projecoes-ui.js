/* =====================================================================
   Investimentos · Etapa 09 — Projeções e simuladores (interface nativa)
   - Ponto de partida: a carteira SÓ se a avaliação estiver completa (preço autorizado ou manual
     em todos os ativos); senão, o patrimônio inicial é informado pela pessoa.
   - Todas as taxas são PREMISSAS da pessoa (valores de exemplo marcados). Nenhum CDI, IPCA ou
     indicador simulado entra sozinho; se existir indicador de fonte autorizada, a pessoa pode
     escolher usá-lo (botão).
   - Nada aqui grava operação, altera carteira ou envia ordem. Os cenários salvos guardam só premissas
     em tenants/{t}/inv_cenarios/{uid} (1 documento por pessoa, até 20).
   ===================================================================== */
(function () {
  'use strict';
  const PJ = window.INVEST.projecoes, K = window.INVEST.mercado, CT = window.INVEST.carteira, G = window.INVEST.graficos;
  const T = (window.INVEST.telas = window.INVEST.telas || {});
  const C = () => window.INVEST.ctx; const CU = () => window.INVEST.carteiraUi; const W = () => window.INVEST.carteiraEstado;
  const brl = (v) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pctTxt = (f) => (f == null ? '—' : (f * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%');
  const num = (v) => { const n = Number(String(v).trim().replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
  const tempo = (m) => (m == null ? 'não atinge em 100 anos' : `${Math.floor(m / 12)} ano(s) e ${m % 12} mês(es)`);
  const CLASSE = { acao: 'Ações', fii: 'FIIs', etf: 'ETFs', bdr: 'BDRs', reit: 'REITs', tesouro: 'Tesouro Direto', renda_fixa: 'Renda fixa', cripto: 'Cripto', fundo: 'Fundos' };

  // valores de EXEMPLO (premissas, não indicadores): a pessoa ajusta
  const EXEMPLO = { patrimonioInicial: 50000, aporteMensal: 2000, reajusteAnualAporte: 0.04, meses: 180, valorizacaoAnual: 0.06, dyAnual: 0.04, reinvestir: true, inflacaoAnual: 0.045, taxaAdmAnual: 0.002, custoAporte: 0, aliquotaIRProventos: 0, aliquotaIRGanho: 0.15, aportesExtras: [] };
  const S9 = { p: null, origem: 'manual', carteira: null, cen: { pessimista: 0.03, moderado: 0.06, otimista: 0.09 }, metaPat: 1000000, metaReal: true, metaRenda: 10000, retirada: 0.04,
    estrB: { aporteMensal: 3000, valorizacaoAnual: 0.06, dyAnual: 0.04, meses: 180 }, classes: null, alvo: {}, aporteReb: 5000, soCompras: true, salvos: null, estadoSalvos: 'nao-lido' };

  // ---------- ponto de partida: carteiras com avaliação COMPLETA ----------
  async function opcoesCarteira() {
    const { S } = C();
    if (!(S.acesso.favoritos || S.acesso.carteiraPropria) || !CU()) return [];
    try { await CU().carregarCarteiras(); } catch (e) { return []; }
    const w = W(); if (w.estado !== 'ok') return [];
    const out = [];
    for (const c of w.carteiras) {
      let ops = w.ops[c.id];
      if (!ops && c.id === w.atual && !CU().grande(c)) { try { ops = await CU().carregarOps(c); } catch (e) { ops = null; } }
      if (!ops) { out.push({ c, ok: false, motivo: 'abra a carteira para avaliar' }); continue; }
      const { av } = CU().resumo(c, ops);
      out.push({ c, ok: av.completa && av.patrimonio != null, av, motivo: av.situacao === 'parcial' ? `avaliação parcial (${av.cobertura.ativos} de ${av.cobertura.de} ativos)` : av.situacao === 'indisponivel' ? 'sem preço autorizado ou manual' : av.situacao === 'inconsistente' ? 'carteira inconsistente' : '' });
    }
    return out;
  }

  // ---------- cenários salvos (só premissas) ----------
  async function carregarSalvos() {
    const { S, invDb, ehNuvem } = C();
    if (S9.estadoSalvos === 'ok' || !ehNuvem() || !(S.acesso.favoritos || S.acesso.carteiraPropria)) { if (!S9.salvos) S9.salvos = []; return; }
    try { const s = await invDb.ler(`tenants/${TENANT_ID}/inv_cenarios/${USUARIO_UID}`, 'abrir-cenarios'); S9.salvos = s.exists && Array.isArray(s.data().itens) ? s.data().itens.filter(PJ.cenarioValido) : []; S9.estadoSalvos = 'ok'; }
    catch (e) { S9.salvos = []; S9.estadoSalvos = 'erro'; }
  }
  async function gravarSalvos(lista) {
    await C().invDb.gravar(`tenants/${TENANT_ID}/inv_cenarios/${USUARIO_UID}`, { itens: lista, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, 'salvar-cenario');
    S9.salvos = lista;
  }

  // ---------- formulário ----------
  const CAMPOS = [
    ['patrimonioInicial', 'Patrimônio inicial (R$)', 'r', 'Se partir de uma carteira avaliada, este valor vem dela.'],
    ['aporteMensal', 'Aporte mensal (R$)', 'r'], ['reajusteAnualAporte', 'Reajuste do aporte a cada 12 meses (%)', '%'],
    ['anos', 'Prazo (anos)', 'n'], ['mesesExtra', 'e meses', 'n'],
    ['valorizacaoAnual', 'Valorização anual, sem proventos (% a.a.)', '%'], ['dyAnual', 'Proventos por ano (% a.a.)', '%'],
    ['inflacaoAnual', 'Inflação anual (% a.a.)', '%'], ['taxaAdmAnual', 'Custos anuais sobre o patrimônio (%)', '%'], ['custoAporte', 'Custo de entrada em cada aporte (%)', '%'],
    ['aliquotaIRProventos', 'IR sobre proventos (%)', '%', '0% para dividendos isentos; 15% para JCP, por exemplo.'], ['aliquotaIRGanho', 'IR estimado sobre o ganho no fim (%)', '%'],
  ];
  const valorCampo = (k, tipo) => { const p = S9.p; if (k === 'anos') return Math.floor(p.meses / 12); if (k === 'mesesExtra') return p.meses % 12; const v = p[k]; return tipo === '%' ? +(v * 100).toFixed(4) : v; };
  function formulario() {
    const { E } = C(); const p = S9.p;
    return `<div class="form-grid inv-pj-form">${CAMPOS.map(([k, rot, tipo, ajuda]) => `<div class="field${k === 'patrimonioInicial' ? ' full' : ''}"><label>${E(rot)}<input data-k="${k}" data-t="${tipo}" inputmode="decimal" value="${E(String(valorCampo(k, tipo)).replace('.', ','))}"${k === 'patrimonioInicial' && S9.origem === 'carteira' ? ' disabled' : ''}></label>${ajuda ? `<small class="inv-muda">${E(ajuda)}</small>` : ''}</div>`).join('')}
      <div class="field full"><label class="inv-check"><input type="checkbox" data-k="reinvestir"${p.reinvestir ? ' checked' : ''}> Reinvestir os proventos (desmarcado: viram renda e saem da carteira)</label></div>
      <div class="field full"><label>Aportes extraordinários (um por linha: <code>mês;valor</code> — valor negativo = retirada)<textarea data-k="aportesExtras" rows="3" maxlength="2000" placeholder="12;10000&#10;60;-5000">${E((p.aportesExtras || []).map((x) => `${x.mes};${String(x.valor).replace('.', ',')}`).join('\n'))}</textarea></label></div></div>`;
  }
  function lerCampo(el) {
    const k = el.dataset.k; const t = el.dataset.t; const p = S9.p;
    if (k === 'reinvestir') { p.reinvestir = el.checked; return true; }
    if (k === 'aportesExtras') {
      const out = []; for (const l of el.value.split('\n').map((x) => x.trim()).filter(Boolean)) { const [m, v] = l.split(';'); const mes = parseInt(m, 10), valor = num(v); if (!(mes >= 1) || !isFinite(valor)) return false; out.push({ mes, valor }); }
      p.aportesExtras = out.slice(0, 60); return true;
    }
    const v = num(el.value); if (!isFinite(v)) return false;
    if (k === 'anos') p.meses = Math.max(1, Math.min(1200, Math.round(v) * 12 + (p.meses % 12)));
    else if (k === 'mesesExtra') p.meses = Math.max(1, Math.min(1200, Math.floor(p.meses / 12) * 12 + Math.round(v)));
    else p[k] = t === '%' ? v / 100 : v;
    return true;
  }

  // ---------- resultados ----------
  const kpi = (rot, val, extra) => `<div class="inv-kpi"><span>${C().E(rot)}</span><strong>${val}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
  function resultados(host) {
    const { E, estado } = C(); const p = S9.p;
    const v = PJ.validar(p);
    if (!v.ok) { host.innerHTML = `<div class="panel">${estado('erro', 'Confira as premissas', v.erros.join('; '))}</div>`; return; }
    const r = PJ.projetar(p);
    const anos = []; for (let m = 12; m <= p.meses; m += 12) anos.push(r.serie[m]); if (p.meses % 12) anos.push(r.serie[p.meses]);
    const cen = PJ.cenarios(p, S9.cen);
    const mPat = PJ.mesesParaMeta(S9.metaPat, p, { real: S9.metaReal });
    const patRendaProv = PJ.patrimonioParaRenda(S9.metaRenda, p); const patRendaRet = PJ.patrimonioParaRenda(S9.metaRenda, p, { taxaRetiradaAnual: S9.retirada });
    const mRendaProv = patRendaProv != null ? PJ.mesesParaMeta(patRendaProv, p) : null; const mRendaRet = patRendaRet != null ? PJ.mesesParaMeta(patRendaRet, p) : null;
    const B = Object.assign({}, p, S9.estrB);
    const comp = PJ.compararEstrategias([{ nome: 'Estratégia A (premissas acima)', premissas: p }, { nome: 'Estratégia B', premissas: B }]);
    const classes = S9.classes || [];
    const pc = classes.length ? PJ.porClasse(classes, { meses: p.meses, inflacaoAnual: p.inflacaoAnual, taxaAdmAnual: p.taxaAdmAnual, aliquotaIRProventos: p.aliquotaIRProventos, reinvestir: p.reinvestir }) : null;
    const reb = classes.length ? PJ.rebalancear(classes.map((c) => ({ chave: c.chave, valor: c.valor })), S9.alvo, S9.aporteReb, { somenteCompras: S9.soCompras }) : null;
    host.innerHTML = `
      ${r.zerou ? '<div class="inv-faixa inv-faixa-perigo" role="alert">As retiradas zeram o patrimônio em algum mês da projeção.</div>' : ''}
      <div class="inv-kpis">
        ${kpi('Patrimônio no fim (nominal)', brl(r.nominal), `em ${tempo(p.meses)}`)}
        ${kpi('Em valores de hoje (real)', brl(r.real), `descontada a inflação de ${pctTxt(p.inflacaoAnual)} a.a.`)}
        ${kpi('Total aportado', brl(r.aportado), 'dinheiro que você colocou')}
        ${kpi('Ganho (nominal)', brl(r.ganho), `valorização ${brl(r.valorizacao)} + proventos reinvestidos − custos`)}
        ${kpi('Proventos no período', brl(r.proventos), p.reinvestir ? 'reinvestidos' : `viraram renda: ${brl(r.rendaRetirada)}`)}
        ${kpi('Custos e impostos', brl(r.custos + r.impostos), `custos ${brl(r.custos)} · IR ${brl(r.impostos)}`)}
        ${kpi('Líquido no fim', brl(r.liquido), `real: ${brl(r.liquidoReal)}`)}
        ${kpi('Renda mensal só com proventos', brl(r.rendaMensalProventos), 'no fim, sem consumir o patrimônio')}
      </div>
      <div class="inv-grade">
        <div class="panel inv-largo"><div class="panel-title"><h2>Evolução projetada</h2><span>nominal, real e aportado</span></div>
          <div class="inv-graf-area inv-graf-media"><canvas id="inv-pj-evo" role="img" aria-label="Evolução projetada do patrimônio"></canvas></div>
          <details class="inv-det"><summary>Tabela ano a ano</summary><div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Mês</th><th class="cad-num">Nominal</th><th class="cad-num">Real</th><th class="cad-num">Aportado</th></tr></thead><tbody>
            ${anos.map((x) => `<tr><td data-label="Mês">${x.mes} (${tempo(x.mes)})</td><td data-label="Nominal" class="cad-num">${brl(x.nominal)}</td><td data-label="Real" class="cad-num">${brl(x.real)}</td><td data-label="Aportado" class="cad-num">${brl(x.aportado)}</td></tr>`).join('')}</tbody></table></div></details></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Cenários</h2><span>a mesma premissa com três valorizações (suas)</span></div>
          <div class="inv-pj-linha">${['pessimista', 'moderado', 'otimista'].map((k) => `<label class="inv-campo"><span>${k[0].toUpperCase() + k.slice(1)} (% a.a.)</span><input data-cen="${k}" inputmode="decimal" value="${String(+(S9.cen[k] * 100).toFixed(4)).replace('.', ',')}"></label>`).join('')}</div>
          <div class="inv-graf-area inv-graf-baixa"><canvas id="inv-pj-cen" role="img" aria-label="Cenários pessimista, moderado e otimista"></canvas></div>
          <div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Cenário</th><th class="cad-num">Valorização</th><th class="cad-num">Nominal</th><th class="cad-num">Real</th></tr></thead><tbody>${cen.map((c) => `<tr><td data-label="Cenário">${E(c.cenario)}</td><td data-label="Valorização" class="cad-num">${pctTxt(c.valorizacaoAnual)}</td><td data-label="Nominal" class="cad-num">${brl(c.nominal)}</td><td data-label="Real" class="cad-num">${brl(c.real)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><div class="panel-title"><h2>Meta de patrimônio</h2></div>
          <div class="inv-pj-linha"><label class="inv-campo"><span>Meta (R$)</span><input data-meta="pat" inputmode="decimal" value="${String(S9.metaPat).replace('.', ',')}"></label><label class="inv-check"><input type="checkbox" data-meta="real"${S9.metaReal ? ' checked' : ''}> em valores de hoje</label></div>
          <p class="inv-pj-res">${mPat == null ? 'Com estas premissas, a meta <strong>não é atingida em 100 anos</strong>.' : `Atingida em <strong>${tempo(mPat)}</strong>.`}</p></div>
        <div class="panel"><div class="panel-title"><h2>Meta de renda passiva</h2></div>
          <div class="inv-pj-linha"><label class="inv-campo"><span>Renda mensal (R$)</span><input data-meta="renda" inputmode="decimal" value="${String(S9.metaRenda).replace('.', ',')}"></label><label class="inv-campo"><span>Retirada anual (%)</span><input data-meta="ret" inputmode="decimal" value="${String(+(S9.retirada * 100).toFixed(4)).replace('.', ',')}"></label></div>
          <p class="inv-pj-res">Vivendo só dos proventos (${pctTxt(p.dyAnual)} a.a., líquido de IR): ${patRendaProv == null ? 'sem proventos nas premissas.' : `patrimônio de <strong>${brl(patRendaProv)}</strong>, atingido em ${tempo(mRendaProv)}.`}</p>
          <p class="inv-pj-res">Retirando ${pctTxt(S9.retirada)} ao ano: patrimônio de <strong>${brl(patRendaRet)}</strong>, atingido em ${tempo(mRendaRet)}.</p>
          <p class="inv-muda">Valores nominais. A renda não considera inflação depois de atingida a meta.</p></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Comparação de estratégias</h2><span>mesmo prazo para as duas</span></div>
          <div class="inv-pj-linha">${[['aporteMensal', 'B: aporte mensal (R$)', 'r'], ['valorizacaoAnual', 'B: valorização (% a.a.)', '%'], ['dyAnual', 'B: proventos (% a.a.)', '%'], ['meses', 'B: prazo (meses)', 'n']].map(([k, rot, t]) => `<label class="inv-campo"><span>${E(rot)}</span><input data-b="${k}" data-t="${t}" inputmode="decimal" value="${String(t === '%' ? +(S9.estrB[k] * 100).toFixed(4) : S9.estrB[k]).replace('.', ',')}"></label>`).join('')}</div>
          <div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Estratégia</th><th class="cad-num">Aportado</th><th class="cad-num">Nominal</th><th class="cad-num">Real</th><th class="cad-num">Líquido</th></tr></thead><tbody>${comp.map((c) => `<tr><td data-label="Estratégia">${E(c.nome)}</td><td data-label="Aportado" class="cad-num">${brl(c.aportado)}</td><td data-label="Nominal" class="cad-num">${brl(c.nominal)}</td><td data-label="Real" class="cad-num">${brl(c.real)}</td><td data-label="Líquido" class="cad-num">${brl(c.liquido)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel inv-largo"><div class="panel-title"><h2>Projeção por classe e rebalanceamento simulado</h2><span>${S9.classesOrigem ? E(S9.classesOrigem) : 'valores informados por você'}</span></div>
          ${classes.length ? `<div class="table-scroll"><table class="inv-tabela"><thead><tr><th>Classe</th><th class="cad-num">Valor hoje (R$)</th><th class="cad-num">Valorização (% a.a.)</th><th class="cad-num">Proventos (% a.a.)</th><th class="cad-num">Projeção no fim</th><th class="cad-num">Alvo (%)</th><th class="cad-num">Ordem simulada</th></tr></thead><tbody>
            ${classes.map((c, i) => { const l = pc.linhas[i]; const o = reb && reb.ok ? reb.ordens.find((x) => x.chave === c.chave) : null; return `<tr><td data-label="Classe">${E(c.rotulo)}</td>
              <td data-label="Valor hoje" class="cad-num"><input class="inv-pj-cel" data-cl="${i}" data-campo="valor" inputmode="decimal" value="${String(c.valor).replace('.', ',')}" aria-label="Valor de ${E(c.rotulo)}"${S9.classesOrigem ? ' disabled' : ''}></td>
              <td data-label="Valorização" class="cad-num"><input class="inv-pj-cel" data-cl="${i}" data-campo="valorizacaoAnual" inputmode="decimal" value="${String(+(c.valorizacaoAnual * 100).toFixed(4)).replace('.', ',')}" aria-label="Valorização de ${E(c.rotulo)}"></td>
              <td data-label="Proventos" class="cad-num"><input class="inv-pj-cel" data-cl="${i}" data-campo="dyAnual" inputmode="decimal" value="${String(+((c.dyAnual || 0) * 100).toFixed(4)).replace('.', ',')}" aria-label="Proventos de ${E(c.rotulo)}"></td>
              <td data-label="Projeção" class="cad-num">${brl(l.nominal)}</td>
              <td data-label="Alvo (%)" class="cad-num"><input class="inv-pj-cel" data-alvo="${E(c.chave)}" inputmode="decimal" value="${String(S9.alvo[c.chave] ?? '').replace('.', ',')}" aria-label="Alvo de ${E(c.rotulo)}"></td>
              <td data-label="Ordem simulada" class="cad-num">${o ? `<span class="${o.ordem > 0 ? 'inv-sobe' : o.ordem < 0 ? 'inv-desce' : ''}">${o.ordem > 0 ? 'comprar ' : o.ordem < 0 ? 'vender ' : ''}${brl(Math.abs(o.ordem))}</span>` : '—'}</td></tr>`; }).join('')}
            <tr><td data-label="Total"><strong>Total</strong></td><td class="cad-num" data-label="Valor hoje">${brl(classes.reduce((s, c) => s + (+c.valor || 0), 0))}</td><td></td><td></td><td class="cad-num" data-label="Projeção"><strong>${brl(pc.total.nominal)}</strong></td><td class="cad-num" data-label="Alvo">${(Object.values(S9.alvo).reduce((s, x) => s + (+x || 0), 0)).toLocaleString('pt-BR')}%</td><td></td></tr>
          </tbody></table></div>
          <div class="inv-pj-linha"><label class="inv-campo"><span>Aporte para rebalancear (R$)</span><input data-reb="aporte" inputmode="decimal" value="${String(S9.aporteReb).replace('.', ',')}"></label><label class="inv-check"><input type="checkbox" data-reb="so"${S9.soCompras ? ' checked' : ''}> Só comprar (sem vender)</label>${S9.classesOrigem ? '' : '<button type="button" class="btn btn-small btn-ghost" id="inv-pj-addcl">+ Classe</button>'}</div>
          <p class="inv-muda">${reb && !reb.ok ? E(reb.erro) : 'Ordens simuladas: nada é lançado na carteira e nenhuma ordem vai para corretora.'} Projeção por classe usa o mesmo prazo, inflação, custos e IR das premissas.</p>`
          : `${estado('info', 'Informe as classes', 'Comece pelos valores de cada classe (ou parta de uma carteira com avaliação completa).', '<button type="button" class="btn" id="inv-pj-addcl">+ Classe</button>')}`}</div>
      </div>`;
    // gráficos
    const meses = r.serie.map((s) => s.mes); const passo = Math.max(1, Math.ceil(meses.length / 120)); const idx = meses.filter((m, i) => i % passo === 0 || i === meses.length - 1);
    const rot = idx.map((m) => (m % 12 === 0 ? `${m / 12}a` : `${m}m`));
    G.padrao(document.getElementById('inv-pj-evo'), 'line', (P, rgba) => ({ labels: rot, datasets: [
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.destaque, P, true) : {}, { label: 'Nominal', data: idx.map((m) => r.serie[m].nominal) }),
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.texto, P, false) : {}, { label: 'Real (valores de hoje)', data: idx.map((m) => r.serie[m].real) }),
      Object.assign(typeof mnLinha === 'function' ? mnLinha(P.suave, P, false, true) : {}, { label: 'Aportado', data: idx.map((m) => r.serie[m].aportado) })] }), { dica: { label: (x) => `${x.dataset.label}: ${brl(x.raw)}` } });
    G.padrao(document.getElementById('inv-pj-cen'), 'line', (P) => ({ labels: rot, datasets: cen.map((c, i) => Object.assign(typeof mnLinha === 'function' ? mnLinha([P.erro, P.destaque, P.ok][i], P, i === 1, i !== 1) : {}, { label: c.cenario, fill: false, data: idx.map((m) => c.serie[m].nominal) })) }), { dica: { label: (x) => `${x.dataset.label}: ${brl(x.raw)}` } });
    // eventos dos resultados
    const reCalc = () => { clearTimeout(S9._t); S9._t = setTimeout(() => resultados(host), 250); };
    host.querySelectorAll('[data-cen]').forEach((el) => el.addEventListener('change', () => { const v = num(el.value); if (isFinite(v)) { S9.cen[el.dataset.cen] = v / 100; reCalc(); } }));
    host.querySelectorAll('[data-meta]').forEach((el) => el.addEventListener('change', () => { const k = el.dataset.meta; if (k === 'real') S9.metaReal = el.checked; else { const v = num(el.value); if (!isFinite(v)) return; if (k === 'pat') S9.metaPat = v; if (k === 'renda') S9.metaRenda = v; if (k === 'ret') S9.retirada = v / 100; } reCalc(); }));
    host.querySelectorAll('[data-b]').forEach((el) => el.addEventListener('change', () => { const v = num(el.value); if (!isFinite(v)) return; S9.estrB[el.dataset.b] = el.dataset.t === '%' ? v / 100 : el.dataset.b === 'meses' ? Math.max(1, Math.min(1200, Math.round(v))) : v; reCalc(); }));
    host.querySelectorAll('[data-cl]').forEach((el) => el.addEventListener('change', () => { const v = num(el.value); if (!isFinite(v)) return; const c = S9.classes[+el.dataset.cl]; c[el.dataset.campo] = el.dataset.campo === 'valor' ? v : v / 100; reCalc(); }));
    host.querySelectorAll('[data-alvo]').forEach((el) => el.addEventListener('change', () => { const v = num(el.value); S9.alvo[el.dataset.alvo] = isFinite(v) ? v : 0; reCalc(); }));
    host.querySelectorAll('[data-reb]').forEach((el) => el.addEventListener('change', () => { if (el.dataset.reb === 'so') S9.soCompras = el.checked; else { const v = num(el.value); if (isFinite(v) && v >= 0) S9.aporteReb = v; } reCalc(); }));
    const add = host.querySelector('#inv-pj-addcl'); if (add) add.onclick = () => { const nome = (prompt('Nome da classe (ex.: Renda fixa):') || '').trim().slice(0, 40); if (!nome) return; S9.classes = (S9.classes || []).concat([{ chave: 'c' + Date.now().toString(36), rotulo: nome, valor: 0, valorizacaoAnual: 0.06, dyAnual: 0 }]); resultados(host); };
  }

  // ---------- tela ----------
  T.projecoes = async function (host) {
    const { S, E, estado, cabecalho } = C();
    if (!S9.p) S9.p = JSON.parse(JSON.stringify(EXEMPLO));
    host.innerHTML = cabecalho('Projeções', 'Simulador matemático com as suas premissas') + `<div class="panel">${estado('carregando', 'Preparando…')}</div>`;
    const [opcoes] = await Promise.all([opcoesCarteira(), carregarSalvos()]);
    if (C().rota().aba !== 'projecoes') return;
    const validas = opcoes.filter((o) => o.ok);
    if (S9.origem === 'carteira' && !validas.some((o) => o.c.id === S9.carteira)) S9.origem = 'manual';
    if (S9.origem === 'carteira') {
      const o = validas.find((x) => x.c.id === S9.carteira); S9.p.patrimonioInicial = Math.round(o.av.patrimonio) / 100;
      S9.classes = CT.distribuir(o.av.itens, 'classe').map((d) => ({ chave: d.chave, rotulo: CLASSE[d.chave] || d.chave, valor: Math.round(d.valor) / 100, valorizacaoAnual: (S9.classes || []).find((x) => x.chave === d.chave)?.valorizacaoAnual ?? 0.06, dyAnual: (S9.classes || []).find((x) => x.chave === d.chave)?.dyAnual ?? 0 }));
      S9.classesOrigem = `da carteira “${o.c.nome}” (avaliação completa)`;
    } else if (S9.classesOrigem) { S9.classesOrigem = null; S9.classes = null; }
    const indReais = K.MACRO.BR.filter((x) => ['CDI', 'IPCA12M'].includes(x.ticker)).map((x) => ({ x, q: S.motorReal.cotacao(x) })).filter((y) => y.q && y.q.real);
    host.innerHTML = cabecalho('Projeções', 'Simulador matemático (sem IA) com as suas premissas · não altera a carteira', '<div class="inv-acoes-topo"><button type="button" class="btn btn-small btn-ghost" id="inv-pj-reset">Restaurar exemplo</button>' + ((S.acesso.favoritos || S.acesso.carteiraPropria) ? '<button type="button" class="btn btn-small" id="inv-pj-salvar">Salvar cenário</button>' : '') + '</div>') + `
      <div class="inv-faixa inv-faixa-aviso" role="note"><strong>Projeção não é promessa de rentabilidade.</strong> Os números saem das premissas abaixo, informadas por você (os valores iniciais são <strong>exemplos</strong>). Impostos e custos são estimativas simplificadas: confira as regras vigentes. ${indReais.length ? '' : 'Nenhum CDI ou IPCA de fonte autorizada está ligado; por isso nenhuma taxa é preenchida automaticamente.'}</div>
      <div class="inv-grade inv-pj">
        <div class="panel"><div class="panel-title"><h2>Ponto de partida</h2></div>
          <label class="inv-check"><input type="radio" name="inv-pj-origem" value="manual"${S9.origem === 'manual' ? ' checked' : ''}> Patrimônio informado por mim</label>
          ${opcoes.map((o) => `<label class="inv-check${o.ok ? '' : ' inv-off'}"><input type="radio" name="inv-pj-origem" value="${E(o.c.id)}"${S9.origem === 'carteira' && S9.carteira === o.c.id ? ' checked' : ''}${o.ok ? '' : ' disabled'}> Carteira “${E(o.c.nome)}”${o.ok ? ` — ${E(CU().brl(o.av.patrimonio))}` : ` — indisponível: ${E(o.motivo)}`}</label>`).join('')}
          ${!(S.acesso.favoritos || S.acesso.carteiraPropria) ? '<p class="inv-muda">Sem carteiras para este acesso.</p>' : ''}
          ${indReais.length ? `<p>${indReais.map((y) => `<button type="button" class="btn btn-small btn-ghost" data-usar="${E(y.x.ticker)}">Usar ${E(y.x.nome)}: ${E(String(y.q.preco))}% (${E(y.q.fonteNome)})</button>`).join(' ')}</p>` : ''}
          <h2 class="inv-sub">Premissas</h2>${formulario()}
          ${(S.acesso.favoritos || S.acesso.carteiraPropria) ? `<h2 class="inv-sub">Cenários salvos <small class="inv-muda">${(S9.salvos || []).length} de ${PJ.CENARIO_MAX} · só você vê</small></h2>
            ${(S9.salvos || []).length ? `<ul class="inv-macro">${S9.salvos.map((c, i) => `<li><span>${E(c.nome)}</span><button type="button" class="btn btn-small btn-ghost" data-carregar="${i}">Abrir</button><button type="button" class="btn btn-small btn-ghost inv-perigo" data-apagar="${i}" aria-label="Excluir o cenário ${E(c.nome)}">Excluir</button></li>`).join('')}</ul>` : '<p class="inv-muda">Nenhum cenário salvo.</p>'}` : ''}
        </div>
        <div id="inv-pj-res"></div>
      </div>`;
    const res = host.querySelector('#inv-pj-res');
    const recalc = () => { clearTimeout(S9._t); S9._t = setTimeout(() => resultados(res), 200); };
    host.querySelectorAll('[data-k]').forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => { el.classList.toggle('inv-invalido', !lerCampo(el)); recalc(); }));
    host.querySelectorAll('[name="inv-pj-origem"]').forEach((el) => el.addEventListener('change', () => { if (el.value === 'manual') { S9.origem = 'manual'; } else { S9.origem = 'carteira'; S9.carteira = el.value; } T.projecoes(host); }));
    host.querySelector('#inv-pj-reset').onclick = () => { S9.p = JSON.parse(JSON.stringify(EXEMPLO)); S9.origem = 'manual'; S9.classes = null; S9.classesOrigem = null; S9.alvo = {}; T.projecoes(host); };
    host.querySelectorAll('[data-usar]').forEach((b) => b.addEventListener('click', () => { const y = indReais.find((z) => z.x.ticker === b.dataset.usar); if (b.dataset.usar === 'CDI') S9.p.valorizacaoAnual = y.q.preco / 100; else S9.p.inflacaoAnual = y.q.preco / 100; T.projecoes(host); }));
    const sv = host.querySelector('#inv-pj-salvar');
    if (sv) sv.onclick = async () => {
      const nome = (prompt('Nome do cenário:', 'Meu cenário') || '').trim().slice(0, 60); if (!nome) return;
      const c = { id: 'p' + Date.now().toString(36), nome, premissas: Object.assign({}, S9.p, { patrimonioInicial: S9.p.patrimonioInicial }) };
      if (!PJ.cenarioValido(c)) { C().avisarSimples('Confira as premissas antes de salvar.'); return; }
      if ((S9.salvos || []).length >= PJ.CENARIO_MAX) { C().avisarSimples('Limite de 20 cenários. Exclua um para salvar outro.'); return; }
      try { await gravarSalvos((S9.salvos || []).concat([c])); C().toastInv('Cenário salvo.'); T.projecoes(host); } catch (e) { C().avisarSimples(e.code === 'contencao' ? 'Limite de uso do dia atingido.' : 'Não foi possível salvar agora.'); }
    };
    host.querySelectorAll('[data-carregar]').forEach((b) => b.addEventListener('click', () => { S9.p = JSON.parse(JSON.stringify(S9.salvos[+b.dataset.carregar].premissas)); S9.origem = 'manual'; T.projecoes(host); C().toastInv('Cenário aberto.'); }));
    host.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async () => { try { await gravarSalvos(S9.salvos.filter((_, i) => i !== +b.dataset.apagar)); C().toastInv('Cenário excluído.'); T.projecoes(host); } catch (e) { C().avisarSimples('Não foi possível excluir agora.'); } }));
    resultados(res);
  };
  window.INVEST.projecoesUi = { estado: S9, EXEMPLO };
})();
