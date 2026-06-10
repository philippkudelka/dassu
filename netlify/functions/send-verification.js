// Netlify Function: Generiert Firebase Email-Verifikationslink
// und sendet eine gebrandete HTML-Mail über Brevo SMTP
//
// POST body: { email: "...", name: "..." }
// Header: Authorization: Bearer <firebaseIdToken>
// Erfordert Umgebungsvariablen:
//   FIREBASE_SERVICE_ACCOUNT  - JSON des Service Accounts
//   FIREBASE_DATABASE_URL     - Firebase DB URL
//   BREVO_SMTP_USER           - z.B. a8f6ee001@smtp-brevo.com
//   BREVO_SMTP_PASS           - SMTP-Passwort

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const ALLOWED_ORIGIN = 'https://dassu-buchungskalender.netlify.app';

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

function buildEmail(name, verifyLink) {
  const firstName = (name || 'dort').split(' ')[0];
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#1e4b4e 0%,#2d7a73 100%);padding:28px 32px;text-align:center;">
          <img src="https://images.squarespace-cdn.com/content/v1/5a6084aad0e628eab9591587/66b4214a-b88b-427c-8350-c5907ffdcda4/DASSU-Logo+2022+web+768x768+2.png?format=100w" alt="DASSU" width="56" height="56" style="border-radius:10px;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">DASSU Buchungskalender</div>
          <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Deutsche Alpensegelflugschule Unterwössen</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#1e4b4e;font-size:18px;font-weight:600;">Hallo ${firstName}!</h2>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            Vielen Dank für deine Registrierung beim DASSU Buchungskalender.
            Bitte bestätige deine E-Mail-Adresse, damit wir dein Konto aktivieren können.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td align="center">
              <a href="${verifyLink}" target="_blank" style="display:inline-block;background:#1e4b4e;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.3px;">
                E-Mail bestätigen
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
            Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
          </p>
          <p style="margin:0 0 24px;word-break:break-all;color:#2d7a73;font-size:12px;line-height:1.5;">
            ${verifyLink}
          </p>
          <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
              Falls du dich nicht beim DASSU Buchungskalender registriert hast, kannst du diese E-Mail ignorieren.
            </p>
          </div>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">
            DASSU – Deutsche Alpensegelflugschule Unterwössen e.V.<br>
            <a href="https://www.dassu.de" style="color:#2d7a73;text-decoration:none;">www.dassu.de</a> ·
            <a href="mailto:info@dassu.de" style="color:#2d7a73;text-decoration:none;">info@dassu.de</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

exports.handler = async function(event) {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    initFirebase();

    // Auth: nur der Account-Owner darf seine eigene Verifikations-Mail anfordern
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Kein Auth-Token' }) };

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (_) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ungültiger Token' }) };
    }

    const { email, name } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'email fehlt' }) };

    // Token-Email muss zur angefragten Email passen (User darf nur eigene Mail neu senden lassen)
    if ((decoded.email || '').toLowerCase() !== String(email).toLowerCase()) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Nicht autorisiert für diese E-Mail' }) };
    }

    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.error('[send-verification] BREVO_SMTP_USER/PASS env vars fehlen');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'BREVO SMTP nicht konfiguriert' }) };
    }

    // Verifikationslink generieren.
    //
    // Hintergrund: E-Mail-Sicherheits-Scanner (Microsoft 365 SafeLinks, Mimecast,
    // Proofpoint etc.) öffnen Links automatisch zur Phishing-Prüfung. Wenn diese
    // Scanner die Firebase-Default-Page (firebaseapp.com/__/auth/action) öffnen,
    // konsumieren sie den oobCode sofort — der User sieht dann beim eigenen Klick
    // "Link bereits verwendet".
    //
    // Lösung: Firebase Admin SDK gibt eine URL zurück, die immer auf firebaseapp.com
    // zeigt (auch mit handleCodeInApp: true — das ist nur für Mobile Apps mit
    // Dynamic Links anders). Wir parsen den oobCode aus der URL und bauen einen
    // Link auf unsere eigene verify-email.html. Diese Custom-Page zeigt einen
    // Button "E-Mail jetzt bestätigen" und ruft applyActionCode() erst beim
    // ECHTEN User-Klick auf. Scanner laden die Page, klicken den Button aber
    // nicht → Code überlebt bis zum Nutzer.
    let verifyLink;
    try {
      const rawLink = await admin.auth().generateEmailVerificationLink(email, {
        url: 'https://dassu-buchungskalender.netlify.app/',
        handleCodeInApp: false
      });
      // rawLink-Format:
      //   https://buchungskalender-ffe4c.firebaseapp.com/__/auth/action?
      //     mode=verifyEmail&oobCode=XXX&apiKey=YYY&continueUrl=...&lang=de
      // Wir extrahieren oobCode (allein das ist für applyActionCode() nötig)
      // und bauen unsere eigene URL.
      const parsed = new URL(rawLink);
      const oobCode = parsed.searchParams.get('oobCode');
      if (!oobCode) {
        console.error('[send-verification] Konnte oobCode aus rawLink nicht extrahieren:', rawLink);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Konnte Verifikationscode nicht extrahieren' }) };
      }
      verifyLink = 'https://dassu-buchungskalender.netlify.app/verify-email.html'
        + '?mode=verifyEmail'
        + '&oobCode=' + encodeURIComponent(oobCode);
    } catch (linkErr) {
      console.error('[send-verification] generateEmailVerificationLink fehlgeschlagen:', linkErr);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Verify-Link-Generierung fehlgeschlagen: ' + linkErr.message }) };
    }

    // E-Mail über Brevo senden
    try {
      const result = await getTransporter().sendMail({
        from: '"DASSU Buchungskalender" <info@dassu.de>',
        to: email,
        subject: 'Bestätige deine E-Mail-Adresse – DASSU Buchungskalender',
        html: buildEmail(name, verifyLink)
      });
      console.log('[send-verification] Mail gesendet an', email, '· messageId:', result && result.messageId);
    } catch (mailErr) {
      console.error('[send-verification] Brevo SMTP Fehler:', mailErr);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'SMTP-Versand fehlgeschlagen: ' + (mailErr.code || '') + ' ' + mailErr.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[send-verification] unerwarteter Fehler:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Interner Fehler: ' + err.message }) };
  }
};
