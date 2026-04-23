#!/bin/bash
# DASSU Buchungskalender – Auto-Deploy
# Doppelklick = alles committen und nach GitHub pushen (Netlify deployt automatisch)

cd "$(dirname "$0")" || exit 1

echo ""
echo "=========================================="
echo "  DASSU Buchungskalender – Deploy"
echo "=========================================="
echo ""

# Locks aufräumen, falls welche aus der Sandbox übrig sind
rm -f .git/index.lock .git/HEAD.lock 2>/dev/null
find .git/objects -name "tmp_obj_*" -delete 2>/dev/null

# Einmalig: fehlgeschlagenen Commit (mit großer PDF) zurücksetzen
if git log --oneline -1 | grep -q "Update 2026-04-23 18:15"; then
  echo "🔄 Setze fehlgeschlagenen PDF-Commit zurück..."
  git reset --soft HEAD~1
fi

# Gibt es Änderungen?
if [ -z "$(git status --porcelain)" ] && [ "$(git rev-list @{u}..HEAD --count 2>/dev/null)" = "0" ]; then
  echo "✅ Keine Änderungen zu deployen."
  echo ""
  read -n 1 -s -r -p "Drücke eine Taste zum Schließen..."
  exit 0
fi

# Alles stagen
git add -A

# Nur committen, wenn es etwas Neues gibt
if [ -n "$(git diff --cached --name-only)" ]; then
  TS=$(date +"%Y-%m-%d %H:%M")
  echo "📝 Committe Änderungen ($TS)..."
  git commit -m "Update $TS" || { echo "❌ Commit fehlgeschlagen"; read -n 1; exit 1; }
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
