// ---------- Service Worker · Eagles Labz ----------
const CACHE_NAME = 'eagles-cache-v99';

const APP_SHELL = [
  './',
  'index.html', 'login.html', 'financeiro.html', 'meu-negocio.html', 'meu-perfil.html', 'central-ajuda.html', 'configuracoes.html',
  'usuarios.html', 'empresas.html', 'privacidade.html', 'termos.html',
  'produtos.html', 'clientes-fornecedores.html', 'vendedores.html', 'funcionarios.html',
  'pedidos-venda.html', 'objetos-postagem.html', 'contratos.html', 'funil-vendas.html', 'crm.html',
  'pedido-compras.html', 'notas-fiscais-entrada.html', 'lancamentos-estoque.html', 'conferencia-estoque.html',
  'style.css', 'script.js', 'firebase-config.js', 'manifest.json',
  'assets/logo-full.png', 'assets/logo-icon.png',
  'assets/icon-192.png', 'assets/icon-512.png',
  'assets/icon-maskable-192.png', 'assets/icon-maskable-512.png',
  'assets/apple-touch-icon.png', 'assets/favicon-eagles.png',
  'assets/favicon-login-alert.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    // cache: 'reload' = busca no servidor, não na cópia que o navegador
    // guarda sozinho (o GitHub Pages manda guardar por 10 min)
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))).catch((err) => {
      console.error('Service Worker: falha ao pré-cachear o app shell.', err);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('identitytoolkit.googleapis.com') || url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname === 'api.openai.com' || url.hostname === 'api.anthropic.com' || url.hostname === 'generativelanguage.googleapis.com') {
    return;
  }

  // Páginas, scripts e estilos do próprio site: primeiro da internet (pra
  // atualização chegar na hora), o guardado só quando estiver sem conexão.
  const doSite = url.origin === self.location.origin;
  const ehApp = doSite && (req.mode === 'navigate' || /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/'));
  if (ehApp) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((resp) => {
          if (resp && resp.status === 200) { const copia = resp.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copia)); }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('index.html')))
    );
    return;
  }

  // O resto (imagens, bibliotecas de fora): o guardado na hora e atualiza por trás
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
