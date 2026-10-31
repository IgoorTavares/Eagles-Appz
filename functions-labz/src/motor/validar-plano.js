// Fase 4B: validação do PLANO proposto pelo Estrategista (modelo ou simulado).
// O Estrategista PROPÕE; quem decide se o plano vale é este código, no backend,
// seja qual for o modelo. Devolve TODOS os problemas encontrados (não só o
// primeiro), para o diagnóstico ser claro.
//
// Confere: formato; campos proibidos (cliente, limites, permissões, tentativas,
// aprovações: são do sistema); agentes do catálogo e que atuam no modo
// orquestrado; ações previstas permitidas ao agente; ids (formato, únicos, não
// reservados); dependências existentes, sem auto-dependência e sem ciclo;
// critérios de conclusão; formato do resultado; limite de etapas (estrutural,
// o da execução: se passar, o projeto precisa ser DIVIDIDO); estimativa de
// consumo dentro dos limites da execução; e menção a OUTRO cliente.
const { validar } = require('../nucleo/validador');
const { obterAgente } = require('../agentes/catalogo');
const { avaliarAcao } = require('./ferramentas-simuladas');
const { ordenar, CONSOLIDACAO } = require('./planejador');
const custos = require('./custos');
const { documentoPermitido, consumoPermitido } = require('../contratos/documentos');

const ID = /^[a-z0-9-]{1,30}$/;
const PROIBIDOS = ['empresaId', 'clienteId', 'tenantId', 'limites', 'maxEtapas', 'permissoes', 'tentativas', 'maxTentativas', 'aprovado', 'aprovacao', 'aprovacoes', 'ferramentas', 'custos', 'modelo', 'provedor'];
const ESQUEMA_ETAPA = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto', obrigatorio: true },
    agenteId: { tipo: 'texto', obrigatorio: true, max: 40 },
    objetivo: { tipo: 'texto', obrigatorio: true, min: 3, max: 2000 },
    dependeDe: { tipo: 'lista', max: 8, itens: { tipo: 'texto', max: 30 } },
    criterios: { tipo: 'lista', obrigatorio: true, min: 1, max: 8, itens: { tipo: 'texto', min: 3, max: 300 } },
    estimativaTokens: { tipo: 'inteiro', obrigatorio: true, min: 1, max: 2000000 },
    formato: { tipo: 'texto' },
    acoesPrevistas: { tipo: 'lista', max: 5, itens: { tipo: 'objeto', extras: false, campos: { ferramentaId: { tipo: 'texto', obrigatorio: true, max: 60 }, operacao: { tipo: 'texto', obrigatorio: true, max: 30 } } } },
    // Fase 4C.2: o Estrategista PROPÕE o documento; aqui se confere catálogo e permissão do agente
    documento: { tipo: 'texto', max: 40 },
  },
};
const ESQUEMA_PLANO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: { resumo: { tipo: 'texto', obrigatorio: true, min: 3, max: 2000 }, etapas: { tipo: 'lista', obrigatorio: true, min: 1, max: 50, itens: ESQUEMA_ETAPA } },
};
const FORMATOS = ['texto'];
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// plano: o objeto do modelo. contexto: { exe, outrasEmpresas: [nomes] }
// → { valido, problemas: [{ codigo, etapa?, detalhe }], passos, estimativa, sugestao }
function validarPlano(plano, { exe, outrasEmpresas = [] }) {
  const problemas = [];
  const add = (codigo, detalhe, etapa) => problemas.push(Object.assign({ codigo, detalhe: String(detalhe).slice(0, 200) }, etapa ? { etapa: String(etapa).slice(0, 30) } : {}));
  const lim = custos.limitesDe(exe);

  if (!plano || typeof plano !== 'object' || Array.isArray(plano)) {
    add('formato-invalido', 'o plano não é um objeto');
    return { valido: false, problemas, passos: null, estimativa: null, sugestao: 'Peça um novo plano ao Estrategista.' };
  }
  // campos proibidos: em qualquer nível do plano ou das etapas
  Object.keys(plano).filter((k) => PROIBIDOS.includes(k)).forEach((k) => add('campo-proibido', `o plano não pode definir "${k}"`));
  (Array.isArray(plano.etapas) ? plano.etapas : []).forEach((e, i) => {
    if (e && typeof e === 'object') Object.keys(e).filter((k) => PROIBIDOS.includes(k)).forEach((k) => add('campo-proibido', `a etapa não pode definir "${k}"`, e.id || `#${i + 1}`));
  });
  if (problemas.length) return { valido: false, problemas, passos: null, estimativa: null, sugestao: 'O plano tentou definir algo que é do sistema.' };

  validar(ESQUEMA_PLANO, plano).forEach((d) => add('formato-invalido', d));
  if (problemas.length) return { valido: false, problemas, passos: null, estimativa: null, sugestao: 'Peça um novo plano ao Estrategista.' };

  const etapas = plano.etapas;
  if (etapas.length > lim.etapas) {
    add('projeto-grande-demais', `${etapas.length} etapas; o limite desta execução é ${lim.etapas}`);
    return { valido: false, problemas, passos: null, estimativa: null, sugestao: `Divida o projeto em partes de até ${lim.etapas} etapas (uma execução para cada parte) ou revise o pedido. O limite não é aumentado automaticamente.` };
  }
  const ids = etapas.map((e) => e.id);
  etapas.forEach((e) => {
    if (!ID.test(e.id)) add('id-invalido', 'use letras minúsculas, números e hífen (até 30)', e.id);
    if (e.id === CONSOLIDACAO) add('id-reservado', `"${CONSOLIDACAO}" é a etapa final automática`, e.id);
    const ag = obterAgente(e.agenteId);
    if (!ag) add('agente-inexistente', e.agenteId, e.id);
    else if (!ag.modos.includes('orquestrado')) add('agente-fora-do-modo', e.agenteId, e.id);
    (e.dependeDe || []).forEach((d) => {
      if (d === e.id) add('auto-dependencia', d, e.id);
      else if (!ids.includes(d)) add('dependencia-inexistente', d, e.id);
    });
    if (e.formato !== undefined && !FORMATOS.includes(e.formato)) add('formato-de-resultado-invalido', e.formato, e.id);
    if (e.documento !== undefined && ag) { const dp = documentoPermitido(e.agenteId, e.documento); if (!dp.permitido) add(dp.motivo, e.documento, e.id); }
    // Fase 4C.2 (passo 3): quem depende de um documento precisa poder RECEBÊ-LO
    (e.dependeDe || []).forEach((d) => {
      const prod = etapas.find((x) => x.id === d);
      if (prod && prod.documento !== undefined && consumoPermitido(e.agenteId, prod.documento).motivo === 'dependencia-nao-autorizada') add('dependencia-nao-autorizada', `${e.agenteId} não recebe ${prod.documento}`, e.id);
    });
    if (!e.criterios.every((c) => c.trim().length >= 3)) add('criterio-vazio', 'critério de conclusão vazio', e.id);
    if (ag) (e.acoesPrevistas || []).forEach((a) => {
      const v = avaliarAcao(e.agenteId, { tipo: 'ferramenta', ferramentaId: a.ferramentaId, operacao: a.operacao });
      if (!v.permitida) add('acao-nao-autorizada', `${a.ferramentaId}:${a.operacao} (${v.motivo})`, e.id);
    });
  });
  const repetidos = ids.filter((x, i) => ids.indexOf(x) !== i);
  [...new Set(repetidos)].forEach((x) => add('etapa-duplicada', x, x));
  if (!problemas.some((p) => ['dependencia-inexistente', 'auto-dependencia', 'etapa-duplicada'].includes(p.codigo))) {
    try { ordenar(etapas.map((e) => ({ id: e.id, dependeDe: e.dependeDe || [] }))); } catch (er) { add('dependencia-circular', 'as dependências formam um ciclo'); }
  }
  // escopo do cliente: o plano não fala de OUTRA empresa da LABZ AI
  const texto = norm(etapas.map((e) => `${e.objetivo} ${e.criterios.join(' ')}`).join(' ') + ' ' + plano.resumo);
  outrasEmpresas.filter((n) => norm(n).length >= 4 && texto.includes(norm(n))).forEach((n) => add('escopo-de-outro-cliente', 'o plano cita outra empresa', null));
  // consumo estimado (planejamento já gasto + etapas + consolidação) dentro do limite da execução
  const estimativa = etapas.reduce((s, e) => s + e.estimativaTokens, 0);
  const consolidacao = Math.max(...etapas.map((e) => e.estimativaTokens));
  const ja = (exe.custos && exe.custos.tokens) || 0;
  if (ja + estimativa + consolidacao > lim.tokens) add('limite-de-custo', `estimativa ${estimativa + consolidacao} + já usados ${ja} > limite ${lim.tokens} tokens`);
  else if ((exe.custos ? exe.custos.custoSimulado : 0) + custos.custoDe(estimativa + consolidacao) > lim.custoSimulado) add('limite-de-custo', 'estimativa acima do limite de custo simulado da execução');

  const valido = problemas.length === 0;
  const passos = valido ? etapas.map((e) => {
    const p = { id: e.id, agenteId: e.agenteId, objetivo: e.objetivo, dependeDe: (e.dependeDe || []).slice(), criterios: e.criterios.slice(), estimativaTokens: e.estimativaTokens };
    if (e.acoesPrevistas) p.acoesPrevistas = e.acoesPrevistas.map((a) => ({ ferramentaId: a.ferramentaId, operacao: a.operacao }));
    if (e.documento) p.documento = e.documento;
    return p;
  }) : null;
  const sugestao = valido ? null : problemas.some((p) => p.codigo === 'limite-de-custo') ? 'Reduza o escopo, divida o projeto ou peça ao Super Admin limites maiores para esta execução.' : 'Peça um novo plano ao Estrategista ou ajuste o pedido.';
  return { valido, problemas: problemas.slice(0, 30), passos, estimativa: { tokens: estimativa + consolidacao }, sugestao };
}

module.exports = { validarPlano, PROIBIDOS, ESQUEMA_PLANO_MODELO: ESQUEMA_PLANO };
