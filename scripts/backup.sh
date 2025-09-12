#!/bin/bash

# Simple project backup script
# Creates a timestamped tarball in backups/

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="superagent-backup-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# Exclude node_modules, build artifacts, .git, and backups themselves
tar \
  --exclude="$ROOT_DIR/node_modules" \
  --exclude="$ROOT_DIR/frontend/node_modules" \
  --exclude="$ROOT_DIR/backend/node_modules" \
  --exclude="$ROOT_DIR/.git" \
  --exclude="$ROOT_DIR/.next" \
  --exclude="$ROOT_DIR/frontend/.next" \
  --exclude="$ROOT_DIR/out" \
  --exclude="$ROOT_DIR/dist" \
  --exclude="$ROOT_DIR/backups" \
  -czf "$BACKUP_DIR/$ARCHIVE_NAME" -C "$ROOT_DIR" .

echo "Backup created: $BACKUP_DIR/$ARCHIVE_NAME"

