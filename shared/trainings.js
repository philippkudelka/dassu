/**
 * Zentrale Liste der DASSU-Ausbildungen.
 *
 * Wird sowohl in index.html (Tab-Sichtbarkeit „Meine Ausbildung", Lehrplan-Auswahl)
 * als auch in staff.html (Admin-Dropdown im Mitglieder-Detail) verwendet.
 *
 * Der Code-Wert wird in customers/{uid}/assignedTraining gespeichert und ist
 * stabil — nur das Label darf sich ändern. Wer den Code ändert, muss in der
 * Datenbank migrieren.
 */
(function (global) {
  const TRAININGS = [
    { code: 'spl-glider',         label: 'SPL Segelflug' },
    { code: 'spl-tmg-only',       label: 'SPL TMG only' },
    { code: 'spl-glider-tmg',     label: 'SPL Segelflug und TMG' },
    { code: 'tmg-extension-spl',  label: 'TMG Umschüler vom SPL' },
    { code: 'tmg-cr-ppl-lapl',    label: 'TMG CR PPL/LAPL' },
    { code: 'tmg-to-ul',          label: 'Umschüler TMG zu UL' },
    { code: 'glider-to-ul',       label: 'Umschüler Segelflug zu UL' },
    { code: 'ul',                 label: 'UL' },
    { code: 'lapl-a',             label: 'LAPL(A)' },
    { code: 'ppl-a',              label: 'PPL(A)' },
    { code: 'spl-tmg-to-lapl-a',  label: 'Umschüler SPL mit TMG zu LAPL(A)' },
    { code: 'lapl-to-ppl-a',      label: 'Umschüler LAPL(A) zu PPL(A)' }
  ];

  // Welche Ausbildungen haben bereits einen fertigen Lehrplan?
  // Aktuell nur die TMG-Erweiterung vom SPL (AMC1 SFCL.150) — alle anderen
  // zeigen den Platzhalter „Lehrplan in Vorbereitung".
  const TRAININGS_WITH_CURRICULUM = new Set(['tmg-extension-spl']);

  function getTrainingLabel(code) {
    const t = TRAININGS.find(x => x.code === code);
    return t ? t.label : '';
  }

  function hasTrainingCurriculum(code) {
    return TRAININGS_WITH_CURRICULUM.has(code);
  }

  global.DASSU_TRAININGS = TRAININGS;
  global.getTrainingLabel = getTrainingLabel;
  global.hasTrainingCurriculum = hasTrainingCurriculum;
})(typeof window !== 'undefined' ? window : globalThis);
