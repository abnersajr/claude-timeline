#!/usr/bin/env bash
# Localias Setup — register domains for local HTTPS dev
# Usage: ./scripts/localias-setup.sh
# Safe to run multiple times.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCALIAS_CONFIG="$PROJECT_ROOT/.localias.yaml"

echo "🌐 Registering localias domains..."

# Read domains from .localias.yaml and register them
grep -E '^[a-zA-Z0-9._-]+:[[:space:]]*[0-9]+' "$LOCALIAS_CONFIG" | while IFS= read -r line; do
  domain=$(echo "$line" | awk -F':' '{print $1}' | tr -d ' ')
  port=$(echo "$line" | awk -F':' '{print $2}' | tr -d ' ')
  localias set "$domain" "$port"
  echo "  ✓ $domain → :$port"
done

echo ""
echo "✅ Domains registered. Start the daemon once:"
echo "   sudo localias start"
