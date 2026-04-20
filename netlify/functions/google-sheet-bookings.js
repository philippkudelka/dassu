/**
 * Netlify Function: Google Sheet Booking Proxy
 *
 * LESEN: Laedt die xlsx-Datei direkt von Google Drive (via Apps Script)
 *        und parst sie mit ExcelJS — so bleiben alle Hintergrundfarben erhalten.
 *
 * SCHREIBEN: Leitet write/delete-Anfragen an den Apps Script Endpoint weiter.
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

const ExcelJS = require('exceljs');

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
      // ========= NEUER MODUS: xlsx direkt mit ExcelJS parsen =========
      const { date } = body;
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'date required' }) };

      const debug = body.debug === '1' || body.debug === 1;

      // 1. xlsx von Apps Script herunterladen (als Base64)
      const downloadUrl = `${SCRIPT_URL}?action=download`;
      const dlRes = await fetch(downloadUrl, { redirect: 'follow' });
      if (!dlRes.ok) throw new Error(`Apps Script download error: ${dlRes.status}`);

      const dlData = await dlRes.json();
      if (!dlData.ok) throw new Error(dlData.error || 'Download failed');

      // 2. Base64 → Buffer → ExcelJS Workbook
      const buffer = Buffer.from(dlData.base64, 'base64');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.getWorksheet('Tabelle1') || workbook.worksheets[0];
      if (!worksheet) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date, bookings: [], msg: 'no worksheet found' }) };
      }

      // 3. Datum in Zeile 2 suchen
      const row2 = worksheet.getRow(2);
      const lastCol = worksheet.columnCount;

      const dateParts = date.split('-');
      // "DD.MM.YYYY"
      const targetShort = dateParts[2] + '.' + dateParts[1] + '.' + dateParts[0];
      // "19. April 2026" (Teil von "Sonntag, 19. April 2026")
      const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
      const targetLong = parseInt(dateParts[2], 10) + '. ' + monthNames[parseInt(dateParts[1], 10) - 1] + ' ' + dateParts[0];

      let startCol = -1;
      for (let i = 1; i <= lastCol; i++) {
        const cell = row2.getCell(i);
        const cellText = String(cell.value || '').trim();
        if (!cellText) continue;

        if (cellText === targetShort) { startCol = i; break; }
        if (cellText.indexOf(targetLong) >= 0) { startCol = i; break; }
        if (cellText === date) { startCol = i; break; }
      }

      if (startCol < 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date, bookings: [], msg: 'date not in sheet' }) };
      }

      // 4. Tagesblock-Breite bestimmen (bis zum naechsten Datum in Zeile 2)
      let numCols = 0;
      for (let nc = startCol + 1; nc <= lastCol; nc++) {
        const val = String(row2.getCell(nc).value || '').trim();
        if (val) {
          numCols = nc - startCol;
          break;
        }
      }
      if (numCols === 0) numCols = Math.min(lastCol - startCol + 1, 20);
      if (numCols > 20) numCols = 20;

      // 5. Flugzeug-Header aus Zeile 4
      const row4 = worksheet.getRow(4);
      const aircraft = [];
      for (let h = 1; h < numCols; h++) {
        const val = String(row4.getCell(startCol + h).value || '').trim();
        aircraft.push(val);
      }

      // 6. Zeitslots und Buchungsdaten ab Zeile 5
      const numRows = 22;
      const times = [];
      for (let r = 0; r < numRows; r++) {
        const row = worksheet.getRow(5 + r);
        const tv = String(row.getCell(startCol).value || '').trim();
        if (/^\d{1,2}:\d{2}$/.test(tv)) {
          times.push(tv.length <= 4 ? '0' + tv : tv);
        } else {
          times.push('');
        }
      }

      // Letzte gueltige Zeit fuer Tagesende
      let lastValidTime = '';
      for (let tv = numRows - 1; tv >= 0; tv--) {
        if (times[tv]) { lastValidTime = times[tv]; break; }
      }
      let dayEndTime = '';
      if (lastValidTime) {
        const ep = lastValidTime.split(':');
        const em = parseInt(ep[0]) * 60 + parseInt(ep[1]) + 30;
        dayEndTime = pad2(Math.floor(em / 60)) + ':' + pad2(em % 60);
      }

      // Debug: Rohdaten zurueckgeben
      if (debug) {
        const sampleValues = [];
        const sampleBgs = [];
        for (let r = 0; r < Math.min(5, numRows); r++) {
          const row = worksheet.getRow(5 + r);
          const vals = [];
          const bgs = [];
          for (let c = 0; c < numCols; c++) {
            const cell = row.getCell(startCol + c);
            vals.push(String(cell.value || ''));
            bgs.push(getCellBgColor(cell));
          }
          sampleValues.push(vals);
          sampleBgs.push(bgs);
        }
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            ok: true, date, startCol, numCols,
            aircraft, times, sampleValues, sampleBgs,
            source: 'exceljs-direct'
          })
        };
      }

      // 7. Buchungen pro Flugzeug-Spalte aufbauen
      const bookings = [];
      for (let col = 1; col < numCols; col++) {
        const ac = aircraft[col - 1];
        if (!ac) continue;

        let currentName = '';
        let currentStart = '';
        let currentColor = '';

        for (let r = 0; r < numRows; r++) {
          const time = times[r];
          if (!time) continue;

          const row = worksheet.getRow(5 + r);
          const cell = row.getCell(startCol + col);
          const cellValue = String(cell.value || '').trim();
          const cellBg = getCellBgColor(cell);
          const isColored = cellBg !== '#ffffff' && cellBg !== '#FFFFFF' && cellBg !== 'none' && cellBg !== '';

          if (cellValue) {
            // Vorherige Buchung abschliessen
            if (currentName && currentStart) {
              bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time, color: currentColor });
            }
            // Neue Buchung starten
            currentName = cellValue;
            currentStart = time;
            currentColor = isColored ? cellBg : '';
          } else if (isColored && currentName && currentColor && cellBg.toLowerCase() === currentColor.toLowerCase()) {
            // Gleiche Farbe = Fortsetzung (nichts tun)
          } else {
            // Leer ohne Farbe = Buchung beenden
            if (currentName && currentStart) {
              bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time, color: currentColor });
              currentName = '';
              currentStart = '';
              currentColor = '';
            }
          }
        }

        // Buchung am Tagesende abschliessen
        if (currentName && currentStart && dayEndTime) {
          bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: dayEndTime, color: currentColor });
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, date, bookings, source: 'exceljs-direct' }) };

    } else if (action === 'write' || action === 'delete') {
      // Schreib-Anfrage: POST an Apps Script (unveraendert)
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

/**
 * Extrahiert die Hintergrundfarbe einer ExcelJS-Zelle als Hex-String.
 * ExcelJS speichert Farben als { argb: 'FFRRGGBB' } oder { theme: N, tint: X }
 */
function getCellBgColor(cell) {
  try {
    const fill = cell.fill;
    if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return 'none';

    const fg = fill.fgColor;
    if (!fg) return 'none';

    // ARGB-Format: "FFRRGGBB" → "#RRGGBB"
    if (fg.argb) {
      const argb = String(fg.argb);
      if (argb.length >= 8) {
        return '#' + argb.substring(2);
      }
      if (argb.length === 6) {
        return '#' + argb;
      }
    }

    // Theme-Farbe (vereinfacht — haeufigste Theme-Farben)
    if (fg.theme !== undefined) {
      // Theme-Farben-Tabelle (Standard Office Theme)
      const themeColors = [
        '#FFFFFF', // 0: Background 1
        '#000000', // 1: Text 1
        '#E7E6E6', // 2: Background 2
        '#44546A', // 3: Text 2
        '#4472C4', // 4: Accent 1
        '#ED7D31', // 5: Accent 2
        '#A5A5A5', // 6: Accent 3
        '#FFC000', // 7: Accent 4
        '#5B9BD5', // 8: Accent 5
        '#70AD47', // 9: Accent 6
      ];
      const baseColor = themeColors[fg.theme] || '#FFFFFF';
      // TODO: tint anwenden fuer genauere Farben
      return baseColor;
    }

    // Indexed-Farbe
    if (fg.indexed !== undefined) {
      return '#indexed_' + fg.indexed;
    }

    return 'none';
  } catch (e) {
    return 'none';
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
