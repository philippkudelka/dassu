// Netlify Function: sendet Push-Notification an alle registrierten Mitarbeiter
// POST body: { title: "...", body: "...", bookingId: "..." }
// Erfordert Umgebungsvariablen:
//   FIREBASE_SERVICE_ACCOUNT  - JSON des Service Accounts (als String)
//   FIREBASE_DATABASE_URL     - z.B. https://buchungskalender-ffe4c-default-rtdb.europe-west1.firebasedatabase.app

const admin = require('firebase-admin');

let initialized = false;
function initFirebase() {
  if (initialized) return;
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt');
  const serviceAccount = JSON.parse(serviceAccountRaw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  initialized = true;
}

exports.handler = async function(event) {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    initFirebase();
    const payload = JSON.parse(event.body || '{}');
    const title = payload.title || 'Neue Buchung';
    const body = payload.body || '';
    const bookingId = payload.bookingId || '';

    // Alle Tokens aus der Datenbank holen
    const snap = await admin.database().ref('pushTokens').once('value');
    const tokensData = snap.val() || {};
    const tokens = Object.values(tokensData).map(t => t.token).filter(Boolean);

    if (!tokens.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, note: 'Keine Tokens registriert' }) };
    }

    const message = {
      notification: { title, body },
      data: { bookingId: String(bookingId) },
      webpush: {
        fcmOptions: { link: '/staff.html' },
        notification: {
          icon: 'https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=180w'
        }
      }
    };

    // Batches a 500
    let success = 0, failure = 0;
    const invalid = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await admin.messaging().sendEachForMulticast({ ...message, tokens: batch });
      success += res.successCount;
      failure += res.failureCount;
      res.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            invalid.push(batch[idx]);
          }
        }
      });
    }

    // Tote Tokens aufr&auml;umen
    if (invalid.length) {
      const updates = {};
      Object.entries(tokensData).forEach(([key, v]) => {
        if (invalid.includes(v.token)) updates[key] = null;
      });
      if (Object.keys(updates).length) await admin.database().ref('pushTokens').update(updates);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ sent: success, failed: failure, cleaned: invalid.length }) };
  } catch (err) {
    console.error('Push error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
