/**
 * Netlify Serverless Function: Vereinsflieger API Proxy
 *
 * Ruft Flugdaten von der Vereinsflieger REST API ab und gibt sie zurück.
 * Umgeht CORS-Einschränkungen, da der Aufruf server-seitig erfolgt.
 *
 * Umgebungsvariablen (in Netlify Dashboard setzen):
 *   VF_APPKEY            – App Key aus Vereinsflieger Administration
 *   VF_USERNAME          – Vereinsflieger Benutzername (nur für Staff-Funktionen)
 *   VF_PASSWORD          – Vereinsflieger Passwort (nur für Staff-Funktionen)
 *   VF_ENCRYPTION_KEY    – 32-Byte hex Key für AES-256-GCM Verschlüsselung der User-Credentials
 *   FIREBASE_SERVICE_ACCOUNT – Firebase Service Account JSON
 *   FIREBASE_DATABASE_URL    – Firebase Realtime Database URL
 */
const crypto = require('crypto');
const admin = require('firebase-admin');

const VF_BASE = 'https://www.vereinsflieger.de/interface/rest';

// ---- Firebase Admin Setup ----
let firebaseInitialized = false;
function initFirebase() {
  if (firebaseInitialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  firebaseInitialized = true;
}

// ---- Crypto helpers ----

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function encrypt(text) {
  const key = process.env.VF_ENCRYPTION_KEY;
  if (!key) throw new Error('VF_ENCRYPTION_KEY env var fehlt');
  const keyBuf = Buffer.from(key, 'hex'); // 32 bytes
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(data) {
  const key = process.env.VF_ENCRYPTION_KEY;
  if (!key) throw new Error('VF_ENCRYPTION_KEY env var fehlt');
  const keyBuf = Buffer.from(key, 'hex');
  const [ivHex, tagHex, encHex] = data.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---- Firebase Token Verification ----

async function verifyFirebaseToken(idToken) {
  initFirebase();
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
}

// ---- Vereinsflieger API helpers ----

async function vfGetAccessToken() {
  const res = await fetch(`${VF_BASE}/auth/accesstoken`, { method: 'GET' });
  const data = await res.json();
  if (!data.accesstoken) throw new Error('Kein Access Token erhalten');
  return data.accesstoken;
}

/**
 * VF Sign-In — entweder mit übergebenen Credentials oder mit Env-Vars (Staff).
 * @param {string} accesstoken
 * @param {{ username: string, password: string }} [credentials] — wenn null, werden Env-Vars genutzt
 */
async function vfSignIn(accesstoken, credentials) {
  const appkey = process.env.VF_APPKEY;
  if (!appkey) throw new Error('VF_APPKEY nicht konfiguriert');

  let username, passwordHash;
  if (credentials) {
    username = credentials.username;
    // User-Passwort kommt bereits als Klartext — wir hashen es
    passwordHash = md5(credentials.password);
  } else {
    const { VF_USERNAME, VF_PASSWORD } = process.env;
    if (!VF_USERNAME || !VF_PASSWORD) {
      throw new Error('Vereinsflieger Staff-Zugangsdaten nicht konfiguriert');
    }
    username = VF_USERNAME;
    passwordHash = md5(VF_PASSWORD);
  }

  const res = await fetch(`${VF_BASE}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      accesstoken,
      appkey,
      username,
      password: passwordHash,
      auth_secret: '',
      cid: ''
    }).toString()
  });
  const data = await res.json();
  if (data.error_code && data.error_code !== '0') {
    throw new Error('Vereinsflieger Login fehlgeschlagen: ' + (data.error_msg || JSON.stringify(data)));
  }
  return { accesstoken, httpheader: data.httpheader || accesstoken };
}

async function vfSignOut(accesstoken) {
  try {
    await fetch(`${VF_BASE}/auth/signout/${accesstoken}`, {
      method: 'DELETE'
    });
  } catch (_) { /* ignore */ }
}

async function vfGetFlightsDateRange(accesstoken, dateFrom, dateTo) {
  const res = await fetch(`${VF_BASE}/flight/list/daterange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ accesstoken, datefrom: dateFrom, dateto: dateTo }).toString()
  });
  const data = await res.json();
  // API returns object with numeric keys → convert to array
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.error_code && data.error_code !== '0') {
      throw new Error('API Fehler: ' + (data.error_msg || JSON.stringify(data)));
    }
    return Object.values(data).filter(v => typeof v === 'object' && v !== null && v.flid);
  }
  return Array.isArray(data) ? data : [];
}

async function vfGetUserList(accesstoken) {
  const res = await fetch(`${VF_BASE}/user/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ accesstoken }).toString()
  });
  const data = await res.json();
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.error_code && data.error_code !== '0') {
      throw new Error('API Fehler: ' + (data.error_msg || JSON.stringify(data)));
    }
    return Object.values(data).filter(v => typeof v === 'object' && v !== null && (v.firstname || v.lastname));
  }
  return Array.isArray(data) ? data : [];
}

async function vfGetAircraftList(accesstoken) {
  const res = await fetch(`${VF_BASE}/aircraft/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ accesstoken }).toString()
  });
  const data = await res.json();
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return Object.values(data).filter(v => typeof v === 'object' && v !== null && v.callsign);
  }
  return Array.isArray(data) ? data : [];
}

// ---- Server-side Aggregation ----

function parseDuration(flight) {
  // flighttime is "HH:MM" or minutes
  if (flight.flighttime) {
    const t = String(flight.flighttime);
    if (t.includes(':')) {
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    }
    return parseInt(t, 10) || 0;
  }
  if (flight.departuretime && flight.arrivaltime) {
    const dep = flight.departuretime.split(':').map(Number);
    const arr = flight.arrivaltime.split(':').map(Number);
    return Math.max(0, (arr[0] * 60 + arr[1]) - (dep[0] * 60 + dep[1]));
  }
  return 0;
}

function aggregateFlights(flights) {
  let totalFlights = flights.length;
  let totalMinutes = 0;
  const byAircraft = {};
  const byMonth = {};
  const uniqueDates = new Set();

  flights.forEach(f => {
    const dur = parseDuration(f);
    totalMinutes += dur;

    const cs = f.callsign || 'Unbekannt';
    if (!byAircraft[cs]) byAircraft[cs] = { count: 0, minutes: 0 };
    byAircraft[cs].count++;
    byAircraft[cs].minutes += dur;

    const date = f.dateofflight || '';
    if (date) {
      uniqueDates.add(date);
      const mk = date.substring(0, 7); // YYYY-MM
      if (!byMonth[mk]) byMonth[mk] = { count: 0, minutes: 0 };
      byMonth[mk].count++;
      byMonth[mk].minutes += dur;
    }
  });

  return { totalFlights, totalMinutes, byAircraft, byMonth, flyingDays: uniqueDates.size };
}

// ---- Handler ----

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Nur POST erlaubt' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiges JSON' }) };
  }

  const { action } = body;
  let accesstoken;

  try {
    // ============================================================
    // Actions die PERSÖNLICHE VF-Credentials nutzen (Firebase Auth erforderlich)
    // ============================================================
    if (action === 'saveVfCredentials') {
      // VF-Zugangsdaten speichern: Testet Login, verschlüsselt und speichert in Firebase
      const { firebaseToken, vfUsername, vfPassword } = body;
      if (!firebaseToken || !vfUsername || !vfPassword) {
        throw new Error('firebaseToken, vfUsername und vfPassword erforderlich');
      }
      const uid = await verifyFirebaseToken(firebaseToken);

      // Test: Können wir uns mit diesen Daten einloggen?
      accesstoken = await vfGetAccessToken();
      const session = await vfSignIn(accesstoken, { username: vfUsername, password: vfPassword });
      accesstoken = session.accesstoken;

      // VF-Userdaten holen um den Namen zu ermitteln
      let vfDisplayName = '';
      try {
        const res = await fetch(`${VF_BASE}/user/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ accesstoken }).toString()
        });
        const userData = await res.json();
        if (userData.firstname || userData.lastname) {
          vfDisplayName = ((userData.firstname || '') + ' ' + (userData.lastname || '')).trim();
        }
      } catch (_) { /* Name optional */ }

      await vfSignOut(accesstoken);

      // Verschlüsseln und in Firebase speichern
      const encUsername = encrypt(vfUsername);
      const encPassword = encrypt(vfPassword);
      initFirebase();
      await admin.database().ref(`users/${uid}/vfCredentials`).set({
        username: encUsername,
        password: encPassword,
        displayName: vfDisplayName,
        connectedAt: new Date().toISOString()
      });

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, data: { connected: true, displayName: vfDisplayName } })
      };
    }

    if (action === 'deleteVfCredentials') {
      const { firebaseToken } = body;
      if (!firebaseToken) throw new Error('firebaseToken erforderlich');
      const uid = await verifyFirebaseToken(firebaseToken);
      initFirebase();
      await admin.database().ref(`users/${uid}/vfCredentials`).remove();
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, data: { connected: false } })
      };
    }

    if (action === 'getVfStatus') {
      const { firebaseToken } = body;
      if (!firebaseToken) throw new Error('firebaseToken erforderlich');
      const uid = await verifyFirebaseToken(firebaseToken);
      initFirebase();
      const snap = await admin.database().ref(`users/${uid}/vfCredentials`).once('value');
      const val = snap.val();
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          data: {
            connected: !!val,
            displayName: val ? val.displayName || '' : '',
            connectedAt: val ? val.connectedAt || '' : ''
          }
        })
      };
    }

    if (action === 'memberFlights') {
      // Persönliches Flugbuch: Nutzt die gespeicherten VF-Credentials des Users
      const { firebaseToken } = body;
      if (!firebaseToken) throw new Error('firebaseToken erforderlich');
      const uid = await verifyFirebaseToken(firebaseToken);

      // Gespeicherte Credentials aus Firebase lesen
      initFirebase();
      const snap = await admin.database().ref(`users/${uid}/vfCredentials`).once('value');
      const creds = snap.val();
      if (!creds || !creds.username || !creds.password) {
        throw new Error('Keine Vereinsflieger-Zugangsdaten hinterlegt. Bitte zuerst verbinden.');
      }

      const vfUsername = decrypt(creds.username);
      const vfPassword = decrypt(creds.password);
      const memberName = creds.displayName || '';

      // Mit persönlichen Credentials einloggen
      accesstoken = await vfGetAccessToken();
      await vfSignIn(accesstoken, { username: vfUsername, password: vfPassword });

      const nameLower = memberName.toLowerCase();
      const lastName = nameLower.split(' ').pop();

      const now = new Date();
      const thisY = now.getFullYear();
      const [flightsThisYear, flightsLastYear] = await Promise.all([
        vfGetFlightsDateRange(accesstoken, `${thisY}-01-01`, `${thisY}-12-31`),
        vfGetFlightsDateRange(accesstoken, `${thisY - 1}-01-01`, `${thisY - 1}-12-31`)
      ]);

      const allFlights = [...flightsThisYear, ...flightsLastYear];

      const memberFlights = allFlights.filter(f => {
        const pn = (f.pilotname || '').toLowerCase();
        const an = (f.attendantname || '').toLowerCase();
        const an2 = (f.attendantname2 || '').toLowerCase();
        const an3 = (f.attendantname3 || '').toLowerCase();
        return pn.includes(lastName) || an.includes(lastName) || an2.includes(lastName) || an3.includes(lastName);
      });

      const enriched = memberFlights.map(f => {
        const pn = (f.pilotname || '').toLowerCase();
        let role = 'PAX';
        if (pn.includes(lastName)) role = 'PIC';
        if (f.finame && (f.finame || '').toLowerCase().includes(lastName)) role = 'FI';
        return {
          date: f.dateofflight,
          callsign: f.callsign || '',
          planedesignation: f.planedesignation || '',
          planetype: f.planetype || '',
          departuretime: f.departuretime || '',
          arrivaltime: f.arrivaltime || '',
          flighttime: parseDuration(f),
          departurelocation: f.departurelocation || '',
          arrivallocation: f.arrivallocation || '',
          landingcount: parseInt(f.landingcount) || 0,
          starttype: f.starttype || '',
          pilotname: f.pilotname || '',
          attendantname: f.attendantname || '',
          finame: f.finame || '',
          role: role
        };
      }).sort((a, b) => b.date.localeCompare(a.date) || (b.departuretime || '').localeCompare(a.departuretime || ''));

      let totalPIC = 0, totalPAX = 0, totalFI = 0;
      let minutesPIC = 0, minutesPAX = 0;
      const byAircraft = {};
      const byMonth = {};
      const uniqueDates = new Set();

      enriched.forEach(f => {
        if (f.role === 'PIC') { totalPIC++; minutesPIC += f.flighttime; }
        else if (f.role === 'FI') { totalFI++; minutesPIC += f.flighttime; }
        else { totalPAX++; minutesPAX += f.flighttime; }

        const cs = f.callsign;
        if (!byAircraft[cs]) byAircraft[cs] = { count: 0, minutes: 0, type: f.planedesignation, planetype: f.planetype, lastFlight: '' };
        byAircraft[cs].count++;
        byAircraft[cs].minutes += f.flighttime;
        if (!byAircraft[cs].lastFlight || f.date > byAircraft[cs].lastFlight) byAircraft[cs].lastFlight = f.date;

        if (f.date) {
          uniqueDates.add(f.date);
          const mk = f.date.substring(0, 7);
          if (!byMonth[mk]) byMonth[mk] = { count: 0, minutes: 0 };
          byMonth[mk].count++;
          byMonth[mk].minutes += f.flighttime;
        }
      });

      await vfSignOut(accesstoken);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true, data: {
            totalFlights: enriched.length,
            totalPIC, totalPAX, totalFI,
            minutesPIC, minutesPAX,
            totalMinutes: minutesPIC + minutesPAX,
            flyingDays: uniqueDates.size,
            byAircraft, byMonth,
            recentFlights: enriched.slice(0, 30),
            years: [thisY, thisY - 1],
            memberName,
            fetchedAt: new Date().toISOString()
          }
        })
      };
    }

    // ============================================================
    // Staff-Actions — nutzen den zentralen Admin-VF-Account (Env-Vars)
    // ============================================================
    accesstoken = await vfGetAccessToken();
    const session = await vfSignIn(accesstoken); // ohne credentials → Env-Vars
    accesstoken = session.accesstoken;

    let result;

    switch (action) {
      case 'flights': {
        const { dateFrom, dateTo } = body;
        if (!dateFrom || !dateTo) throw new Error('dateFrom und dateTo erforderlich');
        result = await vfGetFlightsDateRange(accesstoken, dateFrom, dateTo);
        break;
      }
      case 'aircraft': {
        result = await vfGetAircraftList(accesstoken);
        break;
      }
      case 'members': {
        const users = await vfGetUserList(accesstoken);
        result = users.map(u => ({
          firstname: u.firstname || '',
          lastname: u.lastname || '',
          memberid: u.memberid || u.uid || ''
        })).filter(u => u.firstname || u.lastname)
          .sort((a, b) => (a.lastname || '').localeCompare(b.lastname || ''));
        break;
      }
      case 'yearCompare': {
        // Flüge für aktuelles Jahr + Vorjahr abrufen (bis zum heutigen Tag)
        const today = new Date();
        const y = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        const thisYearFrom = `${y}-01-01`;
        const thisYearTo = `${y}-${mm}-${dd}`;
        const lastYearFrom = `${y - 1}-01-01`;
        const lastYearTo = `${y - 1}-${mm}-${dd}`;
        const lastYearFullTo = `${y - 1}-12-31`;

        const [thisYear, lastYearSameDay, lastYearFull] = await Promise.all([
          vfGetFlightsDateRange(accesstoken, thisYearFrom, thisYearTo),
          vfGetFlightsDateRange(accesstoken, lastYearFrom, lastYearTo),
          vfGetFlightsDateRange(accesstoken, lastYearFrom, lastYearFullTo)
        ]);

        // Aggregate server-side to keep response small
        result = {
          thisYear: { ...aggregateFlights(thisYear), from: thisYearFrom, to: thisYearTo },
          lastYearSameDay: { ...aggregateFlights(lastYearSameDay), from: lastYearFrom, to: lastYearTo },
          lastYearFull: { ...aggregateFlights(lastYearFull), from: lastYearFrom, to: lastYearFullTo },
          fetchedAt: new Date().toISOString()
        };
        break;
      }
      default:
        throw new Error('Unbekannte Aktion: ' + action);
    }

    // Sign out
    await vfSignOut(accesstoken);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, data: result })
    };

  } catch (err) {
    if (accesstoken) await vfSignOut(accesstoken);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
