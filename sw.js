/* Service worker — offline support that still lets updates through.
 *
 * Strategy: stale-while-revalidate for our own files. The app opens instantly
 * from cache (and works with no signal), while a fresh copy is fetched in the
 * background and used on the next launch. Bump CACHE_VERSION when you deploy.
 */
const CACHE_VERSION = 'wayfinder-v46';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './countries.js',
  './store.js',
  './partners.js',
  './land.js',
  './world.js',
  './privacy.html',
  './support.html',
  './manifest.json',
  './vendor/supabase-2.113.0.js',
  './data/adventures.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // A new Cache Storage name does not invalidate the browser's HTTP cache.
      // Reusing that cache here can install old scripts beside a new HTML shell.
      // Keep the previous worker active unless the complete new shell downloads.
      .then(cache => cache.addAll(SHELL.map(url =>
        new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => /^wayfinder-v\d+$/.test(k)
        && k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch Supabase traffic or the CDN — those must always go to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async cache => {
      const cached = await cache.match(request);
      // Revalidate with the server even while the HTTP max-age is still fresh.
      // Cache Storage supplies the immediate/offline response below.
      const network = fetch(request, { cache: 'no-cache' })
        .then(async response => {
          if (response && response.ok) {
            try { await cache.put(request, response.clone()); }
            catch { /* A full cache must not discard a usable network response. */ }
          }
          return response;
        })
        .catch(() => null);

      // Serve cache immediately if we have it; otherwise wait for the network.
      if (cached) { event.waitUntil(network); return cached; }
      const fresh = await network;
      if (fresh) return fresh;
      const fallback = request.mode === 'navigate' ? await cache.match('./index.html') : null;
      return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});

// Tapping a reminder should open the app rather than a fresh tab.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
