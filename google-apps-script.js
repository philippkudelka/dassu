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

var SHEET_ID = '1SanxAMschcXgYc-tgtVz-TbTjkLAoeba';

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

    // Dynamisch Tagesblock-Breite bestimmen:
    // Ab startCol in Zeile 2 die naechste nicht-leere Zelle finden = naechster Tag
    var numCols = 0;
    for (var nc = startCol; nc <= lastCol; nc++) {
      if (nc > startCol && row2Vals[nc - 1] && String(row2Vals[nc - 1]).trim() !== '') {
        // Naechstes Datum gefunden
        numCols = nc - startCol;
        break;
      }
    }
    if (numCols === 0) {
      // Kein naechstes Datum gefunden — bis zur letzten Spalte gehen
      numCols = lastCol - startCol + 1;
    }
    // Sicherheitslimit
    if (numCols > 20) numCols = 20;

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
        // Nur gueltige Zeitwerte akzeptieren und auf HH:MM normalisieren
        if (/^\d{1,2}:\d{2}$/.test(ts)) {
          // Einstellige Stunde auf zweistellig auffuellen (8:00 -> 08:00)
          if (ts.indexOf(':') <= 1) ts = '0' + ts;
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

    // Debug-Modus: Rohdaten zurueckgeben
    if (e.parameter.debug === '1') {
      return jsonResponse({
        ok: true, date: date, startCol: startCol, numCols: numCols,
        aircraft: aircraft, times: times,
        sampleValues: values.slice(0, 5).map(function(r) { return r.slice(0, numCols); }),
        sampleBgs: backgrounds.slice(0, 5).map(function(r) { return r.slice(0, numCols); })
      });
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
        } else if (isColored && currentName && currentColor && cellBg === currentColor) {
          // Gleiche Farbe wie Buchung = Fortsetzung (ignoriert Tabellenformatierung wie grau)
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

/**
 * doPost – Buchung ins Sheet schreiben oder loeschen.
 *
 * Erwartet JSON-Body:
 *   action: 'write' | 'delete'
 *   date:      "YYYY-MM-DD"
 *   aircraft:  "D-KYGL"
 *   startTime: "10:00"
 *   endTime:   "12:00"
 *   name:      "Max Mustermann"
 *   status:    "approved" | "pending" | "rejected"
 *
 * Status-Farben:
 *   approved → #00ff00 (gruen)
 *   pending  → #ffff00 (gelb)
 *   rejected → wird geloescht (Zellen geleert)
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || 'write';

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Tabelle1');
    if (!sheet) {
      sheet = ss.getSheets()[0];
      if (!sheet) return jsonResponse({ ok: false, error: 'No sheets found' });
    }

    var date = body.date;
    var aircraft = body.aircraft;
    var startTime = body.startTime;
    var endTime = body.endTime;
    var name = body.name;
    var status = body.status || 'pending';

    if (!date || !aircraft || !startTime || !endTime || !name) {
      return jsonResponse({ ok: false, error: 'Missing required fields: date, aircraft, startTime, endTime, name' });
    }

    // Datum-Spalte finden (gleiche Logik wie doGet)
    var lastCol = sheet.getLastColumn();
    var row2Range = sheet.getRange(2, 1, 1, lastCol);
    var row2Vals = row2Range.getDisplayValues()[0];

    var startCol = -1;
    var dateParts = date.split('-');
    var targetShort = dateParts[2] + '.' + dateParts[1] + '.' + dateParts[0];
    var monthNames = ['Januar','Februar','Maerz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    var targetLong = parseInt(dateParts[2], 10) + '. ' + monthNames[parseInt(dateParts[1], 10) - 1] + ' ' + dateParts[0];

    for (var i = 0; i < row2Vals.length; i++) {
      var cellText = String(row2Vals[i]).trim();
      if (!cellText) continue;
      if (cellText === targetShort) { startCol = i + 1; break; }
      if (cellText.indexOf(targetLong) >= 0) { startCol = i + 1; break; }
      if (cellText === date) { startCol = i + 1; break; }
    }

    if (startCol < 0) {
      return jsonResponse({ ok: false, error: 'Date ' + date + ' not found in sheet' });
    }

    // Dynamisch Tagesblock-Breite bestimmen
    var numCols = 0;
    for (var nc = startCol; nc <= lastCol; nc++) {
      if (nc > startCol && row2Vals[nc - 1] && String(row2Vals[nc - 1]).trim() !== '') {
        numCols = nc - startCol;
        break;
      }
    }
    if (numCols === 0) numCols = lastCol - startCol + 1;
    if (numCols > 20) numCols = 20;

    var headerRange = sheet.getRange(4, startCol, 1, numCols);
    var headers = headerRange.getDisplayValues()[0];
    var acCol = -1;
    for (var h = 1; h < numCols; h++) {
      if (String(headers[h]).trim() === aircraft) {
        acCol = startCol + h; // 1-based absolute Spalte
        break;
      }
    }
    if (acCol < 0) {
      return jsonResponse({ ok: false, error: 'Aircraft ' + aircraft + ' not found for date ' + date });
    }

    // Zeitslots: Zeile 5+ enthält Zeiten in Spalte startCol
    var numRows = 22;
    var timeRange = sheet.getRange(5, startCol, numRows, 1);
    var timeVals = timeRange.getDisplayValues();
    var times = [];
    for (var r = 0; r < numRows; r++) {
      var tv = String(timeVals[r][0]).trim();
      if (/^\d{1,2}:\d{2}$/.test(tv)) {
        if (tv.indexOf(':') <= 1) tv = '0' + tv;
        times.push({ row: 5 + r, time: tv });
      }
    }

    // Start- und End-Zeilen finden
    var startRow = -1;
    var endRow = -1;
    for (var ti = 0; ti < times.length; ti++) {
      if (times[ti].time === startTime) startRow = times[ti].row;
      if (times[ti].time === endTime) endRow = times[ti].row;
    }
    if (startRow < 0) {
      return jsonResponse({ ok: false, error: 'Start time ' + startTime + ' not found in sheet' });
    }
    // endRow kann -1 sein wenn endTime der letzte Slot + 30min ist
    if (endRow < 0) endRow = times[times.length - 1].row + 1;

    // Farbe je nach Status
    var statusColors = {
      'approved': '#00ff00',
      'pending': '#ffff00',
      'rejected': null
    };
    var color = statusColors[status] || statusColors['pending'];

    if (action === 'delete' || status === 'rejected') {
      // Zellen leeren und Farbe entfernen
      var clearCount = endRow - startRow;
      if (clearCount > 0) {
        var clearRange = sheet.getRange(startRow, acCol, clearCount, 1);
        clearRange.clearContent();
        clearRange.setBackground(null);
      }
      return jsonResponse({ ok: true, action: 'deleted', date: date, aircraft: aircraft, startTime: startTime, endTime: endTime });
    }

    // Name in erste Zelle schreiben, Farbe fuer alle Zellen setzen
    var writeCount = endRow - startRow;
    if (writeCount <= 0) {
      return jsonResponse({ ok: false, error: 'Invalid time range' });
    }

    // Erste Zelle: Name + Farbe
    var firstCell = sheet.getRange(startRow, acCol);
    firstCell.setValue(name);
    firstCell.setBackground(color);

    // Folgende Zellen: Leer + gleiche Farbe (Fortsetzungs-Markierung)
    if (writeCount > 1) {
      var restRange = sheet.getRange(startRow + 1, acCol, writeCount - 1, 1);
      restRange.clearContent();
      restRange.setBackground(color);
    }

    return jsonResponse({
      ok: true,
      action: 'written',
      date: date,
      aircraft: aircraft,
      startTime: startTime,
      endTime: endTime,
      name: name,
      status: status,
      color: color
    });

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
