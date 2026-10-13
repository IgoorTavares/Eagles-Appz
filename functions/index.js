// =====================================================================
// Eagles Labz · funções do servidor (Firebase Cloud Functions, plano Blaze)
// =====================================================================
// rotinaDiaria ............ todo dia às 7h (Brasília): assinaturas, lembretes por e-mail e resumo do dia
// aoResponderAprovacao .... cliente respondeu o link de aprovação → e-mail para a equipe
// boasVindas .............. novo usuário criado → e-mail de boas-vindas
// criarAssinatura ......... (chamada pelo sistema) cria a assinatura no Asaas ou no Mercado Pago
// webhookAsaas / webhookMercadoPago ... avisos de pagamento → libera ou bloqueia o acesso
// cadastroPublico ......... (chamada pela página de vendas) cria empresa + conta do titular, em teste
'use strict';
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const L = require('./lib');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5 });

// ---------- chaves e configurações (definidas no deploy; veja o README) ----------
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');
const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
const MP_WEBHOOK_SECRET = defineSecret('MP_WEBHOOK_SECRET');
const APP_URL = defineString('APP_URL', { default: 'https://eagleslabz.com.br' });
const EMAIL_FROM = defineString('EMAIL_FROM', { default: 'Eagles Labz <nao-responda@eagleslabz.com.br>' });
const ASAAS_SANDBOX = defineString('ASAAS_SANDBOX', { default: 'sim' });
const SEGREDOS_EMAIL = [RESEND_API_KEY];
const SEGREDOS_PAGTO = [ASAAS_API_KEY, MP_ACCESS_TOKEN];

// ---------- utilidades ----------
async function cobrancaCfg() { const s = await db.doc('config/cobranca').get(); return L.configCobranca(s.exists ? s.data() : null); }
async function lerDados(tenantId, chave, padrao) { const s = await db.doc(`tenants/${tenantId}/dados/${chave}`).get(); return s.exists && s.data().valor !== undefined ? s.data().valor : padrao; }
async function diretores(tenantId) {
  const s = await db.collection('usuarios').where('tenantId', '==', tenantId).get();
  return s.docs.map((d) => Object.assign({ uid: d.id }, d.data())).filter((u) => (u.role === 'Diretor' || u.titular) && u.email);
}
async function enviarEmail(para, msg, responderPara) {
  const chave = RESEND_API_KEY.value();
  if (!chave) { logger.warn('RESEND_API_KEY não definida: e-mail não enviado', para); return false; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ from: EMAIL_FROM.value(), to: [].concat(para), subject: msg.assunto, html: msg.html }, responderPara ? { reply_to: responderPara } : {})) });
  if (!r.ok) { logger.error('Resend recusou', r.status, await r.text()); return false; }
  return true;
}
// marca que um e-mail já foi enviado (não manda duas vezes)
async function jaEnviou(tenantId, chave) {
  const ref = db.doc(`tenants/${tenantId}/emails_enviados/${chave}`);
  return db.runTransaction(async (tx) => { const s = await tx.get(ref); if (s.exists) return true; tx.set(ref, { em: new Date().toISOString() }); return false; });
}
async function empresaPerfil(tenantId) { const p = await lerDados(tenantId, 'eagles_perfil_empresa_v1', {}); return p || {}; }
function nomeEmpresa(t, perfil) { return (perfil && (perfil.nomeFantasia || perfil.nomeEmpresa)) || t.nomeEmpresa || 'Sua empresa'; }

// =====================================================================
// Rotina diária
// =====================================================================
exports.rotinaDiaria = onSchedule({ schedule: 'every day 07:00', timeZone: 'America/Sao_Paulo', secrets: [...SEGREDOS_EMAIL], timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const cfg = await cobrancaCfg();
  const hoje = L.hojeBR();
  const tenants = await db.collection('tenants').get();
  for (const doc of tenants.docs) {
    const t = Object.assign({ id: doc.id }, doc.data());
    try {
      await rotinaAssinatura(t, cfg, hoje);
      if (t.ativo === false) continue;
      await rotinaEmailsDaEmpresa(t, hoje);
    } catch (e) { logger.error('Rotina da empresa', t.id, e); }
  }
});
async function rotinaAssinatura(t, cfg, hoje) {
  const a = t.assinatura || null;
  if (!a) return; // empresas antigas (sem assinatura pelo sistema) seguem como estão
  const d = L.decidirAssinatura(a, hoje, cfg);
  if (d.acao === 'nada') return;
  const ref = db.doc(`tenants/${t.id}`);
  const link = `${APP_URL.value()}/configuracoes.html#assinatura`;
  const dirs = await diretores(t.id);
  if (d.acao === 'fim-teste') await ref.set({ assinatura: Object.assign({}, a, { status: 'pendente', proximoVencimento: hoje, atualizadoEm: new Date().toISOString() }) }, { merge: true });
  if (d.acao === 'bloquear') await ref.set({ ativo: false, bloqueadoPor: 'pagamento', bloqueadoEm: new Date().toISOString(), assinatura: Object.assign({}, a, { status: 'atrasada', atualizadoEm: new Date().toISOString() }) }, { merge: true });
  if (dirs.length && !(await jaEnviou(t.id, `ass_${d.acao}_${hoje}`))) await enviarEmail(dirs.map((u) => u.email), L.emailAssinatura(d.acao, t.nomeEmpresa || '', { link: a.linkPagamento || link }));
}
async function rotinaEmailsDaEmpresa(t, hoje) {
  const conf = Object.assign({ cobrancaClientes: false, resumoDiario: true, antes: true, antesDias: 3, noDia: true, atraso: true, atrasoDias: 2 }, await lerDados(t.id, 'eagles_emails_config_v1', {}));
  const perfil = await empresaPerfil(t.id);
  const empresa = nomeEmpresa(t, perfil);
  const abertas = (await db.collection(`tenants/${t.id}/fin_lancamentos`).where('status', 'in', ['pendente', 'parcial']).get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  // lembretes por e-mail aos clientes da empresa
  if (conf.cobrancaClientes) {
    const crm = await lerDados(t.id, 'eagles_crm_clientes_v1', []);
    const erp = (await db.collection(`tenants/${t.id}/erp_clientes_fornecedores`).get()).docs.map((d) => d.data());
    const emailDe = (nome) => { const n = String(nome || '').trim().toLowerCase(); const c = (crm || []).concat(erp).find((x) => String(x.nome || x.razaoSocial || '').trim().toLowerCase() === n); return c && c.email; };
    const pix = await lerDados(t.id, 'eagles_fin_pix_v1', {});
    for (const x of L.lembretesDoDia(abertas, hoje, conf)) {
      const para = emailDe(x.l.cliente);
      if (!para || (await jaEnviou(t.id, x.chave))) continue;
      await enviarEmail(para, L.emailCobranca(empresa, x.l, x.quando, { pix: pix && pix.chave, modelo: (conf.modelos || {})['cobranca_' + x.quando] }), perfil.email || undefined);
    }
  }
  // resumo do dia para os Diretores
  if (conf.resumoDiario) {
    const dirs = await diretores(t.id);
    if (!dirs.length || (await jaEnviou(t.id, `resumo_${hoje}`))) return;
    const soma = (l) => l.reduce((a, x) => a + Math.max(0, (Number(x.valor) || 0) - (Number(x.valorPago) || 0)), 0);
    const rh = abertas.filter((l) => l.tipo === 'receber' && l.vencimento === hoje), at = abertas.filter((l) => l.tipo === 'receber' && l.vencimento && l.vencimento < hoje), ph = abertas.filter((l) => l.tipo === 'pagar' && l.vencimento && l.vencimento <= hoje);
    const tarefas = (await db.collection(`tenants/${t.id}/kanban_tarefas`).where('prazo', '<', hoje).get()).docs.filter((d) => !d.data().concluidaEm && !d.data().arquivada).length;
    const aprov = (await db.collection('conteudos_publicos').where('tenantId', '==', t.id).where('resposta', '==', '').get()).size;
    if (!rh.length && !at.length && !ph.length && !tarefas && !aprov) return; // dia tranquilo: não manda e-mail vazio
    await enviarEmail(dirs.map((u) => u.email), L.emailResumo(empresa, { hoje, receberHoje: { n: rh.length, v: soma(rh) }, atrasados: { n: at.length, v: soma(at) }, pagarHoje: { n: ph.length, v: soma(ph) }, tarefasAtrasadas: tarefas, aprovacoes: aprov }, `${APP_URL.value()}/index.html`));
  }
}

// =====================================================================
// Aviso de aprovação (o cliente respondeu o link)
// =====================================================================
exports.aoResponderAprovacao = onDocumentUpdated({ document: 'conteudos_publicos/{token}', secrets: SEGREDOS_EMAIL }, async (ev) => {
  const antes = ev.data.before.data() || {}, depois = ev.data.after.data() || {};
  if (antes.resposta || !depois.resposta || !depois.tenantId) return;
  const conf = Object.assign({ avisoAprovacao: true }, await lerDados(depois.tenantId, 'eagles_emails_config_v1', {}));
  if (!conf.avisoAprovacao) return;
  const dirs = await diretores(depois.tenantId);
  if (!dirs.length) return;
  await enviarEmail(dirs.map((u) => u.email), L.emailAprovacao(depois.empresaNome || '', depois.titulo || 'Conteúdo', depois.resposta === 'aprovado', depois.comentario, depois.cliente, `${APP_URL.value()}/crm.html`));
});

// =====================================================================
// Boas-vindas para cada usuário novo (equipe)
// =====================================================================
exports.boasVindas = onDocumentCreated({ document: 'usuarios/{uid}', secrets: SEGREDOS_EMAIL }, async (ev) => {
  const u = ev.data.data() || {};
  if (!u.email || u.role === 'Cliente' || u.role === 'SuperAdmin') return;
  const t = u.tenantId ? (await db.doc(`tenants/${u.tenantId}`).get()).data() || {} : {};
  await enviarEmail(u.email, L.emailBoasVindas(u.nome, t.nomeEmpresa || '', `${APP_URL.value()}/login.html`));
});

// =====================================================================
// Assinatura: cria a cobrança recorrente no Asaas ou no Mercado Pago
// =====================================================================
async function asaas(caminho, metodo, corpo) {
  const base = ASAAS_SANDBOX.value() === 'nao' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3';
  const r = await fetch(base + caminho, { method: metodo || 'GET', headers: { access_token: ASAAS_API_KEY.value(), 'Content-Type': 'application/json', 'User-Agent': 'EaglesLabz' }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpsError('failed-precondition', 'Asaas: ' + ((j.errors && j.errors[0] && j.errors[0].description) || r.status));
  return j;
}
async function mp(caminho, metodo, corpo) {
  const r = await fetch('https://api.mercadopago.com' + caminho, { method: metodo || 'GET', headers: { Authorization: 'Bearer ' + MP_ACCESS_TOKEN.value(), 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpsError('failed-precondition', 'Mercado Pago: ' + (j.message || r.status));
  return j;
}
exports.criarAssinatura = onCall({ secrets: SEGREDOS_PAGTO }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Entre no sistema primeiro.');
  const u = (await db.doc(`usuarios/${req.auth.uid}`).get()).data();
  if (!u || !u.tenantId || !(u.role === 'Diretor' || u.titular)) throw new HttpsError('permission-denied', 'Só o Diretor da empresa assina.');
  const cfg = await cobrancaCfg();
  const provedor = cfg.provedores.includes(req.data && req.data.provedor) ? req.data.provedor : cfg.provedorPadrao;
  const tRef = db.doc(`tenants/${u.tenantId}`);
  const t = Object.assign({ id: u.tenantId }, (await tRef.get()).data());
  const plano = cfg.planos[t.plano] || cfg.planos.ambos;
  const hoje = L.hojeBR();
  let assinatura = Object.assign({}, t.assinatura || {}, { provedor, plano: t.plano, valor: Number(plano.valor), atualizadoEm: new Date().toISOString() });
  // já tem cobrança aberta no mesmo provedor: devolve o mesmo link
  if (t.assinatura && t.assinatura.provedor === provedor && t.assinatura.linkPagamento && ['pendente', 'atrasada'].includes(t.assinatura.status)) return { link: t.assinatura.linkPagamento };
  if (provedor === 'asaas') {
    let clienteId = t.assinatura && t.assinatura.provedor === 'asaas' ? t.assinatura.clienteExterno : '';
    if (!clienteId) clienteId = (await asaas('/customers', 'POST', L.asaasCliente(t, Object.assign({ email: u.email, nome: u.nome }, req.data || {})))).id;
    const sub = await asaas('/subscriptions', 'POST', L.asaasAssinatura(clienteId, t, plano, hoje));
    const pagamentos = await asaas(`/subscriptions/${sub.id}/payments`);
    const primeiro = (pagamentos.data || [])[0] || {};
    assinatura = Object.assign(assinatura, { idExterno: sub.id, clienteExterno: clienteId, linkPagamento: primeiro.invoiceUrl || '', proximoVencimento: sub.nextDueDate, status: t.assinatura && t.assinatura.status === 'ativa' ? 'ativa' : 'pendente' });
  } else {
    const pre = await mp('/preapproval', 'POST', L.mpAssinatura(t, { email: u.email }, plano, `${APP_URL.value()}/configuracoes.html#assinatura`));
    assinatura = Object.assign(assinatura, { idExterno: pre.id, linkPagamento: pre.init_point || '', proximoVencimento: (pre.next_payment_date || '').slice(0, 10) || L.maisDias(hoje, 1), status: 'pendente' });
  }
  await tRef.set({ assinatura }, { merge: true });
  return { link: assinatura.linkPagamento };
});
// libera ou marca atraso (as duas plataformas chegam aqui)
async function registrarPagamento(tenantId, estado, dados) {
  const ref = db.doc(`tenants/${tenantId}`);
  const s = await ref.get();
  if (!s.exists) return;
  const t = s.data(), a = Object.assign({}, t.assinatura || {});
  const hoje = L.hojeBR();
  if (estado === 'pago') {
    a.status = 'ativa'; a.ultimoPagamentoEm = new Date().toISOString(); a.proximoVencimento = (dados && dados.proximo) || L.maisMeses(a.proximoVencimento && a.proximoVencimento > hoje ? a.proximoVencimento : hoje, 1);
    await ref.set({ assinatura: a, ativo: true, bloqueadoPor: admin.firestore.FieldValue.delete() }, { merge: true });
    const dirs = await diretores(tenantId);
    if (dirs.length) await enviarEmail(dirs.map((u) => u.email), L.emailAssinatura('pago', t.nomeEmpresa || '', { proximoVencimento: a.proximoVencimento, link: `${APP_URL.value()}/index.html` })).catch(() => {});
  } else if (estado === 'atrasada' || estado === 'cancelada') {
    a.status = estado; await ref.set({ assinatura: a }, { merge: true });
  }
}
async function tenantPorAssinatura(idExterno, externalReference) {
  if (externalReference) { const s = await db.doc(`tenants/${externalReference}`).get(); if (s.exists) return externalReference; }
  const q = await db.collection('tenants').where('assinatura.idExterno', '==', String(idExterno || '')).limit(1).get();
  return q.empty ? '' : q.docs[0].id;
}
exports.webhookAsaas = onRequest({ secrets: [ASAAS_WEBHOOK_TOKEN, ...SEGREDOS_EMAIL] }, async (req, res) => {
  if (req.method !== 'POST' || req.get('asaas-access-token') !== ASAAS_WEBHOOK_TOKEN.value()) { res.status(401).send('não autorizado'); return; }
  try {
    const ev = req.body || {}, p = ev.payment || {}, sub = ev.subscription || {};
    const estado = L.asaasEvento(ev);
    const tenantId = await tenantPorAssinatura(p.subscription || sub.id, p.externalReference || sub.externalReference);
    if (estado && tenantId) await registrarPagamento(tenantId, estado, {});
    res.status(200).send('ok');
  } catch (e) { logger.error('webhookAsaas', e); res.status(200).send('ok'); }
});
exports.webhookMercadoPago = onRequest({ secrets: [MP_WEBHOOK_SECRET, MP_ACCESS_TOKEN, ...SEGREDOS_EMAIL] }, async (req, res) => {
  const dataId = (req.query && (req.query['data.id'] || req.query.id)) || (req.body && req.body.data && req.body.data.id);
  if (!L.mpAssinaturaValida(req.get('x-signature'), req.get('x-request-id'), dataId, MP_WEBHOOK_SECRET.value())) { res.status(401).send('assinatura inválida'); return; }
  try {
    const tipo = (req.body && (req.body.type || req.body.topic)) || req.query.type || req.query.topic;
    if (tipo === 'subscription_preapproval') {
      const pre = await mp(`/preapproval/${dataId}`);
      const tenantId = await tenantPorAssinatura(pre.id, pre.external_reference);
      if (tenantId && pre.status === 'authorized') await registrarPagamento(tenantId, 'pago', { proximo: (pre.next_payment_date || '').slice(0, 10) || undefined });
      if (tenantId && ['cancelled', 'paused'].includes(pre.status)) await registrarPagamento(tenantId, 'cancelada', {});
    } else if (tipo === 'subscription_authorized_payment') {
      const pg = await mp(`/authorized_payments/${dataId}`);
      const tenantId = await tenantPorAssinatura(pg.preapproval_id, pg.external_reference);
      if (tenantId) await registrarPagamento(tenantId, pg.status === 'processed' || (pg.payment && pg.payment.status === 'approved') ? 'pago' : 'atrasada', {});
    }
    res.status(200).send('ok');
  } catch (e) { logger.error('webhookMercadoPago', e); res.status(200).send('ok'); }
});

// =====================================================================
// Cadastro sozinho (página de vendas): empresa + titular, em período de teste
// =====================================================================
exports.cadastroPublico = onCall({ secrets: SEGREDOS_EMAIL }, async (req) => {
  const d = req.data || {};
  const cfg = await cobrancaCfg();
  if (!cfg.cadastroAberto) throw new HttpsError('failed-precondition', 'O cadastro está fechado no momento. Fale com a gente.');
  const erros = L.validarCadastro(d);
  if (erros.length) throw new HttpsError('invalid-argument', erros.join(' '));
  if (d.site) throw new HttpsError('invalid-argument', 'Cadastro recusado.'); // armadilha de robôs
  // no máximo 3 cadastros por hora do mesmo endereço de internet
  const ip = String((req.rawRequest && (req.rawRequest.headers['x-forwarded-for'] || req.rawRequest.ip)) || 'x').split(',')[0].trim();
  const ipRef = db.doc(`cadastros_ip/${require('crypto').createHash('sha256').update(ip).digest('hex').slice(0, 32)}`);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ipRef), agora = Date.now(), lista = ((s.exists && s.data().em) || []).filter((x) => agora - x < 3600000);
    if (lista.length >= 3) throw new HttpsError('resource-exhausted', 'Muitos cadastros seguidos. Tente de novo mais tarde.');
    tx.set(ipRef, { em: lista.concat([agora]) });
  });
  const plano = cfg.planos[d.plano];
  let user;
  try { user = await admin.auth().createUser({ email: String(d.email).trim(), password: String(d.senha), displayName: String(d.nome).trim() }); }
  catch (e) { throw new HttpsError('already-exists', e.code === 'auth/email-already-exists' ? 'Esse e-mail já tem conta. Use "Entrar".' : 'Não foi possível criar a conta.'); }
  const tenantId = 'tenant_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const agora = new Date().toISOString(), hoje = L.hojeBR();
  try {
    const lote = db.batch();
    lote.set(db.doc(`tenants/${tenantId}`), { nomeEmpresa: String(d.empresa).trim().slice(0, 100), plano: d.plano, ativo: true, limiteUsuarios: Number(plano.limiteUsuarios) || 3, titularEmail: user.email, titularUid: user.uid,
      telefone: String(d.telefone || '').slice(0, 30), criadoEm: agora, criadoPor: 'cadastro-publico', origemCadastro: String(d.origem || '').slice(0, 60),
      assinatura: { status: 'teste', plano: d.plano, valor: Number(plano.valor), testeAte: L.maisDias(hoje, Number(cfg.testeDias) || 14), atualizadoEm: agora } });
    lote.set(db.doc(`usuarios/${user.uid}`), { tenantId, role: 'Diretor', titular: true, vaga: 1, nome: String(d.nome).trim().slice(0, 80), email: user.email, criadoEm: agora, criadoPor: 'cadastro-publico' });
    lote.set(db.doc(`tenants/${tenantId}/vagas/1`), { uid: user.uid, criadoEm: agora });
    // perfil marcado como "novoCadastro": o questionário de primeiro acesso abre sozinho
    lote.set(db.doc(`tenants/${tenantId}/dados/eagles_perfil_empresa_v1`), { valor: { nomeFantasia: String(d.empresa).trim().slice(0, 100), email: user.email, telefone1: String(d.telefone || '').slice(0, 30), novoCadastro: true }, atualizadoEm: agora });
    await lote.commit();
  } catch (e) { await admin.auth().deleteUser(user.uid).catch(() => {}); throw new HttpsError('internal', 'Não foi possível criar a empresa. Tente de novo.'); }
  return { ok: true, testeDias: Number(cfg.testeDias) || 14 };
});

// =====================================================================
// Meta: Instagram (publicar e relatórios) e anúncios (relatórios)
// =====================================================================
// As chaves de acesso da Meta ficam SÓ no servidor (tenants/{id}/meta_privado,
// que o navegador não consegue ler). O sistema vê apenas o resumo da conexão
// (dados/eagles_meta_v1) e os relatórios (dados/eagles_meta_relatorio_v1).
const META_APP_ID = defineString('META_APP_ID', { default: '' });
const META_API_VERSION = defineString('META_API_VERSION', { default: 'v21.0' });
const META_APP_SECRET = defineSecret('META_APP_SECRET');
const metaRedirect = () => `https://southamerica-east1-${process.env.GCLOUD_PROJECT || 'labz-18246'}.cloudfunctions.net/metaOAuthCallback`;
async function graph(caminho, token, metodo, params) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION.value()}${caminho}`);
  const corpo = new URLSearchParams(Object.assign({}, params || {}, { access_token: token }));
  const r = metodo === 'POST' ? await fetch(url.toString(), { method: 'POST', body: corpo }) : await fetch(url.toString() + (url.search ? '&' : '?') + corpo.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error((j.error && j.error.message) || 'Meta ' + r.status); e.meta = j.error; throw e; }
  return j;
}
async function meuUsuarioDiretor(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Entre no sistema primeiro.');
  const u = (await db.doc(`usuarios/${req.auth.uid}`).get()).data();
  if (!u || !u.tenantId || !['Diretor', 'Administrativo'].includes(u.role) && !u.titular) throw new HttpsError('permission-denied', 'Só o Diretor ou o Administrativo conectam a Meta.');
  return u;
}
exports.metaUrlConexao = onCall({ secrets: [META_APP_SECRET] }, async (req) => {
  const u = await meuUsuarioDiretor(req);
  if (!META_APP_ID.value()) throw new HttpsError('failed-precondition', 'O app da Meta ainda não foi configurado no servidor (META_APP_ID).');
  return { url: L.metaUrlLogin(META_APP_ID.value(), metaRedirect(), L.metaEstado(u.tenantId, req.auth.uid, META_APP_SECRET.value()), META_API_VERSION.value()) };
});
function paginaFim(titulo, texto, ok) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head><body style="font-family:Arial,sans-serif;background:#0d0f0c;color:#f3f5f2;text-align:center;padding:60px 20px;"><h1>${titulo}</h1><p>${texto}</p><script>try{window.opener&&window.opener.postMessage({meta:${ok ? 'true' : 'false'}},'*');}catch(e){}setTimeout(function(){window.close();},2500);</script></body></html>`;
}
exports.metaOAuthCallback = onRequest({ secrets: [META_APP_SECRET] }, async (req, res) => {
  const est = L.metaLerEstado(req.query.state, META_APP_SECRET.value());
  if (!est) { res.status(400).send(paginaFim('Link expirado', 'Volte ao sistema e toque em "Conectar com a Meta" de novo.', false)); return; }
  if (req.query.error || !req.query.code) { res.status(200).send(paginaFim('Conexão cancelada', 'Nada foi alterado. Pode fechar esta janela.', false)); return; }
  try {
    const curto = await graph('/oauth/access_token', '', 'GET', { client_id: META_APP_ID.value(), client_secret: META_APP_SECRET.value(), redirect_uri: metaRedirect(), code: req.query.code });
    const longo = await graph('/oauth/access_token', '', 'GET', { grant_type: 'fb_exchange_token', client_id: META_APP_ID.value(), client_secret: META_APP_SECRET.value(), fb_exchange_token: curto.access_token });
    const pags = await graph('/me/accounts', longo.access_token, 'GET', { fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}', limit: 100 });
    let contas = { data: [] };
    try { contas = await graph('/me/adaccounts', longo.access_token, 'GET', { fields: 'id,name,account_status,currency', limit: 100 }); } catch (e) { logger.warn('Sem acesso a contas de anúncio', e.message); }
    const paginas = (pags.data || []).map((p) => ({ id: p.id, nome: p.name, token: p.access_token, ig: p.instagram_business_account ? { id: p.instagram_business_account.id, usuario: p.instagram_business_account.username || '', foto: p.instagram_business_account.profile_picture_url || '' } : null }));
    const comIg = paginas.find((p) => p.ig);
    const expiraEm = new Date(Date.now() + (Number(longo.expires_in) || 60 * 86400) * 1000).toISOString();
    const selecionado = { paginaId: (comIg || paginas[0] || {}).id || '', adAccountId: ((contas.data || []).find((c) => c.account_status === 1) || (contas.data || [])[0] || {}).id || '' };
    await db.doc(`tenants/${est.tenantId}/meta_privado/conexao`).set({ userToken: longo.access_token, expiraEm, paginas, contasAnuncio: contas.data || [], conectadoPor: est.uid, em: new Date().toISOString(), selecionado });
    await db.doc(`tenants/${est.tenantId}/dados/eagles_meta_v1`).set({ valor: { conectado: true, expiraEm, conectadoEm: new Date().toISOString(), selecionado,
      paginas: paginas.map((p) => ({ id: p.id, nome: p.nome, ig: p.ig })), contasAnuncio: (contas.data || []).map((c) => ({ id: c.id, nome: c.name, ativa: c.account_status === 1, moeda: c.currency })) }, atualizadoEm: new Date().toISOString() });
    res.status(200).send(paginaFim('Conectado ✓', comIg ? `Instagram @${comIg.ig.usuario} conectado. Pode fechar esta janela.` : 'Conectado, mas nenhuma página tem um Instagram profissional ligado. Ligue o Instagram à página do Facebook e conecte de novo.', true));
    sincronizarMeta(est.tenantId).catch((e) => logger.error('Primeira sincronização da Meta', e));
  } catch (e) { logger.error('metaOAuthCallback', e); res.status(200).send(paginaFim('Não foi possível conectar', 'A Meta recusou a conexão. Tente de novo; se continuar, fale com o suporte.', false)); }
});
exports.metaSelecionar = onCall({}, async (req) => {
  const u = await meuUsuarioDiretor(req);
  const ref = db.doc(`tenants/${u.tenantId}/meta_privado/conexao`), s = await ref.get();
  if (!s.exists) throw new HttpsError('failed-precondition', 'Conecte a Meta primeiro.');
  const c = s.data(), sel = { paginaId: String((req.data || {}).paginaId || c.selecionado.paginaId), adAccountId: String((req.data || {}).adAccountId || c.selecionado.adAccountId) };
  if (!c.paginas.some((p) => p.id === sel.paginaId)) throw new HttpsError('invalid-argument', 'Página não encontrada.');
  await ref.set({ selecionado: sel }, { merge: true });
  await db.doc(`tenants/${u.tenantId}/dados/eagles_meta_v1`).set({ valor: { selecionado: sel } }, { merge: true });
  sincronizarMeta(u.tenantId).catch(() => {});
  return { ok: true };
});
exports.metaDesconectar = onCall({}, async (req) => {
  const u = await meuUsuarioDiretor(req);
  await db.doc(`tenants/${u.tenantId}/meta_privado/conexao`).delete();
  await db.doc(`tenants/${u.tenantId}/dados/eagles_meta_v1`).set({ valor: { conectado: false }, atualizadoEm: new Date().toISOString() });
  return { ok: true };
});
exports.metaAtualizarAgora = onCall({}, async (req) => { const u = await meuUsuarioDiretor(req); await sincronizarMeta(u.tenantId); return { ok: true }; });
// ---------- relatórios ----------
async function sincronizarMeta(tenantId) {
  const s = await db.doc(`tenants/${tenantId}/meta_privado/conexao`).get();
  if (!s.exists) return;
  const c = s.data(), pag = (c.paginas || []).find((p) => p.id === (c.selecionado || {}).paginaId);
  const hoje = L.hojeBR();
  let conta = null, insights = [], midias = [], anuncios = [];
  if (pag && pag.ig) {
    const igId = pag.ig.id, tok = pag.token;
    conta = await graph(`/${igId}`, tok, 'GET', { fields: 'username,followers_count,media_count' }).catch((e) => { logger.warn('IG conta', e.message); return null; });
    const ate = Math.floor(Date.now() / 1000), desde = ate - 28 * 86400;
    for (const metrica of ['reach', 'profile_views', 'accounts_engaged']) {
      const r = await graph(`/${igId}/insights`, tok, 'GET', { metric: metrica, period: 'day', metric_type: 'total_value', since: desde, until: ate }).catch(() => null);
      if (r && r.data) insights = insights.concat(r.data);
    }
    const lista = await graph(`/${igId}/media`, tok, 'GET', { fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url', limit: 25 }).catch(() => ({ data: [] }));
    midias = lista.data || [];
    for (const m of midias.slice(0, 12)) {
      const r = await graph(`/${m.id}/insights`, tok, 'GET', { metric: 'reach,saved,shares' }).catch(() => null);
      (r && r.data || []).forEach((x) => { const v = Number(((x.values || [])[0] || {}).value) || 0; if (x.name === 'reach') m.alcance = v; if (x.name === 'saved') m.salvos = v; if (x.name === 'shares') m.compart = v; });
    }
  }
  if (c.selecionado && c.selecionado.adAccountId) {
    const r = await graph(`/${c.selecionado.adAccountId}/insights`, c.userToken, 'GET', { date_preset: 'last_30d', level: 'campaign', fields: 'campaign_name,spend,impressions,reach,clicks,ctr,cpc,actions', limit: 50 }).catch((e) => { logger.warn('Anúncios', e.message); return { data: [] }; });
    anuncios = r.data || [];
  }
  await db.doc(`tenants/${tenantId}/dados/eagles_meta_relatorio_v1`).set({ valor: L.metaResumo(conta, insights, midias, anuncios, hoje), atualizadoEm: new Date().toISOString() });
}
exports.metaSincronizarDiario = onSchedule({ schedule: 'every day 06:00', timeZone: 'America/Sao_Paulo', secrets: SEGREDOS_EMAIL, timeoutSeconds: 540 }, async () => {
  const conexoes = await db.collectionGroup('meta_privado').get();
  for (const d of conexoes.docs) {
    const tenantId = d.ref.parent.parent.id, c = d.data();
    try {
      await sincronizarMeta(tenantId);
      // a chave da Meta vale 60 dias: avisa o Diretor 7 dias antes de vencer
      const dias = Math.round((new Date(c.expiraEm) - Date.now()) / 86400000);
      if (dias <= 7 && !(await jaEnviou(tenantId, `meta_expira_${String(c.expiraEm).slice(0, 10)}`))) {
        const dirs = await diretores(tenantId);
        if (dirs.length) await enviarEmail(dirs.map((u) => u.email), { assunto: 'Reconecte o Instagram no Eagles Labz', html: `<p>A conexão com a Meta (Instagram e anúncios) vence em ${Math.max(0, dias)} dia(s). Abra o CRM → Meta e toque em "Conectar com a Meta" de novo para renovar — leva 1 minuto.</p>` });
      }
    } catch (e) { logger.error('Sincronizar Meta', tenantId, e); }
  }
});
// ---------- publicar o que está agendado ----------
async function publicarUm(tenantId, ref, ag) {
  const s = await db.doc(`tenants/${tenantId}/meta_privado/conexao`).get();
  if (!s.exists) throw new Error('A Meta não está conectada.');
  const c = s.data(), pag = (c.paginas || []).find((p) => p.id === (c.selecionado || {}).paginaId);
  if (!pag || !pag.ig) throw new Error('Nenhum Instagram profissional selecionado.');
  const plano = L.metaPlanoPublicacao(ag);
  if (plano.erro) throw new Error(plano.erro);
  const igId = pag.ig.id, tok = pag.token, legenda = String(ag.legenda || '').slice(0, 2200);
  const esperarPronto = async (id) => { for (let i = 0; i < 20; i++) { const st = await graph(`/${id}`, tok, 'GET', { fields: 'status_code' }); if (st.status_code === 'FINISHED') return; if (st.status_code === 'ERROR') throw new Error('A Meta não conseguiu processar a mídia (confira se o link abre direto o arquivo).'); await new Promise((r) => setTimeout(r, 6000)); } throw new Error('A Meta demorou demais para processar o vídeo.'); };
  let criacao;
  if (plano.tipo === 'IMAGE') criacao = await graph(`/${igId}/media`, tok, 'POST', { image_url: plano.urls[0], caption: legenda });
  else if (plano.tipo === 'REELS') { criacao = await graph(`/${igId}/media`, tok, 'POST', { media_type: 'REELS', video_url: plano.urls[0], caption: legenda }); await esperarPronto(criacao.id); }
  else {
    const filhos = [];
    for (const u of plano.urls) { const f = await graph(`/${igId}/media`, tok, 'POST', /\.(mp4|mov)(\?|$)/i.test(u) ? { media_type: 'VIDEO', video_url: u, is_carousel_item: 'true' } : { image_url: u, is_carousel_item: 'true' }); filhos.push(f.id); }
    criacao = await graph(`/${igId}/media`, tok, 'POST', { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
  }
  const pub = await graph(`/${igId}/media_publish`, tok, 'POST', { creation_id: criacao.id });
  const info = await graph(`/${pub.id}`, tok, 'GET', { fields: 'permalink' }).catch(() => ({}));
  await ref.set({ status: 'publicado', publicadoEm: new Date().toISOString(), midiaId: pub.id, link: info.permalink || '', erro: admin.firestore.FieldValue.delete() }, { merge: true });
  // marca o conteúdo como publicado no quadro de Conteúdos
  if (ag.conteudoId) await db.doc(`tenants/${tenantId}/conteudos/${ag.conteudoId}`).set({ status: 'publicado', portalPostadoEm: new Date().toISOString(), instagramLink: info.permalink || '' }, { merge: true }).catch(() => {});
}
exports.metaPublicarAgendados = onSchedule({ schedule: 'every 10 minutes', timeZone: 'America/Sao_Paulo', timeoutSeconds: 540 }, async () => {
  const agora = new Date().toISOString();
  const pendentes = await db.collectionGroup('meta_agendados').where('status', '==', 'agendado').where('quando', '<=', agora).limit(30).get();
  for (const d of pendentes.docs) {
    const tenantId = d.ref.parent.parent.id;
    // trava: só um processo pega cada post
    const pegou = await db.runTransaction(async (tx) => { const s = await tx.get(d.ref); if (!s.exists || s.data().status !== 'agendado') return false; tx.set(d.ref, { status: 'publicando', tentativaEm: agora }, { merge: true }); return true; });
    if (!pegou) continue;
    try { await publicarUm(tenantId, d.ref, d.data()); }
    catch (e) { logger.warn('Publicar no Instagram', tenantId, e.message); await d.ref.set({ status: 'erro', erro: String(e.message || e).slice(0, 300) }, { merge: true }); }
  }
});
