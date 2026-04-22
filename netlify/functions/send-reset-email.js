// Netlify Function: generiert Firebase Password-Reset-Link und sendet eigene E-Mail via Brevo SMTP
// POST body: { email: "user@example.com" }
// Erfordert Umgebungsvariablen:
//   FIREBASE_SERVICE_ACCOUNT  - JSON des Service Accounts
//   BREVO_SMTP_USER           - z.B. a8f6ee001@smtp-brevo.com
//   BREVO_SMTP_PASS           - SMTP-Passwort

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

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

function getTransporter() {
  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS
    }
  });
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'E-Mail fehlt' }) };

    initFirebase();

    // Prüfen ob der User existiert (ohne Fehler nach außen zu leaken)
    let userExists = false;
    try {
      await admin.auth().getUserByEmail(email);
      userExists = true;
    } catch (e) {
      // User existiert nicht — trotzdem 200 zurückgeben (Sicherheit)
      userExists = false;
    }

    if (userExists) {
      // Password-Reset-Link generieren
      const resetLink = await admin.auth().generatePasswordResetLink(email, {
        url: 'https://dassu-buchungskalender.netlify.app',
        handleCodeInApp: false
      });

      // E-Mail senden
      const transporter = getTransporter();
      await transporter.sendMail({
        from: '"DASSU Buchungskalender" <info@dassu.de>',
        to: email,
        subject: 'Passwort für DASSU Buchungskalender zurücksetzen',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h2 style="color: #1a2332; margin: 0; font-size: 22px;">DASSU Buchungskalender</h2>
            </div>
            <p style="color: #333; font-size: 15px; line-height: 1.6;">Hallo,</p>
            <p style="color: #333; font-size: 15px; line-height: 1.6;">
              du hast eine Anfrage zum Zurücksetzen deines Passworts gestellt. Klicke auf den folgenden Button, um ein neues Passwort zu wählen:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}" style="background-color: #1a2332; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">
                Passwort zurücksetzen
              </a>
            </div>
            <p style="color: #666; font-size: 13px; line-height: 1.6;">
              Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>
              <a href="${resetLink}" style="color: #1a73e8; word-break: break-all; font-size: 12px;">${resetLink}</a>
            </p>
            <p style="color: #666; font-size: 13px; line-height: 1.6;">
              Falls du kein neues Passwort angefordert hast, kannst du diese E-Mail ignorieren.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 32px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              Viele Grüße,<br>Dein DASSU-Team
            </p>
          </div>
        `
      });
    }

    // Immer gleiche Antwort (Sicherheit: kein Unterschied ob User existiert)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('send-reset-email error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Interner Fehler' })
    };
  }
};
