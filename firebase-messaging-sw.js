// Firebase Messaging Service Worker — empfängt Push auch wenn App zu ist
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAe5CPZl8kb0bKfHIiGclHTpQK88MMsnTI",
  authDomain: "buchungskalender-ffe4c.firebaseapp.com",
  databaseURL: "https://buchungskalender-ffe4c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "buchungskalender-ffe4c",
  storageBucket: "buchungskalender-ffe4c.firebasestorage.app",
  messagingSenderId: "913839321247",
  appId: "1:913839321247:web:723106a2d73c048e15f2aa"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'DASSU Staff', {
    body: n.body || '',
    icon: 'https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=180w',
    badge: 'https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=96w',
    tag: data.bookingId || 'booking',
    data: data
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.includes('/staff') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/staff.html');
    })
  );
});
