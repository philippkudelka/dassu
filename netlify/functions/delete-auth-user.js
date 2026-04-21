/**
 * Netlify Function: Firebase Auth Account löschen
 * POST body: { uid: "..." }
 * Erfordert: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
 *
 * Wird vom Admin-Bereich aufgerufen, wenn ein Mitarbeiter oder Kunde gelöscht wird.
 * Prüft vorher, ob der Aufrufer Admin ist (via Firebase Auth Token).
 */
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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    initFirebase();

    // Auth-Token des Aufrufers prüfen
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '');
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

    // Sich selbst löschen verhindern
    if (targetUid === callerUid) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Eigenen Account kann man nicht löschen' }) };
    }

    // Firebase Auth Account löschen
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (e) {
      // User existiert evtl. nicht mehr in Auth – kein Fehler
      if (e.code !== 'auth/user-not-found') {
        throw e;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, message: 'Auth-Account gelöscht' })
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
