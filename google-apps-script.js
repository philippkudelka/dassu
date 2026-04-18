/**
 * Google Apps Script — im Spreadsheet "Buch Mose" einfügen.
 *
 * Einrichtung:
 * 1. Im Google Sheet: Erweiterungen > Apps Script
 * 2. Den gesamten Inhalt von Code.gs durch diesen Code ersetzen
 * 3. Bereitstellen > Neue Bereitstellung > Web-App
 *    - "Ausführen als": Ich
 *    - "Zugriff": Jeder
 * 4. URL kopieren und als GSHEET_SCRIPT_URL in Netlify eintragen
 */

function doGet(e) {
  try {
    var date = e.parameter.date; // "YYYY-MM-DD"
    if (!date) {
      return jsonResponse({ error: 'date parameter required' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tabelle1');
    if (!sheet) {
      return jsonResponse({ error: 'Sheet "Tabelle1" not found' });
    }

    // Find the column for the given date by searching row 2
    var lastCol = sheet.getLastColumn();
    var row2 = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    var startCol = -1;

    for (var i = 0; i < row2.length; i++) {
      var cell = row2[i];
      if (cell instanceof Date) {
        var y = cell.getFullYear();
        var m = String(cell.getMonth() + 1).padStart(2, '0');
        var d = String(cell.getDate()).padStart(2, '0');
        if (y + '-' + m + '-' + d === date) {
          startCol = i + 1; // 1-based
          break;
        }
      }
    }

    if (startCol < 0) {
      return jsonResponse({ ok: true, date: date, bookings: [], msg: 'date not in sheet' });
    }

    // Each day block: 7 columns (time + 6 aircraft/theorie)
    var numCols = 7;
    var numRows = 22; // rows 4-25 (covers 8:00-18:30)

    // Aircraft headers from row 3
    var headerRange = sheet.getRange(3, startCol, 1, numCols);
    var headers = headerRange.getValues()[0];
    var aircraft = [];
    for (var h = 1; h < numCols; h++) {
      aircraft.push(headers[h] ? String(headers[h]).trim() : '');
    }

    // Booking data: values + background colors
    var dataRange = sheet.getRange(4, startCol, numRows, numCols);
    var values = dataRange.getValues();
    var backgrounds = dataRange.getBackgrounds();

    // Parse time strings from column 0
    var times = [];
    for (var r = 0; r < numRows; r++) {
      var t = values[r][0];
      if (t instanceof Date) {
        times.push(pad2(t.getHours()) + ':' + pad2(t.getMinutes()));
      } else if (t) {
        var ts = String(t).trim();
        times.push(ts.length === 4 ? '0' + ts : ts);
      } else {
        times.push('');
      }
    }

    // Build bookings per aircraft column
    var bookings = [];
    for (var col = 1; col < numCols; col++) {
      var ac = aircraft[col - 1];
      if (!ac) continue;

      var currentName = '';
      var currentStart = '';

      for (var row = 0; row < numRows; row++) {
        var cellValue = values[row][col] ? String(values[row][col]).trim() : '';
        var cellBg = (backgrounds[row][col] || '#ffffff').toLowerCase();
        var isColored = cellBg !== '#ffffff' && cellBg !== 'white';
        var time = times[row];

        if (cellValue) {
          // Close previous booking if any
          if (currentName && currentStart) {
            bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time });
          }
          // Start new booking
          currentName = cellValue;
          currentStart = time;
        } else if (isColored && currentName) {
          // Colored empty cell = continuation of current booking
        } else {
          // Truly empty = end current booking
          if (currentName && currentStart) {
            bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time });
            currentName = '';
            currentStart = '';
          }
        }
      }

      // Close booking at end of day
      if (currentName && currentStart) {
        var lastIdx = numRows - 1;
        var endTime = times[lastIdx] || '18:00';
        // Add 30 min to last slot
        var parts = endTime.split(':');
        var mins = parseInt(parts[0]) * 60 + parseInt(parts[1]) + 30;
        endTime = pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
        bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: endTime });
      }
    }

    return jsonResponse({ ok: true, date: date, bookings: bookings });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
