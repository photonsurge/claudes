#!/usr/bin/env bash
# Stop the stack. Pass -v to also wipe data volumes (destructive).
set -euo pipefail
cd "$(dirname "$0")"

docker compose down "$@"
