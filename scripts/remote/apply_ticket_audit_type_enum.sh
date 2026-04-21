#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/whs/suporte-ti/shared/.env}"

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%$'\r'}"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
    esac

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"

      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"

      if [[ "$value" =~ ^\"(.*)\"$ ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
      fi

      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

DB_USER="${DB_USER:-suporte_app}"
DB_NAME="${DB_NAME:-suporteti}"
DB_PORT="${DB_PORT:-5446}"

SQL="ALTER TYPE ticket_audit_type ADD VALUE IF NOT EXISTS 'TICKET_UPDATED';"

run_as_app() {
  : "${DB_PASSWORD:?missing DB_PASSWORD}"
  PGPASSWORD="$DB_PASSWORD" psql -h localhost -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "$SQL"
}

run_as_postgres() {
  sudo -n -u postgres psql -h localhost -p "$DB_PORT" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "$SQL"
}

if run_as_app; then
  echo "OK_AS_APP"
elif run_as_postgres; then
  echo "OK_AS_POSTGRES"
else
  echo "FAILED: sem permissao para alterar enum (precisa sudo/root ou owner do type)" >&2
  exit 1
fi

: "${DB_PASSWORD:?missing DB_PASSWORD}"
PGPASSWORD="$DB_PASSWORD" psql -h localhost -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='ticket_audit_type' and e.enumlabel='TICKET_UPDATED';" | grep -q "TICKET_UPDATED"
echo "VERIFIED"
