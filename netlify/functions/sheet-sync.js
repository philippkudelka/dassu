/**
 * Netlify Function: Sheet Sync Proxy
 * Leitet Anfragen an die Google Apps Script Web App weiter
 *
 * Environment Variable erforderlich:
 * - SHEET_SYNC_URL: Die Deployment-URL der Apps Script Web App
 *   Format: https://script.google.com/macros/d/{SCRIPT_ID}/usercallable
 */

exports.handler = async (event, context) => {
  try {
    // CORS Headers
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
    }

    // Hole Apps Script URL aus Umgebungsvariable
    const appScriptUrl = process.env.SHEET_SYNC_URL;
    if (!appScriptUrl) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          ok: false,
          error: 'SHEET_SYNC_URL environment variable not set'
        })
      };
    }

    let fetchUrl = appScriptUrl;
    let fetchOptions = {
      method: 'GET',
      redirect: 'follow'
    };

    if (event.httpMethod === 'GET') {
      // Leite Query-Parameter weiter
      const queryString = event.queryStringParameters
        ? '?' + new URLSearchParams(event.queryStringParameters).toString()
        : '';
      fetchUrl = appScriptUrl + queryString;
      // Kein Content-Type Header bei GET — Google mag das nicht

    } else if (event.httpMethod === 'POST') {
      // Leite POST-Body weiter
      fetchOptions.method = 'POST';
      fetchOptions.headers = { 'Content-Type': 'text/plain' };
      fetchOptions.body = event.body || '{}';

    } else {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({
          ok: false,
          error: 'Method not allowed'
        })
      };
    }

    // Rufe Apps Script auf (Google macht 302 Redirects)
    console.log('Calling Apps Script:', fetchUrl, fetchOptions.method);
    const response = await fetch(fetchUrl, fetchOptions);
    const responseText = await response.text();
    console.log('Apps Script response status:', response.status, 'body length:', responseText.length);

    // Parse Response
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      // Wenn JSON-Parsing fehlschlägt, versuche HTML-Fehler zu erkennen
      if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            ok: false,
            error: 'Apps Script returned HTML error page. Check deployment or permissions.'
          })
        };
      }
      throw new Error('Invalid JSON response from Apps Script: ' + responseText);
    }

    return {
      statusCode: response.ok ? 200 : 400,
      headers,
      body: JSON.stringify(responseData)
    };

  } catch (error) {
    console.error('Sheet sync error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ok: false,
        error: error.message || 'Internal server error'
      })
    };
  }
};
