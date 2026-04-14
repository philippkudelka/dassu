const CACHE_NAME = 'dassu-staff-v2';
const ASSETS = [
  '/staff.html',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request))
  );
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
