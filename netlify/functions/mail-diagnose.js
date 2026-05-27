/**
 * Netlify Function: Mail-System-Diagnose
 *
 * Admin-only. Prüft alle Schritte der Mail-Pipeline und sendet eine Test-Mail
 * an die Admin-Adresse. Gibt detailliertes Ergebnis zurück, damit man sofort
 * sieht wo es hakt.
 *
 * POST body: {}  (keine Parameter — sendet an eigene Admin-Mail)
 * Header: Authorization: Bearer <firebaseIdToken>
 *
 * Erfordert: FIREBASE_SERVICE_ACCOUNT, BREVO_SMTP_USER, BREVO_SMTP_PASS
 */
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

exports.handler = async function(event) {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  // Ergebnis-Akkumulator — wir sammeln alle Schritte mit Status
  const steps = [];
  const addStep = (name, ok, detail) => steps.push({ name, ok, detail: String(detail || '').slice(0, 400) });

  try {
    // SCHRITT 1: Firebase init + Auth-Check
    try {
      initFirebase();
      addStep('Firebase Admin SDK initialisiert', true, 'Service Account geladen.');
    } catch (e) {
      addStep('Firebase Admin SDK initialisieren', false, e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps }) };
    }

    // SCHRITT 2: Token vom Caller prüfen
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      addStep('Auth-Token vom Aufrufer', false, 'Kein Bearer-Token im Header');
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, steps }) };
    }
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
      addStep('Aufrufer-Token verifiziert', true, `User: ${decoded.email || decoded.uid}`);
    } catch (e) {
      addStep('Aufrufer-Token verifiziert', false, e.message);
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, steps }) };
    }

    // SCHRITT 3: Admin-Rolle prüfen
    const callerSnap = await admin.database().ref('staffUsers/' + decoded.uid).once('value');
    const callerProfile = callerSnap.val();
    if (!callerProfile || callerProfile.role !== 'admin') {
      addStep('Admin-Rolle', false, `Rolle: ${callerProfile ? callerProfile.role : '—'} (nicht admin)`);
      return { statusCode: 403, headers, body: JSON.stringify({ ok: false, steps }) };
    }
    addStep('Admin-Rolle', true, 'admin');

    // SCHRITT 4: Brevo-Env-Vars prüfen
    const user = process.env.BREVO_SMTP_USER;
    const pass = process.env.BREVO_SMTP_PASS;
    if (!user || !pass) {
      addStep('Brevo Env-Vars', false, `BREVO_SMTP_USER: ${user ? 'gesetzt' : 'FEHLT'} · BREVO_SMTP_PASS: ${pass ? 'gesetzt' : 'FEHLT'}`);
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps }) };
    }
    addStep('Brevo Env-Vars vorhanden', true, `User-Login: ${user.replace(/(.{4}).+(@.+)/, '$1***$2')}`);

    // SCHRITT 5: SMTP-Verbindung testen (verify ohne Versand)
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user, pass }
    });
    try {
      await transporter.verify();
      addStep('SMTP-Verbindung Brevo', true, 'smtp-relay.brevo.com:587 erreichbar + Auth OK');
    } catch (e) {
      addStep('SMTP-Verbindung Brevo', false, `${e.code || ''} ${e.message}`);
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps }) };
    }

    // SCHRITT 6: Test-Mail an die Admin-Adresse senden
    const targetEmail = decoded.email || (callerProfile && callerProfile.email);
    if (!targetEmail) {
      addStep('Test-Mail vorbereiten', false, 'Keine E-Mail-Adresse im Admin-Profil gefunden');
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps }) };
    }

    try {
      const info = await transporter.sendMail({
        from: '"DASSU Diagnose" <info@dassu.de>',
        to: targetEmail,
        subject: 'DASSU Mail-Diagnose · ' + new Date().toLocaleString('de-DE'),
        text: `Hallo,\n\ndas ist eine Diagnose-Mail vom DASSU Buchungskalender. Wenn du diese E-Mail empfängst, funktioniert der SMTP-Versand über Brevo korrekt.\n\nZeit: ${new Date().toISOString()}\nEmpfänger: ${targetEmail}\n\n— DASSU System`,
        html: `<p>Hallo,</p><p>das ist eine <strong>Diagnose-Mail</strong> vom DASSU Buchungskalender. Wenn du diese E-Mail empfängst, funktioniert der SMTP-Versand über Brevo korrekt.</p><p>Zeit: ${new Date().toISOString()}<br>Empfänger: ${targetEmail}</p><p>— DASSU System</p>`
      });
      addStep('Test-Mail gesendet', true, `An ${targetEmail} · messageId: ${info.messageId || '?'}`);
    } catch (e) {
      addStep('Test-Mail gesendet', false, `${e.code || ''} ${e.message} ${e.response || ''}`);
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps }) };
    }

    // SCHRITT 7: Firebase-Verifizierungs-Link generieren (testet Firebase-Setup)
    try {
      const link = await admin.auth().generateEmailVerificationLink(targetEmail, {
        url: 'https://dassu-buchungskalender.netlify.app/',
        handleCodeInApp: false
      });
      // Nur die ersten 60 Zeichen zeigen — Link enthält Token
      addStep('Firebase Verify-Link Generierung', true, link.substring(0, 60) + '…');
    } catch (e) {
      addStep('Firebase Verify-Link Generierung', false, `${e.code || ''} ${e.message}`);
      // Nicht abbrechen — Diagnose ist sonst komplett
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, steps, message: `Alle Mail-Pipeline-Checks erfolgreich. Schau in dein Postfach (${targetEmail}) — auch Spam-Ordner.` }) };
  } catch (err) {
    addStep('Unerwarteter Fehler', false, err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, steps, error: err.message }) };
  }
};
