// Service worker mínimo para que la web se pueda instalar como app.
// Siempre va primero a la red (nada de versiones viejas); solo si no hay conexión
// muestra la última copia de la página para que al menos abra.
const CACHE = 'bitacora-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('/', copia)); return r; })
      .catch(() => caches.match('/').then((r) => r || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});
