/**
 * Netlify Serverless Function: Vereinsflieger Abend-Backfill
 *
 * Web-Session-Proxy: Loggt sich über die VF Web-UI ein (Cookie-Auth)
 * und führt Backfill-Aktionen aus, die über die REST API nicht möglich sind:
 * - Flugbuch + OGN-Tracks auslesen (HTML-Parsing)
 * - Flüge duplizieren (Create-as-Copy)
 * - OGN-Tracks mit Flügen verknüpfen
 *
 * Umgebungsvariablen:
 *   VF_WEB_USERNAME  – Web-Login Benutzername (oder VF_USERNAME als Fallback)
 *   VF_WEB_PASSWORD  – Web-Login Passwort (oder VF_PASSWORD als Fallback)
 */
// Kein cheerio — reines Regex/String-Parsing (esbuild-kompatibel)

const VF_WEB_BASE = 'https://www.vereinsflieger.de';
const VF_FLIGHT_BASE = VF_WEB_BASE + '/member/flightdataentry';

// ---- CORS Headers ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function ok(data) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data }) };
}
function fail(msg, code = 500) {
  return { statusCode: code, headers: CORS, body: JSON.stringify({ ok: false, error: msg }) };
}

// ---- Web-Session helpers ----

/**
 * Extrahiert Set-Cookie Headers und gibt ein Cookie-String zurück.
 * Merged bestehende Cookies mit neuen.
 */
function mergeCookies(existingCookieStr, response) {
  const cookies = {};
  // Parse existing
  if (existingCookieStr) {
    existingCookieStr.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      if (k) cookies[k.trim()] = v.join('=');
    });
  }
  // Parse Set-Cookie headers
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  setCookies.forEach(sc => {
    const [pair] = sc.split(';');
    const [k, ...v] = pair.split('=');
    if (k) cookies[k.trim()] = v.join('=');
  });
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Web-Login bei Vereinsflieger. Gibt Session-Cookies zurück.
 */
async function webLogin() {
  const username = process.env.VF_WEB_USERNAME || process.env.VF_USERNAME;
  const password = process.env.VF_WEB_PASSWORD || process.env.VF_PASSWORD;
  if (!username || !password) {
    throw new Error('VF_WEB_USERNAME/VF_WEB_PASSWORD (oder VF_USERNAME/VF_PASSWORD) nicht konfiguriert');
  }

  // Schritt 1: Login-Seite laden um initiale Cookies + ggf. CSRF-Token zu bekommen
  const loginPageRes = await fetch(VF_WEB_BASE + '/member/', {
    method: 'GET',
    redirect: 'manual',
    headers: { 'User-Agent': 'DASSU-StaffApp/1.0' }
  });
  let cookies = mergeCookies('', loginPageRes);

  // Schritt 2: Login-POST
  const loginRes = await fetch(VF_WEB_BASE + '/member/', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'DASSU-StaffApp/1.0'
    },
    body: new URLSearchParams({
      user: username,
      pwinput: password,
      submit: 'Anmelden'
    }).toString()
  });

  cookies = mergeCookies(cookies, loginRes);

  // Prüfe ob Login erfolgreich (Redirect zu overview oder 302)
  const location = loginRes.headers.get('location') || '';
  if (loginRes.status === 200) {
    // Möglicherweise direkt auf der Seite geblieben → Login-Fehler
    const body = await loginRes.text();
    if (body.includes('Anmeldung fehlgeschlagen') || body.includes('falsches Passwort')) {
      throw new Error('VF Web-Login fehlgeschlagen: Falsches Passwort');
    }
    // Evtl. trotzdem eingeloggt
  }

  // Folge Redirects manuell um alle Cookies zu sammeln
  if (loginRes.status >= 300 && loginRes.status < 400 && location) {
    const redirectUrl = location.startsWith('http') ? location : VF_WEB_BASE + location;
    const followRes = await fetch(redirectUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'Cookie': cookies, 'User-Agent': 'DASSU-StaffApp/1.0' }
    });
    cookies = mergeCookies(cookies, followRes);
  }

  return cookies;
}

/**
 * Authentifizierter GET-Request
 */
async function webGet(url, cookies) {
  const fullUrl = url.startsWith('http') ? url : VF_FLIGHT_BASE + '/' + url;
  const res = await fetch(fullUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'Cookie': cookies,
      'User-Agent': 'DASSU-StaffApp/1.0'
    }
  });
  if (!res.ok) throw new Error(`GET ${url} fehlgeschlagen: ${res.status}`);
  return await res.text();
}

/**
 * Authentifizierter POST-Request (Form-Data)
 */
async function webPost(url, cookies, formData) {
  const fullUrl = url.startsWith('http') ? url : VF_FLIGHT_BASE + '/' + url;
  const res = await fetch(fullUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'DASSU-StaffApp/1.0'
    },
    body: new URLSearchParams(formData).toString()
  });
  if (!res.ok) throw new Error(`POST ${url} fehlgeschlagen: ${res.status}`);
  return await res.text();
}

// ---- HTML Parsing ----

// ---- HTML-Hilfsroutinen (kein cheerio nötig) ----

/** Entfernt HTML-Tags und gibt reinen Text zurück */
function stripTags(s) { return (s || '').replace(/<[^>]*>/g, '').trim(); }

/** Extrahiert alle <td>…</td> Inhalte aus einem TR-String */
function extractTds(trHtml) {
  const tds = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(trHtml)) !== null) tds.push(stripTags(m[1]));
  return tds;
}

/**
 * Parst die Flugbuch-Seite (flightlog.php) und extrahiert:
 * - flights: Array von {flid, callsign, pilot, attendant, start, landing, status, ...}
 * - ognTracks: Array von {sourceid, callsign, start, landing, linked}
 */
function parseFlightlogPage(html) {
  // --- Flugbuch-Einträge (linke Tabelle) ---
  const flights = [];
  const rowRe = /<tr[^>]*id="row(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const flid = rm[1];
    const cells = extractTds(rm[2]);
    if (cells.length < 10) continue;

    const callsign = cells[1];
    const pilot = cells[2];
    const attendant = cells[3];
    const start = cells[4];
    const landing = cells[5];
    const zeit = cells[6];
    const startart = cells[7];
    const flugart = cells[8];
    const isOpen = !start;

    flights.push({ flid, callsign, pilot, attendant, start, landing, zeit, startart, flugart, isOpen });
  }

  // --- OGN-Tracks (rechte Tabelle) ---
  const ognTracks = [];
  // Finde alle <tr> die onclickDelete(..., 3) enthalten
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tm;
  while ((tm = trRe.exec(html)) !== null) {
    const trContent = tm[1];
    const delMatch = trContent.match(/onclickDelete\((\d+),\s*3\)/);
    if (!delMatch) continue;

    const sourceid = delMatch[1];
    const hasLink = /onclickLink\(/.test(trContent);
    const hasAdd = /onclickAdd\(/.test(trContent);
    const linked = !hasLink && !hasAdd;

    // Lfz. und Zeiten aus der Zeile extrahieren
    const cells = extractTds(tm[0] || ('<tr>' + trContent + '</tr>'));
    let callsign = '', startTime = '', landTime = '';

    for (const text of cells) {
      if (/^D-[A-Z0-9]{3,5}$/.test(text)) callsign = text;
      if (callsign && !startTime && /^\d{2}:\d{2}$/.test(text)) startTime = text;
      else if (callsign && startTime && !landTime && /^\d{2}:\d{2}$/.test(text)) landTime = text;
    }

    // Fallback
    if (!callsign) {
      const csM = stripTags(trContent).match(/D-[A-Z0-9]{3,5}/);
      if (csM) callsign = csM[0];
    }
    if (!startTime) {
      const times = stripTags(trContent).match(/\d{2}:\d{2}/g) || [];
      if (times.length >= 1) startTime = times[0];
      if (times.length >= 2) landTime = times[1];
    }

    ognTracks.push({ sourceid, callsign, start: startTime, landing: landTime, linked });
  }

  return { flights, ognTracks };
}

/**
 * Parst das addflight.php Formular und extrahiert alle Felder.
 * Reines Regex-Parsing — kein cheerio nötig.
 */
function parseAddFlightForm(html) {
  // Erstes <form> finden
  const formMatch = html.match(/<form[\s\S]*?<\/form>/i);
  const formHtml = formMatch ? formMatch[0] : html;
  const fields = {};

  // <input> Felder
  const inputRe = /<input\s([^>]*?)>/gi;
  let im;
  while ((im = inputRe.exec(formHtml)) !== null) {
    const attrs = im[1];
    const name = (attrs.match(/name=["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
    const type = ((attrs.match(/type=["']([^"']+)["']/i) || [])[1] || 'text').toLowerCase();
    if (type === 'checkbox' && !/checked/i.test(attrs)) continue;
    if (type === 'submit' || type === 'button' || type === 'reset') continue;
    const value = (attrs.match(/value=["']([^"']*)["']/i) || [])[1] || '';
    fields[name] = value;
  }

  // <select> Felder — selected option
  const selRe = /<select\s[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  let sm;
  while ((sm = selRe.exec(formHtml)) !== null) {
    const name = sm[1];
    const opts = sm[2];
    const selectedMatch = opts.match(/<option[^>]*selected[^>]*value=["']([^"']*)["']/i);
    fields[name] = selectedMatch ? selectedMatch[1] : '';
  }

  // <textarea> Felder
  const taRe = /<textarea\s[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/textarea>/gi;
  let tam;
  while ((tam = taRe.exec(formHtml)) !== null) {
    fields[tam[1]] = stripTags(tam[2]);
  }

  return fields;
}

// ---- Backfill Logic ----

/**
 * Analysiert die geparsten Daten und erstellt einen Backfill-Plan.
 * Cutoff-Heuristik: Nur OGN-Tracks nach der letzten manuellen Flugzeit pro Lfz.
 */
function createBackfillPlan(flights, ognTracks) {
  const unlinkedTracks = ognTracks.filter(t => !t.linked && t.callsign);

  if (unlinkedTracks.length === 0) {
    return { tracks: [], message: 'Keine unverknüpften OGN-Tracks gefunden.' };
  }

  // Cutoff pro Lfz.: letzte Landing-Zeit eines abgeschlossenen Flugs
  const cutoffByCallsign = {};
  flights.forEach(f => {
    if (!f.isOpen && f.landing && f.callsign) {
      const current = cutoffByCallsign[f.callsign] || '00:00';
      if (f.landing > current) cutoffByCallsign[f.callsign] = f.landing;
    }
  });

  // Offene Flüge pro Lfz.
  const openFlightsByCallsign = {};
  flights.forEach(f => {
    if (f.isOpen && f.callsign) {
      if (!openFlightsByCallsign[f.callsign]) openFlightsByCallsign[f.callsign] = [];
      openFlightsByCallsign[f.callsign].push(f);
    }
  });

  // Letzter abgeschlossener Flug pro Lfz. (als Duplikat-Vorlage)
  const lastFlightByCallsign = {};
  flights.forEach(f => {
    if (!f.isOpen && f.callsign) {
      if (!lastFlightByCallsign[f.callsign] ||
          (f.landing || '') > (lastFlightByCallsign[f.callsign].landing || '')) {
        lastFlightByCallsign[f.callsign] = f;
      }
    }
  });

  // Plan erstellen
  const plan = [];
  const byCallsign = {};
  unlinkedTracks.forEach(t => {
    if (!byCallsign[t.callsign]) byCallsign[t.callsign] = [];
    byCallsign[t.callsign].push(t);
  });

  for (const [cs, tracks] of Object.entries(byCallsign)) {
    const cutoff = cutoffByCallsign[cs] || '00:00';
    // Nur Tracks nach dem Cutoff
    const relevantTracks = tracks
      .filter(t => t.start > cutoff)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    if (relevantTracks.length === 0) continue;

    const openFlights = openFlightsByCallsign[cs] || [];
    const templateFlight = lastFlightByCallsign[cs] || (openFlights.length > 0 ? openFlights[0] : null);

    for (let i = 0; i < relevantTracks.length; i++) {
      const track = relevantTracks[i];
      // Brauchen wir einen neuen gelben Flug?
      // Wenn schon ein offener Flug existiert, benutzen wir den für den ersten Track
      // Für alle weiteren Tracks brauchen wir eine neue Kopie
      let needsDuplicate;
      let targetFlid;

      if (i === 0 && openFlights.length > 0) {
        // Erster Track: Vorhandenen offenen Flug benutzen
        needsDuplicate = false;
        targetFlid = openFlights[0].flid;
      } else {
        // Neuen Flug duplizieren
        needsDuplicate = true;
        targetFlid = null; // wird nach dem Duplizieren gesetzt
      }

      plan.push({
        callsign: cs,
        track,
        needsDuplicate,
        targetFlid,
        templateFlid: templateFlight ? templateFlight.flid : null,
        crew: templateFlight ? { pilot: templateFlight.pilot, attendant: templateFlight.attendant } : null,
        cutoff
      });
    }
  }

  return { tracks: plan };
}

// ---- Actions ----

/**
 * Preview: Liest den aktuellen Stand und gibt den Backfill-Plan zurück.
 */
async function previewBackfill(cookies, date) {
  // Flugbuch-Seite laden (ggf. Datum setzen)
  let url = 'flightlog.php';
  if (date) {
    // VF nutzt ein Datumsformat — wir laden die Seite und setzen das Datum über den Referer/URL
    url = `flightlog.php?filterdate=${date}`;
  }

  const html = await webGet(url, cookies);

  // Session-Check: Sind wir noch eingeloggt?
  if (html.includes('Anmeldung') && html.includes('pwinput')) {
    throw new Error('VF-Session abgelaufen — bitte erneut einloggen');
  }

  const { flights, ognTracks } = parseFlightlogPage(html);
  const plan = createBackfillPlan(flights, ognTracks);

  return {
    flights: flights.map(f => ({
      flid: f.flid, callsign: f.callsign, pilot: f.pilot,
      attendant: f.attendant, start: f.start, landing: f.landing, isOpen: f.isOpen
    })),
    ognTracks: ognTracks.map(t => ({
      sourceid: t.sourceid, callsign: t.callsign,
      start: t.start, landing: t.landing, linked: t.linked
    })),
    plan: plan.tracks.map(p => ({
      callsign: p.callsign,
      ognSourceid: p.track.sourceid,
      ognStart: p.track.start,
      ognLanding: p.track.landing,
      needsDuplicate: p.needsDuplicate,
      targetFlid: p.targetFlid,
      templateFlid: p.templateFlid,
      crew: p.crew,
      cutoff: p.cutoff
    })),
    summary: {
      totalFlights: flights.length,
      totalOgnTracks: ognTracks.length,
      unlinkedTracks: ognTracks.filter(t => !t.linked).length,
      backfillActions: plan.tracks.length,
      duplicatesNeeded: plan.tracks.filter(p => p.needsDuplicate).length
    }
  };
}

/**
 * Execute: Führt den Backfill durch (Track für Track).
 */
async function executeBackfill(cookies, actions) {
  const results = [];

  for (const action of actions) {
    const { callsign, ognSourceid, needsDuplicate, targetFlid, templateFlid } = action;
    let flid = targetFlid;

    try {
      // Schritt 1: Ggf. Flug duplizieren
      if (needsDuplicate && templateFlid) {
        const formHtml = await webGet(`addflight.php?flid_copy=${templateFlid}`, cookies);

        if (formHtml.includes('Anmeldung') && formHtml.includes('pwinput')) {
          throw new Error('Session abgelaufen');
        }

        const formFields = parseAddFlightForm(formHtml);

        // Formular abschicken → neuer gelber Flug
        const resultHtml = await webPost('addflight.php', cookies, formFields);

        // Neuen flid aus der Antwort extrahieren (Regex-Parsing)
        let newFlid = null;
        const rowReExec = /<tr[^>]*id="row(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowReExec.exec(resultHtml)) !== null) {
          const rowFlid = rowMatch[1];
          const tds = extractTds(rowMatch[2]);
          if (tds.length < 5) continue;
          const rowCs = tds[1];
          const rowStart = tds[4];
          if (rowCs === callsign && !rowStart && (!newFlid || parseInt(rowFlid) > parseInt(newFlid))) {
            newFlid = rowFlid;
          }
        }

        if (!newFlid) {
          throw new Error(`Konnte neuen Flug für ${callsign} nicht finden nach Duplizieren`);
        }

        flid = newFlid;
        results.push({
          callsign, ognSourceid, step: 'duplicate',
          success: true, newFlid: flid,
          message: `Flug dupliziert → flid ${flid}`
        });
      }

      // Schritt 2: OGN-Track verknüpfen
      if (!flid) {
        throw new Error(`Kein Ziel-Flug (flid) für ${callsign} OGN ${ognSourceid}`);
      }

      const linkHtml = await webGet(
        `linkflight?source=3&sourceid=${ognSourceid}&flid=${flid}`,
        cookies
      );

      // Prüfe ob die Seite wieder das Flugbuch zeigt (Erfolg)
      if (linkHtml.includes('Anmeldung') && linkHtml.includes('pwinput')) {
        throw new Error('Session abgelaufen beim Verknüpfen');
      }

      results.push({
        callsign, ognSourceid, step: 'link',
        success: true, flid,
        message: `OGN ${ognSourceid} → Flug ${flid} verknüpft`
      });

    } catch (err) {
      results.push({
        callsign, ognSourceid,
        success: false,
        message: err.message
      });
      // Weiter mit dem nächsten Track (nicht abbrechen)
    }
  }

  return results;
}

// ---- Handler ----

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return fail('Nur POST erlaubt', 405);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return fail('Ungültiges JSON', 400);
  }

  const { action } = body;

  try {
    // Login
    const cookies = await webLogin();

    switch (action) {
      case 'preview': {
        // Vorschau: Zeigt den Backfill-Plan ohne etwas zu ändern
        const date = body.date; // optional, Format: DD.MM.YYYY
        const preview = await previewBackfill(cookies, date);
        return ok(preview);
      }

      case 'execute': {
        // Backfill ausführen
        const { actions: backfillActions } = body;
        if (!backfillActions || !Array.isArray(backfillActions) || backfillActions.length === 0) {
          return fail('Keine Aktionen angegeben', 400);
        }
        const results = await executeBackfill(cookies, backfillActions);
        const succeeded = results.filter(r => r.success && r.step === 'link').length;
        const failed = results.filter(r => !r.success).length;
        return ok({
          results,
          summary: { total: backfillActions.length, succeeded, failed }
        });
      }

      case 'debug': {
        // Debug: Zeigt die rohe HTML-Struktur der Flugbuch-Seite
        const date = body.date;
        let url = 'flightlog.php';
        if (date) url = `flightlog.php?filterdate=${date}`;
        const html = await webGet(url, cookies);

        const hasLiveimportlist = html.includes('liveimportlist');
        const hasDiv158 = html.includes('div158');
        const hasImportOgn = html.includes('import_ogn');
        const onclickDeleteCount = (html.match(/onclickDelete/g) || []).length;
        const onclickLinkCount = (html.match(/onclickLink/g) || []).length;
        const rowIdCount = (html.match(/id="row\d+"/g) || []).length;
        const hasFlightlogLiveimport = html.includes('flightlogliveimport');
        const tablelist158Match = html.match(/tablelist_158/g);

        // Extract a sample around liveimportlist
        let liveimportSnippet = '';
        const liIdx = html.indexOf('liveimportlist');
        if (liIdx >= 0) {
          liveimportSnippet = html.substring(Math.max(0, liIdx - 100), liIdx + 300)
            .replace(/</g, '&lt;').substring(0, 400);
        }

        // Extract a sample around import_ogn
        let importOgnSnippet = '';
        const ioIdx = html.indexOf('import_ogn');
        if (ioIdx >= 0) {
          importOgnSnippet = html.substring(Math.max(0, ioIdx - 50), ioIdx + 200)
            .replace(/</g, '&lt;').substring(0, 300);
        }

        // Extract page title
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageTitle = titleMatch ? stripTags(titleMatch[1]) : 'no title';

        // Extract first 500 chars of body text
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)/i);
        const bodyText = bodyMatch ? stripTags(bodyMatch[1]).substring(0, 500) : 'no body';

        // Check for common VF elements
        const hasFlightdataentry = html.includes('flightdataentry');
        const hasFlightlog = html.includes('flightlog');
        const hasTablelist = html.includes('tablelist');
        const hasDatepicker = html.includes('filterdate');
        const formActions = (html.match(/action="([^"]+)"/g) || []).slice(0, 5);

        return ok({
          htmlLength: html.length,
          pageTitle,
          bodyTextPreview: bodyText,
          hasFlightdataentry,
          hasFlightlog,
          hasTablelist,
          hasDatepicker,
          formActions,
          hasLiveimportlist,
          hasDiv158,
          hasImportOgn,
          onclickDeleteCount,
          onclickLinkCount,
          rowIdCount,
          hasFlightlogLiveimport,
          tablelist158: tablelist158Match ? tablelist158Match.length : 0,
          parsed: parseFlightlogPage(html)
        });
      }

      default:
        return fail('Unbekannte Aktion: ' + action, 400);
    }

  } catch (err) {
    return fail(err.message);
  }
};
