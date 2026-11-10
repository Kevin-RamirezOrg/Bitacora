// Service worker de Bitácora: permite instalarla como app y abrirla sin conexión.
// - La página: primero la red (nada de versiones viejas); si no hay red o tarda más de 4 s, la última copia buena.
// - Librerías de lib/ e íconos: llevan versión fija, así que se sirven de la copia guardada.
// - Fuentes de Google: de la copia guardada, y se actualizan en segundo plano.
// Las notas no pasan por aquí: su copia sin conexión la maneja Firestore dentro de la página.
const CACHE = 'bitacora-v2';
const LIBS = ['firebase-app-compat.js?v=10.12.2', 'firebase-auth-compat.js?v=10.12.2', 'firebase-firestore-compat.js?v=10.12.2',
  'marked.min.js?v=12.0.2', 'purify.min.js?v=3.1.6', 'highlight.min.js?v=11.9.0'].map((f) => '/lib/' + f);
const FIJOS = [...LIBS, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-32.png'];
const ESPERA_PAGINA_MS = 4000;

self.addEventListener('install', (e) => {
  // Si algún archivo no se puede guardar, la app igual se instala: se guardará al usarlo.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled([c.add('/'), ...FIJOS.map((u) => c.add(u))])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

const guardar = (clave, r) => { if (r && (r.ok || r.type === 'opaque')) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(clave, copia)).catch(() => {}); } return r; };
const sinConexion = () => new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La página (cualquier navegación dentro del sitio se guarda como "/").
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith((async () => {
      const copia = await caches.match('/');
      const red = fetch(req).then((r) => guardar('/', r));
      if (!copia) return red.catch(sinConexion);
      const lenta = new Promise((ok) => setTimeout(() => ok(null), ESPERA_PAGINA_MS));
      const r = await Promise.race([red.catch(() => null), lenta]);
      return r && r.ok ? r : copia;
    })());
    return;
  }

  // Librerías, íconos y manifiesto del propio sitio: copia guardada primero.
  if (url.origin === location.origin && (url.pathname.startsWith('/lib/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest')) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => guardar(req, r)).catch(sinConexion)));
    return;
  }

  // Fuentes: copia guardada primero y actualización en segundo plano.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((c) => {
      const red = fetch(req).then((r) => guardar(req, r)).catch(() => c || sinConexion());
      return c || red;
    }));
  }
});
