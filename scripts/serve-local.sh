#!/bin/sh
# Serves a build folder with the local Worker runtime on 127.0.0.1 only. No account, no deploy.
# Usage: scripts/serve-local.sh <build-dir> <port> [wrangler.jsonc|wrangler.e2e.jsonc] [extra wrangler dev args]
set -eu
DIR="$1"; PORT="$2"; CFG="${3:-wrangler.jsonc}"
shift 2; [ $# -gt 0 ] && shift
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
cd "$DIR"
exec "$REPO/node_modules/.bin/wrangler" dev --config "$CFG" --local --ip 127.0.0.1 --port "$PORT" \
  --inspector-ip 127.0.0.1 --inspector-port 0 --persist-to "$DIR/.wrangler-state-$PORT" \
  --show-interactive-dev-session=false --log-level warn "$@"
