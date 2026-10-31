// Fase 4C.2 (passo 2): documentos SIMULADOS, um por tipo do catálogo, para o
// modelo simulado devolver quando a etapa pede um documento estruturado.
// Tudo marcado "[SIMULADO]". Nada de métricas reais, resultados de campanha ou
// fatos: números de negócio ficam zerados ou "a definir", hipóteses sem evidência.
const { LIMITES_LEGENDA } = require('../../contratos/documentos');

const S = '[SIMULADO]';
const curto = (t, n = 120) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n) || 'pedido';

// Hash fictício (64 hex) só para o simulado preencher o formato; o backend substitui.
const HASH_FICTICIO = '0'.repeat(64);

const GERADORES = {
  'plano-estrategico': (p) => ({
    titulo: `${S} Plano estratégico`, objetivo: `${S} Objetivo derivado do pedido: ${curto(p)}`, publico: `${S} Público a confirmar com o Super Admin`,
    mensagensChave: [`${S} Mensagem principal a validar`], canais: ['a definir'],
    cronograma: [{ ordem: 1, periodo: 'etapa 1', entregas: [`${S} Entregas iniciais`] }, { ordem: 2, periodo: 'etapa 2', entregas: [`${S} Ajustes`] }],
    riscos: [`${S} Riscos a levantar`], metricasSucesso: [`${S} Métrica a definir (sem valor inventado)`],
  }),
  'consolidacao-final': (p) => ({
    titulo: `${S} Consolidação final`, resumo: `${S} Consolidação das entregas para: ${curto(p, 300)}`,
    entregas: [{ etapaId: 'preenchido-pelo-sistema', entregaId: 'preenchido_pelo_sistema', versao: 1, hash: HASH_FICTICIO }],
    pendencias: [`${S} Revisão do Super Admin`], proximosPassos: [`${S} Aprovar as entregas`],
  }),
  'diretrizes-marca': (p) => ({
    marca: `${S} Marca do pedido`, posicionamento: `${S} Posicionamento a validar: ${curto(p)}`,
    paleta: [{ nome: 'Primária (simulada)', hex: '#1F6FEB', uso: 'destaques' }, { nome: 'Texto (simulada)', hex: '#1B1F24', uso: 'texto' }],
    tipografia: [{ uso: 'títulos', familia: 'Fonte a definir', pesos: [700] }],
    tomDeVoz: { e: [`${S} claro`], naoE: [`${S} exagerado`] }, orientacoesUso: [`${S} Orientação a validar com a memória aprovada`],
  }),
  'briefing-design': (p) => ({
    peca: `${S} Peça do pedido`, objetivo: `${S} ${curto(p)}`, formato: '1080x1350',
    hierarquia: ['título', 'imagem', 'chamada'], elementos: [`${S} elemento visual a definir`], textoDaPeca: `${S} Texto da peça`,
  }),
  'estrutura-carrossel': () => ({
    titulo: `${S} Carrossel`, quantidadeSlides: 3,
    slides: [{ numero: 1, titulo: 'Gancho', texto: `${S} Abertura` }, { numero: 2, titulo: 'Conteúdo', texto: `${S} Desenvolvimento` }, { numero: 3, titulo: 'Fechamento', texto: `${S} Chamada final` }],
    chamadaParaAcao: `${S} Chamada para ação`,
  }),
  'roteiro-reels': (p) => ({
    titulo: `${S} Roteiro de Reels`, objetivo: `${S} ${curto(p)}`, duracaoSegundos: 15,
    cenas: [{ ordem: 1, duracaoSegundos: 5, fala: `${S} Abertura`, visual: 'plano aberto' }, { ordem: 2, duracaoSegundos: 10, fala: `${S} Mensagem`, visual: 'detalhe do produto' }],
    chamadaParaAcao: `${S} Chamada para ação`,
  }),
  'legenda-social': () => ({ plataforma: 'instagram', texto: `${S} Legenda de exemplo (limite ${LIMITES_LEGENDA.instagram})`, chamadaParaAcao: `${S} Saiba mais`, hashtags: ['#simulado'] }),
  'plano-trafego': (p) => ({
    objetivo: `${S} ${curto(p)}`, publicos: [{ nome: 'Público a definir', descricao: `${S} Segmentação a validar` }], canais: ['meta'],
    estrategia: `${S} Estratégia a validar; nenhum valor ou resultado real foi usado.`,
    orcamentoSugerido: { valor: 0, moeda: 'BRL', periodo: 'mes', somenteSugestao: true },
    hipoteses: [{ descricao: `${S} Hipótese a testar`, metrica: 'a definir', evidencia: null }], indicadores: [{ nome: 'a definir' }],
  }),
  'documentacao-tecnica': (p) => ({
    titulo: `${S} Documentação`, objetivo: `${S} ${curto(p)}`, escopo: `${S} Escopo a validar`,
    componentes: [{ nome: 'componente-a', descricao: `${S} Componente a detalhar` }], dependencias: [], riscos: [], recomendacoes: [`${S} Revisar com o Super Admin`],
  }),
  'relatorio-tecnico': (p) => ({
    titulo: `${S} Relatório técnico`, contexto: `${S} Contexto: ${curto(p, 300)}`,
    decisoes: [{ decisao: `${S} Decisão a validar`, motivo: `${S} Motivo a validar` }], riscos: [], testes: [{ descricao: `${S} Teste a executar fora do sistema`, situacao: 'proposto' }],
  }),
};

const documentoSimulado = (documentoId, pedido) => (GERADORES[documentoId] ? GERADORES[documentoId](pedido) : null);

module.exports = { documentoSimulado, GERADORES, HASH_FICTICIO };
