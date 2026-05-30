/**
 * Netlify Function: iCalendar-Feed
 *
 * Liefert die Buchungen eines Users als .ics-Datei (RFC 5545), damit sie in
 * Apple Kalender / Google Calendar / Outlook abonniert werden können.
 *
 * URL: /.netlify/functions/ical-feed?token=<icalToken>
 *
 * Authentifizierung über einen geheimen Token pro User (statt Bearer-Token),
 * damit der Kalender-Client die URL ohne Cookies/Header abrufen kann.
 * Der Token wird vom Frontend generiert + in users/{uid}/icalToken gespeichert.
 *
 * Bei einer kompromittierten URL kann der User den Token einfach rotieren
 * (neuen generieren, alten wird damit ungültig).
 */
const admin = require('firebase-admin');

let initialized = false;
function initFirebase() {
  if (initialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var fehlt');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  initialized = true;
}

// Escaped Sonderzeichen für iCal-TEXT-Werte (RFC 5545 §3.3.11)
function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// Faltet Zeilen >75 Oktetten — Folge-Zeilen beginnen mit Leerzeichen (RFC 5545 §3.1)
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < line.length) {
    const chunk = i === 0 ? line.substring(0, 75) : ' ' + line.substring(i, i + 74);
    out.push(chunk);
    i += i === 0 ? 75 : 74;
  }
  return out.join('\r\n');
}

// "2026-05-30" + "14:30" → "20260530T143000"
function icsLocal(dateStr, timeStr) {
  const d = (dateStr || '').replace(/-/g, '');
  const t = (timeStr || '00:00').replace(':', '') + '00';
  return d + 'T' + t;
}

// Aktuelle UTC-Zeit im ICS-Format "20260530T180000Z"
function icsNowUtc() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

const STATUS_LABEL = {
  pending: 'angefragt', approved: 'bestätigt', rejected: 'abgelehnt', cancelled: 'storniert'
};
const ICS_STATUS = {
  pending: 'TENTATIVE', approved: 'CONFIRMED', rejected: 'CANCELLED', cancelled: 'CANCELLED'
};

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff'
  };

  const token = (event.queryStringParameters || {}).token || '';
  if (!token || token.length < 24) {
    return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'Token fehlt oder ungültig.' };
  }

  try {
    initFirebase();
    const db = admin.database();

    // Token → UID auflösen. Wir suchen über alle users/{uid}/icalToken Einträge.
    // Bei kleiner User-Zahl ok; bei wachsendem Verein später indexieren.
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val() || {};
    let matchedUid = null;
    let matchedName = '';
    Object.entries(users).forEach(([uid, u]) => {
      if (u && u.icalToken === token) { matchedUid = uid; matchedName = u.icalName || ''; }
    });
    if (!matchedUid) {
      return { statusCode: 403, headers: { 'Content-Type': 'text/plain' }, body: 'Token unbekannt oder widerrufen.' };
    }

    // Eigene Buchungen + Kontaktdaten lesen (Admin SDK umgeht die DB-Rules)
    const [bookingsSnap, contactsSnap] = await Promise.all([
      db.ref('bookings').orderByChild('uid').equalTo(matchedUid).once('value'),
      db.ref('bookingContacts').orderByChild('uid').equalTo(matchedUid).once('value')
    ]);
    const bookings = bookingsSnap.val() || {};
    const contacts = contactsSnap.val() || {};

    const dtstamp = icsNowUtc();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DASSU Buchungskalender//Mein Kalender//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape('DASSU Buchungen' + (matchedName ? ' · ' + matchedName : '')),
      'X-WR-TIMEZONE:Europe/Berlin',
      'X-PUBLISHED-TTL:PT1H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
    ];

    Object.entries(bookings).forEach(([id, b]) => {
      if (!b || !b.date || !b.startTime || !b.endTime) return;
      const c = contacts[id] || {};
      const aircraft = b.aircraft || '';
      const status = b.status || 'pending';
      const statusLabel = STATUS_LABEL[status] || status;
      const icsStatus = ICS_STATUS[status] || 'TENTATIVE';
      const instr = (b.instructor === 'ja' || b.instructorName) ? (b.instructorName || 'benötigt') : '';

      const summary = `${aircraft}${status === 'pending' ? ' (angefragt)' : ''}`;
      const descLines = [
        'Status: ' + statusLabel,
        instr ? 'Fluglehrer: ' + instr : '',
        c.comment ? 'Notiz: ' + c.comment : ''
      ].filter(Boolean).join('\n');

      lines.push('BEGIN:VEVENT');
      lines.push('UID:booking-' + id + '@dassu-buchungskalender.netlify.app');
      lines.push('DTSTAMP:' + dtstamp);
      lines.push('DTSTART;TZID=Europe/Berlin:' + icsLocal(b.date, b.startTime));
      lines.push('DTEND;TZID=Europe/Berlin:' + icsLocal(b.date, b.endTime));
      lines.push('SUMMARY:' + icsEscape(summary));
      if (descLines) lines.push('DESCRIPTION:' + icsEscape(descLines));
      lines.push('LOCATION:' + icsEscape('Unterwössen'));
      lines.push('STATUS:' + icsStatus);
      lines.push('TRANSP:OPAQUE');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    // CRLF + Line-Folding (RFC 5545)
    const body = lines.map(fold).join('\r\n') + '\r\n';
    return { statusCode: 200, headers, body };
  } catch (err) {
    console.error('[ical-feed] Fehler:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Interner Fehler' };
  }
};
