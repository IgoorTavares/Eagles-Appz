// ---------- Service Worker · Eagles Labz ----------
const CACHE_NAME = 'eagles-cache-v19';

const APP_SHELL = [
  './',
  'index.html', 'login.html', 'financeiro.html', 'meu-negocio.html', 'meu-perfil.html', 'central-ajuda.html',
  'usuarios.html', 'empresas.html',
  'produtos.html', 'clientes-fornecedores.html', 'vendedores.html', 'funcionarios.html',
  'pedidos-venda.html', 'objetos-postagem.html', 'contratos.html',
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
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

  if (url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('identitytoolkit.googleapis.com') || url.hostname.includes('securetoken.googleapis.com')) {
    return;
  }

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
