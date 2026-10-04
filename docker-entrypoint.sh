#!/bin/sh
set -e

if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  echo "[pocketledger] applying database migrations..."
  prisma migrate deploy || {
    echo "[pocketledger] migration failed — is DATABASE_URL set and the database reachable?" >&2
    exit 1
  }
fi

if [ "$#" -gt 0 ]; then
  # one-off commands: docker compose run --rm seed / shell / ...
  exec "$@"
fi

echo "[pocketledger] starting server on port ${PORT:-3000}"
exec node server.js
