/* =====================================================================
   Investimentos · Etapa 07 — Minha Carteira: CÁLCULOS PUROS
   (sem tela, sem banco, sem rede; roda no navegador e no Node).
   Convenções (Etapa 03, herdadas do protótipo aprovado):
   - dinheiro em CENTAVOS inteiros; quantidade e preço unitário em E8 (inteiros);
   - BigInt nas multiplicações que podem passar de 2^53; arredondamento meio-par;
   - moeda-base da carteira: BRL. Ativo em USD guarda o custo em USD e em BRL (pelo câmbio de cada operação).
   Regras de negócio:
   - operação é IMUTÁVEL: corrigir = ESTORNAR (nova operação que anula a anterior) e lançar de novo;
   - APORTE e RETIRADA são dinheiro entrando/saindo da carteira; NÃO são rentabilidade;
   - compra sem caixa suficiente gera "aporte implícito" (o dinheiro veio de fora), para não inflar o resultado;
   - provento (dividendo, JCP, rendimento) entra UMA vez, no caixa, líquido do IR retido;
   - preço médio pela regra brasileira (custo de aquisição com taxas; venda não altera o preço médio).
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.carteira = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const E8 = 100000000n;
  function divArred(a, b) { const neg = (a < 0n) !== (b < 0n); const A = a < 0n ? -a : a, B = b < 0n ? -b : b; let q = A / B; const r = A % B; const d = r * 2n; if (d > B || (d === B && q % 2n === 1n)) q += 1n; return neg ? -q : q; }
  const valorCentavos = (qtdE8, precoE8) => Number(divArred(BigInt(qtdE8) * BigInt(precoE8) * 100n, E8 * E8));
  // preço em texto decimal (até 12 casas) × quantidade E8 → centavos, meio-par, sem ponto flutuante (v160, cotas de fundos)
  function valorCentavosTxt(qtdE8, txt) { const [i, d = ''] = String(txt).split('.'); const p12 = BigInt(i) * 10n ** 12n + BigInt(d.padEnd(12, '0')); return Number(divArred(BigInt(qtdE8) * p12 * 100n, E8 * 10n ** 12n)); }
  // conversão EXATA de número decimal para inteiro (sem o erro de 0,1 × 1e8): passa pelo texto com as casas fixas.
  // Limites (validação + regras): quantidade e preço até 10 milhões, valor até 10 bilhões → tudo cabe em 2^53.
  // Lê o número como o DECIMAL que a pessoa digitou (15 algarismos significativos) e arredonda meio-par na casa pedida:
  // 2,675 vira 268 centavos (e não 267, que é o que o binário daria); 1,005 vira 100 (meio-par: empate vai para o par).
  function inteiro(n, casas) {
    n = Number(n); if (!isFinite(n)) return NaN;
    const neg = n < 0; let t = Math.abs(n).toPrecision(15);
    if (/e/.test(t)) t = Math.abs(n).toFixed(20).replace(/0+$/, '');
    let [a, b = ''] = t.split('.'); b = b.padEnd(casas + 1, '0');
    let v = BigInt(a + b.slice(0, casas)); const resto = b.slice(casas);
    const meio = '5'.padEnd(resto.length, '0');
    if (resto > meio || (resto === meio && v % 2n === 1n)) v += 1n;
    return neg ? -Number(v) : Number(v);
  }
  const paraE8 = (n) => inteiro(n, 8);
  const paraCent = (n) => inteiro(n, 2);
  const LIM = { qtd: 1e7, preco: 1e7, valor: 1e10 };
  const r2 = (n) => Math.round(n * 100) / 100;

  // ---------- tipos de operação ----------
  const TIPOS = {
    compra: { nome: 'Compra', ativo: true, qtd: true, preco: true },
    venda: { nome: 'Venda', ativo: true, qtd: true, preco: true },
    aporte: { nome: 'Aporte (dinheiro que entrou)', valor: true },
    retirada: { nome: 'Retirada (dinheiro que saiu)', valor: true },
    dividendo: { nome: 'Dividendo', ativo: true, valor: true, provento: true },
    jcp: { nome: 'Juros sobre capital próprio (JCP)', ativo: true, valor: true, provento: true },
    rendimento: { nome: 'Rendimento (FII e outros)', ativo: true, valor: true, provento: true },
    taxa: { nome: 'Taxa ou custódia', valor: true },
    desdobramento: { nome: 'Desdobramento', ativo: true, fator: true },
    grupamento: { nome: 'Grupamento', ativo: true, fator: true },
    bonificacao: { nome: 'Bonificação', ativo: true, qtd: true, valorOpcional: true },
    amortizacao: { nome: 'Amortização', ativo: true, valor: true },
    estorno: { nome: 'Estorno (correção)', estorna: true },
  };
  const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
  const RX_ASSET = /^[A-Z]+:[A-Z0-9-]+:[A-Z0-9.\-]+$/;

  // data de CALENDÁRIO (mês e dia que existem; 29/02 só em ano bissexto) — a mesma conferência das regras do banco
  function dataValida(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false;
    const a = +m[1], mes = +m[2], d = +m[3];
    if (a < 1900 || mes < 1 || mes > 12 || d < 1) return false;
    const dias = mes === 2 ? ((a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0)) ? 29 : 28) : [4, 6, 9, 11].includes(mes) ? 30 : 31;
    return d <= dias;
  }

  // valida os CAMPOS de uma operação ANTES de gravar (a mesma conferência é refeita nas regras do Firebase)
  function validarOperacao(o, hoje) {
    const e = []; const t = TIPOS[o && o.tipo];
    if (!t) return { ok: false, erros: ['tipo de operação inválido'] };
    if (!dataValida(o.data)) e.push('data inválida (confira dia e mês)');
    else if (hoje && o.data > hoje) e.push('data no futuro');
    else if (o.data < '1990-01-01') e.push('data muito antiga');
    if (t.ativo && !RX_ASSET.test(o.assetId || '')) e.push('ativo inválido');
    if (t.qtd && !(o.qtd > 0 && o.qtd <= LIM.qtd)) e.push('quantidade deve ser maior que zero e até 10 milhões');
    if (t.preco && !(o.preco >= 0 && o.preco <= LIM.preco)) e.push('preço inválido (até 10 milhões)');
    if (t.valor && !(o.valor > 0 && o.valor <= LIM.valor)) e.push('valor deve ser maior que zero (até 10 bilhões)');
    if (t.valorOpcional && o.valor != null && !(o.valor >= 0 && o.valor <= LIM.valor)) e.push('valor inválido');
    if (t.fator && !(o.fator > 1 && o.fator <= 1000)) e.push('fator deve ser maior que 1 (até 1.000)');
    if (t.estorna && !(typeof o.estorna === 'string' && o.estorna.length > 0 && o.estorna.length <= 40)) e.push('operação a estornar não informada');
    if (o.taxas != null && !(o.taxas >= 0 && o.taxas <= LIM.preco)) e.push('taxas inválidas');
    if (o.irRetido != null && !(o.irRetido >= 0 && (!o.valor || o.irRetido <= o.valor))) e.push('IR retido inválido');
    if (o.moeda === 'USD' && o.tipo !== 'estorno' && !(o.cambio > 0 && o.cambio < 100)) e.push('informe o câmbio (R$ por US$) da data da operação');
    if (o.moeda && !['BRL', 'USD'].includes(o.moeda)) e.push('moeda inválida');
    if (o.corretora != null && String(o.corretora).length > 40) e.push('corretora: até 40 letras');
    if (o.nota != null && String(o.nota).length > 200) e.push('observação: até 200 letras');
    return { ok: !e.length, erros: e };
  }

  /* ---------- EFEITO de uma operação no SALDO da carteira (Etapa 10) ----------
     saldo = { caixa: centavos (BRL), pos: { assetId: quantidade em 1e-8 } }, guardado no documento da carteira.
     Cada operação grava o próprio efeito: dq (quantidade), dc (caixa) e ai (aporte implícito). As regras do banco conferem
     que o saldo novo é exatamente o anterior + efeito e que nada fica negativo. Lançamentos em ORDEM DE DATA; corrigir =
     ESTORNO, que é o efeito contrário (lançado na data em que é feito). */
  const REVERSIVEIS = ['compra', 'venda', 'aporte', 'retirada', 'dividendo', 'jcp', 'rendimento', 'taxa', 'amortizacao', 'bonificacao'];
  const cambioE4 = (o) => (o.moeda === 'USD' ? inteiro(o.cambio, 4) : 10000);
  const emBRLop = (cent, o) => (o.moeda === 'USD' ? Number(divArred(BigInt(cent) * BigInt(cambioE4(o)), 10000n)) : cent);
  function efeito(o, saldo, carteira, alvo) {
    const t = o.tipo; const pos = (id) => (saldo.pos && saldo.pos[id]) || 0;
    if (t === 'estorno') {
      if (!alvo) return { erro: 'operação a estornar não encontrada' };
      if (!REVERSIVEIS.includes(alvo.tipo)) return { erro: `${TIPOS[alvo.tipo] ? TIPOS[alvo.tipo].nome : alvo.tipo} não pode ser estornado (lance o evento contrário, ex.: grupamento para desfazer desdobramento)` };
      const e = { dc: -alvo.dc, ai: 0 }; if (alvo.dq != null) { e.dq = -alvo.dq; e.alvoAsset = alvo.assetId; }
      return e;
    }
    const taxas = paraCent(o.taxas || 0);
    if (t === 'compra') { const q = paraE8(o.qtd); const total = valorCentavos(q, paraE8(o.preco)) + taxas; return { dq: q, dc: -emBRLop(total, o), qtdE8: q, totalMoeda: total }; }
    if (t === 'venda') { const q = paraE8(o.qtd); const liq = valorCentavos(q, paraE8(o.preco)) - taxas; return { dq: -q, dc: emBRLop(liq, o), qtdE8: q, totalMoeda: liq }; }
    if (t === 'aporte') return { dc: paraCent(o.valor) };
    if (t === 'retirada') return { dc: -paraCent(o.valor) };
    if (t === 'taxa') return { dc: -paraCent(o.valor) };
    if (t === 'dividendo' || t === 'jcp' || t === 'rendimento') return { dc: emBRLop(paraCent(o.valor) - paraCent(o.irRetido || 0), o) };
    if (t === 'amortizacao') return { dc: emBRLop(paraCent(o.valor), o) };
    if (t === 'bonificacao') { const q = paraE8(o.qtd); return { dq: q, dc: 0, qtdE8: q }; }
    if (t === 'desdobramento') { const p = pos(o.assetId); return { dq: Math.round(p * o.fator) - p, dc: 0 }; }
    if (t === 'grupamento') { const p = pos(o.assetId); return { dq: Math.round(p / o.fator) - p, dc: 0 }; }
    return { erro: 'tipo desconhecido' };
  }
  // aplica o efeito ao saldo (mesma conta das regras); devolve o saldo novo ou o motivo da recusa
  function aplicar(saldo, o, carteira) {
    const caixaAntes = saldo.caixa || 0; let ai = o.ai || 0;
    const aposDc = caixaAntes + o.dc;
    if (o.ai == null) ai = 0;
    const id = o.tipo === 'estorno' ? o.alvoAsset : o.assetId;
    const novo = { caixa: aposDc + ai, pos: Object.assign({}, saldo.pos || {}) };
    if (o.dq != null) { novo.pos[id] = (novo.pos[id] || 0) + o.dq; if (novo.pos[id] < 0) return { erro: o.tipo === 'venda' ? 'venda maior que a quantidade em carteira' : o.tipo === 'estorno' ? 'o estorno deixaria a quantidade do ativo negativa (estorne antes as vendas posteriores)' : 'quantidade negativa' }; }
    if (novo.caixa < 0) return { erro: o.tipo === 'retirada' ? 'retirada maior que o caixa disponível' : o.tipo === 'estorno' ? 'o estorno deixaria o caixa negativo (o dinheiro já foi usado)' : 'caixa insuficiente' };
    return { saldo: novo };
  }
  // prepara uma operação NOVA para gravar: confere campos, ordem de data e saldo; calcula o efeito exato
  function prepararOperacao(carteira, o, op = {}) {
    const v = validarOperacao(o, op.hoje); if (!v.ok) return { ok: false, erros: v.erros };
    const ult = carteira.ultimaData || '1900-01-01';
    if (o.data < ult) return { ok: false, erros: [`as operações são lançadas em ordem de data: a última é de ${ult.split('-').reverse().join('/')}. Lance com essa data ou posterior (veja a ajuda sobre lançamentos antigos)`] };
    const saldo = carteira.saldo || { caixa: 0, pos: {} };
    const e = efeito(o, saldo, carteira, op.alvo);
    if (e.erro) return { ok: false, erros: [e.erro] };
    let ai = 0;
    if ((o.tipo === 'compra' || o.tipo === 'taxa') && (saldo.caixa || 0) + e.dc < 0) {
      if (carteira.caixaAutomatico !== false) ai = -((saldo.caixa || 0) + e.dc);
      else return { ok: false, erros: ['caixa insuficiente (o modo "compra sem caixa vira aporte" está desligado nesta carteira)'] };
    }
    const comEfeito = Object.assign({}, e, { tipo: o.tipo, ai, assetId: o.assetId });
    const a = aplicar(saldo, comEfeito, carteira);
    if (a.erro) return { ok: false, erros: [a.erro] };
    const gravar = Object.assign(paraGravar(o), { dc: e.dc, ai });
    if (e.dq != null) gravar.dq = e.dq;
    if (e.qtdE8 != null) gravar.qtdE8 = e.qtdE8;
    if (e.alvoAsset) gravar.alvoAsset = e.alvoAsset;
    return { ok: true, gravar, saldo: a.saldo, ultimaData: o.data };
  }

  // ---------- livro-razão → posições (dobra em ORDEM DE NÚMERO, que é a ordem de data) ----------
  // Usa o efeito gravado em cada operação (dq/dc/ai) para o saldo, e recalcula custo, preço médio e lucro.
  function calcular(ops, op = {}) {
    const ate = op.ate || '9999-12-31';
    const pos = {}; const avisos = []; const inconsistencias = [];
    const erro = (o, texto) => inconsistencias.push({ id: o.id, data: o.data, assetId: o.assetId || o.alvoAsset, tipo: o.tipo, texto });
    const todas = ops.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const t = { caixa: 0, aportes: 0, aportesImplicitos: 0, retiradas: 0, proventos: 0, proventosPorTipo: { dividendo: 0, jcp: 0, rendimento: 0 }, irRetido: 0, lucroRealizado: 0, taxas: 0, fluxos: [] };
    const p = (id, moeda, data) => (pos[id] = pos[id] || { assetId: id, moeda: moeda || 'BRL', qtdE8: 0, custo: 0, custoBRL: 0, lucroRealizado: 0, proventos: 0, primeira: data });
    const porId = new Map(); const memo = new Map(); const estornadas = new Set(); const vistos = new Set();
    let ultima = '1900-01-01'; let saldo = { caixa: 0, pos: {} }; let validas = 0;
    for (const o of todas) {
      if (o.data > ate) break;
      if (o.data < ultima) { erro(o, 'operação fora da ordem de data'); }
      ultima = o.data > ultima ? o.data : ultima;
      porId.set(o.id, o);
      if (o.dc == null) { erro(o, 'operação sem o efeito registrado (gravada por uma versão antiga)'); continue; }
      // confere o efeito gravado com a conta exata (detecta gravação direta com números que não fecham)
      const alvo = o.tipo === 'estorno' ? porId.get(o.estorna) : null;
      if (o.tipo === 'estorno') {
        if (!alvo) { erro(o, 'estorno de uma operação que não existe'); continue; }
        if (alvo.tipo === 'estorno') { erro(o, 'estorno de outro estorno'); continue; }
        if (estornadas.has(o.estorna)) { erro(o, 'estorno repetido da mesma operação'); continue; }
      }
      const esperado = efeito(o, saldo, null, alvo);
      if (esperado.erro) { erro(o, esperado.erro); continue; }
      if (esperado.dc !== o.dc || (esperado.dq != null ? esperado.dq !== o.dq : o.dq != null)) { erro(o, 'os valores gravados da operação não conferem com a conta'); continue; }
      const a = aplicar(saldo, o, null); if (a.erro) { erro(o, a.erro); continue; }
      saldo = a.saldo; validas++;
      t.caixa = saldo.caixa;
      if (o.ai > 0) { t.aportesImplicitos += o.ai; t.fluxos.push({ data: o.data, valor: o.ai, implicito: true }); }
      switch (o.tipo) {
        case 'aporte': t.aportes += o.dc; t.fluxos.push({ data: o.data, valor: o.dc }); break;
        case 'retirada': t.retiradas += -o.dc; t.fluxos.push({ data: o.data, valor: o.dc }); break;
        case 'taxa': t.taxas += -o.dc; break;
        case 'compra': { const x = p(o.assetId, o.moeda, o.data); x.qtdE8 += o.dq; x.custo += esperado.totalMoeda; x.custoBRL += -o.dc; t.taxas += emBRLop(paraCent(o.taxas || 0), o); break; }
        case 'venda': {
          const x = p(o.assetId, o.moeda, o.data); const q = -o.dq;
          const prop = (v) => (x.qtdE8 ? Number(divArred(BigInt(v) * BigInt(q), BigInt(x.qtdE8))) : 0);
          const cp = prop(x.custo), cpBRL = prop(x.custoBRL); const lucro = o.dc - cpBRL;
          x.qtdE8 -= q; x.custo -= cp; x.custoBRL -= cpBRL; x.lucroRealizado += lucro; t.lucroRealizado += lucro; t.taxas += emBRLop(paraCent(o.taxas || 0), o);
          memo.set(o.id, { cp, cpBRL, lucro }); break;
        }
        case 'dividendo': case 'jcp': case 'rendimento': {
          const k = `${o.tipo}|${o.assetId}|${o.data}|${o.valor}`;
          if (vistos.has(k)) avisos.push({ data: o.data, assetId: o.assetId, texto: `${TIPOS[o.tipo].nome} repetido com mesmo valor e data: confira se não foi lançado duas vezes` });
          vistos.add(k);
          p(o.assetId, o.moeda, o.data).proventos += o.dc; t.proventos += o.dc; t.proventosPorTipo[o.tipo] += o.dc; t.irRetido += emBRLop(paraCent(o.irRetido || 0), o); break;
        }
        case 'amortizacao': { const x = p(o.assetId, o.moeda, o.data); const v = paraCent(o.valor); const red = Math.min(x.custo, v), redB = Math.min(x.custoBRL, o.dc); x.custo -= red; x.custoBRL -= redB; memo.set(o.id, { red, redB }); break; }
        case 'bonificacao': { const x = p(o.assetId, o.moeda, o.data); const v = paraCent(o.valor || 0); x.qtdE8 += o.dq; x.custo += v; x.custoBRL += emBRLop(v, o); memo.set(o.id, { v, vB: emBRLop(v, o) }); break; }
        case 'desdobramento': case 'grupamento': p(o.assetId, o.moeda, o.data).qtdE8 += o.dq; break;
        case 'estorno': {
          estornadas.add(o.estorna);
          // reversão a partir de AGORA (lançamento contrário): o passado não é reescrito
          const id = alvo.assetId; const x = id ? p(id, alvo.moeda, alvo.data) : null;
          switch (alvo.tipo) {
            case 'compra': { // neutro no custo: tira as quantidades pelo preço médio atual (sem lucro nem prejuízo)
              const q = -o.dq; const prop = (v) => (x.qtdE8 ? Number(divArred(BigInt(v) * BigInt(q), BigInt(x.qtdE8))) : 0);
              const c1 = prop(x.custo), c2 = prop(x.custoBRL); x.qtdE8 -= q; x.custo -= c1; x.custoBRL -= c2; break;
            }
            case 'venda': { const m = memo.get(alvo.id) || { cp: 0, cpBRL: 0, lucro: 0 }; x.qtdE8 += o.dq; x.custo += m.cp; x.custoBRL += m.cpBRL; x.lucroRealizado -= m.lucro; t.lucroRealizado -= m.lucro; break; }
            case 'aporte': t.aportes += o.dc; t.fluxos.push({ data: o.data, valor: o.dc }); break;
            case 'retirada': t.retiradas -= o.dc; t.fluxos.push({ data: o.data, valor: o.dc }); break;
            case 'taxa': t.taxas -= o.dc; break;
            case 'dividendo': case 'jcp': case 'rendimento': x.proventos += o.dc; t.proventos += o.dc; t.proventosPorTipo[alvo.tipo] += o.dc; break;
            case 'amortizacao': { const m = memo.get(alvo.id) || { red: 0, redB: 0 }; x.custo += m.red; x.custoBRL += m.redB; break; }
            case 'bonificacao': { const m = memo.get(alvo.id) || { v: 0, vB: 0 }; x.qtdE8 += o.dq; x.custo -= m.v; x.custoBRL -= m.vB; break; }
            default: break;
          }
          break;
        }
        default: avisos.push({ data: o.data, texto: 'tipo desconhecido: ' + o.tipo });
      }
    }
    // o saldo recalculado tem que bater com o saldo guardado na carteira (as regras garantem; aqui conferimos)
    if (op.saldoCarteira && !op.ate && inconsistencias.length === 0) {
      const sc = op.saldoCarteira; const ids = new Set([...Object.keys(sc.pos || {}), ...Object.keys(saldo.pos)]);
      if (sc.caixa !== saldo.caixa || [...ids].some((k) => (sc.pos[k] || 0) !== (saldo.pos[k] || 0))) inconsistencias.push({ id: '-', data: ultima, texto: 'o saldo guardado na carteira não confere com as operações' });
    }
    for (const x of Object.values(pos)) x.precoMedio = x.qtdE8 > 0 ? Number(divArred(BigInt(x.custo) * E8, BigInt(x.qtdE8))) / 100 : 0; // na moeda do ativo
    t.aportado = t.aportes + t.aportesImplicitos - t.retiradas;
    return Object.assign({ posicoes: pos, avisos, inconsistencias, consistente: !inconsistencias.length, operacoesValidas: validas, estornadas: estornadas.size, saldo, ultimaData: ultima }, t);
  }

  // ---------- avaliação a mercado ----------
  // SÓ preços autorizados (tempo real, atrasado, fechamento) ou MANUAIS identificados contam. Preço SIMULADO nunca entra
  // numa carteira real (auditoria 26/11/2026). Sem preço, o ativo fica "sem avaliação" e o patrimônio vira PARCIAL,
  // com a cobertura informada; sem nenhum preço, fica INDISPONÍVEL. Câmbio: a mesma regra (USD/BRL autorizado ou manual).
  const ESTADOS_VALIDOS = ['tempo-real', 'atrasado', 'fechamento', 'manual'];
  const precoValido = (q) => !!(q && q.preco > 0 && ESTADOS_VALIDOS.includes(q.estado));
  // cot(assetId) → { preco, estado } ; usdbrl: { preco, estado } ; ativos(assetId) → { classe, pais, setor, ticker, nome }
  function avaliar(base, cot, usdbrl, ativos, op = {}) {
    const aceita = op.aceitarSimulado ? (q) => !!(q && q.preco > 0) : precoValido; // aceitarSimulado: SÓ na carteira de demonstração
    const itens = []; const estados = new Set(); let usd = 0; let efeitoCambial = 0; let semPreco = 0;
    const cambioOk = aceita(usdbrl); const cambioAtual = cambioOk ? usdbrl.preco : null;
    let custoTotal = 0, custoCoberto = 0, valorCoberto = 0;
    for (const x of Object.values(base.posicoes)) {
      if (x.qtdE8 <= 0) continue;
      const q = cot(x.assetId); const a = (ativos && ativos(x.assetId)) || {};
      let valor = null, valorBRL = null, motivo = '';
      if (!aceita(q)) motivo = q && q.preco > 0 ? 'preço não autorizado (' + q.estado + ')' : 'sem preço autorizado ou manual';
      else {
        // v160: cota de fundo com mais de 8 casas (texto decimal da CVM) é avaliada sem arredondar o preço antes
        valor = q.precoDec && /^\d{1,15}(\.\d{1,12})?$/.test(q.precoDec) ? valorCentavosTxt(x.qtdE8, q.precoDec) : valorCentavos(x.qtdE8, paraE8(q.preco));
        if (x.moeda === 'USD') {
          if (cambioAtual) { valorBRL = Math.round(valor * cambioAtual); const cambioMedio = x.custo ? x.custoBRL / x.custo : cambioAtual; efeitoCambial += Math.round(valor * (cambioAtual - cambioMedio)); estados.add(usdbrl.estado); }
          else { motivo = 'sem câmbio autorizado ou manual'; valor = null; }
        } else valorBRL = valor;
      }
      custoTotal += x.custoBRL;
      if (valorBRL == null) semPreco++; else { custoCoberto += x.custoBRL; valorCoberto += valorBRL; if (x.moeda === 'USD') usd += valorBRL; estados.add(q.estado); }
      itens.push({ assetId: x.assetId, ticker: a.ticker || x.assetId.split(':')[2], nome: a.nome || '', classe: a.classe || '', pais: a.pais || x.assetId.split(':')[0], setor: a.setor || 'Sem setor', moeda: x.moeda,
        qtd: x.qtdE8 / 1e8, precoMedio: x.precoMedio, preco: valorBRL == null ? null : q.preco, estado: valorBRL == null ? 'indisponivel' : q.estado, precoData: valorBRL == null ? null : (q.data || null), precoFonte: valorBRL == null ? null : (q.fonteNome || q.fonte || null), precoTipo: valorBRL == null ? null : (q.tipoPreco || null), motivo, valor, valorBRL, custoBRL: x.custoBRL,
        resultado: valorBRL == null ? null : valorBRL - x.custoBRL, resultadoPct: valorBRL == null || !x.custoBRL ? null : r2(((valorBRL - x.custoBRL) / x.custoBRL) * 100), proventos: x.proventos, lucroRealizado: x.lucroRealizado });
    }
    const nPos = itens.length;
    const situacao = !base.consistente ? 'inconsistente' : nPos === 0 ? 'completa' : semPreco === 0 ? 'completa' : semPreco === nPos ? 'indisponivel' : 'parcial';
    itens.forEach((i) => { i.peso = valorCoberto > 0 && i.valorBRL != null ? r2((i.valorBRL / valorCoberto) * 100) : null; });
    itens.sort((a, b) => (b.valorBRL || 0) - (a.valorBRL || 0) || (b.custoBRL - a.custoBRL));
    const completa = situacao === 'completa';
    const patrimonio = situacao === 'inconsistente' || situacao === 'indisponivel' ? null : base.caixa + valorCoberto;
    return {
      itens, situacao, completa, patrimonio, posicoesBRL: valorCoberto, caixa: base.caixa, custo: custoTotal, aportado: base.aportado,
      cobertura: { ativos: nPos - semPreco, de: nPos, custoPct: custoTotal ? r2((custoCoberto / custoTotal) * 100) : 100 },
      naoRealizado: completa ? valorCoberto - custoCoberto : null, naoRealizadoParcial: valorCoberto - custoCoberto,
      lucroRealizado: base.lucroRealizado, proventos: base.proventos,
      // resultado total = quanto vale hoje − o que entrou (aportes não são ganho). Só com avaliação COMPLETA.
      resultadoTotal: completa ? base.caixa + valorCoberto - base.aportado : null,
      exposicaoCambial: completa && (base.caixa + valorCoberto) > 0 ? r2((usd / (base.caixa + valorCoberto)) * 100) : null, efeitoCambial: completa ? efeitoCambial : null,
      semPreco, estados: [...estados], inconsistencias: base.inconsistencias,
    };
  }
  // XIRR só com avaliação completa (fluxos reais + patrimônio de hoje); não precisa de histórico de preços
  function xirrCarteira(base, av, hoje) {
    if (!av.completa || !base.fluxos.length) return { taxa: null, motivo: av.completa ? 'sem aportes registrados' : 'avaliação incompleta' };
    const fx = base.fluxos.map((f) => ({ data: f.data, valor: -f.valor / 100 })).concat([{ data: hoje, valor: av.patrimonio / 100 }]).sort((a, b) => (a.data < b.data ? -1 : 1));
    const t = xirr(fx); return { taxa: t, motivo: t == null ? 'menos de 30 dias ou fluxos sem solução' : '' };
  }
  function distribuir(itens, chave, rotulos) {
    const m = new Map(); let tot = 0;
    for (const i of itens) { if (i.valorBRL == null) continue; const k = i[chave] || 'Outros'; m.set(k, (m.get(k) || 0) + i.valorBRL); tot += i.valorBRL; }
    return [...m.entries()].map(([k, v]) => ({ chave: k, rotulo: (rotulos && rotulos[k]) || k, valor: v, pct: tot ? r2((v / tot) * 100) : 0 })).sort((a, b) => b.valor - a.valor);
  }

  // ---------- rentabilidade ----------
  function twr(periodos) { let acc = 1; for (const p of periodos) { if (p.base > 0) acc *= 1 + p.ganho / p.base; } return acc - 1; }
  function xirr(fluxos) {
    if (fluxos.length < 2) return null;
    const t0 = Date.parse(fluxos[0].data);
    const anos = fluxos.map((f) => (Date.parse(f.data) - t0) / (365 * 864e5));
    if (anos[anos.length - 1] < 30 / 365) return null; // menos de 30 dias: taxa anual não faz sentido
    const vpl = (r) => fluxos.reduce((s, f, i) => s + f.valor / Math.pow(1 + r, anos[i]), 0);
    const der = (r) => fluxos.reduce((s, f, i) => s - anos[i] * f.valor / Math.pow(1 + r, anos[i] + 1), 0);
    let r = 0.1;
    for (let i = 0; i < 60; i++) { const d = der(r); if (!d) break; const n = r - vpl(r) / d; if (!isFinite(n) || n <= -0.9999) break; if (Math.abs(n - r) < 1e-10) return n; r = n; }
    let lo = -0.9999, hi = 10; if (vpl(lo) * vpl(hi) > 0) return null;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (vpl(lo) * vpl(m) <= 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  // evolução mensal + TWR + XIRR. O TWR aqui é uma APROXIMAÇÃO: Dietz modificado por mês, encadeado (não é o TWR diário exato).
  // precoEm(assetId, data) → { preco, estado } | null ; cambioEm(data) → { preco, estado } | null
  // Só calcula com preço autorizado/manual em TODAS as datas (ou simulado, se op.aceitarSimulado = demonstração).
  function evolucao(ops, precoEm, cambioEm, ativos, hoje, op = {}) {
    const validas = ops.filter((o) => o.tipo !== 'estorno');
    const metodo = 'Dietz modificado mensal, encadeado (aproximação do TWR)';
    if (!validas.length) return { pontos: [], twr: null, xirr: null, suficiente: false, motivo: 'Sem operações.', metodo };
    if (!calcular(ops, op).consistente) return { pontos: [], twr: null, xirr: null, suficiente: false, motivo: 'Carteira com operações inconsistentes.', metodo };
    const ini = validas.reduce((m, o) => (o.data < m ? o.data : m), '9999');
    const fins = []; const d = new Date(ini.slice(0, 7) + '-01T12:00:00Z');
    while (true) { const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)); const iso = f.toISOString().slice(0, 10); if (iso >= hoje) { fins.push(hoje); break; } fins.push(iso); d.setUTCMonth(d.getUTCMonth() + 1); }
    const pontos = []; let ant = null; const periodos = []; let estadoMin = new Set();
    for (const fim of fins) {
      const b = calcular(ops, { ate: fim, caixaAutomatico: op.caixaAutomatico });
      const av = avaliar(b, (id) => { const q = precoEm(id, fim); if (q) estadoMin.add(q.estado); return q; }, cambioEm(fim), ativos, { aceitarSimulado: op.aceitarSimulado });
      if (!av.completa) return { pontos: [], twr: null, xirr: null, suficiente: false, metodo, motivo: 'Sem histórico de preços autorizado para todos os ativos (o histórico simulado não é usado em carteiras reais).' };
      const p = { data: fim, patrimonio: av.patrimonio, aportado: b.aportado, semPreco: av.semPreco };
      if (ant) {
        const fl = b.fluxos.filter((f) => f.data > ant.data && f.data <= fim);
        const dias = (Date.parse(fim) - Date.parse(ant.data)) / 864e5 || 1;
        const somaFl = fl.reduce((s, f) => s + f.valor, 0);
        const pond = fl.reduce((s, f) => s + f.valor * ((Date.parse(fim) - Date.parse(f.data)) / 864e5) / dias, 0);
        const base = ant.patrimonio + pond; const ganho = av.patrimonio - ant.patrimonio - somaFl;
        if (base > 0) periodos.push({ base, ganho });
        p.retornoMes = base > 0 ? r2((ganho / base) * 100) : null;
      } else {
        const fl = b.fluxos.filter((f) => f.data <= fim); const somaFl = fl.reduce((s, f) => s + f.valor, 0);
        const pond = fl.reduce((s, f) => s + f.valor * ((Date.parse(fim) - Date.parse(f.data)) / 864e5) / Math.max(1, (Date.parse(fim) - Date.parse(ini)) / 864e5 || 1), 0);
        if (pond > 0) { periodos.push({ base: pond, ganho: av.patrimonio - somaFl }); p.retornoMes = r2(((av.patrimonio - somaFl) / pond) * 100); }
      }
      pontos.push(p); ant = p;
    }
    const final = calcular(ops, { caixaAutomatico: op.caixaAutomatico });
    const ult = pontos[pontos.length - 1];
    const fx = final.fluxos.map((f) => ({ data: f.data, valor: -f.valor / 100 })).concat([{ data: hoje, valor: ult.patrimonio / 100 }]).sort((a, b) => (a.data < b.data ? -1 : 1));
    const span = (Date.parse(hoje) - Date.parse(ini)) / 864e5;
    const suficiente = span >= 30 && pontos.length >= 2 && !pontos.some((x) => x.semPreco);
    return { pontos, twr: suficiente ? twr(periodos) : null, xirr: suficiente ? xirr(fx) : null, suficiente, estados: [...estadoMin], metodo,
      motivo: suficiente ? '' : span < 30 ? 'Menos de 30 dias de histórico.' : 'Há ativos sem preço em alguma data do histórico.' };
  }

  // ---------- conversão para gravação (números com casas limitadas; o cálculo usa inteiros) ----------
  function paraGravar(o) {
    const t = TIPOS[o.tipo] || {};
    const x = { tipo: o.tipo, data: o.data };
    if (t.ativo) x.assetId = o.assetId;
    if (t.qtd) x.qtd = Math.round(o.qtd * 1e8) / 1e8;
    if (t.preco) x.preco = Math.round(o.preco * 1e8) / 1e8;
    if (t.valor || (t.valorOpcional && o.valor)) x.valor = r2(o.valor);
    if (t.fator) x.fator = Number(o.fator);
    if (t.estorna) x.estorna = o.estorna;
    if (o.taxas) x.taxas = r2(o.taxas);
    if (o.irRetido) x.irRetido = r2(o.irRetido);
    x.moeda = o.moeda === 'USD' ? 'USD' : 'BRL';
    if (x.moeda === 'USD' && o.cambio) x.cambio = Math.round(o.cambio * 1e4) / 1e4;
    if (o.corretora) x.corretora = String(o.corretora).slice(0, 40);
    if (o.nota) x.nota = String(o.nota).slice(0, 200);
    return x;
  }

  return { TIPOS, LIM, REVERSIVEIS, ESTADOS_VALIDOS, precoValido, dataValida, validarOperacao, efeito, aplicar, prepararOperacao, xirrCarteira, calcular, avaliar, distribuir, twr, xirr, evolucao, paraGravar, valorCentavos, valorCentavosTxt, paraE8, paraCent, divArred };
});
