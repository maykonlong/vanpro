const CACHE_NAME = 'vanpro-elite-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

// Listener para Push Notifications (Fase 22)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Notificação VanPro', body: 'Você tem um novo alerta.' };
  
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [200, 100, 200]
    })
  );
});
