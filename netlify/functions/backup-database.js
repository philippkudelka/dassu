// Netlify Scheduled Function: Tägliches Backup der Firebase Realtime Database.
//
// Exportiert die KOMPLETTE Datenbank als JSON und verschickt sie als E-Mail-Anhang.
// So liegt die Sicherung außerhalb von Firebase und überlebt auch einen
// versehentlichen Komplett-Verlust der Datenbank.
//
// Zeitplan: in netlify.toml konfiguriert ([functions."backup-database"] schedule).
//
// Erfordert (bereits vorhandene Env-Vars):
//   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL, BREVO_SMTP_USER, BREVO_SMTP_PASS
// Optional:
//   BACKUP_EMAIL  – Empfängeradresse (Default: philipp.kudelka@dassu.de)
//   BACKUP_SECRET – wenn gesetzt, kann das Backup zusätzlich manuell per
//                   HTTP ausgelöst werden:  .../backup-database?key=<BACKUP_SECRET>

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
  // Der Zeitplan-Trigger von Netlify hat kein httpMethod-Feld.
  // Manuelle HTTP-Aufrufe sind nur mit korrektem BACKUP_SECRET erlaubt.
  const isScheduled = !event || !event.httpMethod;
  if (!isScheduled) {
    const key = (event.queryStringParameters || {}).key || '';
    if (!process.env.BACKUP_SECRET || key !== process.env.BACKUP_SECRET) {
      return { statusCode: 403, body: 'Forbidden' };
    }
  }

  try {
    initFirebase();

    // Komplette Datenbank lesen
    const snap = await admin.database().ref().once('value');
    const data = snap.val() || {};
    const json = JSON.stringify(data, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sizeKb = Math.round(Buffer.byteLength(json, 'utf8') / 1024);

    const to = process.env.BACKUP_EMAIL || 'philipp.kudelka@dassu.de';

    await getTransporter().sendMail({
      from: '"DASSU Buchungskalender" <info@dassu.de>',
      to: to,
      subject: `DASSU Datenbank-Backup ${dateStr}`,
      text:
        `Automatisches Backup der DASSU-Datenbank vom ${dateStr}.\n\n` +
        `Größe: ${sizeKb} KB\n\n` +
        `Wiederherstellung im Notfall:\n` +
        `Firebase Console → Realtime Database → Daten → 3-Punkte-Menü → ` +
        `"JSON importieren" → die angehängte Datei wählen.\n\n` +
        `Hinweis: Diese E-Mail enthält personenbezogene Daten — bitte sicher ` +
        `aufbewahren und nicht weiterleiten.`,
      attachments: [
        { filename: `dassu-backup-${dateStr}.json`, content: json }
      ]
    });

    console.log(`Backup gesendet (${sizeKb} KB) an ${to}`);
    return { statusCode: 200, body: `Backup gesendet (${sizeKb} KB) an ${to}` };
  } catch (err) {
    console.error('backup-database error:', err);
    return { statusCode: 500, body: 'Backup fehlgeschlagen: ' + err.message };
  }
};
