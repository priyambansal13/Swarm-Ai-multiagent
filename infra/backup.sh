#!/usr/bin/env bash
# Backup of both databases (swarm = users/knowledge/conversations, n8n = workflows/credentials) to ~/swarm-backups,
# kept 14 days. Scheduled nightly by infra/server-bootstrap.sh; run by hand any time.
#
# Off-server copy (recommended): create an OCI Object Storage bucket and a pre-authenticated request (object write)
# for it, then save its URL (ending in /o/) in ~/.swarm-backup-url — each dump is uploaded there too. Keep the bucket
# private (the default); the pre-authenticated request only allows writing objects, not listing or reading them.
#
# Restore one database:  gunzip -c FILE.sql.gz | docker exec -i swarm-db psql -U swarm -d swarm
#
# On failure it also sends a Telegram message to SWARM_ADMIN_TELEGRAM_CHAT_ID (the same chat that gets n8n error alerts).
set -euo pipefail
cd "$(dirname "$0")/.."

envval() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }
alert() {
  local token chat
  token="$(envval TELEGRAM_BOT_TOKEN)"; chat="$(envval SWARM_ADMIN_TELEGRAM_CHAT_ID)"
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  curl -fsS -m 15 "https://api.telegram.org/bot${token}/sendMessage" --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=⚠️ SwarmAI backup failed on $(hostname): $1" >/dev/null || true
}
trap 'alert "line $LINENO: $BASH_COMMAND"' ERR
DIR="$HOME/swarm-backups"
mkdir -p "$DIR"
PGUSER_NAME="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2 || true)"
PGUSER_NAME="${PGUSER_NAME:-swarm}"
TS="$(date +%Y%m%d-%H%M)"
for db in swarm n8n; do
  f="$DIR/$db-$TS.sql.gz"
  if ! docker exec swarm-db pg_dump -U "$PGUSER_NAME" -d "$db" --no-owner --clean --if-exists | gzip > "$f.part"; then
    rm -f "$f.part"
    echo "$(date '+%F %T') backup FAILED for database $db" >&2
    trap - ERR
    alert "database $db could not be dumped — see ~/swarm-backups/backup.log"
    exit 1
  fi
  mv "$f.part" "$f"
  if [ -s "$HOME/.swarm-backup-url" ]; then
    curl -fsS -T "$f" "$(cat "$HOME/.swarm-backup-url")$(basename "$f")" >/dev/null && echo "uploaded $(basename "$f")"
  fi
done
find "$DIR" -name '*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup ok ($TS)"
