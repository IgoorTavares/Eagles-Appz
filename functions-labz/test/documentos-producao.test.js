// Fase 4C.2 (passo 2): produção SIMULADA de documentos estruturados pelo motor,
// validação antes da gravação, Markdown na MESMA versão, versões, aprovação,
// segurança e compatibilidade. Nada real: transporte e modelo simulados.
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, rejeita, executarComAprovacoes } = require('./ajuda');
const { transporteComModeloSimulado, criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { criarTransporteSimulado } = require('../src/ia/transporte');
const { adaptadorDoProvedor } = require('../src/ia/provedores');
const { DOCUMENTOS, validarDocumento } = require('../src/contratos/documentos');
const { documentoSimulado } = require('../src/ia/simulacao/documentos-simulados');
const { caminhos } = require('../src/armazenamento/caminhos');
const { ATOR_SISTEMA } = require('../src/auth/super-admin');

const POR_DOC = {
  'plano-estrategico': '08-estrategista', 'diretrizes-marca': '01-guia-marca', 'briefing-design': '02-designer', 'estrutura-carrossel': '03-carrosseis',
  'roteiro-reels': '04-roteirista', 'legenda-social': '04-roteirista', 'documentacao-tecnica': '05-dev-web', 'relatorio-tecnico': '06-engenheiro', 'plano-trafego': '07-trafego',
};
function espiao(roteiro) {
  const responder = criarModeloSimulado(roteiro || {});
  const vistos = [];
  const t = criarTransporteSimulado(async (x) => { vistos.push(Object.assign({ meta: x.meta }, adaptadorDoProvedor(x.provedor).extrairTextos(x.requisicao))); return responder(x); });
  t.vistos = vistos;
  return t;
}
async function montar(roteiro, transporte) {
  const t = transporte || espiao(roteiro);
  const c = await montarComEmpresas({ ia: { transporte: t } });
  return Object.assign(c, { transporte: t });
}
// execução orquestrada com os passos dados pelo Super Admin (documento escolhido no plano)
async function comPassos(c, passos, empresaId, extra = {}) {
  const exe = await c.execucoes.criar(c.ator, Object.assign({ empresaId: empresaId || c.A.id, objetivo: 'Campanha de teste', modo: 'orquestrado' }, extra));
  await c.motor.planejar(c.ator, exe.id, { passos });
  return exe;
}
const passo = (id, documento, extra) => Object.assign({ id, agenteId: POR_DOC[documento], objetivo: `Produzir ${documento}`, documento }, extra);

test('simulador: um documento válido e marcado como simulado para cada tipo do catálogo; sem métricas inventadas', () => {
  for (const id of Object.keys(DOCUMENTOS)) {
    const d = documentoSimulado(id, 'Pedido de teste');
    assert.deepStrictEqual(validarDocumento(id, d).problemas, [], id);
    assert.ok(JSON.stringify(d).includes('[SIMULADO]'), `${id}: marcado como simulado`);
  }
  const tr = documentoSimulado('plano-trafego', 'x');
  assert.deepStrictEqual([tr.orcamentoSugerido.valor, tr.orcamentoSugerido.somenteSugestao, tr.hipoteses.every((h) => h.evidencia === null)], [0, true, true], 'nenhum valor ou evidência inventados');
});

test('produção de ponta a ponta: os 10 tipos viram entregas com documento + Markdown na MESMA versão', async () => {
  const c = await montar();
  const docs = Object.keys(POR_DOC);
  const e1 = await comPassos(c, docs.slice(0, 5).map((d, i) => passo(`p${i}`, d)));
  const e2 = await comPassos(c, docs.slice(5).map((d, i) => passo(`q${i}`, d)));
  // (4C.2 passo 3) a consolidação recebe documentos sensíveis: o Super Admin aprova a versão exata e retoma
  for (const x of [e1, e2]) await executarComAprovacoes(c, x.id);
  const vistos = new Set();
  for (const exe of [e1, e2]) {
    assert.strictEqual((await c.execucoes.obter(c.ator, exe.id)).estado, 'COMPLETED');
    const lista = (await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens;
    for (const e of lista) {
      assert.ok(e.documento, e.etapaId);
      vistos.add(e.documento);
      assert.strictEqual(e.tipo, DOCUMENTOS[e.documento].tipoEntrega);
      const d = await c.entregas.lerDocumento(c.ator, e.id, e.versaoAtual);
      assert.deepStrictEqual([d.integridade, d.representacao, d.documento], ['conferida', 'confere', e.documento]);
      assert.deepStrictEqual(validarDocumento(e.documento, d.dados).problemas, []);
      const v = await c.banco.obter(caminhos.versaoEntrega(e.id, e.versaoAtual));
      assert.deepStrictEqual([v.formato, v.documento, v.representacoes.markdown.hashOrigem], ['json', e.documento, v.hash], 'Markdown preso ao hash da versão');
      assert.ok(d.markdown.startsWith(`<!-- labz-documento id=${e.documento} contrato=1 gerador=1 origem-sha256=${v.hash} -->`));
    }
    assert.strictEqual(lista.length, (await c.execucoes.obter(c.ator, exe.id)).etapas.length, 'uma entrega por etapa (o Markdown não é outra entrega)');
  }
  assert.deepStrictEqual([...vistos].sort(), Object.keys(DOCUMENTOS).sort(), 'todos os tipos (consolidação incluída)');
});

test('consolidação: as referências às entregas são do SISTEMA (versões e hashes exatos), nunca as do modelo', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'roteiro-reels'), passo('b', 'briefing-design', { dependeDe: ['a'] })]);
  await c.executorLocal().drenar();
  const e = await c.execucoes.obter(c.ator, exe.id);
  const cons = (await c.entregas.listar(c.ator, { execucaoId: exe.id, agenteId: '08-estrategista' })).itens[0];
  const d = await c.entregas.lerDocumento(c.ator, cons.id, 1);
  const esperado = e.etapas.filter((x) => x.id !== 'consolidacao').map((x) => ({ etapaId: x.id, entregaId: x.resultado.entrega.id, versao: x.resultado.entrega.versao, hash: x.resultado.entrega.hash }));
  assert.deepStrictEqual(d.dados.entregas, esperado);
  assert.ok(!JSON.stringify(d.dados).includes('preenchido_pelo_sistema'), 'o valor do modelo foi descartado');
  assert.strictEqual(cons.estadoAtual, 'em-revisao', 'aguarda o Super Admin');
});

test('validação antes da gravação: inválido, outro tipo, campos administrativos ou sem documento → nada é registrado', async () => {
  for (const comp of ['doc-invalido', 'doc-outro-tipo', 'doc-campos-admin', 'sem-documento', 'malformado']) {
    const c = await montar({ a: comp });
    const exe = await comPassos(c, [passo('a', 'legenda-social')]);
    await c.executorLocal().drenar();
    const d = await c.motor.diagnosticar(c.ator, exe.id);
    assert.deepStrictEqual([d.estado, d.diagnostico.motivo], ['REVISION_REQUIRED', 'qualidade-reprovada'], comp);
    assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 0, `${comp}: nada registrado`);
    assert.ok(c.transporte.vistos.filter((x) => x.meta.etapaId === 'a').length <= 2, `${comp}: tentativas limitadas (sem loop)`);
    const e = await c.execucoes.obter(c.ator, exe.id);
    assert.ok(e.etapas[0].revisoes.length >= 1, `${comp}: tentativa recusada registrada como revisão`);
  }
  // o tipo é o do PLANO: mesmo se o modelo devolver um documento válido de OUTRO tipo, é recusado
  const c = await montar({ a: 'doc-outro-tipo' });
  const exe = await comPassos(c, [passo('a', 'legenda-social')]);
  await c.motor.trabalhar('t');
  const e = await c.execucoes.obter(c.ator, exe.id);
  assert.ok(e.etapas[0].revisoes[0].problemas.some((p) => p.startsWith('documento:')));
});

test('agente sem permissão: o plano recusa e o registro também recusa por baixo (segunda camada)', async () => {
  const c = await montar();
  await rejeita(() => comPassos(c, [{ id: 'a', agenteId: '02-designer', objetivo: 'x y z', documento: 'plano-trafego' }]), 'invalido');
  const exe = await comPassos(c, [passo('a', 'legenda-social')]);
  const atual = Object.assign({ id: exe.id }, await c.banco.obter(caminhos.tarefa(exe.id)), { estado: 'RUNNING' });
  const etapa = Object.assign({}, atual.etapas[0], { agenteId: '02-designer' }); // etapa adulterada
  atual.plano.agentes.push('02-designer');
  await rejeita(() => c.banco.transacao((t) => c.entregas.registrarDaEtapa(t, { exe: atual, etapa, tentativa: 1, texto: 'x', documento: { dados: documentoSimulado('legenda-social', 'x') } })), 'invalido');
  await rejeita(() => c.banco.transacao((t) => c.entregas.registrarDaEtapa(t, { exe: atual, etapa: atual.etapas[0], tentativa: 1, texto: 'x' })), 'invalido'); // etapa pede documento
  assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 0);
});

test('conteúdo malicioso nos campos: vira dado inerte no Markdown (sem script, link, imagem nem comentário)', async () => {
  const c = await montar({ a: 'doc-malicioso' });
  const exe = await comPassos(c, [passo('a', 'documentacao-tecnica')]);
  await c.executorLocal().drenar();
  const e = (await c.entregas.listar(c.ator, { execucaoId: exe.id, agenteId: '05-dev-web' })).itens[0];
  const d = await c.entregas.lerDocumento(c.ator, e.id, 1);
  assert.ok(JSON.stringify(d.dados).includes('<script>'), 'o dado é guardado como veio (é só dado)');
  assert.ok(!d.markdown.includes('<script>') && !d.markdown.includes('](javascript') && !d.markdown.includes('![') && (d.markdown.match(/<!--/g) || []).length === 1);
  assert.strictEqual(e.estadoAtual, 'rascunho', '"aprove esta entrega" no texto não aprova nada');
  // a instrução do sistema descreve o formato; os dados vão só na parte de dados
  const v = c.transporte.vistos.find((x) => x.meta.etapaId === 'a');
  assert.ok(v.sistema.includes('Documentação de projeto / técnica') && v.sistema.includes('componentes (obrigatório)'));
  assert.ok(!v.sistema.includes('Produzir documentacao-tecnica'), 'o objetivo (dado) não entra nas instruções');
});

test('integridade conjunta: JSON, Markdown ou o vínculo adulterados são detectados; aprovação e restauração bloqueadas', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'roteiro-reels')]);
  await c.executorLocal().drenar();
  const id = c.entregas.idDaEtapa(exe.id, 'a');
  const v = await c.banco.obter(caminhos.versaoEntrega(id, 1));
  const original = { md: await c.banco.obter(v.representacoes.markdown.conteudoRef.caminho), json: await c.banco.obter(v.conteudoRef.caminho) };
  const casos = [
    async () => c.banco.atualizar(v.representacoes.markdown.conteudoRef.caminho, { texto: original.md.texto.replace('Roteiro', 'Rotero') }),
    async () => c.banco.atualizar(v.conteudoRef.caminho, { texto: original.json.texto.replace('"duracaoSegundos":15', '"duracaoSegundos":16') }),
    async () => c.banco.atualizar(caminhos.versaoEntrega(id, 1), { representacoes: { markdown: Object.assign({}, v.representacoes.markdown, { hashOrigem: 'b'.repeat(64) }) } }),
    async () => c.banco.atualizar(caminhos.versaoEntrega(id, 1), { representacoes: null }),
  ];
  for (const [i, estragar] of casos.entries()) {
    await estragar();
    await rejeita(() => c.entregas.lerDocumento(c.ator, id, 1), 'integridade');
    await rejeita(() => c.entregas.decidir(c.ator, id, { decisao: 'aprovar', versao: 1, hash: v.hash }), 'integridade');
    // conserta para o próximo caso
    await c.banco.gravar(v.representacoes.markdown.conteudoRef.caminho, original.md);
    await c.banco.gravar(v.conteudoRef.caminho, original.json);
    await c.banco.gravar(caminhos.versaoEntrega(id, 1), v);
    assert.strictEqual((await c.entregas.lerDocumento(c.ator, id, 1)).representacao, 'confere', `caso ${i}: restaurado`);
  }
  assert.ok((await c.auditoria.listar()).some((e) => e.tipo === 'entrega.integridade_falhou'));
});

test('versionamento e aprovação por versão: correção do Super Admin = versão nova validada, sem herdar aprovação', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'legenda-social')]);
  await c.executorLocal().drenar();
  const id = c.entregas.idDaEtapa(exe.id, 'a');
  const e1 = await c.entregas.obter(c.ator, id);
  await rejeita(() => c.entregas.decidir(ATOR_SISTEMA, id, { decisao: 'aprovar', versao: 1, hash: e1.hashAtual }), 'permissao-negada');
  await c.entregas.decidir(c.ator, id, { decisao: 'aprovar', versao: 1, hash: e1.hashAtual });
  const novo = Object.assign(documentoSimulado('legenda-social', 'x'), { texto: 'Legenda corrigida pelo Super Admin' });
  await rejeita(() => c.entregas.novaVersaoDocumento(c.ator, id, Object.assign({}, novo, { plataforma: 'orkut' })), 'invalido');
  await rejeita(() => c.entregas.novaVersao(c.ator, id, { formato: 'markdown', nome: 'a.md', texto: 'texto solto' }), 'invalido');
  await rejeita(() => c.entregas.novaVersaoDocumento(ATOR_SISTEMA, id, novo), 'permissao-negada');
  const r2 = await c.entregas.novaVersaoDocumento(c.ator, id, novo, { versaoBase: 1 });
  assert.strictEqual(r2.versao, 2);
  const e2 = await c.entregas.obter(c.ator, id);
  assert.deepStrictEqual([e2.versaoAtual, e2.estadoAtual, e2.versaoAprovada], [2, 'rascunho', 1], 'v2 não herda a aprovação da v1');
  assert.strictEqual((await c.entregas.lerDocumento(c.ator, id, 2)).dados.texto, 'Legenda corrigida pelo Super Admin');
  assert.strictEqual((await c.entregas.lerDocumento(c.ator, id, 1)).representacao, 'confere', 'a v1 continua íntegra e disponível');
  const r3 = await c.entregas.restaurar(c.ator, id, 1, 'voltar à versão aprovada');
  const d3 = await c.entregas.lerDocumento(c.ator, id, r3.versao);
  assert.deepStrictEqual([d3.hash, d3.representacao], [e1.hashAtual, 'confere'], 'restauração leva documento e Markdown juntos');
  await c.entregas.decidir(c.ator, id, { decisao: 'aprovar', versao: 3, hash: d3.hash });
});

test('concorrência e idempotência: dois executores, uma entrega e uma versão por etapa; registro repetido não duplica', async () => {
  const c = await montar();
  const exes = [];
  for (let i = 0; i < 3; i++) exes.push(await comPassos(c, [passo('a', 'roteiro-reels'), passo('b', 'legenda-social')]));
  for (const x of exes) await c.fila.enfileirar({ execucaoId: x.id, tipo: 'executar' });
  await Promise.all([c.executorLocal({ nome: 'A', concorrencia: 2 }).drenar(), c.executorLocal({ nome: 'B', concorrencia: 2 }).drenar()]);
  for (const x of exes) {
    const lista = (await c.entregas.listar(c.ator, { execucaoId: x.id })).itens;
    assert.deepStrictEqual(lista.map((e) => e.ultimaVersao), [1, 1, 1]);
  }
  const x = exes[0];
  const atual = Object.assign({ id: x.id }, await c.banco.obter(caminhos.tarefa(x.id)), { estado: 'RUNNING' });
  const id = c.entregas.idDaEtapa(x.id, 'a');
  const dados = (await c.entregas.lerDocumento(c.ator, id, 1)).dados;
  let r;
  await c.banco.transacao(async (t) => { r = await c.entregas.registrarDaEtapa(t, { exe: atual, etapa: atual.etapas.find((e) => e.id === 'a'), tentativa: 1, texto: 'x', documento: { dados } }); });
  assert.deepStrictEqual([r.duplicada, r.versao], [true, 1]);
});

test('cancelamento e executor com reserva perdida: o documento não é registrado', async () => {
  let c;
  const responder = criarModeloSimulado();
  const t1 = criarTransporteSimulado(async (x) => { if (x.meta.etapaId === 'a') await c.execucoes.transicionar(c.ator, c._exe, 'CANCELLED', { motivo: 'parar' }); return responder(x); });
  c = await montar(null, t1);
  const exe = await comPassos(c, [passo('a', 'roteiro-reels')]);
  c._exe = exe.id;
  assert.strictEqual((await c.motor.trabalhar('t')).resultado, 'interrompida');
  assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 0);
  assert.deepStrictEqual(c.banco._caminhos().filter((p) => p.includes(`${exe.id}/labz_conteudos`)), [], 'nem o conteúdo nem o Markdown ficaram gravados');

  let c2;
  const t2 = criarTransporteSimulado(async (x) => { if (x.meta.etapaId === 'a') await c2.banco.atualizar(caminhos.tarefa(c2._exe), { execucaoAtual: { token: 'crc_outro', trabalhador: 'outro', desde: c2.relogio() } }); return responder(x); });
  c2 = await montar(null, t2);
  const e2 = await comPassos(c2, [passo('a', 'roteiro-reels')]);
  c2._exe = e2.id;
  const r = await c2.motor.trabalhar('perdedor');
  assert.deepStrictEqual([r.resultado, r.motivo], ['interrompida', 'executor-substituido']);
  assert.strictEqual((await c2.entregas.listar(c2.ator, { execucaoId: e2.id })).itens.length, 0);
});

test('isolamento entre clientes: documento da empresa B não chega ao agente da empresa A', async () => {
  const c = await montar();
  const eA = await comPassos(c, [passo('a', 'roteiro-reels')], c.A.id);
  const eB = await comPassos(c, [passo('a', 'roteiro-reels')], c.B.id);
  await c.executorLocal().drenar();
  const idB = c.entregas.idDaEtapa(eB.id, 'a');
  const aberta = await comPassos(c, [passo('a', 'roteiro-reels')], c.A.id);
  await rejeita(() => c.entregas.abrirParaAgente('04-roteirista', aberta.id).ler(idB), 'isolamento');
  const daA = (await c.entregas.listar(c.ator, { empresaId: c.A.id })).itens;
  assert.ok(daA.every((e) => e.empresaId === c.A.id) && daA.some((e) => e.execucaoId === eA.id));
});

test('compatibilidade: plano sem documento continua em texto livre (inclusive a consolidação); nada antigo é convertido', async () => {
  const c = await montar();
  const exe = await comPassos(c, [{ id: 'a', agenteId: '04-roteirista', objetivo: 'Legendas' }]);
  assert.ok(exe && !(await c.execucoes.obter(c.ator, exe.id)).etapas.some((e) => e.documento), 'nem a consolidação ganha documento');
  await c.executorLocal().drenar();
  const lista = (await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens;
  assert.ok(lista.length === 2 && lista.every((e) => !e.documento));
  const v = await c.banco.obter(caminhos.versaoEntrega(lista[0].id, 1));
  assert.deepStrictEqual([v.formato, v.representacoes, v.documento], ['texto', undefined, undefined]);
  await rejeita(() => c.entregas.lerDocumento(c.ator, lista[0].id, 1), 'invalido');
  await rejeita(() => c.entregas.novaVersaoDocumento(c.ator, lista[0].id, documentoSimulado('legenda-social', 'x')), 'invalido');
});

test('falhas do simulador e limites de custo: tentativas limitadas; bloqueio antes de chamar', async () => {
  const c = await montar({ a: ['500', 'ok'] });
  const exe = await comPassos(c, [passo('a', 'plano-trafego')]);
  assert.strictEqual((await c.motor.trabalhar('t1')).resultado, 'nova-tentativa');
  c.relogio.avancarDias(1);
  const aprovadas = await executarComAprovacoes(c, exe.id); // plano de tráfego é sensível: a consolidação espera o Super Admin
  assert.deepStrictEqual(aprovadas.map((a) => a.documento), ['plano-trafego']);
  assert.strictEqual((await c.execucoes.obter(c.ator, exe.id)).estado, 'COMPLETED');
  // limite diário do agente: bloqueia ANTES da chamada do documento e não registra nada
  const c2 = await montar();
  const lim = JSON.parse(JSON.stringify(c2.consumo.PADRAO_LIMITES));
  lim.excecoes.agentes['07-trafego'] = { tokensDia: 100 };
  await c2.consumo.definirLimites(c2.ator, lim);
  const e2 = await comPassos(c2, [passo('a', 'plano-trafego')]);
  await c2.executorLocal().drenar();
  const d = await c2.motor.diagnosticar(c2.ator, e2.id);
  assert.deepStrictEqual([d.estado, d.diagnostico.motivo], ['REVISION_REQUIRED', 'limite-diario-de-tokens-agente']);
  assert.strictEqual(c2.transporte.vistos.filter((x) => x.meta.etapaId === 'a').length, 0, 'nenhuma chamada');
  assert.strictEqual((await c2.entregas.listar(c2.ator, { execucaoId: e2.id })).itens.length, 0);
  // sem chamadas externas: todo o tráfego passou pelo transporte simulado
  assert.ok(c.transporte.tipo === 'simulado' && c.transporte.chamadas.every((x) => x.rota === 'simulado'));
});

test('auditoria sem conteúdo dos documentos', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'diretrizes-marca')]);
  await c.executorLocal().drenar();
  const id = c.entregas.idDaEtapa(exe.id, 'a');
  const d = await c.entregas.lerDocumento(c.ator, id, 1);
  await c.entregas.novaVersaoDocumento(c.ator, id, Object.assign({}, d.dados, { marca: 'MARCA-SECRETA-X' }));
  const ev = JSON.stringify((await c.auditoria.listar()).filter((e) => e.tipo.startsWith('entrega.') || e.tipo.startsWith('execucao.')));
  for (const p of ['MARCA-SECRETA-X', '#1F6FEB', 'Roteiro', 'labz-documento', '[SIMULADO]']) assert.ok(!ev.includes(p), `sem ${p}`);
});

test('tipo do PLANO prevalece: o modelo devolve outro documento válido (até um que o agente poderia produzir) e é recusado no controle', async () => {
  // plano-trafego (07) recebendo uma legenda; roteiro-reels (04) recebendo uma legenda, que o 04 também produz
  for (const doc of ['plano-trafego', 'roteiro-reels']) {
    const c = await montar({ a: 'doc-outro-tipo' });
    const exe = await comPassos(c, [passo('a', doc)]);
    await c.executorLocal().drenar();
    const d = await c.motor.diagnosticar(c.ator, exe.id);
    assert.deepStrictEqual([d.estado, d.diagnostico.motivo], ['REVISION_REQUIRED', 'qualidade-reprovada'], doc);
    assert.ok(d.diagnostico.problemas.some((p) => p.startsWith('documento:')));
    assert.strictEqual((await c.entregas.listar(c.ator, { execucaoId: exe.id })).itens.length, 0);
  }
});

test('Markdown trocado por OUTRO conteúdo íntegro (com hash próprio) também é detectado: a representação é regerada e comparada', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'legenda-social')]);
  await c.executorLocal().drenar();
  const id = c.entregas.idDaEtapa(exe.id, 'a');
  const v = await c.banco.obter(caminhos.versaoEntrega(id, 1));
  const falso = (await c.banco.obter(v.representacoes.markdown.conteudoRef.caminho)).texto.replace('Legenda', 'Legenda FALSA');
  const { sha256 } = require('../src/entregas/armazenamento');
  const h = sha256(falso);
  await c.banco.gravar(caminhos.conteudoExecucao(exe.id, h), { texto: falso, hash: h, tamanho: Buffer.byteLength(falso), formato: 'markdown' });
  await c.banco.atualizar(caminhos.versaoEntrega(id, 1), { representacoes: { markdown: Object.assign({}, v.representacoes.markdown, { conteudoRef: Object.assign({}, v.representacoes.markdown.conteudoRef, { caminho: caminhos.conteudoExecucao(exe.id, h), hash: h }), hash: h }) } });
  await rejeita(() => c.entregas.lerDocumento(c.ator, id, 1), 'integridade');
});

test('entrega existente de outro tipo de documento na mesma etapa: o registro recusa (isolamento)', async () => {
  const c = await montar();
  const exe = await comPassos(c, [passo('a', 'roteiro-reels')]);
  const id = c.entregas.idDaEtapa(exe.id, 'a');
  await c.banco.gravar(caminhos.entrega(id), { empresaId: c.A.id, execucaoId: exe.id, etapaId: 'a', agenteId: '04-roteirista', documento: 'legenda-social', ultimaVersao: 0 });
  const atual = Object.assign({ id: exe.id }, await c.banco.obter(caminhos.tarefa(exe.id)), { estado: 'RUNNING' });
  await rejeita(() => c.banco.transacao((t) => c.entregas.registrarDaEtapa(t, { exe: atual, etapa: atual.etapas[0], tentativa: 1, texto: 'x', documento: { dados: documentoSimulado('roteiro-reels', 'x') } })), 'isolamento');
});
