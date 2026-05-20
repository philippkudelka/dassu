// Netlify Scheduled Function: Tägliche Fehler-Zusammenfassung.
//
// Liest /errorLog, verschickt die Fehler der letzten 24 Stunden per E-Mail
// (nur wenn welche aufgetreten sind) und löscht Einträge älter als 30 Tage.
//
// Zeitplan: in netlify.toml konfiguriert ([functions."error-report"] schedule).
//
// Erfordert (bereits vorhandene Env-Vars):
//   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL, BREVO_SMTP_USER, BREVO_SMTP_PASS
// Optional:
//   ERROR_EMAIL / BACKUP_EMAIL – Empfänger (Default: philipp.kudelka@dassu.de)
//   BACKUP_SECRET – erlaubt manuellen HTTP-Trigger via ?key=<BACKUP_SECRET>

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

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

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    pool: true,
    auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_PASS }
  });
  return _transporter;
}

exports.handler = async (event) => {
  const isScheduled = !event || !event.httpMethod;
  if (!isScheduled) {
    const key = (event.queryStringParameters || {}).key || '';
    if (!process.env.BACKUP_SECRET || key !== process.env.BACKUP_SECRET) {
      return { statusCode: 403, body: 'Forbidden' };
    }
  }

  try {
    initFirebase();
    const ref = admin.database().ref('errorLog');
    const snap = await ref.once('value');
    const data = snap.val() || {};
    const entries = Object.entries(data); // [ [id, entry], ... ]

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const since = now - DAY;
    const RETENTION = 30 * DAY;

    // Fehler der letzten 24 Stunden
    const recent = entries
      .map(function (pair) { return pair[1]; })
      .filter(function (e) { return e && typeof e.ts === 'number' && e.ts >= since; })
      .sort(function (a, b) { return b.ts - a.ts; });

    // Einträge älter als 30 Tage aufräumen
    const toDelete = {};
    entries.forEach(function (pair) {
      const id = pair[0], e = pair[1];
      if (!e || typeof e.ts !== 'number' || (now - e.ts) > RETENTION) {
        toDelete[id] = null;
      }
    });
    if (Object.keys(toDelete).length) {
      await ref.update(toDelete);
    }

    if (recent.length === 0) {
      return { statusCode: 200, body: 'Keine Fehler in den letzten 24h.' };
    }

    const lines = recent.slice(0, 50).map(function (e) {
      const d = new Date(e.ts).toLocaleString('de-DE');
      return '[' + d + ']  ' + (e.page || '?') + '\n' +
             '  ' + e.message + '\n' +
             '  ' + (e.url || '') +
             (e.userEmail ? '\n  Nutzer: ' + e.userEmail : '');
    });

    const body =
      'Fehler-Zusammenfassung – DASSU Buchungskalender\n' +
      'Letzte 24 Stunden: ' + recent.length + ' Fehler\n\n' +
      lines.join('\n\n') +
      (recent.length > 50 ? '\n\n… und ' + (recent.length - 50) + ' weitere.' : '') +
      '\n\nVollständige Details: Firebase Console → Realtime Database → errorLog';

    const to = process.env.ERROR_EMAIL || process.env.BACKUP_EMAIL || 'philipp.kudelka@dassu.de';
    await getTransporter().sendMail({
      from: '"DASSU Buchungskalender" <info@dassu.de>',
      to: to,
      subject: 'DASSU: ' + recent.length + ' Fehler in den letzten 24h',
      text: body
    });

    console.log(recent.length + ' Fehler gemeldet an ' + to);
    return { statusCode: 200, body: recent.length + ' Fehler gemeldet an ' + to };
  } catch (err) {
    console.error('error-report error:', err);
    return { statusCode: 500, body: 'Fehler-Report fehlgeschlagen: ' + err.message };
  }
};
