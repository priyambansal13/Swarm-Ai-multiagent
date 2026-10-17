#!/usr/bin/env bash
# Renders every *.mmd in this folder to a PNG next to it (uses mermaid-cli via npx).
# Usage: docs/diagrams/render.sh            (needs Node; uses your installed Chrome if found)
set -euo pipefail
cd "$(dirname "$0")"
PP=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
  if [ -x "$c" ]; then
    printf '{"executablePath":"%s","args":["--no-sandbox","--headless=new"]}' "$c" > .puppeteer.json
    PP="-p .puppeteer.json"; export PUPPETEER_SKIP_DOWNLOAD=1; break
  fi
done
for f in *.mmd; do
  echo "→ ${f%.mmd}.png"
  npx -y @mermaid-js/mermaid-cli@11 $PP -c mermaid.config.json -i "$f" -o "${f%.mmd}.png" -s 2 -b white -w 1400 >/dev/null
done
rm -f .puppeteer.json
