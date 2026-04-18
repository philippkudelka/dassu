/**
 * Netlify Function: Google Sheet Booking Proxy
 *
 * Liest Buchungsdaten aus dem Google Sheet "Buch Mose" und gibt sie als JSON zurück.
 * Das Sheet muss als "Jeder mit dem Link kann ansehen" geteilt sein.
 *
 * Sheet-Struktur (ab 18.04.2026):
 *   7 Spalten pro Tag: Zeit, D-KYCK, D-KYGL, D-KYSS, D-MYUW, D-MYIH, Theorie
 *   Referenzpunkt: 18.04.2026 = Spaltenindex 1121 (0-basiert)
 */

const SHEET_ID = '1SanxAMschcXgYc-tgtVz-TbTjkLAoeba';
const GID = '1504989523';

// Reference: 2026-04-18 starts at column index 1121 (0-based), 7 cols/day
const REF_YEAR = 2026, REF_MONTH = 3, REF_DAY = 18; // April 18
const REF_COL = 1121;
const COLS_PER_DAY = 7;

function colToLetter(col) {
  let letter = '';
  col++;
  while (col > 0) {
    col--;
    letter = String.fromCharCode(65 + (col % 26)) + letter;
    col = Math.floor(col / 26);
  }
  return letter;
}

function daysDiff(dateStr) {
  const ref = Date.UTC(REF_YEAR, REF_MONTH, REF_DAY);
  const parts = dateStr.split('-').map(Number);
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return Math.round((target - ref) / (1000 * 60 * 60 * 24));
}

// Simple CSV parser handling quoted fields
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); rows.push(current); current = []; field = '';
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        current.push(field); rows.push(current); current = []; field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { date } = body; // "YYYY-MM-DD"
  if (!date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'date required' }) };

  try {
    const diff = daysDiff(date);
    const startCol = REF_COL + diff * COLS_PER_DAY;

    if (startCol < 1 || startCol > 3000) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date, bookings: [], outOfRange: true }) };
    }

    // Range: row 3 (aircraft headers) to row 25 (covers 8:00-18:00 in 30-min steps)
    const startLetter = colToLetter(startCol);
    const endLetter = colToLetter(startCol + COLS_PER_DAY - 1);
    const range = `${startLetter}3:${endLetter}25`;

    const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}&range=${encodeURIComponent(range)}`;
    const res = await fetch(gvizUrl);
    if (!res.ok) throw new Error(`Sheet fetch error: ${res.status} ${res.statusText}`);
    const csv = await res.text();

    const rows = parseCSV(csv);
    if (rows.length < 2) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date, bookings: [] }) };
    }

    // Row 0 = aircraft headers: ["", "D-KYCK", "D-KYGL", ...]
    const aircraftHeaders = rows[0].slice(1).map(s => s.trim());

    // Build bookings
    const bookings = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      let time = (row[0] || '').trim();
      if (!time) continue;
      // Normalize: "8:00" → "08:00"
      if (/^\d:\d\d$/.test(time)) time = '0' + time;

      for (let c = 1; c < row.length && c <= aircraftHeaders.length; c++) {
        const name = (row[c] || '').trim();
        if (name && name !== ' ') {
          bookings.push({
            time,
            aircraft: aircraftHeaders[c - 1],
            name
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, date, bookings })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
