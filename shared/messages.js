/* DASSU – Nachrichten-Modul (shared)
 * Admin → Fluglehrer Einweg-Nachrichten mit Dateianhängen
 *
 * Firebase Paths:
 *   DB:  /messages/{pushId} = { title, body, createdAt, createdBy, createdByName, files[], readBy{} }
 *   Storage: /messages/{pushId}/{filename}
 *
 * Voraussetzungen:
 *   - Firebase App, Auth, Database, Storage Compat SDKs geladen
 *   - firebase.initializeApp() aufgerufen
 */
(function (global) {

  async function sendMessage(title, body, files, createdByName) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };

    const db = firebase.database();
    const storage = firebase.storage();

    // Admin-Check
    const snap = await db.ref('staffUsers/' + user.uid).once('value');
    const prof = snap.val();
    if (!prof || prof.role !== 'admin') return { ok: false, error: 'Nur Admins können Nachrichten senden.' };

    try {
      const msgRef = db.ref('messages').push();
      const messageId = msgRef.key;

      // Dateien parallel hochladen
      const fileMeta = [];
      if (files && files.length) {
        const uploads = files.map(async f => {
          const ref = storage.ref('messages/' + messageId + '/' + f.name);
          await ref.put(f);
          const url = await ref.getDownloadURL();
          return { name: f.name, url, size: f.size, type: f.type };
        });
        fileMeta.push(...(await Promise.all(uploads)));
      }

      await msgRef.set({
        title: (title || '').substring(0, 120),
        body: body || '',
        createdAt: Date.now(),
        createdBy: user.uid,
        createdByName: createdByName || user.email || 'Admin',
        files: fileMeta,
        readBy: {}
      });

      return { ok: true, messageId };
    } catch (e) {
      return { ok: false, error: e.message || 'Senden fehlgeschlagen' };
    }
  }

  async function getMessages(limit) {
    const db = firebase.database();
    const snap = await db.ref('messages')
      .orderByChild('createdAt')
      .limitToLast(limit || 50)
      .once('value');
    const data = snap.val();
    if (!data) return [];
    return Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async function markAsRead(messageId, uid) {
    try {
      await firebase.database().ref('messages/' + messageId + '/readBy/' + uid).set(Date.now());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function deleteMessage(messageId) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Nicht eingeloggt' };
    const db = firebase.database();
    const storage = firebase.storage();

    // Admin-Check
    const snap = await db.ref('staffUsers/' + user.uid).once('value');
    const prof = snap.val();
    if (!prof || prof.role !== 'admin') return { ok: false, error: 'Nur Admins können löschen.' };

    try {
      // Dateien aus Storage löschen
      const msgSnap = await db.ref('messages/' + messageId).once('value');
      const msg = msgSnap.val();
      if (msg && msg.files && msg.files.length) {
        await Promise.all(msg.files.map(f => {
          return storage.ref('messages/' + messageId + '/' + f.name).delete().catch(() => {});
        }));
      }
      // DB-Eintrag löschen
      await db.ref('messages/' + messageId).remove();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  global.DASSU_MESSAGES = { sendMessage, getMessages, markAsRead, deleteMessage };
})(typeof window !== 'undefined' ? window : this);
