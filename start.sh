#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Please install Node.js 22 or newer (including npm), then run this script again." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

if [[ ! -f .env && -z "${AZURE_SPEECH_KEY:-}" ]]; then
  (umask 077; cp .env.example .env)
  echo "Created .env. Add your AZURE_SPEECH_KEY and region, then run this script again." >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/esbuild || ! -d node_modules/microsoft-cognitiveservices-speech-sdk ]]; then
  echo "Installing dependencies…"
  npm ci --include=dev
fi

echo "Building Speech Notes…"
npm run build
echo "Starting Speech Notes. Press Ctrl+C to stop."
exec node --env-file-if-exists=.env server.js
