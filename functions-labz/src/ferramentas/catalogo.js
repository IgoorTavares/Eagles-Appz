// Registro das ferramentas da LABZ AI. Na Fase 1 NENHUMA está disponível:
// as internas estão "planejadas" (chegam com o backend) e as externas estão
// "não configuradas" (dependem de conta, credencial e aprovação de terceiros).
// Nada aqui finge funcionar.
const TODOS = ['01-guia-marca', '02-designer', '03-carrosseis', '04-roteirista', '05-dev-web', '06-engenheiro', '07-trafego', '08-estrategista'];

const f = (id, nome, agentesAutorizados, operacoes, risco, exigeAprovacao, disponibilidade, dependeDe, capacidades, escopos, limites = { porExecucao: 20, porDia: 200 }) =>
  ({ id, nome, capacidades, agentesAutorizados, escopos, operacoes, risco, exigeAprovacao, limites, disponibilidade, dependeDe });

const FERRAMENTAS = [
  // internas (dependem só do backend da LABZ AI)
  f('memoria.consultar', 'Consultar memórias aprovadas', TODOS, ['ler'], 'baixo', false, 'planejada', ['backend LABZ AI (Fase 2)'],
    ['ler memórias aprovadas dos escopos permitidos ao agente'], ['memoria']),
  f('memoria.propor', 'Propor aprendizado', TODOS, ['criar'], 'baixo', true, 'planejada', ['backend LABZ AI (Fase 2)'],
    ['criar proposta de memória pendente (nunca vira regra sem aprovação)'], ['memoria']),
  f('entrega.salvar', 'Salvar arquivo entregue', TODOS, ['criar'], 'baixo', false, 'planejada', ['backend LABZ AI (Fase 2)', 'armazenamento de arquivos (Cloud Storage)'],
    ['guardar texto, JSON, imagem ou arquivo produzido na tarefa'], ['entregas']),
  f('tarefa.delegar', 'Delegar tarefa a um especialista', ['08-estrategista'], ['criar'], 'baixo', false, 'planejada', ['motor de orquestração (Fase 4)'],
    ['criar passo do plano para outro agente'], ['execucoes']),
  f('qualidade.auditar', 'Auditar entrega', ['01-guia-marca', '08-estrategista'], ['ler', 'alterar'], 'baixo', false, 'planejada', ['motor de orquestração (Fase 4)'],
    ['aprovar ou devolver uma entrega para correção'], ['execucoes']),
  f('crm.ler_cliente', 'Ler dados do cliente no CRM', ['01-guia-marca', '04-roteirista', '07-trafego', '08-estrategista'], ['ler'], 'medio', false, 'planejada', ['backend LABZ AI (Fase 2)', 'vínculo da empresa com o CRM'],
    ['ler o cadastro e o histórico do cliente vinculado (somente leitura, mínimo necessário)'], ['crm']),
  f('crm.enviar_conteudo', 'Enviar peça aprovada para Conteúdos', ['02-designer', '03-carrosseis', '04-roteirista'], ['criar'], 'alto', true, 'planejada', ['backend LABZ AI (Fase 2)', 'vínculo da empresa com o CRM'],
    ['criar um conteúdo no CRM a partir de uma entrega aprovada'], ['crm']),
  f('referencia.analisar', 'Analisar referência visual', ['01-guia-marca', '02-designer'], ['ler'], 'baixo', false, 'planejada', ['modelo com entrada de imagem (Fase 6)'],
    ['descrever cores, tipografia e composição de uma imagem de referência'], ['entregas']),
  f('imagem.gerar', 'Gerar imagem', ['02-designer', '03-carrosseis'], ['gastar', 'criar'], 'medio', false, 'nao-configurada', ['provedor de imagem com chave no servidor', 'limite de custo'],
    ['gerar imagem a partir de descrição'], ['entregas'], { porExecucao: 10, porDia: 50 }),
  f('render.peca', 'Renderizar peça ou carrossel', ['02-designer', '03-carrosseis'], ['criar'], 'baixo', false, 'nao-configurada', ['renderizador (decisão D6: navegador ou servidor)'],
    ['transformar layout (HTML/SVG) em imagem ou PDF'], ['entregas']),
  f('drive.ler_arquivos', 'Ler arquivos do Google Drive', ['01-guia-marca', '02-designer', '03-carrosseis'], ['ler'], 'medio', false, 'nao-configurada', ['integração Google Drive (OAuth, escopo mínimo)'],
    ['ler arquivos compartilhados de referência'], ['drive']),
  f('github.propor_mudanca', 'Propor mudança no GitHub', ['05-dev-web', '06-engenheiro'], ['criar'], 'alto', true, 'nao-configurada', ['GitHub App com permissão mínima por repositório'],
    ['abrir proposta de mudança (nunca grava direto na branch principal)'], ['github']),
  f('codigo.testar', 'Rodar testes em ambiente isolado', ['05-dev-web', '06-engenheiro'], ['criar'], 'alto', true, 'nao-configurada', ['ambiente isolado de execução (sandbox)'],
    ['executar testes de código gerado sem acesso a dados reais'], ['sandbox']),
  f('web.publicar', 'Publicar site', ['05-dev-web'], ['publicar'], 'alto', true, 'nao-configurada', ['serviço de hospedagem escolhido pelo Super Admin'],
    ['publicar um site aprovado'], ['hospedagem'], { porExecucao: 1, porDia: 5 }),
  f('meta.ler_metricas', 'Ler métricas da Meta', ['07-trafego'], ['ler'], 'medio', false, 'nao-configurada', ['plano Blaze', 'app da Meta aprovado', 'conexão da empresa'],
    ['ler métricas de perfil, posts e anúncios'], ['meta']),
  f('meta.publicar', 'Publicar ou agendar na Meta', ['07-trafego'], ['publicar'], 'alto', true, 'nao-configurada', ['plano Blaze', 'app da Meta aprovado', 'conexão da empresa'],
    ['publicar ou agendar post aprovado'], ['meta'], { porExecucao: 1, porDia: 10 }),
  f('google_ads.ler_metricas', 'Ler métricas do Google Ads', ['07-trafego'], ['ler'], 'medio', false, 'nao-configurada', ['conta de desenvolvedor Google Ads aprovada'],
    ['ler métricas de campanhas'], ['google_ads']),
  f('google_analytics.ler_metricas', 'Ler métricas do Google Analytics', ['07-trafego'], ['ler'], 'medio', false, 'nao-configurada', ['API de dados do GA com credencial de serviço'],
    ['ler acessos e conversões'], ['google_analytics']),
  f('pixel.checar', 'Checar pixel e eventos', ['07-trafego'], ['ler'], 'baixo', false, 'nao-configurada', ['acesso à API de eventos da Meta ou verificação de página'],
    ['conferir se o pixel e os eventos disparam'], ['meta']),
];

const porId = new Map(FERRAMENTAS.map((x) => [x.id, x]));
const obterFerramenta = (id) => porId.get(id) || null;

module.exports = { FERRAMENTAS, obterFerramenta };
