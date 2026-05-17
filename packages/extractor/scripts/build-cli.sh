#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "📦 Building type declarations..."
./node_modules/.bin/tsc

echo "🦀 Bundling CLI with rolldown..."
./node_modules/.bin/rolldown -c rolldown.config.ts

echo "🔧 Injecting shebang..."
if ! head -1 dist/cli.js | grep -q "^#!/usr/bin/env node"; then
  printf '#!/usr/bin/env node\n' | cat - dist/cli.js > dist/cli.js.tmp && mv dist/cli.js.tmp dist/cli.js
fi
chmod +x dist/cli.js

SIZE=$(wc -c < dist/cli.js | tr -d ' ')
echo "✅ Build complete: dist/cli.js (${SIZE} bytes)"
