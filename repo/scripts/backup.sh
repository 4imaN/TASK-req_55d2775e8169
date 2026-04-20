#!/usr/bin/env bash
# StudyRoomOps Database Backup Script
# Usage: ./scripts/backup.sh [backup_dir]

set -euo pipefail

BACKUP_DIR="${1:-./backups/$(date +%Y%m%d_%H%M%S)}"
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/studyroomops?replicaSet=rs0}"

mkdir -p "$BACKUP_DIR"

echo "StudyRoomOps Backup"
echo "==================="
echo "Target: $BACKUP_DIR"
echo "Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# MongoDB dump
echo "Dumping MongoDB..."
docker exec studyroomops-mongo1 mongodump \
  --uri="mongodb://localhost:27017/studyroomops" \
  --out="/tmp/studyroomops_backup" \
  --gzip

docker cp studyroomops-mongo1:/tmp/studyroomops_backup "$BACKUP_DIR/mongodb"
docker exec studyroomops-mongo1 rm -rf /tmp/studyroomops_backup

echo "MongoDB dump complete."

# Backup uploads
echo "Backing up uploads..."
if docker exec studyroomops-api test -d /app/apps/api/uploads; then
  docker cp studyroomops-api:/app/apps/api/uploads "$BACKUP_DIR/uploads"
  echo "Uploads backup complete."
else
  echo "No uploads directory found, skipping."
fi

# Record metadata
cat > "$BACKUP_DIR/metadata.json" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "full",
  "components": ["mongodb", "uploads"],
  "version": "1.0.0"
}
EOF

echo ""
echo "Backup complete: $BACKUP_DIR"
echo "Contents:"
ls -la "$BACKUP_DIR"
