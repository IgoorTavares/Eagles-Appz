// R1 (plano dos agentes reais, seções 4 e 13.1): LISTA FECHADA dos modelos da Anthropic previstos
// nesta fase, com os dados conferidos na documentação oficial em 09/11/2026:
//   https://platform.claude.com/docs/en/about-claude/pricing
//   https://platform.claude.com/docs/en/about-claude/models/overview (+ a página de cada modelo)
// Qualquer outro ID é recusado ANTES de chegar ao provedor (configuração e verificação).
//
// PREÇOS NÃO FICAM NO CÓDIGO (regra da Fase 4B, conferida por teste): o preço que vale é o cadastrado
// pelo Super Admin (custos.definirPreco), com fonte e data. Os valores oficiais de 09/11/2026 estão no
// plano (LABZ-PLANO-AGENTES-REAIS.md, seção 13.1) e nos dados dos testes.
const FONTE_OFICIAL = 'https://platform.claude.com/docs/en/about-claude/pricing';
const CONFERIDO_EM = '2026-11-09';

const MODELOS = Object.freeze({
  'claude-haiku-5-5': Object.freeze({
    nome: 'Claude Haiku 5.5', nivel: 1,
    contexto: 1000000, saidaMaxima: 128000, leImagem: true, geraImagem: false,
    esforcos: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  }),
  'claude-sonnet-5-5': Object.freeze({
    nome: 'Claude Sonnet 5.5', nivel: 2,
    contexto: 1000000, saidaMaxima: 128000, leImagem: true, geraImagem: false,
    esforcos: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  }),
  'claude-opus-5-5': Object.freeze({
    nome: 'Claude Opus 5.5', nivel: 3,
    contexto: 1000000, saidaMaxima: 128000, leImagem: true, geraImagem: false,
    esforcos: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  }),
});
const IDS_PERMITIDOS = Object.freeze(Object.keys(MODELOS));
// Nesta fase o esforço fica entre low e high (xhigh/max só com nova decisão: gastam mais).
const ESFORCOS_DA_FASE = Object.freeze(['low', 'medium', 'high']);

const modeloAnthropic = (id) => (Object.prototype.hasOwnProperty.call(MODELOS, id) ? MODELOS[id] : null);

// Problemas de compatibilidade (vazio = compatível). recursos: os do agente (RECURSOS_MODELO).
function problemasDoModeloAnthropic(id, { recursos = [], maxTokensSaida, esforco } = {}) {
  const m = modeloAnthropic(id);
  if (!m) return [`modelo "${String(id).slice(0, 60)}" fora da lista fechada desta fase (${IDS_PERMITIDOS.join(', ')})`];
  const p = [];
  if (recursos.includes('imagem-saida') && !m.geraImagem) p.push(`${m.nome} não gera imagem (o agente precisa de imagem-saida: caminho de imagens separado, etapa R6)`);
  if (recursos.includes('imagem-entrada') && !m.leImagem) p.push(`${m.nome} não lê imagem`);
  if (maxTokensSaida !== undefined && maxTokensSaida > m.saidaMaxima) p.push(`teto de saída ${maxTokensSaida} acima do máximo do modelo (${m.saidaMaxima})`);
  if (esforco !== undefined && !ESFORCOS_DA_FASE.includes(esforco)) p.push(`esforço "${esforco}" fora do permitido nesta fase (${ESFORCOS_DA_FASE.join(', ')})`);
  return p;
}

module.exports = { MODELOS_ANTHROPIC: MODELOS, IDS_ANTHROPIC_PERMITIDOS: IDS_PERMITIDOS, ESFORCOS_DA_FASE, FONTE_OFICIAL_ANTHROPIC: FONTE_OFICIAL, CONFERIDO_EM_ANTHROPIC: CONFERIDO_EM, modeloAnthropic, problemasDoModeloAnthropic };
