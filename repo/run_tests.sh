#!/usr/bin/env bash
# StudyRoomOps Test Runner
# Runs all test suites in Docker containers — no .env or manual setup needed
# Usage: ./run_tests.sh [api|web|all]

set -euo pipefail

TARGET="${1:-all}"

echo "StudyRoomOps Test Suite"
echo "======================"
echo "Target: $TARGET"
echo ""

# Ensure MongoDB replica set is running and initialized
echo "Starting test infrastructure..."
docker compose up -d mongo1 mongo2 mongo3
echo "Waiting for MongoDB nodes to be healthy..."

# Each mongod listens on its own port (must match docker-compose.yml)
mongo_port() {
  case "$1" in
    mongo1) echo 27017 ;;
    mongo2) echo 27018 ;;
    mongo3) echo 27019 ;;
  esac
}

for node in mongo1 mongo2 mongo3; do
  port="$(mongo_port "$node")"
  for i in $(seq 1 30); do
    if docker compose exec -T "$node" mongosh --port "$port" --eval "db.adminCommand('ping')" --quiet 2>/dev/null; then
      echo "  $node ready (port $port)"
      break
    fi
    [ "$i" -eq 30 ] && { echo "  ERROR: $node failed to start (port $port)"; exit 1; }
    sleep 2
  done
done

# Initialize replica set (idempotent)
docker compose up mongo-init 2>/dev/null || true
echo "MongoDB replica set ready."
echo ""

run_api_tests() {
  echo "Running API Tests..."
  echo "-------------------"
  docker compose run --rm \
    -e NODE_ENV=test \
    -e MONGO_URI=mongodb://mongo1:27017,mongo2:27018,mongo3:27019/studyroomops_test?replicaSet=rs0 \
    -e MONGO_DB_NAME=studyroomops_test \
    -e JWT_SECRET=test-jwt-secret-that-is-at-least-64-characters-long-for-testing-purposes \
    -e CSRF_SECRET=test-csrf-secret \
    -e FIELD_ENCRYPTION_KEY=test-field-encryption-key-32chars \
    -e FILE_ENCRYPTION_KEY=test-file-encryption-key-32chars! \
    -e SITE_TIMEZONE=America/Los_Angeles \
    api npm test
  echo "API tests complete."
}

run_web_tests() {
  echo ""
  echo "Running Web Frontend Tests..."
  echo "-----------------------------"
  docker compose run --rm web npm test
  echo "Web tests complete."
}

case "$TARGET" in
  api)
    run_api_tests
    ;;
  web)
    run_web_tests
    ;;
  all)
    run_api_tests
    run_web_tests
    ;;
  *)
    echo "Usage: $0 [api|web|all]"
    exit 1
    ;;
esac

echo ""
echo "All tests complete."
