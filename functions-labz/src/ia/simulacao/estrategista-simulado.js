// Fase 4B: "Estrategista" SIMULADO. Imita o que um modelo faria ao planejar:
// lê o pedido e escolhe só os especialistas necessários (por palavras-chave),
// com dependências, critérios de conclusão e estimativa de consumo.
// NÃO decide nada: o plano que ele propõe é validado pelo backend
// (motor/validar-plano.js), exatamente como será o plano de um modelo real.
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Necessidades → especialista. A ordem define a ordem natural do trabalho.
const NECESSIDADES = [
  { id: 'marca', documento: 'diretrizes-marca', agenteId: '01-guia-marca', chaves: ['identidade visual', 'marca', 'branding', 'logo', 'posicionamento', 'tom de voz', 'manual'], objetivo: 'Definir ou revisar as diretrizes da marca (cores, tipografia, tom de voz e público) para este pedido', criterios: ['Diretrizes citam a fonte (briefing ou memória aprovada)', 'Cores com código e contraste conferido'] },
  { id: 'textos', documento: 'roteiro-reels', agenteId: '04-roteirista', chaves: ['roteiro', 'reels', 'legenda', 'copy', 'texto', 'post', 'anuncio', 'campanha', 'redes sociais', 'conteudo', 'landing'], objetivo: 'Escrever os textos, legendas e roteiros pedidos no tom de voz da marca', criterios: ['Tom de voz igual ao aprovado', 'Uma chamada para ação clara por peça'], depende: ['marca'] },
  // Fase 4C.2 (passo 5): legenda como documento PRÓPRIO quando o pedido diz "legendas para/de/no …" (o Roteirista faz roteiro e legenda)
  { id: 'legendas', documento: 'legenda-social', agenteId: '04-roteirista', chaves: ['legenda para', 'legendas para', 'legenda de', 'legendas de', 'legenda no', 'legendas no'], objetivo: 'Escrever as legendas das publicações no tom de voz da marca', criterios: ['Dentro do limite de caracteres da rede', 'Uma chamada para ação clara'], depende: ['marca', 'textos'] },
  { id: 'pecas', documento: 'briefing-design', agenteId: '02-designer', chaves: ['post', 'arte', 'peca', 'criativo', 'identidade visual', 'campanha', 'redes sociais', 'banner', 'visual'], objetivo: 'Criar as peças gráficas pedidas dentro da identidade da marca', criterios: ['Respeita o design system aprovado', 'Formato e resolução do destino corretos'], depende: ['marca', 'textos'] },
  { id: 'carrosseis', documento: 'estrutura-carrossel', agenteId: '03-carrosseis', chaves: ['carrossel', 'carrosseis'], objetivo: 'Montar os carrosséis pedidos, slide a slide', criterios: ['Gancho claro no primeiro slide', 'Último slide com chamada para ação'], depende: ['marca', 'textos'] },
  { id: 'landing', documento: 'documentacao-tecnica', agenteId: '05-dev-web', chaves: ['landing page', 'landing', 'site', 'pagina de vendas', 'pagina web'], objetivo: 'Construir a landing page pedida (arquivos), responsiva e acessível', criterios: ['Funciona em 320px sem rolar para o lado', 'Publicação só depois da aprovação do Super Admin'], depende: ['textos', 'pecas'] },
  { id: 'tecnico', documento: 'relatorio-tecnico', agenteId: '06-engenheiro', chaves: ['integracao', 'api', 'sistema', 'aplicativo', 'banco de dados', 'automacao', 'webhook', 'backend', 'formulario integrado'], objetivo: 'Planejar e construir a parte técnica pedida (integração, API ou sistema), com testes', criterios: ['Toda mudança acompanhada de testes', 'Nenhuma credencial no código'], depende: ['landing'] },
  { id: 'trafego', documento: 'plano-trafego', agenteId: '07-trafego', chaves: ['anuncio', 'anuncios', 'trafego', 'ads', 'campanha paga', 'impulsionar', 'orcamento de midia', 'meta ads', 'google ads'], objetivo: 'Planejar a campanha de anúncios (públicos, orçamento sugerido e testes), sem publicar nem gastar', criterios: ['Recomendações ligadas a evidências', 'Nunca altera verba nem publica sem aprovação'], depende: ['pecas', 'textos'] },
];
const ESTIMATIVA_POR_ETAPA = 6000; // tokens (estimativa simulada, não é medição)

function planoSimulado(objetivo) {
  const t = norm(objetivo);
  const escolhidas = NECESSIDADES.filter((n) => n.chaves.some((c) => t.includes(norm(c))));
  // "campanha" sozinha (sem anúncios) não chama o Gestor de Tráfego; "anúncio" chama.
  const lista = escolhidas.length ? escolhidas : [NECESSIDADES[1]]; // pedido genérico: só textos
  const ids = new Set(lista.map((n) => n.id));
  const etapas = lista.map((n) => ({
    id: n.id,
    agenteId: n.agenteId,
    objetivo: `${n.objetivo}. Pedido: ${String(objetivo).slice(0, 600)}`,
    dependeDe: (n.depende || []).filter((d) => ids.has(d)),
    criterios: n.criterios.slice(),
    estimativaTokens: ESTIMATIVA_POR_ETAPA,
    documento: n.documento, // Fase 4C.2: proposta; o backend confere catálogo e permissão
  }));
  return { resumo: `[SIMULADO] Plano com ${etapas.length} etapa(s): ${etapas.map((e) => e.agenteId).join(', ')}`, etapas };
}

module.exports = { planoSimulado, NECESSIDADES, ESTIMATIVA_POR_ETAPA };
