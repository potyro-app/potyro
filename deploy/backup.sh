#!/usr/bin/env bash
# A copy of everything potyro.app keeps on disk, made while the services run (docs/16 §6, #22).
#
# Run it ON the server, as root, from cron:
#
#   17 3 * * *  /opt/potyro-src/deploy/backup.sh >> /var/log/potyro-backup.log 2>&1
#
# What it copies, into $BACKUP_DIR/<UTC date>/:
#   sync.db          the relay's database, with SQLite's online backup: safe against a database
#                    that is being written (a plain `cp` of a WAL database is not), then checked
#                    with `PRAGMA integrity_check` — a copy that fails the check is not a backup
#   shares.tar       the share links (each link's sealed package and preview)
#   ai-ledger.json   the month's AI spend
# Never the secrets in /etc/potyro: they are the owner's to keep, apart from the data.
#
# Then, in this order:
#   - offsite, when BACKUP_REMOTE is set: `rclone copy` of today's folder to $BACKUP_REMOTE/<date>
#     (any rclone remote: an S3-compatible bucket, a storage box over SFTP; set it up once with
#     `rclone config` as root). With BACKUP_AGE_RECIPIENT set, every file is encrypted with `age`
#     to that public key first, and only the encrypted files leave the server;
#   - old copies go, here and offsite: the newest $KEEP_DAILY days and the newest $KEEP_WEEKLY
#     Sundays are kept;
#   - the disk is looked at: above $DISK_ALERT_PCT percent is a failure, said out loud.
#
# It fails loudly and says why. On any failure it exits non-zero and, when ALERT_URL is set, POSTs
# one line of text there (an ntfy topic, a webhook): a backup that stopped must not be found out
# on the day it is needed. A good run prints one line and, with OK_URL set, GETs it (a dead man's
# switch that tells the owner when the nightly run did NOT happen).
#
# Settings: environment, or /etc/potyro/backup.env (root, mode 600; deploy/env.example has the names).
set -euo pipefail

[ -r /etc/potyro/backup.env ] && [ -z "${BACKUP_NO_ENV_FILE:-}" ] && . /etc/potyro/backup.env

DATA_DIR="${DATA_DIR:-/var/lib/potyro}"
AI_DIR="${AI_DIR:-/var/lib/potyro-ai}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/potyro}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
DISK_ALERT_PCT="${DISK_ALERT_PCT:-85}"
ALERT_URL="${ALERT_URL:-}"
OK_URL="${OK_URL:-}"
TODAY="${BACKUP_DATE:-$(date -u +%F)}"   # BACKUP_DATE exists for the test

fail() {
  local msg="potyro backup FAILED on $(hostname) at $(date -u +%FT%TZ): $*"
  printf '✘ %s\n' "$msg" >&2
  [ -n "$ALERT_URL" ] && curl -fsS -m 20 -d "$msg" "$ALERT_URL" >/dev/null 2>&1 || true
  exit 1
}
trap 'fail "line $LINENO: \`$BASH_COMMAND\` exited $?"' ERR

command -v sqlite3 >/dev/null || fail "sqlite3 is not installed (apt install sqlite3)"
[ -f "$DATA_DIR/sync.db" ] || fail "no relay database at $DATA_DIR/sync.db"

dest="$BACKUP_DIR/$TODAY"
mkdir -p "$dest"
chmod 700 "$BACKUP_DIR"

# 1. The relay's database. `.backup` reads through SQLite, so it is one consistent moment of a
#    database other processes are writing; `.timeout` waits for a writer instead of giving up.
rm -f "$dest/sync.db"
sqlite3 "$DATA_DIR/sync.db" ".timeout 60000" ".backup '$dest/sync.db'"
check="$(sqlite3 "$dest/sync.db" 'PRAGMA integrity_check;')"
[ "$check" = "ok" ] || fail "the copy of sync.db failed its integrity check: $check"

# 2. The share links and the AI ledger: small files, each written whole.
if [ -d "$DATA_DIR/shares" ]; then tar -C "$DATA_DIR" -cf "$dest/shares.tar" shares; fi
if [ -f "$AI_DIR/ai-ledger.json" ]; then cp "$AI_DIR/ai-ledger.json" "$dest/ai-ledger.json"; fi

# 3. Offsite.
if [ -n "$BACKUP_REMOTE" ]; then
  command -v rclone >/dev/null || fail "BACKUP_REMOTE is set and rclone is not installed"
  send="$dest"
  if [ -n "$BACKUP_AGE_RECIPIENT" ]; then
    command -v age >/dev/null || fail "BACKUP_AGE_RECIPIENT is set and age is not installed"
    send="$(mktemp -d)"
    for f in "$dest"/*; do age -r "$BACKUP_AGE_RECIPIENT" -o "$send/$(basename "$f").age" "$f"; done
  fi
  rclone copy "$send" "$BACKUP_REMOTE/$TODAY" || fail "the offsite copy to $BACKUP_REMOTE did not finish"
  [ "$send" = "$dest" ] || rm -rf "$send"
fi

# 4. Which dated folders stay: the newest KEEP_DAILY, and the newest KEEP_WEEKLY Sundays.
keep_list() { # reads dated names, newest first; prints the ones to keep
  local n=0 w=0 d
  while read -r d; do
    [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    if [ "$n" -lt "$KEEP_DAILY" ]; then echo "$d"; n=$((n + 1)); continue; fi
    if [ "$(date -u -d "$d" +%u)" = 7 ] && [ "$w" -lt "$KEEP_WEEKLY" ]; then echo "$d"; w=$((w + 1)); fi
  done
}
local_all="$(ls -1 "$BACKUP_DIR" | sort -r)"
local_keep="$(printf '%s\n' "$local_all" | keep_list)"
for d in $local_all; do
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  printf '%s\n' "$local_keep" | grep -qx "$d" || rm -rf "${BACKUP_DIR:?}/$d"
done
if [ -n "$BACKUP_REMOTE" ]; then
  remote_all="$(rclone lsf --dirs-only "$BACKUP_REMOTE" | sed 's:/$::' | sort -r)"
  remote_keep="$(printf '%s\n' "$remote_all" | keep_list)"
  for d in $remote_all; do
    [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    printf '%s\n' "$remote_keep" | grep -qx "$d" || rclone purge "$BACKUP_REMOTE/$d"
  done
fi

# 5. The disk. The relay's database only grows; a full disk stops the relay AND the backup.
size="$(du -sh "$dest" | cut -f1)"
db="$(du -h "$DATA_DIR/sync.db" | cut -f1)"
for mount in "$DATA_DIR" "$BACKUP_DIR"; do
  pct="$(df --output=pcent "$mount" | tail -1 | tr -dc '0-9')"
  [ "$pct" -lt "$DISK_ALERT_PCT" ] || fail "the disk holding $mount is ${pct}% full (limit ${DISK_ALERT_PCT}%); today's copy was made ($size)"
done

trap - ERR
printf '✓ %s  backup %s  sync.db %s  kept %s  %s\n' "$(date -u +%FT%TZ)" "$size" "$db" "$(printf '%s\n' "$local_keep" | grep -c .)" "${BACKUP_REMOTE:+offsite ok}"
[ -n "$OK_URL" ] && curl -fsS -m 20 "$OK_URL" >/dev/null 2>&1 || true
