// Tests für die bayerische Feiertags-Berechnung (shared/holidays.js).
import { describe, it, expect } from 'vitest';
import '../shared/holidays.js';

const H = () => globalThis.DASSU_HOLIDAYS;

describe('isHoliday – feste Feiertage', () => {
  it('erkennt Neujahr', () => {
    expect(H().isHoliday('2026-01-01')).toEqual({ name: 'Neujahr' });
  });
  it('erkennt Tag der Arbeit', () => {
    expect(H().isHoliday('2026-05-01')).toEqual({ name: 'Tag der Arbeit' });
  });
  it('erkennt Tag der Deutschen Einheit', () => {
    expect(H().isHoliday('2026-10-03')).toEqual({ name: 'Tag der Deutschen Einheit' });
  });
  it('erkennt 1. Weihnachtstag', () => {
    expect(H().isHoliday('2026-12-25')).toEqual({ name: '1. Weihnachtstag' });
  });
});

describe('isHoliday – bewegliche Feiertage (Osterformel)', () => {
  // Ostersonntag 2026 = 5. April
  it('erkennt Karfreitag 2026', () => {
    expect(H().isHoliday('2026-04-03')).toEqual({ name: 'Karfreitag' });
  });
  it('erkennt Ostermontag 2026', () => {
    expect(H().isHoliday('2026-04-06')).toEqual({ name: 'Ostermontag' });
  });
  it('erkennt Pfingstmontag 2026', () => {
    expect(H().isHoliday('2026-05-25')).toEqual({ name: 'Pfingstmontag' });
  });
  // Ostersonntag 2025 = 20. April
  it('erkennt Ostermontag 2025', () => {
    expect(H().isHoliday('2025-04-21')).toEqual({ name: 'Ostermontag' });
  });
});

describe('isHoliday – Nicht-Feiertage und Sonderfälle', () => {
  it('normaler Werktag ist kein Feiertag', () => {
    expect(H().isHoliday('2026-07-15')).toBe(null);
  });
  it('leere/ungültige Eingabe ergibt null', () => {
    expect(H().isHoliday('')).toBe(null);
    expect(H().isHoliday(null)).toBe(null);
    expect(H().isHoliday('abc')).toBe(null);
  });
  it('akzeptiert auch ein Date-Objekt', () => {
    expect(H().isHoliday(new Date(2026, 0, 1))).toEqual({ name: 'Neujahr' });
  });
});

describe('getHolidays', () => {
  it('liefert eine Map mit allen Feiertagen des Jahres', () => {
    const list = H().getHolidays(2026);
    expect(typeof list).toBe('object');
    // 8 feste + 7 bewegliche Einträge (inkl. Oster-/Pfingstsonntag) = 15
    expect(Object.keys(list).length).toBe(15);
    expect(list['2026-01-06']).toEqual({ name: 'Heilige Drei Könige' });
  });
});
