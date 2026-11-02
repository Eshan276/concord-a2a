#!/usr/bin/env bash
# Starts the Concord engine (:8787) and the control room (:5173).
set -e
cd "$(dirname "$0")"
(cd engine && npx tsx watch src/server.ts) &
ENGINE=$!
trap 'kill $ENGINE 2>/dev/null' EXIT
cd web && npx vite --host
