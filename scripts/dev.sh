#!/usr/bin/env bash
# Starts all five services locally. Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

declare -A PORTS=([identity]=4001 [room]=4002 [game]=4003 [gateway]=4004 [bff]=4005)
pids=()
cleanup() { echo; echo "stopping..."; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

for svc in identity room game gateway bff; do
  PORT="${PORTS[$svc]}" node "services/$svc/dist/index.js" 2>&1 | sed "s/^/[$svc] /" &
  pids+=($!)
done

echo
echo "  identity  http://localhost:4001"
echo "  room      http://localhost:4002"
echo "  game      http://localhost:4003"
echo "  gateway   http://localhost:4004   <- open this in 4 tabs"
echo "  bff       http://localhost:4005/graphql"
echo
wait
