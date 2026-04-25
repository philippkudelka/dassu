const CACHE_NAME = 'dassu-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/staff.html',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting(); // Sofort aktivieren, nicht auf Tab-Schließung warten
});

self.addEventListener('activate', e => {
  // Alle alten Caches löschen
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // Sofort alle offenen Tabs übernehmen
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // HTML-Seiten: immer vom Netzwerk, Cache nur als Fallback (offline)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Alles andere (JS, CSS, Bilder): Cache first, dann Netzwerk
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)).catch(() => {});
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// Bei neuer SW-Version: alle Clients sofort neu laden
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Push event - for FCM push notifications (requires VAPID setup)
self.addEventListener('push', event => {
  let data = { title: 'DASSU Staff', body: 'Neue Buchung' };
  try {
    if (event.data) data = event.data.json();
  } catch(e) {
    if (event.data) data.body = event.data.text();
  }
  const options = {
    body: data.body,
    icon: 'https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=180w',
    badge: 'https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=96w',
    tag: data.tag || 'booking',
    data: data
  };
  event.waitUntil(self.registration.showNotification(data.title || 'DASSU Staff', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const bookingId = (event.notification.data && event.notification.data.bookingId) || '';
  const targetUrl = '/staff.html' + (bookingId ? ('?booking=' + encodeURIComponent(bookingId)) : '');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/staff') && 'focus' in c) {
          if ('navigate' in c) { c.navigate(targetUrl).catch(() => {}); }
          else if (bookingId && 'postMessage' in c) { c.postMessage({ type: 'openBooking', id: bookingId }); }
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
