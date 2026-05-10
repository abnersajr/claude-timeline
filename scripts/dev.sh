#!/usr/bin/env bash
set -euo pipefail

# Dev server — starts API + webapp
# Daemon must be running: sudo localias start

echo "🌐 Starting services..."
echo "   API:      https://api.claude-dash.local → localhost:3099"
echo "   Webapp:   https://claude-dash.local → localhost:5199"
echo ""

exec pnpm dev
