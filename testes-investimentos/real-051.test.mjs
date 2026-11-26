// Etapa 05.1 — layout REAL dos arquivos oficiais (conferido em 25/11/2026 com os arquivos enviados pelo Igor).
// Os trechos abaixo copiam o CABEÇALHO real e linhas com o MESMO formato (valores fictícios ou públicos).
// Se existir a pasta com os arquivos reais (INV_DADOS_REAIS), também confere a importação completa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import * as A from '../investimentos-portao/adaptadores.mjs';
import { importar, lerZip } from '../investimentos-portao/importar.mjs';
const require = createRequire(import.meta.url);
const M = require('../inv/inv-motor.js');

const CAB_FCA = 'CNPJ_Companhia;Data_Referencia;Versao;ID_Documento;Nome_Empresarial;Valor_Mobiliario;Sigla_Classe_Acao_Preferencial;Classe_Acao_Preferencial;Codigo_Negociacao;Composicao_BDR_Unit;Mercado;Sigla_Entidade_Administradora;Entidade_Administradora;Data_Inicio_Negociacao;Data_Fim_Negociacao;Segmento;Data_Inicio_Listagem;Data_Fim_Listagem';
const l = (cnpj, ver, vm, cod, merc, fim = '') => `${cnpj};2026-01-01;${ver};1;EMPRESA TESTE S.A.;${vm};;;${cod};;${merc};B3;B3 S.A.;2006-05-31;${fim};Novo Mercado;1977-07-20;`;
const C1 = '11.222.333/0001-81';

test('FCA real: só a versão mais recente, só "Bolsa", códigos digitados errados são recusados (nunca corrigidos)', () => {
  const csv = [CAB_FCA, l(C1, 1, 'Ações Ordinárias', 'VELH3', 'Bolsa'), l(C1, 2, 'Ações Ordinárias', 'ZZTQ3', 'Bolsa'), l(C1, 2, 'Ações Preferenciais', 'ZZTQ4', 'Bolsa'),
    l(C1, 2, 'Units', 'ZZTQ11', 'Bolsa'), l(C1, 2, 'BDRs', 'ZZTQ32', 'Bolsa'), l(C1, 2, 'Debêntures', 'ZZTQ12', 'Balcão Organizado'),
    l(C1, 2, 'Bônus de Subscrição', 'ZZTQ13', 'Bolsa'), l(C1, 2, 'Ações Ordinárias', '000000', 'Bolsa'), l(C1, 2, 'Ações Ordinárias', 'ZZTQ5', 'Bolsa', '2020-01-01'),
    l(C1, 2, 'Ações Ordinárias', 'ZZTQ6', 'Balcão Não-Organizado'), l(C1, 2, 'Certificados de depósito de valores mobiliários', '', 'Bolsa')].join('\r\n');
  const ign = [];
  const regs = A.cvmValoresMobiliarios(csv, new Map(), { ignorados: ign });
  const tk = regs.map((r) => r.ticker).sort();
  assert.deepEqual(tk, ['000000', 'ZZTQ11', 'ZZTQ3', 'ZZTQ32', 'ZZTQ4', 'ZZTQ5']); // versão 1 (VELH3), balcão e bônus ficam de fora
  assert.equal(regs.find((r) => r.ticker === 'ZZTQ32').classe, 'bdr');
  assert.equal(regs.find((r) => r.ticker === 'ZZTQ11').segmento, 'Unit');
  assert.equal(regs.find((r) => r.ticker === 'ZZTQ5').situacao, 'encerrado');
  assert.ok(ign.some((i) => /sem código/.test(i.motivo)) && ign.some((i) => /fora do catálogo/.test(i.motivo)));
  const r = M.mesclar(regs.map(M.novoAtivo));
  assert.ok(r.rejeitados.some((x) => x.assetId === 'BR:B3:000000'), 'código "000000" vai para o relatório de rejeitados');
  assert.ok(r.ativos.every((a) => a.codigoConfirmado === true));
});

test('B3: raiz com número (B3SA3) é aceita; lixo não', () => {
  for (const c of ['B3SA3', 'PETR4', 'KNRI11', 'AAPL34', 'SANB11']) assert.ok(M.validarAtivo(M.novoAtivo({ fonte: 'cvm', pais: 'BR', bolsa: 'B3', ticker: c, classe: 'acao', moeda: 'BRL', nome: 'X' })).ok, c);
  for (const c of ['LMED', '4030', 'B3', '1545-8', 'ADR']) assert.equal(M.validarAtivo(M.novoAtivo({ fonte: 'cvm', pais: 'BR', bolsa: 'B3', ticker: c, classe: 'acao', moeda: 'BRL', nome: 'X' })).ok, false, c);
});

test('FII real (CVM 175): colunas novas, só negociados em bolsa, código derivado = NÃO confirmado', () => {
  const cab = 'Tipo_Fundo_Classe;CNPJ_Fundo_Classe;Data_Referencia;Versao;Data_Entrega;Nome_Fundo_Classe;Data_Funcionamento;Publico_Alvo;Codigo_ISIN;Quantidade_Cotas_Emitidas;Fundo_Exclusivo;Cotistas_Vinculo_Familiar;Mandato;Segmento_Atuacao;Tipo_Gestao;Prazo_Duracao;Data_Prazo_Duracao;Encerramento_Exercicio_Social;Mercado_Negociacao_Bolsa';
  const f = (cnpj, ref, nome, isin, bolsa) => `Classe;${cnpj};${ref};1;2026-03-17;${nome};1994-11-24;INVESTIDORES EM GERAL;${isin};100;N;N;;Logística;Definida;Indeterminado;;31/12;${bolsa}`;
  const isin = (raiz) => { for (let d = 0; d < 10; d++) { const x = `BR${raiz}CTF00${d}`; if (M.isinValido(x)) return x; } return ''; };
  const csv = [cab, f('11.222.333/0001-81', '2026-01-01', 'FII VELHO', isin('ZZTF'), 'S'), f('11.222.333/0001-81', '2026-10-01', 'FII ZZT NOVO', isin('ZZTF'), 'S'),
    f('99.000.006/0001-26', '2026-10-01', 'FII FORA DA BOLSA', isin('ZZTH'), 'N'), f('99.000.001/0001-01', '2026-10-01', 'FII SEM ISIN', '', 'S')].join('\r\n');
  const ign = [];
  const regs = A.cvmFii(csv, { ignorados: ign });
  assert.equal(regs.length, 1);
  assert.equal(regs[0].ticker, 'ZZTF11'); assert.equal(regs[0].nome, 'FII ZZT NOVO');
  const a = M.novoAtivo(regs[0]);
  assert.equal(a.codigoConfirmado, false); assert.equal(a.codigoDerivado, true);
  assert.ok(ign.some((i) => /ISIN/.test(i.motivo)));
});

test('leitor de .zip: lê o CSV de dentro do arquivo compactado (como vem da CVM)', () => {
  const nome = Buffer.from('fca_cia_aberta_valor_mobiliario_2026.csv'); const dados = Buffer.from(CAB_FCA + '\r\n' + l(C1, 1, 'Ações Ordinárias', 'ZZTQ3', 'Bolsa'), 'latin1');
  const comp = deflateRawSync(dados);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(nome.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(nome.length, 28); cen.writeUInt32LE(0, 42);
  const corpo = Buffer.concat([loc, nome, comp]);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(cen.length + nome.length, 12); fim.writeUInt32LE(corpo.length, 16);
  const z = lerZip(Buffer.concat([corpo, cen, nome, fim]));
  assert.equal(z.get('fca_cia_aberta_valor_mobiliario_2026.csv').toString('latin1'), dados.toString('latin1'));
});

test('catálogo publicado: misto real + teste, cada item de teste marcado, nada de teste sem etiqueta', () => {
  const meta = JSON.parse(readFileSync(new URL('../inv/catalogo/meta.json', import.meta.url)));
  const itens = JSON.parse(readFileSync(new URL('../inv/catalogo/ativos.json', import.meta.url))).itens;
  assert.equal(meta.teste, false); assert.equal(meta.total, itens.length);
  assert.equal(meta.totalTeste, itens.filter((a) => a.teste).length);
  assert.ok(itens.filter((a) => a.teste).every((a) => /^ZZT/.test(a.ticker)), 'só os fictícios ZZT* são de teste');
  assert.ok(itens.filter((a) => !a.teste).every((a) => a.fontes.every((f) => ['cvm', 'tesouro'].includes(f.id))), 'reais só de fontes oficiais recebidas');
  assert.ok(itens.filter((a) => a.classe === 'fii').every((a) => a.codigoConfirmado === false), 'todo FII com código derivado aparece como não confirmado');
  assert.equal(new Set(itens.map((a) => a.assetId)).size, itens.length, 'identificadores únicos');
  for (const a of itens) assert.ok(M.validarAtivo(a).ok, a.assetId);
  for (const a of itens) assert.equal(M.favoritosValidos(M.alternarFavorito(M.favoritosPadrao(), 'principal', a.assetId)), true, 'cabe nos favoritos: ' + a.assetId);
});

const REAIS = process.env.INV_DADOS_REAIS;
test('arquivos reais (se disponíveis): contagens e ativos conhecidos', { skip: !REAIS || !existsSync(REAIS) }, () => {
  const r = importar({ entrada: REAIS, dataGeracao: '2026-11-25T12:00:00.000Z' });
  const t0 = Date.now(); const idx = M.indexar(r.ativos); const ms = Date.now() - t0;
  assert.ok(r.ativos.length > 900, 'mais de 900 ativos reais');
  const ids = new Set(r.ativos.map((a) => a.assetId));
  for (const id of ['BR:B3:PETR4', 'BR:B3:VALE3', 'BR:B3:ITUB4', 'BR:B3:BBAS3', 'BR:B3:B3SA3', 'BR:B3:SANB11', 'BR:B3:INBR32', 'BR:TESOURO:SELIC-2029']) assert.ok(ids.has(id), id);
  assert.equal(M.buscar(idx, 'petrobras', {}, { limite: 5 }).itens[0].ticker.slice(0, 4), 'PETR');
  assert.ok(ms < 1500);
});

test('auditoria: fonte que só trouxe dado de TESTE não aparece como fonte real; modo produção só com fonte autorizada', () => {
  // Etapa 10: o catálogo de desenvolvimento (com as fontes ainda não autorizadas) ficou fora do site
  const meta = JSON.parse(readFileSync(new URL('../investimentos-portao/catalogo-dev/meta.json', import.meta.url)));
  const prod = JSON.parse(readFileSync(new URL('../inv/catalogo/meta.json', import.meta.url)));
  assert.equal(prod.producao, true); assert.equal(prod.total, 0, 'o catálogo que vai ao site fica vazio até as licenças serem confirmadas');
  assert.equal(meta.fontes.sec.usada, false); assert.equal(meta.fontes.sec.estado, 'somente-teste');
  assert.equal(meta.porFonte.sec, undefined); assert.equal(meta.porFonteTeste.sec, 5);
  assert.equal(meta.totalReal, 953); assert.equal(meta.totalTeste, 5); assert.equal(meta.total, 958);
  assert.equal(meta.fontes.cvm.autorizadaProducao, false, 'licença da CVM ainda não confirmada');
  assert.equal(meta.fontes.tesouro.autorizadaProducao, false, 'termos do Tesouro ainda não confirmados');
  const FIX = new URL('../investimentos-portao/fixtures/', import.meta.url).pathname;
  const p = importar({ entrada: FIX, producao: true, dataGeracao: '2026-11-26T12:00:00.000Z' });
  assert.equal(p.ativos.length, 0, 'sem fonte autorizada, o catálogo de produção fica vazio (bloqueio de publicação)');
  assert.ok(p.relatorio.avisos.some((x) => /modo produção/.test(x)));
});
