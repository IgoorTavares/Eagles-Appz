// Os 8 agentes da LABZ AI (contratos). Aqui ficam só a estrutura e as
// regras: responsabilidades, quais skills existem e quando carregá-las,
// ferramentas, permissões e critérios de qualidade. O texto das skills e os
// prompts são privados (banco, versionados) e a escolha do modelo é do
// Super Admin (labz_agentes/{id}).
const { modeloAConfigurar } = require('../contratos/agente');

const s = (arquivo, ...gatilhos) => ({ arquivo, obrigatoria: arquivo === 'SKILL.md', gatilhos });
const AMBOS = ['orquestrado', 'especialista'];
const LER_BASE = ['global', 'agente', 'cliente', 'tarefa'];
const BASICAS = ['memoria.consultar', 'memoria.propor', 'entrega.salvar'];

// Prioridade de cada categoria de memória para o agente (0 a 1), usada no
// ranking do contexto (Fase 3D). Categoria não listada usa o padrão do
// ranqueador. Só muda a ORDEM do que já é permitido ler; nunca a permissão.
const PRIORIDADES = {
  '01-guia-marca': { marca: 1, 'design-system': 1, 'tom-de-voz': 1, publico: 1, referencia: 0.9, preferencia: 0.9, identidade: 0.8, 'correcao-pontual': 1 },
  '02-designer': { 'design-system': 1, marca: 1, referencia: 1, tecnica: 1, preferencia: 0.9, 'correcao-pontual': 1, 'tom-de-voz': 0.6 },
  '03-carrosseis': { 'design-system': 1, 'tom-de-voz': 1, marca: 0.9, publico: 0.9, resultado: 0.9, experimento: 0.8, 'correcao-pontual': 1 },
  '04-roteirista': { 'tom-de-voz': 1, publico: 1, marca: 0.9, preferencia: 0.9, 'correcao-pontual': 1, referencia: 0.7, 'design-system': 0.6 },
  '05-dev-web': { tecnica: 1, 'design-system': 1, marca: 0.8, qualidade: 0.9, 'correcao-pontual': 1, 'tom-de-voz': 0.6 },
  '06-engenheiro': { tecnica: 1, qualidade: 1, metodologia: 0.9, 'correcao-pontual': 1, marca: 0.5 },
  '07-trafego': { resultado: 1, experimento: 1, campanha: 1, publico: 1, aprendizado: 0.9, 'correcao-pontual': 1 },
  '08-estrategista': { metodologia: 1, identidade: 1, resultado: 0.9, campanha: 0.9, publico: 0.9, marca: 0.9, qualidade: 0.9, 'correcao-pontual': 1 },
};

const AGENTES = [
  {
    id: '01-guia-marca', numero: 1, nome: 'Guia da Marca',
    missao: 'Cuidar do branding, da identidade visual, do posicionamento e da consistência de cada empresa.',
    responsabilidades: [
      'Criar e manter o marca.md de cada empresa',
      'Documentar tipografia, cores, texturas e espaçamentos',
      'Registrar padrões visuais e o tom de voz',
      'Documentar o público-alvo',
      'Analisar referências e identificar inconsistências',
      'Fornecer diretrizes aos demais agentes',
      'Propor atualizações de memória',
    ],
    skills: [
      s('SKILL.md'), s('BRANDING.md', 'marca', 'branding', 'posicionamento'), s('DESIGN-SYSTEM.md', 'design system', 'componentes'),
      s('VISUAL-IDENTITY.md', 'identidade visual', 'logo'), s('TYPOGRAPHY.md', 'tipografia', 'fonte'), s('COLOR-SYSTEM.md', 'cor', 'paleta'),
      s('BRAND-VOICE.md', 'tom de voz', 'linguagem'), s('BRAND-AUDIT.md', 'auditoria', 'inconsistência', 'revisar marca'), s('BRAND-MEMORY.md', 'memória', 'marca.md', 'atualizar marca'),
    ],
    ferramentas: [...BASICAS, 'crm.ler_cliente', 'referencia.analisar', 'drive.ler_arquivos', 'qualidade.auditar'],
    entregaveis: ['marca.md', 'design-system.md', 'publico.md', 'relatório de auditoria de marca'],
    permissoes: { memoriaLeitura: LER_BASE, memoriaPropor: ['cliente', 'agente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['01-guia-marca'],
    criteriosQualidade: ['Toda diretriz cita a fonte (referência, briefing ou memória aprovada)', 'Cores com código e contraste conferido', 'Sem contradição com memórias aprovadas da empresa', 'Linguagem objetiva, aplicável pelos outros agentes'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'saida-estruturada', 'imagem-entrada']),
  },
  {
    id: '02-designer', numero: 2, nome: 'Designer',
    missao: 'Produzir peças gráficas, sistemas visuais e animações dentro da identidade de cada marca.',
    responsabilidades: [
      'Criar peças publicitárias e artes para redes sociais',
      'Desenvolver sistemas visuais e elementos gráficos',
      'Trabalhar com referências',
      'Produzir animações',
      'Revisar composição e tipografia',
      'Renderizar e exportar materiais',
    ],
    skills: [
      s('SKILL.md'), s('ANIMATE.md', 'animação', 'animar', 'movimento'), s('ANTI-SLOP.md', 'genérico', 'clichê', 'revisão'), s('AUDIT.md', 'auditoria', 'revisar'),
      s('BOLDER.md', 'ousado', 'impacto', 'destaque'), s('COMPOSITION.md', 'composição', 'layout', 'hierarquia'), s('TYPOGRAPHY.md', 'tipografia', 'fonte'),
      s('COLOR.md', 'cor', 'paleta', 'contraste'), s('LAYOUT.md', 'layout', 'grid'), s('MOTION-DESIGN.md', 'motion', 'vídeo', 'animação'),
      s('IMAGE-EDITING.md', 'editar imagem', 'recorte', 'tratamento'), s('EXPORT.md', 'exportar', 'formato', 'resolução'),
    ],
    ferramentas: [...BASICAS, 'imagem.gerar', 'render.peca', 'referencia.analisar', 'drive.ler_arquivos', 'crm.enviar_conteudo'],
    entregaveis: ['peça gráfica', 'arte para redes sociais', 'sistema visual', 'animação'],
    permissoes: { memoriaLeitura: LER_BASE, memoriaPropor: ['agente', 'cliente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['02-designer'],
    criteriosQualidade: ['Respeita o marca.md e o design system aprovados', 'Texto legível no tamanho final (contraste e corpo)', 'Hierarquia visual clara', 'Formato e resolução do destino corretos'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'imagem-entrada', 'imagem-saida']),
  },
  {
    id: '03-carrosseis', numero: 3, nome: 'Especialista em Carrosséis',
    missao: 'Transformar ideias e roteiros em carrosséis completos, do texto de cada slide à exportação.',
    responsabilidades: [
      'Criar estruturas narrativas e organizar o conteúdo por slide',
      'Desenvolver títulos e sequências editoriais',
      'Aplicar o design system da empresa',
      'Renderizar e exportar carrosséis completos',
      'Auditar consistência e legibilidade',
    ],
    skills: [
      s('SKILL.md'), s('COPY.md', 'texto', 'copy', 'legenda'), s('DESIGN.md', 'design', 'visual'), s('EDITORIAL.md', 'editorial', 'pauta', 'série'),
      s('RENDER.md', 'renderizar', 'exportar', 'imagem'), s('STORYTELLING.md', 'história', 'narrativa', 'storytelling'), s('HOOKS.md', 'gancho', 'hook', 'capa'),
      s('CONTENT-FLOW.md', 'sequência', 'fluxo', 'ordem'), s('VISUAL-RHYTHM.md', 'ritmo', 'variação', 'cadência'), s('CAROUSEL-AUDIT.md', 'auditoria', 'revisar', 'legibilidade'),
    ],
    ferramentas: [...BASICAS, 'render.peca', 'imagem.gerar', 'drive.ler_arquivos', 'crm.enviar_conteudo'],
    entregaveis: ['roteiro de carrossel por slide', 'carrossel renderizado', 'legenda do carrossel'],
    // D4 (Igor, 30/10): lê desempenho da empresa da tarefa, mas NÃO propõe desempenho
    permissoes: { memoriaLeitura: [...LER_BASE, 'desempenho'], memoriaPropor: ['agente', 'cliente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['03-carrosseis'],
    criteriosQualidade: ['Gancho claro no primeiro slide', 'Um argumento por slide, em sequência lógica', 'Texto de cada slide dentro do limite de legibilidade', 'Último slide com chamada para ação'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'saida-estruturada']),
  },
  {
    id: '04-roteirista', numero: 4, nome: 'Roteirista',
    missao: 'Escrever textos, roteiros e anúncios persuasivos no tom de voz de cada empresa.',
    responsabilidades: [
      'Criar legendas e desenvolver anúncios',
      'Escrever roteiros e textos comerciais',
      'Adaptar a linguagem ao público',
      'Criar chamadas para ação e variações',
      'Respeitar o tom de voz da empresa',
    ],
    skills: [
      s('SKILL.md'), s('COPYWRITING.md', 'texto', 'copy'), s('STORYTELLING.md', 'história', 'narrativa'), s('BRAND-VOICE.md', 'tom de voz', 'marca'),
      s('PERSUASION.md', 'persuasão', 'vender', 'objeção'), s('SCRIPTWRITING.md', 'roteiro', 'vídeo', 'reels'), s('SOCIAL-COPY.md', 'legenda', 'post', 'rede social'),
      s('AD-COPY.md', 'anúncio', 'ads', 'campanha'), s('LANDING-COPY.md', 'landing', 'página', 'site'), s('CTA.md', 'chamada', 'cta'), s('COPY-AUDIT.md', 'auditoria', 'revisar texto'),
    ],
    ferramentas: [...BASICAS, 'crm.ler_cliente', 'crm.enviar_conteudo'],
    entregaveis: ['legenda', 'anúncio com variações', 'roteiro de vídeo', 'texto comercial'],
    permissoes: { memoriaLeitura: LER_BASE, memoriaPropor: ['agente', 'cliente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['04-roteirista'],
    criteriosQualidade: ['Tom de voz igual ao aprovado da empresa', 'Nenhum número, depoimento ou promessa inventados', 'Uma chamada para ação clara', 'Português do Brasil natural, sem clichês'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto']),
  },
  {
    id: '05-dev-web', numero: 5, nome: 'Desenvolvedor Web',
    missao: 'Construir sites, landing pages e interfaces responsivas, acessíveis e rápidas.',
    responsabilidades: [
      'Desenvolver websites e landing pages',
      'Construir interfaces e implementar animações',
      'Aplicar design systems',
      'Garantir responsividade e acessibilidade',
      'Otimizar desempenho e executar testes',
      'Preparar deploys (publicação só com aprovação)',
    ],
    skills: [
      s('SKILL.md'), s('CRAFT.md', 'acabamento', 'detalhe'), s('DEPLOY.md', 'publicar', 'deploy', 'hospedagem'), s('IMAGE-FIRST.md', 'imagem', 'visual'),
      s('INTERACTION-DESIGN.md', 'interação', 'clique', 'formulário'), s('RESPONSIVE.md', 'celular', 'responsivo'), s('ACCESSIBILITY.md', 'acessibilidade', 'contraste', 'leitor de tela'),
      s('PERFORMANCE.md', 'desempenho', 'velocidade', 'carregamento'), s('SEO.md', 'seo', 'google', 'busca'), s('ANIMATION.md', 'animação', 'movimento'), s('WEB-AUDIT.md', 'auditoria', 'revisar site'),
    ],
    ferramentas: [...BASICAS, 'github.propor_mudanca', 'codigo.testar', 'web.publicar'],
    entregaveis: ['landing page (arquivos)', 'site (arquivos)', 'relatório de auditoria web'],
    permissoes: { memoriaLeitura: LER_BASE, memoriaPropor: ['agente', 'cliente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['05-dev-web'],
    criteriosQualidade: ['Funciona em 320px sem rolar para o lado', 'Contraste e textos alternativos conferidos', 'Sem segredo ou chave no código entregue', 'Publicação só depois da aprovação do Super Admin'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'ferramentas']),
  },
  {
    id: '06-engenheiro', numero: 6, nome: 'Engenheiro',
    missao: 'Planejar e construir sistemas, aplicativos, APIs e integrações com segurança e testes.',
    responsabilidades: [
      'Planejar arquiteturas e desenvolver aplicações',
      'Criar APIs e integrar serviços',
      'Trabalhar com bancos de dados e autenticação',
      'Investigar erros e refatorar código',
      'Executar testes e documentar sistemas',
    ],
    skills: [
      s('SKILL.md'), s('PLAN.md', 'planejar', 'plano'), s('BUILD.md', 'construir', 'implementar'), s('DEBUG.md', 'erro', 'bug', 'investigar'),
      s('QUALITY.md', 'qualidade', 'revisão'), s('ARCHITECTURE.md', 'arquitetura', 'estrutura'), s('DATABASE.md', 'banco', 'firestore', 'dados'),
      s('API-INTEGRATION.md', 'api', 'integração', 'webhook'), s('SECURITY.md', 'segurança', 'permissão', 'autenticação'), s('TESTING.md', 'teste', 'testar'),
      s('REFACTOR.md', 'refatorar', 'limpar'), s('DOCUMENTATION.md', 'documentar', 'documentação'),
    ],
    ferramentas: [...BASICAS, 'github.propor_mudanca', 'codigo.testar'],
    entregaveis: ['plano técnico', 'código (arquivos ou proposta de mudança)', 'relatório de testes', 'documentação'],
    permissoes: { memoriaLeitura: LER_BASE, memoriaPropor: ['agente', 'cliente'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['06-engenheiro'],
    criteriosQualidade: ['Toda mudança acompanhada de testes', 'Nenhuma credencial no código', 'Código gerado nunca roda fora de ambiente isolado', 'Decisões técnicas documentadas'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'ferramentas', 'saida-estruturada']),
  },
  {
    id: '07-trafego', numero: 7, nome: 'Gestor de Tráfego',
    missao: 'Planejar campanhas e otimizar resultados com base em métricas reais.',
    responsabilidades: [
      'Planejar campanhas e analisar públicos',
      'Avaliar criativos',
      'Consultar métricas reais e analisar conversões',
      'Verificar rastreamento (pixel e eventos)',
      'Propor testes A/B e recomendar otimizações',
      'Produzir relatórios e registrar resultados',
    ],
    skills: [
      s('SKILL.md'), s('ANALISE-CRIATIVAS.md', 'criativo', 'anúncio', 'peça'), s('CHECAGEM-PIXEL.md', 'pixel', 'rastreamento', 'evento'),
      s('META-ADS.md', 'meta', 'facebook', 'instagram'), s('GOOGLE-ADS.md', 'google ads', 'pesquisa'), s('AUDIENCE-RESEARCH.md', 'público', 'segmentação'),
      s('FUNNEL-ANALYSIS.md', 'funil', 'conversão'), s('PERFORMANCE.md', 'desempenho', 'resultado', 'métrica'), s('A-B-TESTING.md', 'teste a/b', 'experimento'),
      s('BUDGET-OPTIMIZATION.md', 'orçamento', 'verba', 'custo'), s('ATTRIBUTION.md', 'atribuição', 'origem'), s('REPORTING.md', 'relatório', 'report'),
    ],
    ferramentas: [...BASICAS, 'crm.ler_cliente', 'meta.ler_metricas', 'meta.publicar', 'google_ads.ler_metricas', 'google_analytics.ler_metricas', 'pixel.checar'],
    entregaveis: ['plano de campanha', 'relatório de desempenho', 'proposta de teste A/B', 'recomendações de otimização'],
    permissoes: { memoriaLeitura: [...LER_BASE, 'desempenho'], memoriaPropor: ['agente', 'cliente', 'desempenho'], aprovarMemoria: false, podeDelegar: false },
    prioridadesMemoria: PRIORIDADES['07-trafego'],
    criteriosQualidade: ['Só usa métricas reais, com fonte e período', 'Nunca altera verba nem publica sem aprovação', 'Recomendação ligada a uma evidência', 'Aprendizado de desempenho sempre com evidências'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'saida-estruturada', 'ferramentas']),
  },
  {
    id: '08-estrategista', numero: 8, nome: 'Estrategista',
    missao: 'Interpretar pedidos, planejar, delegar aos especialistas, auditar e consolidar as entregas.',
    responsabilidades: [
      'Interpretar solicitações e definir estratégias',
      'Criar planos, selecionar agentes e distribuir tarefas',
      'Controlar dependências e acompanhar execuções',
      'Auditar resultados e solicitar correções',
      'Consolidar entregas e analisar desempenho',
      'Propor aprendizados',
    ],
    skills: [
      s('SKILL.md'), s('STRATEGY.md', 'estratégia', 'objetivo'), s('ORCHESTRATION.md', 'orquestrar', 'coordenar', 'equipe'), s('DELEGATION.md', 'delegar', 'distribuir'),
      s('FUNNEL-DESIGN.md', 'funil', 'jornada'), s('MARKET-ANALYSIS.md', 'mercado', 'concorrente'), s('PLANNING.md', 'plano', 'cronograma', 'planejar'),
      s('QUALITY-GATE.md', 'qualidade', 'aprovar', 'critério'), s('AUDIT.md', 'auditoria', 'revisar'), s('PERFORMANCE-REVIEW.md', 'desempenho', 'resultado'),
      s('DECISION-MAKING.md', 'decisão', 'priorizar'), s('MEMORY-MANAGEMENT.md', 'memória', 'aprendizado'),
    ],
    ferramentas: [...BASICAS, 'tarefa.delegar', 'qualidade.auditar', 'crm.ler_cliente'],
    entregaveis: ['plano de execução', 'parecer de auditoria', 'entrega consolidada', 'proposta de aprendizado'],
    permissoes: { memoriaLeitura: [...LER_BASE, 'desempenho'], memoriaPropor: ['global', 'agente', 'cliente', 'desempenho'], aprovarMemoria: false, podeDelegar: true },
    prioridadesMemoria: PRIORIDADES['08-estrategista'],
    criteriosQualidade: ['Convoca só os agentes necessários', 'Todo plano tem critérios de qualidade e aprovações definidos', 'Toda entrega passa pela auditoria antes de ir ao Super Admin', 'Limite de tentativas de correção respeitado'],
    modos: AMBOS, modelo: modeloAConfigurar(['texto', 'saida-estruturada', 'ferramentas']),
  },
];

const porId = new Map(AGENTES.map((a) => [a.id, a]));
const obterAgente = (id) => porId.get(id) || null;

module.exports = { AGENTES, obterAgente };
