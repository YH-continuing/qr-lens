#!/usr/bin/env bash
# QR Lens - fetch-jsqr.sh
# One-time setup helper: downloads the jsQR decoder into the extension root so
# the extension runs fully offline (macOS / Linux).
# The extension already ships with jsQR.js; use this only if it is missing.
#
# Run:  chmod +x fetch-jsqr.sh && ./fetch-jsqr.sh

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$DIR/jsQR.js"

SOURCES=(
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
  'https://cdn.jsdelivr.net/gh/cozmo/jsQR@master/dist/jsQR.js'
)

echo 'QR Lens: downloading offline decoder jsQR.js ...'
for u in "${SOURCES[@]}"; do
  echo "  trying $u"
  if curl -L --fail --silent --show-error --max-time 30 "$u" -o "$DEST" && [ "$(wc -c < "$DEST")" -gt 10000 ]; then
    echo "  OK: saved jsQR.js ($(wc -c < "$DEST") bytes) -> $DEST"
    echo '  Next: reload the extension on chrome://extensions.'
    exit 0
  fi
done
echo 'All sources failed. Download jsQR.js manually and place it in the extension root.' >&2
exit 1
