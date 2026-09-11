#!/bin/sh
# Weekly tracker maintenance, run by launchd (see automation/README note).
#
# THE ADDRESSES GO ON FIRST, AND THAT ORDER IS THE POINT.
#
# `Prospect Email` is the key every join in this system runs on — the booking
# behind a call, the payment that followed it, the ad that produced the lead.
# The workflow can only take it from an external guest on the calendar invite,
# and on a live account most invites do not carry one: 60% of the last
# fortnight's calls arrived without an address on 2026-09-10.
#
# Nothing fails when it is missing. The joins simply do not happen, so the
# dashboard shows revenue with no call attached and calls with no revenue, and
# both figures are individually correct. What that cost, measured the same week:
#
#   - a $4,000 customer (Aidan Mediz, 30 August) sat as a BAMFAM with a $150
#     deposit for twelve days, because his two payments could not reach his call
#   - six of seven rows "claiming cash Whop does not hold" turned out to be real
#     money that simply could not be joined
#   - $3,850 of September's unmatched cash belonged to a call on the tracker
#
# `backfill:emails` fixes all of that, it is careful — two independent sources
# must agree, ties are refused, a row with an address is never touched — and
# until now it only ran when somebody remembered. It runs before the payments
# sync so the reconciliation immediately below can match what it just filled in.
cd "$(dirname "$0")/.." || exit 1
{
  echo ""
  echo "===== tracker sync $(date '+%Y-%m-%d %H:%M') ====="
  echo "--- filling in prospect addresses from Calendly ---"
  /opt/homebrew/bin/node scripts/backfill-emails.mjs --apply
  echo "--- reconciling the tracker against Whop ---"
  /opt/homebrew/bin/node scripts/check-payments.mjs --apply
} >> "$HOME/Library/Logs/scc-payments-sync.log" 2>&1
