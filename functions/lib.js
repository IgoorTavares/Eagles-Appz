// Regras puras da cobrança e dos e-mails (sem Firebase) — testáveis sozinhas.
'use strict';
const crypto = require('crypto');

const COBRANCA_PADRAO = {
  planos: { erp: { nome: 'ERP', valor: 97, limiteUsuarios: 3 }, crm: { nome: 'CRM', valor: 97, limiteUsuarios: 3 }, ambos: { nome: 'ERP + CRM', valor: 167, limiteUsuarios: 5 } },
  testeDias: 14, toleranciaDias: 5, provedores: ['asaas', 'mercadopago'], provedorPadrao: 'asaas', cadastroAberto: true,
};
function configCobranca(doc) {
  const c = Object.assign({}, COBRANCA_PADRAO, doc || {});
  c.planos = Object.assign({}, COBRANCA_PADRAO.planos, (doc && doc.planos) || {});
  return c;
}
// ---------- datas (horário de Brasília) ----------
function hojeBR(agora) {
  const d = new Date((agora || Date.now()) - 3 * 3600000);
  return d.toISOString().slice(0, 10);
}
function maisDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function maisMeses(iso, n) {
  const [a, m, dia] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ult));
  return alvo.toISOString().slice(0, 10);
}
function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
function dataBR(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
function dinheiro(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

// ---------- o que fazer com a assinatura hoje ----------
// devolve { acao: 'nada'|'fim-teste'|'bloquear'|'avisar-vencendo', motivo }
function decidirAssinatura(a, hoje, cfg) {
  const s = (a && a.status) || 'sem';
  if (s === 'cortesia' || s === 'cancelada-manual') return { acao: 'nada' };
  const tol = Number(cfg.toleranciaDias) || 0;
  if (s === 'teste') {
    if (a.testeAte && a.testeAte < hoje) return { acao: 'fim-teste' };
    if (a.testeAte && diasEntre(hoje, a.testeAte) === 3) return { acao: 'avisar-fim-teste' };
    return { acao: 'nada' };
  }
  const venc = a.proximoVencimento || a.testeAte;
  if ((s === 'pendente' || s === 'atrasada') && venc && diasEntre(venc, hoje) > tol) return { acao: 'bloquear' };
  if (s === 'ativa' && venc && diasEntre(venc, hoje) > tol) return { acao: 'bloquear' }; // pagamento não chegou
  return { acao: 'nada' };
}

// ---------- lembretes de cobrança por e-mail aos clientes da empresa ----------
// lancamentos: contas a receber abertas; devolve [{ l, quando, chave }]
function lembretesDoDia(lancamentos, hoje, cfg) {
  const out = [];
  const antes = Number(cfg.antesDias) || 3;
  (lancamentos || []).forEach((l) => {
    if (l.tipo !== 'receber' || !(l.status === 'pendente' || l.status === 'parcial') || !l.vencimento) return;
    const d = diasEntre(hoje, l.vencimento); // >0 falta, 0 hoje, <0 atrasado
    let quando = '';
    if (cfg.antes !== false && d === antes) quando = 'antes';
    else if (cfg.noDia !== false && d === 0) quando = 'dia';
    else if (cfg.atraso !== false && d === -(Number(cfg.atrasoDias) || 2)) quando = 'atraso';
    if (quando) out.push({ l, quando, chave: `cob_${l.id}_${quando}_${l.vencimento}` });
  });
  return out;
}
// ---------- textos dos e-mails ----------
function casca(empresa, titulo, corpo, botao) {
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f2;font-family:Arial,Helvetica,sans-serif;color:#1c1f1a;">
<div style="max-width:560px;margin:0 auto;padding:28px 18px;"><div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e3e6df;">
<p style="margin:0 0 6px;color:#5f675a;font-size:13px;">${esc(empresa)}</p><h1 style="margin:0 0 14px;font-size:21px;">${esc(titulo)}</h1>
<div style="font-size:15px;line-height:1.6;">${corpo}</div>
${botao ? `<p style="margin:22px 0 0;"><a href="${esc(botao.url)}" style="display:inline-block;background:#3fae12;color:#0b0f0b;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;">${esc(botao.texto)}</a></p>` : ''}
</div><p style="text-align:center;color:#8b9388;font-size:11px;margin:14px 0 0;">Enviado automaticamente pelo Eagles Labz.</p></div></body></html>`;
}
// troca {{campo}} pelo valor (escapado) e quebra o texto em parágrafos
function aplicarModelo(texto, vars) {
  const esc = (t) => String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t = esc(texto).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
  return t.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}
function aplicarAssunto(texto, vars) { return String(texto || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m)).slice(0, 150); }
function emailCobranca(empresa, l, quando, extra) {
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const restante = Math.max(0, (Number(l.valor) || 0) - (Number(l.valorPago) || 0));
  // modelo escrito pela empresa (Configurações → E-mails)
  if (extra && extra.modelo && extra.modelo.texto) {
    const vars = { cliente: String(l.cliente || '').split(' ')[0], valor: dinheiro(restante), vencimento: dataBR(l.vencimento), descricao: l.descricao || '', empresa, pix: (extra && extra.pix) || '' };
    const titulo = quando === 'antes' ? 'Lembrete de pagamento' : quando === 'dia' ? 'Seu pagamento vence hoje' : 'Pagamento em aberto';
    return { assunto: aplicarAssunto(extra.modelo.assunto || titulo, vars), html: casca(empresa, titulo, aplicarModelo(extra.modelo.texto, vars), extra.link ? { url: extra.link, texto: 'Ver e pagar' } : null) };
  }
  const titulo = quando === 'antes' ? 'Lembrete de pagamento' : quando === 'dia' ? 'Seu pagamento vence hoje' : 'Pagamento em aberto';
  const frase = quando === 'antes' ? `vence em <b>${dataBR(l.vencimento)}</b>` : quando === 'dia' ? '<b>vence hoje</b>' : `venceu em <b>${dataBR(l.vencimento)}</b> e ainda não identificamos o pagamento`;
  const corpo = `<p>Olá${l.cliente ? ', ' + esc(String(l.cliente).split(' ')[0]) : ''}!</p><p>O pagamento de <b>${dinheiro(restante)}</b>${l.descricao ? ' (' + esc(l.descricao) + ')' : ''} ${frase}.</p>
${extra && extra.pix ? `<p>Chave PIX: <b>${esc(extra.pix)}</b></p>` : ''}<p>Se já pagou, desconsidere esta mensagem. Qualquer dúvida, é só responder este e-mail.</p>`;
  return { assunto: `${titulo} · ${empresa}`, html: casca(empresa, titulo, corpo, extra && extra.link ? { url: extra.link, texto: 'Ver e pagar' } : null) };
}
function emailBoasVindas(nome, empresa, url) {
  return { assunto: `Bem-vindo(a) ao Eagles Labz · ${empresa}`, html: casca(empresa, `Olá, ${String(nome || '').split(' ')[0] || 'tudo bem'}!`, `<p>Seu acesso ao sistema da <b>${String(empresa || '').replace(/</g, '&lt;')}</b> está pronto.</p><p>Entre com o seu e-mail. Se ainda não tem senha, use "Esqueci a senha" na tela de login.</p>`, { url, texto: 'Entrar no sistema' }) };
}
function emailAprovacao(empresa, titulo, aprovou, comentario, cliente, url) {
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return { assunto: `${aprovou ? '✓ Aprovado' : '✎ Alteração pedida'}: ${titulo}`, html: casca(empresa, aprovou ? 'Conteúdo aprovado' : 'O cliente pediu alteração', `<p><b>${esc(cliente || 'O cliente')}</b> ${aprovou ? 'aprovou' : 'pediu alteração em'} <b>${esc(titulo)}</b>.</p>${comentario ? `<p style="background:#f4f5f2;padding:12px;border-radius:8px;">“${esc(comentario)}”</p>` : ''}<p>${aprovou ? 'O cartão já foi para "Aprovados" no Kanban.' : 'O cartão voltou para "Alteração" no Kanban.'}</p>`, { url, texto: 'Abrir o Kanban' }) };
}
function emailResumo(empresa, r, url) {
  const linha = (rot, v) => `<tr><td style="padding:6px 0;color:#5f675a;">${rot}</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${v}</td></tr>`;
  return { assunto: `Seu dia · ${empresa} · ${dataBR(r.hoje)}`, html: casca(empresa, 'Resumo do seu dia', `<table style="width:100%;border-collapse:collapse;font-size:15px;">${linha('A receber hoje', `${r.receberHoje.n} · ${dinheiro(r.receberHoje.v)}`)}${linha('Recebimentos atrasados', `${r.atrasados.n} · ${dinheiro(r.atrasados.v)}`)}${linha('A pagar hoje', `${r.pagarHoje.n} · ${dinheiro(r.pagarHoje.v)}`)}${linha('Tarefas atrasadas', r.tarefasAtrasadas)}${linha('Esperando aprovação do cliente', r.aprovacoes)}</table><p>Os lembretes de WhatsApp do dia já estão na fila: abra o sistema e toque em "Lembrar no WhatsApp".</p>`, { url, texto: 'Abrir o sistema' }) };
}
function emailAssinatura(tipo, empresa, info) {
  const t = { 'fim-teste': ['Seu período de teste terminou', `<p>O período de teste do Eagles Labz para <b>${empresa}</b> terminou. Para continuar usando, escolha a forma de pagamento.</p>`],
    'avisar-fim-teste': ['Seu teste termina em 3 dias', `<p>Faltam 3 dias para o fim do período de teste de <b>${empresa}</b>. Assine para não perder o acesso — seus dados continuam todos lá.</p>`],
    bloquear: ['Acesso suspenso por falta de pagamento', `<p>Não identificamos o pagamento da assinatura de <b>${empresa}</b> e o acesso foi suspenso. Os dados continuam guardados: assim que o pagamento cair, o acesso volta sozinho.</p>`],
    pago: ['Pagamento confirmado ✓', `<p>Recebemos o pagamento da assinatura de <b>${empresa}</b>. Obrigado! Próximo vencimento: <b>${dataBR(info && info.proximoVencimento)}</b>.</p>`] }[tipo];
  return { assunto: `${t[0]} · Eagles Labz`, html: casca('Eagles Labz', t[0], t[1], info && info.link ? { url: info.link, texto: tipo === 'pago' ? 'Abrir o sistema' : 'Pagar agora' } : null) };
}

// ---------- Mercado Pago: conferência da assinatura do aviso (webhook) ----------
// x-signature: "ts=...,v1=..."; manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
function mpAssinaturaValida(xSignature, xRequestId, dataId, segredo) {
  if (!xSignature || !segredo) return false;
  const partes = Object.fromEntries(String(xSignature).split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${String(dataId || '').toLowerCase()};request-id:${xRequestId || ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1)); } catch (e) { return false; }
}
// ---------- pedidos para os meios de pagamento ----------
function asaasCliente(t, titular) {
  return { name: t.nomeEmpresa || titular.nome || 'Cliente', email: titular.email, cpfCnpj: (t.documento || '').replace(/\D/g, '') || undefined, mobilePhone: (titular.telefone || '').replace(/\D/g, '') || undefined, externalReference: t.id, notificationDisabled: false };
}
function asaasAssinatura(clienteId, t, plano, hoje) {
  return { customer: clienteId, billingType: 'UNDEFINED', value: Number(plano.valor), nextDueDate: maisDias(hoje, 1), cycle: 'MONTHLY', description: `Eagles Labz · plano ${plano.nome}`, externalReference: t.id };
}
function mpAssinatura(t, titular, plano, voltarUrl) {
  return { reason: `Eagles Labz · plano ${plano.nome}`, external_reference: t.id, payer_email: titular.email, back_url: voltarUrl, status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(plano.valor), currency_id: 'BRL' } };
}
// evento do Asaas → novo estado da assinatura
function asaasEvento(ev) {
  const e = ev && ev.event;
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'].includes(e)) return 'pago';
  if (e === 'PAYMENT_OVERDUE') return 'atrasada';
  if (['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(e)) return 'atrasada';
  if (e === 'SUBSCRIPTION_DELETED' || e === 'SUBSCRIPTION_INACTIVATED') return 'cancelada';
  return '';
}
function validarCadastro(d) {
  const erros = [];
  const s = (x) => String(x || '').trim();
  if (s(d.empresa).length < 2) erros.push('Informe o nome da empresa.');
  if (s(d.nome).length < 2) erros.push('Informe o seu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(d.email))) erros.push('Confira o e-mail.');
  if (String(d.senha || '').length < 8) erros.push('A senha precisa ter pelo menos 8 caracteres.');
  if (!['erp', 'crm', 'ambos'].includes(d.plano)) erros.push('Escolha um plano.');
  if (!d.aceite) erros.push('É preciso aceitar os Termos de Uso e a Política de Privacidade.');
  return erros;
}
module.exports = { aplicarModelo, aplicarAssunto, COBRANCA_PADRAO, configCobranca, hojeBR, maisDias, maisMeses, diasEntre, dataBR, dinheiro, decidirAssinatura, lembretesDoDia, emailCobranca, emailBoasVindas, emailAprovacao, emailResumo, emailAssinatura, mpAssinaturaValida, asaasCliente, asaasAssinatura, mpAssinatura, asaasEvento, validarCadastro };

// =====================================================================
// Meta (Instagram e anúncios) — regras puras
// =====================================================================
const META_ESCOPOS = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement', 'business_management', 'ads_read'];
// "state" assinado: diz de qual empresa e pessoa é a conexão e expira em 30 minutos
function metaEstado(tenantId, uid, segredo, agora) {
  const ts = String(agora || Date.now());
  const base = `${tenantId}.${uid}.${ts}`;
  const sig = crypto.createHmac('sha256', segredo).update(base).digest('hex').slice(0, 32);
  return Buffer.from(`${base}.${sig}`).toString('base64url');
}
function metaLerEstado(estado, segredo, agora) {
  try {
    const [tenantId, uid, ts, sig] = Buffer.from(String(estado || ''), 'base64url').toString().split('.');
    const esperado = crypto.createHmac('sha256', segredo).update(`${tenantId}.${uid}.${ts}`).digest('hex').slice(0, 32);
    if (!sig || sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
    if ((agora || Date.now()) - Number(ts) > 30 * 60000) return null;
    return { tenantId, uid };
  } catch (e) { return null; }
}
function metaUrlLogin(appId, redirectUri, estado, versao) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state: estado, response_type: 'code', scope: META_ESCOPOS.join(',') });
  return `https://www.facebook.com/${versao || 'v21.0'}/dialog/oauth?${q.toString()}`;
}
// link do Google Drive ("ver arquivo") → link direto da imagem (o Instagram precisa baixar o arquivo)
function linkDireto(url) {
  const u = String(url || '').trim();
  const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  const d = u.match(/^https:\/\/www\.dropbox\.com\/(.+?)(\?.*)?$/);
  if (d) return `https://dl.dropboxusercontent.com/${d[1]}`;
  return u;
}
// o que publicar: imagem única, carrossel (2 a 10) ou reels
function metaPlanoPublicacao(ag) {
  const urls = (ag.urls || []).map(linkDireto).filter((x) => /^https:\/\//i.test(x)).slice(0, 10);
  if (!urls.length) return { erro: 'Sem link de mídia válido (precisa começar com https://).' };
  const video = (x) => /\.(mp4|mov)(\?|$)/i.test(x) || ag.tipo === 'reels';
  if (ag.tipo === 'reels' || (urls.length === 1 && video(urls[0]))) return { tipo: 'REELS', urls: [urls[0]] };
  if (urls.length === 1) return { tipo: 'IMAGE', urls };
  return { tipo: 'CAROUSEL', urls };
}
// junta as métricas da conta e dos posts num resumo pequeno (guardado para o sistema mostrar)
function metaResumo(conta, insights, midias, anuncios, hoje) {
  const total = (nome) => { const m = (insights || []).find((x) => x.name === nome); if (!m) return null; if (m.total_value) return Number(m.total_value.value) || 0; return (m.values || []).reduce((a, v) => a + (Number(v.value) || 0), 0); };
  const posts = (midias || []).map((p) => ({ id: p.id, tipo: p.media_type, legenda: String(p.caption || '').slice(0, 140), link: p.permalink, data: String(p.timestamp || '').slice(0, 10), curtidas: Number(p.like_count) || 0, comentarios: Number(p.comments_count) || 0,
    alcance: Number(p.alcance) || 0, salvos: Number(p.salvos) || 0, compart: Number(p.compart) || 0, imagem: p.thumbnail_url || p.media_url || '' }))
    .map((p) => Object.assign(p, { engaj: p.curtidas + p.comentarios + p.salvos + p.compart }));
  const camp = (anuncios || []).map((a) => {
    const res = (a.actions || []).filter((x) => /lead|purchase|onsite_conversion.messaging|link_click/.test(x.action_type)).reduce((s, x) => s + (Number(x.value) || 0), 0);
    return { nome: a.campaign_name || 'Campanha', gasto: Number(a.spend) || 0, impressoes: Number(a.impressions) || 0, alcance: Number(a.reach) || 0, cliques: Number(a.clicks) || 0, ctr: Number(a.ctr) || 0, cpc: Number(a.cpc) || 0, resultados: res };
  }).sort((a, b) => b.gasto - a.gasto);
  return {
    atualizadoEm: new Date().toISOString(), dia: hoje, usuario: conta && conta.username, seguidores: conta ? Number(conta.followers_count) || 0 : null, publicacoes: conta ? Number(conta.media_count) || 0 : null,
    alcance28: total('reach'), visitasPerfil28: total('profile_views'), contasEngajadas28: total('accounts_engaged'),
    posts: posts.slice(0, 25), melhores: posts.slice().sort((a, b) => b.engaj - a.engaj).slice(0, 5).map((p) => p.id),
    anuncios: { campanhas: camp.slice(0, 20), gasto: camp.reduce((a, c) => a + c.gasto, 0), cliques: camp.reduce((a, c) => a + c.cliques, 0), resultados: camp.reduce((a, c) => a + c.resultados, 0), impressoes: camp.reduce((a, c) => a + c.impressoes, 0) },
  };
}
Object.assign(module.exports, { META_ESCOPOS, metaEstado, metaLerEstado, metaUrlLogin, linkDireto, metaPlanoPublicacao, metaResumo });
