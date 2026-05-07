/**
 * Netlify Serverless Function: Vereinsflieger Abend-Backfill
 *
 * HINWEIS: Der VF Web-Login von einem Server aus funktioniert nicht
 * (VF erkennt Server-Requests als Bot anhand von TLS-Fingerprint/IP).
 *
 * Das OGN-Autolink-Feature wird stattdessen direkt im Browser ausgeführt:
 * - Über VF's eingebaute Autolink-Funktion
 * - Oder per Bookmarklet auf der VF-Flugbuchseite
 *
 * Diese Funktion bleibt als Stub erhalten für zukünftige Erweiterungen.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      data: {
        message: 'Backfill wird jetzt direkt im Browser über VF Autolink ausgeführt. Öffne das VF Flugbuch und nutze die Autolink-Funktion.',
        hint: 'VF Web-Login von Server-Seite ist nicht möglich (Bot-Erkennung). Nutze stattdessen den Bookmarklet oder VF\'s eingebautes Autolink.'
      }
    })
  };
};
