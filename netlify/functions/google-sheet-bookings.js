/**
 * Netlify Function: Google Sheet Booking Proxy
 *
 * Liest und schreibt Buchungsdaten ueber den Google Apps Script Endpoint.
 *
 * Lese-Anfrage (action fehlt oder 'read'):
 *   { date: "YYYY-MM-DD" }
 *
 * Schreib-Anfrage (action: 'write' oder 'delete'):
 *   { action: "write", date, aircraft, startTime, endTime, name, status }
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

  const action = body.action || 'read';

  try {
    if (action === 'read') {
      // Lese-Anfrage: GET an Apps Script
      const { date } = body;
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'date required' }) };

      const url = `${SCRIPT_URL}?date=${encodeURIComponent(date)}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`Apps Script error: ${res.status}`);

      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };

    } else if (action === 'write' || action === 'delete') {
      // Schreib-Anfrage: POST an Apps Script
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Apps Script error: ${res.status}`);

      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
