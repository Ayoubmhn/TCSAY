/* Service worker TCSAY (fait main, sans bibliothèque).
 * - Interface : copies locales pour démarrer vite et fonctionner hors ligne (page « Pas de connexion »).
 * - Données de l'API : jamais mises en cache ici. Le site garde lui-même quelques lectures utiles sans réseau
 *   (séances, feuilles de présence, profil : `lib/offline-cache.ts`), effacées à la déconnexion ; aucun montant.
 * - Notifications push : affichage et ouverture de l'écran concerné.
 */
const VERSION = 'tcsay-dev'; // remplacée à chaque construction (vite.config.ts) : l'ancien cache est effacé à la mise en ligne
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/logo-tcsay.png', '/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // API : toujours le réseau (aucune donnée personnelle gardée sur le téléphone).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Pages : réseau d'abord, sinon l'application en cache, sinon « Pas de connexion ».
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  // Fichiers versionnés (/assets/…), icônes, police : cache d'abord, puis réseau.
  const cacheable =
    (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || /\.(png|svg|woff2?)$/.test(url.pathname))) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Notification push envoyée par l'API : { title, body, link, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'TCSAY', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'TCSAY', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { link: data.link || '/notifications' },
      lang: 'fr',
    }),
  );
});

// Toucher la notification : ouvre (ou ramène) l'application sur l'écran concerné.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(link).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
