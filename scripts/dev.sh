#!/usr/bin/env bash
set -euo pipefail

# Dev server — starts API + localias proxy
# Usage: ./scripts/dev.sh

echo "🔍 Checking localias daemon..."

if ! localias status 2>/dev/null | grep -q "daemon is running"; then
  echo "🚀 Starting localias daemon..."
  localias start
  sleep 1
fi

echo "✅ Localias daemon is running"
echo ""
echo "🌐 Starting services..."
echo "   API:      https://api.claude-dash.local → localhost:3001"
echo "   Webapp:   https://claude-dash.local → localhost:5173"
echo ""

exec pnpm dev
