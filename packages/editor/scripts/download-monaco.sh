#!/usr/bin/env bash
# Download Monaco Editor for offline bundling
set -euo pipefail

MONACO_VERSION="0.52.2"
DEST="Sources/OCEditor/Resources/monaco"
CDN="https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs"

echo "Downloading Monaco Editor ${MONACO_VERSION}…"

mkdir -p "${DEST}"

# Core files needed for Monaco
FILES=(
  "loader.js"
  "editor/editor.main.js"
  "editor/editor.main.css"
  "editor/editor.main.nls.js"
  "base/worker/workerMain.js"
  "base/common/worker/simpleWorker.js"
  "editor/common/services/editorSimpleWorker.js"
)

for f in "${FILES[@]}"; do
  dir="${DEST}/$(dirname "$f")"
  mkdir -p "$dir"
  url="${CDN}/${f}"
  out="${DEST}/${f}"
  if [ ! -f "$out" ]; then
    echo "  Downloading ${f}…"
    curl -fsSL "$url" -o "$out"
  fi
done

# Language workers (TypeScript is the important one)
mkdir -p "${DEST}/language/typescript/ts"
curl -fsSL "${CDN}/language/typescript/ts/tsWorker.js" \
  -o "${DEST}/language/typescript/ts/tsWorker.js" 2>/dev/null || true

echo "✅ Monaco downloaded to ${DEST}/"
echo "   Total size: $(du -sh "${DEST}" | cut -f1)"
