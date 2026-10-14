// Testes das regras puras (node teste.js) — não precisam de Firebase.
'use strict';
const L = require('./lib');
const crypto = require('crypto');
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); if (!c) falhas++; };
ok(L.maisMeses('2026-01-31', 1) === '2026-02-28' && L.maisMeses('2026-12-15', 1) === '2027-01-15', 'mês seguinte respeita o fim do mês e a virada do ano');
const lanc = [{ id: 'a', tipo: 'receber', status: 'pendente', vencimento: '2026-10-14', valor: 100 }, { id: 'b', tipo: 'receber', status: 'parcial', vencimento: '2026-10-11', valor: 100, valorPago: 40 }, { id: 'c', tipo: 'receber', status: 'pendente', vencimento: '2026-10-09', valor: 50 }, { id: 'd', tipo: 'pagar', status: 'pendente', vencimento: '2026-10-11' }, { id: 'e', tipo: 'receber', status: 'pago', vencimento: '2026-10-11' }];
const lem = L.lembretesDoDia(lanc, '2026-10-11', { antesDias: 3, atrasoDias: 2 });
ok(lem.map((x) => x.l.id + ':' + x.quando).join() === 'a:antes,b:dia,c:atraso', 'lembretes: 3 dias antes, no dia e 2 dias depois (pagos e contas a pagar ficam de fora)');
ok(lem[0].chave === 'cob_a_antes_2026-10-14', 'cada lembrete tem uma chave (não manda duas vezes)');
const e1 = L.emailCobranca('Studio <Aurora>', { cliente: 'Ana Souza', valor: 100, valorPago: 40, descricao: 'Mensal', vencimento: '2026-10-11' }, 'dia', { pix: 'chave@pix' });
ok(e1.assunto.includes('vence hoje') && e1.html.includes('R$ 60,00') && e1.html.includes('Olá, Ana') && e1.html.includes('chave@pix') && e1.html.includes('Studio &lt;Aurora&gt;'), 'e-mail de cobrança: valor restante, primeiro nome, PIX e sem HTML injetado');
const em2 = L.emailCobranca('Loja', { cliente: 'Bruno Lima', valor: 80, vencimento: '2026-10-20', descricao: 'Plano <mensal>' }, 'antes', { pix: '11999', modelo: { assunto: 'Oi {{cliente}}, vence {{vencimento}}', texto: 'Olá {{cliente}}!\n\nValor: {{valor}} · {{descricao}}\nPIX: {{pix}} {{desconhecido}}' } });
ok(em2.assunto === 'Oi Bruno, vence 20/10/2026' && em2.html.includes('<p>Olá Bruno!</p>') && em2.html.includes('R$ 80,00 · Plano &lt;mensal&gt;<br>PIX: 11999 {{desconhecido}}'), 'modelo da empresa: campos trocados, texto escapado e parágrafos');
// ---------- Meta ----------
const est = L.metaEstado('t1', 'u1', 'seg', 1000);
ok(JSON.stringify(L.metaLerEstado(est, 'seg', 1000 + 60000)) === JSON.stringify({ tenantId: 't1', uid: 'u1' }), 'Meta: o "state" assinado identifica empresa e pessoa');
ok(L.metaLerEstado(est, 'outro', 2000) === null && L.metaLerEstado(est, 'seg', 1000 + 31 * 60000) === null && L.metaLerEstado('lixo', 'seg') === null, 'Meta: state falso ou com mais de 30 minutos é recusado');
const url = L.metaUrlLogin('123', 'https://x/cb', est, 'v21.0');
ok(url.startsWith('https://www.facebook.com/v21.0/dialog/oauth?') && url.includes('instagram_content_publish') && url.includes('ads_read') && url.includes('redirect_uri=https%3A%2F%2Fx%2Fcb'), 'Meta: link de login com as permissões certas');
ok(L.linkDireto('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing') === 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMn' && L.linkDireto('https://www.dropbox.com/s/abc/foto.jpg?dl=0') === 'https://dl.dropboxusercontent.com/s/abc/foto.jpg', 'links do Drive e do Dropbox viram link direto do arquivo');
ok(L.metaPlanoPublicacao({ urls: ['https://a/1.jpg'] }).tipo === 'IMAGE' && L.metaPlanoPublicacao({ urls: ['https://a/1.jpg', 'https://a/2.jpg'] }).tipo === 'CAROUSEL' && L.metaPlanoPublicacao({ urls: ['https://a/v.mp4'] }).tipo === 'REELS' && L.metaPlanoPublicacao({ urls: ['http://inseguro'] }).erro, 'publicação: imagem, carrossel, reels e link inválido');
ok(L.metaPlanoPublicacao({ urls: Array.from({ length: 14 }, (_, i) => `https://a/${i}.jpg`) }).urls.length === 10, 'carrossel limitado a 10 imagens (regra do Instagram)');
const res = L.metaResumo({ username: 'loja', followers_count: 1200, media_count: 80 }, [{ name: 'reach', total_value: { value: 5400 } }, { name: 'profile_views', values: [{ value: 10 }, { value: 15 }] }],
  [{ id: 'm1', like_count: 10, comments_count: 2, alcance: 300 }, { id: 'm2', like_count: 50, comments_count: 9, salvos: 4 }], [{ campaign_name: 'Black Friday', spend: '120.50', clicks: '40', impressions: '9000', ctr: '0.44', cpc: '3.01', actions: [{ action_type: 'lead', value: '6' }, { action_type: 'post_engagement', value: '99' }] }], '2026-10-11');
ok(res.seguidores === 1200 && res.alcance28 === 5400 && res.visitasPerfil28 === 25 && res.melhores[0] === 'm2', 'resumo: seguidores, alcance, visitas e o melhor post');
ok(res.anuncios.gasto === 120.5 && res.anuncios.resultados === 6 && res.anuncios.campanhas[0].nome === 'Black Friday', 'resumo dos anúncios: investido e resultados (leads)');
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
process.exitCode = falhas ? 1 : 0;
