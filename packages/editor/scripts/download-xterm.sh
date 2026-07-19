#!/usr/bin/env bash
# Download xterm.js and FitAddon for offline bundling
set -euo pipefail

XTERM_VERSION="5.3.0"
FIT_VERSION="0.8.0"
DEST="Sources/OCEditor/Resources/xterm"
CDN="https://cdn.jsdelivr.net/npm"

echo "Downloading xterm.js ${XTERM_VERSION}…"
mkdir -p "${DEST}"

curl -fsSL "${CDN}/xterm@${XTERM_VERSION}/css/xterm.min.css"                    -o "${DEST}/xterm.min.css"
curl -fsSL "${CDN}/xterm@${XTERM_VERSION}/lib/xterm.min.js"                     -o "${DEST}/xterm.min.js"
curl -fsSL "${CDN}/xterm-addon-fit@${FIT_VERSION}/lib/xterm-addon-fit.min.js"   -o "${DEST}/xterm-addon-fit.min.js"

echo "✅ xterm.js downloaded to ${DEST}/"
echo "   Total size: $(du -sh "${DEST}" | cut -f1)"
