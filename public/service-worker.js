const CACHE_PREFIX = 'sface-atlas-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/atlas/api') || url.pathname.startsWith('/relay/api') || url.pathname.startsWith('/admin/api')) return;
  if (url.pathname !== '/' && !url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/fonts/') && url.pathname !== '/manifest.webmanifest' && !url.pathname.startsWith('/icon')) return;
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached ?? Response.error());
    return cached ?? network;
  }));
});
