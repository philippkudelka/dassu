# DASSU Buchungskalender

## Projekt-Überblick
Buchungskalender-Web-App für den Flugsportverein DASSU. Gehostet auf Netlify, Daten in Firebase Realtime Database, Auth über Firebase Authentication.

Live: https://dassu-buchungskalender.netlify.app
GitHub: https://github.com/philippkudelka/dassu.git

## Deployment

**WICHTIG: Deploy läuft über `deploy.command` im Finder (Doppelklick).**

Das Skript macht automatisch: branch-check, rebase, syntax-check der Functions, git add, commit, push → Netlify baut dann automatisch.
Ablauf in Claude: Finder öffnen → `deploy.command` doppelklicken → fertig.
Die Bash-Sandbox hat KEINEN GitHub-Zugriff (403 Proxy-Fehler). Niemals versuchen, `git push` aus der Sandbox zu machen.

### Rollback bei defektem Deploy

1. Netlify Dashboard öffnen → Site **dassu-buchungskalender** → **Deploys**
2. Letzten grünen Deploy auswählen (vor dem kaputten)
3. Button **"Publish deploy"** klicken — die Live-Version springt sofort auf diesen Stand zurück
4. Den Code-Fix lokal vornehmen und neu deployen

### Firebase Database Rules

`database.rules.json` liegt im Repo als Vorschlag und ist NICHT automatisch synchronisiert.
- Import: Firebase Console → Realtime Database → Rules → JSON aus `database.rules.json` einfügen → **Publish**
- Vor dem Import: aktuelle Rules sichern (Firebase Console → Rules → "..." → Export)
- **WICHTIG**: Rules vor Publish im "Rules Playground" testen (Lesen + Schreiben mit echten UIDs simulieren). Falsche Rules können die App komplett blockieren — dann sofort Rollback auf die exportierten Original-Rules.

## Datenbank-Backup

- **`netlify/functions/backup-database.js`** exportiert täglich (Zeitplan in `netlify.toml`, `@daily`) die komplette Firebase-DB als JSON und schickt sie per E-Mail an `BACKUP_EMAIL` (Default `philipp.kudelka@dassu.de`).
- **Wiederherstellung:** JSON-Anhang aus der Backup-Mail nehmen → Firebase Console → Realtime Database → Daten → 3-Punkte-Menü → "JSON importieren".
- **Manuell auslösen** (optional): Env-Var `BACKUP_SECRET` in Netlify setzen, dann `.../.netlify/functions/backup-database?key=<BACKUP_SECRET>` aufrufen.
- Optionale Env-Var `BACKUP_EMAIL` ändert den Empfänger.

## Tests

- **`tests/`** enthält Vitest-Tests für die isolierten Module `shared/permissions.js` und `shared/holidays.js`.
- Lokal ausführen: `npm install` (einmalig), dann `npm test`.
- **`.github/workflows/ci.yml`** führt bei jedem Push automatisch `npm test` + einen Syntax-Check aller Functions aus. Das blockiert das Netlify-Deployment NICHT — es gibt nur ein grünes/rotes Signal am Commit auf GitHub.
- Hinweis: `shared/permissions.js` + `holidays.js` haben einen `globalThis`-Fallback, damit sie auch in Node (Tests) laufen.

## Fehler-Monitoring

- **`shared/errorlog.js`** (in index.html + staff.html eingebunden) fängt unbehandelte JS-Fehler ab und schreibt sie nach Firebase `/errorLog` (mit Dedup + Session-Limit gegen Fehler-Schleifen).
- **`netlify/functions/error-report.js`** verschickt täglich um 06:00 UTC eine Fehler-Zusammenfassung der letzten 24h per E-Mail (nur wenn Fehler auftraten) und löscht Einträge älter als 30 Tage.
- `errorLog` ist per Rules nur für Admins lesbar; schreiben darf jeder (auch vor Login), aber nur neue Einträge.
- Empfänger: `ERROR_EMAIL` (Fallback `BACKUP_EMAIL`, Default `philipp.kudelka@dassu.de`).

## Buchungs-Daten-Struktur (PII-Trennung)

- `bookings/{id}` — nur Belegungsdaten (aircraft, date, Zeiten, status, instructorName, **uid** = Besitzer).
- `bookingContacts/{id}` — Kontaktdaten (name, email, phone, comment, uid). Nur für Staff oder Besitzer lesbar.
- Schreiben: index.html `saveBooking()` + `saveBookingContact()`; staff.html `saveBookingSplit()`. Löschen löscht IMMER beide Knoten.
- staff.html + index.html (für Staff) laden zusätzlich `bookingContacts` und mergen die PII per `mergeBookingContacts()` ins `bookings`-Array.

## Wichtige Hinweise zur Sicherheit

- **Netlify Functions verlangen Bearer-Token** (außer `send-reset-email` für Passwort-vergessen-Flow). Bei Frontend-Erweiterungen immer `Authorization: Bearer ${idToken}` mitschicken.
- **Bookings werden per-ID geschrieben** (`saveBooking(b)` / `deleteBookingFromDb(id)` in index.html). NIEMALS wieder `db.ref('bookings').set(...)` mit dem ganzen Tree — das überschreibt parallele Buchungen anderer User.
- **User-Input immer escapen** beim Rendering: `escapeHtml(val)` für Text, `escapeAttr(val)` für Attribute. Beide Helper existieren in index.html und staff.html. Für inline-Handler-Argumente: `jsArg(val)`.
- **CORS** ist hart auf `https://dassu-buchungskalender.netlify.app` beschränkt — bei lokalem Testen `netlify dev` nutzen (proxied korrekt) oder Origin temporär erweitern.
- **Auth-Token holen**: `getFirebaseToken()` (existiert in beiden HTMLs) verwenden statt direkt `firebase.auth().currentUser.getIdToken()` — hat Null-Check.

## Audit-Log

- `logActivity(type, text, ref)` schreibt zentrale Aktivitäts-Einträge nach `/activityLog/`. Typen:
  - **Buchungen**: `create`, `edit`, `approve`, `reject`, `delete`, `note`
  - **User-Verwaltung**: `user.role`, `user.permission`, `user.delete`
  - **Kunden**: `customer.create`, `customer.update`, `customer.delete`, `customer.type`
- Anzeige in staff.html: (1) Manage-Tab Filter "Log", (2) Mitglieder-Tab "Aktivitäts-Protokoll" (admin-only, gefiltert auf user.*/customer.*).
- Read: nur Admins (Rules); Write: alle eingeloggten User.

## DSGVO

- `exportMyData()` (staff.html + index.html, im "Mein Konto"-Bereich) — lädt alle eigenen Daten (Profile, Buchungen, bookingContacts, timeEntries) als JSON.
- `deleteMyAccount()` (staff.html + index.html) — löscht eigenes Profil + eigene Buchungen + Push-Tokens, ruft `delete-auth-user`-Function für Firebase-Auth-Account.
- **Self-Delete in `delete-auth-user.js`** ist explizit erlaubt (DSGVO Art. 17): wenn `targetUid === callerUid`, geht's auch ohne Admin-Rolle durch. Fremde Konten brauchen weiterhin Admin.

## Dateistruktur

- `index.html` — Kunden-/Mitglieder-Ansicht (Buchungskalender, Login, Buchung erstellen)
- `staff.html` — Staff/Admin-Ansicht (Übersicht, Buchungsverwaltung, Zeiterfassung, Vereinsflieger-Sync)
- `welcome.html` — Willkommensseite
- `shared/auth.js` — Firebase Auth (gemeinsam genutzt)
- `shared/permissions.js` — Rechte-System (Rollen: admin, vorstand, flugleiter, member)
- `deploy.command` — Shell-Skript für Git commit + push
- `netlify.toml` — Netlify-Konfiguration (esbuild, functions)
- `sw.js`, `firebase-messaging-sw.js` — Service Worker / Push Notifications
- `manifest.json` — PWA Manifest

### Netlify Functions (`netlify/functions/`)
- `send-push.js` — Push-Benachrichtigungen
- `vereinsflieger-sync.js` — Vereinsflieger-API Sync. **Staff-Actions (Statistik, Jahresvergleich, Listen) nutzen die PERSÖNLICHEN VF-Zugangsdaten des eingeloggten Admins** (verschlüsselt in `users/{uid}/vfCredentials`). Jeder Admin muss sein VF-Konto einmal im Konto-Bereich (index.html) verknüpfen. Kein zentrales VF-Konto mehr.
  - **DASSU-Flotten-Whitelist**: Alle Flüge werden in `vfGetFlightsDateRange()` zentral auf die Flotte (`DASSU_FLEET` Set, ganz oben in der Datei) gefiltert — Quelle ist <https://www.dassu.de/flotte>. Fremdflugzeuge, Schleppmaschinen (D-E…), Hubschrauber etc. tauchen nirgendwo in Statistik/Listen auf. **Verkaufte Flugzeuge bleiben in der Liste** (im "Historisch / verkauft"-Block), damit Vorjahres-Vergleiche stimmen. **Neue Vereinsflugzeuge ergänzen** und Funktion neu deployen.
- `backup-database.js`, `error-report.js` — geplante Funktionen (Backup, Fehler-Report)
- `package.json` — Dependencies (firebase-admin, nodemailer)

## Tech-Stack
- Reines HTML/CSS/JS (kein Framework, kein Build-Schritt)
- Firebase Realtime Database + Firebase Auth
- Netlify (Hosting + Serverless Functions)
- SheetJS (xlsx.full.min.js) — für Zeiterfassungs-Excel-Export + Statistik-Export in staff.html
- **Statistik-Export**: `exportStatsExcel()` (generisches DOM-Scraping: KPI-Kacheln, Balken-Charts, Tabellen des aktiven Sub-Tabs → mehrblättriges .xlsx) und `exportStatsPdf()` (Browser-Druck via `@media print` + `body.print-stats`-Klasse, zeigt nur den aktiven Stats-Bereich). Buttons in der Statistik-Kopfzeile.

## Wichtige Hinweise
- Firebase Web-API-Keys sind öffentlich/client-seitig → Secret-Scanner ist in netlify.toml deaktiviert
- Sprache im Code: Deutsch (Variablen/Kommentare gemischt DE/EN)
- Philipp ist Admin und Hauptentwickler
