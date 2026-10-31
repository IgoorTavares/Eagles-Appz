// Fase 4C.1: registro de entregas, versionamento, integridade, aprovação por
// versão, isolamento e integração com o motor (tudo simulado, armazenamento local).
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, rejeita } = require('./ajuda');
const { transporteComModeloSimulado, criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { caminhos } = require('../src/armazenamento/caminhos');
const { ATOR_SISTEMA } = require('../src/auth/super-admin');
const { sha256 } = require('../src/entregas/armazenamento');
const { TIPOS, validarNome, MAX_BYTES_LOCAL } = require('../src/contratos/entrega');
const { criarApi } = require('../src/api/labz-api');

const montar = (roteiro, transporte) => montarComEmpresas({ ia: { transporte: transporte || transporteComModeloSimulado(roteiro || {}) } });
const md = (texto, nome = 'plano.md') => ({ formato: 'markdown', nome, texto });
async function execucaoDe(c, empresaId, agenteId = '04-roteirista') {
  const exe = await c.execucoes.criar(c.ator, { empresaId, objetivo: 'Escrever a legenda', modo: 'especialista', agenteId });
  await c.motor.planejar(c.ator, exe.id);
  return exe;
}
const nova = (c, exe, extra = {}) => c.entregas.criar(c.ator, Object.assign({ execucaoId: exe.id, etapaId: 'e1', tipo: 'documento', conteudo: md('# Plano\nconteúdo A') }, extra));

test('criação: empresa, execução, tarefa, etapa e agente vêm da EXECUÇÃO; hash do conteúdo guardado', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  assert.deepStrictEqual([e.empresaId, e.execucaoId, e.tarefaId, e.etapaId, e.agenteId, e.tipo, e.versaoAtual, e.estadoAtual, e.versaoAprovada], [c.A.id, exe.id, exe.id, 'e1', '04-roteirista', 'documento', 1, 'rascunho', null]);
  assert.ok(/^ent_/.test(e.id));
  const v = await c.banco.obter(caminhos.versaoEntrega(e.id, 1));
  assert.strictEqual(v.hash, sha256('# Plano\nconteúdo A'));
  assert.strictEqual(v.conteudoRef.caminho, caminhos.conteudoExecucao(exe.id, v.hash), 'conteúdo separado dos metadados, dentro da execução');
  assert.strictEqual(e.hashAtual, v.hash);
  const conteudo = await c.entregas.lerConteudo(c.ator, e.id, 1);
  assert.deepStrictEqual([conteudo.texto, conteudo.integridade], ['# Plano\nconteúdo A', 'conferida']);
  // agente informado diferente do da etapa / etapa inexistente / agente fora da execução
  await rejeita(() => nova(c, exe, { agenteId: '02-designer' }), 'invalido');
  await rejeita(() => nova(c, exe, { etapaId: 'nao-existe' }), 'invalido');
  await rejeita(() => nova(c, exe, { etapaId: null, agenteId: '06-engenheiro' }), 'invalido');
  // campos que o cliente não pode mandar
  await rejeita(() => nova(c, exe, { empresaId: c.B.id }), 'invalido');
  await rejeita(() => nova(c, exe, { id: 'ent_escolhido' }), 'invalido');
  await rejeita(() => c.entregas.criar(c.ator, { execucaoId: 'nao-existe', tipo: 'documento', conteudo: md('x') }), 'nao-encontrado');
});

test('contrato: 8 tipos; formatos por tipo; representação simulada sem fingir arquivo; tamanho máximo; JSON e código', async () => {
  assert.deepStrictEqual(Object.keys(TIPOS).sort(), ['carrossel', 'codigo', 'documento', 'imagem', 'pacote', 'planejamento', 'relatorio', 'roteiro']);
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const img = await nova(c, exe, { tipo: 'imagem', conteudo: { formato: 'simulado', nome: 'arte-1.png', representacao: { descricao: 'Post 1080x1350 com a oferta', largura: 1080, altura: 1350 } } });
  const vi = await c.banco.obter(caminhos.versaoEntrega(img.id, 1));
  assert.strictEqual(vi.arquivoReal, false);
  assert.ok(JSON.parse((await c.entregas.lerConteudo(c.ator, img.id, 1)).texto).aviso.includes('REPRESENTAÇÃO SIMULADA'));
  await rejeita(() => nova(c, exe, { tipo: 'imagem', conteudo: { formato: 'simulado', nome: 'a.png', texto: 'bytes falsos' } }), 'invalido');
  await rejeita(() => nova(c, exe, { tipo: 'imagem', conteudo: md('x', 'a.md') }), 'invalido'); // imagem não aceita markdown
  await rejeita(() => nova(c, exe, { tipo: 'carrossel', conteudo: { formato: 'simulado', nome: 'c.zip' } }), 'invalido'); // sem representação
  const js = await nova(c, exe, { tipo: 'codigo', conteudo: { formato: 'codigo', nome: 'app.js', linguagem: 'javascript', texto: 'console.log(1)' } });
  assert.deepStrictEqual((await c.banco.obter(caminhos.versaoEntrega(js.id, 1))).metadados.inerte, true);
  await rejeita(() => nova(c, exe, { tipo: 'codigo', conteudo: { formato: 'codigo', nome: 'app.js', texto: 'x' } }), 'invalido'); // sem linguagem
  await rejeita(() => nova(c, exe, { tipo: 'roteiro', conteudo: { formato: 'json', nome: 'r.json', texto: '{quebrado' } }), 'invalido');
  await nova(c, exe, { tipo: 'roteiro', conteudo: { formato: 'json', nome: 'r.json', texto: '{"cenas":[]}' } });
  await rejeita(() => nova(c, exe, { conteudo: md('x'.repeat(MAX_BYTES_LOCAL + 1)) }), 'invalido');
  await rejeita(() => nova(c, exe, { conteudo: md('á'.repeat(Math.ceil(MAX_BYTES_LOCAL / 2) + 10)) }), 'invalido'); // limite em BYTES, não caracteres
  await rejeita(() => nova(c, exe, { tipo: 'documento', conteudo: md('x\u0000y') }), 'invalido');
  await rejeita(() => nova(c, exe, { tipo: 'desconhecido' }), 'invalido');
});

test('caminhos maliciosos e referências inválidas: nome nunca é caminho; referência só a do backend', async () => {
  for (const ruim of ['../../etc/passwd.md', 'a/b.md', 'a\\b.md', '.oculto.md', '~/x.md', 'file:///x.md', 'https://site/x.md', 'x.md\u0000', 'a<script>.md', 'semextensao', 'x.exe', '%2e%2e.md', '']) {
    assert.throws(() => validarNome(ruim, 'markdown'), (e) => e.codigo === 'invalido', ruim);
  }
  assert.strictEqual(validarNome('Plano de campanha (v2).md', 'markdown'), 'Plano de campanha (v2).md');
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  // referência adulterada no banco: aponta para outro caminho / outra execução
  const exeB = await execucaoDe(c, c.B.id);
  const eB = await nova(c, exeB, { conteudo: md('segredo da B') });
  const vB = await c.banco.obter(caminhos.versaoEntrega(eB.id, 1));
  for (const ref of [Object.assign({}, vB.conteudoRef), { armazenamento: 'banco-local', caminho: '../../labz_config/acesso', hash: vB.hash }, { armazenamento: 'http', caminho: 'https://x', hash: vB.hash }, { armazenamento: 'banco-local', caminho: 'x', hash: '../x' }]) {
    await c.banco.atualizar(caminhos.versaoEntrega(e.id, 1), { conteudoRef: ref });
    await rejeita(() => c.entregas.lerConteudo(c.ator, e.id, 1), 'invalido');
  }
  assert.throws(() => caminhos.conteudoExecucao(exe.id, '../../x'), (er) => er.codigo === 'invalido');
  await rejeita(() => c.entregas.obter(c.ator, '../labz_config'), 'invalido');
});

test('versionamento: versões imutáveis, a anterior continua disponível, a atual é identificável, histórico com a origem', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  const v1 = await c.banco.obter(caminhos.versaoEntrega(e.id, 1));
  const r2 = await c.entregas.novaVersao(c.ator, e.id, md('# Plano\nconteúdo B'), { versaoBase: 1 });
  assert.strictEqual(r2.versao, 2);
  assert.deepStrictEqual(await c.banco.obter(caminhos.versaoEntrega(e.id, 1)), v1, 'a versão 1 não mudou');
  assert.strictEqual((await c.entregas.lerConteudo(c.ator, e.id, 1)).texto, '# Plano\nconteúdo A');
  const atual = await c.entregas.obter(c.ator, e.id);
  assert.deepStrictEqual([atual.versaoAtual, atual.ultimaVersao, atual.hashAtual], [2, 2, sha256('# Plano\nconteúdo B')]);
  const hist = await c.entregas.versoes(c.ator, e.id);
  assert.deepStrictEqual(hist.itens.map((v) => [v.n, v.origem.tipo]), [[1, 'super-admin'], [2, 'super-admin']]);
  assert.strictEqual(hist.itens[1].origem.versaoBase, 1);
  // versão base velha = conflito (sem sobrescrever)
  await rejeita(() => c.entregas.novaVersao(c.ator, e.id, md('C'), { versaoBase: 1 }), 'conflito');
  // o tipo da entrega não muda por versão
  await rejeita(() => c.entregas.novaVersao(c.ator, e.id, { formato: 'simulado', nome: 'x.png', representacao: { descricao: 'imagem' } }), 'invalido');
});

test('concorrência: gravações simultâneas criam versões distintas; nenhuma é sobrescrita', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => c.entregas.novaVersao(c.ator, e.id, md(`versão paralela ${i}`))));
  assert.deepStrictEqual(rs.map((r) => r.versao).sort(), [2, 3, 4, 5, 6]);
  const hist = (await c.entregas.versoes(c.ator, e.id)).itens;
  assert.strictEqual(new Set(hist.map((v) => v.hash)).size, 6);
  // com versão base, só uma das concorrentes passa
  const rb = await Promise.allSettled([7, 8, 9].map(() => c.entregas.novaVersao(c.ator, e.id, md(`base ${Math.random()}`), { versaoBase: 6 })));
  assert.strictEqual(rb.filter((x) => x.status === 'fulfilled').length, 1);
});

test('integridade: conteúdo alterado por fora é detectado (leitura, aprovação e restauração recusadas) e auditado', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  const v = await c.banco.obter(caminhos.versaoEntrega(e.id, 1));
  await c.banco.atualizar(v.conteudoRef.caminho, { texto: 'conteúdo trocado' });
  await rejeita(() => c.entregas.lerConteudo(c.ator, e.id, 1), 'integridade');
  await rejeita(() => c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: v.hash }), 'integridade');
  await c.entregas.novaVersao(c.ator, e.id, md('outra'));
  await rejeita(() => c.entregas.restaurar(c.ator, e.id, 1, 'voltar à primeira'), 'integridade');
  assert.ok((await c.auditoria.listar()).some((x) => x.tipo === 'entrega.integridade_falhou'));
  // mesmo conteúdo, mesmo hash: guardado uma vez (endereçado pelo conteúdo) e nunca reescrito
  const a = await nova(c, exe, { conteudo: md('igual') });
  const b = await nova(c, exe, { conteudo: md('igual') });
  const va = await c.banco.obter(caminhos.versaoEntrega(a.id, 1));
  const vb = await c.banco.obter(caminhos.versaoEntrega(b.id, 1));
  assert.strictEqual(va.conteudoRef.caminho, vb.conteudoRef.caminho);
});

test('aprovação presa à versão exata (número + hash); versão nova não herda; só o Super Admin decide', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  const h1 = (await c.entregas.obter(c.ator, e.id)).hashAtual;
  await rejeita(() => c.entregas.decidir(ATOR_SISTEMA, e.id, { decisao: 'aprovar', versao: 1, hash: h1 }), 'permissao-negada');
  await rejeita(() => c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: 'a'.repeat(64) }), 'conflito');
  await rejeita(() => c.entregas.decidir(c.ator, e.id, { decisao: 'rejeitar', versao: 1, hash: h1 }), 'invalido'); // sem motivo
  await c.entregas.enviarParaRevisao(c.ator, e.id, 1);
  const ap = await c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: h1 });
  assert.strictEqual(ap.estado, 'aprovada');
  let ent = await c.entregas.obter(c.ator, e.id);
  assert.deepStrictEqual([ent.versaoAprovada, ent.aprovacao.versao, ent.aprovacao.hash], [1, 1, h1]);
  await rejeita(() => c.entregas.decidir(c.ator, e.id, { decisao: 'rejeitar', versao: 1, hash: h1, motivo: 'mudei de ideia' }), 'precondicao'); // aprovada é final
  // nova versão: rascunho, sem aprovação herdada; a aprovação da v1 continua registrada na v1
  const r2 = await c.entregas.novaVersao(c.ator, e.id, md('melhorada'));
  ent = await c.entregas.obter(c.ator, e.id);
  assert.deepStrictEqual([ent.versaoAtual, ent.estadoAtual, ent.versaoAprovada], [2, 'rascunho', 1]);
  assert.strictEqual((await c.banco.obter(caminhos.versaoEntrega(e.id, 2))).decisao, null);
  // decidir sobre a versão antiga = conflito
  await rejeita(() => c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: h1 }), 'conflito');
  await c.entregas.decidir(c.ator, e.id, { decisao: 'pedir-revisao', versao: 2, hash: r2.hash, motivo: 'falta a chamada para ação' });
  assert.strictEqual((await c.entregas.obter(c.ator, e.id)).estadoAtual, 'precisa-revisao');
});

test('recuperação de versão anterior: versão NOVA com o mesmo conteúdo, rastreável, sem aprovação', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  const h1 = (await c.entregas.obter(c.ator, e.id)).hashAtual;
  await c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: h1 });
  await c.entregas.novaVersao(c.ator, e.id, md('ruim'));
  const r = await c.entregas.restaurar(c.ator, e.id, 1, 'a versão 1 era melhor');
  assert.deepStrictEqual([r.versao, r.deVersao, r.hash, r.estado], [3, 1, h1, 'rascunho']);
  const v3 = await c.banco.obter(caminhos.versaoEntrega(e.id, 3));
  assert.deepStrictEqual([v3.origem.tipo, v3.origem.deVersao, v3.decisao], ['restauracao', 1, null]);
  assert.strictEqual((await c.entregas.lerConteudo(c.ator, e.id, 3)).texto, '# Plano\nconteúdo A');
  assert.strictEqual((await c.entregas.versoes(c.ator, e.id)).itens.length, 3, 'nada apagado');
  await rejeita(() => c.entregas.restaurar(ATOR_SISTEMA, e.id, 1, 'agente tentando'), 'permissao-negada');
  await rejeita(() => c.entregas.restaurar(c.ator, e.id, 1, ''), 'invalido');
});

test('integração com o motor: cada etapa válida vira entrega; consolidação vai para aprovação; revisão vira versão nova', async () => {
  let n = 0;
  const c = await montar((meta) => (meta.etapaId === 'consolidacao' && ++n === 1 ? 'revisar:textos' : 'ok'));
  const o = await c.motor.pedido(c.ator, { empresaId: c.A.id, objetivo: 'Produzir conteúdos para redes sociais: posts e legendas.' });
  await c.executorLocal().drenar();
  const exe = await c.execucoes.obter(c.ator, o.id);
  assert.strictEqual(exe.estado, 'COMPLETED');
  const lista = (await c.entregas.listar(c.ator, { execucaoId: o.id })).itens;
  assert.deepStrictEqual(lista.map((e) => e.etapaId).sort(), ['consolidacao', 'pecas', 'textos']);
  lista.forEach((e) => assert.strictEqual(e.empresaId, c.A.id));
  const textos = lista.find((e) => e.etapaId === 'textos');
  assert.deepStrictEqual([textos.agenteId, textos.tipo, textos.versaoAtual], ['04-roteirista', 'roteiro', 2], 'refeita na revisão interna = versão 2');
  const cons = lista.find((e) => e.etapaId === 'consolidacao');
  assert.deepStrictEqual([cons.estadoAtual, cons.tipo], ['em-revisao', 'relatorio'], 'a entrega final aguarda o Super Admin');
  const etapaTextos = exe.etapas.find((x) => x.id === 'textos');
  assert.deepStrictEqual([etapaTextos.resultado.entrega.id, etapaTextos.resultado.entrega.versao], [textos.id, 2]);
  const v = await c.entregas.lerConteudo(c.ator, textos.id, 2);
  const res = await c.banco.obter(caminhos.resultadoEtapa(o.id, 'textos'));
  assert.strictEqual(v.texto, res.texto, 'a entrega é o resultado efetivamente gravado');
  const aguardando = (await c.entregas.listar(c.ator, { estado: 'em-revisao' })).itens;
  assert.deepStrictEqual(aguardando.map((e) => e.id), [cons.id]);
  // a aprovação final continua só do Super Admin
  await c.entregas.decidir(c.ator, cons.id, { decisao: 'aprovar', versao: cons.versaoAtual, hash: cons.hashAtual });
});

test('duplicação: a mesma etapa/tentativa não gera duas versões (idempotente)', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  await c.motor.trabalhar('t1');
  const id = c.entregas.idDaEtapa(exe.id, 'e1');
  // repetir o registro da mesma etapa na mesma tentativa (ex.: nova tentativa de gravação)
  const atual = Object.assign({ id: exe.id }, await c.banco.obter(caminhos.tarefa(exe.id)), { estado: 'RUNNING' });
  const etapa = atual.etapas[0];
  const res = await c.banco.obter(caminhos.resultadoEtapa(exe.id, 'e1'));
  let r;
  await c.banco.transacao(async (t) => { r = await c.entregas.registrarDaEtapa(t, { exe: atual, etapa, tentativa: 1, texto: res.texto }); });
  assert.deepStrictEqual([r.duplicada, r.versao], [true, 1]);
  await c.banco.transacao(async (t) => { r = await c.entregas.registrarDaEtapa(t, { exe: atual, etapa, tentativa: 2, texto: res.texto }); });
  assert.deepStrictEqual([r.duplicada, r.versao], [true, 1], 'mesmo conteúdo também não duplica');
  assert.strictEqual((await c.entregas.versoes(c.ator, id)).itens.length, 1);
});

test('cancelamento durante a gravação e executor com reserva expirada: nada é registrado', async () => {
  // a execução é cancelada enquanto o "modelo" responde: o resultado chega, mas a gravação é recusada
  const responder = criarModeloSimulado();
  let c;
  const transporte = criarTransporteSimulado(async (x) => {
    if (x.meta.etapaId === 'e1') await c.execucoes.transicionar(c.ator, x.meta.execucaoId || c._exe, 'CANCELLED', { motivo: 'cancelado no meio' });
    return responder(x);
  });
  c = await montar(null, transporte);
  const exe = await execucaoDe(c, c.A.id);
  c._exe = exe.id;
  const r = await c.motor.trabalhar('t1');
  assert.strictEqual(r.resultado, 'interrompida');
  assert.strictEqual((await c.execucoes.obter(c.ator, exe.id)).estado, 'CANCELLED');
  assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 0, 'nada gravado depois do cancelamento');
  assert.strictEqual(await c.banco.obter(caminhos.entrega(c.entregas.idDaEtapa(exe.id, 'e1'))), null);

  // outro executor assumiu (o crachá mudou): quem perdeu a reserva não grava a entrega
  const responder2 = criarModeloSimulado();
  let c2;
  const t2 = criarTransporteSimulado(async (x) => {
    if (x.meta.etapaId === 'e1' && !c2._feito) {
      c2._feito = true;
      await c2.banco.atualizar(caminhos.tarefa(c2._exe), { execucaoAtual: { token: 'crc_de_outro_executor', trabalhador: 'outro', desde: c2.relogio() } });
    }
    return responder2(x);
  });
  c2 = await montar(null, t2);
  const e2 = await execucaoDe(c2, c2.A.id);
  c2._exe = e2.id;
  const r2 = await c2.motor.trabalhar('perdedor');
  assert.deepStrictEqual([r2.resultado, r2.motivo], ['interrompida', 'executor-substituido']);
  assert.strictEqual((await c2.entregas.listar(c2.ator, { execucaoId: e2.id })).itens.length, 0);
});

test('isolamento: agente só vê entregas da própria execução; não aprova, não muda empresa, não apaga', async () => {
  const c = await montar();
  const exeA = await execucaoDe(c, c.A.id);
  const exeB = await execucaoDe(c, c.B.id);
  await c.executorLocal().drenar();
  const idA = c.entregas.idDaEtapa(exeA.id, 'e1');
  const idB = c.entregas.idDaEtapa(exeB.id, 'e1');
  // nova execução da A, ainda aberta, para a porta do agente
  const aberta = await execucaoDe(c, c.A.id);
  const porta = c.entregas.abrirParaAgente('04-roteirista', aberta.id);
  await rejeita(() => porta.ler(idB), 'isolamento');
  await rejeita(() => porta.ler(idA), 'isolamento'); // mesma empresa, mas outra execução
  assert.deepStrictEqual(await porta.listar(), []);
  assert.ok((await c.auditoria.listar()).some((e) => e.tipo === 'entrega.acesso_negado'));
  // agente fora da execução não abre a porta
  await rejeita(() => c.entregas.abrirParaAgente('06-engenheiro', aberta.id).listar(), 'permissao-negada');
  // a porta não tem aprovar, apagar nem nova versão
  assert.deepStrictEqual(Object.keys(porta).sort(), ['agenteId', 'execucaoId', 'ler', 'listar', 'proporRevisao']);
  assert.ok(!('apagar' in c.entregas) && !('excluir' in c.entregas));
  // agente pode propor revisão só da entrega DELE
  await c.motor.trabalhar('t-aberta');
  const idAberta = c.entregas.idDaEtapa(aberta.id, 'e1');
  // a execução terminou: a porta só vale com a execução aberta
  await rejeita(() => porta.proporRevisao(idAberta), 'precondicao');
  await rejeita(() => c.entregas.enviarParaRevisao(ATOR_SISTEMA, idAberta, 1, { agenteId: '02-designer' }), 'permissao-negada');
  await c.entregas.enviarParaRevisao(ATOR_SISTEMA, idAberta, 1, { agenteId: '04-roteirista' });
  assert.strictEqual((await c.entregas.obter(c.ator, idAberta)).estadoAtual, 'em-revisao');
  // consulta por empresa: só a empresa pedida; cursor de outra empresa recusado
  const daA = (await c.entregas.listar(c.ator, { empresaId: c.A.id })).itens;
  assert.ok(daA.length === 2 && daA.every((e) => e.empresaId === c.A.id));
  await rejeita(() => c.entregas.listar(c.ator, { empresaId: c.A.id, depoisDe: idB }), 'invalido');
});

test('paginação e consultas limitadas: por empresa, execução, agente, versões e aguardando aprovação', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  for (let i = 0; i < 7; i++) await nova(c, exe, { conteudo: md(`doc ${i}`, `doc-${i}.md`) });
  let pagina = await c.entregas.listar(c.ator, { empresaId: c.A.id, limite: 3 });
  const vistos = [...pagina.itens.map((x) => x.id)];
  while (pagina.proximo) { pagina = await c.entregas.listar(c.ator, { empresaId: c.A.id, limite: 3, depoisDe: pagina.proximo }); vistos.push(...pagina.itens.map((x) => x.id)); }
  assert.strictEqual(new Set(vistos).size, 7);
  assert.strictEqual((await c.entregas.listar(c.ator, { empresaId: c.A.id, agenteId: '04-roteirista' })).itens.length, 7);
  assert.strictEqual((await c.entregas.listar(c.ator, { agenteId: '02-designer' })).itens.length, 0);
  await rejeita(() => c.entregas.listar(c.ator, {}), 'invalido'); // nunca a coleção inteira
  await rejeita(() => c.entregas.listar(c.ator, { estado: 'qualquer' }), 'invalido');
  const e = (await c.entregas.listar(c.ator, { execucaoId: exe.id, limite: 1 })).itens[0];
  for (let i = 0; i < 12; i++) await c.entregas.novaVersao(c.ator, e.id, md(`v${i}`));
  let pv = await c.entregas.versoes(c.ator, e.id, { limite: 5 });
  const ns = pv.itens.map((v) => v.n);
  while (pv.proximo) { pv = await c.entregas.versoes(c.ator, e.id, { limite: 5, depoisDe: pv.proximo }); ns.push(...pv.itens.map((v) => v.n)); }
  assert.deepStrictEqual(ns, Array.from({ length: 13 }, (_, i) => i + 1), 'versões em ordem numérica (10 depois de 9)');
  const est = c.banco.estatisticas();
  assert.strictEqual(est.porColecao.labz_entregas ? est.porColecao.labz_entregas.listar : 0, 0, 'nenhuma leitura da coleção inteira');
});

test('auditoria sem conteúdo privado: nem texto, nem nome, nem descrição das entregas', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe, { conteudo: { formato: 'markdown', nome: 'NOME-SECRETO.md', descricao: 'DESCRICAO-SECRETA', texto: 'TEXTO-SECRETO' } });
  const h = (await c.entregas.obter(c.ator, e.id)).hashAtual;
  await c.entregas.decidir(c.ator, e.id, { decisao: 'aprovar', versao: 1, hash: h });
  await c.executorLocal().drenar();
  const ev = JSON.stringify((await c.auditoria.listar()).filter((x) => x.tipo.startsWith('entrega.')));
  assert.ok(ev.includes('entrega.criada') && ev.includes('entrega.decidida') && ev.includes('entrega.registrada_da_etapa'));
  for (const p of ['NOME-SECRETO', 'DESCRICAO-SECRETA', 'TEXTO-SECRETO', '[SIMULADO]', h]) assert.ok(!ev.includes(p), `auditoria sem ${p.slice(0, 20)}`);
});

test('API: só o Super Admin; ações de entrega validadas; não existe apagar', async () => {
  const c = await montar();
  const api = criarApi({ servicos: c, banco: c.banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const chamar = (uid, acao, dados) => api({ auth: { uid, token: {} }, data: { acao, dados } });
  const exe = await execucaoDe(c, c.A.id);
  const e = (await chamar('sa', 'entregas.criar', { entrega: { execucaoId: exe.id, etapaId: 'e1', tipo: 'planejamento', conteudo: md('# P') } })).resultado;
  await rejeita(() => chamar('d1', 'entregas.listar', { empresaId: c.A.id }), 'permissao-negada');
  assert.strictEqual((await chamar('sa', 'entregas.aguardandoAprovacao', {})).resultado.itens.length, 0);
  await chamar('sa', 'entregas.enviarParaRevisao', { entregaId: e.id, versao: 1 });
  assert.strictEqual((await chamar('sa', 'entregas.aguardandoAprovacao', { empresaId: c.A.id })).resultado.itens.length, 1);
  const r = await chamar('sa', 'entregas.decidir', { entregaId: e.id, decisao: { decisao: 'aprovar', versao: 1, hash: e.hashAtual } });
  assert.strictEqual(r.resultado.estado, 'aprovada');
  const acoes = Object.keys(require('../src/api/labz-api').ACOES).filter((a) => a.startsWith('entregas.'));
  assert.ok(!acoes.some((a) => /apagar|excluir|remover|deletar/.test(a)));
  await rejeita(() => chamar('sa', 'entregas.versoes', { entregaId: e.id, depoisDe: '../1' }), 'invalido');
});

test('versão existente nunca é sobrescrita, mesmo com o contador da entrega adulterado', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const e = await nova(c, exe);
  await c.entregas.novaVersao(c.ator, e.id, md('v2'));
  const v2 = await c.banco.obter(caminhos.versaoEntrega(e.id, 2));
  await c.banco.atualizar(caminhos.entrega(e.id), { ultimaVersao: 1 }); // contador velho (gravação fora de ordem)
  await rejeita(() => c.entregas.novaVersao(c.ator, e.id, md('tentativa de sobrescrever')), 'conflito');
  assert.deepStrictEqual(await c.banco.obter(caminhos.versaoEntrega(e.id, 2)), v2);
});

test('o motor registra a entrega DENTRO da transação do crachá (atômico com o resultado da etapa)', async () => {
  const c = await montar();
  const exe = await execucaoDe(c, c.A.id);
  const original = c.entregas.registrarDaEtapa;
  const vistos = [];
  c.entregas.registrarDaEtapa = async (t, d) => { vistos.push(t); return original(t, d); };
  try { await c.motor.trabalhar('t1'); } finally { c.entregas.registrarDaEtapa = original; }
  assert.strictEqual(vistos.length, 1);
  assert.ok(vistos[0] !== c.banco && vistos[0].emTransacao === true, 'gravado pela transação, não direto no banco');
  assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 1);
});
