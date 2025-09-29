#!/bin/sh
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
: "${DATABASE_URL:=$(grep '^DATABASE_URL=' ../.env | cut -d= -f2- | tr -d '\r')}"
LOG_DIR="$PWD/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend-$(date +%Y%m%d-%H%M%S).log"
echo "[run-backend] starting backend" | tee -a "$LOG_FILE"
exec npm run dev 2>&1 | tee -a "$LOG_FILE"
