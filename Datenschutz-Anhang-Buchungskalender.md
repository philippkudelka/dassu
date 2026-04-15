# Datenschutz-Anhang: DASSU Buchungskalender & Staff-App

**Stand:** 15. April 2026

> Dieser Text ist ein fachlich aufbereiteter **Entwurf**, der in die bestehende Datenschutzerklärung auf dassu.de aufgenommen werden sollte. Er erhebt keinen Anspruch auf Rechtssicherheit und sollte vor Veröffentlichung durch eine datenschutzrechtlich qualifizierte Person (Anwalt/DSB) final geprüft werden.

---

## 1. Anwendungsbereich

Dieser Abschnitt ergänzt die allgemeine Datenschutzerklärung der Deutschen Alpensegelflugschule Unterwössen e.V. (DASSU) um die Verarbeitung personenbezogener Daten durch unseren Online-Buchungskalender (dassu-buchungskalender.netlify.app) und die zugehörige Staff-App.

## 2. Verantwortliche Stelle

Deutsche Alpensegelflugschule Unterwössen e.V.
Windseestr. 45, 83246 Unterwössen
Telefon: +49 8641 698787
E-Mail: info@dassu.de

## 3. Verarbeitete Kategorien personenbezogener Daten

### 3.1 Charterkunden / Flugschüler (Öffentlicher Buchungskalender)
- Name
- E-Mail-Adresse
- Telefonnummer
- Buchungsdetails: Flugzeugkennzeichen, Datum, Uhrzeit, Angabe ob mit Fluglehrer
- Optional: freier Kommentartext zur Buchung
- Buchungsstatus (angefragt / bestätigt / abgelehnt)

### 3.2 Mitarbeiter / Lehrer (Staff-App)
- Name
- E-Mail-Adresse (Login)
- Rolle (Admin, DASSU Team, Gastfluglehrer Segelflug, Gastfluglehrer Motor/UL)
- Zugewiesene Rechte
- Geräte-Token für Push-Benachrichtigungen (technische Kennung, kein Klartext)

### 3.3 Theoriestunden-Erfassung
- Name des Schülers (Freitext)
- Zugeordneter Lehrer (verknüpft mit Mitarbeiter-Account)
- Datum, Uhrzeit (Von/Bis), berechnete Dauer
- Thema/Inhalt der Stunde
- Optionale Notiz

## 4. Zweck der Verarbeitung

- **3.1 Buchungsdaten:** Vertragsanbahnung und -abwicklung (Charter, Flugschulung), Kontaktaufnahme zur Bestätigung
- **3.2 Mitarbeiter-Daten:** Authentifizierung, Rollen-/Rechteverwaltung, Benachrichtigungen über neue Buchungen
- **3.3 Theoriestunden:** Dokumentation der erbrachten Unterrichtsleistung, Grundlage für Abrechnung (interne Lehrervergütung bzw. Rechnungsstellung gegenüber Schülern)

## 5. Rechtsgrundlage

- Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) für Buchungsdaten und Theoriestunden von Schülern
- Art. 6 Abs. 1 lit. b DSGVO bzw. § 26 BDSG (Beschäftigungsverhältnis) für Mitarbeiter-Daten
- Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse) für Push-Benachrichtigungen, Fehlerdiagnose und Betrieb der Anwendung

## 6. Auftragsverarbeiter und Empfänger

Die Verarbeitung der Daten findet auf Servern folgender Dienstleister statt. Mit allen genannten Dienstleistern besteht ein Auftragsverarbeitungsvertrag (AVV) gemäß Art. 28 DSGVO:

### 6.1 Google Firebase (Google LLC / Google Ireland Ltd.)
- **Dienste:** Firebase Authentication, Firebase Realtime Database (Serverstandort: Belgien, europe-west1), Firebase Cloud Messaging (Push)
- **Zweck:** Speicherung und Abruf aller oben genannten Daten, Login-Verwaltung, Push-Benachrichtigungen
- **Rechtsgrundlage Drittland-Transfer:** Google Ireland Ltd. ist Vertragspartner; Datenverarbeitung in der EU. Für etwaige Zugriffe durch Google LLC (USA) greifen die EU-Standardvertragsklauseln (SCC) und Googles zusätzliche technische Schutzmaßnahmen.
- **AVV:** https://cloud.google.com/terms/data-processing-addendum

### 6.2 EmailJS (EmailJS LLC, USA)
- **Dienste:** Versand von Benachrichtigungs-E-Mails (Buchungsbestätigungen, Mitarbeiter-Einladungen) über die DASSU-Exchange-Infrastruktur (info@dassu.de)
- **Verarbeitete Daten:** Empfänger-E-Mail-Adresse, Empfänger-Name, Buchungs- bzw. Einladungs-Inhalt
- **AVV und SCC:** https://www.emailjs.com/legal/dpa

### 6.3 Netlify (Netlify, Inc., USA)
- **Dienst:** Hosting der Website und der Staff-App
- **Verarbeitete Daten:** Server-Log-Daten (IP-Adresse, User-Agent, aufgerufene URL, Zeitstempel); keine anwendungs-fachlichen Daten
- **AVV und SCC:** https://www.netlify.com/gdpr-ccpa/

Die Einbindung des DASSU-Logos erfolgt über den Squarespace-CDN (Squarespace Inc., USA). Hierbei kann Squarespace die IP-Adresse des Besuchers erfassen. Keine anwendungs-fachlichen Daten werden übertragen.

## 7. Dauer der Speicherung

| Daten | Speicherdauer |
|---|---|
| Buchungsanfragen (abgelehnt / nicht durchgeführt) | bis zum Ende des laufenden Geschäftsjahres + 1 Jahr |
| Durchgeführte Buchungen | 10 Jahre (handels- und steuerrechtliche Aufbewahrungsfrist nach § 257 HGB, § 147 AO) |
| Theoriestunden | 10 Jahre (Abrechnungsunterlage) |
| Mitarbeiter-Zugänge | Dauer der Tätigkeit + 3 Jahre nach Austritt |
| Push-Benachrichtigungs-Token | bis zur Abmeldung oder 90 Tage Inaktivität |
| Server-Log-Daten (Netlify) | 30 Tage |

Nach Ablauf der jeweiligen Frist werden die Daten gelöscht oder anonymisiert.

## 8. Rechte der betroffenen Personen

Sie haben nach DSGVO folgende Rechte:
- Recht auf Auskunft (Art. 15)
- Recht auf Berichtigung (Art. 16)
- Recht auf Löschung (Art. 17), soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen
- Recht auf Einschränkung der Verarbeitung (Art. 18)
- Recht auf Datenübertragbarkeit (Art. 20)
- Widerspruchsrecht (Art. 21)
- Recht auf Beschwerde bei einer Aufsichtsbehörde (Art. 77); in Bayern: Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach

Zur Wahrnehmung dieser Rechte genügt eine formlose E-Mail an info@dassu.de.

## 9. Push-Benachrichtigungen

Mitarbeiter können nach dem Login in der Staff-App der Aktivierung von Push-Benachrichtigungen zustimmen. Dabei wird über den Browser bzw. das Betriebssystem des Geräts ein eindeutiger Push-Token generiert und bei Firebase Cloud Messaging hinterlegt. Die Zustimmung kann jederzeit über die Browser- bzw. Geräte-Einstellungen widerrufen werden. Der Token wird nach Widerruf automatisch invalidiert.

## 10. Keine automatisierte Entscheidungsfindung

Es erfolgt keine automatisierte Entscheidungsfindung im Sinne des Art. 22 DSGVO. Entscheidungen über Annahme oder Ablehnung einer Buchung werden ausschließlich durch Mitarbeiter der DASSU getroffen.

## 11. Datensicherheit

Der Zugriff auf personenbezogene Daten ist durch individuelle Benutzerkonten mit Passwort-Authentifizierung (Firebase Authentication) geschützt. Die Datenübertragung erfolgt ausschließlich verschlüsselt (HTTPS/TLS). Die Firebase-Datenbank ist so konfiguriert, dass nur authentifizierte Nutzer Daten lesen oder schreiben können; öffentlich zugänglich sind lediglich die für die Buchungsübersicht notwendigen Informationen.

---

## Technische Hinweise für DSB / interne Dokumentation (nicht zur Veröffentlichung)

- **Admin-Passwort der Website:** Wird derzeit in Klartext in der Firebase-Datenbank gespeichert. Empfehlung: Migration auf Firebase Auth oder Hashing + strikte Rules.
- **Firebase Rules:** Öffentlicher Lesezugriff auf bookings, settings, staffUsers, dailyNotes (technisch erforderlich für öffentlichen Buchungskalender). Schreibender Zugriff ist für diese Pfade eingeschränkt. Alle übrigen Pfade (invitations, theoryLessons, audit, pushTokens) erfordern Authentifizierung.
- **Datensparsamkeit:** Freitext-Felder (Thema, Notiz in Theoriestunden) können personenbezogene Gesundheits- oder Beziehungsdaten enthalten — Lehrer sollten per interner Anweisung darauf hingewiesen werden, nur unterrichts-relevante Inhalte einzutragen.
- **Backup / Wiederherstellung:** Firebase bietet Point-in-Time-Recovery im Pro-Tarif; sollte aktiviert werden.
- **Löschkonzept:** Automatische Löschung nach den in Abschnitt 7 genannten Fristen ist aktuell **nicht implementiert** — muss als Wartungs-Job nachgerüstet werden (z.B. Netlify Scheduled Function, die monatlich prüft und löscht).
