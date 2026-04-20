# DASSU Buchungskalender

## Projekt-Überblick
Buchungskalender-Web-App für den Flugsportverein DASSU. Gehostet auf Netlify, Daten in Firebase Realtime Database, Auth über Firebase Authentication.

Live: https://dassu-buchungskalender.netlify.app
GitHub: https://github.com/philippkudelka/dassu.git

## Deployment

**WICHTIG: Deploy läuft über `deploy.command` im Finder (Doppelklick).**

Das Skript macht automatisch: git add, commit, push → Netlify baut dann automatisch.
Ablauf in Claude: Finder öffnen → `deploy.command` doppelklicken → fertig.
Die Bash-Sandbox hat KEINEN GitHub-Zugriff (403 Proxy-Fehler). Niemals versuchen, `git push` aus der Sandbox zu machen.

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
- `vereinsflieger-sync.js` — Vereinsflieger-API Sync
- `package.json` — Dependencies (firebase-admin)

## Tech-Stack
- Reines HTML/CSS/JS (kein Framework, kein Build-Schritt)
- Firebase Realtime Database + Firebase Auth
- Netlify (Hosting + Serverless Functions)
- SheetJS (xlsx.full.min.js) — NUR für Zeiterfassungs-Excel-Export in staff.html, NICHT für Google Sheet Sync

## Wichtige Hinweise
- Firebase Web-API-Keys sind öffentlich/client-seitig → Secret-Scanner ist in netlify.toml deaktiviert
- Sprache im Code: Deutsch (Variablen/Kommentare gemischt DE/EN)
- Philipp ist Admin und Hauptentwickler
