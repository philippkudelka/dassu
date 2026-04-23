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
      case 'members': {
        // Mitgliederliste holen, nur Namen zurückgeben (Datensparsamkeit)
        const users = await vfGetUserList(accesstoken);
        result = users.map(u => ({
          firstname: u.firstname || '',
          lastname: u.lastname || '',
          memberid: u.memberid || u.uid || ''
        })).filter(u => u.firstname || u.lastname)
          .sort((a, b) => (a.lastname || '').localeCompare(b.lastname || ''));
        break;
      }
      case 'memberFlights': {
        // Persönliches Flugbuch: Flüge eines Members (als PIC oder Begleiter)
        const { memberName } = body;
        if (!memberName) throw new Error('memberName erforderlich');
        const nameLower = memberName.toLowerCase();
        // Nachname extrahieren für zuverlässigeres Matching
        const lastName = nameLower.split(' ').pop();

        const now = new Date();
        const thisY = now.getFullYear();
        // Dieses + letztes Jahr holen
        const [flightsThisYear, flightsLastYear] = await Promise.all([
          vfGetFlightsDateRange(accesstoken, `${thisY}-01-01`, `${thisY}-12-31`),
          vfGetFlightsDateRange(accesstoken, `${thisY - 1}-01-01`, `${thisY - 1}-12-31`)
        ]);

        const allFlights = [...flightsThisYear, ...flightsLastYear];

        // Filter: Pilot ODER Begleiter enthält den Namen
        const memberFlights = allFlights.filter(f => {
          const pn = (f.pilotname || '').toLowerCase();
          const an = (f.attendantname || '').toLowerCase();
          const an2 = (f.attendantname2 || '').toLowerCase();
          const an3 = (f.attendantname3 || '').toLowerCase();
          return pn.includes(lastName) || an.includes(lastName) || an2.includes(lastName) || an3.includes(lastName);
        });

        // Für jeden Flug: Rolle bestimmen
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

        // Aggregation
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

        result = {
          totalFlights: enriched.length,
          totalPIC, totalPAX, totalFI,
          minutesPIC, minutesPAX,
          totalMinutes: minutesPIC + minutesPAX,
          flyingDays: uniqueDates.size,
          byAircraft, byMonth,
          recentFlights: enriched.slice(0, 30), // Letzte 30 Flüge
          years: [thisY, thisY - 1],
          fetchedAt: new Date().toISOString()
        };
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
