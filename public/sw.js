/*
 * Записки — service worker.
 * Мрежата е с приоритет; кешът е резервен вариант, за да могат вече
 * отворените тетрадки да се четат офлайн („Офлайн режим“ в настройките).
 */
const CACHE = 'zapiski-v1';
const SHELL = ['/', '/app', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Мутиращите/стриймващите API маршрути никога не се кешират.
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/notebooks')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: false });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/app');
          if (shell) return shell;
        }
        return new Response('Няма връзка и няма кеширано копие.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
