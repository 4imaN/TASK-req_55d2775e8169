#!/usr/bin/env bash
# StudyRoomOps Database Restore Script
# Usage: ./scripts/restore.sh <backup_dir>

set -euo pipefail

BACKUP_DIR="${1:?Usage: $0 <backup_directory>}"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "Error: Backup directory not found: $BACKUP_DIR"
  exit 1
fi

if [ ! -f "$BACKUP_DIR/metadata.json" ]; then
  echo "Error: No metadata.json found in backup directory"
  exit 1
fi

echo "StudyRoomOps Restore"
echo "===================="
echo "Source: $BACKUP_DIR"
echo ""

# Show backup metadata
echo "Backup metadata:"
cat "$BACKUP_DIR/metadata.json"
echo ""

read -p "This will overwrite existing data. Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Restore cancelled."
  exit 0
fi

# Restore MongoDB
if [ -d "$BACKUP_DIR/mongodb" ]; then
  echo "Restoring MongoDB..."
  docker cp "$BACKUP_DIR/mongodb" studyroomops-mongo1:/tmp/studyroomops_restore
  docker exec studyroomops-mongo1 mongorestore \
    --uri="mongodb://localhost:27017" \
    --gzip \
    --drop \
    /tmp/studyroomops_restore
  docker exec studyroomops-mongo1 rm -rf /tmp/studyroomops_restore
  echo "MongoDB restore complete."
fi

# Restore uploads
if [ -d "$BACKUP_DIR/uploads" ]; then
  echo "Restoring uploads..."
  docker cp "$BACKUP_DIR/uploads" studyroomops-api:/app/apps/api/uploads
  echo "Uploads restore complete."
fi

echo ""
echo "Restore complete."
echo "Restart the API service to ensure consistency: docker compose restart api"
