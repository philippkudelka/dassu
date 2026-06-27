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

**Automatisiertes Deployment (bevorzugt):** `.github/workflows/deploy-rules.yml` deployt `database.rules.json` automatisch bei jeder Änderung auf `main` — versioniert, im selben Commit wie der Code. **Vor dem Deploy läuft ein Sicherheits-Gate:** der Rules-Verhaltenstest (`tests/rules.emulator.test.js`, via Firebase-Emulator) prüft Kern-Invarianten (Kunde kann nicht selbst freischalten, PII-Trennung, Besitz-Checks). Schlägt er fehl, wird NICHT deployed. Voraussetzung fürs Deploy: GitHub-Secret `FIREBASE_SERVICE_ACCOUNT`. Config: `firebase.json` (Rules-Pfad + Emulator) + `.firebaserc` (Projekt). **Rules NUR im Repo ändern, nie direkt in der Console** (würde beim nächsten Push überschrieben). Solange das Secret fehlt, wird der Deploy übersprungen (kein roter Build) — dann gilt der manuelle Weg:
- Manuell: Firebase Console → Realtime Database → Rules → JSON aus `database.rules.json` einfügen → **Publish**
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
- **`.github/workflows/ci.yml`** führt bei jedem Push automatisch `npm test` + Syntax-Check aller Functions + den **XSS-Lint** aus. Das blockiert das Netlify-Deployment NICHT — es gibt nur ein grünes/rotes Signal am Commit auf GitHub.
- Hinweis: `shared/permissions.js` + `holidays.js` haben einen `globalThis`-Fallback, damit sie auch in Node (Tests) laufen.

### XSS-Lint (`scripts/xss-lint.js`)

Maschineller Ersatz für die fehlende `script-src`-CSP. Sucht in `index.html`/`staff.html` nach User-Input-Feldern (Name, E-Mail, Kommentar, Telefon, Fluglehrername, Adresse …), die per `${…}` in einen **HTML-Kontext** interpoliert werden, **ohne** `escapeHtml()`/`escapeAttr()`/`jsArg()`/`encodeURIComponent()`. Blockiert die CI bei Funden (Exit 1).
- Lokal: `npm run lint:xss`
- Präzise gehalten (wenig False Positives): nur Zeilen mit HTML-Tag gelten als Sink; `.charAt(0)`-Initialen, reine Ternary-Tests und bereits-escapte `safe…`-Variablen werden ignoriert.
- **Freigabe** einer nachweislich sicheren Stelle: `// xss-lint-ok: <Begründung>` in derselben Zeile.
- Selbst getestet: `tests/xss-lint.test.js` prüft, dass der Linter echte Lücken FINDET und sichere Muster NICHT flaggt.
- **Regel beim Coden:** User-Input in HTML immer escapen. Wenn der Lint anschlägt, ist das ein echtes Signal — nicht einfach freigeben, sondern escapen.

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

## Ausbildungs-Zuweisung

- `customers/{uid}/assignedTraining` — Code einer der 12 in `shared/trainings.js` definierten Ausbildungen (z. B. `tmg-extension-spl`, `lapl-a`, `ppl-a`, …) oder leer.
- **Tab „Meine Ausbildung" (index.html)** erscheint NUR wenn `assignedTraining` gesetzt ist (nicht mehr an `customerType === 'student'` gekoppelt). Bestandsschüler ohne Zuweisung sehen den Tab nicht mehr — Admin muss einmalig pro Kunde im Mitglieder-Tab eine Ausbildung wählen.
- **Lehrplan-Anzeige**: Nur Code `tmg-extension-spl` (TMG-Erweiterung vom SPL, AMC1 SFCL.150) hat aktuell einen fertigen Lehrplan. Alle anderen 11 Ausbildungen zeigen den Platzhalter „Lehrplan in Vorbereitung". Wenn echte Lehrpläne dazu kommen: `TRAININGS_WITH_CURRICULUM` in `shared/trainings.js` erweitern + `renderMyTrainingView()` in index.html anpassen.
- **Admin-UI**: Customer-Detail-Panel in staff.html → Section „Ausbildung" → Dropdown (admin-only, schreibt `changeAssignedTraining(uid, code)` + Audit-Log).
- **Rules**: `customers/$uid/assignedTraining` ist mit `.validate` an `staffUsers.{uid}.role === 'admin'` gebunden — nur Admins können das Feld schreiben.

## Kalender-Abo (iCal)

- **Function `netlify/functions/ical-feed.js`** — liefert die Buchungen eines Users als `.ics` (RFC 5545), via URL `…/.netlify/functions/ical-feed?token=<icalToken>`. Authentifizierung über geheimen Token statt Bearer-Auth (Kalender-Clients schicken keine Header).
- **Token-Speicherort**: `users/{uid}/icalToken` — der User legt ihn selbst per "Mein Konto" → Kalender-Abo an. Bei Verdacht auf Weitergabe: "Link rotieren" generiert einen neuen, der alte ist sofort tot.
- **Direkt-Download** via `downloadIcalOnce()` baut das ICS clientseitig aus den bereits geladenen Buchungen (kein Server-Roundtrip nötig).
- **Rules-Anpassung**: `users/$uid` ist jetzt für den eigenen User lesbar+schreibbar (vorher komplett gesperrt). Daher: nach Rules-Update **VF-Credentials weiterhin nur über Backend** (sind verschlüsselt) — der User darf seine eigenen Felder sehen, das ist OK.

## Nachrichten (Team → Fluglehrer)

Modul `shared/messages.js` (`DASSU_MESSAGES`). **Ein Kanal, eine Richtung:** Team/Admin senden Nachrichten **+ Dateien** an Fluglehrer; Fluglehrer **lesen nur**.
- **Knoten:** `/messages/{id} = { title, body, target, createdAt, createdBy, createdByName, createdByRole, files[], readBy{uid:ts} }`.
- **`target`** = Empfängergruppe: `'all'` (alle Fluglehrer) · `'glider'` (Segelfluglehrer) · `'motor'` (Motorfluglehrer).
- **API:** `sendMessage(title, body, target, files, name)` (nur Team/Admin), `getMessages(limit)`, `markRead(id, uid)`, `deleteMessage(id)` (nur Admin).
- **Rules** (`database.rules.json`): Senden = Team/Admin, Lesen = alle Staff, Löschen = Admin, `readBy/$uid` nur durch den jeweiligen User. Hinweis: Die Gruppen-Zuordnung (`target`) ist **Relevanz-Filterung im Client, keine harte Geheimhaltung** — ein anderer Fluglehrer könnte per Direktzugriff fremde Gruppen-Nachrichten lesen. Reicht für interne Infos; bei echter Geheimhaltung müsste man pro Gruppe trennen.
- **Lese-Protokoll (Kernfeature):** Sender sieht je Nachricht, **wer wann gelesen hat** (Name + Zeitstempel) und wer noch nicht. UID→Name über `staffUsers`. Lesen = Öffnen des Detail-Dialogs → `readBy/{uid}` mit Zeitstempel.
- **UI:** staff.html (Tab „Nachrichten", **Team + Admin**) = senden mit Zielgruppe + Dateien + „Lese-Protokoll anzeigen". index.html (Tab „Nachrichten", **nur guestGlider/guestMotor**) = lesen + Dateien laden. **Wichtig:** Der Tab wird in index.html im echten Login nur für `guestGlider`/`guestMotor` eingeblendet (real-auth-Block ~Z. 7820) — Team/Admin nutzen staff.html.
- **Anhänge:** Firebase Storage unter `messages/{id}/…` (**Storage-Rules liegen NUR in der Firebase Console**, nicht im Repo).

## Dateistruktur

- `index.html` — Kunden-/Mitglieder-Ansicht (Buchungskalender, Login, Buchung erstellen)
- `staff.html` — Staff/Admin-Ansicht (Übersicht, Buchungsverwaltung, Zeiterfassung, Vereinsflieger-Sync)
- `welcome.html` — Staff-Login / Einladungs-Landingpage (Design auf Cream/Alpine angeglichen)
- `impressum.html` — statisches Impressum (DSGVO-Pflichtangaben). **Enthält Platzhalter `[BITTE ERGÄNZEN: …]` für Vorstandsnamen, Vereinsregister, USt-IdNr.**
- `datenschutz.html` — statische Datenschutzerklärung (DSGVO Art. 13)
- `robots.txt` — sperrt staff.html, welcome.html, /.netlify/ und SW/Manifest vom Crawling
- `shared/auth.js` — Firebase Auth (gemeinsam genutzt)
- `shared/permissions.js` — Rechte-System. **Kanonische Rollen (genau diese 5, projektweit):** `admin` (Admin), `team` (Team = Staff), `guestGlider` (**Segelfluglehrer**), `guestMotor` (**Motorfluglehrer**), plus Kunden (`customers`, kein staffUsers-Eintrag). Die internen Schlüssel (`guestGlider`/`guestMotor`) bleiben aus Daten-Kompatibilität, angezeigt werden überall die kanonischen Namen via `roleMeta().label`. `staff` ist nur ein unsichtbarer Legacy-Alias für `team`. Alt-Rollen (vorstand/flugleiter/member/fluglehrer) wurden entfernt — nicht wieder einführen.
- `shared/trainings.js` — Liste der 12 DASSU-Ausbildungen
- `deploy.command` — Shell-Skript für Git commit + push
- `netlify.toml` — Netlify-Konfiguration (esbuild, functions)
- `sw.js`, `firebase-messaging-sw.js` — Service Worker / Push Notifications
- `manifest.json` — PWA Manifest (zeigt auf `/` als Kunden-App, Theme-Color `#1E4B4E`)
- `.github/workflows/ci.yml` — GitHub Actions CI (Vitest + Function-Syntax-Check). Blockiert NICHT das Netlify-Deployment.

### Netlify Functions (`netlify/functions/`)
- `send-push.js` — Push-Benachrichtigungen
- **`send-booking-mail.js`** — versendet ALLE transaktionalen Mails über Brevo SMTP (Büro-Benachrichtigung, Eingangsbestätigung, Status-/Storno-Mail, Schnellbuchungs-Bestätigung, Staff-Einladung). Ersetzt den früheren clientseitigen EmailJS-Versand (200 Mails/Monat zu wenig bei ~800 Mitgliedern). **Thin Relay**: das gebrandete HTML wird weiterhin im Frontend gebaut (User-Input dort bereits per `escapeHtml()` escaped) und nur serverseitig verschickt. Frontend-Helfer: `sendBrevoMail({to, subject, html, replyTo})` in `index.html` + `staff.html`. **Sicherheit gegen Spam-Relay-Missbrauch**: gültiger Firebase-Token Pflicht; Nicht-Staff dürfen NUR an die eigene Token-Adresse oder `info@dassu.de` senden, Staff (Eintrag in `/staffUsers`) an beliebige Empfänger; genau ein Empfänger pro Call (kein Komma/CRLF). Nutzt dieselben Env-Vars wie `send-verification.js` (`BREVO_SMTP_USER/PASS`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_DATABASE_URL`) — keine neuen Secrets.
- `send-verification.js`, `send-reset-email.js` — E-Mail-Verifizierung / Passwort-Reset über Brevo SMTP.
- `vereinsflieger-sync.js` — Vereinsflieger-API Sync. **Staff-Actions (Statistik, Jahresvergleich, Listen) nutzen die PERSÖNLICHEN VF-Zugangsdaten des eingeloggten Admins** (verschlüsselt in `users/{uid}/vfCredentials`). Jeder Admin muss sein VF-Konto einmal im Konto-Bereich (index.html) verknüpfen. Kein zentrales VF-Konto mehr.
  - **DASSU-Flotten-Whitelist**: Alle Flüge werden in `vfGetFlightsDateRange()` zentral auf die Flotte (`DASSU_FLEET` Set, ganz oben in der Datei) gefiltert — Quelle ist <https://www.dassu.de/flotte>. Fremdflugzeuge, Schleppmaschinen (D-E…), Hubschrauber etc. tauchen nirgendwo in Statistik/Listen auf. **Verkaufte Flugzeuge bleiben in der Liste** (im "Historisch / verkauft"-Block), damit Vorjahres-Vergleiche stimmen. **Neue Vereinsflugzeuge ergänzen** und Funktion neu deployen.
- `backup-database.js`, `error-report.js` — geplante Funktionen (Backup, Fehler-Report)
- `package.json` — Dependencies (firebase-admin, nodemailer)

## Tech-Stack
- Reines HTML/CSS/JS (kein Framework, kein Build-Schritt)
- Firebase Realtime Database + Firebase Auth
- Netlify (Hosting + Serverless Functions)
- SheetJS (xlsx.full.min.js) — für Zeiterfassungs-Excel-Export + Statistik-Export in staff.html
- jsPDF + jspdf-autotable (CDN) — für gebrandeten Statistik-PDF-Export in staff.html
- **Statistik-Export**: `exportStatsExcel()` (generisches DOM-Scraping: KPI-Kacheln, Balken-Charts, Tabellen des aktiven Sub-Tabs → mehrblättriges .xlsx) und `exportStatsPdf()` (jsPDF + autoTable → gebrandetes PDF mit Kopf-/Fußzeile, KPIs + Charts + Tabellen des aktiven Sub-Tabs, direkter Download). Buttons in der Statistik-Kopfzeile.

## Wichtige Hinweise
- Firebase Web-API-Keys sind öffentlich/client-seitig → Secret-Scanner ist in netlify.toml deaktiviert
- Sprache im Code: Deutsch (Variablen/Kommentare gemischt DE/EN)
- Philipp ist Admin und Hauptentwickler

## Dev-Toolbar / Superadmin-Mode

- Die DEV-Toolbar am unteren Bildschirmrand (Perspektiv-Switcher Kunde / Gast Segel / Gast Motor / Team / Admin) ist standardmäßig **für niemanden sichtbar** — auch nicht für normale Admins.
- Aktivierung pro User: in Firebase Console → Realtime Database → `staffUsers/<uid>/permissions/devTools = true` setzen.
- Bedingung: `?dev=1` in der URL **plus** `permissions.devTools === true` auf dem eigenen Staff-User-Eintrag. Beides muss zusammenkommen.
- Auswahllogik in `shared/permissions.js` → `hasDevTools(user)` (geht bewusst NICHT durch den Admin-Hard-Override von `hasPermission`).
- Im Mitglieder-Tab des Admin-UIs taucht dieser Permission-Key absichtlich **NICHT** auf — er soll versteckt bleiben und nicht versehentlich vergeben werden.

## Pre-Launch / Operations-Hinweise

### Vor jedem Launch / Update
- **Impressum-Platzhalter** in `impressum.html` einmalig durch echte Daten ersetzen (Vorstand, Register, USt-IdNr, Verantwortlich i.S.d. § 18 Abs. 2 MStV).
- **Datenschutz-Stand-Datum** in `datenschutz.html` setzen.
- **Backup-Restore einmal getestet?** Mind. einmal vor Go-Live: JSON-Backup aus Mail laden + in Firebase Console importieren (Test-Pfad), nicht produktiv überschreiben.
- **Mail-Versand läuft über Brevo** (`send-booking-mail.js` + `send-verification.js` + `send-reset-email.js`). Free-Tier 300 Mails/Tag (~9.000/Monat). Bei Annäherung ans Limit: Brevo-Dashboard prüfen, ggf. kostenpflichtiges Paket. **SPF/DKIM/DMARC für dassu.de sind bereits gesetzt** (SPF `include:spf.brevo.com`, DKIM `brevo1/brevo2._domainkey`, DMARC `p=none`) — bei Domain-/Mailhoster-Wechsel neu prüfen.

### Custom-Domain (z. B. kalender.dassu.de)
- Wenn umgestellt: **9 Functions** in `netlify/functions/` haben `ALLOWED_ORIGIN = 'https://dassu-buchungskalender.netlify.app'` hartcodiert. Alle parallel ändern.
- Auch: `manifest.json` `start_url` + `scope`, `robots.txt` Sitemap-URL, evtl. iCal-Feed-URL in den Bestandsabos der User (alte Links funktionieren nicht mehr — User muss neu erzeugen).

### Bekannte Lücken (Roadmap)
- **Push-Benachrichtigungen für Kunden** — VAPID/getToken sind aktuell nur in staff.html eingebaut. Kunden bekommen nur Mail.
- **Storno-per-Token-Flow** — Schnellbuchungen mit Empfänger-Mail erzeugen einen `cancelToken` (6 Zeichen). Frontend-Stelle, die diesen Token entgegennimmt und die Buchung storniert, ist noch nicht gebaut. Mail nennt den Code, aber der Pilot kann ihn aktuell nicht einlösen.
- **Sentry / Live-Error-Alerting** fehlt. Aktuell nur tägliche Mail aus `error-report.js`.
