/**
 * Netlify Function: Firebase Auth Account + alle zugehörigen User-Daten löschen
 * POST body: { uid: "..." }
 * Erfordert: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
 *
 * Wird vom Admin-Bereich aufgerufen, wenn ein Mitarbeiter oder Kunde gelöscht wird.
 * Prüft vorher, ob der Aufrufer Admin ist (via Firebase Auth Token).
 *
 * Löscht zusätzlich zu admin.auth().deleteUser auch alle bekannten RTDB-Pfade
 * des Users (GDPR Art. 17, Datenschutz-Anhang §8).
 */
const admin = require('firebase-admin');

const ALLOWED_ORIGIN = 'https://dassu-buchungskalender.netlify.app';

let initialized = false;
function initFirebase() {
  if (initialized) return;
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt');
  const serviceAccount = JSON.parse(serviceAccountRaw);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  initialized = true;
}

// Alle bekannten User-zentrierten DB-Pfade — werden in einem multi-path-update entfernt
function userDataPaths(uid) {
  return [
    `staffUsers/${uid}`,
    `customers/${uid}`,
    `users/${uid}`,
    `training/${uid}`
  ];
}

// pushTokens sind nicht pro-UID indiziert → einmal komplett scannen und passende Einträge entfernen
async function removePushTokensForUid(uid) {
  const snap = await admin.database().ref('pushTokens').once('value');
  const data = snap.val() || {};
  const updates = {};
  Object.entries(data).forEach(([key, val]) => {
    if (val && val.uid === uid) updates[key] = null;
  });
  if (Object.keys(updates).length) {
    await admin.database().ref('pushTokens').update(updates);
  }
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    initFirebase();

    // Auth-Token des Aufrufers prüfen
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Kein Auth-Token' }) };
    }

    let callerUid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      callerUid = decoded.uid;
    } catch (e) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Ungültiger Token' }) };
    }

    // Prüfen ob Aufrufer Admin ist
    const callerSnap = await admin.database().ref('staffUsers/' + callerUid).once('value');
    const callerProfile = callerSnap.val();
    if (!callerProfile || callerProfile.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'Nur Admins dürfen Accounts löschen' }) };
    }

    // UID des zu löschenden Users
    const body = JSON.parse(event.body || '{}');
    const targetUid = body.uid;
    if (!targetUid) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'uid fehlt' }) };
    }

    if (targetUid === callerUid) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Eigenen Account kann man nicht löschen' }) };
    }

    // 1. Firebase Auth Account löschen
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // 2. Alle User-Daten aus der RTDB entfernen (GDPR Art. 17)
    const updates = {};
    userDataPaths(targetUid).forEach(p => { updates[p] = null; });
    await admin.database().ref().update(updates);

    // 3. Push-Tokens des Users entfernen (eigener Pfad, eigene Logik)
    await removePushTokensForUid(targetUid);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, message: 'Account und zugehörige Daten gelöscht' })
    };
  } catch (err) {
    console.error('delete-auth-user error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
