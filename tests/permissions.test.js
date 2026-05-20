// Tests für das Rechte-System (shared/permissions.js).
// permissions.js ist eine IIFE, die ihre Funktionen global registriert.
import { describe, it, expect } from 'vitest';
import '../shared/permissions.js';

describe('hasPermission – Rollen-Defaults', () => {
  it('Admin hat immer alle Rechte', () => {
    expect(hasPermission({ role: 'admin' }, [], 'manageUsers')).toBe(true);
    expect(hasPermission({ role: 'admin' }, [], 'deleteBookings')).toBe(true);
    expect(hasPermission({ role: 'admin' }, [], 'viewAllTheory')).toBe(true);
  });

  it('Team darf keine Nutzer verwalten / Buchungen löschen', () => {
    expect(hasPermission({ role: 'team' }, [], 'manageUsers')).toBe(false);
    expect(hasPermission({ role: 'team' }, [], 'deleteBookings')).toBe(false);
  });

  it('Team darf Theorie erfassen', () => {
    expect(hasPermission({ role: 'team' }, [], 'trackTheory')).toBe(true);
  });

  it('Gastfluglehrer darf Theorie erfassen, aber nicht verwalten', () => {
    expect(hasPermission({ role: 'guestGlider' }, [], 'trackTheory')).toBe(true);
    expect(hasPermission({ role: 'guestMotor' }, [], 'trackTheory')).toBe(true);
    expect(hasPermission({ role: 'guestGlider' }, [], 'manageUsers')).toBe(false);
  });

  it('Legacy-Rolle "staff" verhält sich wie "team"', () => {
    expect(hasPermission({ role: 'staff' }, [], 'trackTheory')).toBe(true);
    expect(hasPermission({ role: 'staff' }, [], 'manageUsers')).toBe(false);
  });
});

describe('hasPermission – Sonderfälle', () => {
  it('Kein User → keine Rechte', () => {
    expect(hasPermission(null, [], 'manageUsers')).toBe(false);
    expect(hasPermission(undefined, [], 'trackTheory')).toBe(false);
  });

  it('Unbekannte Rolle → keine Rechte', () => {
    expect(hasPermission({ role: 'irgendwas' }, [], 'manageUsers')).toBe(false);
  });

  it('Explizites Recht überschreibt den Rollen-Default', () => {
    expect(hasPermission({ role: 'team', permissions: { manageUsers: true } }, [], 'manageUsers')).toBe(true);
    expect(hasPermission({ role: 'team', permissions: { trackTheory: false } }, [], 'trackTheory')).toBe(false);
  });

  it('Admin-Override schlägt ein explizit entzogenes Recht', () => {
    expect(hasPermission({ role: 'admin', permissions: { manageUsers: false } }, [], 'manageUsers')).toBe(true);
  });

  it('Rolle wird aus der staffUsers-Liste per id aufgelöst', () => {
    const staffUsers = [{ id: 'u1', role: 'admin' }, { id: 'u2', role: 'team' }];
    expect(hasPermission({ id: 'u1' }, staffUsers, 'manageUsers')).toBe(true);
    expect(hasPermission({ id: 'u2' }, staffUsers, 'manageUsers')).toBe(false);
  });
});

describe('isPermissionExplicit', () => {
  it('erkennt explizit gesetzte Rechte', () => {
    expect(isPermissionExplicit({ permissions: { manageUsers: true } }, 'manageUsers')).toBe(true);
    expect(isPermissionExplicit({ permissions: { manageUsers: false } }, 'manageUsers')).toBe(true);
  });
  it('erkennt nicht gesetzte Rechte als nicht explizit', () => {
    expect(isPermissionExplicit({ role: 'team' }, 'manageUsers')).toBe(false);
    expect(isPermissionExplicit(null, 'manageUsers')).toBe(false);
  });
});
