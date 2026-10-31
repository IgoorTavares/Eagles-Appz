// Apoio dos testes: banco em memória com dados FICTÍCIOS e um relógio fixo.
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { exigirSuperAdmin } = require('../src/auth/super-admin');
const { criarLabz } = require('../src/servicos');

function relogioDeTeste(inicio = '2026-11-01T12:00:00.000Z') {
  let t = Date.parse(inicio);
  const r = () => new Date(t += 1000).toISOString();
  r.avancarDias = (d) => { t += d * 864e5; };
  return r;
}

// opcoes.adaptador (Fase 4A): adaptador SIMULADO do motor com um roteiro próprio
// opcoes.ia / opcoes.opcoes (Fase 4B): adaptador de MODELOS com transporte simulado; monitor/executor
async function montar(opcoes = {}) {
  const banco = criarBancoMemoria();
  const relogio = relogioDeTeste();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await banco.gravar('labz_config/acesso', { uids: ['sa'] });
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1', nome: 'Diretor' });
  await banco.gravar('tenants/t1', { nomeEmpresa: 'Agência Fictícia', plano: 'ambos' });
  await banco.gravar('tenants/t1/crm_clientes/c1', { nome: 'Cliente Fictício Um' });
  await banco.gravar('tenants/t1/crm_clientes/c2', { nome: 'Cliente Fictício Dois' });
  const labz = criarLabz({ banco, relogio, adaptador: opcoes.adaptador, ia: opcoes.ia, opcoes: opcoes.opcoes });
  const ator = await exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa'] });
  return Object.assign({ relogio, ator }, labz);
}

// Duas empresas da LABZ AI e uma tarefa de cada.
async function montarComEmpresas(opcoes) {
  const ctx = await montar(opcoes);
  const A = await ctx.empresas.criar(ctx.ator, { nome: 'Marca Alfa' });
  const B = await ctx.empresas.criar(ctx.ator, { nome: 'Marca Beta' });
  await ctx.banco.gravar('labz_tarefas/tA', { empresaId: A.id, titulo: 'Tarefa da Alfa', estado: 'RUNNING' });
  await ctx.banco.gravar('labz_tarefas/tB', { empresaId: B.id, titulo: 'Tarefa da Beta', estado: 'RUNNING' });
  return Object.assign(ctx, { A, B });
}

// Cria e aprova uma memória (atalho dos testes). opcoes vão para a aprovação.
// opcoes.decidirConflitos: "justificativa" → o Super Admin avalia a duplicidade/
// conflito e aprova com a assinatura da situação atual (decisão explícita).
async function memoriaAprovada(ctx, dados, opcoes) {
  const m = await ctx.memoria.criar(ctx.ator, Object.assign({ origem: { tipo: 'manual' } }, dados));
  let op = opcoes;
  if (opcoes && opcoes.decidirConflitos) {
    const av = await ctx.memoria.avaliarConflitos(ctx.ator, m.ref, 1);
    op = Object.assign({}, opcoes, { decidirConflitos: undefined });
    if (av.assinatura) op.confirmacaoConflitos = { assinatura: av.assinatura, justificativa: opcoes.decidirConflitos };
  }
  if (m.status === 'pendente') return ctx.memoria.aprovarVersao(ctx.ator, m.ref, 1, op).then((x) => Object.assign(x, { ref: m.ref }));
  return m;
}

const rejeita = async (fn, codigo) => {
  try { await fn(); } catch (e) { if (codigo && e.codigo !== codigo) throw new Error(`esperava erro "${codigo}", veio "${e.codigo}": ${e.message}`); return e; }
  throw new Error(`esperava erro "${codigo || 'qualquer'}", mas passou`);
};

// Fase 4C.2 (passo 3): roda o executor local; quando a execução para porque um documento SENSÍVEL
// aguarda aprovação, o Super Admin aprova a versão EXATA (número + hash) e retoma. Devolve as aprovações feitas.
async function executarComAprovacoes(ctx, execucaoId, { max = 10 } = {}) {
  const feitas = [];
  for (let i = 0; i < max; i++) {
    await ctx.executorLocal().drenar();
    const e = await ctx.execucoes.obter(ctx.ator, execucaoId);
    if (e.estado !== 'REVISION_REQUIRED' || !e.diagnostico || e.diagnostico.motivo !== 'dependencia-aguarda-aprovacao') break;
    const prod = e.etapas.find((x) => x.id === e.diagnostico.dependencia);
    const pino = prod.resultado.entrega;
    await ctx.entregas.decidir(ctx.ator, pino.id, { decisao: 'aprovar', versao: pino.versao, hash: pino.hash });
    feitas.push({ etapa: prod.id, documento: prod.documento, versao: pino.versao });
    await ctx.motor.retomar(ctx.ator, execucaoId);
  }
  return feitas;
}

module.exports = { montar, montarComEmpresas, memoriaAprovada, rejeita, relogioDeTeste, executarComAprovacoes };
