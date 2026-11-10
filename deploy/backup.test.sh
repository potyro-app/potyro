#!/usr/bin/env bash
# Checks deploy/backup.sh against a scratch "server" in a temp folder. Needs sqlite3; touches
# nothing outside its temp folder. Run: bash deploy/backup.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; say() { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); say "  ✓ $*"; }
bad() { say "  ✘ $*"; exit 1; }

mkdir -p "$T/data/shares" "$T/ai" "$T/bin" "$T/remote"
echo '{"month":"2026-11"}' > "$T/ai/ai-ledger.json"
echo sealed > "$T/data/shares/abc.bin"
sqlite3 "$T/data/sync.db" "PRAGMA journal_mode=WAL; CREATE TABLE tx(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO tx(body) VALUES ('first');" >/dev/null

# A stand-in for rclone that keeps "the remote" in a folder: copy, lsf --dirs-only, purge.
cat > "$T/bin/rclone" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  copy) mkdir -p "$3" && cp -r "$2"/. "$3"/ ;;
  lsf) ls -1 "$3" | sed 's:$:/:' ;;
  purge) rm -rf "$2" ;;
  *) exit 2 ;;
esac
STUB
chmod +x "$T/bin/rclone"

run() { env BACKUP_NO_ENV_FILE=1 DATA_DIR="$T/data" AI_DIR="$T/ai" BACKUP_DIR="$T/backups" DISK_ALERT_PCT=101 "$@" bash "$here/backup.sh"; }

say "a copy made while the relay writes"
( for i in $(seq 1 400); do sqlite3 "$T/data/sync.db" ".timeout 5000" "INSERT INTO tx(body) VALUES ('w$i');" ; done ) &
writer=$!
sleep 1 # let the writer get going, so the copy is taken in the middle of it
run BACKUP_DATE=2026-11-10 > "$T/out" || bad "the backup failed: $(cat "$T/out")"
wait "$writer"
[ "$(sqlite3 "$T/backups/2026-11-10/sync.db" 'PRAGMA integrity_check;')" = ok ] && ok "the copy passes integrity_check" || bad "integrity"
n="$(sqlite3 "$T/backups/2026-11-10/sync.db" 'SELECT count(*) FROM tx;')"
[ "$n" -gt 1 ] && [ "$n" -le 401 ] && ok "it holds a consistent moment ($n rows of 401)" || bad "rows: $n"
[ "$(sqlite3 "$T/backups/2026-11-10/sync.db" "SELECT body FROM tx WHERE id=1;")" = first ] && ok "and reads back what was written" || bad "content"
tar -tf "$T/backups/2026-11-10/shares.tar" | grep -q shares/abc.bin && ok "the share links are in it" || bad "shares"
cmp -s "$T/ai/ai-ledger.json" "$T/backups/2026-11-10/ai-ledger.json" && ok "the AI ledger is in it" || bad "ledger"
grep -q '^✓' "$T/out" && ok "a good run says one line" || bad "no ok line"

say "which days are kept"
rm -rf "$T/backups"; mkdir -p "$T/backups"
for d in $(seq 1 60); do mkdir -p "$T/backups/$(date -u -d "2026-11-10 - $d days" +%F)" "$T/remote/$(date -u -d "2026-11-10 - $d days" +%F)"; done
mkdir -p "$T/backups/not-a-date"
PATH="$T/bin:$PATH" run BACKUP_DATE=2026-11-10 BACKUP_REMOTE="$T/remote" > "$T/out" || bad "the backup failed: $(cat "$T/out")"
kept="$(ls -1 "$T/backups" | grep -E '^[0-9]{4}-' | sort -r | tr '\n' ' ')"
want="2026-11-10 2026-11-09 2026-11-08 2026-11-07 2026-11-06 2026-11-05 2026-11-04 2026-11-01 2026-10-25 2026-10-18 2026-10-11 "
[ "$kept" = "$want" ] && ok "seven days and four Sundays stay, here" || bad "kept: $kept"
[ "$(ls -1 "$T/remote" | sort -r | tr '\n' ' ')" = "$want" ] && ok "and the same offsite" || bad "remote: $(ls "$T/remote" | tr '\n' ' ')"
[ -d "$T/backups/not-a-date" ] && ok "a folder that is not a date is left alone" || bad "deleted a stranger"
[ -f "$T/remote/2026-11-10/sync.db" ] && ok "today's copy went offsite" || bad "no offsite copy"

say "failures are loud"
if run BACKUP_DATE=2026-11-11 DISK_ALERT_PCT=0 > "$T/out" 2>&1; then bad "a full disk passed"; fi
grep -q 'FAILED.*% full' "$T/out" && [ -f "$T/backups/2026-11-11/sync.db" ] && ok "a full disk fails, after the copy was made" || bad "disk: $(cat "$T/out")"
mv "$T/data/sync.db" "$T/data/gone.db"
if run BACKUP_DATE=2026-11-12 > "$T/out" 2>&1; then bad "a missing database passed"; fi
grep -q 'FAILED.*no relay database' "$T/out" && ok "a missing database fails and says so" || bad "missing: $(cat "$T/out")"
mv "$T/data/gone.db" "$T/data/sync.db"
printf 'not a database, long enough to be read as a broken one ...........................................' > "$T/data/sync.db"
if run BACKUP_DATE=2026-11-13 > "$T/out" 2>&1; then bad "a broken database passed"; fi
grep -q 'FAILED' "$T/out" && ok "a database that cannot be read fails" || bad "broken: $(cat "$T/out")"

say "$pass checks passed"
