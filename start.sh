#!/usr/bin/env bash
# Start the full stack (mongo, redis, socket, worker, public).
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "No .env found — copy .env.sample to .env and fill in secrets."; exit 1; }

docker compose up -d
docker compose ps
