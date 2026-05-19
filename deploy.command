#!/bin/bash
# DASSU Buchungskalender – Auto-Deploy
# Doppelklick = alles committen und nach GitHub pushen (Netlify deployt automatisch)

set -euo pipefail

cd "$(dirname "$0")" || exit 1

echo ""
echo "=========================================="
echo "  DASSU Buchungskalender – Deploy"
echo "=========================================="
echo ""

# Locks aufräumen, falls welche aus der Sandbox übrig sind
rm -f .git/index.lock .git/HEAD.lock 2>/dev/null || true
find .git/objects -name "tmp_obj_*" -delete 2>/dev/null || true

# Branch-Check: nur main darf deployen
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
  echo "⚠️  Du bist auf Branch '$BRANCH' — Deploy läuft nur von main/master."
  read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
  echo ""
  exit 1
fi

# Gibt es Änderungen?
if [ -z "$(git status --porcelain)" ] && [ "$(git rev-list @{u}..HEAD --count 2>/dev/null || echo 0)" = "0" ]; then
  echo "✅ Keine Änderungen zu deployen."
  echo ""
  read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
  exit 0
fi

# Vorher Remote-Updates holen (Rebase, damit Conflict bei mehreren Geräten früh sichtbar wird)
echo "🔄 Hole Remote-Updates (rebase)..."
if ! git pull --rebase --autostash; then
  echo "❌ Rebase fehlgeschlagen — bitte Konflikte manuell lösen, dann erneut ausführen."
  read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
  exit 1
fi

# Syntax-Check für Netlify Functions (verhindert Deploys mit kaputtem Server-Code)
if command -v node >/dev/null 2>&1; then
  echo "🔍 Syntax-Check Netlify Functions..."
  for f in netlify/functions/*.js; do
    [ -e "$f" ] || continue
    if ! node --check "$f"; then
      echo "❌ Syntax-Fehler in $f — Deploy abgebrochen."
      read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
      exit 1
    fi
  done
fi

# Alles stagen
git add -A

# Nur committen, wenn es etwas Neues gibt
if [ -n "$(git diff --cached --name-only)" ]; then
  TS=$(date +"%Y-%m-%d %H:%M")
  # Optionale Commit-Message; leer = Timestamp-Fallback
  echo ""
  read -p "Commit-Nachricht (Enter = '$TS'): " MSG
  MSG="${MSG:-Update $TS}"
  echo "📝 Committe Änderungen: $MSG"
  if ! git commit -m "$MSG"; then
    echo "❌ Commit fehlgeschlagen"
    read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
    exit 1
  fi
else
  echo "ℹ️  Nichts Neues zu committen – pushe bestehende Commits."
fi

echo ""
echo "🚀 Pushe nach GitHub..."
if git push; then
  echo ""
  echo "✅ Fertig! Netlify deployt in 1–2 Minuten."
  echo "    → https://dassu-buchungskalender.netlify.app"
else
  echo ""
  echo "❌ Push fehlgeschlagen. Siehe Fehlermeldung oben."
fi

echo ""
read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
echo ""
