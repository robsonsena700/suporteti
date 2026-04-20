#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="${1:-}"
ENV_FILE="${ENV_FILE:-/home/whs/suporte-ti/shared/.env}"

if [ -z "$MIGRATIONS_DIR" ]; then
  echo "Uso: $0 <diretorio_migrations>" >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Diretorio de migrations nao encontrado: $MIGRATIONS_DIR" >&2
  exit 1
fi

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

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5446}"
DB_NAME="${DB_NAME:-suporteti}"
DB_USER="${DB_USER:-suporte_app}"

: "${DB_PASSWORD:?missing DB_PASSWORD}"

export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS public._sql_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

for file in "${files[@]}"; do
  filename="$(basename "$file")"
  already="$("${PSQL[@]}" -tAc "SELECT 1 FROM public._sql_migrations WHERE filename = '$filename' LIMIT 1;")"
  if [ "$already" = "1" ]; then
    echo "SKIP $filename"
    continue
  fi

  echo "APPLY $filename"
  "${PSQL[@]}" -f "$file"
  "${PSQL[@]}" -c "INSERT INTO public._sql_migrations (filename) VALUES ('$filename');"
done

echo "MIGRATIONS_OK"

