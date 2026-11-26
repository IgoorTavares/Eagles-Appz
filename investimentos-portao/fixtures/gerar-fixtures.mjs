// Gera os ARQUIVOS DE TESTE no mesmo formato das fontes oficiais, com empresas e códigos FICTÍCIOS.
// Nenhum registro aqui é real: códigos começam com "ZZT", nomes terminam com "(TESTE)".
// Uso: node investimentos-portao/fixtures/gerar-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const AQUI = dirname(fileURLToPath(import.meta.url));

function cnpj(base12) { // calcula os 2 dígitos verificadores de um CNPJ fictício
  const dv = (b) => { let s = 0, p = b.length - 7; for (let i = 0; i < b.length; i++) { s += +b[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base12); const d2 = dv(base12 + d1); const c = base12 + d1 + d2;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
function isin(base11) { // dígito verificador do ISIN (Luhn sobre letras convertidas)
  const dig = base11.split('').map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
  let soma = 0, dobra = true;
  for (let i = dig.length - 1; i >= 0; i--) { let n = +dig[i]; if (dobra) { n *= 2; if (n > 9) n -= 9; } soma += n; dobra = !dobra; }
  return base11 + ((10 - (soma % 10)) % 10);
}
const E = {
  alfa: cnpj('990000010001'), beta: cnpj('990000020001'), gama: cnpj('990000030001'), cancelada: cnpj('990000040001'),
  bdr: cnpj('990000050001'), fii1: cnpj('990000060001'), fii2: cnpj('990000070001'),
};

// CVM — cad_cia_aberta.csv (latin-1, ";")
const cad = ['CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;DT_REG;DT_CONST;DT_CANCEL;MOTIVO_CANCEL;SIT;DT_INI_SIT;CD_CVM;SETOR_ATIV;TP_MERC;CATEG_REG',
  `${E.alfa};COMPANHIA ZZT ALFA S.A. (TESTE);ZZT ALFA (TESTE);2001-01-02;1990-05-10;;;ATIVO;2001-01-02;99001;Energia Elétrica;BOLSA;Categoria A`,
  `${E.beta};ZZT BETA BANCO S.A. (TESTE);ZZT BETA (TESTE);2002-03-04;1980-01-01;;;ATIVO;2002-03-04;99002;Bancos;BOLSA;Categoria A`,
  `${E.gama};ZZT GAMA VAREJO S.A. (TESTE);ZZT GAMA (TESTE);2010-06-07;2005-02-02;;;ATIVO;2010-06-07;99003;Comércio (Atacado e Varejo);BOLSA;Categoria A`,
  `${E.cancelada};ZZT CANCELADA S.A. (TESTE);ZZT CANCELADA (TESTE);2000-01-01;1999-01-01;2015-01-01;Cancelamento;CANCELADA;2015-01-01;99004;Serviços;BOLSA;Categoria A`,
  `${E.bdr};ZZT EXTERIOR INC. (TESTE);ZZT EXTERIOR (TESTE);2020-01-01;2000-01-01;;;ATIVO;2020-01-01;99005;Tecnologia da Informação;BOLSA;Categoria B`,
  '12.345.678/0001-00;CNPJ INVALIDO (TESTE);INVALIDO;2000-01-01;;;;ATIVO;;99006;Serviços;BOLSA;Categoria A'].join('\n');
writeFileSync(join(AQUI, 'cad_cia_aberta.csv'), Buffer.from(cad, 'latin1'));

// CVM — FCA valores mobiliários
const fca = ['CNPJ_Companhia;Data_Referencia;Versao;ID_Documento;Valor_Mobiliario;Sigla_Classe_Acao_Preferencial;Classe_Acao_Preferencial;Codigo_Negociacao;Composicao_BDR_Unit;Mercado;Sigla_Entidade_Administradora;Entidade_Administradora;Data_Inicio_Negociacao;Data_Fim_Negociacao;Segmento;Data_Inicio_Listagem;Data_Fim_Listagem',
  `${E.alfa};2099-01-01;1;1;Ações Ordinárias;;;ZZTA3;;Bolsa;B3;B3 S.A.;2001-01-02;;Novo Mercado;2001-01-02;`,
  `${E.alfa};2099-01-01;1;1;Ações Preferenciais;PNA;Preferencial Classe A;ZZTA4;;Bolsa;B3;B3 S.A.;2001-01-02;;Novo Mercado;2001-01-02;`,
  `${E.alfa};2099-01-01;1;1;Ações Ordinárias;;;ZZTA3;;Bolsa;B3;B3 S.A.;2001-01-02;;Novo Mercado;2001-01-02;`, // repetido de propósito
  `${E.beta};2099-01-01;1;2;Units;;;ZZTB11;2 ON + 1 PN;Bolsa;B3;B3 S.A.;2002-03-04;;Nível 2;2002-03-04;`,
  `${E.beta};2099-01-01;1;2;Ações Ordinárias;;;ZZTB3;;Bolsa;B3;B3 S.A.;2002-03-04;2010-01-01;Nível 2;2002-03-04;`, // negociação encerrada
  `${E.gama};2099-01-01;1;3;Ações Ordinárias;;;ZZTG3;;Bolsa;B3;B3 S.A.;2010-06-07;;Novo Mercado;2010-06-07;`,
  `${E.gama};2099-01-01;1;3;Debêntures;;;ZZTG13;;Balcão Organizado;B3;B3 S.A.;2012-01-01;;;;`, // balcão: fica de fora
  `${E.cancelada};2014-01-01;1;4;Ações Ordinárias;;;ZZTC3;;Bolsa;B3;B3 S.A.;2000-01-01;;Tradicional;2000-01-01;`,
  `${E.bdr};2099-01-01;1;5;Certificado de Depósito de Ações (BDR);;;ZZTX34;1 ação;Bolsa;B3;B3 S.A.;2020-01-01;;BDR Nível 3;2020-01-01;`,
  '12.345.678/0001-00;2099-01-01;1;6;Ações Ordinárias;;;ZZTI3;;Bolsa;B3;B3 S.A.;2000-01-01;;Tradicional;2000-01-01;'].join('\n');
writeFileSync(join(AQUI, 'fca_cia_aberta_valor_mobiliario_2099.csv'), Buffer.from(fca, 'latin1'));

// CVM — informe mensal FII (geral)
const fii = ['CNPJ_Fundo;Data_Referencia;Versao;Data_Entrega;Nome_Fundo;Data_Funcionamento;Publico_Alvo;Codigo_ISIN;Quantidade_Cotas_Emitidas;Fundo_Exclusivo;Mandato;Segmento_Atuacao;Tipo_Gestao',
  `${E.fii1};2099-01-01;1;2099-02-10;FII ZZT LOGÍSTICA (TESTE);2015-01-01;Investidores em Geral;${isin('BRZZTLCTF00')};1000000;N;Renda;Logística;Ativa`,
  `${E.fii1};2099-02-01;1;2099-03-10;FII ZZT LOGÍSTICA (TESTE);2015-01-01;Investidores em Geral;${isin('BRZZTLCTF00')};1000000;N;Renda;Logística;Ativa`,
  `${E.fii2};2099-02-01;1;2099-03-10;FII ZZT PAPEL (TESTE);2018-01-01;Investidores em Geral;${isin('BRZZTPCTF00')};500000;N;Títulos e Valores Mobiliários;Recebíveis;Ativa`,
  `${E.fii2.replace('99', '98')};2099-02-01;1;2099-03-10;FII SEM COTA EM BOLSA (TESTE);2018-01-01;Investidores Profissionais;;0;S;Renda;Outros;Passiva`].join('\n');
writeFileSync(join(AQUI, 'inf_mensal_fii_geral_2099.csv'), Buffer.from(fii, 'latin1'));

// SEC — company_tickers_exchange.json
writeFileSync(join(AQUI, 'company_tickers_exchange.json'), JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [
  [9990001, 'ZZT Technology Corp. (TESTE)', 'ZZTX', 'Nasdaq'], [9990002, 'ZZT Industrial Inc. (TESTE)', 'ZZTY', 'NYSE'],
  [9990003, 'ZZT Realty Trust (TESTE)', 'ZZTR', 'NYSE'], [9990004, 'ZZT Index Fund ETF (TESTE)', 'ZZTE', 'NYSE Arca'],
  [9990005, 'ZZT Holdings Class B (TESTE)', 'ZZTH-B', 'NYSE'], [9990006, 'ZZT Sem Bolsa (TESTE)', 'ZZTN', ''],
  [9990001, 'ZZT Technology Corp. (TESTE)', 'ZZTX', 'Nasdaq']] }));

// Tesouro Transparente — PrecoTaxaTesouroDireto.csv (duas datas-base: só a mais recente vale)
const tes = ['Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha',
  'Tesouro Selic;01/03/2099;01/01/2099;0,10;0,12;1,00;1,00;1,00', 'Tesouro Selic;01/03/2099;02/01/2099;0,10;0,12;1,00;1,00;1,00',
  'Tesouro IPCA+;15/05/2098;02/01/2099;5,00;5,10;1,00;1,00;1,00', 'Tesouro IPCA+ com Juros Semestrais;15/08/2097;02/01/2099;5,00;5,10;1,00;1,00;1,00',
  'Tesouro Prefixado;01/01/2096;02/01/2099;10,00;10,10;1,00;1,00;1,00', 'Tesouro Antigo Descontinuado;01/01/2095;01/01/2099;1,00;1,00;1,00;1,00;1,00',
  'Tesouro Tipo Desconhecido;01/01/2094;02/01/2099;1,00;1,00;1,00;1,00;1,00'].join('\n');
writeFileSync(join(AQUI, 'PrecoTaxaTesouroDireto.csv'), Buffer.from(tes, 'latin1'));

// B3 — cadastro de instrumentos (adaptador DESLIGADO por padrão: D-06)
writeFileSync(join(AQUI, 'b3_instrumentos.csv'), ['RptDt;TckrSymb;Asst;SctyCtgyNm;ISIN;CrpnNm', `2099-01-02;ZZTF11;ZZTF;ETF EQUITIES;${isin('BRZZTFCTF00')};ZZT FUNDO DE ÍNDICE (TESTE)`].join('\n'));

// CoinGecko — /coins/list (adaptador DESLIGADO: chave só no servidor)
writeFileSync(join(AQUI, 'coins_list.json'), JSON.stringify([{ id: 'zzt-coin-teste', symbol: 'zztc', name: 'ZZT Coin (TESTE)' }, { id: 'zzt-outra', symbol: 'zzto', name: 'ZZT Outra (TESTE)' }]));

// Classificação manual (Super Admin)
writeFileSync(join(AQUI, 'classificacao-manual.csv'), ['assetId;classe;setor;segmento', 'US:NYSE:ZZTR;reit;Imobiliário;REIT de escritórios', 'US:NYSEARCA:ZZTE;etf;Fundos de índice;Ações amplas', 'US:NASDAQ:ZZTX;acao;Tecnologia;Software', 'US:NYSE:NAOEXISTE;acao;;'].join('\n'));

console.log('Arquivos de teste gerados em', AQUI, JSON.stringify(E));
