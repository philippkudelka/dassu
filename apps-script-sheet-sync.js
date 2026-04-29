/**
 * Google Apps Script für Buchungskalender <-> Google Sheets Sync
 * Liest und schreibt Buchungen aus/in die Tabelle "Tabelle1"
 *
 * Deploy: Apps Script Editor → Neues Deployment → Web-App
 * Execute as: Philippkudelka (user)
 * Who has access: Anyone
 */

const SHEET_ID = '1-NrJq8-751d4QI-ZT_vl1Hf1PYAzTAOqQdx0G_MajEU';
const XLSX_FILE_ID = '1SanxAMschcXgYc-tgtVz-TbTjkLAoeba'; // .xlsx Datei die alle nutzen
const SHEET_NAME = 'Tabelle1';
const DATE_START = new Date(2026, 3, 28); // 28.04.2026
const DATE_END = new Date(2026, 4, 1);   // 01.06.2026

// Flugzeug-Spalten (Offset von Spalte A)
const AIRCRAFT_OFFSETS = {
  'D-KYCK': 1,
  'D-KYGL': 2,
  'D-KYSS': 3,
  'D-MYUW': 4,
  'D-MYIH': 5,
};

const AIRCRAFT_NAMES = ['D-KYCK', 'D-KYGL', 'D-KYSS', 'D-MYUW', 'D-MYIH'];

// Farben
const COLOR_WITH_INSTRUCTOR = '#FFC000'; // Orange
const COLOR_WITHOUT_INSTRUCTOR = '#92D050'; // Grün

/**
 * Haupteinstiegspunkt für GET-Anfragen
 * Gibt alle Buchungen als JSON zurück
 */
function doGet(e) {
  try {
    const action = e.parameter.action || 'read';

    if (action === 'read') {
      const bookings = readAllBookings();
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        data: bookings
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: 'Unknown action'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Haupteinstiegspunkt für POST-Anfragen
 * Schreibt oder löscht Buchungen
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'write';

    if (action === 'write') {
      writeBooking(payload);
      return ContentService.createTextOutput(JSON.stringify({
        ok: true
      })).setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'delete') {
      deleteBooking(payload);
      return ContentService.createTextOutput(JSON.stringify({
        ok: true
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: 'Unknown action'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Liest alle Buchungen aus dem Blatt
 * Scannt Row 2 nach Daten zwischen START und END
 */
function readAllBookings() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const bookings = [];

  // Hole Range für Row 2 (Datum-Header)
  // Die Datumsangaben sind in Row 2, Spalten beginnen bei Index 1 (A)
  const maxCol = sheet.getLastColumn();
  const headerRange = sheet.getRange(2, 1, 1, maxCol);
  const headerValues = headerRange.getValues()[0];

  // Prozessiere jeden Wochentag-Block
  let colIndex = 0;
  while (colIndex < headerValues.length) {
    const cellValue = headerValues[colIndex];

    // Prüfe ob Zelle ein Datum enthält
    if (cellValue instanceof Date) {
      const dateStr = formatDateGerman(cellValue);

      // Prüfe ob Datum im gewünschten Bereich liegt
      if (cellValue >= DATE_START && cellValue <= DATE_END) {
        // Lese alle 7 Spalten dieses Tages (Time + 5 Flugzeuge + Theorie)
        const dayBookings = readDayBookings(sheet, colIndex, dateStr);
        bookings.push(...dayBookings);
      }

      colIndex += 7; // Springe zu nächstem Tag
    } else {
      colIndex++;
    }
  }

  return bookings;
}

/**
 * Liest Buchungen für einen Tag
 * @param {Sheet} sheet
 * @param {number} startCol - Spalten-Index (0-basiert) des Datums in Row 2
 * @param {string} dateStr - Formatiertes Datum (z.B. "2026-04-28")
 */
function readDayBookings(sheet, startCol, dateStr) {
  const dayBookings = [];

  // Für jedes Flugzeug (Spalten 1-5, Spalte 0 ist Zeit)
  for (let aircraftIndex = 0; aircraftIndex < 5; aircraftIndex++) {
    const aircraftCol = startCol + aircraftIndex + 1; // +1 weil Spalte 0 = Zeit
    const aircraftName = AIRCRAFT_NAMES[aircraftIndex];

    // Lese Daten aus Rows 5-25 (Zeitslots)
    const dataRange = sheet.getRange(5, aircraftCol + 1, 21, 1); // +1 für Google Sheets 1-basiert
    const values = dataRange.getValues();
    const bgColors = dataRange.getBackgrounds();

    // Gruppiere zusammenhängende Buchungen
    let currentBooking = null;

    for (let row = 0; row < values.length; row++) {
      const cellValue = values[row][0];
      const bgColor = bgColors[row][0];
      const timeSlot = row; // 0 = 8:00, 1 = 8:30, 2 = 9:00, etc.

      // Berechne Uhrzeit
      const startHour = 8 + Math.floor(timeSlot / 2);
      const startMinute = (timeSlot % 2) * 30;
      const timeStr = formatTime(startHour, startMinute);

      // Prüfe ob Zelle gefüllt ist (entweder Text oder Farbe)
      const hasContent = cellValue && cellValue.toString().trim() !== '';
      const hasColor = bgColor && bgColor !== '#ffffff' && bgColor !== ''; // Weiß = leer

      if (hasContent || hasColor) {
        // Name und Instruktor-Status
        const name = hasContent ? cellValue.toString().trim() : '';
        const instructor = (bgColor === COLOR_WITH_INSTRUCTOR || bgColor.toLowerCase() === '#ffc000') ? 'ja' : 'nein';
        const color = bgColor;

        // Wenn neue Buchung oder andere Person/Farbe
        if (!currentBooking || currentBooking.name !== name || currentBooking.color !== bgColor) {
          // Speichere alte Buchung wenn existiert
          if (currentBooking) {
            dayBookings.push(currentBooking);
          }

          // Starte neue Buchung
          const initEndHour = 8 + Math.floor((timeSlot + 1) / 2);
          const initEndMinute = ((timeSlot + 1) % 2) * 30;
          currentBooking = {
            date: dateStr,
            aircraft: aircraftName,
            startTime: timeStr,
            endTime: formatTime(initEndHour, initEndMinute),
            name: name,
            instructor: instructor,
            color: normalizeColor(bgColor)
          };
        } else {
          // Erweitere aktuelle Buchung (endTime wird aktualisiert)
          const endHour = 8 + Math.floor((timeSlot + 1) / 2);
          const endMinute = ((timeSlot + 1) % 2) * 30;
          currentBooking.endTime = formatTime(endHour, endMinute);
        }
      } else {
        // Leere Zelle - speichere aktuelle Buchung wenn existiert
        if (currentBooking) {
          dayBookings.push(currentBooking);
          currentBooking = null;
        }
      }
    }

    // Speichere letzte Buchung wenn existiert
    if (currentBooking) {
      dayBookings.push(currentBooking);
    }
  }

  return dayBookings;
}

/**
 * Schreibt eine Buchung in native Sheet, dann sync nach xlsx via Drive API
 * @param {Object} booking - { date, aircraft, startTime, endTime, name, instructor }
 */
function writeBooking(booking) {
  // Schreibe in native Sheet
  writeToSheet(SHEET_ID, booking);
  // Sync native → xlsx via Drive API Export (SpreadsheetApp.openById crasht bei xlsx im Web-App-Kontext)
  syncNativeToXlsx();
}

function writeToSheet(sheetId, booking) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(SHEET_NAME);

  const dateParts = booking.date.split('-');
  const bookingDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));

  const maxCol = sheet.getLastColumn();
  const headerRange = sheet.getRange(2, 1, 1, maxCol);
  const headerValues = headerRange.getValues()[0];

  let dateColIndex = -1;
  for (let i = 0; i < headerValues.length; i++) {
    if (headerValues[i] instanceof Date) {
      if (isSameDay(headerValues[i], bookingDate)) {
        dateColIndex = i;
        break;
      }
    }
  }

  if (dateColIndex === -1) {
    throw new Error('Date not found in sheet: ' + booking.date);
  }

  const aircraftIndex = AIRCRAFT_NAMES.indexOf(booking.aircraft);
  if (aircraftIndex === -1) {
    throw new Error('Aircraft not found: ' + booking.aircraft);
  }

  const dataCol = dateColIndex + aircraftIndex + 2;

  const startRow = calculateRowFromTime(booking.startTime);
  const endRow = calculateRowFromTime(booking.endTime);

  if (startRow === -1 || endRow === -1) {
    throw new Error('Invalid time format');
  }

  // Schreibe Name in erste Zeile (Farben werden manuell im Sheet gesetzt)
  sheet.getRange(startRow, dataCol).setValue(booking.name);
}

/**
 * Löscht eine Buchung aus der Tabelle
 * @param {Object} booking - { date, aircraft, startTime, endTime }
 */
function deleteBooking(booking) {
  // Lösche aus native Sheet
  deleteFromSheet(SHEET_ID, booking);
  // Sync native → xlsx via Drive API Export
  syncNativeToXlsx();
}

function deleteFromSheet(sheetId, booking) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(SHEET_NAME);

  const dateParts = booking.date.split('-');
  const bookingDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));

  const maxCol = sheet.getLastColumn();
  const headerRange = sheet.getRange(2, 1, 1, maxCol);
  const headerValues = headerRange.getValues()[0];

  let dateColIndex = -1;
  for (let i = 0; i < headerValues.length; i++) {
    if (headerValues[i] instanceof Date) {
      if (isSameDay(headerValues[i], bookingDate)) {
        dateColIndex = i;
        break;
      }
    }
  }

  if (dateColIndex === -1) {
    throw new Error('Date not found in sheet: ' + booking.date);
  }

  const aircraftIndex = AIRCRAFT_NAMES.indexOf(booking.aircraft);
  if (aircraftIndex === -1) {
    throw new Error('Aircraft not found: ' + booking.aircraft);
  }

  const dataCol = dateColIndex + aircraftIndex + 2;

  const startRow = calculateRowFromTime(booking.startTime);
  const endRow = calculateRowFromTime(booking.endTime);

  if (startRow === -1 || endRow === -1) {
    throw new Error('Invalid time format');
  }

  // Lösche nur Inhalte, nicht Farben
  const numRows = endRow - startRow + 1;
  const clearRange = sheet.getRange(startRow, dataCol, numRows, 1);
  clearRange.clearContent();
}

/**
 * Hilfsfunktionen
 */

function calculateRowFromTime(timeStr) {
  // Format: "HH:MM"
  const parts = timeStr.split(':');
  if (parts.length !== 2) return -1;

  const hour = parseInt(parts[0]);
  const minute = parseInt(parts[1]);

  if (hour < 8 || hour > 18) return -1;
  if (minute !== 0 && minute !== 30) return -1;

  // Row 5 = 8:00, Row 6 = 8:30, Row 7 = 9:00, etc.
  const slotIndex = (hour - 8) * 2 + (minute / 30);
  return 5 + slotIndex;
}

function formatTime(hour, minute) {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function formatDateGerman(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function normalizeColor(color) {
  // Google Sheets gibt manchmal #rrggbb, manchmal #rrggbbaa
  if (!color) return '';
  return color.substring(0, 7).toUpperCase();
}

function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Exportiert die native Google Sheet als .xlsx und überschreibt die .xlsx-Datei in Drive.
 * So sehen alle, die die .xlsx-Datei nutzen, die aktuellen Buchungen.
 */
function syncNativeToXlsx() {
  try {
    // WICHTIG: ss.getBlob() gibt PDF zurück, NICHT xlsx!
    // Stattdessen Export-URL mit format=xlsx nutzen
    const token = ScriptApp.getOAuthToken();
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=xlsx';

    const xlsxResponse = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    if (xlsxResponse.getResponseCode() !== 200) {
      console.log('xlsx export failed: ' + xlsxResponse.getResponseCode());
      return;
    }

    const xlsxBlob = xlsxResponse.getBlob();
    console.log('xlsx blob size: ' + xlsxBlob.getBytes().length);

    // Force drive scope (nötig für OAuth Token)
    const xlsxFile = DriveApp.getFileById(XLSX_FILE_ID);
    console.log('Target file: ' + xlsxFile.getName());

    // Drive API v3 zum Überschreiben des Datei-Inhalts
    const updateUrl = 'https://www.googleapis.com/upload/drive/v3/files/' + XLSX_FILE_ID + '?uploadType=media';
    const updateResponse = UrlFetchApp.fetch(updateUrl, {
      method: 'patch',
      headers: { 'Authorization': 'Bearer ' + token },
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      payload: xlsxBlob.getBytes(),
      muteHttpExceptions: true
    });

    if (updateResponse.getResponseCode() !== 200) {
      console.log('Drive update failed: ' + updateResponse.getResponseCode() + ' ' + updateResponse.getContentText());
    } else {
      console.log('syncNativeToXlsx OK — ' + xlsxBlob.getBytes().length + ' bytes written');
    }
  } catch (e) {
    console.log('syncNativeToXlsx error: ' + e.toString());
  }
}
