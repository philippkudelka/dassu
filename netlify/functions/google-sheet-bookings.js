/**
 * Netlify Function: Google Sheet Booking Proxy
 *
 * Ruft Buchungsdaten vom Google Apps Script Endpoint ab.
 * Das Apps Script liest Zellwerte UND Hintergrundfarben, um
 * Buchungsdauer korrekt zu erkennen.
 *
 * Umgebungsvariable:
 *   GSHEET_SCRIPT_URL – Web-App URL des Google Apps Scripts
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const SCRIPT_URL = process.env.GSHEET_SCRIPT_URL;
  if (!SCRIPT_URL) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'GSHEET_SCRIPT_URL not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { date } = body; // "YYYY-MM-DD"
  if (!date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'date required' }) };

  try {
    const url = `${SCRIPT_URL}?date=${encodeURIComponent(date)}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Apps Script error: ${res.status}`);

    const data = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
