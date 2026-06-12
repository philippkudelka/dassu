// Netlify Function: Versendet die transaktionalen Buchungs-Mails über Brevo SMTP.
//
// Ersetzt den bisherigen clientseitigen EmailJS-Versand (Free-Tier nur 200 Mails/
// Monat → bei ~800 Vereinsmitgliedern zu klein, Mails schlugen still fehl).
//
// Die HTML-Templates werden weiterhin im Frontend gebaut (dort wird User-Input
// bereits mit escapeHtml() escaped). Diese Function ist ein dünnes, abgesichertes
// Relay: sie nimmt fertiges HTML entgegen und verschickt es. Das hält den Diff
// klein und das Mail-Design 1:1 erhalten.
//
// POST body: { to, subject, html, replyTo? }
// Header:    Authorization: Bearer <firebaseIdToken>
//
// Erfordert Umgebungsvariablen (identisch zu send-verification.js):
//   FIREBASE_SERVICE_ACCOUNT  - JSON des Service Accounts
//   FIREBASE_DATABASE_URL     - Firebase DB URL (für den staffUsers-Check)
//   BREVO_SMTP_USER           - z.B. a8f6ee001@smtp-brevo.com
//   BREVO_SMTP_PASS           - SMTP-Passwort
//
// SICHERHEIT — Missbrauch als Spam-Relay verhindern:
//   1. Gültiger Firebase-ID-Token Pflicht (nur registrierte, verifizierte User).
//   2. Empfänger-Beschränkung für Nicht-Staff: ein normaler Kunde darf NUR an
//      seine eigene (Token-)Adresse oder an info@dassu.de senden. Staff (Eintrag
//      in /staffUsers) dürfen an beliebige Empfänger senden (Status-/Storno-/
//      Schnellbuchungs-/Einladungs-Mails an Kunden & neue Mitglieder).
//   3. Genau EIN Empfänger pro Aufruf (kein Komma/CRLF → keine Fan-out-/Header-
//      Injection).

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const ALLOWED_ORIGIN = 'https://dassu-buchungskalender.netlify.app';
const OFFICE_EMAIL = 'info@dassu.de';
// Konservative, header-sichere E-Mail-Validierung (ein Empfänger, kein Whitespace).
const EMAIL_RE = /^[^\s@",;<>]+@[^\s@",;<>]+\.[^\s@",;<>]+$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

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

// Modul-scoped, damit TCP/TLS-Verbindung über Cold-Starts wiederverwendet wird
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    pool: true,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS
    }
  });
  return _transporter;
}

exports.handler = async function(event) {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    initFirebase();

    // --- Auth: gültiger Firebase-Token Pflicht ---
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Kein Auth-Token' }) };

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (_) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ungültiger Token' }) };
    }

    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.error('[send-booking-mail] BREVO_SMTP_USER/PASS env vars fehlen');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'BREVO SMTP nicht konfiguriert' }) };
    }

    // --- Body validieren ---
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiger JSON-Body' }) }; }

    const to = String(payload.to || '').trim();
    const subjectRaw = String(payload.subject || '').trim();
    const html = typeof payload.html === 'string' ? payload.html : '';
    let replyTo = payload.replyTo ? String(payload.replyTo).trim() : '';

    if (!EMAIL_RE.test(to)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültige Empfänger-Adresse' }) };
    }
    if (!subjectRaw) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Betreff fehlt' }) };
    }
    if (!html || html.length < 20) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'HTML-Inhalt fehlt' }) };
    }
    if (html.length > 200000) {
      return { statusCode: 413, headers, body: JSON.stringify({ error: 'HTML-Inhalt zu groß' }) };
    }
    // Header-Injection im Betreff ausschließen (CR/LF entfernen, Länge begrenzen).
    const subject = subjectRaw.replace(/[\r\n]+/g, ' ').slice(0, 200);
    // Reply-To nur übernehmen, wenn syntaktisch valide — sonst fällt die Antwort
    // ohnehin auf den From-Absender (info@dassu.de) zurück.
    if (replyTo && !EMAIL_RE.test(replyTo)) replyTo = '';

    // --- Empfänger-Beschränkung für Nicht-Staff ---
    const uid = decoded.uid;
    let isStaff = false;
    try {
      const snap = await admin.database().ref('staffUsers/' + uid).once('value');
      isStaff = snap.exists();
    } catch (e) {
      console.error('[send-booking-mail] staffUsers-Check fehlgeschlagen:', e);
      // Im Zweifel restriktiv behandeln (isStaff bleibt false).
    }

    if (!isStaff) {
      const ownEmail = (decoded.email || '').toLowerCase();
      const target = to.toLowerCase();
      if (target !== ownEmail && target !== OFFICE_EMAIL) {
        console.warn('[send-booking-mail] Nicht-Staff', uid, 'wollte an Fremdadresse senden:', target);
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Nicht autorisiert für diesen Empfänger' }) };
      }
    }

    // --- Versand über Brevo ---
    const mail = {
      from: '"DASSU Buchungskalender" <info@dassu.de>',
      to,
      subject,
      html
    };
    if (replyTo) mail.replyTo = replyTo;

    try {
      const result = await getTransporter().sendMail(mail);
      console.log('[send-booking-mail] Mail gesendet an', to, '· messageId:', result && result.messageId);
    } catch (mailErr) {
      console.error('[send-booking-mail] Brevo SMTP Fehler:', mailErr);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'SMTP-Versand fehlgeschlagen: ' + (mailErr.code || '') + ' ' + mailErr.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[send-booking-mail] unerwarteter Fehler:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Interner Fehler: ' + err.message }) };
  }
};
