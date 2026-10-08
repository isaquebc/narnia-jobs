#!/bin/sh
# Entrypoint da api em produção: pasta de dados, token de boot persistido em /data/.token (0600), migrations (no boot do servidor).
set -eu
DATA_DIR=${NARNIA_DATA_DIR:-/data}
mkdir -p "$DATA_DIR" 2>/dev/null || true
if [ ! -w "$DATA_DIR" ]; then
  echo "[api] pasta de dados não gravável: $DATA_DIR (confira a permissão da pasta montada no host)" >&2
  exit 1
fi
TOKEN_FILE="$DATA_DIR/.token"
if [ -z "${NARNIA_TOKEN:-}" ]; then
  if [ -s "$TOKEN_FILE" ]; then
    NARNIA_TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
  else
    NARNIA_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")
  fi
fi
umask 077
printf '%s' "$NARNIA_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
export NARNIA_TOKEN
cd /app/apps/api
exec ./node_modules/.bin/tsx src/server.ts
