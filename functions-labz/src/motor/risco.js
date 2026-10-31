// Fase 4C.2 (passo 4): CLASSIFICAÇÃO DE RISCO das operações propostas pelos
// agentes. Decidida SÓ por regras do backend (catálogo de ferramentas + esta
// tabela): nada que o modelo escreva (nos parâmetros, no texto, num documento)
// muda a classificação. Usada nas aprovações de ação (o pedido leva o risco) e
// nos resultados (o que foi feito fica com a categoria).
//
// Nesta fase NENHUMA operação sensível é executada de verdade: o executor de
// ferramentas é simulado. As categorias de PROIBIDAS_NESTA_FASE continuam
// proibidas mesmo depois de aprovadas (só simulação, nunca execução real), e
// aprovar um DOCUMENTO não autoriza ação nenhuma citada nele: cada ação tem a
// própria aprovação, presa à ação exata.
const { obterFerramenta } = require('../ferramentas/catalogo');
const { CONSUMO } = require('../contratos/documentos');

// categoria por ferramenta (operação específica quando importa)
const CATEGORIAS = Object.freeze({
  'web.publicar': 'publicacao-site',
  'meta.publicar': 'publicacao-campanha',
  'github.propor_mudanca': 'alteracao-codigo',
  'codigo.testar': 'execucao-codigo',
  'imagem.gerar:gastar': 'custo-financeiro',
  'crm.enviar_conteudo': 'envio-externo',
  'drive.ler_arquivos': 'leitura-externa',
  'meta.ler_metricas': 'leitura-externa',
  'google_ads.ler_metricas': 'leitura-externa',
  'google_analytics.ler_metricas': 'leitura-externa',
  'pixel.checar': 'leitura-externa',
  'crm.ler_cliente': 'leitura-interna',
  'memoria.propor': 'proposta-interna',
});
// nível por categoria (as não listadas: risco do catálogo da ferramenta)
const NIVEL = Object.freeze({
  'publicacao-site': 'alto', 'publicacao-campanha': 'alto', 'alteracao-codigo': 'alto', 'execucao-codigo': 'alto',
  'custo-financeiro': 'alto', 'envio-externo': 'alto', 'alteracao-infraestrutura': 'alto', 'alteracao-administrativa': 'alto',
  'leitura-externa': 'medio', 'leitura-interna': 'baixo', 'proposta-interna': 'baixo', interna: 'baixo',
});
// nunca liberadas de verdade nesta fase (nem com aprovação): só simulação
const PROIBIDAS_NESTA_FASE = Object.freeze(['publicacao-site', 'publicacao-campanha', 'alteracao-codigo', 'execucao-codigo', 'custo-financeiro', 'envio-externo', 'alteracao-infraestrutura', 'alteracao-administrativa', 'leitura-externa']);
const ORDEM = { baixo: 0, medio: 1, alto: 2 };

// acao: { tipo: 'ferramenta', ferramentaId, operacao, parametros } (qualquer "risco" nos parâmetros é ignorado)
function classificarAcao(acao) {
  const f = acao && typeof acao.ferramentaId === 'string' ? obterFerramenta(acao.ferramentaId) : null;
  if (!f) return Object.freeze({ nivel: 'alto', categoria: 'desconhecida', exigeAprovacao: true, proibidaNestaFase: true, execucaoReal: false });
  const categoria = CATEGORIAS[`${f.id}:${acao.operacao}`] || CATEGORIAS[f.id] || (acao.operacao === 'publicar' ? 'publicacao-site' : acao.operacao === 'gastar' ? 'custo-financeiro' : 'interna');
  // o nível é o MAIOR entre o da categoria e o do catálogo (nunca diminui)
  const nCat = NIVEL[categoria] || 'alto';
  const nivel = ORDEM[f.risco] > ORDEM[nCat] ? f.risco : nCat;
  return Object.freeze({
    nivel, categoria,
    exigeAprovacao: !!f.exigeAprovacao || nivel === 'alto',
    proibidaNestaFase: PROIBIDAS_NESTA_FASE.includes(categoria),
    execucaoReal: false, // fase 4C.2: nenhuma ferramenta real
  });
}

// Documento: sensível (política do passo 3) = risco alto para o compartilhamento.
function classificarDocumento(documentoId) {
  const c = CONSUMO[documentoId];
  if (!c) return Object.freeze({ nivel: 'alto', sensivel: true, motivo: 'documento-desconhecido' });
  return Object.freeze({ nivel: c.sensivel ? 'alto' : 'baixo', sensivel: c.sensivel, motivo: c.sensivel ? 'exige-aprovacao-do-super-admin' : 'validacao-interna' });
}

module.exports = { classificarAcao, classificarDocumento, PROIBIDAS_NESTA_FASE, CATEGORIAS, NIVEL };
