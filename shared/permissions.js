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
  const PERMISSIONS = [
    {
      key: 'manageUsers',
      label: 'Nutzerverwaltung',
      desc: 'Darf Mitarbeiter anlegen, Rollen & Rechte ändern.',
      defaultAdmin: true,
      defaultStaff: false,
    },
    {
      key: 'deleteBookings',
      label: 'Buchungen löschen',
      desc: 'Darf Buchungen endgültig entfernen.',
      defaultAdmin: true,
      defaultStaff: false,
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
    if (u.permissions && typeof u.permissions[key] === 'boolean') {
      return u.permissions[key];
    }
    const def = PERMISSIONS.find((p) => p.key === key);
    if (!def) return false;
    return u.role === 'admin' ? def.defaultAdmin : def.defaultStaff;
  }

  /** true, wenn ein expliziter Flag-Wert gesetzt ist (für UI-Hint "Standard"). */
  function isExplicit(user, key) {
    return !!(user && user.permissions && typeof user.permissions[key] === 'boolean');
  }

  global.DASSU_PERMISSIONS = PERMISSIONS;
  global.hasPermission = hasPermission;
  global.isPermissionExplicit = isExplicit;
})(typeof window !== 'undefined' ? window : this);
