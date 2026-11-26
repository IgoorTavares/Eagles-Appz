/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — AI Engine (Etapa 08: PREPARADO e DESLIGADO)
   Contrato para vários provedores (GPT, Claude, Gemini, Grok). Nesta etapa:
   - NENHUMA chave existe aqui nem no navegador (chave só no servidor, D-10);
   - nenhum provedor está ligado; toda geração responde "indisponível";
   - o FILTRO DE PRIVACIDADE já existe e é testado: dados das carteiras só
     saem com autorização ESPECÍFICA da pessoa, e mesmo assim só em porcentagens.
   O que não depende de IA (Analytics Engine, boletins por regra) funciona sem ela.
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.ia = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const PROVEDORES = {
    gpt: { nome: 'OpenAI (GPT)', ligado: false },
    claude: { nome: 'Anthropic (Claude)', ligado: false },
    gemini: { nome: 'Google (Gemini)', ligado: false },
    grok: { nome: 'xAI (Grok)', ligado: false },
  };
  const MOTIVO = 'Desligado: a chave de acesso só pode ficar no servidor (D-10), não há orçamento para uso pago (R$ 0) e o uso depende da sua aprovação.';
  const TAREFAS = {
    materia: 'Matéria a partir de notícias de fontes verificáveis (sempre com os links)',
    interpretacao: 'Interpretação de indicadores e de movimentos do mercado',
    'boletim-abertura': 'Boletim de abertura', 'boletim-intradiario': 'Boletim intradiário', 'boletim-fechamento': 'Boletim de fechamento',
  };

  // Só sai o que é PÚBLICO (mercado e notícias com fonte). Carteira: nada, a não ser com autorização específica,
  // e mesmo assim só porcentagens agregadas (nunca valores em reais, quantidades, nomes de corretora ou operações).
  function prepararContexto(dados, autorizacao = {}) {
    const ctx = { mercado: [], noticias: [] };
    for (const q of (dados && dados.mercado) || []) ctx.mercado.push({ nome: String(q.nome || ''), variacaoPct: q.variacaoPct ?? null, estado: q.estado, fonte: q.fonteNome || q.fonte || '' });
    for (const n of (dados && dados.noticias) || []) if (n.link) ctx.noticias.push({ titulo: n.titulo, resumo: n.resumo, link: n.link, fonte: n.fonte, data: n.data });
    if (autorizacao.carteira === true && dados && dados.carteira) {
      ctx.carteira = { distribuicaoPorClasse: (dados.carteira.distribuicao || []).map((d) => ({ classe: d.rotulo, pct: d.pct })), rentabilidadePct: dados.carteira.rentabilidadePct ?? null };
    }
    return ctx;
  }
  // toda resposta de IA, quando existir, terá de trazer as fontes; sem fonte verificável = descartada
  function validarResposta(r) { return !!(r && typeof r.texto === 'string' && Array.isArray(r.fontes) && r.fontes.length && r.fontes.every((f) => /^https?:\/\//.test(f))); }
  async function gerar(tarefa, provedor) {
    if (!TAREFAS[tarefa]) return { estado: 'erro', motivo: 'tarefa desconhecida' };
    const p = PROVEDORES[provedor];
    if (!p || !p.ligado) return { estado: 'indisponivel', motivo: MOTIVO };
    return { estado: 'indisponivel', motivo: MOTIVO }; // nenhuma chamada externa nesta etapa
  }
  return { PROVEDORES, TAREFAS, MOTIVO, prepararContexto, validarResposta, gerar };
});
