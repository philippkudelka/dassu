/* DASSU – Nachrichten-Modul (shared)
 *
 * Einseitiger Kanal: Team/Admin  →  Fluglehrer (Segel-/Motorfluglehrer).
 * Fluglehrer lesen nur. Pro Nachricht wird protokolliert, wer sie wann gelesen hat.
 *
 * Firebase:
 *   DB:  /messages/{id} = {
 *          title, body,
 *          target,            // 'all' | 'glider' | 'motor'  (Empfängergruppe)
 *          createdAt, createdBy, createdByName, createdByRole,
 *          files[], readBy{uid: timestamp}
 *        }
 *   Storage: /messages/{id}/{filename}
 *
 * Rules: Senden = Team/Admin · Lesen = alle Staff · Löschen = Admin ·
 *        readBy = jeder nur den eigenen Eintrag.
 */
(function (global) {
  const TARGETS = ['all', 'glider', 'motor'];

  async function _role(uid) {
    const snap = await firebase.database().ref('staffUsers/' + uid + '/role').once('value');
    return snap.val();
  }
  function _isLeadership(role) { return role === 'admin' || role === 'team'; }

  async function _uploadFiles(messageId, files) {
    if (!files || !files.length) return [];
    const storage = firebase.storage();
    const uploads = files.map(async f => {
      const ref = storage.ref('messages/' + messageId + '/' + f.name);
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
    try {
      const ref = firebase.database().ref('messages').push();
      const id = ref.key;
      const fileMeta = await _uploadFiles(id, files);
      await ref.set({
        title: (title || '').substring(0, 200),
        body: (body || '').substring(0, 5000),
        target: TARGETS.indexOf(target) >= 0 ? target : 'all',
        createdAt: Date.now(),
        createdBy: user.uid,
        createdByName: createdByName || user.email || 'Team',
        createdByRole: role || 'team',
        files: fileMeta,
        readBy: {}
      });
      return { ok: true, id };
    } catch (e) { return { ok: false, error: e.message || 'Senden fehlgeschlagen' }; }
  }

  async function getMessages(limit) {
    const snap = await firebase.database().ref('messages')
      .orderByChild('createdAt').limitToLast(limit || 100).once('value');
    const data = snap.val();
    if (!data) return [];
    return Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Empfänger (Fluglehrer): Nachricht als gelesen markieren (mit Zeitstempel)
  async function markRead(id, uid) {
    try { await firebase.database().ref('messages/' + id + '/readBy/' + uid).set(Date.now()); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  async function deleteMessage(id) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    if ((await _role(user.uid)) !== 'admin') return { ok: false, error: 'Nur Admins dürfen löschen.' };
    try {
      const storage = firebase.storage();
      const snap = await firebase.database().ref('messages/' + id).once('value');
      const m = snap.val();
      if (m && m.files && m.files.length) {
        await Promise.all(m.files.map(f => storage.ref('messages/' + id + '/' + f.name).delete().catch(() => {})));
      }
      await firebase.database().ref('messages/' + id).remove();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  global.DASSU_MESSAGES = {
    TARGETS,
    sendMessage,
    getMessages,
    markRead,
    markAsRead: markRead, // Alias (Altaufrufe)
    deleteMessage
  };
})(typeof window !== 'undefined' ? window : this);
