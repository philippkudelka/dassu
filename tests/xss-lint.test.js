// Tests für den XSS-Regressions-Linter (scripts/xss-lint.js).
// Stellt sicher, dass der Check echte Lücken FINDET (sonst wäre er wertlos)
// und sichere Muster NICHT fälschlich flaggt (sonst würde er ignoriert).
import { describe, it, expect } from 'vitest';
import { scanLine } from '../scripts/xss-lint.js';

describe('xss-lint – findet echte Lücken', () => {
  it('flaggt ungeschützten Namen im HTML-Template', () => {
    expect(scanLine('html += `<div>${booking.name}</div>`;').length).toBe(1);
  });
  it('flaggt ungeschützten Kommentar im td', () => {
    expect(scanLine('  `<td>${b.comment}</td>`').length).toBe(1);
  });
  it('flaggt ungeschützte E-Mail im Attribut', () => {
    expect(scanLine('`<a title="${c.email}">x</a>`').length).toBe(1);
  });
  it('flaggt ungeschützten Fluglehrernamen', () => {
    expect(scanLine('el.innerHTML = `<span>${booking.instructorName}</span>`').length).toBe(1);
  });
});

describe('xss-lint – ignoriert sichere Muster', () => {
  it('escapeHtml() ist sicher', () => {
    expect(scanLine('html += `<div>${escapeHtml(booking.name)}</div>`;').length).toBe(0);
  });
  it('escapeAttr() ist sicher', () => {
    expect(scanLine('`<input value="${escapeAttr(c.email)}">`').length).toBe(0);
  });
  it('jsArg() ist sicher', () => {
    expect(scanLine("`<button onclick=\"x('${jsArg(b.name)}')\">`").length).toBe(0);
  });
  it('bereits-escaped Variable (safeName) ist sicher', () => {
    expect(scanLine('`<div>${safeName}</div>`').length).toBe(0);
  });
  it('Avatar-Initiale (.charAt(0)) ist sicher', () => {
    expect(scanLine('`<div class="avatar">${(u.name || "?").charAt(0).toUpperCase()}</div>`').length).toBe(0);
  });
  it('reiner Ternary-Test gibt das Feld nicht aus', () => {
    expect(scanLine("`<td style=\"${b.comment ? 'border:1px' : ''}\">x</td>`").length).toBe(0);
  });
  it('Nicht-HTML-Kontext (notify-Text) wird ignoriert', () => {
    expect(scanLine('notify(`${b.name} bestätigt.`, "success");').length).toBe(0);
  });
  it('Nicht-HTML-Kontext (logActivity) wird ignoriert', () => {
    expect(scanLine('logActivity("edit", `Buchung: ${b.name}`, id);').length).toBe(0);
  });
  it('Freigabe-Kommentar xss-lint-ok wird respektiert', () => {
    expect(scanLine('`<div>${booking.name}</div>` // xss-lint-ok: bereits gefiltert').length).toBe(0);
  });
});
