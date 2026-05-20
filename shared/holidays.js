/* DASSU – Bayerische Feiertage
 * Berechnet alle offiziellen Feiertage in Bayern für ein gegebenes Jahr.
 * Eingebunden per <script src="shared/holidays.js"> in index.html und staff.html.
 */
(function (global) {
  'use strict';

  // Gauss'sche Osterformel (Anonymous Gregorian)
  function easterSunday(year) {
    var a = year % 19;
    var b = Math.floor(year / 100);
    var c = year % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-based
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }

  function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function fmt(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * Gibt alle bayerischen Feiertage für ein Jahr zurück.
   * @param {number} year
   * @returns {Object} Map: 'YYYY-MM-DD' → { name: string }
   */
  function getBavarianHolidays(year) {
    var easter = easterSunday(year);
    var holidays = {};

    // Feste Feiertage
    holidays[year + '-01-01'] = { name: 'Neujahr' };
    holidays[year + '-01-06'] = { name: 'Heilige Drei Könige' };
    holidays[year + '-05-01'] = { name: 'Tag der Arbeit' };
    holidays[year + '-08-15'] = { name: 'Mariä Himmelfahrt' };
    holidays[year + '-10-03'] = { name: 'Tag der Deutschen Einheit' };
    holidays[year + '-11-01'] = { name: 'Allerheiligen' };
    holidays[year + '-12-25'] = { name: '1. Weihnachtstag' };
    holidays[year + '-12-26'] = { name: '2. Weihnachtstag' };

    // Bewegliche Feiertage (relativ zu Ostern)
    holidays[fmt(addDays(easter, -2))]  = { name: 'Karfreitag' };
    holidays[fmt(easter)]               = { name: 'Ostersonntag' };
    holidays[fmt(addDays(easter, 1))]   = { name: 'Ostermontag' };
    holidays[fmt(addDays(easter, 39))]  = { name: 'Christi Himmelfahrt' };
    holidays[fmt(addDays(easter, 49))]  = { name: 'Pfingstsonntag' };
    holidays[fmt(addDays(easter, 50))]  = { name: 'Pfingstmontag' };
    holidays[fmt(addDays(easter, 60))]  = { name: 'Fronleichnam' };

    return holidays;
  }

  // Cache pro Jahr
  var _cache = {};

  /**
   * Prüft ob ein Datum ein bayerischer Feiertag ist.
   * @param {string} dateStr – 'YYYY-MM-DD'
   * @returns {object|null} – { name } oder null
   */
  function isHoliday(dateStr) {
    if (!dateStr) return null;
    // Date-Objekt → String konvertieren
    if (typeof dateStr !== 'string') {
      if (dateStr instanceof Date) {
        dateStr = dateStr.getFullYear() + '-' + String(dateStr.getMonth() + 1).padStart(2, '0') + '-' + String(dateStr.getDate()).padStart(2, '0');
      } else {
        return null;
      }
    }
    if (dateStr.length < 10) return null;
    var year = parseInt(dateStr.substring(0, 4), 10);
    if (!_cache[year]) _cache[year] = getBavarianHolidays(year);
    return _cache[year][dateStr] || null;
  }

  /**
   * Gibt alle Feiertage für ein Jahr zurück.
   * @param {number} year
   * @returns {Object} Map: 'YYYY-MM-DD' → { name }
   */
  function getHolidays(year) {
    if (!_cache[year]) _cache[year] = getBavarianHolidays(year);
    return _cache[year];
  }

  // Feiertags-Regeln
  var HOLIDAY_MIN_HOUR = 9;          // Früheste Buchungszeit an Feiertagen
  var HOLIDAY_NO_PLATZRUNDE = true;  // Keine Platzrunden an Feiertagen

  global.DASSU_HOLIDAYS = {
    isHoliday: isHoliday,
    getHolidays: getHolidays,
    MIN_HOUR: HOLIDAY_MIN_HOUR,
    NO_PLATZRUNDE: HOLIDAY_NO_PLATZRUNDE
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
