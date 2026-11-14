#!/bin/sh
# Serves a build folder with the local Worker runtime on 127.0.0.1 only. No account, no deploy.
# Usage: scripts/serve-local.sh <build-dir> <port> [wrangler.jsonc|wrangler.e2e.jsonc] [extra wrangler dev args]
set -eu
DIR="$1"; PORT="$2"; CFG="${3:-wrangler.jsonc}"
shift 2; [ $# -gt 0 ] && shift
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
# QA v26 FIND-J: a fresh local state folder (rate-limit counters, cache) for every run, named by the
# run (RIFQ_RUN_ID, set by the Playwright configs) or by the time and process; old ones are kept,
# never removed. So the gate suite's lock-out from one run never reaches the next.
STATE="$DIR/.wrangler-state-$PORT-${RIFQ_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
cd "$DIR"
exec "$REPO/node_modules/.bin/wrangler" dev --config "$CFG" --local --ip 127.0.0.1 --port "$PORT" \
  --inspector-ip 127.0.0.1 --inspector-port 0 --persist-to "$STATE" \
  --show-interactive-dev-session=false --log-level warn "$@"
