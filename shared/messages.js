/* DASSU – Nachrichten-Modul (shared)
 *
 * Einseitiger Kanal: Team/Admin  →  Fluglehrer (Segel-/Motorfluglehrer).
 * Fluglehrer lesen nur. Pro Nachricht wird protokolliert, wer sie wann gelesen hat.
 *
 * HARTE Gruppen-Trennung (serverseitig über die Rules erzwungen): die Nachrichten
 * liegen nach Empfängergruppe in getrennten Pfaden, damit z. B. ein Motorfluglehrer
 * Segel-Nachrichten technisch NICHT lesen kann.
 *
 *   /messages/all/{id}     → alle Fluglehrer + Team/Admin
 *   /messages/glider/{id}  → nur Segelfluglehrer (+ Team/Admin)
 *   /messages/motor/{id}   → nur Motorfluglehrer (+ Team/Admin)
 *
 *   {id} = { title, body, createdAt, createdBy, createdByName, createdByRole,
 *            files[], readBy{uid: timestamp} }
 *   Storage: /messages/{group}/{id}/{filename}
 *
 * Rules: Senden = Team/Admin · Lesen = je nach Gruppe · Löschen = Admin ·
 *        readBy = jeder nur den eigenen Eintrag.
 */
(function (global) {
  const TARGETS = ['all', 'glider', 'motor'];

  async function _role(uid) {
    const snap = await firebase.database().ref('staffUsers/' + uid + '/role').once('value');
    return snap.val();
  }
  function _isLeadership(role) { return role === 'admin' || role === 'team'; }

  async function _uploadFiles(basePath, messageId, files) {
    if (!files || !files.length) return [];
    const storage = firebase.storage();
    const uploads = files.map(async f => {
      const ref = storage.ref(basePath + '/' + messageId + '/' + f.name);
      await ref.put(f);
      const url = await ref.getDownloadURL();
      return { name: f.name, url, size: f.size, type: f.type };
    });
    return Promise.all(uploads);
  }

  // Team/Admin: Nachricht an eine Fluglehrer-Gruppe senden
  async function sendMessage(title, body, target, files, createdByName) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    const role = await _role(user.uid);
    if (!_isLeadership(role)) return { ok: false, error: 'Nur Team/Admin dürfen Nachrichten senden.' };
    const group = TARGETS.indexOf(target) >= 0 ? target : 'all';
    try {
      const base = 'messages/' + group;
      const ref = firebase.database().ref(base).push();
      const id = ref.key;
      const fileMeta = await _uploadFiles(base, id, files);
      await ref.set({
        title: (title || '').substring(0, 200),
        body: (body || '').substring(0, 5000),
        createdAt: Date.now(),
        createdBy: user.uid,
        createdByName: createdByName || user.email || 'Team',
        createdByRole: role || 'team',
        files: fileMeta,
        readBy: {}
      });
      return { ok: true, id, group };
    } catch (e) { return { ok: false, error: e.message || 'Senden fehlgeschlagen' }; }
  }

  function _flatten(groupKey, data) {
    if (!data) return [];
    return Object.entries(data).map(([id, m]) => ({ id, group: groupKey, ...m }));
  }

  // Team/Admin: ALLE Gruppen lesen (für Versand-Liste + Lese-Protokoll)
  async function getAll(limit) {
    const snap = await firebase.database().ref('messages').once('value');
    const data = snap.val() || {};
    let out = [];
    TARGETS.forEach(grp => { out = out.concat(_flatten(grp, data[grp])); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    return limit ? out.slice(0, limit) : out;
  }

  // Fluglehrer: nur die eigenen erlaubten Gruppen lesen ('all' + eigene Variante)
  async function getForInstructor(variant, limit) {
    const groups = ['all'];
    if (variant === 'glider' || variant === 'motor') groups.push(variant);
    const snaps = await Promise.all(groups.map(grp =>
      firebase.database().ref('messages/' + grp).orderByChild('createdAt').limitToLast(limit || 100).once('value')
    ));
    let out = [];
    snaps.forEach((snap, i) => { out = out.concat(_flatten(groups[i], snap.val())); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    return limit ? out.slice(0, limit) : out;
  }

  // Empfänger (Fluglehrer): Nachricht als gelesen markieren (mit Zeitstempel)
  async function markRead(group, id, uid) {
    try { await firebase.database().ref('messages/' + group + '/' + id + '/readBy/' + uid).set(Date.now()); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  async function deleteMessage(group, id) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    if ((await _role(user.uid)) !== 'admin') return { ok: false, error: 'Nur Admins dürfen löschen.' };
    try {
      const storage = firebase.storage();
      const base = 'messages/' + group + '/' + id;
      const snap = await firebase.database().ref(base).once('value');
      const m = snap.val();
      if (m && m.files && m.files.length) {
        await Promise.all(m.files.map(f => storage.ref(base + '/' + f.name).delete().catch(() => {})));
      }
      await firebase.database().ref(base).remove();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  global.DASSU_MESSAGES = {
    TARGETS,
    sendMessage,
    getAll,
    getForInstructor,
    markRead,
    deleteMessage
  };
})(typeof window !== 'undefined' ? window : this);
