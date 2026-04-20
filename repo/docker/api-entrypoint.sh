#!/bin/sh
# API/Seed entrypoint: source .env if available, then exec the command
if [ -f /workspace/.env ]; then
  set -a
  . /workspace/.env
  set +a
fi
exec "$@"
