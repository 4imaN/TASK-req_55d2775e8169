#!/bin/sh
CERT_DIR=/etc/nginx/certs
if [ ! -f "$CERT_DIR/server.crt" ]; then
  echo "[nginx] Installing openssl..."
  apk add --no-cache openssl >/dev/null 2>&1
  echo "[nginx] Generating self-signed certificates..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -days 365 \
    -subj "/C=US/ST=Local/L=Local/O=StudyRoomOps/CN=localhost"
  echo "[nginx] Certificates generated."
fi
echo "[nginx] Starting nginx..."
exec nginx -g 'daemon off;'
