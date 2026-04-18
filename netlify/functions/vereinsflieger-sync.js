/**
 * Netlify Serverless Function: Vereinsflieger API Proxy
 *
 * Ruft Flugdaten von der Vereinsflieger REST API ab und gibt sie zurück.
 * Umgeht CORS-Einschränkungen, da der Aufruf server-seitig erfolgt.
 *
 * Umgebungsvariablen (in Netlify Dashboard setzen):
 *   VF_APPKEY   – App Key aus Vereinsflieger Administration
 *   VF_USERNAME – Vereinsflieger Benutzername/E-Mail
 *   VF_PASSWORD – Vereinsflieger Passwort
 */
const crypto = require('crypto');

const VF_BASE = 'https://www.vereinsflieger.de/interface/rest';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// ---- Vereinsflieger API helpers ----

async function vfGetAccessToken() {
  const res = await fetch(`${VF_BASE}/auth/accesstoken`, { method: 'GET' });
  const data = await res.json();
  if (!data.accesstoken) throw new Error('Kein Access Token erhalten');
  return data.accesstoken;
}

async function vfSignIn(accesstoken) {
  const { VF_APPKEY, VF_USERNAME, VF_PASSWORD } = process.env;
  if (!VF_APPKEY || !VF_USERNAME || !VF_PASSWORD) {
    throw new Error('Vereinsflieger-Zugangsdaten nicht konfiguriert (VF_APPKEY, VF_USERNAME, VF_PASSWORD)');
  }

  const res = await fetch(`${VF_BASE}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      accesstoken,
      appkey: VF_APPKEY,
      username: VF_USERNAME,
      password: md5(VF_PASSWORD),
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
    return Object.values(data).filter(v => typeof v === 'object' && v !== null && v.flightid);
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
    // Auth
    accesstoken = await vfGetAccessToken();
    const session = await vfSignIn(accesstoken);
    accesstoken = session.accesstoken;

    let result;

    switch (action) {
      case 'flights': {
        // Flüge für einen Zeitraum abrufen
        const { dateFrom, dateTo } = body;
        if (!dateFrom || !dateTo) throw new Error('dateFrom und dateTo erforderlich');
        result = await vfGetFlightsDateRange(accesstoken, dateFrom, dateTo);
        break;
      }
      case 'aircraft': {
        result = await vfGetAircraftList(accesstoken);
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

        result = {
          thisYear: { flights: thisYear, from: thisYearFrom, to: thisYearTo },
          lastYearSameDay: { flights: lastYearSameDay, from: lastYearFrom, to: lastYearTo },
          lastYearFull: { flights: lastYearFull, from: lastYearFrom, to: lastYearFullTo },
          fetchedAt: new Date().toISOString()
        };
        break;
      }
      case 'debug': {
        // Raw-Antworten zum Debuggen zurückgeben
        const signinRes = await fetch(`${VF_BASE}/auth/getuser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ accesstoken }).toString()
        });
        const userInfo = await signinRes.json();

        const flightRes = await fetch(`${VF_BASE}/flight/list/daterange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ accesstoken, datefrom: '2025-06-01', dateto: '2025-06-30' }).toString()
        });
        const rawFlightText = await flightRes.text();

        result = {
          userInfo,
          flightStatus: flightRes.status,
          flightRaw: rawFlightText.substring(0, 2000),
          accesstoken: accesstoken.substring(0, 8) + '...'
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
