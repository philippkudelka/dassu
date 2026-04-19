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
 *
 * WICHTIG: Bei Code-Aenderungen muss eine NEUE VERSION erstellt werden:
 *   Bereitstellen > Bereitstellungen verwalten > Bearbeiten (Stift-Icon)
 *   > Version: "Neue Version" auswaehlen > Bereitstellen
 *
 * Sheet-Struktur:
 *   Zeile 2: Datumsangaben (merged, Format "18.04.2026")
 *   Zeile 4: Flugzeug-Header (D-KYGL, D-KYCK, etc.)
 *   Zeilen 5+: Zeitslots (30-Min-Intervalle, 08:00-18:00)
 *   Jeder Tagesblock: 7 Spalten (Zeit + 6 Flugzeuge/Theorie)
 *
 * Buchungserkennung:
 *   - Name in einer Zelle = Buchungsstart
 *   - Farbiger Hintergrund (nicht weiss) in leerer Zelle = Fortsetzung
 *   - Leere Zelle ohne Farbe = Buchungsende
 */

var SHEET_ID = '1VpkL3crn8yXq-fbGtONrLqx4BBiU_7yWPHIokyPIDVc';

function doGet(e) {
  try {
    var date = e.parameter.date; // "YYYY-MM-DD"
    if (!date) {
      return jsonResponse({ error: 'date parameter required' });
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Tabelle1');
    if (!sheet) {
      // Fallback: erstes Sheet verwenden
      sheet = ss.getSheets()[0];
      if (!sheet) {
        return jsonResponse({ error: 'No sheets found' });
      }
    }

    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();

    // Datum in Zeile 2 suchen (getDisplayValues vermeidet Zeitzonen-Probleme)
    var row2Range = sheet.getRange(2, 1, 1, lastCol);
    var row2Vals = row2Range.getDisplayValues()[0];

    var startCol = -1;
    var dateParts = date.split('-');
    // Format 1: "DD.MM.YYYY" (z.B. "19.04.2026")
    var targetShort = dateParts[2] + '.' + dateParts[1] + '.' + dateParts[0];
    // Format 2: Langes deutsches Format "19. April 2026" (Teil von "Sonntag, 19. April 2026")
    var monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    var targetLong = parseInt(dateParts[2], 10) + '. ' + monthNames[parseInt(dateParts[1], 10) - 1] + ' ' + dateParts[0];

    for (var i = 0; i < row2Vals.length; i++) {
      var cellText = String(row2Vals[i]).trim();
      if (!cellText) continue;

      // Match kurzes Format "DD.MM.YYYY"
      if (cellText === targetShort) {
        startCol = i + 1; // 1-based
        break;
      }

      // Match langes deutsches Format "Sonntag, 19. April 2026"
      if (cellText.indexOf(targetLong) >= 0) {
        startCol = i + 1;
        break;
      }

      // Fallback: "YYYY-MM-DD"
      if (cellText === date) {
        startCol = i + 1;
        break;
      }
    }

    if (startCol < 0) {
      return jsonResponse({ ok: true, date: date, bookings: [], msg: 'date not in sheet' });
    }

    // Jeder Tagesblock: 7 Spalten (Zeit + 6 Flugzeuge/Theorie)
    var numCols = 7;
    var numRows = 22; // Zeilen 4-25 (deckt 08:00-18:30 ab)

    // Flugzeug-Header aus Zeile 4 (im deployed code: row 4)
    var headerRange = sheet.getRange(4, startCol, 1, numCols);
    var headers = headerRange.getDisplayValues()[0];
    var aircraft = [];
    for (var h = 1; h < numCols; h++) {
      aircraft.push(headers[h] ? String(headers[h]).trim() : '');
    }

    // Buchungsdaten: Werte + Hintergrundfarben
    var dataRange = sheet.getRange(5, startCol, numRows, numCols);
    var values = dataRange.getDisplayValues();
    var backgrounds = dataRange.getBackgrounds();

    // Zeitstrings aus Spalte 0 parsen
    var times = [];
    for (var r = 0; r < numRows; r++) {
      var t = values[r][0];
      if (t) {
        var ts = String(t).trim();
        // Sicherstellen dass Format HH:MM ist
        if (ts.length === 4 && ts.indexOf(':') === -1) {
          ts = '0' + ts;
        }
        // Nur gueltige Zeitwerte akzeptieren (HH:MM)
        if (/^\d{1,2}:\d{2}$/.test(ts)) {
          times.push(ts);
        } else {
          times.push('');
        }
      } else {
        times.push('');
      }
    }

    // Letzte gueltige Zeit finden fuer Tagesende-Berechnung
    var lastValidTime = '';
    for (var tv = numRows - 1; tv >= 0; tv--) {
      if (times[tv]) { lastValidTime = times[tv]; break; }
    }
    var dayEndTime = '';
    if (lastValidTime) {
      var ep = lastValidTime.split(':');
      var em = parseInt(ep[0]) * 60 + parseInt(ep[1]) + 30;
      dayEndTime = pad2(Math.floor(em / 60)) + ':' + pad2(em % 60);
    }

    // Buchungen pro Flugzeug-Spalte aufbauen
    var bookings = [];
    for (var col = 1; col < numCols; col++) {
      var ac = aircraft[col - 1];
      if (!ac) continue;

      var currentName = '';
      var currentStart = '';
      var currentColor = '';
      var prevTime = '';

      for (var row = 0; row < numRows; row++) {
        var cellValue = values[row][col] ? String(values[row][col]).trim() : '';
        var cellBg = (backgrounds[row][col] || '#ffffff').toLowerCase();
        var isColored = cellBg !== '#ffffff' && cellBg !== 'white';
        var time = times[row];

        // Zeilen ohne gueltige Zeit ueberspringen (z.B. "Bemerkungen:")
        if (!time) continue;

        if (cellValue) {
          // Vorherige Buchung abschliessen falls vorhanden
          if (currentName && currentStart) {
            bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time, color: currentColor });
          }
          // Neue Buchung starten
          currentName = cellValue;
          currentStart = time;
          currentColor = isColored ? cellBg : '';
        } else if (isColored && currentName) {
          // Farbige leere Zelle = Fortsetzung der aktuellen Buchung
        } else {
          // Wirklich leer = aktuelle Buchung beenden
          if (currentName && currentStart) {
            bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: time, color: currentColor });
            currentName = '';
            currentStart = '';
            currentColor = '';
          }
        }
        prevTime = time;
      }

      // Buchung am Tagesende abschliessen
      if (currentName && currentStart && dayEndTime) {
        bookings.push({ aircraft: ac, name: currentName, startTime: currentStart, endTime: dayEndTime, color: currentColor });
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
