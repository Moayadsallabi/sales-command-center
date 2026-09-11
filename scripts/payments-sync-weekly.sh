#!/bin/sh
# Weekly payment reconciliation, run by launchd (see automation/README note).
# Reads Whop, corrects the Notion tracker, and logs what it changed.
cd "$(dirname "$0")/.." || exit 1
{
  echo ""
  echo "===== payments sync $(date '+%Y-%m-%d %H:%M') ====="
  /opt/homebrew/bin/node scripts/check-payments.mjs --apply
} >> "$HOME/Library/Logs/scc-payments-sync.log" 2>&1
