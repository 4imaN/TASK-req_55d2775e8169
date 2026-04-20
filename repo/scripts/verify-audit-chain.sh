#!/usr/bin/env bash
# StudyRoomOps Audit Chain Verification Script
# Calls the audit-chain verification API endpoint
# Usage: ./scripts/verify-audit-chain.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"

echo "StudyRoomOps Audit Chain Verification"
echo "======================================"

# This requires an admin session. Use admin credentials.
echo "Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -c /tmp/studyroomops_cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $(curl -s "${API_URL}/api/v1/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['csrfToken'])")" \
  -d '{"username":"admin","password":"AdminPass12345!"}' \
  "${API_URL}/api/v1/auth/login")

echo "Login response: $(echo $LOGIN_RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else d.get('error',{}).get('message','Failed'))")"

# Get CSRF for the authenticated request
CSRF_TOKEN=$(curl -s -b /tmp/studyroomops_cookies.txt "${API_URL}/api/v1/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['csrfToken'])")

echo ""
echo "Verifying audit chain integrity..."
VERIFY_RESPONSE=$(curl -s -b /tmp/studyroomops_cookies.txt \
  "${API_URL}/api/v1/audit-logs/verify")

echo "$VERIFY_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('ok'):
    result = data['data']
    if result.get('valid'):
        print('PASS: Audit chain is valid and tamper-free.')
    else:
        print(f'FAIL: Audit chain broken at entry: {result.get(\"brokenAt\", \"unknown\")}')
else:
    print(f'ERROR: {data.get(\"error\", {}).get(\"message\", \"Unknown error\")}')
"

rm -f /tmp/studyroomops_cookies.txt
