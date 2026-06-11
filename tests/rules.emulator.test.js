// Verhaltenstest der Firebase Realtime Database Rules gegen den Emulator.
//
// Hintergrund (externes Review): Die Rules sind die zentrale Sicherheitsgrenze und
// gehen seit dem Auto-Deploy OHNE manuelles Console-Gate live. Der Workflow
// validiert nur JSON-Syntax — ein valides, aber semantisch falsches Regel-JSON
// (Tippfehler, der einen Knoten öffnet) käme sonst ungeprüft in Produktion.
// Dieser Test prüft die Kern-Invarianten gegen die ECHTE database.rules.json und
// blockiert den Deploy (deploy-rules.yml), wenn eine davon verletzt ist.
//
// Läuft NICHT im normalen `npm test` (braucht den Firebase-Emulator + Java):
//   npm run test:rules         (lokal, mit firebase emulators:exec)
//   In CI: firebase emulators:exec --only database "npm run test:rules"
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { ref, set, get, update } from 'firebase/database';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-dassu',
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  });

  // Grunddaten mit deaktivierten Rules seeden (admin + Bestandsbuchung + Kontakt).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'staffUsers/admin1'), {
      id: 'admin1', name: 'Admin', email: 'admin@dassu.de', role: 'admin',
    });
    await set(ref(db, 'bookingContacts/existing1'), {
      uid: 'cust1', name: 'Kunde Eins', email: 'cust1@example.de', phone: '', comment: '',
    });
  });
});

beforeEach(async () => {
  // Bestandsbuchung vor JEDEM Test auf bekannten Zustand (pending, Besitzer cust1)
  // zurücksetzen — sonst beeinflussen sich Status-Tests gegenseitig.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), 'bookings/existing1'), {
      aircraft: 'D-KYGL', date: '2026-01-01', startTime: '10:00', endTime: '11:00',
      status: 'pending', uid: 'cust1',
    });
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

describe('Rules · Buchungs-Status (die kritische Härtung)', () => {
  it('Kunde darf eigene Buchung als "pending" anlegen', async () => {
    const db = testEnv.authenticatedContext('cust1').database();
    await assertSucceeds(set(ref(db, 'bookings/new_ok'), {
      aircraft: 'D-KYCK', date: '2026-02-02', status: 'pending', uid: 'cust1',
    }));
  });

  it('Kunde darf Buchung NICHT direkt als "approved" anlegen', async () => {
    const db = testEnv.authenticatedContext('cust2').database();
    await assertFails(set(ref(db, 'bookings/new_bad'), {
      aircraft: 'D-KYCK', date: '2026-02-02', status: 'approved', uid: 'cust2',
    }));
  });

  it('Kunde darf eigene Buchung NICHT auf "approved" setzen', async () => {
    const db = testEnv.authenticatedContext('cust1').database();
    await assertFails(update(ref(db, 'bookings/existing1'), { status: 'approved' }));
  });

  it('Staff darf Buchung auf "approved" setzen', async () => {
    const db = testEnv.authenticatedContext('admin1').database();
    await assertSucceeds(update(ref(db, 'bookings/existing1'), { status: 'approved' }));
  });
});

describe('Rules · Buchungs-Besitz', () => {
  it('Kunde darf fremde Buchung NICHT ändern', async () => {
    const db = testEnv.authenticatedContext('intruder').database();
    await assertFails(update(ref(db, 'bookings/existing1'), { aircraft: 'HACK' }));
  });

  it('Eingeloggter darf den Kalender (bookings) lesen', async () => {
    const db = testEnv.authenticatedContext('cust2').database();
    await assertSucceeds(get(ref(db, 'bookings/existing1')));
  });
});

describe('Rules · PII-Trennung (bookingContacts)', () => {
  it('Fremder Kunde darf bookingContacts NICHT lesen', async () => {
    const db = testEnv.authenticatedContext('intruder').database();
    await assertFails(get(ref(db, 'bookingContacts/existing1')));
  });

  it('Besitzer darf eigene bookingContacts lesen', async () => {
    const db = testEnv.authenticatedContext('cust1').database();
    await assertSucceeds(get(ref(db, 'bookingContacts/existing1')));
  });

  it('Staff darf bookingContacts lesen', async () => {
    const db = testEnv.authenticatedContext('admin1').database();
    await assertSucceeds(get(ref(db, 'bookingContacts/existing1')));
  });
});

describe('Rules · Kundenprofile & Gäste', () => {
  it('Kunde darf NICHT fremdes customers-Profil schreiben', async () => {
    const db = testEnv.authenticatedContext('cust1').database();
    await assertFails(set(ref(db, 'customers/someoneElse/name'), 'Übernommen'));
  });

  it('Nicht-eingeloggter Gast darf bookings NICHT lesen', async () => {
    const db = testEnv.unauthenticatedContext().database();
    await assertFails(get(ref(db, 'bookings/existing1')));
  });

  it('Nicht-Admin darf NICHT in fremdes staffUsers schreiben', async () => {
    const db = testEnv.authenticatedContext('cust1').database();
    await assertFails(set(ref(db, 'staffUsers/admin1/role'), 'admin'));
  });
});
