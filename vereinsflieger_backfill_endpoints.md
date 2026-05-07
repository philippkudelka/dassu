# Vereinsflieger Abend-Backfill – Ermittelte Endpoints

Stand: 2026-05-07, reverse-engineered aus `flightlogliveimport.js` und `editflightlogheader.js`

## Ergebnis der Recherche

**Die VF REST API (`/interface/rest/`) hat KEINE Endpoints für:**
- Flug anlegen / duplizieren
- OGN-Tracks listen / verknüpfen / löschen
- Flugbuch-Einträge bearbeiten

**Alle Backfill-relevanten Aktionen laufen über die Web-UI** (Session-basiert, Cookie-Auth), nicht über die REST API.

---

## Ermittelte Web-UI-Endpoints

Alle URLs relativ zu `https://www.vereinsflieger.de/member/flightdataentry/`

### 1. OGN-Track → Neuen Flug anlegen (ohne Crew)
```
GET flightlog.php?action=add&source=3&sourceid={ognId}
```
- JS-Funktion: `onclickAdd(sourceid, 3)`
- Confirm-Dialog: "Ausgewählter Datensatz als neuen Flug anlegen?"
- Macht Page-Redirect (kein AJAX)
- Erstellt einen neuen Flugbuch-Eintrag aus dem OGN-Track

### 2. OGN-Track → Mit vorhandenem Flug verknüpfen
```
Schritt 1 (Dialog öffnen):
GET linkflightlogliveimport?source=3&sourceid={ognId}
→ Lädt in iframe (inlineDialog.show), zeigt offene Flüge desselben Lfz.

Schritt 2 (Verbinden-Button im Dialog):
→ Noch nicht ermittelt (erfordert unverknüpfte OGN-Tracks)
```
- JS-Funktion: `onclickLink(sourceid, 3)`
- Öffnet Inline-Dialog "OGN-Eintrag mit vorhandenem Flug verbinden"
- Im Dialog: Liste offener (gelber) Flüge für dasselbe Lfz., "Verbinden"-Button

### 3. OGN-Track → Aus Liste entfernen (verwerfen)
```
GET flightlog.php?action=delete&source=3&sourceid={ognId}
```
- JS-Funktion: `onclickDelete(sourceid, 3)`
- Confirm-Dialog: "Soll der ausgewählte Datensatz aus der Liste entfernt werden?"
- Page-Redirect

### 4. Flug duplizieren (Create-as-Copy)
```
GET addflight.php?flid_copy={flid}
```
- JS-Funktion: `onClickDuplicateFlight(parent)` (nutzt globale `selected_rowid`)
- Öffnet das Flug-Formular mit vorausgefüllten Daten der Vorlage
- Crew, Lfz., Startart, Flugart, Startort, Landeort werden übernommen
- Zeiten bleiben leer → "gelber" (offener) Flug

### 5. OGN-Tabelle: Automatische Verknüpfung
```
AJAX: flightlogliveimport?autolink=1    (alle OGN-Tracks automatisch zuordnen)
AJAX: flightlogliveimport?autoimport=1   (alle OGN-Tracks automatisch übernehmen)
AJAX: flightlogliveimport?autoimport=0&autolink=0  (Automatik aus)
```
- Geladen via `vfbase.loadContent("divliveimport", url)`
- Ersetzt den Inhalt des OGN-Panels

### 6. OGN-Tabelle: Liste aktualisieren
```
AJAX: flightlogliveimportlist
```
- Geladen via `vfbase.loadContent('liveimportlist', url)`
- Auto-Refresh alle ~60 Sekunden (wenn Maus bewegt wird)

---

## OGN-Track-Datenstruktur (aus DOM)

Jeder OGN-Track hat eine `sourceid` (z.B. `12746129`) und `source=3`.

Sichtbare Felder in der OGN-Tabelle:
- Quelle (z.B. "OGN")
- Lfz. (z.B. "D-MYUW")
- Start (UTC-Zeit)
- Landung (UTC-Zeit)
- Schlepp (bei F-Schlepp)

Symbole pro Track:
- **Unverknüpft (4 Symbole):** ← (Add), 🔗 (Link), ✕ (Delete), ✈ (Karte)
- **Verknüpft (2 Symbole):** ✕ (Delete), ✈ (Karte)

---

## Implementierungs-Optionen für die Staff-App

### Option A: Web-Session-Proxy (empfohlen)
Eine Netlify-Funktion, die sich per Web-Login (nicht REST-API) bei Vereinsflieger einloggt und dann die Web-UI-Endpoints aufruft.

**Vorteile:** Nutzt genau die gleichen Aktionen wie die manuelle UI
**Nachteile:** Fragil (HTML-Parsing, Session-Cookies), kann bei VF-Updates brechen

**Ablauf:**
1. POST-Login auf `vereinsflieger.de/member/overview.php` → Session-Cookie erhalten
2. `GET flightlog.php` → HTML parsen, Flugbuch-Einträge + OGN-Tabelle extrahieren
3. Backfill-Logik: Pro Lfz. mit unverknüpften OGN-Tracks:
   a. `GET addflight.php?flid_copy={flid}` → Formular parsen → POST abschicken → neuer gelber Flug
   b. `GET linkflightlogliveimport?source=3&sourceid={ognId}` → offene Flüge parsen → "Verbinden"-POST
4. Ergebnis an Staff-App zurückgeben

### Option B: Browser-Automatisierung
Die Staff-App öffnet Vereinsflieger im Browser und automatisiert die Klicks.

**Vorteile:** Keine HTML-Parsing-Logik nötig
**Nachteile:** Erfordert offenes Browser-Fenster, nicht serverless-fähig

### Option C: VF-Support kontaktieren
Bei Vereinsflieger nachfragen, ob es REST-API-Endpoints für:
- Flight Create/Edit
- OGN Track List/Link
gibt, die nicht öffentlich dokumentiert sind.

**Vorteile:** Saubere, stabile API
**Nachteile:** Eventuell nicht verfügbar, Wartezeit

---

## Neu ermittelte Endpoints (2026-05-07, Live-Test mit unverknüpftem D-1375 OGN-Track)

### 7. Verbinden-Flow (VOLLSTÄNDIG ERMITTELT)

**Schritt 1: Dialog laden**
```
GET linkflightlogliveimport?source=3&sourceid={ognId}
```
- Wird im `InlineDialogFrame`-iframe geladen
- Zeigt Tabelle "Offene Flüge von {Lfz.} am {Datum}" mit Button "Verbinden"

**Schritt 2: Verbinden ausführen**
```
GET linkflight?source=3&sourceid={ognId}&flid={flid}
```
- Kommt aus dem `onclick` des "Verbinden"-Buttons: `parent.location.href='linkflight?source=3&sourceid={ognId}&flid={flid}'`
- Ist ein **einfacher GET-Redirect** (kein POST!)
- Verknüpft den OGN-Track mit dem offenen Flug und überträgt die OGN-Zeiten

**Für die Netlify-Funktion genügt ein einziger GET-Call** an `linkflight?source=3&sourceid={ognId}&flid={flid}` — der iframe-Dialog ist nur UI-Dekoration.

### 8. Flug duplizieren (VOLLSTÄNDIG ERMITTELT)

```javascript
// JS-Funktion:
function onClickDuplicateFlight(parent) {
    if (TlbItem9.display == 'none' && TlbItem10.display == 'none') {
        baselist.navigate('addflight.php?flid_copy=' + selected_rowid);
    } else {
        show(parent, 'menu_copy');
    }
}
```

**Endpoint:**
```
GET addflight.php?flid_copy={flid}
```
- Lädt ein vorbelegtes Flug-Formular (Crew, Lfz., Startart, Flugart übernommen)
- Zeiten bleiben leer → neuer "gelber" Flug
- Formular muss anschließend per POST abgeschickt werden
- Die Formular-Felder müssen aus dem HTML geparst werden

### Zusammenfassung: Kompletter Backfill-Flow für die Netlify-Funktion

1. **Web-Login** → Session-Cookie erhalten
2. **GET flightlog.php** → HTML parsen:
   - Linke Tabelle: Flugbuch-Einträge (flid, Lfz., Pilot, Start, Landung)
   - Rechte Tabelle: OGN-Tracks (sourceid, Lfz., Start, Landung, verknüpft/unverknüpft)
3. **Pro Lfz. mit unverknüpften OGN-Tracks** (Cutoff-Heuristik beachten):
   a. Falls kein offener Flug: `GET addflight.php?flid_copy={flid}` → Formular parsen → POST → neuer gelber Flug mit flid
   b. `GET linkflight?source=3&sourceid={ognId}&flid={flid}` → Track verknüpft, Flug wird grün
   c. Wiederholen bis alle relevanten Tracks verknüpft

## Erledigte offene Punkte

~~1. Der "Verbinden"-POST~~ → Ist ein GET: `linkflight?source=3&sourceid={ognId}&flid={flid}`
~~2. Der POST beim Flug-Duplizieren~~ → GET `addflight.php?flid_copy={flid}` + Formular-POST (Felder aus HTML)

## Noch offen

1. **Web-Login-Mechanismus:** Wie bekommt die Netlify-Funktion ein gültiges Session-Cookie? (Ggf. über `POST /member/` mit Username+Password als Form-Data.)
2. **addflight.php Formular-Felder:** Die genauen POST-Parameter beim Abschicken des Duplikat-Formulars. Kann beim ersten echten Backfill-Test ermittelt werden.
