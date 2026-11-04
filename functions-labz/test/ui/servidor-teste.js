// Servidor de TESTE da interface (Fase S4) — só para os testes de navegador; nunca publicado.
//  - "site" (127.0.0.1:portaSite): os arquivos PÚBLICOS do Eagles Labz (lista do Site seguro) + a tela
//    da LABZ AI (functions-labz/demo/ui) com: firebase-config.js de teste (apiKey fictícia, para o
//    script.js usar o Firebase FALSO), labz-config.js apontando para a API local e /__teste/token
//    (ID token FICTÍCIO assinado por uma chave gerada na hora).
//  - "api" (127.0.0.1:portaApi/functions/v1/labz-api): a MESMA porta HTTP da Edge Function labz-api
//    (src/borda/http.js) com o backend real em memória; o verificador aceita SÓ a chave de teste
//    (por injeção, como nos testes da S2/S3). Depois de cada pedido, um worker esvazia a fila.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { criarBancoMemoria } = require('../../src/armazenamento/banco-memoria');
const { criarLabz } = require('../../src/servicos');
const { criarApi } = require('../../src/api/labz-api');
const { exigirSuperAdmin } = require('../../src/auth/super-admin');
const { criarVerificadorFirebase } = require('../../src/auth/token-firebase');
const { criarAcessoSupabase, opcoesApiSupabase } = require('../../src/auth/acesso-supabase');
const { criarLimitador } = require('../../src/borda/limitador');
const { criarHandlerApi } = require('../../src/borda/http');
const { criarWorker } = require('../../src/borda/worker');
const { criarTransporteSimulado } = require('../../src/ia/transporte');
const { criarModeloSimulado } = require('../../src/ia/simulacao/modelo-simulado');
const { PROJETO, emitir, obterChaves } = require('../ajuda-token');

const RAIZ = path.join(__dirname, '..', '..', '..');
const UI = path.join(__dirname, '..', '..', 'demo', 'ui');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const UI_ARQUIVOS = ['labz-ai.html', 'labz-ai.css', 'labz-ai.js'];
const SUPABASE_PRODUCAO = 'https://ducvpgrtsguaxqhnnupd.supabase.co';

async function lerCorpo(req) { const p = []; for await (const x of req) p.push(x); return Buffer.concat(p); }

async function criarServidoresTeste({ apiUrlVazia = false, apiUrlBruta = null, gatewayVerifyJwt = false, scriptJs = null, limites = { porMinuto: 100000, tarefasPorHora: 1000 } } = {}) {
  const m = await import(pathToFileURL(path.join(RAIZ, '.github/pages/montar-site.mjs')).href);
  const publicos = new Set(m.PERMITIDOS);

  // ---------- backend real (memória) ----------
  const banco = criarBancoMemoria();
  const transporte = criarTransporteSimulado(criarModeloSimulado({}));
  const servicos = criarLabz({ banco, ia: { transporte } });
  await banco.gravar('labz_usuarios/sa', { role: 'SuperAdmin', nome: 'Super' });
  await banco.gravar('labz_usuarios/d1', { role: 'Diretor', nome: 'Diretor' });
  await banco.gravar('labz_config/acesso', { uids: ['sa', 'd1'] });
  await banco.gravar('usuarios/sa', { role: 'SuperAdmin' }); // só para o atalho de criação abaixo
  const ator = await exigirSuperAdmin({ uid: 'sa', token: { email: 'sa@teste.local' } }, { banco, uidsAutorizados: ['sa'] });
  const empresas = {
    A: await servicos.empresas.criar(ator, { nome: 'Marca Alfa Teste' }),
    B: await servicos.empresas.criar(ator, { nome: 'Marca Beta Teste' }),
  };
  const api = criarApi(Object.assign({ servicos, banco, uidsAutorizados: () => 'sa,d1', lerSegredo: () => '' }, opcoesApiSupabase(banco)));
  const verificador = criarVerificadorFirebase({ projetoId: PROJETO, obterChaves });
  const autenticar = criarAcessoSupabase({ verificador });
  const limitador = criarLimitador({ banco, limites });
  const pedidos = []; // registro do que chegou na API (para os testes)
  let handler = null;
  const worker = criarWorker({ servicos, orcamento: { paradaSuaveMs: 60000, limiteMs: 120000 } });
  let drenando = null;
  const drenar = () => {
    if (drenando) return drenando;
    drenando = (async () => { for (let i = 0; i < 20; i++) { const r = await worker.rodar({ acionamento: { id: `acn_${'0'.repeat(32)}`, motivo: 'fila' } }); if (!r.processados && !r.recuperadas) break; } })()
      .catch((e) => console.error('[teste-ui] worker:', e && e.message)).finally(() => { drenando = null; });
    return drenando;
  };

  const servApi = http.createServer(async (req, res) => {
    try {
      const corpo = req.method === 'POST' ? await lerCorpo(req) : null;
      let acao = null;
      try { acao = corpo ? JSON.parse(corpo.toString('utf8')).acao : null; } catch (e) { /* inválido */ }
      pedidos.push({ acao, metodo: req.method, autorizacao: /^Bearer [A-Za-z0-9_.-]+$/.test(req.headers.authorization || ''), cookie: !!req.headers.cookie, origem: req.headers.origin || null, em: Date.now() });
      // I3: imita o GATEWAY do Supabase com o Verify JWT ligado (o login do Firebase não é JWT do Supabase)
      if (gatewayVerifyJwt && req.method === 'POST') {
        res.writeHead(401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        return res.end(JSON.stringify({ code: 'UNAUTHORIZED_ASYMMETRIC_JWT', message: 'Invalid JWT' }));
      }
      const r = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k, v]) => typeof v === 'string' && !['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'].includes(k))), body: corpo && corpo.length ? corpo : undefined }));
      const h = {};
      r.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(r.status, h);
      res.end(Buffer.from(await r.arrayBuffer()));
      if (r.status === 200) drenar();
    } catch (e) { res.writeHead(500); res.end('{}'); }
  });

  // ---------- site ----------
  const servSite = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const enviar = (status, corpo, tipo) => { res.writeHead(status, { 'Content-Type': tipo || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(corpo); };
    if (url.pathname === '/__teste/token') {
      const agora = Math.floor(Date.now() / 1000);
      const uid = url.searchParams.get('uid') || 'sa';
      const modo = url.searchParams.get('modo');
      const token = modo === 'expirado' ? emitir({ sub: uid, exp: agora - 600, iat: agora - 4000, auth_time: agora - 4000 }) : modo === 'lixo' ? 'nao.e.token' : emitir({ sub: uid, email: `${uid}@teste.local` });
      return enviar(200, JSON.stringify({ token }), TIPOS['.json']);
    }
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'firebase-config.js') return enviar(200, "const FIREBASE_CONFIG = { apiKey: 'chave-de-teste-ficticia', authDomain: 'teste.local', projectId: 'labz-18246' };\n", TIPOS['.js']);
    if (rel === 'labz-config.js') return enviar(200, `const LABZ_API_URL = ${JSON.stringify(apiUrlBruta !== null ? apiUrlBruta.replace('PORTA', servApi.address().port) : apiUrlVazia ? '' : `http://127.0.0.1:${servApi.address().port}/functions/v1/labz-api`)};\n`, TIPOS['.js']);
    if (rel === 'sw.js') return enviar(200, 'self.addEventListener("install",()=>self.skipWaiting());', TIPOS['.js']);
    if (rel === 'script.js' && scriptJs) return enviar(200, scriptJs, TIPOS['.js']);
    // I1: a página tem uma política de segurança (CSP) que só deixa falar com o Supabase REAL; no teste a
    // API roda em 127.0.0.1, então SÓ AQUI o endereço do Supabase é trocado pelo da API de teste.
    if (rel === 'labz-ai.html') return enviar(200, fs.readFileSync(path.join(UI, rel), 'utf8').split(SUPABASE_PRODUCAO).join(`http://127.0.0.1:${servApi.address().port}`), TIPOS['.html']);
    const base = UI_ARQUIVOS.includes(rel) ? UI : publicos.has(rel) ? RAIZ : null;
    const arq = base && path.join(base, rel);
    if (!arq || !arq.startsWith(base + path.sep) || !fs.existsSync(arq)) return enviar(404, 'Não encontrado');
    return enviar(200, fs.readFileSync(arq), TIPOS[path.extname(arq)] || 'application/octet-stream');
  });

  await new Promise((ok) => servApi.listen(0, '127.0.0.1', ok));
  await new Promise((ok) => servSite.listen(0, '127.0.0.1', ok));
  const site = `http://127.0.0.1:${servSite.address().port}`;
  handler = criarHandlerApi({ api, autenticar, limitador, uidPermitido: (uid) => ['sa', 'd1'].includes(uid), origens: [site] });
  return {
    site, pedidos, servicos, banco, ator, empresas, transporte, drenar,
    async fechar() { worker.pararTudo(); await Promise.all([new Promise((ok) => servApi.close(ok)), new Promise((ok) => servSite.close(ok))]); },
  };
}

module.exports = { criarServidoresTeste, RAIZ, SUPABASE_PRODUCAO };
