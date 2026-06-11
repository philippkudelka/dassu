import { defineConfig } from 'vitest/config';

// Konfig NUR für den Rules-Emulator-Test (`npm run test:rules`).
// Muss innerhalb von `firebase emulators:exec --only database` laufen, damit
// @firebase/rules-unit-testing den Emulator findet (Env-Var
// FIREBASE_DATABASE_EMULATOR_HOST wird von emulators:exec gesetzt).
export default defineConfig({
  test: {
    include: ['tests/rules.emulator.test.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
