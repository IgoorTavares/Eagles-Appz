// LABZ AI — Fase 5A: servidor de DEMONSTRAÇÃO LOCAL da interface (nunca publicado).
//
//   node functions-labz/demo/servidor-local.js            → http://127.0.0.1:5180/labz-ai.html
//   node functions-labz/demo/servidor-local.js --porta 5181
//
// O que ele faz:
// - roda SÓ no 127.0.0.1 (não abre para a rede) e recusa outro "Host" (proteção contra DNS rebinding);
// - entrega SÓ os arquivos públicos do site (a mesma lista do "Site seguro") + a tela da LABZ AI;
// - troca o firebase-config.js por um de demonstração: o site roda em modo local e NUNCA toca o
//   Firebase de produção; o service worker é trocado por um que não guarda nada;
// - a API é o backend REAL da LABZ AI (mesma lista fechada de ações, mesmas travas de Super Admin,
//   mesmas validações), sobre um banco EM MEMÓRIA, com o Estrategista e os agentes SIMULADOS
//   (nenhum modelo real, nenhuma chamada externa, nenhum custo);
// - o executor local (que na arquitetura nunca sai pela API) roda aqui, no próprio servidor.
// Ao fechar o servidor, tudo some (nada é gravado em disco).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { criarBancoMemoria } = require('../src/armazenamento/banco-memoria');
const { criarLabz } = require('../src/servicos');
const { criarApi, traduzirErro } = require('../src/api/labz-api');
const { exigirSuperAdmin } = require('../src/auth/super-admin');
const { criarModeloSimulado } = require('../src/ia/simulacao/modelo-simulado');
const { criarTransporteSimulado } = require('../src/ia/transporte');

const RAIZ = path.resolve(__dirname, '..', '..');
// A tela da LABZ AI ainda NÃO é pública (decisão do Igor, opção A): os arquivos ficam em
// functions-labz/demo/ui/ (pasta interna, fora do site pelas duas travas da publicação segura)
// e só este servidor local os mostra, em /labz-ai.html, /labz-ai.css e /labz-ai.js.
const PASTA_UI = path.join(__dirname, 'ui');
const UI_LABZ = ['labz-ai.html', 'labz-ai.css', 'labz-ai.js'];
const UID_DEMO = 'superadmin-demo';
const EMAIL_DEMO = 'superadmin@demo.local';
const ROTA_API = '/__labz_local/api';
const ROTA_ESTADO = '/__labz_local/estado';
const MAX_CORPO = 256 * 1024;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
// ações que põem trabalho na fila: depois delas o executor local roda
const ACOES_QUE_ENFILEIRAM = new Set(['execucoes.pedido', 'execucoes.retomar', 'execucoes.decidirAprovacao', 'entregas.decidir', 'execucoes.planejar']);

const CONFIG_DEMO = `// Demonstração local (servidor-local.js): sem Firebase. O site roda em modo local.
const FIREBASE_CONFIG = { apiKey: 'COLE_AQUI' };
const LABZ_DEMO_LOCAL = true;
`;
const SW_DEMO = `// Demonstração local: service worker que não guarda nada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
`;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function montarDemo({ atrasoMs = 650 } = {}) {
  const banco = criarBancoMemoria();
  await banco.gravar(`usuarios/${UID_DEMO}`, { role: 'SuperAdmin', nome: 'Super Admin (demonstração)' });
  await banco.gravar('labz_config/acesso', { uids: [UID_DEMO] });
  // cada chamada ao "modelo" simulado demora um pouco, para a interface mostrar o andamento
  const resposta = criarModeloSimulado({});
  const transporte = criarTransporteSimulado(async (x) => { if (atrasoMs) await espera(atrasoMs); return resposta(x); });
  const servicos = criarLabz({ banco, ia: { transporte } });
  const ator = await exigirSuperAdmin({ uid: UID_DEMO, token: { email: EMAIL_DEMO } }, { banco, uidsAutorizados: [UID_DEMO] });
  await servicos.empresas.criar(ator, { nome: 'Empresa Demonstração Alfa' });
  await servicos.empresas.criar(ator, { nome: 'Empresa Demonstração Beta' });
  const api = criarApi({ servicos, banco, uidsAutorizados: () => [UID_DEMO], lerSegredo: () => '' });

  let rodando = null;
  let deNovo = false;
  function trabalhar() {
    if (rodando) { deNovo = true; return rodando; }
    rodando = (async () => {
      do { deNovo = false; await servicos.executorLocal({ nome: 'demo-local' }).drenar(); } while (deNovo);
    })().catch((e) => { console.error('[demo] executor:', e && e.message); }).finally(() => { rodando = null; });
    return rodando;
  }
  async function chamar(acao, dados) {
    const r = await api({ auth: { uid: UID_DEMO, token: { email: EMAIL_DEMO } }, data: { acao, dados } });
    if (ACOES_QUE_ENFILEIRAM.has(acao)) setImmediate(trabalhar);
    return r;
  }
  return { chamar, trabalhar, ocioso: () => !rodando, servicos, banco };
}

function criarServidor({ porta = 5180, atrasoMs } = {}) {
  let demo = null;
  let publicos = null;
  const preparar = (async () => {
    demo = await montarDemo({ atrasoMs });
    const m = await import(pathToFileURL(path.join(RAIZ, '.github/pages/montar-site.mjs')).href);
    publicos = new Set(m.PERMITIDOS);
  })();

  const hostsOk = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);
  const enviar = (res, status, corpo, tipo = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
  };

  const servidor = http.createServer(async (req, res) => {
    try {
      await preparar;
      if (!hostsOk.has(String(req.headers.host || ''))) return enviar(res, 403, { erro: { codigo: 'permission-denied', mensagem: 'Host não permitido.' } });
      const url = new URL(req.url, `http://127.0.0.1:${porta}`);
      if (url.pathname === ROTA_ESTADO && req.method === 'GET') {
        return enviar(res, 200, { demo: true, aviso: 'Demonstração local: backend real da LABZ AI em memória, agentes e Estrategista SIMULADOS. Nada é publicado nem cobrado.' });
      }
      if (url.pathname === ROTA_API) {
        if (req.method !== 'POST') return enviar(res, 405, { erro: { codigo: 'invalid-argument', mensagem: 'Use POST.' } });
        const origem = req.headers.origin;
        if (origem && !hostsOk.has(origem.replace(/^https?:\/\//, ''))) return enviar(res, 403, { erro: { codigo: 'permission-denied', mensagem: 'Origem não permitida.' } });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return enviar(res, 415, { erro: { codigo: 'invalid-argument', mensagem: 'Envie JSON.' } });
        let tamanho = 0;
        const partes = [];
        for await (const p of req) { tamanho += p.length; if (tamanho > MAX_CORPO) return enviar(res, 413, { erro: { codigo: 'invalid-argument', mensagem: 'Pedido grande demais.' } }); partes.push(p); }
        let pedido;
        try { pedido = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return enviar(res, 400, { erro: { codigo: 'invalid-argument', mensagem: 'JSON inválido.' } }); }
        try {
          const r = await demo.chamar(pedido && pedido.acao, pedido && pedido.dados);
          return enviar(res, 200, r);
        } catch (e) {
          return enviar(res, 400, { erro: traduzirErro(e) });
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return enviar(res, 405, 'Método não permitido', 'text/plain; charset=utf-8');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (rel === '') rel = 'labz-ai.html';
      if (rel === 'firebase-config.js') return enviar(res, 200, CONFIG_DEMO, TIPOS['.js']);
      if (rel === 'sw.js') return enviar(res, 200, SW_DEMO, TIPOS['.js']);
      // a tela da LABZ AI (só estes 3 nomes) + a lista exata de arquivos públicos do site
      // (nada de functions/, functions-labz/, regras, .md...)
      const base = UI_LABZ.includes(rel) ? PASTA_UI : publicos.has(rel) ? RAIZ : null;
      if (!base) return enviar(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
      const arquivo = path.join(base, rel);
      if (!arquivo.startsWith(base + path.sep) || !fs.existsSync(arquivo)) return enviar(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
      return enviar(res, 200, fs.readFileSync(arquivo), TIPOS[path.extname(arquivo)] || 'application/octet-stream');
    } catch (e) {
      console.error('[demo]', e);
      return enviar(res, 500, { erro: { codigo: 'internal', mensagem: 'Erro interno da demonstração.' } });
    }
  });
  return { servidor, preparar, demo: () => demo, porta };
}

if (require.main === module) {
  const i = process.argv.indexOf('--porta');
  const porta = i > -1 ? Number(process.argv[i + 1]) : 5180;
  const { servidor } = criarServidor({ porta });
  servidor.listen(porta, '127.0.0.1', () => {
    console.log(`LABZ AI — demonstração local (tudo simulado): http://127.0.0.1:${porta}/labz-ai.html`);
    console.log('Feche com Ctrl+C. Nada é gravado em disco nem publicado.');
  });
}

module.exports = { criarServidor, montarDemo, UI_LABZ, ROTA_API, ROTA_ESTADO, UID_DEMO };
