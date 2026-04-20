#!/usr/bin/env bash
# Generate self-signed TLS certificates for LAN HTTPS
# Usage: ./scripts/generate-certs.sh

set -euo pipefail

CERT_DIR="$(dirname "$0")/../docker/certs"
mkdir -p "$CERT_DIR"

# Get local hostname
HOSTNAME="${HOSTNAME:-localhost}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo "Generating self-signed TLS certificates for StudyRoomOps..."
echo "  Hostname: $HOSTNAME"
echo "  Local IP: $LOCAL_IP"

# Generate CA key and cert
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout "$CERT_DIR/ca.key" \
  -out "$CERT_DIR/ca.crt" \
  -days 3650 \
  -subj "/C=US/ST=Local/L=Local/O=StudyRoomOps/CN=StudyRoomOps CA"

# Generate server key
openssl genrsa -out "$CERT_DIR/server.key" 4096

# Generate CSR with SAN
cat > "$CERT_DIR/server.cnf" << EOF
[req]
default_bits = 4096
prompt = no
default_md = sha256
req_extensions = req_ext
distinguished_name = dn

[dn]
C = US
ST = Local
L = Local
O = StudyRoomOps
CN = $HOSTNAME

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = $HOSTNAME
DNS.3 = studyroomops.local
IP.1 = 127.0.0.1
IP.2 = $LOCAL_IP
EOF

openssl req -new -key "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.csr" \
  -config "$CERT_DIR/server.cnf"

# Sign with CA
openssl x509 -req \
  -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" \
  -CAkey "$CERT_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERT_DIR/server.crt" \
  -days 365 \
  -sha256 \
  -extfile "$CERT_DIR/server.cnf" \
  -extensions req_ext

# Clean up temporary files
rm -f "$CERT_DIR/server.csr" "$CERT_DIR/server.cnf" "$CERT_DIR/ca.srl"

echo ""
echo "Certificates generated in: $CERT_DIR"
echo "  CA Certificate:     $CERT_DIR/ca.crt"
echo "  Server Certificate: $CERT_DIR/server.crt"
echo "  Server Key:         $CERT_DIR/server.key"
echo ""
echo "To trust the CA on macOS:"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERT_DIR/ca.crt"
echo ""
echo "To trust the CA on Linux (Ubuntu/Debian):"
echo "  sudo cp $CERT_DIR/ca.crt /usr/local/share/ca-certificates/studyroomops-ca.crt"
echo "  sudo update-ca-certificates"
