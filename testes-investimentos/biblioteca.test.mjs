// Testes do núcleo da Biblioteca de Ativos (Etapa 05) — rodam no Node, sem navegador, sem rede, sem banco.
// Uso: node --test testes-investimentos/biblioteca.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../investimentos-portao/adaptadores.mjs';
import { importar } from '../investimentos-portao/importar.mjs';
const require = createRequire(import.meta.url);
const M = require('../inv/inv-motor.js');
const FIX = new URL('../investimentos-portao/fixtures/', import.meta.url).pathname;
const cat = importar({ entrada: FIX, teste: true, dataGeracao: '2026-11-25T12:00:00.000Z' });
const idx = M.indexar(cat.ativos);
const ids = (r) => r.itens.map((a) => a.assetId);

test('CNPJ e ISIN: dígitos verificadores', () => {
  assert.equal(M.cnpjValido('11.222.333/0001-81'), true);
  assert.equal(M.cnpjValido('11.222.333/0001-80'), false);
  assert.equal(M.cnpjValido('00000000000000'), false);
  assert.equal(M.isinValido('US0378331005'), true);   // formato e cálculo do padrão ISO 6166
  assert.equal(M.isinValido('US0378331006'), false);
  assert.equal(M.isinValido('XX'), false);
});

test('identificador único: PAIS:BOLSA:CODIGO, normalizado e conferido', () => {
  assert.equal(M.montarAssetId('br', 'b3', ' zzta3 '), 'BR:B3:ZZTA3');
  assert.equal(M.montarAssetId('CRYPTO', '-', 'zztc'), 'CRYPTO:-:ZZTC');
  const ok = M.novoAtivo({ fonte: 'cvm', pais: 'BR', bolsa: 'B3', ticker: 'ZZTA3', classe: 'acao', moeda: 'BRL', nome: 'X' });
  assert.equal(M.validarAtivo(ok).ok, true);
  const ruins = [
    { ...ok, ticker: 'ZZ' }, { ...ok, classe: 'imovel' }, { ...ok, moeda: 'EUR' }, { ...ok, assetId: 'BR:B3:OUTRO' },
    { ...ok, fontes: [{ id: 'inventada' }] }, { ...ok, nome: '' }, { ...ok, ids: { cnpj: '12345678000100' } },
  ];
  for (const r of ruins) assert.equal(M.validarAtivo(r).ok, false, JSON.stringify(r).slice(0, 80));
  // nome: sem sinais de HTML e sem espaços sobrando (o texto ainda é escapado na tela)
  assert.equal(M.novoAtivo({ fonte: 'teste', pais: 'BR', bolsa: 'B3', ticker: 'ZZTA3', classe: 'acao', moeda: 'BRL', nome: '<script>x</script>  com   espaços' }).nome, 'scriptx/script com espaços');
});

test('duplicidades: mesmo assetId vira um só; ISIN repetido em códigos diferentes é conflito resolvido pela prioridade', () => {
  const base = { pais: 'BR', bolsa: 'B3', classe: 'acao', moeda: 'BRL', nome: 'Empresa' };
  const r = M.mesclar([
    M.novoAtivo({ ...base, fonte: 'cvm', ticker: 'ZZTA3', setor: 'Energia' }),
    M.novoAtivo({ ...base, fonte: 'b3', ticker: 'ZZTA3', isin: 'US0378331005', nome: 'Nome B3' }),
    M.novoAtivo({ ...base, fonte: 'cvm', ticker: 'ZZTZ3', isin: 'US0378331005' }),
    M.novoAtivo({ ...base, fonte: 'cvm', ticker: 'X', nome: 'código inválido' }),
  ]);
  assert.deepEqual(r.ativos.map((a) => a.assetId), ['BR:B3:ZZTA3']);
  const a = r.ativos[0];
  assert.equal(a.nome, 'Nome B3');                       // a fonte de maior prioridade manda
  assert.equal(a.setor, 'Energia');                      // e o que só a outra tinha é mantido
  assert.deepEqual(a.fontes.map((f) => f.id).sort(), ['b3', 'cvm']);
  assert.equal(r.duplicados.length, 1);
  assert.deepEqual(r.conflitos, [{ isin: 'US0378331005', mantido: 'BR:B3:ZZTA3', removido: 'BR:B3:ZZTZ3' }]);
  assert.equal(r.rejeitados.length, 1);
});

test('importação dos arquivos de teste (formato das fontes oficiais)', () => {
  assert.equal(cat.meta.formato, 'eagles-inv-catalogo-v1');
  assert.equal(cat.meta.teste, true);
  assert.equal(cat.ativos.length, 18);                           // 05.1: a negociação encerrada (ZZTB3) entra como INATIVA
  assert.equal(cat.relatorio.rejeitados.length, 1);              // CNPJ inválido
  assert.equal(cat.relatorio.duplicados.length, 1);              // ZZTX repetido na SEC (05.1: o ZZTA3 repetido no FCA já é unido dentro do adaptador)
  assert.equal(cat.ativos.filter((a) => a.assetId === 'BR:B3:ZZTA3').length, 1);
  assert.ok(cat.relatorio.avisos.some((x) => /B3: adaptador desligado/.test(x)));
  assert.ok(cat.relatorio.avisos.some((x) => /CoinGecko: adaptador desligado/.test(x)));
  assert.deepEqual(cat.relatorio.classificacaoNaoAplicada, ['US:NYSE:NAOEXISTE']); // a classificação manual não cria ativo
  assert.ok(cat.ativos.every((a) => a.teste && M.validarAtivo(a).ok));
  const cls = Object.fromEntries(cat.ativos.map((a) => [a.assetId, a.classe]));
  assert.equal(cls['BR:B3:ZZTB11'], 'acao');   // unit
  assert.equal(cls['BR:B3:ZZTX34'], 'bdr');
  assert.equal(cls['BR:B3:ZZTL11'], 'fii');
  assert.equal(cls['US:NYSE:ZZTR'], 'reit');
  assert.equal(cls['US:NYSEARCA:ZZTE'], 'etf');
  assert.equal(cls['BR:TESOURO:SELIC-2099'], 'tesouro');
  assert.equal(cat.ativos.find((a) => a.assetId === 'BR:B3:ZZTB3').situacao, 'encerrado'); // encerrada: inativa (some da busca padrão)
  assert.ok(!cls['BR:B3:ZZTG13']);                               // balcão fica fora
  assert.ok(!cls['US:-:ZZTN'] && !cls['BR:TESOURO:ANTIGO-2095']); // bolsa desconhecida e título fora da data-base
  assert.equal(cat.ativos.find((a) => a.assetId === 'BR:B3:ZZTL11').codigoDerivado, true);
  assert.equal(cat.ativos.find((a) => a.assetId === 'BR:B3:ZZTC3').situacao, 'cancelado');
  // o catálogo de teste usado pelos testes de tela é exatamente o que o importador gera (o publicado é o real: ver real-051)
  const pub = JSON.parse(readFileSync(new URL('./catalogo-teste/ativos.json', import.meta.url)));
  const meta = JSON.parse(readFileSync(new URL('./catalogo-teste/meta.json', import.meta.url)));
  assert.deepEqual(pub.itens, cat.ativos);
  assert.equal(M.validarCatalogo(meta, pub.itens).ok, true);
});

test('adaptadores: layout diferente do oficial é recusado com mensagem clara (não importa lixo)', () => {
  assert.throws(() => A.cvmCadastro('CNPJ;NOME\n1;2'), /colunas esperadas/);
  assert.throws(() => A.secTickers('{"campos":[]}'), /formato inesperado/);
  assert.throws(() => A.tesouro('A;B\n1;2'), /colunas esperadas/);
  assert.throws(() => A.b3Instrumentos('x'), /desligado/);
  assert.throws(() => A.coingecko('[]'), /desligado/);
  assert.deepEqual(A.lerCsv('a;b\n"x;1";"linha\ncom quebra"\n'), [{ a: 'x;1', b: 'linha\ncom quebra' }]);
});

test('pesquisa: código, nome sem acento, CNPJ, CIK e filtros', () => {
  assert.equal(ids(M.buscar(idx, 'zzta3'))[0], 'BR:B3:ZZTA3');                 // código exato primeiro
  assert.deepEqual(ids(M.buscar(idx, 'ZZTA')).slice(0, 2), ['BR:B3:ZZTA3', 'BR:B3:ZZTA4']);
  assert.ok(ids(M.buscar(idx, 'logistica')).includes('BR:B3:ZZTL11'));      // sem acento acha "LOGÍSTICA"
  const alfa = cat.ativos.find((a) => a.assetId === 'BR:B3:ZZTA3');
  assert.deepEqual(ids(M.buscar(idx, M.fmtCnpj(alfa.ids.cnpj))).sort(), ['BR:B3:ZZTA3', 'BR:B3:ZZTA4']); // CNPJ formatado
  assert.equal(ids(M.buscar(idx, '9990002'))[0], 'US:NYSE:ZZTY');           // CIK sem zeros
  assert.ok(M.buscar(idx, '', { pais: 'US' }).itens.every((a) => a.pais === 'US'));
  assert.ok(M.buscar(idx, '', { classe: 'fii' }).itens.every((a) => a.classe === 'fii'));
  assert.ok(M.buscar(idx, '', { bolsa: 'TESOURO' }).itens.every((a) => a.bolsa === 'TESOURO'));
  assert.ok(M.buscar(idx, '', { setor: 'bancos' }).itens.every((a) => a.setor === 'Bancos'));
  assert.ok(!ids(M.buscar(idx, 'cancelada')).includes('BR:B3:ZZTC3'));        // cancelado fica escondido
  assert.ok(ids(M.buscar(idx, 'cancelada', { incluirInativos: true })).includes('BR:B3:ZZTC3'));
  assert.equal(M.buscar(idx, 'nada-a-ver-xyz').total, 0);
  assert.equal(M.buscar(idx, 'zzt', {}, { limite: 3 }).itens.length, 3);
  const op = M.opcoesFiltro(cat.ativos);
  assert.ok(op.pais.some(([p]) => p === 'BR') && op.classe.some(([c]) => c === 'tesouro'));
});

test('pesquisa externa: só links que a pessoa abre, com dados públicos do ativo', () => {
  const a = cat.ativos.find((x) => x.assetId === 'BR:B3:ZZTA3');
  const l = M.linksExternos(a);
  assert.ok(l.every((x) => x.url.startsWith('https://')));
  assert.ok(l.some((x) => x.id === 'google') && l.some((x) => x.id === 'cvm'));
  const tudo = decodeURIComponent(l.map((x) => x.url).join(' '));
  assert.ok(!/carteira|valor|quantidade|tenant|uid/i.test(tudo));
  assert.ok(M.linksExternos(cat.ativos.find((x) => x.assetId === 'US:NYSE:ZZTY')).some((x) => x.id === 'sec' && /CIK=0009990002/.test(x.url)));
});

test('Market Engine na Biblioteca: sem fonte autorizada, a cotação é "indisponível" (nunca um preço)', () => {
  for (const a of cat.ativos) { const q = M.cotacaoDaBiblioteca(a); assert.equal(q.preco, null); assert.equal(q.estado, 'indisponivel'); }
});

test('favoritos: alternar, limites e formato', () => {
  let f = M.favoritosPadrao();
  f = M.alternarFavorito(f, 'principal', 'BR:B3:ZZTA3');
  assert.equal(M.ehFavorito(f, 'BR:B3:ZZTA3'), true);
  // todo ativo real do catálogo precisa caber num favorito (o código da bolsa tem números: B3)
  for (const a of cat.ativos) assert.equal(M.favoritosValidos(M.alternarFavorito(M.favoritosPadrao(), 'principal', a.assetId)), true, a.assetId);
  f = M.alternarFavorito(f, 'principal', 'BR:B3:ZZTA3');
  assert.equal(M.ehFavorito(f, 'BR:B3:ZZTA3'), false);
  assert.equal(M.favoritosValidos(f), true);
  assert.equal(M.favoritosValidos({ listas: [{ id: 'x', nome: 'X', ativos: Array.from({ length: 501 }, (_, i) => 'BR:B3:ZZT' + i) }] }), false);
  assert.equal(M.favoritosValidos({ listas: Array.from({ length: 21 }, (_, i) => ({ id: 'l' + i, nome: 'L', ativos: [] })) }), false);
  assert.equal(M.favoritosValidos({ listas: [{ id: 'x', nome: 'X', ativos: ['<script>'] }] }), false);
  assert.equal(M.favoritosValidos({ listas: [] }), false);
});

test('consumo (D-03): aviso em 70%, contenção em 100%, e só o essencial continua', () => {
  const L = M.LIMITES;
  assert.equal(L.leituras, 15000); assert.equal(L.gravacoes, 4000); assert.equal(L.exclusoes, 2000);
  assert.equal(M.estadoConsumo({ leituras: 10499 }).estado, 'normal');
  assert.equal(M.estadoConsumo({ leituras: 10500 }).estado, 'aviso');
  assert.equal(M.estadoConsumo({ gravacoes: 2800 }).estado, 'aviso');
  assert.equal(M.estadoConsumo({ exclusoes: 2000 }).estado, 'contencao');
  assert.equal(M.podeExecutar('listar-equipe', 'contencao'), false);
  assert.equal(M.podeExecutar('recarregar-catalogo', 'contencao'), false);
  assert.equal(M.podeExecutar('salvar-favorito', 'contencao'), true);
  assert.equal(M.podeExecutar('listar-equipe', 'aviso'), true);
  const m = M.criarMedidor(); m.contar('leituras', 3, 'x'); m.contar('gravacoes', 1, 'y');
  assert.deepEqual(m.pendente(), { leituras: 3, gravacoes: 1, exclusoes: 0 });
});

test('o núcleo não usa rede, IA nem chaves', () => {
  const fonte = readFileSync(new URL('../inv/inv-motor.js', import.meta.url), 'utf8') + readFileSync(new URL('../inv/inv-biblioteca.js', import.meta.url), 'utf8');
  assert.ok(!/api\.openai|anthropic|generativelanguage|gemini|apiKey|x-api-key|Bearer /i.test(fonte));
  const fetchs = fonte.match(/fetch\(([^)]*)\)/g) || [];
  // Etapa 11: além do catálogo, só o carregador de dados reais (fetch(u, o)), o teste de conexão do Super Admin (DE_TESTE)
  // e (11.18) o estado do robô, que é um arquivo do PRÓPRIO site (inv/dados/status.json)
  assert.ok(fetchs.every((f) => /inv\/catalogo\//.test(f) || /^fetch\('inv\/dados\/status\.json'/.test(f) || /^fetch\(u, o\)$/.test(f) || /^fetch\(DE_TESTE\[id\]/.test(f)), 'busca fora do permitido: ' + fetchs.join(' | '));
  // e o teste de conexão só aponta para fontes APROVADAS ou para arquivos do próprio site
  const testes = [...fonte.matchAll(/(\w+): [`'"](https?:\/\/[^/`'"]+)/g)].filter((m) => /DE_TESTE|bcb_|ust_|fiscaldata/.test(m[1]));
  const D = createRequire(import.meta.url)('../inv/inv-dados.js');
  for (const [, id, host] of testes) assert.ok(D.FONTES[id] && ['aprovada', 'aprovada-condicoes'].includes(D.FONTES[id].estado), `teste de conexão para fonte não aprovada: ${id} ${host}`);
});
