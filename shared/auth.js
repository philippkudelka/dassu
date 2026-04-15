/* DASSU – geteilter Auth-Helper
 * Wrap um Firebase Auth mit Einladungs-Check:
 *   - signUpWithInvitation: nur wer eine Einladung hat, kann sich registrieren
 *   - signIn / signOut / resetPassword / onAuthChange
 *   - emailKey: E-Mail -> sicherer Firebase-Pfad
 *
 * Voraussetzungen in der Seite:
 *   - Firebase Auth Compat SDK muss geladen sein vor diesem Script
 *   - firebase wurde bereits initializeApp() aufgerufen
 *
 * Firebase Datenbank-Pfade:
 *   - /invitations/{emailKey}: { email, name, role, createdAt }
 *   - /staffUsers/{uid}: { id: uid, name, email, role, permissions? }
 */
(function (global) {
  // E-Mail -> Firebase-Pfad-taugliche Variante (Punkte/at/# ersetzen)
  function emailKey(email) {
    if (!email) return '';
    return email.trim().toLowerCase()
      .replace(/\./g, ',')
      .replace(/@/g, '__at__')
      .replace(/#/g, '__hash__')
      .replace(/\$/g, '__dollar__')
      .replace(/\[/g, '__lb__')
      .replace(/\]/g, '__rb__');
  }

  // Liefert den staffUsers-Eintrag zum aktuell eingeloggten Firebase-User
  async function currentStaffProfile() {
    const auth = firebase.auth();
    const user = auth.currentUser;
    if (!user) return null;
    const snap = await firebase.database().ref('staffUsers/' + user.uid).once('value');
    return snap.val();
  }

  // Registrierung mit Einladungs-Check
  // Reihenfolge: Firebase Auth zuerst, dann Einladung prüfen (damit Rules auth-required sein können).
  async function signUpWithInvitation(email, password, displayName) {
    email = (email || '').trim().toLowerCase();
    if (!email || !password) return { ok: false, error: 'E-Mail und Passwort sind Pflicht.' };

    const auth = firebase.auth();
    const db = firebase.database();

    // 1. Firebase Auth Account erstellen (User ist danach eingeloggt)
    let cred;
    try {
      cred = await auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        return { ok: false, error: 'Für diese E-Mail gibt es bereits einen Account. Bitte einloggen oder Passwort zurücksetzen.' };
      }
      return { ok: false, error: mapAuthError(e) };
    }

    const uid = cred.user.uid;

    // 2. Einladung prüfen (jetzt authed, Rules können auth != null verlangen)
    let inv;
    try {
      const invSnap = await db.ref('invitations/' + emailKey(email)).once('value');
      inv = invSnap.val();
    } catch (e) {
      // Zugriff verweigert – Auth-Account wieder löschen
      try { await cred.user.delete(); } catch (_) {}
      return { ok: false, error: 'Einladung konnte nicht geprüft werden: ' + e.message };
    }

    if (!inv) {
      // Keine Einladung – Auth-Account wieder löschen
      try { await cred.user.delete(); } catch (_) {
        try { await auth.signOut(); } catch (_) {}
      }
      return { ok: false, error: 'Keine Einladung für diese E-Mail gefunden. Bitte wende dich an den Admin.' };
    }

    // 3. Profil in staffUsers anlegen + Einladung verbrauchen
    const profile = {
      id: uid,
      name: (displayName || inv.name || '').trim() || email,
      email: email,
      role: inv.role || 'team',
      createdAt: Date.now()
    };
    try {
      await db.ref('staffUsers/' + uid).set(profile);
      await db.ref('invitations/' + emailKey(email)).remove();
    } catch (e) {
      try { await cred.user.delete(); } catch (_) {}
      return { ok: false, error: 'Profil konnte nicht gespeichert werden: ' + e.message };
    }

    // Firebase Auth displayName setzen (nice-to-have)
    try { await cred.user.updateProfile({ displayName: profile.name }); } catch (_) {}

    return { ok: true, profile: profile };
  }

  async function signIn(email, password) {
    try {
      await firebase.auth().signInWithEmailAndPassword((email || '').trim().toLowerCase(), password);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }

  async function signOutUser() {
    try { await firebase.auth().signOut(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  async function resetPassword(email) {
    try {
      await firebase.auth().sendPasswordResetEmail((email || '').trim().toLowerCase());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }

  function onAuthChange(cb) {
    return firebase.auth().onAuthStateChanged(cb);
  }

  function mapAuthError(e) {
    const code = e && e.code;
    const m = {
      'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
      'auth/user-disabled': 'Dieser Account ist deaktiviert.',
      'auth/user-not-found': 'Kein Account mit dieser E-Mail gefunden.',
      'auth/wrong-password': 'Falsches Passwort.',
      'auth/invalid-credential': 'E-Mail oder Passwort falsch.',
      'auth/weak-password': 'Passwort zu schwach (mindestens 6 Zeichen).',
      'auth/email-already-in-use': 'Für diese E-Mail gibt es schon einen Account.',
      'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten.',
      'auth/network-request-failed': 'Netzwerkfehler. Bitte Internet prüfen.',
    };
    return m[code] || (e && e.message) || 'Unbekannter Fehler.';
  }

  global.DASSU_AUTH = {
    emailKey,
    signUpWithInvitation,
    signIn,
    signOut: signOutUser,
    resetPassword,
    onAuthChange,
    currentStaffProfile,
    mapAuthError,
  };
})(typeof window !== 'undefined' ? window : this);
