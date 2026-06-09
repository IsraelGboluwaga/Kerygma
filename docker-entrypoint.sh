#!/bin/sh
set -e

if [ -n "${R2_ACCOUNT_ID}" ] && [ -n "${R2_ACCESS_KEY_ID}" ] && [ -n "${R2_SECRET_ACCESS_KEY}" ] && [ -n "${R2_BUCKET}" ]; then
    mkdir -p "$(dirname "${DB_PATH}")"

    # Restore DB from R2 if it doesn't exist locally (cold start / fresh volume)
    if [ ! -f "${DB_PATH}" ]; then
        echo "[litestream] Restoring DB from R2..."
        litestream restore -config /app/litestream.yml -if-replica-exists "${DB_PATH}"
    fi
    exec litestream replicate -config /app/litestream.yml -exec "node dist/main.js"
else
    exec node dist/main.js
fi
