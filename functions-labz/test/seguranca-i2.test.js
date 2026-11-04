// LABZ AI — I2: validação de autenticação, autorização e isolamento DIRETO NA API (sem a interface).
// Tudo pela MESMA porta HTTP da Edge Function labz-api (src/borda/http.js) com o backend real
// (banco em memória; com LABZ_PG_URL, no PostgreSQL pelo preload). Os tokens são do Firebase
// FICTÍCIOS, assinados por chaves RSA geradas na hora (nenhuma chave fica em arquivo).
// Nada aqui fala com a produção: nenhum endereço do Supabase ou do Firebase é usado.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { montarComEmpresas } = require('./ajuda');
const { criarApi, ACOES } = require('../src/api/labz-api');
const { criarVerificadorFirebase } = require('../src/auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../src/auth/acesso-supabase');
const { criarLimitador } = require('../src/borda/limitador');
const { criarHandlerApi } = require('../src/borda/http');
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');

const PROJETO = 'labz-18246';
const ORIGEM = 'https://eagleslabz.com.br';
const URL_API = 'http://localhost/functions/v1/labz-api';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const chave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const outraChave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = chave.publicKey.export({ type: 'spki', format: 'pem' });

// ID token no formato do Firebase. opcoes: alg, kid, priv (outra chave), hmacCom (segredo do HS256)
function token(carga = {}, { alg = 'RS256', kid = 'k1', priv = chave.privateKey, hmacCom } = {}) {
  const agora = Math.floor(Date.now() / 1000);
  const h = { alg, kid, typ: 'JWT' };
  const c = Object.assign({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'sa', iat: agora - 60, auth_time: agora - 120, exp: agora + 3000, email: 'x@teste.local', email_verified: true, firebase: { sign_in_provider: 'password' } }, carga);
  const corpo = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
  if (alg === 'none') return `${corpo}.`;
  if (alg === 'HS256') return `${corpo}.${b64url(crypto.createHmac('sha256', hmacCom || 'qualquer').update(corpo).digest())}`;
  return `${corpo}.${b64url(crypto.createSign('RSA-SHA256').update(corpo).sign(priv))}`;
}

// UIDs: sa (Super Admin), d1 (Diretor), cl (Cliente), sp (sem perfil), fl (Super Admin no perfil, fora da lista do banco)
const LISTA_SERVIDOR = ['sa', 'd1', 'cl', 'sp', 'fl'];
async function montar({ limites = { porMinuto: 100000, tarefasPorHora: 100000 } } = {}) {
  const transporte = criarTransporteSimulado(criarModeloSimulado({}));
  const c = await montarComEmpresas({ ia: { transporte } });
  await c.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await c.banco.gravar('labz_usuarios/d1', { role: 'Diretor', nome: 'Diretor' });
  await c.banco.gravar('labz_usuarios/cl', { role: 'Cliente', nome: 'Cliente' });
  await c.banco.gravar('labz_usuarios/fl', { role: 'SuperAdmin', nome: 'Fora da lista do banco' });
  await c.banco.gravar('labz_config/acesso', { uids: ['sa', 'd1', 'cl', 'sp'] });
  const listaServidor = new Set(LISTA_SERVIDOR);
  const api = criarApi(Object.assign({ servicos: c, banco: c.banco, uidsAutorizados: () => [...listaServidor].join(','), lerSegredo: () => '' }, opcoesApiSupabase(c.banco)));
  const verificador = criarVerificadorFirebase({ projetoId: PROJETO, obterChaves: async () => ({ k1: PEM }) });
  const recusas = [];
  const erros = [];
  const autenticar = criarAcessoSupabase({ verificador, aoRecusar: ({ motivo }) => recusas.push({ etapa: 'token', motivo }) });
  const limitador = criarLimitador({ banco: c.banco, limites });
  const handler = criarHandlerApi({ api, autenticar, limitador, uidPermitido: (u) => listaServidor.has(u), origens: [ORIGEM], registrarRecusa: (r) => recusas.push(r), registrarErro: (e) => erros.push(e) });
  const pedir = async (corpo, { tk = token(), cabecalho, origem = ORIGEM, metodo = 'POST', tipo = 'application/json', bruto, extras = {} } = {}) => {
    const headers = Object.assign({}, extras);
    if (tipo) headers['content-type'] = tipo;
    if (cabecalho !== undefined) headers.authorization = cabecalho; else if (tk) headers.authorization = `Bearer ${tk}`;
    if (origem) headers.origin = origem;
    const r = await handler(new Request(URL_API, { method: metodo, headers, body: metodo === 'POST' ? (bruto !== undefined ? bruto : JSON.stringify(corpo)) : undefined }));
    const texto = await r.text();
    let j = null;
    try { j = texto ? JSON.parse(texto) : null; } catch (e) { j = { cru: texto }; }
    return { status: r.status, headers: r.headers, corpo: j, texto };
  };
  return Object.assign(c, { pedir, recusas, erros, listaServidor });
}

async function retrato(banco) {
  const caminhos = banco._caminhosAsync ? await banco._caminhosAsync() : banco._caminhos();
  return JSON.stringify(await Promise.all(caminhos.sort().map(async (p) => [p, await banco.obter(p)])));
}

const NOMES_ACOES = Object.keys(ACOES);

test('I2-1: TODAS as ações da API exigem login — sem token, com token inválido ou de outro projeto → 401, e o banco não muda', async () => {
  const c = await montar();
  assert.ok(NOMES_ACOES.length >= 60, `ações: ${NOMES_ACOES.length}`);
  const antes = await retrato(c.banco);
  const ruins = [null, 'lixo', token({ aud: 'outro-projeto', iss: 'https://securetoken.google.com/outro-projeto' }), token({}, { priv: outraChave.privateKey })];
  for (const acao of NOMES_ACOES) {
    for (const tk of ruins) {
      const r = await c.pedir({ acao, dados: {} }, { tk });
      assert.equal(r.status, 401, `${acao} com ${tk ? String(tk).slice(0, 8) : 'nada'}`);
      assert.equal(r.corpo.erro.codigo, 'unauthenticated');
      assert.equal(r.corpo.erro.detalhes, undefined, 'nunca revela o motivo');
    }
  }
  assert.equal(await retrato(c.banco), antes, 'nenhuma das recusas gravou no banco');
});

test('I2-2: TODAS as ações recusam quem não é o Super Admin autorizado (intruso, Diretor, Cliente, sem perfil, fora da lista do banco) → 403, a mesma resposta', async () => {
  const c = await montar();
  const pessoas = { intruso: 403, d1: 403, cl: 403, sp: 403, fl: 403 };
  const respostas = new Set();
  for (const acao of NOMES_ACOES) {
    for (const [uid, esperado] of Object.entries(pessoas)) {
      const r = await c.pedir({ acao, dados: {} }, { tk: token({ sub: uid }) });
      assert.equal(r.status, esperado, `${acao} por ${uid}`);
      assert.equal(r.corpo.erro.codigo, 'permission-denied');
      assert.equal(r.corpo.erro.detalhes, undefined);
      respostas.add(JSON.stringify(r.corpo));
    }
  }
  assert.equal(respostas.size, 1, 'a mesma resposta para todos (não dá para descobrir quem existe)');
  // ninguém além do Super Admin criou, mudou ou leu algo: só contadores de limite e a auditoria das negativas
  const caminhos = (c.banco._caminhosAsync ? await c.banco._caminhosAsync() : c.banco._caminhos());
  assert.ok(!caminhos.some((p) => /^labz_limites\/intruso/.test(p)), 'intruso (fora da lista do servidor) não grava nem contador');
  assert.equal((await c.empresas.listarPagina(c.ator, { limite: 100 })).itens.length, 2, 'nenhuma empresa nova');
});

test('I2-3: o Super Admin autorizado passa da autenticação em TODAS as ações (o que sobra é só a validação dos dados)', async () => {
  const c = await montar();
  for (const acao of NOMES_ACOES) {
    const r = await c.pedir({ acao, dados: {} });
    assert.ok(![401, 403].includes(r.status), `${acao}: ${r.status} ${JSON.stringify(r.corpo)}`);
    assert.ok([200, 400, 404, 409].includes(r.status), `${acao}: status ${r.status}`);
  }
  assert.deepEqual(c.erros, [], 'nenhum erro interno');
  const r = await c.pedir({ acao: 'catalogo.agentes' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.resultado.length, 8);
});

test('I2-4: ataques ao token — algoritmo trocado, sem assinatura, carga adulterada, chave desconhecida e cabeçalho torto → 401', async () => {
  const c = await montar();
  const d1 = token({ sub: 'd1' });
  const [h, , ass] = d1.split('.');
  const agora = Math.floor(Date.now() / 1000);
  const adulterado = `${h}.${b64url(JSON.stringify({ iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, sub: 'sa', iat: agora - 60, auth_time: agora - 60, exp: agora + 3000, firebase: { sign_in_provider: 'password' } }))}.${ass}`;
  const casos = {
    'HS256 assinado com a CHAVE PÚBLICA (confusão de algoritmo)': token({}, { alg: 'HS256', hmacCom: PEM }),
    'alg none (sem assinatura)': token({}, { alg: 'none' }),
    'carga trocada para virar Super Admin': adulterado,
    'kid desconhecido': token({}, { kid: 'kX' }),
    'assinado por outra chave': token({}, { priv: outraChave.privateKey }),
    'vencido': token({ exp: agora - 600, iat: agora - 4000, auth_time: agora - 4000 }),
    'emitido no futuro': token({ iat: agora + 600 }),
    'login anônimo': token({ firebase: { sign_in_provider: 'anonymous' } }),
    'outro projeto (aud)': token({ aud: 'outro-projeto' }),
    'outro emissor (iss)': token({ iss: 'https://securetoken.google.com/outro-projeto' }),
    'sem usuário (sub)': token({ sub: '' }),
  };
  for (const [nome, tk] of Object.entries(casos)) assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 401, nome);
  const valido = token();
  // (um "Enter" no fim não entra aqui: o próprio padrão da web (Headers) apara o espaço do fim antes do código ver)
  for (const cab of [`bearer ${valido}`, `Bearer  ${valido}`, `Basic ${valido}`, valido, `Bearer ${valido} extra`, `Bearer ${valido},${valido}`]) {
    assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { cabecalho: cab })).status, 401, JSON.stringify(cab.slice(0, 12)));
  }
  // o token só vale no cabeçalho Authorization: em cookie ou na URL é ignorado
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk: null, extras: { cookie: `token=${valido}` } })).status, 401);
});

test('I2-5: botões de desligar — tirar o UID da lista do banco, trocar o perfil ou tirar da lista do servidor corta o acesso NA HORA (mesmo com o token ainda válido)', async () => {
  const c = await montar();
  const tk = token(); // o mesmo token o tempo todo (o Firebase ainda o considera válido)
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 200);
  await c.banco.gravar('labz_config/acesso', { uids: ['d1'] });
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 403, 'fora da lista do banco');
  await c.banco.gravar('labz_config/acesso', { uids: ['sa'] });
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 200, 'voltou');
  await c.banco.gravar('labz_usuarios/sa', { role: 'Diretor', nome: 'Super' });
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 403, 'perfil trocado');
  await c.banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  c.listaServidor.delete('sa');
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 403, 'fora da lista do servidor (segredo)');
  c.listaServidor.add('sa');
  await c.banco.gravar('labz_config/acesso', {});
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk })).status, 403, 'lista do banco vazia = falha FECHADA');
});

test('I2-6: isolamento entre empresas pela API — histórico, entregas e cursores de uma empresa não mostram a outra', async () => {
  const c = await montar();
  const pa = await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.A.id, objetivo: 'Roteiro de Reels exclusivo da Alfa' } });
  const pb = await c.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c.B.id, objetivo: 'Legendas exclusivas da Beta' } });
  assert.equal(pa.status, 200); assert.equal(pb.status, 200);
  const hist = async (empresaId) => (await c.pedir({ acao: 'execucoes.historico', dados: { empresaId, limite: 50 } })).corpo.resultado.itens;
  const ha = await hist(c.A.id);
  const hb = await hist(c.B.id);
  assert.ok(ha.length >= 1 && ha.every((x) => x.empresaId === c.A.id), 'Alfa só vê Alfa');
  assert.ok(hb.length >= 1 && hb.every((x) => x.empresaId === c.B.id), 'Beta só vê Beta');
  assert.ok(!JSON.stringify(ha).includes('Beta') && !JSON.stringify(hb).includes('Alfa'));
  const ea = await c.pedir({ acao: 'entregas.listar', dados: { empresaId: c.A.id } });
  assert.equal(ea.status, 200);
  assert.ok(ea.corpo.resultado.itens.every((x) => x.empresaId === c.A.id));
  // cursor de uma empresa não serve para paginar a outra (F6 da 3E)
  const pagA = await c.pedir({ acao: 'execucoes.listar', dados: { empresaId: c.A.id, limite: 1 } });
  const cursor = pagA.corpo.resultado.proximo;
  if (cursor) {
    const r = await c.pedir({ acao: 'execucoes.listar', dados: { empresaId: c.B.id, depoisDe: cursor, limite: 1 } });
    assert.ok(r.status !== 200 || r.corpo.resultado.itens.every((x) => x.empresaId === c.B.id), 'cursor preso à empresa');
  }
});

test('I2-7: limites por pessoa (minuto e tarefas por hora) → 429, sem afetar outra pessoa', async () => {
  const c = await montar({ limites: { porMinuto: 5, tarefasPorHora: 2 } });
  for (let i = 0; i < 5; i++) assert.equal((await c.pedir({ acao: 'catalogo.agentes' })).status, 200);
  const r = await c.pedir({ acao: 'catalogo.agentes' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  // o Diretor (na lista do servidor) tem o contador dele: continua recebendo 403, não 429
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk: token({ sub: 'd1' }) })).status, 403);
  const c2 = await montar({ limites: { porMinuto: 100, tarefasPorHora: 2 } });
  for (let i = 0; i < 2; i++) assert.equal((await c2.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c2.A.id, objetivo: `Roteiro de teste número ${i}` } })).status, 200);
  assert.equal((await c2.pedir({ acao: 'execucoes.pedido', dados: { empresaId: c2.A.id, objetivo: 'Roteiro de teste número 3' } })).status, 429, 'tarefas novas por hora');
  assert.equal((await c2.pedir({ acao: 'catalogo.agentes' })).status, 200, 'consultar continua liberado');
});

test('I2-8: auditoria — o que o Super Admin faz fica registrado com quem fez; negativas de quem está na lista também; nada de token no registro', async () => {
  const c = await montar();
  const tk = token();
  assert.equal((await c.pedir({ acao: 'empresas.criar', dados: { empresa: { nome: 'Marca Gama Auditoria' } } }, { tk })).status, 200);
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk: token({ sub: 'd1' }) })).status, 403);
  const tudo = [];
  let depoisDe;
  for (let i = 0; i < 20; i++) { const p = await c.auditoria.listarPagina({ limite: 100, depoisDe }); tudo.push(...p.itens); if (!p.proximo) break; depoisDe = p.proximo; }
  const criou = tudo.find((e) => e.tipo === 'empresa.criada' && e.detalhes && e.detalhes.nome === 'Marca Gama Auditoria');
  assert.ok(criou, `evento da criação: ${JSON.stringify(tudo.map((e) => e.tipo))}`);
  assert.deepEqual(criou.ator, { uid: 'sa' }, 'com quem fez');
  assert.match(criou.alvo, /^labz_empresas\/emp_/);
  assert.ok(tudo.some((e) => e.tipo === 'auth.acesso_negado'), 'negativa do Diretor registrada');
  const texto = JSON.stringify(tudo);
  assert.ok(!texto.includes(tk) && !/eyJ[A-Za-z0-9_-]{20,}/.test(texto), 'nenhum token na auditoria');
});

test('I2-9: respostas limpas — sem cache, sem farejar tipo, sem detalhes internos, CORS só para o site e sem credenciais', async () => {
  const c = await montar();
  const ok = await c.pedir({ acao: 'catalogo.agentes' });
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGEM);
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'false');
  const estranho = await c.pedir({ acao: 'catalogo.agentes' }, { origem: 'https://eagleslabz.com.br.atacante.example' });
  assert.equal(estranho.status, 403);
  assert.equal(estranho.headers.get('access-control-allow-origin'), null, 'não ecoa a origem estranha');
  for (const acao of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'ACOES', '../catalogo.agentes', 'catalogo.agentes ']) {
    const r = await c.pedir({ acao });
    assert.equal(r.status, 400, acao);
    assert.doesNotMatch(r.texto, /at .*\.js|Error:|stack/i, 'sem rastro interno');
  }
  const grande = await c.pedir(null, { bruto: JSON.stringify({ acao: 'catalogo.agentes', dados: { x: 'a'.repeat(210 * 1024) } }) });
  assert.equal(grande.status, 413);
});

test('I2-10: limitação conhecida e documentada — conta desativada/sessão revogada no Firebase continua passando até o token vencer (máx. 1 h); a lista corta na hora', async () => {
  const c = await montar();
  // simulação: a conta foi desativada no Firebase, mas o token emitido antes continua com assinatura e validade corretas
  const tkAntigo = token({ iat: Math.floor(Date.now() / 1000) - 1800, auth_time: Math.floor(Date.now() / 1000) - 1800 });
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk: tkAntigo })).status, 200, 'sem credencial do Firebase, a API não vê a revogação');
  await c.banco.gravar('labz_config/acesso', { uids: [] });
  assert.equal((await c.pedir({ acao: 'catalogo.agentes' }, { tk: tkAntigo })).status, 403, 'a compensação: tirar o UID da lista corta na hora');
});
