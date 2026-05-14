#!/usr/bin/env bash
# Combines all SVGs in design-elements/icons/ into one sprite at public/assets/icons/sprite.svg.
# Each icon becomes a <symbol id="..."> stripped of fill/stroke attrs so currentColor works.
set -euo pipefail
SRC="$HOME/Desktop/Leaf/design-elements/icons"
OUT="public/assets/icons/sprite.svg"
mkdir -p "$(dirname "$OUT")"

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'
  for f in "$SRC"/*.svg; do
    name=$(basename "$f" .svg | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    viewbox=$(grep -oE 'viewBox="[^"]+"' "$f" | head -1 | sed 's/viewBox=//;s/"//g')
    [ -z "$viewbox" ] && viewbox="0 0 24 24"
    inner=$(sed -e 's/<\?xml[^>]*>//' -e 's/<svg[^>]*>//' -e 's/<\/svg>//' -e 's/fill="[^"]*"//g' -e 's/stroke="[^"]*"//g' "$f")
    echo "  <symbol id=\"$name\" viewBox=\"$viewbox\">$inner</symbol>"
  done
  echo '</svg>'
} > "$OUT"
echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
