#!/usr/bin/env bash
set -eu
if (set -o pipefail) 2>/dev/null; then
  set -o pipefail
fi

BASE_DIR="${1:-/home/whs/suporte-ti}"
CURRENT="$BASE_DIR/current"
SHARED="$BASE_DIR/shared"

mkdir -p "$SHARED"

if [ ! -f "$SHARED/credenciais.txt" ]; then
  echo "credenciais.txt nao encontrado em $SHARED/credenciais.txt"
  exit 1
fi

PASSWORD="$(tr -d '\r\n' < "$SHARED/credenciais.txt")"
ENC_PW="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))' <<<"$PASSWORD")"

export DATABASE_URL="postgresql://postgres:${ENC_PW}@localhost:5446/suporteti"

if [ -f "$SHARED/session_secret" ]; then
  export SESSION_SECRET="$(tr -d '\r\n' < "$SHARED/session_secret")"
else
  export SESSION_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
  echo -n "$SESSION_SECRET" > "$SHARED/session_secret"
  chmod 600 "$SHARED/session_secret" || true
fi

export PORT="3001"

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || true
fi

PID_FILE="$SHARED/api.pid"
LOG_FILE="$SHARED/api.log"

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    kill "$OLD_PID" || true
    sleep 1
  fi
fi

nohup node "$CURRENT/artifacts/api-server/dist/index.mjs" >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

PID="$(cat "$PID_FILE" || true)"
TRIES=30
N=1
while [ "$N" -le "$TRIES" ]; do
  if [ -n "$PID" ] && ! kill -0 "$PID" >/dev/null 2>&1; then
    tail -n 120 "$LOG_FILE" || true
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:3001/api/healthz" >/dev/null 2>&1; then
    echo "API_OK"
    exit 0
  fi
  sleep 1
  N=$((N + 1))
done

tail -n 120 "$LOG_FILE" || true
exit 1

