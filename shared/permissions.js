/* DASSU – geteilte Rechte-Definition
 * Single source of truth für permissions. Wird von staff.html und index.html
 * per <script src="shared/permissions.js"> eingebunden.
 *
 * Neues Recht hinzufügen:
 *   1. Eintrag in DASSU_PERMISSIONS ergänzen (key + label + desc + Defaults)
 *   2. Im Code an der passenden Stelle hasPermission(...) / currentUserHas(...) prüfen
 *   3. Beide UIs rendern das neue Recht automatisch
 */
(function (global) {
  // Rollen – Reihenfolge = Anzeige-Reihenfolge in UI.
  // "legacy: true" = wird nur angezeigt, wenn ein User noch diese Rolle trägt,
  // steht aber nicht neu zur Auswahl.
  const ROLES = [
    { id: 'admin',       label: 'Admin',                     short: 'Admin' },
    { id: 'team',        label: 'DASSU Team',                short: 'Team' },
    { id: 'guestGlider', label: 'Gastfluglehrer Segelflug',  short: 'Gast Segel' },
    { id: 'guestMotor',  label: 'Gastfluglehrer Motor/UL',   short: 'Gast Motor' },
    { id: 'staff',       label: 'Staff (alt)',               short: 'Staff', legacy: true },
  ];

  function roleMeta(id) {
    return ROLES.find((r) => r.id === id) || { id: id, label: id, short: id };
  }

  // Default-Werte pro Rolle für jedes Recht.
  // Admin = immer alles true (wird zusätzlich hart geprüft).
  // staff = alias für team (Backward-Compat zu alten Daten).
  const PERMISSIONS = [
    {
      key: 'manageUsers',
      label: 'Nutzerverwaltung',
      desc: 'Darf Benutzer anlegen, Rollen & Rechte ändern.',
      defaults: { admin: true, team: false, guestGlider: false, guestMotor: false },
    },
    {
      key: 'deleteBookings',
      label: 'Buchungen löschen',
      desc: 'Darf Buchungen endgültig entfernen.',
      defaults: { admin: true, team: false, guestGlider: false, guestMotor: false },
    },
    {
      key: 'trackTheory',
      label: 'Theorieunterricht erfassen',
      desc: 'Darf eigene Theoriestunden (Schüler, Thema, Zeit) erfassen und bearbeiten.',
      defaults: { admin: true, team: true, guestGlider: true, guestMotor: true },
    },
    {
      key: 'viewAllTheory',
      label: 'Alle Theorie-Einträge sehen',
      desc: 'Darf die Theoriestunden aller Lehrer einsehen (z.B. für Abrechnung).',
      defaults: { admin: true, team: false, guestGlider: false, guestMotor: false },
    },
    // Weitere Rechte hier ergänzen, sobald definiert.
  ];

  /**
   * Prüft, ob ein User ein Recht hat.
   * Reihenfolge: explizites permissions[key] > Rollen-Default.
   * @param {object} user      – User-Objekt (mit .role und optional .permissions)
   * @param {Array}  staffUsers – aktuelle Liste aller User (für Lookup per id)
   * @param {string} key       – Recht-Key aus PERMISSIONS
   */
  function hasPermission(user, staffUsers, key) {
    if (!user) return false;
    const u =
      (Array.isArray(staffUsers) && user.id
        ? staffUsers.find((x) => x.id === user.id)
        : null) || user;
    // Admin hat immer alle Rechte (hard override).
    if (u.role === 'admin') return true;
    if (u.permissions && typeof u.permissions[key] === 'boolean') {
      return u.permissions[key];
    }
    const def = PERMISSIONS.find((p) => p.key === key);
    if (!def || !def.defaults) return false;
    // 'staff' (Legacy) verhält sich wie 'team'
    const roleKey = u.role === 'staff' ? 'team' : u.role;
    return !!def.defaults[roleKey];
  }

  /** true, wenn ein expliziter Flag-Wert gesetzt ist (für UI-Hint "Standard"). */
  function isExplicit(user, key) {
    return !!(user && user.permissions && typeof user.permissions[key] === 'boolean');
  }

  global.DASSU_PERMISSIONS = PERMISSIONS;
  global.DASSU_ROLES = ROLES;
  global.roleMeta = roleMeta;
  global.hasPermission = hasPermission;
  global.isPermissionExplicit = isExplicit;
})(typeof window !== 'undefined' ? window : this);
