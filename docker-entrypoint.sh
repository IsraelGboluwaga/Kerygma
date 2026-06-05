#!/bin/sh
set -e

if [ -n "${R2_ACCOUNT_ID}" ] && [ -n "${R2_ACCESS_KEY_ID}" ] && [ -n "${R2_SECRET_ACCESS_KEY}" ] && [ -n "${R2_BUCKET}" ]; then
    exec litestream replicate -config /app/litestream.yml -exec "node dist/main.js"
else
    exec node dist/main.js
fi
