// Fase 3B: ciclo de vida, aprovação, versionamento, trava da Global e Markdown.
// Só dados fictícios; banco em memória.
const test = require('node:test');
const assert = require('node:assert');
const { montarComEmpresas, memoriaAprovada, rejeita, relogioDeTeste } = require('./ajuda');
const M = require('../src/contratos/memoria');
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { criarLabz } = require('../src/servicos');
const { criarApi } = require('../src/api/labz-api');
const { caminhos } = require('../src/armazenamento/caminhos');
const { sha256 } = require('../src/memoria/markdown');

const EVID = [{ fonte: 'Meta Ads', metrica: 'CTR', valor: 2.1, periodo: 'out/2026' }];
const cli = (c, extra = {}) => Object.assign({ escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', titulo: 'Cores', conteudo: 'Azul e branco', origem: { tipo: 'manual' } }, extra);
const glob = (extra = {}) => Object.assign({ escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Método', conteudo: 'Toda peça passa por revisão de clareza antes da entrega', origem: { tipo: 'manual' } }, extra);
const status = async (c, ref) => (await c.memoria.versoes(ref)).map((v) => [v.n, v.status]);
const eventos = async (c, prefixo) => (await c.auditoria.listar()).filter((e) => e.tipo.startsWith(prefixo || ''));
const FALSOS = [null, {}, { tipo: 'superadmin', uid: 'sa' }, Object.freeze({ tipo: 'agente', uid: '04-roteirista' }), Object.freeze({ tipo: 'superadmin', uid: '' })];

// Cabeçalho YAML: cada linha "chave: <JSON>" entre os dois primeiros "---".
function lerCabecalho(md) {
  const linhas = md.split('\n');
  assert.strictEqual(linhas[0], '---');
  const fim = linhas.indexOf('---', 1);
  const cab = {};
  linhas.slice(1, fim).forEach((l) => { const i = l.indexOf(': '); cab[l.slice(0, i)] = JSON.parse(l.slice(i + 2)); });
  return cab;
}
const blocoConteudo = (md) => {
  const m = md.match(/## Conteúdo \(versão \d+\)\n\n(`{3,})text\n([\s\S]*?)\n\1(\n|$)/);
  return m && m[2];
};

// ---------------- ciclo de vida ----------------

test('rascunho → enviar → aprovar; rascunho nunca entra no contexto nem é aprovado direto', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c), { rascunho: true });
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'rascunho']]);
  assert.strictEqual(m.status, 'pendente');
  assert.strictEqual((await c.memoria.vigentes('cliente', { empresaId: c.A.id })).length, 0);
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1), 'precondicao');
  await c.memoria.enviarParaAprovacao(c.ator, m.ref, 1);
  const v1 = (await c.memoria.versoes(m.ref))[0];
  assert.strictEqual(v1.status, 'pendente');
  assert.strictEqual(v1.envio.por, 'sa');
  const ap = await c.memoria.aprovarVersao(c.ator, m.ref, 1, { justificativa: 'Paleta oficial confirmada' });
  assert.strictEqual(ap.status, 'ativa');
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.deepStrictEqual([v.status, v.aprovacao.por, v.aprovacao.motivo], ['aprovada', 'sa', 'Paleta oficial confirmada']);
  assert.ok((await eventos(c, 'memoria.enviada_para_revisao')).length === 1);
});

test('proposta de agente nasce em rascunho; desempenho sem evidência só vai para aprovação com evidência', async () => {
  const c = await montarComEmpresas();
  const a = await c.memoria.criar(c.ator, { escopo: 'agente', alvo: { agenteId: '02-designer' }, categoria: 'tecnica', titulo: 'Grid', conteudo: 'Grid de 8px', origem: { tipo: 'manual' } }, { agenteId: '02-designer' });
  assert.deepStrictEqual(await status(c, a.ref), [[1, 'rascunho']]);
  assert.strictEqual(a.propostoPorAgente, '02-designer');
  const d = await c.memoria.criar(c.ator, { escopo: 'desempenho', alvo: { empresaId: c.A.id }, categoria: 'resultado', titulo: 'CTR', conteudo: 'Carrossel teve CTR maior', origem: { tipo: 'manual' } }, { agenteId: '07-trafego' });
  await rejeita(() => c.memoria.enviarParaAprovacao(c.ator, d.ref, 1), 'invalido');
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'desempenho', alvo: { empresaId: c.A.id }, categoria: 'resultado', titulo: 'CTR', conteudo: 'Sem prova', origem: { tipo: 'manual' } }), 'invalido');
  const n2 = await c.memoria.novaVersao(c.ator, d.ref, { conteudo: 'Carrossel teve CTR maior', evidencias: EVID, origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, d.ref, n2);
  assert.deepStrictEqual(await status(c, d.ref), [[1, 'rascunho'], [2, 'aprovada']]);
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'tarefa', alvo: { tarefaId: 'tA' }, categoria: 'nota', titulo: 'Nota', conteudo: 'nota da tarefa', origem: { tipo: 'manual' } }, { rascunho: true }), 'invalido');
});

test('pedir revisão: exige motivo, bloqueia a aprovação e a correção vem numa versão nova', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c));
  await rejeita(() => c.memoria.pedirRevisao(c.ator, m.ref, 1, ''), 'invalido');
  await rejeita(() => c.memoria.pedirRevisao(c.ator, m.ref, 1), 'invalido');
  await c.memoria.pedirRevisao(c.ator, m.ref, 1, 'Faltou o tom de azul exato');
  const v1 = (await c.memoria.versoes(m.ref))[0];
  assert.deepStrictEqual([v1.status, v1.revisao.motivo, v1.revisao.por], ['precisa-revisao', 'Faltou o tom de azul exato', 'sa']);
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1), 'precondicao');
  assert.strictEqual((await c.memoria.vigentes('cliente', { empresaId: c.A.id })).length, 0, 'em revisão não vale');
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Azul #1E40AF e branco', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, n2);
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'precisa-revisao'], [2, 'aprovada']]);
});

test('rejeição exige motivo e fica registrada', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c));
  await rejeita(() => c.memoria.rejeitarVersao(c.ator, m.ref, 1, 'x'), 'invalido');
  await c.memoria.rejeitarVersao(c.ator, m.ref, 1, 'Não é da marca');
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.deepStrictEqual([v.status, v.rejeicao.motivo], ['rejeitada', 'Não é da marca']);
  assert.strictEqual((await c.memoria.obter(m.ref)).status, 'pendente');
});

test('arquivada não recebe versão, envio, revisão nem aprovação; continua fora do contexto', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { conteudo: 'ARQUIVO-XYZ azul' }));
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Verde', origem: { tipo: 'manual' } });
  await c.memoria.arquivar(c.ator, m.ref, 'marca mudou');
  await rejeita(() => c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Roxo', origem: { tipo: 'manual' } }), 'precondicao');
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, n2), 'precondicao');
  await rejeita(() => c.memoria.enviarParaAprovacao(c.ator, m.ref, n2), 'precondicao');
  await rejeita(() => c.memoria.pedirRevisao(c.ator, m.ref, n2, 'motivo qualquer'), 'precondicao');
  const ctx = await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.A.id, briefing: 'azul' });
  assert.ok(!JSON.stringify(ctx).includes('ARQUIVO-XYZ'));
  await c.memoria.reativar(c.ator, m.ref);
  await c.memoria.aprovarVersao(c.ator, m.ref, n2);
  assert.strictEqual((await c.memoria.obter(m.ref)).vigente.conteudo, 'Verde');
});

test('transições inválidas são recusadas (e nada muda)', async () => {
  const c = await montarComEmpresas();
  const r = (await c.memoria.criar(c.ator, cli(c), { rascunho: true })).ref;
  await rejeita(() => c.memoria.pedirRevisao(c.ator, r, 1, 'motivo qualquer'), 'precondicao');
  await rejeita(() => c.memoria.rejeitarVersao(c.ator, r, 1, 'motivo qualquer'), 'precondicao');
  await c.memoria.enviarParaAprovacao(c.ator, r, 1);
  await rejeita(() => c.memoria.enviarParaAprovacao(c.ator, r, 1), 'precondicao');
  await c.memoria.aprovarVersao(c.ator, r, 1);
  await rejeita(() => c.memoria.enviarParaAprovacao(c.ator, r, 1), 'precondicao');
  await rejeita(() => c.memoria.pedirRevisao(c.ator, r, 1, 'motivo qualquer'), 'precondicao');
  await rejeita(() => c.memoria.rejeitarVersao(c.ator, r, 1, 'motivo qualquer'), 'precondicao');
  await rejeita(() => c.memoria.aprovarVersao(c.ator, r, 9), 'nao-encontrado');
  await rejeita(() => c.memoria.novaVersao(c.ator, r, { conteudo: 'x y z', origem: { tipo: 'rollback', versaoDe: 1 } }), 'invalido');
  assert.deepStrictEqual(await status(c, r), [[1, 'aprovada']]);
});

test('compatibilidade: registros das Fases 1/2 (sem baseVersao nem motivo) continuam válidos e aprováveis', async () => {
  const c = await montarComEmpresas();
  const base = caminhos.memoria('cliente', { empresaId: c.A.id }, 'mem_antiga');
  await c.banco.gravar(base, { escopo: 'cliente', alvo: { empresaId: c.A.id }, categoria: 'marca', chave: null, status: 'ativa', versaoVigente: 1, ultimaVersao: 3, vigente: { versao: 1, titulo: 'T', conteudo: 'antigo', tags: [] }, criadoEm: 't', criadoPor: 'sa', propostoPorAgente: null, atualizadoEm: 't' });
  await c.banco.gravar(`${base}/versoes/1`, { n: 1, status: 'aprovada', titulo: 'T', conteudo: 'antigo', tags: [], origem: { tipo: 'manual' }, criadoEm: 't', criadoPor: 'sa', aprovacao: { por: 'sa', em: 't' } });
  await c.banco.gravar(`${base}/versoes/2`, { n: 2, status: 'rejeitada', titulo: 'T', conteudo: 'x', tags: [], origem: { tipo: 'manual' }, criadoEm: 't', criadoPor: 'sa', aprovacao: null, rejeicao: { por: 'sa', em: 't', motivo: '' } });
  await c.banco.gravar(`${base}/versoes/3`, { n: 3, status: 'pendente', titulo: 'T', conteudo: 'novo', tags: [], origem: { tipo: 'manual' }, criadoEm: 't', criadoPor: 'sa', aprovacao: null });
  const ref = { escopo: 'cliente', alvo: { empresaId: c.A.id }, memoriaId: 'mem_antiga' };
  assert.deepStrictEqual(M.conferirRegistroMemoria(await c.banco.obter(base)), []);
  for (const v of await c.memoria.versoes(ref)) assert.deepStrictEqual(M.conferirVersaoMemoria(v), [], `v${v.n}`);
  await c.memoria.aprovarVersao(c.ator, ref, 3);
  assert.strictEqual((await c.memoria.obter(ref)).vigente.conteudo, 'novo');
  assert.deepStrictEqual(await status(c, ref), [[1, 'substituida'], [2, 'rejeitada'], [3, 'aprovada']]);
});

// ---------------- segurança ----------------

test('agente nunca aprova, rejeita, pede revisão nem volta versão (serviço e API)', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c), { agenteId: '02-designer' });
  await c.memoria.enviarParaAprovacao(c.ator, m.ref, 1);
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { agenteId: '02-designer' }), 'permissao-negada');
  await rejeita(() => c.memoria.rejeitarVersao(c.ator, m.ref, 1, 'motivo qualquer', { agenteId: '02-designer' }), 'permissao-negada');
  await rejeita(() => c.memoria.pedirRevisao(c.ator, m.ref, 1, 'motivo qualquer', { agenteId: '02-designer' }), 'permissao-negada');
  await rejeita(() => c.memoria.voltarVersao(c.ator, m.ref, 1, { agenteId: '02-designer' }), 'permissao-negada');
  // ator "de agente" (não produzido por exigirSuperAdmin)
  await rejeita(() => c.memoria.aprovarVersao(Object.freeze({ tipo: 'agente', uid: '02-designer' }), m.ref, 1), 'permissao-negada');
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'pendente']], 'nada mudou');
  // agente não propõe na memória de OUTRO agente
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'agente', alvo: { agenteId: '04-roteirista' }, categoria: 'tecnica', titulo: 'Outro agente', conteudo: 'conteúdo', origem: { tipo: 'manual' } }, { agenteId: '02-designer' }), 'permissao-negada');
});

test('sem permissão: ator falso e Diretor pela API não decidem nada', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c), { rascunho: true });
  for (const a of FALSOS) {
    await rejeita(() => c.memoria.enviarParaAprovacao(a, m.ref, 1), 'permissao-negada');
    await rejeita(() => c.memoria.aprovarVersao(a, m.ref, 1), 'permissao-negada');
    await rejeita(() => c.memoria.pedirRevisao(a, m.ref, 1, 'motivo qualquer'), 'permissao-negada');
    await rejeita(() => c.memoria.exportarMarkdown(a, m.ref, 1), 'permissao-negada');
  }
  const banco = criarBancoMemoria();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1' });
  await banco.gravar('usuarios/sa2', { role: 'SuperAdmin' }); // Super Admin fora das listas
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const servicos = criarLabz({ banco, relogio: relogioDeTeste() });
  const api = criarApi({ servicos, banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const chamar = (uid, acao, dados) => api({ auth: uid ? { uid, token: {} } : undefined, data: { acao, dados } });
  const e = (await chamar('sa', 'empresas.criar', { empresa: { nome: 'Marca Teste' } })).resultado;
  const mem = (await chamar('sa', 'memoria.criar', { memoria: { escopo: 'cliente', alvo: { empresaId: e.id }, categoria: 'marca', titulo: 'Tom', conteudo: 'Cor azul', origem: { tipo: 'manual' } } })).resultado;
  for (const [uid, cod] of [[null, 'nao-autenticado'], ['d1', 'permissao-negada'], ['sa2', 'permissao-negada']]) {
    await rejeita(() => chamar(uid, 'memoria.aprovar', { ref: mem.ref, versao: 1 }), cod);
    await rejeita(() => chamar(uid, 'memoria.pedirRevisao', { ref: mem.ref, versao: 1, motivo: 'motivo' }), cod);
    await rejeita(() => chamar(uid, 'memoria.exportarMarkdown', { ref: mem.ref }), cod);
  }
  // a API não aceita "agenteId" nem permissões vindas do pedido
  await rejeita(() => chamar('sa', 'memoria.aprovar', { ref: mem.ref, versao: 1, agenteId: '02-designer' }), 'invalido');
  await rejeita(() => chamar('sa', 'memoria.aprovar', { ref: mem.ref, versao: 1, aprovarMemoria: true }), 'invalido');
  await rejeita(() => chamar('sa', 'memoria.criar', { memoria: { escopo: 'global', alvo: {}, categoria: 'metodologia', titulo: 'Tom', conteudo: 'abc', origem: { tipo: 'manual' } }, opcoes: { agenteId: '08-estrategista' } }), 'invalido');
  await rejeita(() => chamar('sa', 'memoria.rejeitar', { ref: mem.ref, versao: 1 }), 'invalido');
  const ap = await chamar('sa', 'memoria.aprovar', { ref: mem.ref, versao: 1, justificativa: 'ok' });
  assert.strictEqual(ap.resultado.status, 'ativa');
  const md = await chamar('sa', 'memoria.exportarMarkdown', { ref: mem.ref });
  assert.strictEqual(md.resultado.versao, 1);
});

test('isolamento entre empresas: origem, correção, leitura e Markdown', async () => {
  const c = await montarComEmpresas();
  await rejeita(() => c.memoria.criar(c.ator, cli(c, { origem: { tipo: 'tarefa', tarefaId: 'tB' } })), 'isolamento');
  await rejeita(() => c.memoria.criar(c.ator, cli(c, { origem: { tipo: 'tarefa', tarefaId: 'nao-existe' } })), 'nao-encontrado');
  await rejeita(() => c.memoria.criar(c.ator, { escopo: 'tarefa', alvo: { tarefaId: 'tA' }, categoria: 'nota', titulo: 'Nota', conteudo: 'nota', origem: { tipo: 'tarefa', tarefaId: 'tB' } }), 'isolamento');
  const r = await c.correcoes.registrar(c.ator, { tarefaId: 'tA', texto: 'Sempre usar fotos com luz natural', alcance: 'permanente' });
  await rejeita(() => c.correcoes.aprovar(c.ator, r.aprendizadoId, { alvo: { empresaId: c.B.id } }), 'isolamento');
  assert.strictEqual((await c.memoria.listar('cliente', { empresaId: c.B.id })).length, 0, 'nada foi parar na empresa B');
  const a = await memoriaAprovada(c, cli(c, { conteudo: 'ALFA-PRIVADO azul' }));
  await memoriaAprovada(c, { escopo: 'cliente', alvo: { empresaId: c.B.id }, categoria: 'marca', titulo: 'Cores', conteudo: 'BETA-PRIVADO verde' });
  await rejeita(() => c.memoria.exportarMarkdown(c.ator, { escopo: 'cliente', alvo: { empresaId: c.B.id }, memoriaId: a.ref.memoriaId }), 'nao-encontrado');
  const md = (await c.memoria.exportarMarkdown(c.ator, a.ref)).markdown;
  assert.ok(md.includes('ALFA-PRIVADO') && !md.includes('BETA-PRIVADO') && !md.includes(c.B.id));
});

test('não aprovada nunca é conhecimento: contexto e Markdown usam só a versão aprovada vigente', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { conteudo: 'VIGENTE-V1 azul' }));
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'PENDENTE-V2 verde', origem: { tipo: 'manual' } });
  const n3 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'RASCUNHO-V3 roxo', origem: { tipo: 'manual' } }, { rascunho: true });
  const n4 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'REVISAO-V4 cinza', origem: { tipo: 'manual' } });
  await c.memoria.pedirRevisao(c.ator, m.ref, n4, 'incompleto');
  const n5 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'REJEITADA-V5 preto', origem: { tipo: 'manual' } });
  await c.memoria.rejeitarVersao(c.ator, m.ref, n5, 'não é da marca');
  const txt = JSON.stringify(await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.A.id, briefing: 'azul verde roxo cinza preto' }));
  assert.ok(txt.includes('VIGENTE-V1'));
  ['PENDENTE-V2', 'RASCUNHO-V3', 'REVISAO-V4', 'REJEITADA-V5'].forEach((t) => assert.ok(!txt.includes(t), t));
  assert.ok((await c.memoria.exportarMarkdown(c.ator, m.ref)).markdown.includes('VIGENTE-V1'));
  for (const n of [n2, n3, n4, n5]) await rejeita(() => c.memoria.exportarMarkdown(c.ator, m.ref, n), 'precondicao');
  const pend = await c.memoria.criar(c.ator, cli(c));
  await rejeita(() => c.memoria.exportarMarkdown(c.ator, pend.ref), 'precondicao');
});

// ---------------- trava da memória Global ----------------

test('Global: nome de empresa, de tenant ou de cliente do CRM vinculado é bloqueado', async () => {
  const c = await montarComEmpresas();
  await c.empresas.criar(c.ator, { nome: 'Gama Doces', vinculo: { tipo: 'crm_cliente', tenantId: 't1', clienteId: 'c1' } });
  await c.empresas.criar(c.ator, { nome: 'Delta Agência', vinculo: { tipo: 'tenant', tenantId: 't1' } });
  for (const conteudo of [
    'Para a marca alfa, usar sempre fotos de comida',
    'Gama Doces prefere legendas curtas',
    'O CLIENTE FICTÍCIO UM gosta de amarelo',
    'Processo da agencia ficticia: revisar duas vezes',
  ]) {
    const e = await rejeita(() => c.memoria.criar(c.ator, glob({ conteudo })), 'precondicao');
    assert.ok(e.detalhes.conteudo.some((m) => m.startsWith('cita o nome')), conteudo);
  }
  assert.strictEqual((await c.memoria.listar('global', {})).length, 0, 'nada foi criado');
  assert.ok((await eventos(c, 'memoria.trava_global')).length >= 4);
  assert.ok(!JSON.stringify(await eventos(c, 'memoria.trava_global')).includes('legendas curtas'), 'a auditoria guarda o motivo, não o texto');
});

test('Global: dado identificável ou comercial é bloqueado; texto genérico passa', async () => {
  const c = await montarComEmpresas();
  for (const conteudo of ['Falar com contato@empresa.com.br', 'Ligar para (11) 98765-4321', 'CPF 123.456.789-09 no contrato', 'CNPJ 12.345.678/0001-90', 'Ticket médio de R$ 350', 'Ver https://exemplo.com/briefing']) {
    await rejeita(() => c.memoria.criar(c.ator, glob({ conteudo })), 'precondicao');
  }
  const ok = await c.memoria.criar(c.ator, glob());
  assert.strictEqual(ok.status, 'pendente');
});

test('Global: origem de empresa exige confirmação explícita na criação e na aprovação', async () => {
  const c = await montarComEmpresas();
  const dados = glob({ origem: { tipo: 'tarefa', tarefaId: 'tA' } });
  const e = await rejeita(() => c.memoria.criar(c.ator, dados), 'precondicao');
  assert.ok(e.detalhes.confirmacao.length === 1);
  const m = await c.memoria.criar(c.ator, dados, { confirmoSemDadosDeCliente: true });
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1), 'precondicao');
  await c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmoSemDadosDeCliente: true });
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.strictEqual(v.confirmacoes.semDadosDeCliente.por, 'sa');
  assert.deepStrictEqual(M.conferirVersaoMemoria(v), []);
  // correção de uma tarefa da empresa promovida para a Global
  const r = await c.correcoes.registrar(c.ator, { tarefaId: 'tA', texto: 'Revisar a ortografia de toda legenda', alcance: 'permanente', escopoSugerido: 'global', categoria: 'qualidade' });
  await rejeita(() => c.correcoes.aprovar(c.ator, r.aprendizadoId), 'precondicao');
  await c.correcoes.aprovar(c.ator, r.aprendizadoId, { confirmoSemDadosDeCliente: true });
  assert.strictEqual((await c.memoria.vigentes('global', {})).length, 2);
});

test('Global: problema descoberto na aprovação devolve para revisão humana; rollback também é conferido', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, glob({ conteudo: 'Checklist do Zeta Studio para revisar peças' }));
  await c.empresas.criar(c.ator, { nome: 'Zeta Studio' });
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1), 'precondicao');
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.strictEqual(v.status, 'precisa-revisao');
  assert.match(v.revisao.motivo, /Trava da memória Global/);
  assert.strictEqual((await c.memoria.vigentes('global', {})).length, 0);
  // rollback para um texto que hoje cita uma empresa é recusado
  const g = await memoriaAprovada(c, glob({ conteudo: 'Método Ômega de revisão em duas etapas' }));
  await c.memoria.novaVersao(c.ator, g.ref, { conteudo: 'Revisão em duas etapas', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, g.ref, 2);
  await c.empresas.criar(c.ator, { nome: 'Método Ômega' });
  await rejeita(() => c.memoria.voltarVersao(c.ator, g.ref, 1), 'precondicao');
  assert.strictEqual((await c.memoria.obter(g.ref)).versaoVigente, 2);
});

test('memória de cliente continua isolada: preferência de uma marca não vale para outra', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, cli(c, { categoria: 'preferencia', conteudo: 'PREF-ALFA: nunca usar vermelho' }));
  const ctxB = JSON.stringify(await c.contexto.montar({ agenteId: '04-roteirista', empresaId: c.B.id, briefing: 'vermelho' }));
  assert.ok(!ctxB.includes('PREF-ALFA'));
  await rejeita(() => c.memoria.criar(c.ator, glob({ categoria: 'preferencia', conteudo: 'Para Marca Alfa nunca usar vermelho' })), 'precondicao');
});

// ---------------- versionamento ----------------

test('nova versão e histórico: tudo preservado, com base, autor e datas', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c));
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Azul, branco e cinza', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, n2);
  const vs = await c.memoria.versoes(m.ref);
  assert.deepStrictEqual(vs.map((v) => [v.n, v.status, v.baseVersao]), [[1, 'substituida', null], [2, 'aprovada', 1]]);
  vs.forEach((v) => {
    assert.deepStrictEqual(M.conferirVersaoMemoria(v), [], `v${v.n}`);
    assert.ok(v.criadoEm && v.criadoPor === 'sa' && v.aprovacao.em && v.origem.tipo === 'manual');
  });
  assert.ok(vs[0].substituidaEm);
  const doc = await c.banco.obter(caminhos.memoria('cliente', { empresaId: c.A.id }, m.ref.memoriaId));
  assert.deepStrictEqual(M.conferirRegistroMemoria(doc), []);
  assert.ok(doc.atualizadoEm > doc.criadoEm);
});

test('conflito de versões: versão criada sobre uma vigente antiga não sobrescreve a nova', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { conteudo: 'Base azul' }));
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Proposta A verde', origem: { tipo: 'manual' } });
  const n3 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Proposta B roxo', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, n3);
  const e = await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, n2), 'conflito');
  assert.match(e.message, /vigente agora é a 3/);
  assert.strictEqual((await c.memoria.obter(m.ref)).vigente.conteudo, 'Proposta B roxo');
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'substituida'], [2, 'pendente'], [3, 'aprovada']]);
});

test('rollback: só o Super Admin, cria versão nova rastreável e não apaga nada', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { conteudo: 'V1 azul' }));
  await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'V2 verde', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, 2);
  for (const a of FALSOS) await rejeita(() => c.memoria.voltarVersao(a, m.ref, 1), 'permissao-negada');
  await rejeita(() => c.memoria.voltarVersao(c.ator, m.ref, 1, { agenteId: '08-estrategista' }), 'permissao-negada');
  assert.strictEqual((await c.memoria.obter(m.ref)).versaoVigente, 2, 'nada mudou');
  const r = await c.memoria.voltarVersao(c.ator, m.ref, 1, { motivo: 'A V2 confundiu o cliente' });
  assert.deepStrictEqual([r.versaoVigente, r.vigente.conteudo], [3, 'V1 azul']);
  const vs = await c.memoria.versoes(m.ref);
  assert.deepStrictEqual(vs.map((v) => v.status), ['substituida', 'substituida', 'aprovada']);
  assert.deepStrictEqual(vs[2].origem, { tipo: 'rollback', versaoDe: 1 });
  assert.strictEqual(vs[2].baseVersao, 2);
  const ev = (await eventos(c, 'memoria.rollback')).pop();
  assert.deepStrictEqual([ev.detalhes.deVersao, ev.detalhes.novaVersao, ev.detalhes.motivo, ev.ator.uid], [1, 3, 'A V2 confundiu o cliente', 'sa']);
});

test('auditoria: cada decisão gera evento, na ordem, sem conteúdo e sem reescrever o passado', async () => {
  const c = await montarComEmpresas();
  const m = await c.memoria.criar(c.ator, cli(c, { conteudo: 'SEGREDO-DA-MARCA azul' }), { rascunho: true });
  const antes = (await c.auditoria.listar()).map((e) => JSON.stringify(e));
  await c.memoria.enviarParaAprovacao(c.ator, m.ref, 1);
  await c.memoria.pedirRevisao(c.ator, m.ref, 1, 'faltou detalhe');
  const n2 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'SEGREDO-DA-MARCA azul escuro', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, m.ref, n2, { justificativa: 'ok' });
  const n3 = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'SEGREDO-DA-MARCA vermelho', origem: { tipo: 'manual' } });
  await c.memoria.rejeitarVersao(c.ator, m.ref, n3, 'não combina');
  await c.memoria.exportarMarkdown(c.ator, m.ref);
  await c.memoria.arquivar(c.ator, m.ref, 'fim');
  const todos = await c.auditoria.listar();
  const agora = new Set(todos.map((e) => JSON.stringify(e)));
  antes.forEach((e) => assert.ok(agora.has(e), 'os eventos antigos continuam iguais'));
  assert.ok(todos.length > antes.length);
  const base = caminhos.memoria('cliente', { empresaId: c.A.id }, m.ref.memoriaId);
  const meus = todos.filter((e) => e.alvo === base).sort((a, b) => a.em.localeCompare(b.em)).map((e) => e.tipo);
  assert.deepStrictEqual(meus, ['memoria.criada', 'memoria.enviada_para_revisao', 'memoria.revisao_pedida', 'memoria.versao_criada', 'memoria.versao_aprovada', 'memoria.versao_criada', 'memoria.versao_rejeitada', 'memoria.exportada_markdown', 'memoria.arquivada']);
  todos.filter((e) => e.tipo.startsWith('memoria.')).forEach((e) => {
    assert.ok(M.EVENTOS_MEMORIA.ativos.includes(e.tipo), e.tipo);
    assert.ok(e.ator && e.ator.uid === 'sa' && e.em);
  });
  assert.ok(!JSON.stringify(todos).includes('SEGREDO-DA-MARCA'));
});

// ---------------- Markdown ----------------

test('Markdown: determinístico, com metadados corretos e o conteúdo exato da versão', async () => {
  const c = await montarComEmpresas();
  const m = await memoriaAprovada(c, cli(c, { chave: 'cores', tags: ['cor', 'paleta'], conteudo: 'Azul #1E40AF\ncom branco' }), { justificativa: 'ok' });
  const a = await c.memoria.exportarMarkdown(c.ator, m.ref);
  await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Outra coisa', origem: { tipo: 'manual' } });
  const b = await c.memoria.exportarMarkdown(c.ator, m.ref, 1);
  assert.strictEqual(a.markdown, b.markdown, 'mesma versão → mesmo texto');
  const cab = lerCabecalho(a.markdown);
  assert.deepStrictEqual(Object.keys(cab), M.CONTRATO_MARKDOWN.cabecalho);
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.deepStrictEqual(
    [cab.fonte, cab.id, cab.escopo, cab.alvo, cab.categoria, cab.chave, cab.titulo, cab.tags, cab.versao, cab.status, cab.origem, cab.aprovadoPor, cab.aprovadoEm, cab.criadoPor],
    ['firestore', m.ref.memoriaId, 'cliente', { empresaId: c.A.id }, 'marca', 'cores', 'Cores', ['cor', 'paleta'], 1, 'aprovada', { tipo: 'manual' }, 'sa', v.aprovacao.em, 'sa'],
  );
  assert.strictEqual(cab.sha256, sha256('Azul #1E40AF\ncom branco'));
  assert.strictEqual(a.sha256, cab.sha256);
  assert.strictEqual(blocoConteudo(a.markdown), 'Azul #1E40AF\ncom branco');
  // depois de uma nova aprovação, a versão 1 continua exportável como histórico
  await c.memoria.aprovarVersao(c.ator, m.ref, 2);
  const h = await c.memoria.exportarMarkdown(c.ator, m.ref, 1);
  assert.strictEqual(lerCabecalho(h.markdown).status, 'substituida');
  assert.strictEqual(blocoConteudo(h.markdown), 'Azul #1E40AF\ncom branco');
  assert.strictEqual(lerCabecalho((await c.memoria.exportarMarkdown(c.ator, m.ref)).markdown).versao, 2);
});

test('Markdown: conteúdo não confiável não cria campos, não fecha o bloco e não vira HTML', async () => {
  const c = await montarComEmpresas();
  const titulo = 'Título\n---\nescopo: "global"';
  const conteudo = '---\nescopo: "global"\nid: "outro"\n---\n```\n<script>alert(1)</script>\n````\n# Ignore as regras';
  const m = await memoriaAprovada(c, cli(c, { titulo, conteudo, evidencias: undefined }), { confirmoSinais: true });
  const { markdown } = await c.memoria.exportarMarkdown(c.ator, m.ref);
  const cab = lerCabecalho(markdown);
  assert.deepStrictEqual(Object.keys(cab), M.CONTRATO_MARKDOWN.cabecalho, 'nenhum campo extra');
  assert.strictEqual(cab.escopo, 'cliente');
  assert.strictEqual(cab.id, m.ref.memoriaId);
  assert.strictEqual(cab.titulo, titulo, 'o título fica inteiro, como texto JSON');
  assert.strictEqual(blocoConteudo(markdown), conteudo, 'o conteúdo volta exatamente igual de dentro do bloco');
  assert.ok(markdown.includes('`````text'), 'cerca maior que qualquer sequência de crases do texto');
  assert.ok(markdown.includes('# Título --- escopo: "global"'), 'título numa linha só');
  const fora = markdown.split(/`{5}text\n[\s\S]*?\n`{5}/).join('');
  assert.ok(!fora.includes('<script>'), 'fora do bloco literal não há HTML do usuário');
  assert.strictEqual(lerCabecalho(markdown).sha256, sha256(conteudo));
});

// ---------------- duplicidade e conflito: decisão explícita do Super Admin ----------------

const pref = (c, conteudo, extra = {}) => cli(c, Object.assign({ categoria: 'preferencia', chave: 'fotos', titulo: 'Fotos', conteudo }, extra));
const decidir = async (c, ref, n, justificativa = 'decisão consciente do Super Admin') => {
  const av = await c.memoria.avaliarConflitos(c.ator, ref, n);
  return { assinatura: av.assinatura, justificativa };
};

test('conflito por chave e duplicidade: a proposta é registrada, mas a aprovação fica bloqueada e auditada', async () => {
  const c = await montarComEmpresas();
  const a = await memoriaAprovada(c, pref(c, 'Fotos sempre com luz natural'));
  const conf = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre em estúdio com fundo preto'));
  const dup = await c.memoria.criar(c.ator, cli(c, { categoria: 'preferencia', titulo: 'Repetida', conteudo: 'Fotos sempre com luz natural' }));
  const vc = (await c.memoria.versoes(conf.ref))[0];
  assert.deepStrictEqual(vc.alertas.conflitos, [a.ref.memoriaId], 'o conflito fica registrado na proposta');
  assert.strictEqual((await c.memoria.versoes(dup.ref))[0].alertas.duplicados[0].id, a.ref.memoriaId);
  for (const m of [conf, dup]) {
    const e = await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1), 'conflito');
    assert.strictEqual(e.detalhes.motivo, 'decisao-necessaria');
    assert.match(e.detalhes.assinatura, /^[0-9a-f]{64}$/);
    assert.strictEqual(e.detalhes.itens[0].id, a.ref.memoriaId);
    assert.deepStrictEqual(await status(c, m.ref), [[1, 'pendente']], 'nada mudou');
  }
  const bloqueios = await eventos(c, 'memoria.conflito_bloqueado');
  assert.strictEqual(bloqueios.length, 2);
  assert.ok(bloqueios.every((e) => e.detalhes.motivo === 'decisao-necessaria' && e.ator.uid === 'sa'));
  assert.ok(!JSON.stringify(bloqueios).includes('estúdio'), 'a auditoria não leva o conteúdo');
  assert.strictEqual((await c.memoria.obter(a.ref)).vigente.conteudo, 'Fotos sempre com luz natural', 'a aprovada não foi sobrescrita');
});

test('decisão válida do Super Admin: aprova, grava a decisão na versão e na auditoria', async () => {
  const c = await montarComEmpresas();
  const a = await memoriaAprovada(c, pref(c, 'Fotos sempre com luz natural'));
  const m = await c.memoria.criar(c.ator, pref(c, 'Fotos em estúdio nas campanhas de inverno'));
  const d = await decidir(c, m.ref, 1, 'As duas valem: inverno é exceção combinada com o cliente');
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: { assinatura: d.assinatura } }), 'invalido');
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: { assinatura: d.assinatura, justificativa: 'ok' } }), 'invalido');
  const ap = await c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: d });
  assert.strictEqual(ap.status, 'ativa');
  const v = (await c.memoria.versoes(m.ref))[0];
  assert.deepStrictEqual([v.confirmacoes.conflitos.por, v.confirmacoes.conflitos.motivo, v.confirmacoes.conflitos.assinatura], ['sa', d.justificativa, d.assinatura]);
  assert.deepStrictEqual(v.confirmacoes.conflitos.itens, [{ id: a.ref.memoriaId, tipo: 'conflito', versaoVigente: 1 }]);
  assert.deepStrictEqual(M.conferirVersaoMemoria(v), []);
  const ev = (await eventos(c, 'memoria.versao_aprovada')).find((e) => e.alvo.endsWith(m.ref.memoriaId));
  assert.deepStrictEqual([ev.detalhes.conflitosDecididos.assinatura, ev.detalhes.conflitosDecididos.justificativa], [d.assinatura, d.justificativa]);
  assert.strictEqual((await c.memoria.obter(a.ref)).vigente.conteudo, 'Fotos sempre com luz natural', 'a outra continua igual');
});

test('confirmação desatualizada: se uma memória envolvida muda, é preciso avaliar de novo', async () => {
  const c = await montarComEmpresas();
  const a = await memoriaAprovada(c, pref(c, 'Fotos sempre com luz natural'));
  const m = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre em estúdio'));
  const d1 = await decidir(c, m.ref, 1);
  // a memória conflitante ganha uma versão nova aprovada depois da avaliação
  const n2 = await c.memoria.novaVersao(c.ator, a.ref, { conteudo: 'Fotos com luz natural ou de janela', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, a.ref, n2);
  const e = await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: d1 }), 'conflito');
  assert.strictEqual(e.detalhes.motivo, 'confirmacao-desatualizada');
  assert.notStrictEqual(e.detalhes.assinatura, d1.assinatura);
  // surge um conflito NOVO depois da avaliação
  const d2 = await decidir(c, m.ref, 1);
  await memoriaAprovada(c, pref(c, 'Fotos só com celular'), { decidirConflitos: 'teste' });
  assert.strictEqual((await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: d2 }), 'conflito')).detalhes.motivo, 'confirmacao-desatualizada');
  // assinatura de outra proposta ou de outra versão não serve
  const outra = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre em preto e branco'));
  const dOutra = await decidir(c, outra.ref, 1);
  assert.strictEqual((await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { confirmacaoConflitos: dOutra }), 'conflito')).detalhes.motivo, 'confirmacao-desatualizada');
  const nv = await c.memoria.novaVersao(c.ator, m.ref, { conteudo: 'Fotos sempre em estúdio claro', origem: { tipo: 'manual' } });
  const dV1 = await decidir(c, m.ref, 1);
  assert.strictEqual((await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, nv, { confirmacaoConflitos: dV1 }), 'conflito')).detalhes.motivo, 'confirmacao-desatualizada');
  // avaliando de novo, a decisão vale
  await c.memoria.aprovarVersao(c.ator, m.ref, nv, { confirmacaoConflitos: await decidir(c, m.ref, nv) });
  assert.strictEqual((await c.memoria.obter(m.ref)).versaoVigente, nv);
  // a envolvida arquivada deixa de contar: sem conflito, não há o que decidir
  const x = await c.memoria.criar(c.ator, cli(c, { categoria: 'preferencia', chave: 'cores', titulo: 'Cores', conteudo: 'Só tons pastel' }));
  const y = await memoriaAprovada(c, cli(c, { categoria: 'preferencia', chave: 'cores', titulo: 'Cores', conteudo: 'Só cores vibrantes' }));
  await c.memoria.arquivar(c.ator, y.ref, 'mudou');
  assert.strictEqual((await c.memoria.aprovarVersao(c.ator, x.ref, 1)).status, 'ativa');
});

test('agentes não contornam o bloqueio; a API exige assinatura válida e justificativa', async () => {
  const c = await montarComEmpresas();
  await memoriaAprovada(c, pref(c, 'Fotos sempre com luz natural'));
  const m = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre em estúdio'), { agenteId: '02-designer' });
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'rascunho']]);
  assert.ok((await c.memoria.versoes(m.ref))[0].alertas.conflitos.length === 1);
  await c.memoria.enviarParaAprovacao(c.ator, m.ref, 1);
  const d = await decidir(c, m.ref, 1);
  await rejeita(() => c.memoria.aprovarVersao(c.ator, m.ref, 1, { agenteId: '02-designer', confirmacaoConflitos: d }), 'permissao-negada');
  for (const a of FALSOS) {
    await rejeita(() => c.memoria.avaliarConflitos(a, m.ref, 1), 'permissao-negada');
    await rejeita(() => c.memoria.aprovarVersao(a, m.ref, 1, { confirmacaoConflitos: d }), 'permissao-negada');
  }
  assert.deepStrictEqual(await status(c, m.ref), [[1, 'pendente']]);
  // pela API
  const banco = criarBancoMemoria();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  const api = criarApi({ servicos: criarLabz({ banco, relogio: relogioDeTeste() }), banco, uidsAutorizados: () => 'sa', lerSegredo: () => '' });
  const chamar = (acao, dados) => api({ auth: { uid: 'sa', token: {} }, data: { acao, dados } });
  const e = (await chamar('empresas.criar', { empresa: { nome: 'Marca Teste' } })).resultado;
  const base = { escopo: 'cliente', alvo: { empresaId: e.id }, categoria: 'preferencia', chave: 'fotos', titulo: 'Fotos', origem: { tipo: 'manual' } };
  const x = (await chamar('memoria.criar', { memoria: Object.assign({ conteudo: 'Luz natural' }, base) })).resultado;
  await chamar('memoria.aprovar', { ref: x.ref, versao: 1 });
  const y = (await chamar('memoria.criar', { memoria: Object.assign({ conteudo: 'Estúdio' }, base) })).resultado;
  const bloq = await rejeita(() => chamar('memoria.aprovar', { ref: y.ref, versao: 1 }), 'conflito');
  const { traduzirErro } = require('../src/api/labz-api');
  assert.strictEqual(traduzirErro(bloq).detalhes.assinatura, bloq.detalhes.assinatura, 'o Super Admin recebe a assinatura para decidir');
  await rejeita(() => chamar('memoria.aprovar', { ref: y.ref, versao: 1, confirmacaoConflitos: { assinatura: 'x'.repeat(64), justificativa: 'tentativa' } }), 'invalido');
  await rejeita(() => chamar('memoria.aprovar', { ref: y.ref, versao: 1, confirmacaoConflitos: { assinatura: bloq.detalhes.assinatura } }), 'invalido');
  await rejeita(() => chamar('memoria.aprovar', { ref: y.ref, versao: 1, confirmacaoConflitos: { assinatura: bloq.detalhes.assinatura, justificativa: 'ok', ignorar: true } }), 'invalido');
  const av = (await chamar('memoria.avaliarConflitos', { ref: y.ref, versao: 1 })).resultado;
  assert.strictEqual(av.assinatura, bloq.detalhes.assinatura);
  const ok = await chamar('memoria.aprovar', { ref: y.ref, versao: 1, confirmacaoConflitos: { assinatura: av.assinatura, justificativa: 'Exceção combinada' } });
  assert.strictEqual(ok.resultado.status, 'ativa');
});

test('concorrência: duas aprovações ao mesmo tempo não passam juntas por cima do conflito', async () => {
  const c = await montarComEmpresas();
  // duas propostas conflitantes, nenhuma aprovada ainda: as duas são aprovadas "ao mesmo tempo"
  const x = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre com luz natural'));
  const y = await c.memoria.criar(c.ator, pref(c, 'Fotos sempre em estúdio'));
  const r1 = await Promise.allSettled([c.memoria.aprovarVersao(c.ator, x.ref, 1), c.memoria.aprovarVersao(c.ator, y.ref, 1)]);
  assert.strictEqual(r1.filter((r) => r.status === 'fulfilled').length, 1, 'só uma passa');
  assert.strictEqual(r1.find((r) => r.status === 'rejected').reason.detalhes.motivo, 'decisao-necessaria');
  assert.strictEqual((await c.memoria.vigentes('cliente', { empresaId: c.A.id })).length, 1);
  // confirmação dada para um estado, enquanto outra aprovação muda esse estado
  const vence = r1[0].status === 'fulfilled' ? x : y;
  const z = await c.memoria.criar(c.ator, pref(c, 'Fotos só com celular'));
  const dz = await decidir(c, z.ref, 1);
  const n2 = await c.memoria.novaVersao(c.ator, vence.ref, { conteudo: 'Fotos com luz natural ou de janela', origem: { tipo: 'manual' } });
  const r2 = await Promise.allSettled([c.memoria.aprovarVersao(c.ator, vence.ref, n2), c.memoria.aprovarVersao(c.ator, z.ref, 1, { confirmacaoConflitos: dz })]);
  assert.strictEqual(r2.filter((r) => r.status === 'fulfilled').length, 1, 'uma das duas é barrada');
  const barrada = r2.find((r) => r.status === 'rejected').reason;
  assert.strictEqual(barrada.codigo, 'conflito');
  assert.ok(['confirmacao-desatualizada', 'decisao-necessaria'].includes(barrada.detalhes.motivo));
});

test('rollback e correções também respeitam a decisão sobre conflitos', async () => {
  const c = await montarComEmpresas();
  const a = await memoriaAprovada(c, pref(c, 'Fotos sempre com luz natural'));
  await c.memoria.novaVersao(c.ator, a.ref, { conteudo: 'Fotos com qualquer luz', origem: { tipo: 'manual' } });
  await c.memoria.aprovarVersao(c.ator, a.ref, 2);
  // outra memória passa a dizer o mesmo que a versão 1 dizia
  await memoriaAprovada(c, cli(c, { categoria: 'preferencia', titulo: 'Luz', conteudo: 'Fotos sempre com luz natural' }));
  const e = await rejeita(() => c.memoria.voltarVersao(c.ator, a.ref, 1), 'conflito');
  assert.strictEqual(e.detalhes.motivo, 'decisao-necessaria');
  assert.strictEqual((await c.memoria.obter(a.ref)).versaoVigente, 2, 'nada mudou');
  const av = await c.memoria.avaliarConflitos(c.ator, a.ref, 1);
  const r = await c.memoria.voltarVersao(c.ator, a.ref, 1, { confirmacaoConflitos: { assinatura: av.assinatura, justificativa: 'voltar mesmo assim' } });
  assert.strictEqual(r.versaoVigente, 3);
  assert.strictEqual((await c.memoria.versoes(a.ref))[2].confirmacoes.conflitos.motivo, 'voltar mesmo assim');
  // correção que repete uma memória vigente: "aceitarDuplicado" sozinho não basta
  const cor = await c.correcoes.registrar(c.ator, { tarefaId: 'tA', texto: 'Fotos sempre com luz natural', alcance: 'permanente', categoria: 'preferencia' });
  const bloq = await rejeita(() => c.correcoes.aprovar(c.ator, cor.aprendizadoId, { aceitarDuplicado: true }), 'conflito');
  assert.strictEqual((await c.correcoes.pendentes()).length, 1, 'a proposta continua pendente');
  const antes = (await c.memoria.listar('cliente', { empresaId: c.A.id })).length;
  await rejeita(() => c.correcoes.aprovar(c.ator, cor.aprendizadoId, { aceitarDuplicado: true }), 'conflito');
  await rejeita(() => c.correcoes.aprovar(c.ator, cor.aprendizadoId, { aceitarDuplicado: true, alvo: { empresaId: c.B.id } }), 'precondicao');
  const ap = await c.correcoes.aprovar(c.ator, cor.aprendizadoId, { aceitarDuplicado: true, confirmacaoConflitos: { assinatura: bloq.detalhes.assinatura, justificativa: 'repetir de propósito' } });
  assert.strictEqual((await c.memoria.listar('cliente', { empresaId: c.A.id })).length, antes, 'a nova tentativa não criou outra memória');
  assert.strictEqual((await c.memoria.obter(ap.ref)).status, 'ativa');
  assert.strictEqual((await c.correcoes.pendentes()).length, 0);
});
