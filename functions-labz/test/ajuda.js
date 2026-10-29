// Apoio dos testes: banco em memória com dados FICTÍCIOS e um relógio fixo.
const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { exigirSuperAdmin } = require('../src/auth/super-admin');
const { criarLabz } = require('../index');

function relogioDeTeste(inicio = '2026-11-01T12:00:00.000Z') {
  let t = Date.parse(inicio);
  const r = () => new Date(t += 1000).toISOString();
  r.avancarDias = (d) => { t += d * 864e5; };
  return r;
}

async function montar() {
  const banco = criarBancoMemoria();
  const relogio = relogioDeTeste();
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await banco.gravar('usuarios/d1', { role: 'Diretor', tenantId: 't1', nome: 'Diretor' });
  await banco.gravar('tenants/t1', { nomeEmpresa: 'Agência Fictícia', plano: 'ambos' });
  await banco.gravar('tenants/t1/crm_clientes/c1', { nome: 'Cliente Fictício Um' });
  await banco.gravar('tenants/t1/crm_clientes/c2', { nome: 'Cliente Fictício Dois' });
  const labz = criarLabz({ banco, relogio });
  const ator = await exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa'] });
  return Object.assign({ relogio, ator }, labz);
}

// Duas empresas da LABZ AI e uma tarefa de cada.
async function montarComEmpresas() {
  const ctx = await montar();
  const A = await ctx.empresas.criar(ctx.ator, { nome: 'Marca Alfa' });
  const B = await ctx.empresas.criar(ctx.ator, { nome: 'Marca Beta' });
  await ctx.banco.gravar('labz_tarefas/tA', { empresaId: A.id, titulo: 'Tarefa da Alfa', estado: 'RUNNING' });
  await ctx.banco.gravar('labz_tarefas/tB', { empresaId: B.id, titulo: 'Tarefa da Beta', estado: 'RUNNING' });
  return Object.assign(ctx, { A, B });
}

// Cria e aprova uma memória (atalho dos testes)
async function memoriaAprovada(ctx, dados) {
  const m = await ctx.memoria.criar(ctx.ator, Object.assign({ origem: { tipo: 'manual' } }, dados));
  if (m.status === 'pendente') return ctx.memoria.aprovarVersao(ctx.ator, m.ref, 1).then((x) => Object.assign(x, { ref: m.ref }));
  return m;
}

const rejeita = async (fn, codigo) => {
  try { await fn(); } catch (e) { if (codigo && e.codigo !== codigo) throw new Error(`esperava erro "${codigo}", veio "${e.codigo}": ${e.message}`); return e; }
  throw new Error(`esperava erro "${codigo || 'qualquer'}", mas passou`);
};

module.exports = { montar, montarComEmpresas, memoriaAprovada, rejeita, relogioDeTeste };
