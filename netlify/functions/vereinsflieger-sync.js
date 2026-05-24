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

// ---- DASSU-Flotte (Whitelist) ----
// Quelle: https://www.dassu.de/flotte (aktueller Bestand)
// Plus: HISTORISCHE Flugzeuge, deren Flüge weiterhin in Statistiken
// (z.B. Jahresvergleich Vorjahr) auftauchen sollen.
// Alle Listen/Statistiken berücksichtigen ausschließlich diese Kennzeichen.
const DASSU_FLEET = new Set([
  // Segelflugzeuge
  'D-3982', 'D-1375', 'D-1670', 'D-1800', 'D-1900', 'D-7507', // ASK 13
  'D-1130', 'D-8999',                                          // ASK 21
  'D-2249',                                                    // Duo Discus
  'D-8252', 'D-8251',                                          // LS4 B
  'D-8250',                                                    // HPH 304C
  'D-7770', 'D-1864',                                          // ASK23 b
  'D-1111', 'D-5096', 'D-8598', 'D-5343', 'D-7130',            // K8
  // Motorsegler
  'D-KYSS', 'D-KYGL', 'D-KYCK',
  // Ultraleicht
  'D-MYIH', 'D-MYUW',
  // --- Historisch / verkauft (für Vorjahres-Vergleiche weiterhin relevant) ---
  'D-MYIG'   // UL, verkauft 2025 — bleibt in der Statistik damit Vorjahres-Vergleiche stimmen
]);

// Tolerante Normalisierung: "d1234" → "D-1234", "D 1234" → "D-1234"
function normalizeCallsign(cs) {
  if (!cs) return '';
  let s = String(cs).toUpperCase().replace(/\s+/g, '').trim();
  // "D1234" → "D-1234" (Bindestrich ergänzen wenn fehlt)
  if (/^D[A-Z0-9]/.test(s)) s = 'D-' + s.substring(1);
  return s;
}

function isDassuAircraft(cs) {
  return DASSU_FLEET.has(normalizeCallsign(cs));
}

// Filtert ein Flug-Array auf DASSU-Flugzeuge und normalisiert das Kennzeichen
// (sodass alle Downstream-Auswertungen die kanonische "D-XXXX" Form sehen).
function filterDassuFlights(flights) {
  if (!Array.isArray(flights)) return [];
  return flights
    .filter(f => isDassuAircraft(f && f.callsign))
    .map(f => ({ ...f, callsign: normalizeCallsign(f.callsign) }));
}

// ---- Firebase Admin Setup ----
let firebaseInitialized = false;
function initFirebase() {
  if (firebaseInitialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
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
 * Helper: Extrahiere VF-Userdaten aus der API-Response.
 * Die API gibt manchmal direkte Properties zurück, manchmal ein verschachteltes Objekt mit numerischen Keys.
 * @param {any} data — Raw response data
 * @returns {{uid: string, memberid: string, displayName: string} | null}
 */
function extractVfUserData(data) {
  if (!data || typeof data !== 'object') return null;

  // Versuch 1: Direkte Properties (einfaches Objekt)
  if (data.uid || data.firstname || data.lastname || data.memberid) {
    const uid = String(data.uid || '').trim();
    const memberid = String(data.memberid || '').trim();
    const displayName = ((String(data.firstname || '') + ' ' + String(data.lastname || '')).trim());
    if (uid || memberid || displayName) {
      return { uid, memberid, displayName };
    }
  }

  // Versuch 2: Verschachtelte Struktur mit numerischen Keys (wie bei /user/list)
  const values = Object.values(data);
  for (const v of values) {
    if (v && typeof v === 'object' && (v.uid || v.firstname || v.lastname || v.memberid)) {
      const uid = String(v.uid || '').trim();
      const memberid = String(v.memberid || '').trim();
      const displayName = ((String(v.firstname || '') + ' ' + String(v.lastname || '')).trim());
      if (uid || memberid || displayName) {
        return { uid, memberid, displayName };
      }
    }
  }

  return null;
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
  return { accesstoken, httpheader: data.httpheader || accesstoken, signinData: data };
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
  let flights;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.error_code && data.error_code !== '0') {
      throw new Error('API Fehler: ' + (data.error_msg || JSON.stringify(data)));
    }
    flights = Object.values(data).filter(v => typeof v === 'object' && v !== null && v.flid);
  } else {
    flights = Array.isArray(data) ? data : [];
  }
  // WHITELIST: nur Flugzeuge der DASSU-Flotte zurückgeben
  return filterDassuFlights(flights);
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
    if (!byAircraft[cs]) byAircraft[cs] = { count: 0, minutes: 0, starttypes: {} };
    byAircraft[cs].count++;
    byAircraft[cs].minutes += dur;
    // Startart pro Flugzeug zählen (für Motorsegler-/Segler-Erkennung)
    const st = (f.starttype != null ? String(f.starttype) : '').trim();
    if (st) byAircraft[cs].starttypes[st] = (byAircraft[cs].starttypes[st] || 0) + 1;

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

/**
 * Sucht einen VF-Benutzer über den Staff-Account anhand des Usernamens (Email).
 * Wird verwendet wenn /user/get für den persönlichen Account gesperrt ist.
 * @param {string} vfUsername — Der Benutzername (Email) aus dem Login-Formular
 * @returns {{uid: string, memberid: string, displayName: string} | null}
 */
async function lookupVfUserViaStaff(vfUsername) {
  let staffToken = null;
  try {
    staffToken = await vfGetAccessToken();
    const staffSession = await vfSignIn(staffToken); // Env-Vars = Staff-Account
    staffToken = staffSession.accesstoken;
    const users = await vfGetUserList(staffToken);

    // Suche nach Username-Match (case-insensitive)
    const searchName = vfUsername.toLowerCase().trim();
    for (const u of users) {
      const email = (u.email || '').toLowerCase().trim();
      const uname = (u.username || '').toLowerCase().trim();
      if ((email && email === searchName) || (uname && uname === searchName)) {
        const uid = String(u.uid || '').trim();
        const memberid = String(u.memberid || '').trim();
        const displayName = ((String(u.firstname || '') + ' ' + String(u.lastname || '')).trim());
        await vfSignOut(staffToken);
        return { uid, memberid, displayName };
      }
    }
    await vfSignOut(staffToken);
    return null;
  } catch (e) {
    if (staffToken) await vfSignOut(staffToken);
    console.log('lookupVfUserViaStaff error:', e.message);
    return null;
  }
}

// ---- Handler ----

const ALLOWED_ORIGIN = 'https://dassu-buchungskalender.netlify.app';

// Actions die VF-Credentials/firebaseToken aus dem Body nutzen — diese verifizieren den User selbst.
const PERSONAL_ACTIONS = new Set(['saveVfCredentials', 'deleteVfCredentials', 'getVfStatus']);
// Staff-Actions erfordern admin- oder team-Rolle.
const STAFF_ONLY_ACTIONS = new Set(['instructors', 'instructorStats', 'yearCompare']);
// "members" benötigt nur Authentifizierung (Member-Frontend nutzt es für Auswahllisten).

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
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
  let callerUid = null; // wird im Auth-Gate gesetzt, von Staff-Actions genutzt

  // ============================================================
  // Auth-Gate für nicht-persönliche Actions (members, staff actions)
  // ============================================================
  if (!PERSONAL_ACTIONS.has(action)) {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Kein Auth-Token' }) };
    }
    try {
      initFirebase();
      const decoded = await admin.auth().verifyIdToken(idToken);
      callerUid = decoded.uid;
    } catch (_) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Ungültiger Token' }) };
    }
    // Für Staff-Actions zusätzlich Rolle prüfen
    if (STAFF_ONLY_ACTIONS.has(action)) {
      const snap = await admin.database().ref('staffUsers/' + callerUid).once('value');
      const profile = snap.val();
      const role = profile && profile.role;
      if (role !== 'admin' && role !== 'team') {
        return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'Keine Berechtigung' }) };
      }
    }
  }

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

      // VF-Userdaten holen
      let vfData = null;
      let vfDisplayName = '', vfUid = '', vfMemberid = '';

      // Versuch 1: Userdaten aus der signin-Response extrahieren
      vfData = extractVfUserData(session.signinData);

      // Versuch 2: /user/get (funktioniert nur bei Accounts mit API-Berechtigung)
      if (!vfData || (!vfData.uid && !vfData.memberid)) {
        try {
          const res = await fetch(`${VF_BASE}/user/get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ accesstoken }).toString()
          });
          const userData = await res.json();
          if (!userData.error) {
            vfData = extractVfUserData(userData);
          }
        } catch (_) { /* /user/get nicht verfügbar */ }
      }

      // Versuch 3: Staff-Account nutzen um User über /user/list zu finden
      if (!vfData || (!vfData.uid && !vfData.memberid)) {
        vfData = await lookupVfUserViaStaff(vfUsername);
      }

      if (vfData) {
        vfUid = vfData.uid;
        vfMemberid = vfData.memberid;
        vfDisplayName = vfData.displayName;
      }

      // Der Login war erfolgreich (sonst hätte vfSignIn bereits geworfen) —
      // die Credentials sind also gültig. Die VF-Benutzerdaten (uid/memberid)
      // werden nur fürs persönliche Flugbuch gebraucht, NICHT für die Statistik.
      // Daher: speichern auch ohne abrufbare Benutzerdaten. Fallback-Anzeigename.
      if (!vfDisplayName) vfDisplayName = vfUsername;

      await vfSignOut(accesstoken);

      // Verschlüsseln und in Firebase speichern
      const encUsername = encrypt(vfUsername);
      const encPassword = encrypt(vfPassword);
      initFirebase();
      await admin.database().ref(`users/${uid}/vfCredentials`).set({
        username: encUsername,
        password: encPassword,
        displayName: vfDisplayName,
        vfUid: vfUid,
        vfMemberid: vfMemberid,
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


    // ============================================================
    // Staff-Actions — nutzen die PERSÖNLICHEN VF-Zugangsdaten des eingeloggten
    // Nutzers. Jeder Admin muss sein VF-Konto einmal im Konto-Bereich verknüpfen.
    // ============================================================
    const staffCredSnap = await admin.database().ref('users/' + callerUid + '/vfCredentials').once('value');
    const staffCreds = staffCredSnap.val();
    if (!staffCreds || !staffCreds.username || !staffCreds.password) {
      throw new Error('Kein Vereinsflieger-Konto verknüpft. Bitte zuerst im Konto-Bereich dein persönliches VF-Konto verbinden.');
    }
    accesstoken = await vfGetAccessToken();
    const session = await vfSignIn(accesstoken, {
      username: decrypt(staffCreds.username),
      password: decrypt(staffCreds.password)
    });
    accesstoken = session.accesstoken;

    let result;

    switch (action) {
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
      case 'instructors': {
        // Fluglehrer aus VF-Mitgliederliste anhand der Rollen
        const instrUsers = await vfGetUserList(accesstoken);
        const instrRoles = ['Fluglehrer', 'Ausbildungsleiter', 'DASS TMG/UL Lehrer'];
        const instrNames = new Set();
        instrUsers.forEach(u => {
          const roles = (u.roles || []).map(r => r.trim());
          if (roles.some(r => instrRoles.includes(r))) {
            const name = [(u.firstname || '').trim(), (u.lastname || '').trim()].filter(Boolean).join(' ');
            if (name) instrNames.add(name);
          }
        });
        result = [...instrNames].sort((a, b) => a.localeCompare(b, 'de'));
        break;
      }
      case 'instructorStats': {
        // Fluglehrer-Statistik: 3 Jahre einzeln
        // Fluglehrer = attendantname auf Schulungsflügen (ft_education === "1")
        const today = new Date();
        const y = today.getFullYear();
        const years = [y, y - 1, y - 2];

        const yearFlights = await Promise.all(
          years.map(yr => vfGetFlightsDateRange(accesstoken, `${yr}-01-01`, `${yr}-12-31`))
        );

        const byYear = {};
        years.forEach((yr, idx) => {
          const flights = yearFlights[idx];
          const instructors = {};
          flights.forEach(f => {
            // Nur Schulungsflüge (ft_education === "1")
            if (String(f.ft_education) !== '1') return;
            const fiName = (f.attendantname || '').trim();
            if (!fiName) return;
            if (!instructors[fiName]) instructors[fiName] = { flights: 0, minutes: 0, landings: 0, dates: new Set() };
            instructors[fiName].flights++;
            instructors[fiName].minutes += parseDuration(f);
            instructors[fiName].landings += parseInt(f.landingcount) || 0;
            const d = f.dateofflight || '';
            if (d) instructors[fiName].dates.add(d);
          });
          const instrResult = {};
          Object.entries(instructors).forEach(([name, data]) => {
            instrResult[name] = {
              flights: data.flights,
              minutes: data.minutes,
              landings: data.landings,
              flyingDays: data.dates.size
            };
          });
          byYear[yr] = instrResult;
        });

        result = { byYear, years, fetchedAt: new Date().toISOString() };
        break;
      }
      case 'yearCompare': {
        // Flüge für aktuelles Jahr + Vorjahr abrufen (bis zum heutigen Tag).
        // Optimierung: lastYearFull enthält lastYearSameDay vollständig — wir holen also nur
        // 2 statt 3 Daterange-Calls und schneiden lastYearSameDay lokal aus lastYearFull.
        const today = new Date();
        const y = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        const thisYearFrom = `${y}-01-01`;
        const thisYearTo = `${y}-${mm}-${dd}`;
        const lastYearFrom = `${y - 1}-01-01`;
        const lastYearTo = `${y - 1}-${mm}-${dd}`;
        const lastYearFullTo = `${y - 1}-12-31`;

        const [thisYear, lastYearFull] = await Promise.all([
          vfGetFlightsDateRange(accesstoken, thisYearFrom, thisYearTo),
          vfGetFlightsDateRange(accesstoken, lastYearFrom, lastYearFullTo)
        ]);
        // Stichtags-Vorjahr: alle Flüge aus lastYearFull, deren Datum ≤ lastYearTo ist
        const lastYearSameDay = lastYearFull.filter(f => (f.dateofflight || '') <= lastYearTo);

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
