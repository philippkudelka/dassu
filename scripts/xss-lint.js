#!/usr/bin/env node
/**
 * XSS-Regressions-Check (maschineller Ersatz für die fehlende script-src-CSP).
 *
 * Hintergrund: Die App hat bewusst keine script-src-CSP (die ~300 Inline-Skripte
 * würden brechen). Dadurch hängt die XSS-Abwehr an manueller Escaping-Disziplin —
 * „ein vergessenes escapeHtml() reißt den Schutzwall auf" (so das externe Review).
 * Dieser Check sichert die Disziplin maschinell ab.
 *
 * WAS GEPRÜFT WIRD:
 * Stellen, an denen ein bekanntes USER-INPUT-Feld (Name, E-Mail, Kommentar, Telefon,
 * Fluglehrername, Adresse …) per `${…}` in einen HTML-Kontext interpoliert wird,
 * OHNE durch escapeHtml/escapeAttr/jsArg/encodeURIComponent zu laufen.
 *
 * PRÄZISION (bewusst wenig False Positives, damit der Check nicht ignoriert wird):
 *   - Nur Zeilen mit HTML-Tag (`<div`, `<td`, …) gelten als Sink. Reine
 *     notify()/logActivity()/confirm()/console-Strings sind Text → ignoriert.
 *   - `.charAt(0)`-Initialen (Avatar-Buchstaben, 1 Zeichen) → ignoriert.
 *   - Reine Ternary-TESTS (`field ? 'x' : ''`, Feld nur Bedingung) → ignoriert.
 *   - bereits-escaped Variablen (safe…/esc…/enc…) → ignoriert.
 *
 * FREIGABE: Eine nachweislich sichere Stelle kann mit einem Inline-Kommentar
 *   // xss-lint-ok: <Begründung>
 * in derselben Zeile freigegeben werden.
 *
 * Exit-Code 1 bei Funden → blockiert die CI.
 */
const fs = require('fs');
const path = require('path');

const FILES = ['index.html', 'staff.html'];

const TAINTED_OBJECTS = ['booking', 'b', 'c', 'cust', 'customer', 'u', 'user', 'm', 'profile', 'entry', 'inv', 'msg', 'staffProfile', 'custData', 'st'];
const TAINTED_FIELDS = ['name', 'email', 'phone', 'comment', 'instructorName', 'street', 'city', 'country', 'zip', 'birthdate', 'title', 'body', 'note', 'displayName', 'firstname', 'lastname', 'createdByName', 'fullName'];
const SAFE_WRAPPERS = ['escapeHtml', 'escapeAttr', 'jsArg', 'encodeURIComponent', 'encodeURI'];
const SAFE_VAR_PREFIX = /^(safe|esc|enc)[A-Z]/;

const objAlt = TAINTED_OBJECTS.map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const fieldAlt = TAINTED_FIELDS.join('|');

const INTERP_RE = /\$\{([^{}]*)\}/g;
const TAINTED_RE = new RegExp(`\\b(${objAlt})\\??\\.(${fieldAlt})\\b`);
const HTML_TAG_RE = /<[a-zA-Z]/; // Zeile ist HTML-Kontext

/**
 * Prüft eine einzelne Zeile. Gibt ein Array der gefundenen, ungeschützten
 * Interpolations-Ausdrücke zurück (leer = sauber). Exportiert für Unit-Tests.
 */
function scanLine(line) {
  const hits = [];
  if (/xss-lint-ok/.test(line)) return hits;
  if (!HTML_TAG_RE.test(line)) return hits; // nur HTML-Sinks

  let mm;
  const re = new RegExp(INTERP_RE.source, 'g');
  while ((mm = re.exec(line)) !== null) {
    const expr = mm[1];
    const taint = TAINTED_RE.exec(expr);
    if (!taint) continue;
    if (SAFE_WRAPPERS.some(w => expr.includes(w + '('))) continue;
    if (SAFE_VAR_PREFIX.test(expr.trim())) continue;
    if (expr.includes('.charAt(')) continue;

    // Reiner Ternary-Test: tainted Feld nur VOR dem '?', nicht in den Branches → safe
    const qpos = expr.indexOf('?');
    if (qpos !== -1 && taint.index < qpos) {
      const branches = expr.slice(qpos);
      if (!TAINTED_RE.test(branches)) continue;
    }
    hits.push(expr.trim());
  }
  return hits;
}

function run() {
  let findings = 0;
  for (const file of FILES) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      for (const expr of scanLine(line)) {
        findings++;
        console.error(`✗ ${file}:${idx + 1}  ungeschützter User-Input im HTML-Template:`);
        console.error(`    \${${expr}}`);
        console.error(`    ${line.trim().slice(0, 140)}`);
        console.error('');
      }
    });
  }
  if (findings > 0) {
    console.error(`✗ XSS-Lint: ${findings} ungeschützte User-Input-Interpolation(en) in HTML-Kontext gefunden.`);
    console.error('  → mit escapeHtml()/escapeAttr()/jsArg() escapen,');
    console.error('    oder bei nachweislicher Sicherheit mit  // xss-lint-ok: <Grund>  freigeben.');
    process.exit(1);
  }
  console.log('✓ XSS-Lint: keine ungeschützten User-Input-Interpolationen in HTML-Kontext.');
}

module.exports = { scanLine };

// Nur ausführen, wenn direkt als CLI aufgerufen (nicht beim require im Test).
if (require.main === module) run();
