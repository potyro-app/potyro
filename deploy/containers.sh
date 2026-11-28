#!/usr/bin/env bash
# The services behind potyro.app, as they run on the server (observed 2026-11-01; docs/16).
#
# Run it ON the server, as root, from a checkout of the commit being deployed (normally origin/main):
#
#   ssh <admin>@<server>
#   git -C ~/potyro-src fetch -q origin && git -C ~/potyro-src checkout -q --detach origin/main
#   sudo ~/potyro-src/deploy/containers.sh                 # every service
#   sudo ~/potyro-src/deploy/containers.sh ai rooms        # only these
#
# (~/potyro-src is a plain clone of https://github.com/potyro-app/potyro; any clone will do.)
#
# What it does, for each service named (relay, gate, requests, share-links, ai, rooms, fediverse; none = all):
#   1. copies the package's code from the checkout into /opt/<container>/ (rsync --delete, never
#      node_modules), and installs the one service with dependencies of its own (rooms: `ws`) or the
#      relay's pinned `jazz-run`, in a throwaway node:22 container;
#   2. creates the container if it is missing, or if its `docker run` line is not the one below
#      (the line's hash is a label on the container), and otherwise restarts it only when step 1
#      changed something. Running it twice in a row changes nothing the second time.
#
# A container made by hand has no such label, so the first run re-creates it (a few seconds down).
# An env file's CONTENTS are not part of the line: after editing one, re-create its container with
# `sudo RECREATE=1 deploy/containers.sh ai` (an env file is read only when a container is created).
#
# Every container is node:22-bookworm, `--restart unless-stopped`, published on 127.0.0.1 only:
# Caddy (deploy/potyro.app.Caddyfile) is the one way in. The sync relay and its gate are on the
# host's network instead, each bound to 127.0.0.1 itself: a port published from Docker's bridge is
# closed to the outside but open to every other container on the bridge, and the relay must be
# reachable by its gate and by nothing else here.
#
# Secrets are never in this repository. The env files live in /etc/potyro/, owned by root, mode 600,
# and the values are the owner's (deploy/env.example/ has one template per file, names only):
#
#   /etc/potyro/requests.env      GITHUB_TOKEN, POTYRO_REQUESTS_REPO, HOST, PORT
#   /etc/potyro/ai.env            OPENROUTER_API_KEY, AI_MONTHLY_CAP_USD, AI_DAY_USD, AI_LEDGER,
#                                 AI_CHAT_MODELS, AI_DEVICE_MONTH_USD, AI_CHAT_OFF_FILE, TRUST_PROXY,
#                                 HOST, PORT (and any optional AI_* the template lists)
#   /etc/potyro/share-links.env   SHARE_ADMIN_TOKEN, SHARE_ABUSE_CONTACT — optional: the service
#                                 runs without it, with no takedown route over HTTPS and the
#                                 default report address on a taken-down link's page
#   /etc/potyro/sync-gate.env     SYNC_* limits — optional, nothing secret: without it the gate
#                                 runs on its defaults
#
# The requests relay and the AI relay refuse to start without their file (no token, no key).
# The sync relay and the rooms relay hold no secret and have no env file. Nor has the gallery's
# fediverse account: its one secret is the key it makes for itself, in /var/lib/potyro/fediverse.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="node:22-bookworm"
ENV_DIR="/etc/potyro"
ALL=(relay gate requests share-links ai rooms fediverse)

say() { printf '%s\n' "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo): it writes /opt, /var/lib and starts containers"
[ -f "$SRC/pnpm-workspace.yaml" ] || die "$SRC is not a checkout of the repository"
command -v docker >/dev/null || die "docker is not installed"
command -v rsync >/dev/null || die "rsync is not installed"

# Copies a package into its code dir; prints "changed" when anything moved.
copy() {
  local from="$1" to="$2"
  mkdir -p "$to"
  local moved
  # --omit-dir-times: an npm install in the dir changes its time, which is not a code change.
  moved="$(rsync -a --omit-dir-times --delete --itemize-changes --exclude node_modules "$from/" "$to/")"
  [ -n "$moved" ] && echo changed || true
}

# Creates or refreshes one container. $1 name, $2 "changed" or "", the rest the `docker run` args.
up() {
  local name="$1" changed="$2"
  shift 2
  local spec
  spec="$(printf '%s\n' "$@" | sha256sum | cut -c1-16)"
  local have=""
  if docker inspect "$name" >/dev/null 2>&1; then
    have="$(docker inspect -f '{{ index .Config.Labels "potyro.spec" }}' "$name")"
  fi
  if [ "$have" != "$spec" ] || [ "${RECREATE:-}" = 1 ]; then
    docker inspect "$name" >/dev/null 2>&1 && docker rm -f "$name" >/dev/null
    docker run -d --name "$name" --restart unless-stopped --label "potyro.spec=$spec" "$@" >/dev/null
    say "✓ $name created"
  elif [ "$changed" = changed ]; then
    docker restart "$name" >/dev/null
    say "✓ $name restarted on the new code"
  else
    docker start "$name" >/dev/null
    say "· $name unchanged"
  fi
}

# The sync relay: `jazz-run sync`, pinned to the jazz-run in the root package.json (it must match the
# cojson the shell was built against). Its code dir holds only that pin and its install.
# On the host's network, listening on 127.0.0.1 only. NOT on Docker's bridge with `-p 127.0.0.1:…`:
# there it listens on the bridge too, where the other containers (share-links, ai, requests, rooms)
# could reach it past its gate. From the host's loopback only the gate and Caddy can.
relay() {
  local dir=/opt/potyro-relay version changed=""
  version="$(sed -n 's/^ *"jazz-run": *"\([^"]*\)".*/\1/p' "$SRC/package.json")"
  [ -n "$version" ] || die "no jazz-run version in $SRC/package.json"
  mkdir -p "$dir" /var/lib/potyro
  local want="{ \"name\": \"potyro-relay\", \"private\": true, \"dependencies\": { \"jazz-run\": \"$version\" } }"
  if [ "$(cat "$dir/package.json" 2>/dev/null)" != "$want" ] || [ ! -x "$dir/node_modules/.bin/jazz-run" ]; then
    printf '%s\n' "$want" > "$dir/package.json"
    docker run --rm -v "$dir":/app -w /app "$IMAGE" npm install --omit=dev --no-fund --no-audit
    changed=changed
  fi
  up potyro-relay "$changed" \
    --network host \
    -v "$dir":/app -v /var/lib/potyro:/data -w /app \
    "$IMAGE" node node_modules/.bin/jazz-run sync --host 127.0.0.1 --port 4201 --db /data/sync.db
}

# The gate in front of the sync relay (docs/16 "The gate in front of the relay"): packages/sync-gate,
# no dependencies. Caddy's /sync goes to it (4206), and it goes to the relay (4201). On the host's
# network like the relay, which listens on the host's loopback only; it binds 127.0.0.1 itself (and
# refuses to start believing Caddy's header on any other address). It sees the relay's data folder
# read-only, to stop sync before the disk is full.
gate() {
  local changed envfile=()
  mkdir -p /var/lib/potyro
  [ -f "$ENV_DIR/sync-gate.env" ] && envfile=(--env-file "$ENV_DIR/sync-gate.env")
  changed="$(copy "$SRC/packages/sync-gate" /opt/potyro-sync-gate)"
  up potyro-sync-gate "$changed" \
    --network host \
    -e HOST=127.0.0.1 -e PORT=4206 \
    -e SYNC_UPSTREAM=127.0.0.1:4201 -e SYNC_DISK_PATH=/data \
    "${envfile[@]}" \
    -v /opt/potyro-sync-gate:/app:ro -v /var/lib/potyro:/data:ro -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

# Requests to the Potyro team (#263): packages/platform-requests, no dependencies.
requests() {
  [ -f "$ENV_DIR/requests.env" ] || die "$ENV_DIR/requests.env is missing (deploy/env.example/requests.env.example)"
  local changed
  changed="$(copy "$SRC/packages/platform-requests" /opt/potyro-requests)"
  up potyro-requests "$changed" \
    -p 127.0.0.1:4202:4202 \
    --env-file "$ENV_DIR/requests.env" \
    -v /opt/potyro-requests:/app:ro -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

# Demo links and their previews (docs/24): packages/share-links, no dependencies. It reads the
# deployed shell's index.html, so it mounts the web root read-only.
share_links() {
  local changed envfile=()
  mkdir -p /var/lib/potyro/shares
  [ -f "$ENV_DIR/share-links.env" ] && envfile=(--env-file "$ENV_DIR/share-links.env")
  changed="$(copy "$SRC/packages/share-links" /opt/potyro-share-links)"
  up potyro-share-links "$changed" \
    -p 127.0.0.1:4203:4203 \
    -e HOST=0.0.0.0 -e PORT=4203 \
    -e POTYRO_SHARES_DIR=/data -e POTYRO_SHELL_INDEX=/site/index.html \
    -e POTYRO_PUBLIC_ORIGIN=https://potyro.app \
    "${envfile[@]}" \
    -v /opt/potyro-share-links:/app:ro -v /var/lib/potyro/shares:/data -v /srv/potyro/site:/site:ro -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

# The free AI allowance (docs/23): packages/ai-relay, no dependencies. Its ledger is in /data.
ai() {
  [ -f "$ENV_DIR/ai.env" ] || die "$ENV_DIR/ai.env is missing (deploy/env.example/ai.env.example)"
  local changed
  mkdir -p /var/lib/potyro-ai
  changed="$(copy "$SRC/packages/ai-relay" /opt/potyro-ai)"
  up potyro-ai "$changed" \
    -p 127.0.0.1:4204:4204 \
    --env-file "$ENV_DIR/ai.env" \
    -v /opt/potyro-ai:/app:ro -v /var/lib/potyro-ai:/data -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

# Rooms for multiplayer apps (docs/26): packages/rooms, one dependency (`ws`), installed here.
rooms() {
  local changed dir=/opt/potyro-rooms
  changed="$(copy "$SRC/packages/rooms" "$dir")"
  if [ "$changed" = changed ] || [ ! -d "$dir/node_modules/ws" ]; then
    docker run --rm -v "$dir":/app -w /app "$IMAGE" npm install --omit=dev --no-package-lock --no-fund --no-audit
    changed=changed
  fi
  up potyro-rooms "$changed" \
    -p 127.0.0.1:4205:4205 \
    -e HOST=0.0.0.0 -e PORT=4205 \
    -e ROOMS_ORIGINS=https://potyro.app,https://localhost,capacitor://localhost \
    -v "$dir":/app:ro -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

# The gallery's fediverse account (docs/33): packages/fediverse, no dependencies. It reads the feed
# the site's build wrote (/srv/potyro.com/apps/feed.json), so it mounts potyro.com's web root
# read-only, and keeps its key, its followers and its queue in /data. On Docker's bridge, like the
# others here: what it asks of other servers goes out, and it refuses every private address itself.
fediverse() {
  local changed
  mkdir -p /var/lib/potyro/fediverse
  chmod 700 /var/lib/potyro/fediverse
  changed="$(copy "$SRC/packages/fediverse" /opt/potyro-fediverse)"
  up potyro-fediverse "$changed" \
    -p 127.0.0.1:4207:4207 \
    -e HOST=0.0.0.0 -e PORT=4207 \
    -e FEDI_DATA_DIR=/data -e FEDI_FEED=/site/apps/feed.json \
    -e FEDI_ORIGIN=https://potyro.com -e FEDI_USERNAME=apps \
    -v /opt/potyro-fediverse:/app:ro -v /var/lib/potyro/fediverse:/data -v /srv/potyro.com:/site:ro -w /app \
    "$IMAGE" node --experimental-strip-types src/server.ts
}

[ "$#" -gt 0 ] || set -- "${ALL[@]}"
for service in "$@"; do
  case "$service" in
    relay) relay ;;
    gate) gate ;;
    requests) requests ;;
    share-links) share_links ;;
    ai) ai ;;
    rooms) rooms ;;
    fediverse) fediverse ;;
    *) die "unknown service '$service' (one of: ${ALL[*]})" ;;
  esac
done
