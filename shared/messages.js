/* DASSU – Nachrichten-Modul (shared) — v2
 *
 * Zwei Kanäle:
 *   1. Ankündigungen   /messages/{id}                       (Team/Admin → alle Staff)
 *   2. Interne Nachr.  /internalMessages/{autorUid}/{id}    (jeder Staff → Leitung; vertraulich)
 *
 * Vertraulichkeit interner Nachrichten wird SERVERSEITIG über die Rules erzwungen:
 *   - /internalMessages          ist nur für Leitung (Team/Admin) lesbar → sieht ALLE.
 *   - /internalMessages/{uid}     ist zusätzlich für den Autor selbst lesbar → sieht nur EIGENE.
 *   - Schreiben/Anlegen: nur der Autor in seinen eigenen Teilbaum. Löschen: nur Admin.
 *
 * Kategorien: hinweis | kritik | anmerkung | sonstiges
 * Felder: { title, body, category, createdAt, createdBy, createdByName, createdByRole, files[], readBy{} }
 * Storage: /messages/{id}/{file}  bzw. /internalMessages/{autorUid}/{id}/{file}
 */
(function (global) {
  const CATEGORIES = ['hinweis', 'kritik', 'anmerkung', 'sonstiges'];

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

  function _payload(title, body, category, role, name, files) {
    const user = firebase.auth().currentUser;
    return {
      title: (title || '').substring(0, 200),
      body: (body || '').substring(0, 5000),
      category: CATEGORIES.indexOf(category) >= 0 ? category : 'sonstiges',
      createdAt: Date.now(),
      createdBy: user ? user.uid : '',
      createdByName: name || (user && user.email) || '',
      createdByRole: role || '',
      files: files || [],
      readBy: {}
    };
  }

  // --- Ankündigung an alle (nur Team/Admin) ---
  async function sendAnnouncement(title, body, category, files, createdByName) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    const role = await _role(user.uid);
    if (!_isLeadership(role)) return { ok: false, error: 'Nur Team/Admin dürfen Ankündigungen senden.' };
    try {
      const ref = firebase.database().ref('messages').push();
      const id = ref.key;
      const fileMeta = await _uploadFiles('messages', id, files);
      await ref.set(_payload(title, body, category, role, createdByName, fileMeta));
      return { ok: true, id };
    } catch (e) { return { ok: false, error: e.message || 'Senden fehlgeschlagen' }; }
  }

  // --- Interne Nachricht an die Leitung (jeder Staff, inkl. Fluglehrer) ---
  async function sendInternal(title, body, category, files, createdByName) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    const role = await _role(user.uid);
    if (!role) return { ok: false, error: 'Nur Staff dürfen Nachrichten senden.' };
    try {
      const dbBase = 'internalMessages/' + user.uid;
      // Anhänge unter dem bestehenden messages/-Storage-Pfad ablegen (von den
      // Storage-Rules der Console bereits abgedeckt; internalMessages/ evtl. nicht).
      const storeBase = 'messages/_internal/' + user.uid;
      const ref = firebase.database().ref(dbBase).push();
      const id = ref.key;
      const fileMeta = await _uploadFiles(storeBase, id, files);
      await ref.set(_payload(title, body, category, role, createdByName, fileMeta));
      return { ok: true, id };
    } catch (e) { return { ok: false, error: e.message || 'Senden fehlgeschlagen' }; }
  }

  function _flatten(data, authorUid) {
    if (!data) return [];
    return Object.entries(data).map(([id, m]) => ({ id, authorUid, ...m }));
  }

  // Ankündigungen (alle Staff)
  async function getAnnouncements(limit) {
    const snap = await firebase.database().ref('messages').orderByChild('createdAt').limitToLast(limit || 100).once('value');
    return _flatten(snap.val(), null).sort((a, b) => b.createdAt - a.createdAt);
  }

  // Interne Nachrichten — Leitung sieht ALLE (über alle Autoren hinweg)
  async function getInternalAll(limit) {
    const snap = await firebase.database().ref('internalMessages').once('value');
    const byAuthor = snap.val() || {};
    let all = [];
    Object.keys(byAuthor).forEach(auid => { all = all.concat(_flatten(byAuthor[auid], auid)); });
    all.sort((a, b) => b.createdAt - a.createdAt);
    return limit ? all.slice(0, limit) : all;
  }

  // Interne Nachrichten — Autor sieht nur EIGENE
  async function getInternalMine(limit) {
    const user = firebase.auth().currentUser;
    if (!user) return [];
    const snap = await firebase.database().ref('internalMessages/' + user.uid).orderByChild('createdAt').limitToLast(limit || 100).once('value');
    return _flatten(snap.val(), user.uid).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function markAnnouncementRead(id, uid) {
    try { await firebase.database().ref('messages/' + id + '/readBy/' + uid).set(Date.now()); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  async function markInternalRead(authorUid, id, uid) {
    try { await firebase.database().ref('internalMessages/' + authorUid + '/' + id + '/readBy/' + uid).set(Date.now()); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  async function _deleteFiles(basePath, id, files) {
    if (!files || !files.length) return;
    const storage = firebase.storage();
    await Promise.all(files.map(f => storage.ref(basePath + '/' + id + '/' + f.name).delete().catch(() => {})));
  }

  async function deleteAnnouncement(id) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    if ((await _role(user.uid)) !== 'admin') return { ok: false, error: 'Nur Admins dürfen löschen.' };
    try {
      const snap = await firebase.database().ref('messages/' + id).once('value');
      const m = snap.val();
      if (m) await _deleteFiles('messages', id, m.files);
      await firebase.database().ref('messages/' + id).remove();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async function deleteInternal(authorUid, id) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    if ((await _role(user.uid)) !== 'admin') return { ok: false, error: 'Nur Admins dürfen löschen.' };
    try {
      const dbBase = 'internalMessages/' + authorUid;
      const storeBase = 'messages/_internal/' + authorUid;
      const snap = await firebase.database().ref(dbBase + '/' + id).once('value');
      const m = snap.val();
      if (m) await _deleteFiles(storeBase, id, m.files);
      await firebase.database().ref(dbBase + '/' + id).remove();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  global.DASSU_MESSAGES = {
    CATEGORIES,
    sendAnnouncement, sendInternal,
    getAnnouncements, getInternalAll, getInternalMine,
    markAnnouncementRead, markInternalRead,
    deleteAnnouncement, deleteInternal,
    // Backward-Compat zu alten Aufrufen (→ Ankündigungen)
    sendMessage: function (title, body, files, createdByName) { return sendAnnouncement(title, body, 'sonstiges', files, createdByName); },
    getMessages: getAnnouncements,
    markAsRead: markAnnouncementRead,
    deleteMessage: deleteAnnouncement
  };
})(typeof window !== 'undefined' ? window : this);
