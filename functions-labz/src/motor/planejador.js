// Task Planner da Fase 4A. Monta as etapas de uma execução:
//  - especialista: uma etapa, do agente da execução;
//  - orquestrado: as etapas do plano do Estrategista (na 4A o plano vem do
//    Super Admin ou de um adaptador SIMULADO; modelos reais só depois), com
//    dependências. O plano é validado: agentes existentes, ids únicos,
//    dependências existentes, sem ciclo e dentro do limite de etapas.
// A ordem é determinística (topológica; empate pelo id).
const { erro } = require('../nucleo/erros');
const { garantir } = require('../nucleo/validador');
const { obterAgente } = require('../agentes/catalogo');
const { documentoPermitido, DOCUMENTO_DA_CONSOLIDACAO } = require('../contratos/documentos');

const CONSOLIDACAO = 'consolidacao';
const ESQUEMA_PASSO = {
  tipo: 'objeto', obrigatorio: true, extras: false,
  campos: {
    id: { tipo: 'texto', obrigatorio: true, padrao: /^[a-z0-9-]{1,30}$/ },
    agenteId: { tipo: 'texto', obrigatorio: true, padrao: /^0[1-8]-[a-z-]+$/ },
    objetivo: { tipo: 'texto', obrigatorio: true, min: 3, max: 2000 },
    dependeDe: { tipo: 'lista', max: 8, itens: { tipo: 'texto', padrao: /^[a-z0-9-]{1,30}$/ } },
    // Fase 4B (opcionais; vêm do plano validado do Estrategista)
    criterios: { tipo: 'lista', max: 8, itens: { tipo: 'texto', min: 3, max: 300 } },
    estimativaTokens: { tipo: 'inteiro', min: 1, max: 2000000 },
    acoesPrevistas: { tipo: 'lista', max: 5, itens: { tipo: 'objeto', extras: false, campos: { ferramentaId: { tipo: 'texto', obrigatorio: true, max: 60 }, operacao: { tipo: 'texto', obrigatorio: true, max: 30 } } } },
    // Fase 4C.2 (opcional): o documento estruturado da etapa (catálogo contratos/documentos.js)
    documento: { tipo: 'texto', padrao: /^[a-z-]{3,40}$/ },
  },
};

function ordenar(passos) {
  const pend = new Map(passos.map((p) => [p.id, new Set(p.dependeDe || [])]));
  const ordem = [];
  while (pend.size) {
    const prontos = [...pend.entries()].filter(([, d]) => d.size === 0).map(([id]) => id).sort();
    if (!prontos.length) throw erro('invalido', 'O plano tem dependência circular');
    prontos.forEach((id) => { ordem.push(id); pend.delete(id); pend.forEach((d) => d.delete(id)); });
  }
  return ordem;
}

// Devolve as etapas prontas para gravar na execução.
function montarEtapas(exe, passos, { maxEtapas = 8 } = {}) {
  if (exe.modo === 'especialista') {
    if (!obterAgente(exe.agenteId)) throw erro('invalido', 'Execução sem agente válido');
    passos = [{ id: 'e1', agenteId: exe.agenteId, objetivo: String(exe.objetivo).slice(0, 2000), dependeDe: [] }];
  } else {
    if (!Array.isArray(passos) || !passos.length) throw erro('invalido', 'O modo orquestrado precisa de um plano com etapas');
    garantir({ tipo: 'lista', obrigatorio: true, min: 1, max: maxEtapas, itens: ESQUEMA_PASSO }, passos, 'Plano');
    const ids = passos.map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw erro('invalido', 'Cada etapa precisa de um id diferente');
    if (ids.includes(CONSOLIDACAO)) throw erro('invalido', `"${CONSOLIDACAO}" é reservado para a etapa final do Estrategista`);
    passos.forEach((p) => {
      if (!obterAgente(p.agenteId)) throw erro('invalido', `Agente desconhecido: ${p.agenteId}`);
      if (p.documento !== undefined) { const d = documentoPermitido(p.agenteId, p.documento); if (!d.permitido) throw erro('invalido', `Documento da etapa ${p.id}: ${d.motivo}`); }
      (p.dependeDe || []).forEach((d) => { if (!ids.includes(d)) throw erro('invalido', `A etapa ${p.id} depende de uma etapa que não existe: ${d}`); if (d === p.id) throw erro('invalido', 'Uma etapa não depende dela mesma'); });
    });
  }
  // orquestrado: o Estrategista consolida no fim (etapa automática que depende de todas)
  if (exe.modo !== 'especialista') {
    passos = [...passos, { id: CONSOLIDACAO, agenteId: '08-estrategista', objetivo: `Consolidar as entregas para: ${String(exe.objetivo).slice(0, 1800)}`, dependeDe: passos.map((p) => p.id), criterios: ['Reúne todas as entregas das etapas', 'Confere cada entrega com os critérios de conclusão dela'], ...(passos.some((p) => p.documento) ? { documento: DOCUMENTO_DA_CONSOLIDACAO } : {}) }];
    // (Fase 4C.2) a consolidação só vira documento estruturado em planos COM documentos: planos antigos continuam em texto livre
  }
  const ordem = ordenar(passos);
  const porId = new Map(passos.map((p) => [p.id, p]));
  return ordem.map((id) => {
    const p = porId.get(id);
    const etapa = { id: p.id, agenteId: p.agenteId, objetivo: p.objetivo, dependeDe: (p.dependeDe || []).slice().sort(), status: 'pendente', tentativas: 0, tentativasQualidade: 0, aprovacoes: [], resultado: null, ultimoErro: null };
    if (p.criterios) etapa.criterios = p.criterios.slice(); // Fase 4B: critérios de conclusão
    if (p.estimativaTokens) etapa.estimativaTokens = p.estimativaTokens;
    if (p.acoesPrevistas) etapa.acoesPrevistas = p.acoesPrevistas.map((a) => ({ ferramentaId: a.ferramentaId, operacao: a.operacao }));
    if (p.documento) etapa.documento = p.documento; // Fase 4C.2: tipo validado (sem documento = texto livre, como antes)
    return etapa;
  });
}

module.exports = { montarEtapas, ordenar, ESQUEMA_PASSO, CONSOLIDACAO };
