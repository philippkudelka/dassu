import { defineConfig, configDefaults } from 'vitest/config';

// Default-Test-Konfig für `npm test`.
// Der Rules-Emulator-Test wird hier AUSGESCHLOSSEN — er braucht den laufenden
// Firebase-Emulator und läuft separat über `npm run test:rules`
// (vitest.rules.config.js), nicht im normalen Test-Lauf.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/rules.emulator.test.js'],
  },
});
