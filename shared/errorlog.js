/* DASSU – einfaches Fehler-Logging
 *
 * Fängt unbehandelte JavaScript-Fehler und Promise-Rejections ab und schreibt
 * sie nach Firebase /errorLog. Die Netlify-Function error-report.js fasst sie
 * einmal täglich per E-Mail zusammen.
 *
 * Einbinden NACH dem Firebase-SDK und nach firebase.initializeApp().
 * Das Logging selbst darf nie crashen — alles in try/catch.
 */
(function () {
  var DEDUP_WINDOW_MS = 60000; // denselben Fehler höchstens 1× pro Minute melden
  var MAX_PER_SESSION = 20;    // Schutz gegen Fehler-Schleifen, die das Log fluten
  var recent = {};
  var sentCount = 0;

  function logError(info) {
    try {
      if (sentCount >= MAX_PER_SESSION) return;
      if (typeof firebase === 'undefined' || !firebase.database) return;

      var key = (info.message || '') + '|' + (info.line || '');
      var now = Date.now();
      if (recent[key] && (now - recent[key]) < DEDUP_WINDOW_MS) return;
      recent[key] = now;
      sentCount++;

      var entry = {
        ts: now,
        message: String(info.message || 'Unbekannter Fehler').slice(0, 500),
        stack: String(info.stack || '').slice(0, 2000),
        source: String(info.source || '').slice(0, 300),
        line: info.line || 0,
        page: location.pathname,
        url: String(location.href).slice(0, 300),
        userAgent: String(navigator.userAgent || '').slice(0, 300)
      };
      try {
        var u = firebase.auth().currentUser;
        if (u) { entry.uid = u.uid; entry.userEmail = u.email || ''; }
      } catch (e) { /* Auth evtl. noch nicht bereit */ }

      firebase.database().ref('errorLog').push(entry);
    } catch (e) { /* Fehler-Logging darf selbst nie crashen */ }
  }

  window.addEventListener('error', function (e) {
    logError({
      message: e.message,
      source: e.filename,
      line: e.lineno,
      stack: e.error && e.error.stack
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    logError({
      message: 'Unhandled Promise Rejection: ' + (r && r.message ? r.message : String(r)),
      stack: r && r.stack
    });
  });
})();
