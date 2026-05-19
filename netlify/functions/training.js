// Netlify Function: Training-Daten lesen/schreiben via Admin SDK
// GET  ?studentUid=xxx  → Liest Trainingsdaten eines Schülers
// POST body: { studentUid, exerciseId, data: { dualHours, soloHours, masteredDate, note, instructorUid, instructorName } }
// Auth: Firebase ID-Token als Bearer-Token im Authorization-Header

const admin = require('firebase-admin');

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

// Prüft ob der User Staff/Fluglehrer ist
async function isStaffUser(uid) {
  const snap = await admin.database().ref('staffUsers/' + uid).once('value');
  return snap.exists();
}

// Prüft ob der User ein Schüler ist (customerType === 'student')
async function isStudent(uid) {
  const snap = await admin.database().ref('customers/' + uid + '/customerType').once('value');
  return snap.val() === 'student';
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://dassu-buchungskalender.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    initFirebase();

    // Token prüfen
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Kein Auth-Token' }) };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (e) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ungültiger Token' }) };
    }
    const callerUid = decoded.uid;

    // GET: Training-Daten lesen
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const studentUid = params.studentUid;
      if (!studentUid) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'studentUid fehlt' }) };
      }

      // Berechtigung: Staff darf alle lesen, Student nur eigene
      const staff = await isStaffUser(callerUid);
      if (!staff && callerUid !== studentUid) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Keine Berechtigung' }) };
      }

      const snap = await admin.database().ref('training/' + studentUid + '/spl-tmg').once('value');
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ progress: snap.val() || {} })
      };
    }

    // POST: Übung speichern
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { studentUid, exerciseId, data } = body;

      if (!studentUid || !exerciseId || !data) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'studentUid, exerciseId und data erforderlich' }) };
      }

      // Nur Staff/Fluglehrer dürfen schreiben
      const staff = await isStaffUser(callerUid);
      if (!staff) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Nur Fluglehrer können Ausbildungsdaten bearbeiten' }) };
      }

      await admin.database().ref('training/' + studentUid + '/spl-tmg/' + exerciseId).set(data);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (e) {
    console.error('Training function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
