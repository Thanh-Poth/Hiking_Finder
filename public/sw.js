// Service worker : coque de l'application et données en cache (réseau d'abord, cache en secours),
// tuiles Plan IGN mises en cache explicitement par l'utilisateur (cache d'abord).
const APP = 'app-v1';
const TILES = 'tiles-ign-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'data.geopf.fr' && url.searchParams.get('LAYER') === 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2') {
    e.respondWith(caches.open(TILES).then((c) => c.match(req.url).then((hit) => hit || fetch(req))));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
