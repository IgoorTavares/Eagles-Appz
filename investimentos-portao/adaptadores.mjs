// Investimentos · EAGLES DATA ENGINE · adaptadores de fontes (Etapa 05 — Biblioteca de Ativos)
// Pasta INTERNA: nunca vai para o site. Cada adaptador lê um ARQUIVO OFICIAL já baixado (de forma autorizada,
// pelo site da própria fonte) e devolve registros no formato comum. Nenhum adaptador baixa nada sozinho,
// nenhum raspa páginas e nenhum usa IA. Os nomes das colunas seguem o layout publicado por cada fonte
// e PRECISAM ser reconferidos com o arquivo real na primeira importação (relatório da Etapa 05, item 6).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../inv/inv-motor.js');

// ---------- CSV (separador ";" ou ",", aspas, quebras dentro de aspas) ----------
export function lerCsv(texto, sep = ';') {
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  texto = String(texto).replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; continue; }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some((x) => x !== '')) linhas.push(linha); linha = []; }
    else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); if (linha.some((x) => x !== '')) linhas.push(linha); }
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  const nomes = cab.map((n) => n.trim());
  return resto.map((l) => Object.fromEntries(nomes.map((n, i) => [n, (l[i] || '').trim()])));
}
const exigir = (regs, colunas, fonte) => {
  if (!regs.length) return;
  const falta = colunas.filter((c) => !(c in regs[0]));
  if (falta.length) throw new Error(`${fonte}: colunas esperadas não encontradas (${falta.join(', ')}). O layout oficial pode ter mudado.`);
};
const dataBr = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''); };

// ---------- CVM: cadastro de companhias abertas (cad_cia_aberta.csv, ";" latin-1) ----------
// Conferido com o arquivo real (25/11/2026): 2.680 companhias; SIT = ATIVO · CANCELADA · SUSPENSO(A) - DECISÃO ADM.
// Dá nome, setor e situação de cada companhia (por CNPJ). Não tem código de negociação.
const SIT_CVM = (s) => (/CANCELAD/i.test(s) ? 'cancelado' : /SUSPENS/i.test(s) ? 'suspenso' : 'ativo');
export function cvmCadastro(texto, op = {}) {
  const regs = lerCsv(texto, ';');
  exigir(regs, ['CNPJ_CIA', 'DENOM_SOCIAL', 'DENOM_COMERC', 'SIT', 'CD_CVM', 'SETOR_ATIV'], 'CVM cadastro');
  const mapa = new Map();
  for (const r of regs) {
    const cnpj = M.soDigitos(r.CNPJ_CIA);
    if (!cnpj) continue;
    mapa.set(cnpj, { cnpj, nome: r.DENOM_SOCIAL, nomeCurto: r.DENOM_COMERC, setor: r.SETOR_ATIV, codigoCvm: r.CD_CVM, situacao: SIT_CVM(r.SIT), dataRef: op.dataRef || '' });
  }
  return mapa; // usado para enriquecer os códigos do FCA
}

// ---------- CVM: FCA — valores mobiliários (fca_cia_aberta_valor_mobiliario_AAAA.csv, dentro do fca_cia_aberta_AAAA.zip) ----------
// Liga o CNPJ da companhia ao CÓDIGO DE NEGOCIAÇÃO informado pela própria companhia à CVM (aberto, sem licença da B3).
// Conferido com o arquivo real: Valor_Mobiliario = "Ações Ordinárias", "Ações Preferenciais", "Units", "BDRs",
// "Certificados de depósito de valores mobiliários", "Bônus de Subscrição", debêntures, notas etc.; Mercado = "Bolsa",
// "Balcão Organizado", "Balcão Não-Organizado" ou vazio. Há códigos digitados errados pelas companhias ("000000",
// "RBNS", "LMED"): são REJEITADOS e vão para o relatório (nunca corrigidos por dedução).
export function cvmValoresMobiliarios(texto, empresas, op = {}) {
  const regs = lerCsv(texto, ';');
  exigir(regs, ['CNPJ_Companhia', 'Versao', 'Valor_Mobiliario', 'Codigo_Negociacao', 'Mercado', 'Data_Fim_Negociacao'], 'CVM FCA');
  // só a versão mais recente do formulário de cada companhia (reapresentações substituem as anteriores)
  const versao = new Map();
  for (const r of regs) { const k = M.soDigitos(r.CNPJ_Companhia); const v = +r.Versao || 0; if (!versao.has(k) || v > versao.get(k)) versao.set(k, v); }
  const porTicker = new Map(); const ignorados = op.ignorados || [];
  for (const r of regs) {
    const cnpj = M.soDigitos(r.CNPJ_Companhia);
    if ((+r.Versao || 0) !== versao.get(cnpj)) continue;
    if (!/^bolsa$/i.test(String(r.Mercado).trim())) continue; // balcão e vazios não são negociados na bolsa
    const vm = String(r.Valor_Mobiliario || '');
    // ordem importa: BDR antes de "ação"; unit é certificado de ações da própria companhia (classe ação)
    const classe = /\bbdrs?\b/i.test(vm) ? 'bdr' : /certificados? de dep[oó]sito/i.test(vm) ? 'bdr' : /\bunits?\b/i.test(vm) ? 'acao' : /^a[cç][oõ]es/i.test(vm) ? 'acao' : null;
    if (!classe) { ignorados.push({ motivo: 'tipo fora do catálogo', tipo: vm, codigo: r.Codigo_Negociacao }); continue; }
    const tk = M.normTicker(r.Codigo_Negociacao);
    if (!tk) { ignorados.push({ motivo: 'sem código informado', tipo: vm, empresa: r.Nome_Empresarial || cnpj }); continue; }
    const e = (empresas && empresas.get(cnpj)) || {};
    const encerrado = !!r.Data_Fim_Negociacao;
    const reg = { fonte: 'cvm', pais: 'BR', bolsa: 'B3', ticker: tk, classe, moeda: 'BRL', nome: e.nome || r.Nome_Empresarial || '', nomeCurto: e.nomeCurto || '', setor: e.setor || '',
      segmento: /\bunits?\b/i.test(vm) ? 'Unit' : /preferenc/i.test(vm) ? 'Preferencial' : /ordin/i.test(vm) ? 'Ordinária' : '',
      cnpj: r.CNPJ_Companhia, codigoCvm: e.codigoCvm, situacao: encerrado ? 'encerrado' : (e.situacao || 'ativo'), fimNegociacao: r.Data_Fim_Negociacao || '',
      semCadastro: !e.cnpj, dataRef: op.dataRef || r.Data_Referencia || '', arquivo: op.arquivo || '', teste: !!op.teste };
    // mesmo código repetido: o que segue negociado vence o encerrado
    const ex = porTicker.get(tk);
    if (!ex || (ex.situacao === 'encerrado' && reg.situacao !== 'encerrado')) porTicker.set(tk, reg);
  }
  return [...porTicker.values()];
}

// ---------- CVM: informe mensal de FII — geral (inf_mensal_fii_geral_AAAA.csv, dentro do inf_mensal_fii_AAAA.zip) ----------
// Conferido com o arquivo real: desde a Resolução CVM 175 as colunas são CNPJ_Fundo_Classe e Nome_Fundo_Classe
// (aceitamos também os nomes antigos CNPJ_Fundo/Nome_Fundo). Mercado_Negociacao_Bolsa = "S" marca as cotas
// negociadas em bolsa. O código de negociação NÃO vem no arquivo: é DERIVADO do ISIN (raiz de 4 letras + "11")
// e fica marcado como NÃO CONFIRMADO (codigoConfirmado: false) até uma fonte que publique o código.
export function cvmFii(texto, op = {}) {
  const regs = lerCsv(texto, ';');
  const col = (novo, antigo) => (regs.length && novo in regs[0] ? novo : antigo);
  const C_CNPJ = col('CNPJ_Fundo_Classe', 'CNPJ_Fundo'); const C_NOME = col('Nome_Fundo_Classe', 'Nome_Fundo');
  exigir(regs, [C_CNPJ, C_NOME, 'Codigo_ISIN', 'Segmento_Atuacao', 'Data_Referencia'], 'CVM FII');
  const ignorados = op.ignorados || [];
  const ultimo = new Map();
  for (const r of regs) { const k = M.soDigitos(r[C_CNPJ]); const ex = ultimo.get(k); if (!ex || r.Data_Referencia > ex.Data_Referencia || (r.Data_Referencia === ex.Data_Referencia && (+r.Versao || 0) > (+ex.Versao || 0))) ultimo.set(k, r); }
  const porTicker = new Map();
  for (const r of ultimo.values()) {
    if ('Mercado_Negociacao_Bolsa' in r && String(r.Mercado_Negociacao_Bolsa).trim().toUpperCase() !== 'S') continue; // não negociado em bolsa
    const isin = String(r.Codigo_ISIN || '').toUpperCase().trim();
    const m = /^BR([A-Z]{4})CTF\d{3}$/.exec(isin);
    if (!m || !M.isinValido(isin)) { ignorados.push({ motivo: 'ISIN ausente ou fora do padrão de cota', isin, fundo: r[C_NOME] }); continue; }
    const tk = m[1] + '11';
    const reg = { fonte: 'cvm', pais: 'BR', bolsa: 'B3', ticker: tk, classe: 'fii', moeda: 'BRL', nome: r[C_NOME], setor: 'Fundos imobiliários', segmento: r.Segmento_Atuacao,
      cnpj: r[C_CNPJ], isin, codigoDerivado: true, dataRef: op.dataRef || r.Data_Referencia, arquivo: op.arquivo || '', teste: !!op.teste };
    const ex = porTicker.get(tk);
    if (ex) { ignorados.push({ motivo: 'código derivado repetido (duas classes com a mesma raiz de ISIN)', codigo: tk, fundos: [ex.nome, reg.nome] }); if (reg.dataRef <= ex.dataRef) continue; }
    porTicker.set(tk, reg);
  }
  return [...porTicker.values()];
}

// ---------- SEC: company_tickers_exchange.json ----------
// { fields: ["cik","name","ticker","exchange"], data: [[cik, nome, ticker, bolsa], ...] }
const BOLSA_SEC = { Nasdaq: 'NASDAQ', NYSE: 'NYSE', CBOE: 'CBOE', OTC: 'OTC', 'NYSE Arca': 'NYSEARCA', 'NYSE American': 'NYSE' };
export function secTickers(texto, op = {}) {
  const j = JSON.parse(texto);
  if (!j || !Array.isArray(j.fields) || !Array.isArray(j.data)) throw new Error('SEC: formato inesperado (fields/data).');
  const ix = (n) => j.fields.indexOf(n);
  const [ic, inm, it, ie] = ['cik', 'name', 'ticker', 'exchange'].map(ix);
  if ([ic, inm, it, ie].some((x) => x < 0)) throw new Error('SEC: colunas esperadas não encontradas.');
  const out = [];
  for (const l of j.data) {
    const bolsa = BOLSA_SEC[l[ie]];
    if (!bolsa) continue; // sem bolsa conhecida: fica de fora (não inventamos a bolsa)
    out.push({ fonte: 'sec', pais: 'US', bolsa, ticker: String(l[it]).replace('-', '.'), classe: 'acao', moeda: 'USD', nome: l[inm], cik: l[ic], dataRef: op.dataRef || '', arquivo: op.arquivo || '', teste: !!op.teste });
  }
  return out;
}

// ---------- Tesouro Transparente: PrecoTaxaTesouroDireto.csv ----------
const TIPOS_TESOURO = [
  [/^tesouro selic$/i, 'SELIC', 'Selic (pós-fixado)'], [/^tesouro ipca\+ com juros semestrais$/i, 'IPCAJ', 'IPCA (juros semestrais)'],
  [/^tesouro ipca\+$/i, 'IPCA', 'IPCA'], [/^tesouro prefixado com juros semestrais$/i, 'PREFIXADOJ', 'Prefixado (juros semestrais)'],
  [/^tesouro prefixado$/i, 'PREFIXADO', 'Prefixado'], [/^tesouro igpm\+ com juros semestrais$/i, 'IGPMJ', 'IGP-M (juros semestrais)'],
  [/^tesouro renda\+/i, 'RENDA', 'IPCA (Renda+)'], [/^tesouro educa\+/i, 'EDUCA', 'IPCA (Educa+)'],
];
export function tesouro(texto, op = {}) {
  const regs = lerCsv(texto, ';');
  exigir(regs, ['Tipo Titulo', 'Data Vencimento', 'Data Base'], 'Tesouro');
  const base = regs.map((r) => dataBr(r['Data Base'])).filter(Boolean).sort().pop();
  const vistos = new Set(); const out = [];
  for (const r of regs) {
    if (dataBr(r['Data Base']) !== base) continue; // só o que está sendo ofertado na data mais recente
    const tipo = TIPOS_TESOURO.find(([rx]) => rx.test(r['Tipo Titulo'].trim()));
    const venc = dataBr(r['Data Vencimento']);
    if (!tipo || !venc) continue;
    const ticker = `${tipo[1]}-${venc.slice(0, 4)}`;
    if (vistos.has(ticker)) continue; vistos.add(ticker);
    out.push({ fonte: 'tesouro', pais: 'BR', bolsa: 'TESOURO', ticker, classe: 'tesouro', moeda: 'BRL', nome: `${r['Tipo Titulo'].trim()} ${venc.slice(0, 4)}`,
      setor: 'Títulos públicos', segmento: tipo[2], vencimento: venc, indexador: tipo[2], dataRef: base, arquivo: op.arquivo || '', teste: !!op.teste });
  }
  return out;
}

// ---------- B3: cadastro de instrumentos (DESLIGADO até a licença por escrito, D-06) ----------
export function b3Instrumentos(texto, op = {}) {
  if (!op.licencaConfirmada) throw new Error('B3: adaptador desligado — uso dos arquivos da B3 depende de confirmação por escrito (decisão D-06).');
  const regs = lerCsv(texto, ';');
  exigir(regs, ['TckrSymb', 'SctyCtgyNm', 'ISIN', 'CrpnNm'], 'B3');
  const CLS = { SHARES: 'acao', UNIT: 'acao', FUNDS: 'fii', BDR: 'bdr', 'ETF EQUITIES': 'etf', 'ETF FOREIGN INDEX': 'etf' };
  return regs.filter((r) => CLS[r.SctyCtgyNm]).map((r) => ({ fonte: 'b3', pais: 'BR', bolsa: 'B3', ticker: r.TckrSymb, classe: CLS[r.SctyCtgyNm], moeda: 'BRL', nome: r.CrpnNm, isin: r.ISIN, dataRef: op.dataRef || '', arquivo: op.arquivo || '', teste: !!op.teste }));
}

// ---------- CoinGecko: /coins/list (DESLIGADO: exige chave, que só pode ficar no servidor) ----------
export function coingecko(texto, op = {}) {
  if (!op.servidor) throw new Error('CoinGecko: adaptador desligado — a chave de acesso só pode ficar num servidor (D-10), nunca no navegador.');
  const lista = JSON.parse(texto);
  if (!Array.isArray(lista)) throw new Error('CoinGecko: formato inesperado.');
  const permitidas = new Set(op.selecionadas || []); // só moedas escolhidas (a lista completa tem milhares de nomes repetidos)
  return lista.filter((c) => permitidas.has(c.id)).map((c) => ({ fonte: 'coingecko', pais: 'CRYPTO', bolsa: '-', ticker: c.symbol, classe: 'cripto', moeda: 'USD', nome: c.name, coingecko: c.id, dataRef: op.dataRef || '', teste: !!op.teste }));
}

// ---------- classificação manual (Super Admin): ETF, REIT, setor... ----------
// CSV: assetId;classe;setor;segmento — só CORRIGE ativos que já existem (não cria ativo nem empresa).
export function classificacaoManual(texto) {
  const regs = lerCsv(texto, ';');
  exigir(regs, ['assetId', 'classe'], 'Classificação manual');
  return regs.filter((r) => M.CLASSES[r.classe]).map((r) => ({ assetId: r.assetId.trim(), classe: r.classe, setor: r.setor || '', segmento: r.segmento || '' }));
}
