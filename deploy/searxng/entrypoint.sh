#!/bin/sh
set -e
if [ -z "${SEARXNG_SECRET}" ] || [ "${#SEARXNG_SECRET}" -lt 32 ]; then
  echo "SEARXNG_SECRET must be set (>=32 chars) - refusing to start" >&2
  exit 1
fi
export SEARXNG_PORT="${SEARXNG_PORT:-8080}"
export SEARXNG_BIND_ADDRESS="${SEARXNG_BIND_ADDRESS:-[::]}"
exec /usr/local/searxng/entrypoint.sh "$@"
