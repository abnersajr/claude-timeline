#!/usr/bin/env bash
# Localias Setup — one-time setup for local HTTPS dev domains
# Usage: ./scripts/localias-setup.sh
# Safe to run multiple times — skips steps that are already done.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCALIAS_CONFIG="$PROJECT_ROOT/.localias.yaml"

# ─── Helpers ───────────────────────────────────────────────

info()    { echo -e "  ${CYAN}$1${NC}"; }
success() { echo -e "  ${GREEN}✓${NC} $1"; }
skip()    { echo -e "  ${DIM}⏭  $1${NC}"; }
warn()    { echo -e "  ${YELLOW}⚠  $1${NC}"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; }

header() {
  echo ""
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  🌐  Localias Setup — Timeline API${NC}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════${NC}"
  echo ""
}

# ─── 1. Check localias is installed ───────────────────────

check_localias() {
  info "Checking localias installation..."
  if command -v localias &>/dev/null; then
    success "localias found ($(localias version 2>/dev/null || echo 'unknown version'))"
  else
    fail "localias not installed"
    echo -e "    ${DIM}Install with: brew install peterldowns/tap/localias${NC}"
    exit 1
  fi
}

# ─── 2. Check .localias.yaml exists ───────────────────────

check_config() {
  info "Checking .localias.yaml..."
  if [ -f "$LOCALIAS_CONFIG" ]; then
    success "Found .localias.yaml"
  else
    fail ".localias.yaml not found at project root"
    exit 1
  fi
}

# ─── 3. Import config into localias ───────────────────────

import_config() {
  info "Importing domain config into localias..."

  # Read domains from the config file (format: "domain: port")
  local domains
  domains=$(grep -E '^[a-zA-Z0-9._-]+:[[:space:]]*[0-9]+' "$LOCALIAS_CONFIG" | sed 's/://;s/^[[:space:]]*//')

  if [ -z "$domains" ]; then
    warn "No domains found in .localias.yaml"
    return
  fi

  while IFS= read -r line; do
    local domain port
    domain=$(echo "$line" | awk '{print $1}')
    port=$(echo "$line" | awk '{print $2}')

    # Check if already configured
    if localias list 2>/dev/null | grep -q "^${domain} ->"; then
      skip "$domain → :$port (already configured)"
    else
      localias set "$domain" "$port"
      success "$domain → :$port"
    fi
  done <<< "$domains"
}

# ─── 4. Ensure /etc/hosts entries ─────────────────────────

setup_hosts() {
  info "Checking /etc/hosts entries..."

  # Read domains from config
  local domains
  domains=$(grep -E '^[a-zA-Z0-9._-]+:[[:space:]]*[0-9]+' "$LOCALIAS_CONFIG" | awk -F':' '{print $1}' | tr -d ' ')

  local needs_update=false

  while IFS= read -r domain; do
    if grep -qE "^[0-9.]+[[:space:]]+${domain}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
      skip "$domain already in /etc/hosts"
    else
      warn "$domain missing from /etc/hosts"
      needs_update=true
    fi
  done <<< "$domains"

  if [ "$needs_update" = true ]; then
    echo ""
    info "Adding missing entries to /etc/hosts (requires sudo)..."
    while IFS= read -r domain; do
      if ! grep -qE "^[0-9.]+[[:space:]]+${domain}([[:space:]]|$)" /etc/hosts 2>/dev/null; then
        if echo "127.0.0.1 $domain" | sudo tee -a /etc/hosts >/dev/null 2>&1; then
          success "Added $domain → 127.0.0.1"
        else
          fail "Could not add $domain (sudo failed)"
          echo -e "    ${DIM}Add manually: echo '127.0.0.1 $domain' | sudo tee -a /etc/hosts${NC}"
        fi
      fi
    done <<< "$domains"
  fi
}

# ─── 5. Start localias daemon ─────────────────────────────

start_daemon() {
  info "Starting localias daemon..."

  if localias status 2>/dev/null | grep -q "daemon is running"; then
    skip "Daemon already running"
  else
    if localias start 2>/dev/null; then
      success "Localias daemon started"
    else
      warn "Could not start daemon (you can start it later with: localias start)"
    fi
  fi
}

# ─── Summary ──────────────────────────────────────────────

summary() {
  echo ""
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${BOLD}${GREEN}  ✅  Setup Complete${NC}"
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}API:${NC}      https://api.claude-dash.local"
  echo -e "  ${BOLD}Webapp:${NC}   https://claude-dash.local"
  echo -e "  ${BOLD}Backup:${NC}   http://localhost:3001"
  echo ""
  echo -e "  ${DIM}Run 'pnpm dev' to start all services.${NC}"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────

header
check_localias
check_config
import_config
setup_hosts
start_daemon
summary
