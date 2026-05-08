#!/usr/bin/env bash
set -eu
if (set -o pipefail) 2>/dev/null; then
  set -o pipefail
fi

ACTION="${1:-}"
BASE_DIR="${2:-/home/whs/suporte-ti}"
SHARED="$BASE_DIR/shared"
UPLOADS_DIR="${UPLOADS_DIR:-$SHARED/uploads}"
BACKUPS_DIR="${UPLOADS_BACKUPS_DIR:-$SHARED/backups/uploads}"
AUDIT_LOG="${UPLOADS_AUDIT_LOG:-$SHARED/uploads_audit.log}"
ALERT_WEBHOOK_URL="${UPLOADS_ALERT_WEBHOOK_URL:-}"
ALERT_EMAIL="${UPLOADS_ALERT_EMAIL:-}"

now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

json_escape() {
  python3 -c 'import json,sys;print(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null || cat
}

append_audit() {
  local payload="$1"
  mkdir -p "$SHARED"
  touch "$AUDIT_LOG" || true
  printf "%s\n" "$payload" >> "$AUDIT_LOG" || true
}

uploads_stats_json() {
  local files="-1" bytes="-1"
  if command -v find >/dev/null 2>&1 && command -v wc >/dev/null 2>&1; then
    files="$(find "$UPLOADS_DIR" -type f 2>/dev/null | wc -l | tr -d '[:space:]' || echo "-1")"
  fi
  if command -v du >/dev/null 2>&1; then
    bytes="$(du -sb "$UPLOADS_DIR" 2>/dev/null | awk '{print $1}' | tr -d '[:space:]' || echo "-1")"
  fi
  printf "\"fileCount\":%s,\"totalBytes\":%s" "$files" "$bytes"
}

send_alert() {
  local title="$1"
  local detail="$2"
  if [ -n "$ALERT_WEBHOOK_URL" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS -X POST -H "Content-Type: application/json" \
      -d "{\"service\":\"suporte-ti\",\"component\":\"uploads\",\"title\":\"$(printf "%s" "$title" | json_escape)\",\"detail\":\"$(printf "%s" "$detail" | json_escape)\",\"ts\":\"$(now_iso)\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
    printf "%s\n\n%s\n" "$title" "$detail" | mail -s "[suporte-ti] uploads" "$ALERT_EMAIL" >/dev/null 2>&1 || true
  fi
}

ensure() {
  mkdir -p "$UPLOADS_DIR" "$BACKUPS_DIR"
  chmod 750 "$UPLOADS_DIR" >/dev/null 2>&1 || true
  chmod 700 "$(dirname "$BACKUPS_DIR")" >/dev/null 2>&1 || true
  chmod 700 "$BACKUPS_DIR" >/dev/null 2>&1 || true
  touch "$AUDIT_LOG" >/dev/null 2>&1 || true
  chmod 640 "$AUDIT_LOG" >/dev/null 2>&1 || true

  local currentUploads="$BASE_DIR/current/uploads"
  if [ -d "$currentUploads" ]; then
    if [ -z "$(ls -A "$UPLOADS_DIR" 2>/dev/null || true)" ] && [ -n "$(ls -A "$currentUploads" 2>/dev/null || true)" ]; then
      if command -v rsync >/dev/null 2>&1; then
        rsync -a "$currentUploads"/ "$UPLOADS_DIR"/
      else
        cp -a "$currentUploads"/. "$UPLOADS_DIR"/
      fi
    fi
  fi

  append_audit "{\"ts\":\"$(now_iso)\",\"action\":\"ensure\",\"uploadsDir\":\"$UPLOADS_DIR\",\"backupsDir\":\"$BACKUPS_DIR\",$(uploads_stats_json)}"
}

backup() {
  ensure
  local stamp
  stamp="$(date -u +"%Y%m%d_%H%M%S")"
  local out="$BACKUPS_DIR/uploads_$stamp.tgz"
  if command -v tar >/dev/null 2>&1; then
    tar -czf "$out" -C "$UPLOADS_DIR" . || true
  fi
  if command -v find >/dev/null 2>&1; then
    find "$BACKUPS_DIR" -maxdepth 1 -type f -name "uploads_*.tgz" -mtime +14 -print -delete >/dev/null 2>&1 || true
  fi
  append_audit "{\"ts\":\"$(now_iso)\",\"action\":\"backup\",\"artifact\":\"$out\",$(uploads_stats_json)}"
}

build_db_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf "%s" "$DATABASE_URL"
    return 0
  fi
  if [ ! -f "$SHARED/credenciais.txt" ]; then
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  local password enc
  password="$(tr -d '\r\n' < "$SHARED/credenciais.txt")"
  enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))' <<<"$password")"
  printf "postgresql://postgres:%s@localhost:5446/suporteti" "$enc"
}

verify() {
  ensure

  local probe="$UPLOADS_DIR/.probe_write"
  if ! (printf "" > "$probe" 2>/dev/null); then
    append_audit "{\"ts\":\"$(now_iso)\",\"action\":\"verify\",\"ok\":false,\"error\":\"not_writable\"}"
    send_alert "Uploads não gravável" "O diretório não está gravável: $UPLOADS_DIR"
    exit 2
  fi
  rm -f "$probe" >/dev/null 2>&1 || true

  local missing=0 checked=0
  local dbUrl=""
  if command -v psql >/dev/null 2>&1; then
    dbUrl="$(build_db_url || true)"
  fi

  if [ -n "$dbUrl" ] && command -v psql >/dev/null 2>&1; then
    local max="${UPLOADS_VERIFY_MAX:-2000}"
    local full="${UPLOADS_VERIFY_FULL:-false}"
    local query=""
    if [ "$full" = "true" ]; then
      query="select storage_path from public.ticket_message_attachments order by id asc"
    else
      query="select storage_path from public.ticket_message_attachments order by created_at desc limit $max"
    fi

    while IFS= read -r rel; do
      [ -z "$rel" ] && continue
      checked=$((checked + 1))
      if [ ! -f "$UPLOADS_DIR/$rel" ]; then
        missing=$((missing + 1))
        if [ "$missing" -ge 25 ]; then
          break
        fi
      fi
    done < <(psql "$dbUrl" -Atqc "$query" 2>/dev/null || true)
  fi

  if [ "$missing" -gt 0 ]; then
    append_audit "{\"ts\":\"$(now_iso)\",\"action\":\"verify\",\"ok\":false,\"checked\":$checked,\"missing\":$missing,$(uploads_stats_json)}"
    send_alert "Uploads com arquivos ausentes" "Verificação encontrou arquivos ausentes. checked=$checked missing=$missing uploadsDir=$UPLOADS_DIR"
    exit 2
  fi

  append_audit "{\"ts\":\"$(now_iso)\",\"action\":\"verify\",\"ok\":true,\"checked\":$checked,\"missing\":0,$(uploads_stats_json)}"
  printf "UPLOADS_OK\n"
}

case "$ACTION" in
  ensure) ensure ;;
  backup) backup ;;
  verify) verify ;;
  *)
    echo "Uso: $0 {ensure|backup|verify} [BASE_DIR]" >&2
    exit 2
    ;;
esac
