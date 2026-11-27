/* =====================================================================
   Investimentos · EAGLES DATA ENGINE — dados REAIS (Etapa 11)
   Funções puras + um carregador para o navegador (window.INVEST.dados) e para o Node (require).
   - FONTES: cada fonte com a licença, a evidência consultada e o modo de acesso. Só as APROVADAS ligam.
   - Leitores validados: SGS e Olinda (Banco Central), curva diária do Tesouro dos EUA (CSV), RSS/Atom.
   - Registro padronizado (id, ticker, nome, classe, mercado, bolsa, moeda, valor, unidade, fonte,
     data de referência, data de coleta, frequência, estado, licença, versão).
   - O carregador busca DIRETO das fontes oficiais que permitem leitura pelo navegador (CORS) e guarda um
     cache local com prazo; arquivos que não abrem no navegador vêm prontos em inv/dados/ (robô).
   - Nada aqui inventa número: sem dado válido, o estado é "indisponível".
   ===================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { raiz.INVEST = raiz.INVEST || {}; raiz.INVEST.dados = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSAO = '11.0';
  const CONSULTA = '2026-11-26'; // data em que as licenças abaixo foram consultadas

  // ---------- central de licenças (11.2) ----------
  // estado: aprovada | aprovada-condicoes | aguardando | incompativel | indisponivel
  // modo: navegador (lê direto, CORS liberado) | arquivo (vem pronto em inv/dados/, gerado pelo robô) | catalogo | nenhum
  const ODBL = 'Open Data Commons Open Database License (ODbL) — uso comercial e redistribuição permitidos com atribuição; base derivada publicada deve continuar sob ODbL';
  const FONTES = {
    bcb_sgs: { nome: 'Banco Central do Brasil — SGS (séries temporais)', site: 'https://dadosabertos.bcb.gov.br/', api: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json', licenca: ODBL, evidencia: 'Registro CKAN de cada série no portal dadosabertos.bcb.gov.br (ex.: 432 Meta Selic, 1 Dólar venda): license_id odc-odbl', atribuicao: 'Fonte: Banco Central do Brasil — SGS', estado: 'aprovada-condicoes', modo: 'navegador', cors: true, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 6 * 3600, frequencia: 'diária (dias úteis) / mensal, conforme a série' },
    bcb_ptax: { nome: 'Banco Central do Brasil — PTAX (Olinda)', site: 'https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios', api: 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/', licenca: ODBL, evidencia: 'Registro CKAN "dolar-americano-usd-todos-os-boletins-diarios": odc-odbl', atribuicao: 'Fonte: Banco Central do Brasil — PTAX', estado: 'aprovada-condicoes', modo: 'navegador', cors: true, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 3600, frequencia: 'boletins diários (dias úteis)' },
    bcb_focus: { nome: 'Banco Central do Brasil — Boletim Focus (expectativas de mercado)', site: 'https://dadosabertos.bcb.gov.br/dataset/expectativas-mercado', api: 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/', licenca: ODBL, evidencia: 'Registro CKAN "expectativas-mercado": odc-odbl', atribuicao: 'Fonte: Banco Central do Brasil — Sistema Expectativas de Mercado (Focus)', estado: 'aprovada-condicoes', modo: 'navegador', cors: true, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 12 * 3600, frequencia: 'semanal (Focus) / diária (base)' },
    tesouro_direto: { nome: 'Tesouro Transparente — preços e taxas do Tesouro Direto', site: 'https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto', api: 'CSV PrecoTaxaTesouroDireto.csv (14,7 MB)', licenca: ODBL, evidencia: 'Registro CKAN "taxas-dos-titulos-ofertados-pelo-tesouro-direto": odc-odbl', atribuicao: 'Fonte: Tesouro Nacional — Tesouro Transparente', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 6 * 3600, frequencia: 'base atualizada pelo Tesouro com alguns dias de defasagem' },
    cvm: { nome: 'CVM — Dados Abertos (cadastro de companhias, FII, fundos)', site: 'https://dados.cvm.gov.br/', api: 'Arquivos CSV/ZIP do portal', licenca: ODBL, evidencia: 'Registros CKAN cia_aberta-cad, cia_aberta-doc-dfp, cia_aberta-doc-itr, fii-doc-inf_mensal, fi-cad: odc-odbl', atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Portal de Dados Abertos', estado: 'aprovada-condicoes', modo: 'catalogo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'diária (cadastro) / trimestral (demonstrações)' },
    ust_curva: { nome: 'U.S. Department of the Treasury — Daily Treasury Par Yield Curve Rates', site: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', api: 'CSV daily-treasury-rates.csv (ano corrente)', licenca: 'Obra do governo federal dos EUA (17 U.S.C. §105, sem direito autoral) — citar a fonte', evidencia: 'Lei americana de direito autoral; página de políticas do site sem texto de licença legível pelo robô (confirmar)', atribuicao: 'Source: U.S. Department of the Treasury', estado: 'aprovada-condicoes', modo: 'navegador', cors: true, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 6 * 3600, frequencia: 'diária (dias úteis dos EUA)' },
    fiscaldata: { nome: 'U.S. Treasury — Fiscal Data (taxas médias da dívida)', site: 'https://fiscaldata.treasury.gov/', api: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/', licenca: 'Dados abertos: "copy, adapt, redistribute, or otherwise use for non-commercial and commercial purposes"', evidencia: 'fiscaldata.treasury.gov/about-us — seção Licensing', atribuicao: 'Source: U.S. Treasury, Bureau of the Fiscal Service', estado: 'aprovada', modo: 'nenhum', motivo: 'Aprovada; não usada nesta versão (os juros dos EUA vêm da curva diária do Tesouro)', cors: true, chave: false, cadastro: false, custo: 'R$ 0', ttlSeg: 24 * 3600, frequencia: 'mensal' },
    noticias_fed: { nome: 'Federal Reserve — press releases (RSS)', site: 'https://www.federalreserve.gov/feeds/', api: 'https://www.federalreserve.gov/feeds/press_all.xml', licenca: 'Domínio público ("may be copied and distributed without permission"), citar o Board', evidencia: 'federalreserve.gov/disclaimer.htm — Copyright/trademark', atribuicao: 'Fonte: Board of Governors of the Federal Reserve System', estado: 'aprovada', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'conforme publicação' },
    noticias_sec: { nome: 'SEC — press releases (RSS)', site: 'https://www.sec.gov/news/pressreleases', api: 'https://www.sec.gov/news/pressreleases.rss', licenca: 'Obra do governo federal dos EUA (domínio público); acesso automático deve seguir o Fair Access (identificação do robô)', evidencia: 'Política de acesso da SEC (página de limite de requisições)', atribuicao: 'Fonte: U.S. Securities and Exchange Commission', estado: 'aprovada-condicoes', modo: 'nenhum', motivo: 'Condição pendente: e-mail de contato da empresa para identificar o robô (Fair Access da SEC)', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'conforme publicação' },
    noticias_cvm: { nome: 'CVM — notícias (gov.br)', site: 'https://www.gov.br/cvm/pt-br/assuntos/noticias', api: 'página de notícias gov.br', licenca: 'Creative Commons Atribuição-SemDerivações 3.0 (título original, sem alteração, com link e atribuição)', evidencia: 'Rodapé de www.gov.br/cvm: "Todo o conteúdo deste site está publicado sob a licença CC BY-ND 3.0"', atribuicao: 'Fonte: CVM — gov.br', estado: 'aprovada-condicoes', modo: 'nenhum', motivo: 'O gov.br não oferece RSS em formato legível para esta seção (respondeu HTML); sem raspagem de página', cors: false, chave: false, cadastro: false, custo: 'R$ 0' },
    noticias_bcb: { nome: 'Banco Central — notas à imprensa (Atom)', site: 'https://www.bcb.gov.br/', api: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notasImprensa', licenca: 'Termos de uso do site do BC não legíveis pelo robô (erro 400)', evidencia: '—', estado: 'aguardando', modo: 'arquivo', motivo: 'Confirmar os termos de reprodução do conteúdo do site (não dos dados abertos)', custo: 'R$ 0' },
    ibge: { nome: 'IBGE — SIDRA e API de agregados', site: 'https://servicodados.ibge.gov.br/', api: 'https://apisidra.ibge.gov.br/ · servicodados.ibge.gov.br/api/v3/agregados', licenca: 'Termos não legíveis pelo robô (proteção anti-robô no site)', evidencia: '—', estado: 'aguardando', modo: 'navegador', cors: true, motivo: 'Confirmar os termos de uso do IBGE (o IPCA já vem do Banco Central, sob ODbL)', custo: 'R$ 0' },
    sec_edgar: { nome: 'SEC EDGAR — catálogo dos EUA e fundamentos (XBRL)', site: 'https://www.sec.gov/os/accessing-edgar-data', api: 'company_tickers_exchange.json · data.sec.gov/api/xbrl/companyfacts', licenca: 'Obra do governo federal dos EUA (domínio público); acesso automático com identificação do robô (Fair Access, até 10 req/s)', evidencia: 'Política de acesso da SEC; resposta 403 sem identificação', atribuicao: 'Source: U.S. Securities and Exchange Commission — EDGAR', estado: 'aprovada-condicoes', modo: 'arquivo', motivo: 'O robô só coleta com o segredo SEC_CONTACT_EMAIL configurado no GitHub (o contato nunca vai para o site)', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'diária (robô) · fundamentos anuais (10-K)' },
    bls: { nome: 'U.S. Bureau of Labor Statistics — Public Data API v2', site: 'https://www.bls.gov/developers/', api: 'api.bls.gov/publicAPI/v2', licenca: 'Domínio público (obra do governo dos EUA); v2 exige chave gratuita', evidencia: 'Páginas de termos responderam "Access Denied" ao robô', estado: 'aguardando', modo: 'nenhum', motivo: 'Complementar: a inflação e o emprego dos EUA já vêm do FRED (mesmos números do BLS, sem consulta duplicada). Fica de reserva se o FRED falhar', custo: 'R$ 0' },
    fred: { nome: 'FRED® — Federal Reserve Bank of St. Louis', site: 'https://fred.stlouisfed.org/docs/api/terms_of_use.html', api: 'api.stlouisfed.org/fred/series/observations (com chave) · fredgraph.csv (sem chave)', licenca: 'Séries usadas marcadas "Public Domain: Citation Requested"; citar o órgão de origem "via FRED"; proibido sugerir endosso e usar para treinar IA', evidencia: 'Página de cada uma das 13 séries (aba Notes/Copyright) e termos de uso do FRED, lidos em 26/11/2026', atribuicao: 'Fonte: órgão de origem via FRED®, Federal Reserve Bank of St. Louis', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'diária (robô) · séries mensais e trimestrais' },
    coingecko: { nome: 'CoinGecko (criptomoedas)', site: 'https://www.coingecko.com/en/api_terms', api: 'api.coingecko.com/api/v3', licenca: 'Não utilizada (decisão do Igor nesta etapa)', evidencia: '—', estado: 'indisponivel', modo: 'nenhum', motivo: 'Decisão do Igor: não usar a CoinGecko', custo: 'R$ 0' },
    coinbase: { nome: 'Coinbase Exchange — preços públicos', site: 'https://www.coinbase.com/legal/user_agreement', api: 'api.exchange.coinbase.com/products/{par}/ticker', licenca: 'Termos de uso de dados de mercado não legíveis pelo robô (403/desafio anti-robô)', evidencia: 'API responde com CORS liberado; termos inacessíveis', estado: 'aguardando', modo: 'nenhum', motivo: 'Confirmar por escrito se os preços podem ser exibidos num sistema comercial', custo: 'R$ 0' },
    kraken: { nome: 'Kraken — preços públicos', site: 'https://www.kraken.com/legal', api: 'api.kraken.com/0/public/Ticker', licenca: 'Termos não legíveis pelo robô', evidencia: 'API responde; termos inacessíveis (desafio anti-robô)', estado: 'aguardando', modo: 'nenhum', motivo: 'Confirmar a licença dos dados de mercado', custo: 'R$ 0' },
    binance: { nome: 'Binance — preços públicos', site: 'https://www.binance.com/en/terms', api: 'api.binance.com/api/v3/ticker/price', licenca: '—', evidencia: 'Resposta 451 (bloqueio por região)', estado: 'indisponivel', modo: 'nenhum', motivo: 'A API bloqueia o acesso desta região (HTTP 451)', custo: 'R$ 0' },
    mercado_bitcoin: { nome: 'Mercado Bitcoin — preços públicos', site: 'https://www.mercadobitcoin.com.br/', api: 'api.mercadobitcoin.net/api/v4/tickers', licenca: '—', evidencia: 'Resposta 403 ao robô', estado: 'aguardando', modo: 'nenhum', motivo: 'API recusou o acesso (403) e os termos não foram lidos', custo: 'R$ 0' },
    brapi: { nome: 'brapi (cotações da B3 com atraso)', site: 'https://brapi.dev/pricing', api: 'brapi.dev/api/quote', licenca: 'Plano gratuito "para validar a integração com dados e ativos de teste"; uso comercial só nos planos pagos (FAQ); página de termos com erro 404', evidencia: 'brapi.dev/pricing e FAQ lidos em 26/11/2026', estado: 'incompativel', modo: 'nenhum', motivo: 'O plano gratuito não permite uso comercial; desligada em produção (sem contratar plano pago)', custo: 'gratuito só para teste' },
    google_finance: { nome: 'Google Finance', site: 'https://www.google.com/finance/', api: '— (sem API)', licenca: 'Aviso do Google: os dados não podem ser copiados, guardados ou redistribuídos, nem usados comercialmente, sem consentimento por escrito', evidencia: 'Aviso legal das páginas do Google Finance, lido em 26/11/2026', estado: 'incompativel', modo: 'nenhum', motivo: 'Só como link que a pessoa abre ("Ver cotação e gráfico no Google Finance"); o sistema não lê nada de lá', custo: 'R$ 0' },
    tradingview: { nome: 'TradingView — gráfico gratuito para sites (Advanced Real-Time Chart)', site: 'https://www.tradingview.com/widget-docs/', api: 'www.tradingview-widget.com/embed-widget/advanced-chart (janela incorporada)', licenca: 'Widget gratuito "para incorporar em qualquer site"; a atribuição do TradingView deve ficar como foi desenhada (políticas, item de atribuição)', evidencia: 'widget-docs (Advanced Chart: "free ... to easily embed in any website") e tradingview.com/policies (atribuição), lidos em 26/11/2026', atribuicao: 'Gráfico por TradingView', estado: 'aprovada-condicoes', modo: 'incorporado', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'ao vivo no gráfico (B3 e EUA com 15 min de atraso)' },
    // v160 (Etapa 12): fontes novas, com a licença conferida uma a uma (evidências no pacote da v160)
    cvm_fundos: { nome: 'CVM — Cadastro de Fundos e Informe Diário (cotas, PL, captação, resgate, cotistas)', site: 'https://dados.cvm.gov.br/dataset/fi-doc-inf_diario', api: 'registro_fundo_classe.zip + inf_diario_fi_AAAAMM.zip', licenca: ODBL, evidencia: 'Registros CKAN fi-cad e fi-doc-inf_diario: license_id odc-odbl (conferido em 26–27/11/2026)', atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Portal de Dados Abertos', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'diária (cota D-1); cadastro diário', condicao: 'Servido pelo repositório de dados (eagles-dados), com a base derivada aberta sob ODbL' },
    cvm_fii: { nome: 'CVM — Informe Mensal de FII (PL, VPA, cotistas)', site: 'https://dados.cvm.gov.br/dataset/fii-doc-inf_mensal', api: 'inf_mensal_fii_AAAA.zip', licenca: ODBL, evidencia: 'Registro CKAN fii-doc-inf_mensal: license_id odc-odbl', atribuicao: 'Contém dados da Comissão de Valores Mobiliários (CVM) — Informe Mensal de FII', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'mensal', condicao: 'VPA é valor patrimonial, nunca cotação' },
    eia_fred: { nome: 'EIA via FRED® — petróleo WTI e Brent (preço à vista)', site: 'https://fred.stlouisfed.org/series/DCOILWTICO', api: 'fredgraph.csv (DCOILWTICO, DCOILBRENTEU)', licenca: 'Domínio público — "Public Domain: Citation Requested" em cada série; EIA: obra do governo dos EUA', evidencia: 'Páginas das séries no FRED e termos da EIA (27/11/2026). Gás natural Henry Hub DESLIGADO: a EIA atribui o preço à Refinitiv (LSEG)', atribuicao: 'Fonte: U.S. Energy Information Administration via FRED®', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'diária (dias úteis)' },
    cambio_int: { nome: 'Câmbio internacional — BCE, Fed H.10 e Banco do Canadá', site: 'https://data.ecb.europa.eu/', api: 'data-api.ecb.europa.eu (EXR) · fredgraph.csv (DEX*) · bankofcanada.ca/valet', licenca: 'BCE: reutilização gratuita, inclusive comercial, citando a fonte; Fed H.10: domínio público; Banco do Canadá: uso livre com atribuição', evidencia: 'Política de uso do BCE, páginas das séries no FRED e termos do Banco do Canadá (27/11/2026)', atribuicao: 'Fontes: Banco Central Europeu; Federal Reserve (H.10) via FRED®; Bank of Canada', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'dias úteis' },
    worldbank: { nome: 'Banco Mundial — World Development Indicators', site: 'https://datacatalog.worldbank.org/search/dataset/0037712', api: 'api.worldbank.org/v2', licenca: 'CC BY 4.0 (conferida no metadado de CADA indicador: License_Type)', evidencia: 'Catálogo do WDI e metadados dos 8 indicadores (27/11/2026)', atribuicao: 'Fonte: Banco Mundial — World Development Indicators (CC BY 4.0)', estado: 'aprovada-condicoes', modo: 'arquivo', cors: false, chave: false, cadastro: false, custo: 'R$ 0', frequencia: 'anual (revisado pela fonte)' },
    b3: { nome: 'B3 — market data (índices e cotações)', site: 'https://www.b3.com.br/pt_br/market-data-e-indices/', api: 'licença de market data', licenca: 'Licença comercial paga de market data', evidencia: 'Política comercial da B3', estado: 'incompativel', modo: 'nenhum', motivo: 'Exige contrato pago (orçamento R$ 0)', custo: 'pago' },
  };
  // Opção B: endereço do repositório SÓ DE DADOS (vazio = o próprio site). Trocar exige nova versão do sistema e a liberação
  // do endereço na política de segurança (CSP) do investimentos.html; um endereço fora do padrão é ignorado.
  const DADOS_BASE_CONFIG = '';
  // v160: eagles-dados v2 (manifesto.json na raiz + snapshots imutáveis). Só https e só hospedagens previstas; vazio = desligado.
  const DADOS_BASE = /^https:\/\/([a-z0-9-]+\.github\.io\/[a-z0-9._-]+|[a-z0-9-]+\.(web\.app|firebaseapp\.com))\/$/i.test(DADOS_BASE_CONFIG) ? DADOS_BASE_CONFIG : '';
  const ligada = (id) => !!(FONTES[id] && (FONTES[id].estado === 'aprovada' || FONTES[id].estado === 'aprovada-condicoes') && FONTES[id].modo !== 'nenhum');

  // ---------- séries do Banco Central usadas (códigos oficiais do SGS) ----------
  // unidade: %aa (ao ano), %am (no mês), % (acumulado em 12 meses / taxa), BRL (reais por unidade), BRL_MI (R$ milhões)
  const SERIES_BCB = {
    SELIC: { sgs: 432, nome: 'Taxa Selic — meta (Copom)', unidade: '%aa', periodicidade: 'meta vigente', grupo: 'Juros', fonte: 'bcb_sgs', prazoDias: 10 },
    SELICEF: { sgs: 1178, nome: 'Taxa Selic efetiva (anualizada, base 252)', unidade: '%aa', periodicidade: 'diária', grupo: 'Juros', fonte: 'bcb_sgs', prazoDias: 7 },
    CDI: { sgs: 4389, nome: 'CDI (anualizado, base 252)', unidade: '%aa', periodicidade: 'diária', grupo: 'Juros', fonte: 'bcb_sgs', prazoDias: 7 },
    IPCA: { sgs: 433, nome: 'IPCA — variação no mês', unidade: '%am', periodicidade: 'mensal', grupo: 'Inflação', fonte: 'bcb_sgs', prazoDias: 75 },
    IPCA12M: { sgs: 13522, nome: 'IPCA — acumulado em 12 meses', unidade: '%', periodicidade: 'mensal', grupo: 'Inflação', fonte: 'bcb_sgs', prazoDias: 75 },
    IGPM: { sgs: 189, nome: 'IGP-M — variação no mês', unidade: '%am', periodicidade: 'mensal', grupo: 'Inflação', fonte: 'bcb_sgs', prazoDias: 75 },
    USDBRL: { sgs: 1, nome: 'Dólar comercial — venda (SGS 1, taxa livre)', unidade: 'BRL', periodicidade: 'diária', grupo: 'Câmbio', fonte: 'bcb_sgs', prazoDias: 7 },
    EURBRL: { sgs: 21619, nome: 'Euro — venda (SGS 21619)', unidade: 'BRL', periodicidade: 'diária', grupo: 'Câmbio', fonte: 'bcb_sgs', prazoDias: 7 },
    DESEMPREGO: { sgs: 24369, nome: 'Taxa de desocupação (PNAD Contínua, trimestre móvel)', unidade: '%', periodicidade: 'mensal (trimestre móvel)', grupo: 'Atividade', fonte: 'bcb_sgs', prazoDias: 120 },
    PIBMENSAL: { sgs: 4380, nome: 'PIB mensal — valores correntes', unidade: 'BRL_MI', periodicidade: 'mensal', grupo: 'Atividade', fonte: 'bcb_sgs', prazoDias: 120 },
  };
  // vencimentos da curva americana usados nos cartões
  const CURVA_UST = { UST3M: '3 Mo', UST2Y: '2 Yr', UST5Y: '5 Yr', UST10Y: '10 Yr', UST30Y: '30 Yr' };

  // ---------- utilidades ----------
  const dataValida = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [a, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  const brParaIso = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); if (!m) return null; const iso = `${m[3]}-${m[2]}-${m[1]}`; return dataValida(iso) ? iso : null; };
  const usParaIso = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); if (!m) return null; const iso = `${m[3]}-${m[1]}-${m[2]}`; return dataValida(iso) ? iso : null; };
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const limparTexto = (s, max) => String(s == null ? '' : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
  const linkSeguro = (u) => { const s = String(u || '').trim(); return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(s) ? s : ''; };

  // ---------- leitores (parsers) validados ----------
  // SGS: [{data:'dd/mm/aaaa', valor:'x'}] → pontos {data, valor} ordenados, SÓ até "hoje" (a Meta Selic publica datas futuras)
  function lerSGS(json, hoje) {
    if (!Array.isArray(json)) throw new Error('SGS: resposta não é uma lista');
    const out = [];
    for (const p of json) {
      const data = brParaIso(p && p.data); const valor = num(p && p.valor);
      if (!data || valor === null) continue;
      if (hoje && data > hoje) continue;
      out.push({ data, valor });
    }
    out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const dedup = []; for (const p of out) { if (dedup.length && dedup[dedup.length - 1].data === p.data) dedup[dedup.length - 1] = p; else dedup.push(p); }
    return dedup;
  }
  // PTAX (Olinda): CotacaoDolarPeriodo → último boletim de fechamento (tipoBoletim "Fechamento" quando houver)
  function lerPTAX(json, hoje) {
    const v = json && Array.isArray(json.value) ? json.value : null; if (!v) throw new Error('PTAX: formato inesperado');
    const pts = v.map((x) => ({ dataHora: String(x.dataHoraCotacao || ''), compra: num(x.cotacaoCompra), venda: num(x.cotacaoVenda), tipo: x.tipoBoletim || 'Fechamento' }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x.dataHora) && x.venda > 0 && x.compra > 0 && (!hoje || x.dataHora.slice(0, 10) <= hoje));
    if (!pts.length) return null;
    pts.sort((a, b) => (a.dataHora < b.dataHora ? -1 : 1));
    const ult = pts[pts.length - 1];
    return { data: ult.dataHora.slice(0, 10), horario: ult.dataHora.replace(' ', 'T').slice(0, 19), compra: ult.compra, venda: ult.venda, boletim: ult.tipo };
  }
  // Focus: ExpectativasMercadoAnuais → { 'IPCA': { 2026: {mediana, data, respondentes}, ... }, ... } usando a data mais recente de cada indicador
  function lerFocus(json) {
    const v = json && Array.isArray(json.value) ? json.value : null; if (!v) throw new Error('Focus: formato inesperado');
    const out = {};
    for (const x of v) {
      const ind = String(x.Indicador || ''); const ano = String(x.DataReferencia || ''); const med = num(x.Mediana); const data = String(x.Data || '').slice(0, 10);
      if (!ind || !/^\d{4}$/.test(ano) || med === null || !dataValida(data)) continue;
      out[ind] = out[ind] || {};
      const atual = out[ind][ano];
      if (!atual || data > atual.data) out[ind][ano] = { mediana: med, data, respondentes: num(x.numeroRespondentes) };
    }
    return out;
  }
  // Curva diária do Tesouro dos EUA (CSV do ano): cabeçalho Date,"1 Mo",... → [{data, taxas:{'10 Yr': 4.85,...}}]
  function lerCurvaUST(texto, hoje) {
    const linhas = String(texto || '').split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) throw new Error('Curva UST: arquivo vazio');
    const cab = linhas[0].split(',').map((c) => c.replace(/"/g, '').trim());
    if (cab[0] !== 'Date' || !cab.includes('10 Yr')) throw new Error('Curva UST: colunas inesperadas');
    const out = [];
    for (const l of linhas.slice(1)) {
      const c = l.split(','); const data = usParaIso(c[0]); if (!data || (hoje && data > hoje)) continue;
      const taxas = {}; cab.slice(1).forEach((k, i) => { const n = num(c[i + 1]); if (n !== null && n >= -5 && n <= 50) taxas[k] = n; });
      if (Object.keys(taxas).length) out.push({ data, taxas });
    }
    out.sort((a, b) => (a.data < b.data ? -1 : 1));
    return out;
  }
  // RSS 2.0 ou Atom → itens {titulo, link, data, fonte}; texto ORIGINAL (sem reescrever), sem HTML, link só https
  function lerFeed(xml, fonte, max) {
    const t = String(xml || ''); const itens = [];
    const blocos = t.match(/<item[\s>][\s\S]*?<\/item>/gi) || t.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const b of blocos) {
      const tag = (n) => { const m = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(b); return m ? m[1] : ''; };
      const titulo = limparTexto(tag('title'), 240);
      let link = limparTexto(tag('link'), 500);
      if (!link) { const m = /<link[^>]*href="([^"]+)"/i.exec(b); link = m ? m[1] : ''; }
      link = linkSeguro(link.replace(/^https:\/(?!\/)/, 'https://'));
      const quando = limparTexto(tag('pubDate') || tag('updated') || tag('published') || tag('dc:date'), 60);
      const ms = Date.parse(quando);
      if (!titulo || !link || !Number.isFinite(ms)) continue;
      itens.push({ titulo, link, data: new Date(ms).toISOString(), fonte });
    }
    itens.sort((a, b) => (a.data < b.data ? 1 : -1));
    return itens.slice(0, max || 30);
  }

  // ---------- estado do dado conforme a idade ----------
  function estadoPelaIdade(dataRef, hoje, prazoDias) {
    if (!dataRef) return 'indisponivel';
    if (!hoje) return 'fechamento';
    return diasEntre(dataRef, hoje) > (prazoDias || 7) ? 'desatualizado' : 'fechamento';
  }

  // ---------- registro padronizado (11.8) ----------
  function registro(o) {
    const F = FONTES[o.fonte] || {};
    return {
      id: o.id, ticker: o.ticker || o.id, nome: o.nome, classe: o.classe || 'macro', mercado: o.mercado || 'BR', bolsa: o.bolsa || 'MACRO',
      moeda: o.moeda || '', valor: o.valor, unidade: o.unidade || '', fonte: o.fonte, fonteNome: F.nome || o.fonte, atribuicao: F.atribuicao || '',
      dataRef: o.dataRef, dataColeta: o.dataColeta, horario: o.horario || (o.dataRef ? o.dataRef + 'T00:00:00' : null), frequencia: o.frequencia || F.frequencia || '',
      estado: o.estado, licenca: F.licenca || '', licencaEstado: F.estado || '', versao: VERSAO, serie: o.serie || null, extra: o.extra || null,
    };
  }

  // FRED (arquivo do robô inv/dados/macro-us.json) → indicadores dos EUA no sistema. A MEDIDA já vem calculada pelo robô
  // (inflação em % de 12 meses a partir do índice; nunca o nível do índice como taxa).
  const FRED_MAPA = {
    DFF: { id: 'FEDFUNDS', nome: 'Fed Funds — taxa efetiva (diária)' }, CPIAUCSL: { id: 'CPI12M', nome: 'Inflação ao consumidor (CPI) — 12 meses' },
    CPILFESL: { id: 'CORECPI12M', nome: 'Núcleo do CPI (sem alimentos e energia) — 12 meses' }, UNRATE: { id: 'UNRATE', nome: 'Taxa de desemprego' },
    PAYEMS: { id: 'PAYROLL', nome: 'Empregos criados no mês (payroll)' }, GDPC1: { id: 'GDPREAL', nome: 'PIB real — trimestre anualizado' },
    GDP: { id: 'GDPNOM12M', nome: 'PIB nominal — 12 meses' }, INDPRO: { id: 'INDPRO12M', nome: 'Produção industrial — 12 meses' },
    PCE: { id: 'PCE12M', nome: 'Consumo das famílias (PCE) — 12 meses' }, DSPIC96: { id: 'RENDA12M', nome: 'Renda disponível real — 12 meses' },
    HOUST: { id: 'HOUST', nome: 'Novas moradias iniciadas (anualizado)' }, M2SL: { id: 'M212M', nome: 'Oferta monetária M2 — 12 meses' },
  };
  function lerMacroUS(j, hoje) {
    if (!j || j.formato !== 'eagles-inv-macro-us-v1' || !j.series || typeof j.series !== 'object') return null;
    const out = {};
    for (const [sid, m] of Object.entries(FRED_MAPA)) {
      const x = j.series[sid]; if (!x || !Number.isFinite(x.valor) || !/^\d{4}-\d{2}-\d{2}$/.test(x.dataRef || '') || x.dataRef > hoje) continue;
      const hist = Array.isArray(x.historico) ? x.historico.filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.data) && Number.isFinite(p.valor) && p.data <= hoje) : [];
      out[m.id] = { serie: sid, nome: m.nome, valor: x.valor, unidade: ['%', '%aa', 'MIL'].includes(x.unidade) ? x.unidade : '%', dataRef: x.dataRef, frequencia: String(x.frequencia || '').slice(0, 20), atribuicao: limparTexto(x.atribuicao || '', 160), historico: hist, extra: x.extra && Number.isFinite(x.extra.valor) ? { medida: String(x.extra.medida).slice(0, 20), valor: x.extra.valor, dataRef: String(x.extra.dataRef || '').slice(0, 10) } : null };
    }
    return Object.keys(out).length ? { coleta: String(j.coleta || '').slice(0, 30), itens: out } : null;
  }

  // ---------- v160: energia (EIA via FRED), câmbio internacional e macro internacional ----------
  const num6 = (v) => (Number.isFinite(v) ? v : null);
  function lerEnergia(j, hoje) {
    if (!j || j.formato !== 'eagles-inv-energia-v1' || !j.series || typeof j.series !== 'object') return null;
    const out = {};
    for (const [id, x] of Object.entries(j.series)) { if (!/^[A-Z_]{2,12}$/.test(id) || !x || !Number.isFinite(x.valor) || !dataValida(x.dataRef) || x.dataRef > hoje) continue;
      out[id] = { id, nome: limparTexto(x.nome, 90), unidade: limparTexto(x.unidade, 30), moeda: x.moeda === 'USD' ? 'USD' : '', valor: x.valor, dataRef: x.dataRef, tipoReferencia: limparTexto(x.tipoReferencia, 140), atribuicao: limparTexto(x.atribuicao, 140), historico: (x.historico || []).filter((p) => Array.isArray(p) && dataValida(p[0]) && p[0] <= hoje && Number.isFinite(p[1])) }; }
    const desligadas = {}; for (const [k, v] of Object.entries(j.desligadas || {})) if (/^[A-Z_]{2,12}$/.test(k)) desligadas[k] = limparTexto(v, 200);
    return Object.keys(out).length || Object.keys(desligadas).length ? { coleta: String(j.coleta || '').slice(0, 30), series: out, desligadas } : null;
  }
  const MOEDA = /^[A-Z]{3}$/;
  function lerCambioInt(j, hoje) {
    if (!j || j.formato !== 'eagles-inv-cambio-int-v1' || !j.pares || typeof j.pares !== 'object') return null;
    const pares = {};
    for (const [k, x] of Object.entries(j.pares)) { if (!/^[A-Z]{6}:(bce|h10|boc)$/.test(k) || !x || !MOEDA.test(x.base) || !MOEDA.test(x.cotada) || !(x.valor > 0) || !dataValida(x.dataRef) || x.dataRef > hoje) continue;
      pares[k] = { base: x.base, cotada: x.cotada, valor: x.valor, dataRef: x.dataRef, fonte: k.split(':')[1], tipo: ['referencia', 'compra', 'media'].includes(x.tipo) ? x.tipo : 'referencia', tipoTexto: limparTexto(x.tipoTexto, 160), atribuicao: limparTexto(x.atribuicao, 140), historico: (x.historico || []).filter((p) => Array.isArray(p) && dataValida(p[0]) && p[0] <= hoje && p[1] > 0) }; }
    const conferencias = (j.conferencias || []).slice(0, 10).map((c) => ({ teste: limparTexto(c.teste, 120), data: dataValida(c.data) ? c.data : '', difPct: num6(c.difPct), ok: c.ok === true }));
    return Object.keys(pares).length ? { coleta: String(j.coleta || '').slice(0, 30), pares, conferencias, nota: limparTexto(j.nota, 240) } : null;
  }
  function lerMacroInt(j) {
    if (!j || j.formato !== 'eagles-inv-macro-int-v1' || !j.paises || typeof j.paises !== 'object') return null;
    const paises = {};
    for (const [p, x] of Object.entries(j.paises)) { if (!/^[A-Z]{3}$/.test(p) || !x || !x.indicadores) continue; const ind = {};
      for (const [k, i] of Object.entries(x.indicadores)) if (/^[A-Z_]{2,20}$/.test(k) && i && /^\d{4}$/.test(i.ano) && Number.isFinite(i.valor)) ind[k] = { nome: limparTexto(i.nome, 80), unidade: limparTexto(i.unidade, 40), ano: i.ano, valor: i.valor, revisao: dataValida(i.revisao) ? i.revisao : '', serie: (i.serie || []).filter((s) => Array.isArray(s) && /^\d{4}$/.test(s[0]) && Number.isFinite(s[1])) };
      paises[p] = { nome: limparTexto(x.nome, 40), indicadores: ind }; }
    const licencas = {}; for (const [k, l] of Object.entries(j.licencas || {})) if (/^[A-Z_]{2,20}$/.test(k)) licencas[k] = { licenca: limparTexto(l.licenca, 40), fonteOriginal: limparTexto(l.fonteOriginal, 200) };
    return Object.keys(paises).length ? { coleta: String(j.coleta || '').slice(0, 30), paises, licencas, atribuicao: limparTexto(j.atribuicao, 140) } : null;
  }

  // catálogo dos EUA (robô, a partir do company_tickers_exchange.json da SEC): só código, nome, bolsa e CIK
  const BOLSAS_US = { Nasdaq: 'NASDAQ', NYSE: 'NYSE', CBOE: 'CBOE' };
  function lerCatalogoUS(j) {
    if (!j || j.formato !== 'eagles-inv-catalogo-us-v1' || !Array.isArray(j.itens)) return null;
    const out = [];
    for (const x of j.itens.slice(0, 20000)) {
      const bolsa = BOLSAS_US[x && x.bolsa]; const tk = String((x && x.ticker) || '').toUpperCase();
      if (!bolsa || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk) || !(Number(x.cik) > 0)) continue;
      out.push({ ticker: tk, nome: limparTexto(x.nome || tk, 120), bolsa, cik: String(Number(x.cik)) });
    }
    return out.length ? out : null;
  }

  // monta o retrato (snapshot) a partir das respostas brutas — PURO (os testes chamam direto)
  function montarRetrato(bruto, op) {
    const hoje = op.hoje; const coleta = op.coleta || new Date().toISOString();
    const reg = {}; const series = {};
    for (const [tk, S] of Object.entries(SERIES_BCB)) {
      const pts = bruto.sgs && bruto.sgs[tk];
      if (!pts || !pts.length) continue;
      const ult = pts[pts.length - 1];
      series[`BR:MACRO:${tk}`] = pts;
      reg[`BR:MACRO:${tk}`] = registro({ id: `BR:MACRO:${tk}`, ticker: tk, nome: S.nome, mercado: 'BR', moeda: S.unidade === 'BRL' ? 'BRL' : '', valor: ult.valor, unidade: S.unidade, fonte: S.fonte, dataRef: ult.data, dataColeta: coleta, frequencia: S.periodicidade, estado: estadoPelaIdade(ult.data, hoje, S.prazoDias), serie: `SGS ${S.sgs}` });
    }
    if (bruto.ptax) {
      const p = bruto.ptax;
      reg['BR:MACRO:PTAX'] = registro({ id: 'BR:MACRO:PTAX', ticker: 'PTAX', nome: 'Dólar PTAX — venda (Banco Central)', mercado: 'BR', moeda: 'BRL', valor: p.venda, unidade: 'BRL', fonte: 'bcb_ptax', dataRef: p.data, horario: p.horario, dataColeta: coleta, estado: estadoPelaIdade(p.data, hoje, 7), extra: { compra: p.compra, boletim: p.boletim } });
    }
    if (bruto.focus) reg['BR:FOCUS'] = { id: 'BR:FOCUS', fonte: 'bcb_focus', fonteNome: FONTES.bcb_focus.nome, atribuicao: FONTES.bcb_focus.atribuicao, expectativas: bruto.focus, dataColeta: coleta, estado: 'fechamento', tipo: 'expectativa' };
    if (bruto.macroUS) {
      for (const [id, x] of Object.entries(bruto.macroUS.itens)) {
        const aid = `US:MACRO:${id}`;
        series[aid] = x.historico;
        const r = registro({ id: aid, ticker: id, nome: x.nome, mercado: 'US', valor: x.valor, unidade: x.unidade, fonte: 'fred', dataRef: x.dataRef, dataColeta: bruto.macroUS.coleta || coleta, frequencia: x.frequencia, estado: estadoPelaIdade(x.dataRef, hoje, x.frequencia === 'diária' ? 7 : x.frequencia === 'trimestral' ? 200 : 80), extra: x.extra, serie: x.serie });
        r.atribuicao = x.atribuicao || r.atribuicao; reg[aid] = r;
      }
    }
    if (bruto.ust && bruto.ust.length) {
      const ult = bruto.ust[bruto.ust.length - 1];
      for (const [tk, col] of Object.entries(CURVA_UST)) {
        if (ult.taxas[col] == null) continue;
        series[`US:MACRO:${tk}`] = bruto.ust.filter((d) => d.taxas[col] != null).map((d) => ({ data: d.data, valor: d.taxas[col] }));
        reg[`US:MACRO:${tk}`] = registro({ id: `US:MACRO:${tk}`, ticker: tk, nome: `Treasury ${col.replace(' Yr', ' anos').replace(' Mo', ' meses')} (taxa par)`, mercado: 'US', valor: ult.taxas[col], unidade: '%aa', fonte: 'ust_curva', dataRef: ult.data, dataColeta: coleta, frequencia: 'diária', estado: estadoPelaIdade(ult.data, hoje, 7) });
      }
    }
    return { versao: VERSAO, coleta, hoje, registros: reg, series };
  }

  // ---------- adaptadores para o Market Engine (contrato: cotacao(a) → {preco,data,horario,estado} | null; historico(a) → [{data,fechamento}]) ----------
  function criarAdaptadorRetrato(retrato, fontes) {
    const reg0 = (retrato && retrato.registros) || {}; const ser = (retrato && retrato.series) || {};
    // cada provedor responde só pelos registros das SUAS fontes (o rótulo da fonte na tela fica certo)
    const reg = fontes ? Object.fromEntries(Object.entries(reg0).filter(([, r]) => r && fontes.includes(r.fonte))) : reg0;
    const idDe = (a) => (a.assetId === 'BR:MACRO:USDBRL' && reg['BR:MACRO:PTAX'] ? 'BR:MACRO:PTAX' : a.assetId); // o dólar do sistema é a PTAX quando disponível
    return {
      cotacao(a) {
        const r = reg[idDe(a)]; if (!r || !(r.valor > -1000) || r.valor === null) return null;
        const pts = ser[a.assetId]; const ant = pts && pts.length > 1 ? pts[pts.length - 2].valor : null;
        return { preco: r.valor, fechamentoAnterior: ant, data: r.dataRef, horario: r.horario, estado: r.estado === 'desatualizado' ? 'desatualizado' : 'fechamento', fonteOriginal: r.fonte, dataColeta: r.dataColeta };
      },
      historico(a) { const pts = ser[a.assetId]; return pts && pts.length ? pts.map((p) => ({ data: p.data, fechamento: p.valor, abertura: p.valor, maxima: p.valor, minima: p.valor, volume: 0 })) : null; },
    };
  }
  // Tesouro Direto: arquivo inv/dados/tesouro.json → { dataBase, titulos: { 'SELIC-2027': { puCompra, puVenda, puBase, taxaCompra, taxaVenda, historico:[[data, puBase]] } } }
  function criarAdaptadorTesouro(arq, hoje) {
    const t = (arq && arq.titulos) || {};
    return {
      cotacao(a) {
        if (a.classe !== 'tesouro') return null;
        const x = t[a.ticker]; if (!x || !(x.puBase > 0 || x.puVenda > 0)) return null;
        const h = x.historico || []; const ant = h.length > 1 ? h[h.length - 2][1] : null;
        // Avaliação da carteira = PU de VENDA (o que o Tesouro paga no resgate antecipado, BRUTO: antes de IR, IOF e taxas).
        // Sem PU de venda no dia, usa o PU BASE, marcado como "referência" (não é valor de resgate). O PU de compra nunca avalia carteira.
        const venda = x.puVenda > 0;
        return { preco: venda ? x.puVenda : x.puBase, tipoPreco: venda ? 'pu-venda' : 'pu-base', fechamentoAnterior: !venda || x.puVenda === x.puBase ? ant : null, // variação só entre preços do mesmo tipo (o histórico é do PU base)
          data: arq.dataBase, horario: arq.dataBase + 'T00:00:00', estado: estadoPelaIdade(arq.dataBase, hoje, 10) === 'desatualizado' ? 'desatualizado' : 'fechamento', fonteOriginal: 'tesouro_direto',
          detalhe: { puCompra: x.puCompra > 0 ? x.puCompra : null, puVenda: venda ? x.puVenda : null, puBase: x.puBase > 0 ? x.puBase : null, taxaCompra: x.taxaCompra, taxaVenda: x.taxaVenda, dataBase: arq.dataBase, historico: 'PU base (referência diária do Tesouro)' } };
      },
      historico(a) { if (a.classe !== 'tesouro') return null; const x = t[a.ticker]; return x && x.historico && x.historico.length ? x.historico.map(([d, v]) => ({ data: d, fechamento: v, abertura: v, maxima: v, minima: v, volume: 0 })) : null; },
    };
  }

  // ---------- carregador (navegador) ----------
  // op: { fetch, armazenamento (localStorage), agora: () => ms, hoje: 'AAAA-MM-DD', base: '' (url do site), timeoutMs, desligadas: {fonte:true} }
  function criarCarregador(op) {
    const f = op.fetch; const arm = op.armazenamento || null; const agora = op.agora || (() => Date.now());
    const timeoutMs = op.timeoutMs || 12000; const PREFIXO = 'eagles_inv_dados_v1:';
    const status = {}; const emVoo = new Map();
    const st = (id) => (status[id] = status[id] || { fonte: id, requisicoes: 0, erros: 0, ultimaOk: null, ultimoErro: '', latenciaMs: null, registros: 0, doCache: 0 });
    const lerCache = (k) => { try { const s = arm && arm.getItem(PREFIXO + k); if (!s) return null; const o = JSON.parse(s); return o && o.ate > agora() ? o.valor : null; } catch (e) { return null; } };
    const gravarCache = (k, valor, ttl) => { try { if (arm) arm.setItem(PREFIXO + k, JSON.stringify({ ate: agora() + ttl * 1000, valor })); } catch (e) { /* cheio ou bloqueado: segue sem cache */ } };
    async function buscar(fonteId, chave, url, tipo, ttl, ler) {
      const S = st(fonteId);
      if (op.desligadas && op.desligadas[fonteId]) { S.ultimoErro = 'desligada pelo Super Admin nesta sessão'; return null; }
      const c = lerCache(chave); if (c !== null) { S.doCache++; return c; }
      if (emVoo.has(chave)) return emVoo.get(chave); // deduplicação: uma requisição por dado, mesmo com várias telas pedindo
      const p = (async () => {
        const t0 = agora(); S.requisicoes++;
        let ctl = null, tmr = null;
        try {
          if (typeof AbortController !== 'undefined') { ctl = new AbortController(); tmr = setTimeout(() => ctl.abort(), timeoutMs); }
          const r = await f(url, { signal: ctl ? ctl.signal : undefined, headers: tipo === 'json' ? { Accept: 'application/json' } : {} });
          if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
          const corpo = tipo === 'json' ? await r.json() : await r.text();
          const v = ler(corpo);
          S.latenciaMs = agora() - t0; S.ultimaOk = new Date(agora()).toISOString(); S.ultimoErro = '';
          gravarCache(chave, v, ttl);
          return v;
        } catch (e) {
          S.erros++; S.ultimoErro = e && e.name === 'AbortError' ? `sem resposta em ${Math.round(timeoutMs / 1000)} s` : String((e && e.message) || e).slice(0, 160);
          return null;
        } finally { if (tmr) clearTimeout(tmr); emVoo.delete(chave); }
      })();
      emVoo.set(chave, p); return p;
    }
    const ddmmaaaa = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const mmddaaaa = (iso) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
    const menosDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

    async function carregarTudo() {
      const hoje = op.hoje;
      const bruto = { sgs: {} };
      const tarefas = [];
      // Banco Central — SGS (uma requisição por série; janela pequena de dias para as diárias e 13 meses para as mensais)
      if (ligada('bcb_sgs')) {
        for (const [tk, S] of Object.entries(SERIES_BCB)) {
          const janela = /mensal/.test(S.periodicidade) ? 400 : S.periodicidade === 'meta vigente' ? 400 : 400;
          const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${S.sgs}/dados?formato=json&dataInicial=${ddmmaaaa(menosDias(hoje, janela))}&dataFinal=${ddmmaaaa(hoje)}`;
          tarefas.push(buscar('bcb_sgs', `sgs:${S.sgs}:${hoje}`, url, 'json', FONTES.bcb_sgs.ttlSeg, (j) => lerSGS(j, hoje)).then((v) => { if (v && v.length) { bruto.sgs[tk] = v; st('bcb_sgs').registros++; } }));
        }
      }
      if (ligada('bcb_ptax')) {
        const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${mmddaaaa(menosDias(hoje, 10))}'&@dataFinalCotacao='${mmddaaaa(hoje)}'&$format=json`;
        tarefas.push(buscar('bcb_ptax', `ptax:${hoje}`, url, 'json', FONTES.bcb_ptax.ttlSeg, (j) => lerPTAX(j, hoje)).then((v) => { if (v) { bruto.ptax = v; st('bcb_ptax').registros = 1; } }));
      }
      if (ligada('bcb_focus')) {
        const ano = Number(hoje.slice(0, 4));
        const filtro = encodeURIComponent(`(Indicador eq 'IPCA' or Indicador eq 'Selic' or Indicador eq 'PIB Total' or Indicador eq 'Câmbio') and baseCalculo eq 0 and Data ge '${menosDias(hoje, 21)}' and (DataReferencia eq '${ano}' or DataReferencia eq '${ano + 1}')`);
        const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$filter=${filtro}&$select=Indicador,Data,DataReferencia,Mediana,numeroRespondentes&$format=json&$top=200`;
        tarefas.push(buscar('bcb_focus', `focus:${hoje}`, url, 'json', FONTES.bcb_focus.ttlSeg, lerFocus).then((v) => { if (v && Object.keys(v).length) { bruto.focus = v; st('bcb_focus').registros = Object.keys(v).length; } }));
      }
      if (ligada('ust_curva')) {
        const ano = hoje.slice(0, 4);
        const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${ano}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${ano}&page&_format=csv`;
        tarefas.push(buscar('ust_curva', `ust:${hoje}`, url, 'text', FONTES.ust_curva.ttlSeg, (t) => lerCurvaUST(t, hoje)).then((v) => { if (v && v.length) { bruto.ust = v; st('ust_curva').registros = v.length; } }));
      }
      // arquivos prontos (gerados pelo robô a partir das fontes que não abrem no navegador).
      // Opção B: o manifesto diz a VERSÃO do conjunto; todos os arquivos são pedidos com a mesma versão (conjunto coerente,
      // troca "atômica" para quem lê). Sem manifesto válido, cada arquivo vale pelo próprio formato (compatível com a v159).
      const base = op.base != null && op.base !== '' ? op.base : DADOS_BASE;
      if (leitorV2()) { await carregarDoEaglesDados(bruto, tarefas, hoje); await Promise.all(tarefas); const r = montarRetrato(bruto, { hoje, coleta: new Date(agora()).toISOString() }); return Object.assign(r, { tesouro: bruto.tesouro || null, noticias: bruto.noticias || null, catalogoUS: bruto.catalogoUS || null, manifesto: bruto.manifesto || null, energia: bruto.energia || null, cambioInt: bruto.cambioInt || null, macroInt: bruto.macroInt || null, eaglesDados: true }); }
      const man = await buscar('manifesto', `arq:manifesto:${hoje}:${Math.floor(agora() / 3600000)}`, base + 'inv/dados/manifesto.json', 'json', 3600, (j) => (j && j.formato === 'eagles-inv-manifesto-v1' && /^\d{8,14}$/.test(String(j.versao)) && j.arquivos && typeof j.arquivos === 'object' ? { versao: String(j.versao), coleta: String(j.coleta || '').slice(0, 30), arquivos: Object.keys(j.arquivos) } : null));
      const v = man ? '?v=' + man.versao : '';
      bruto.manifesto = man;
      tarefas.push(buscar('tesouro_direto', `arq:tesouro:${hoje}${v}`, base + 'inv/dados/tesouro.json' + v, 'json', 6 * 3600, (j) => (j && j.titulos ? j : null)).then((v) => { if (v) { bruto.tesouro = v; st('tesouro_direto').registros = Object.keys(v.titulos).length; } }));
      tarefas.push(buscar('noticias_fed', `arq:noticias:${hoje}${v}`, base + 'inv/dados/noticias.json' + v, 'json', 1800, (j) => (j && Array.isArray(j.itens) ? j : null)).then((v) => { if (v) { bruto.noticias = v; st('noticias_fed').registros = v.itens.length; } }));
      if (ligada('fred')) tarefas.push(buscar('fred', `arq:macro-us:${hoje}${v}`, base + 'inv/dados/macro-us.json' + v, 'json', 3 * 3600, (j) => lerMacroUS(j, hoje)).then((v) => { if (v) { bruto.macroUS = v; st('fred').registros = Object.keys(v.itens).length; } }));
      if (ligada('sec_edgar')) tarefas.push(buscar('sec_edgar', `arq:catalogo-us:${hoje}${v}`, base + 'inv/dados/catalogo-us.json' + v, 'json', 12 * 3600, lerCatalogoUS).then((v) => { if (v) { bruto.catalogoUS = v; st('sec_edgar').registros = v.length; } }));
      // v160: energia, câmbio internacional e macro internacional (arquivos pequenos do robô, no site)
      if (ligada('eia_fred')) tarefas.push(buscar('eia_fred', `arq:energia:${hoje}${v}`, base + 'inv/dados/energia.json' + v, 'json', 6 * 3600, (j) => lerEnergia(j, hoje)).then((x) => { if (x) { bruto.energia = x; st('eia_fred').registros = Object.keys(x.series).length; } }));
      if (ligada('cambio_int')) tarefas.push(buscar('cambio_int', `arq:cambio-int:${hoje}${v}`, base + 'inv/dados/cambio-int.json' + v, 'json', 6 * 3600, (j) => lerCambioInt(j, hoje)).then((x) => { if (x) { bruto.cambioInt = x; st('cambio_int').registros = Object.keys(x.pares).length; } }));
      if (ligada('worldbank')) tarefas.push(buscar('worldbank', `arq:macro-int:${hoje}${v}`, base + 'inv/dados/macro-int.json' + v, 'json', 24 * 3600, lerMacroInt).then((x) => { if (x) { bruto.macroInt = x; st('worldbank').registros = Object.keys(x.paises).length; } }));
      await Promise.all(tarefas);
      const retrato = montarRetrato(bruto, { hoje, coleta: new Date(agora()).toISOString() });
      retrato.tesouro = bruto.tesouro || null; retrato.noticias = bruto.noticias || null; retrato.catalogoUS = bruto.catalogoUS || null; retrato.manifesto = bruto.manifesto || null;
      retrato.energia = bruto.energia || null; retrato.cambioInt = bruto.cambioInt || null; retrato.macroInt = bruto.macroInt || null;
      return retrato;
    }
    // ---------- v160: eagles-dados (repositório SÓ de dados, snapshots imutáveis conferidos por SHA-256) ----------
    let _leitor = null;
    function leitorV2() {
      const b = op.baseDados != null ? op.baseDados : DADOS_BASE; if (!b) return null;
      const SN = (typeof window !== 'undefined' && window.INVEST && window.INVEST.snapshot) || (typeof require === 'function' ? require('./inv-snapshot.js') : null);
      if (!SN) return null;
      if (!_leitor) _leitor = SN.criarLeitor({ fetch: f, base: b, armazenamento: arm, hoje: op.hoje, agora, subtle: op.subtle });
      return _leitor;
    }
    async function arqV2(nome, fonteId, ler) {
      const L = leitorV2(); const S = st(fonteId); S.requisicoes++;
      const r = await L.arquivo(nome);
      if (!r.ok) { S.erros++; S.ultimoErro = String(r.erro || 'indisponível').slice(0, 160); return null; }
      if (r.aviso) S.ultimoErro = r.aviso.slice(0, 200); else { S.ultimaOk = new Date(agora()).toISOString(); S.ultimoErro = ''; }
      if (r.doCache) S.doCache++;
      const v = ler ? ler(r.dados) : r.dados; if (v && typeof v === 'object') Object.defineProperty(v, '_integridade', { value: { estado: r.estado, aviso: r.aviso || '', sha256: r.sha256, competencia: r.competencia }, enumerable: false });
      return v;
    }
    async function carregarDoEaglesDados(bruto, tarefas, hoje) {
      const m = await leitorV2().manifesto(); bruto.manifesto = m.ok ? { versao: String(m.manifesto.sequencia), coleta: m.manifesto.gerado, arquivos: Object.keys(m.manifesto.arquivos), origem: m.origem, aviso: m.aviso || '' } : null;
      if (!m.ok) { st('manifesto').erros++; st('manifesto').ultimoErro = m.erro; return; }
      tarefas.push(arqV2('tesouro.json', 'tesouro_direto', (j) => (j && j.titulos ? j : null)).then((x) => { if (x) { bruto.tesouro = x; st('tesouro_direto').registros = Object.keys(x.titulos).length; } }));
      tarefas.push(arqV2('noticias.json', 'noticias_fed', (j) => (j && Array.isArray(j.itens) ? j : null)).then((x) => { if (x) bruto.noticias = x; }));
      if (ligada('fred')) tarefas.push(arqV2('macro-us.json', 'fred', (j) => lerMacroUS(j, hoje)).then((x) => { if (x) bruto.macroUS = x; }));
      if (ligada('sec_edgar')) tarefas.push(arqV2('catalogo-us.json', 'sec_edgar', lerCatalogoUS).then((x) => { if (x) bruto.catalogoUS = x; }));
      if (ligada('eia_fred')) tarefas.push(arqV2('energia.json', 'eia_fred', (j) => lerEnergia(j, hoje)).then((x) => { if (x) bruto.energia = x; }));
      if (ligada('cambio_int')) tarefas.push(arqV2('cambio-int.json', 'cambio_int', (j) => lerCambioInt(j, hoje)).then((x) => { if (x) bruto.cambioInt = x; }));
      if (ligada('worldbank')) tarefas.push(arqV2('macro-int.json', 'worldbank', lerMacroInt).then((x) => { if (x) bruto.macroInt = x; }));
    }
    // fundos e FII: SÓ pelo eagles-dados (grandes demais para o site). Sem ele: indisponível, com o motivo.
    const SEM_EAGLES_DADOS = 'Os dados de fundos ficam no repositório de dados (eagles-dados), que ainda não foi ativado.';
    const fundos = {
      disponivel: () => !!leitorV2() && ligada('cvm_fundos'),
      motivo: () => (!leitorV2() ? SEM_EAGLES_DADOS : !ligada('cvm_fundos') ? 'Fonte desligada' : ''),
      indice: () => (leitorV2() && ligada('cvm_fundos') ? arqV2('fundos-indice.json', 'cvm_fundos', (j) => (j && j.formato === 'eagles-inv-fundos-indice-v1' && Array.isArray(j.itens) ? j : null)) : Promise.resolve(null)),
      shard: (arq) => (leitorV2() && ligada('cvm_fundos') && /^fundos-h-\d{3}\.json$/.test(arq) ? arqV2(arq, 'cvm_fundos', (j) => (j && j.fundos ? j : null)) : Promise.resolve(null)),
      fii: () => (leitorV2() && ligada('cvm_fii') ? arqV2('fii-mensal.json', 'cvm_fii', (j) => (j && j.formato === 'eagles-inv-fii-mensal-v1' && j.fundos ? j : null)) : Promise.resolve(null)),
    };
    // fundamentos (arquivos maiores): só quando a pessoa abre a tela de um ativo; um download por dia por aparelho
    function fundamentos(pais) {
      const fonte = pais === 'US' ? 'sec_edgar' : 'cvm'; if (!ligada(fonte)) return Promise.resolve(null);
      const arq = pais === 'US' ? 'fundamentos-us.json' : 'fundamentos-br.json'; const fmt = pais === 'US' ? 'eagles-inv-fundamentos-us-v1' : 'eagles-inv-fundamentos-br-v1';
      const lerF = (j) => (j && j.formato === fmt && j.empresas && typeof j.empresas === 'object' ? j : null);
      if (leitorV2()) return arqV2(arq, fonte, lerF);
      return buscar(fonte, `arq:${arq}:${op.hoje}`, (op.base || DADOS_BASE) + 'inv/dados/' + arq, 'json', 12 * 3600, lerF);
    }
    return { carregarTudo, fundamentos, fundos, eventosIntegridade: () => (_leitor ? _leitor.eventos() : []), status: () => JSON.parse(JSON.stringify(status)), limparCache: () => { try { if (!arm) return; const ks = []; for (let i = 0; i < arm.length; i++) { const k = arm.key(i); if (k && k.startsWith(PREFIXO)) ks.push(k); } ks.forEach((k) => arm.removeItem(k)); } catch (e) { /* sem acesso */ } } };
  }

  return { DADOS_BASE, FRED_MAPA, lerMacroUS, lerCatalogoUS, lerEnergia, lerCambioInt, lerMacroInt, VERSAO, CONSULTA, FONTES, SERIES_BCB, CURVA_UST, ligada, lerSGS, lerPTAX, lerFocus, lerCurvaUST, lerFeed, limparTexto, linkSeguro, estadoPelaIdade, registro, montarRetrato, criarAdaptadorRetrato, criarAdaptadorTesouro, criarCarregador, brParaIso, usParaIso, dataValida };
});
