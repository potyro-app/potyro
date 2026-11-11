---
title: Deployment
description: What runs on potyro.app and how it was put there: the shell, the sync relay and the optional services, with Caddy in front.
status: current
order: 16
---

# Deploying Potyro on your own domain (KA-34)

**`https://potyro.app` is the live deployment**: public, with no gate in front of it, the shell, the
sync relay and all four optional services on one server behind Caddy. Everything that server runs is
in [`deploy/`](../deploy/README.md): the Caddyfile, a script with every container's command, and a
template for each env file. Only the secrets are not, and their values are the owner's.

This document is that deployment, written so it can be rebuilt, and so it can be copied: to put
Potyro on a domain of your own, change the names and the address and follow the same steps. Read
[What this does NOT protect](#what-this-does-not-protect) before pointing anyone at it. The first
site, `apps.vaz.io` (Apache, behind basic auth), and the CI gates that came before the current one
are in [How it was](#how-it-was), at the end.

## As deployed

Read on the server on 2026-11-01 (`docker ps`, `docker inspect`, `/etc/caddy/Caddyfile`); the
health checks under each service were run on 2026-10-30.

| Service | Container | Port (127.0.0.1) | Code | Data | Env file | Caddy route |
|---|---|---|---|---|---|---|
| The shell | — (static files) | — | `/srv/potyro/site` ← `packages/shell/dist` | — | — | everything not below: `try_files`, then `index.html` |
| Sync relay | `potyro-relay` | 4201 | `/opt/potyro-relay` (a `jazz-run` pin and its install) | `/var/lib/potyro/sync.db` | — | `handle_path /sync*` |
| Request relay | `potyro-requests` | 4202 | `/opt/potyro-requests` ← `packages/platform-requests` | — (memory) | `/etc/potyro/requests.env` | `handle_path /requests/*` |
| Share service | `potyro-share-links` | 4203 | `/opt/potyro-share-links` ← `packages/share-links` | `/var/lib/potyro/shares`; reads `/srv/potyro/site` | none yet (`-e` on the run line; `share-links.env` to be added) | `@share` (`/s/<id>`, its preview) and `handle /share-api/*` |
| AI relay | `potyro-ai` | 4204 | `/opt/potyro-ai` ← `packages/ai-relay` | `/var/lib/potyro-ai/ai-ledger.json` | `/etc/potyro/ai.env` | `handle_path /ai/*` |
| Rooms relay | `potyro-rooms` | 4205 | `/opt/potyro-rooms` ← `packages/rooms` | — (memory) | — (`-e` on the run line) | `handle /rooms/*` |
| The gallery | — (static files) | — | `/srv/potyro.com` ← `dist/gallery` | — | — | the `potyro.com, www.potyro.com` site |

Around it (the server itself, its DNS and the CI machine are the owner's notes, not part of this guide):

| | |
|---|---|
| Web server | Caddy 2.11.7, `/etc/caddy/Caddyfile` = [`deploy/potyro.app.Caddyfile`](../deploy/potyro.app.Caddyfile). It gets and renews every name's certificate itself (Let's Encrypt, account `ops@potyro.com`). No access log on potyro.app (Caddy keeps none unless told) and none on potyro.com (`output discard`). |
| Containers | All `node:22-bookworm`, `--restart unless-stopped`, published on `127.0.0.1` only, made by [`deploy/containers.sh`](../deploy/containers.sh). The code dirs under `/opt` are rsynced copies of the packages. |
| Secrets | `/etc/potyro/*.env`, root, mode 600. Their variables, never their values, are in [`deploy/env.example/`](../deploy/env.example/). |
| Deploy user | `deploy` (uid 1001) owns `/srv/potyro/site`. Each key in its `authorized_keys` is `restrict,command="/usr/bin/rrsync /srv/potyro/site"`: it can rsync into the site root and do nothing else. |

Being applied now (in `deploy/`, so in force once the owner reloads Caddy): the `/ai/*` route
streams with `flush_interval -1` and 310 s timeouts ([AI for apps](#ai-for-apps-docs23-deployed)),
and the shell's `try_files` serves `/privacy` and `/terms` as their pages
([The privacy page and the terms](#the-privacy-page-and-the-terms-117-built-not-yet-served)).

## What actually has to run

Two things, and only two:

| | |
|---|---|
| **The shell** | Static files from `vite build`. No server logic, no database, no API. |
| **The relay** | `jazz-run sync` — a websocket server that stores and forwards **encrypted** CoValues. It cannot read anything it holds. |

Everything else — the store, the runtime, the isolate, identity — runs in the browser. An app keeps
working with the relay down; it just stops reaching other people until it comes back.

Optional services sit beside them: the [request relay](#requests-to-the-potyro-team-263-deployed),
the [free AI allowance](#ai-for-apps-docs23-deployed) for apps, the [share links](#demo-links-and-their-previews-docs24-deployed)
and the [rooms relay](#rooms-for-multiplayer-apps-docs26-deployed) for multiplayer apps. All four
run on potyro.app. Without them requests wait on the device, apps' AI runs on the person's own key,
links carry the whole app, and multiplayer apps cannot meet.

Everything is on **one origin**. The shell derives its relay (`wss://<host>/sync`) and every service
(`/ai`, `/requests`, `/share-api`, `/rooms`) from the origin it is served from, so the proxy in front
routes paths and nothing is configured at build time. The services need no CORS for the site, only
for the native apps' WebViews (docs/27 §2.1).

---

## 1. Build the shell

```bash
pnpm i
pnpm --filter @potyro/shell exec vite build     # → packages/shell/dist  (~33 MB)
```

Build-time knobs, all optional:

| Variable | Default | When to set it |
|---|---|---|
| `VITE_POTYRO_RELAY` | same origin, `/sync` | Only if the relay is on a different host. |
| `VITE_POTYRO_GENERATOR` | unset | Only once a deployment can actually reach a model — see [The agent](#the-agent). |
| `VITE_POTYRO_SITE` | the page's own origin | **Native builds only** (Android, iOS): the site the app belongs to, e.g. `https://potyro.app`. The relay, `/ai`, `/requests`, `/share-api` and the links people send are derived from it (`shell/src/site.ts`, docs/27 §2.1); the per-service variables still win. |

potyro.app's build sets none of them: it is the watcher's plain `vite build` (CONTRIBUTING.md, The gate).

## 2. Upload it

```bash
rsync -az --delete packages/shell/dist/ potyro-deploy:
```

`potyro-deploy` is an ssh alias for the deploy user on the server, whose key `rrsync` locks to
`/srv/potyro/site`, so the target is relative to that root. `--delete` matters: without it, old
hashed assets accumulate forever. On your own server, any web root and any account that can write it.

## 3. Run the relay

```bash
sudo deploy/containers.sh relay      # on the server, from a checkout (the script's header says how)
```

The script writes `/opt/potyro-relay/package.json` with the `jazz-run` version pinned in the root
`package.json`, installs it in a throwaway Node 22 container, and runs:

```bash
docker run -d --name potyro-relay --restart unless-stopped \
  -p 127.0.0.1:4201:4201 \
  -v /opt/potyro-relay:/app -v /var/lib/potyro:/data -w /app \
  node:22-bookworm \
  node node_modules/.bin/jazz-run sync --host 0.0.0.0 --port 4201 --db /data/sync.db
```

It runs in a container because cojson needs Node **22**, whatever the server has, and the container
also sidesteps the `better-sqlite3` native build, the thing that makes `--db` fail on some machines.
Three details, each load-bearing:

- **`--db`, never `--in-memory`.** With in-memory storage a restart loses everything the relay was
  holding, and a peer that was offline at the time can never catch up — its edits and everyone
  else's diverge permanently. `pnpm dev` uses `--in-memory` because a dev relay has nothing worth
  keeping. Yours does.
- **`-p 127.0.0.1:4201:4201`** — published to loopback only, so the relay is reachable only through
  Caddy. Bound to `0.0.0.0` it would be an unauthenticated websocket on the internet with nothing in
  front of it, not even the proxy's TLS.
- **Pin the version.** `jazz-run` must match the `cojson` the shell was built against (`0.20.19`
  today). The script reads it from the repo's `package.json`, never `latest`.

`--restart unless-stopped` plus `systemctl is-enabled docker` → `enabled` means it comes back after
a reboot. The client reconnects on its own when the relay bounces.

### What the relay holds for a shared app's files (#255)

A shared app's files sync **on demand**: every member gets the folder's list at once (small: a path,
type, size and digest per file), and a file's bytes only when someone on a device opens it. That
is what the members' devices hold. The **relay** is different: the device that adds a file pushes
its bytes there, so the relay holds every byte of every file in every shared app — encrypted to
the space's members (it cannot read them), but stored. What that means for running it:

- **Disk grows with files, not with members.** One 40 MB video in a shared app is ~40 MB on the
  relay, however many people are in it.
- **Each shared space has a budget: 200 MB** (`SPACE_BUDGET` in `packages/store/src/jazz-store.ts`;
  owner, 2026-10-14). It counts every file byte the space ever put on the relay — replaced and
  deleted ones too, since the relay keeps them (the space's `usage` map, one entry per blob, written
  once by whoever wrote it, so members merge without double counting). A write that would pass it is
  refused before a byte is written, in plain words (`SpaceFullError`, from the app's `ctx.files.write`
  too); the Files tab offers to keep the file on that device only, outside the space, and says that
  removing files or earlier copies would not make room. The Files tab of a shared app shows the use
  ("Shared space: 12 MB of 200 MB used"). Bringing an earlier copy back costs nothing — its bytes are
  already there. Photos (`media` fields) are counted but not refused. A relay with more room can be
  given a bigger budget per device (`potyro:space-budget` in localStorage, bytes) until it is a
  setting. Size the relay's disk from it: spaces × 200 MB is the most files can take, next to the
  records and chat history the backups of #214 and the sizing of #287 already plan for.
- **Asked before, not refused:** a file over 10 MB going into a shared app is asked about first
  (`LARGE_FOR_SHARING`, owner 2026-10-14). There is no limit per file, only the space's budget.
- **Nothing is freed.** cojson keeps history: a deleted file disappears from every member's list,
  and its bytes stay on the relay. Replacing a file keeps the old bytes as an earlier copy for up to
  30 days (the last three), and after that the folder lets them go — on the devices; the relay
  still has them. Budget `--db` for everything ever added, and watch it (`du -sh /var/lib/potyro`).
- **Backups (#214).** A backup of the relay's database is a backup of every shared file's bytes too,
  in the same encrypted form; restoring it restores them. A person's own *export* of a shared app is
  not that: it packs the files whose bytes are on their device and lists the rest by path and size
  (`missingFiles` in the bundle's manifest), and never fetches them to complete itself.
- **The app's code never rides here.** Libraries' bytes and an app's own modules (`.modules/`,
  `.src/`) stay on each device (#281); a synced store refuses to put them in a space.

### Erasing a space or an account from the relay (#119)

For a person's request to erase what the relay holds of them (GDPR art. 17), or a shared space its
members want gone. `packages/store/scripts/erase-space.mjs` reads the database `jazz-run sync --db`
writes — cojson's SQLite storage — and needs Node 22.13 or later and nothing else.

**What it knows about the file.** Every CoValue is a row in `coValues` with a plain-JSON header; its
edits are rows in `sessions`, `transactions` and `signatureAfter`. A space is a cojson **group**
(header ruleset `group`); everything in it — its root, records, chat, the bytes of its files — is a
CoValue whose header names that group as owner (`ownedByGroup`). An account is a group whose header
says `account`. Group edits (who is a member, in what role) are plaintext; the space's content is
encrypted to its members and stays unreadable to the script, which never needs to read it.

**`--space <id>`** removes the group and every CoValue it owns — rows in all four tables, plus the
bookkeeping tables — in one transaction, then `VACUUM`s so the bytes leave the file. It says how many
other accounts were in the space: they lose it too. **`--account <id>`** removes what that account
alone holds: every space it created that nobody else is in, and — once no space left on the relay
names it — the account and its profile (its name). A space it created that others are in is listed,
not erased (erase it with `--space` once they agree), and so is the account while any remaining space
holds its edits or its membership: other members' devices need it to check those edits. Its edits
inside other people's spaces are never touched — they are part of those spaces.

```bash
# 0. Once: the script is one file with no dependencies.
rsync -az packages/store/scripts/erase-space.mjs <admin>@<server>:/opt/potyro-tools/
# 1. Ask first: the person removes the app from every device (for a shared space: every member does).
# 2. Stop the relay: the script refuses while it has the file open (it takes an exclusive lock).
docker stop potyro-relay
# 3. See what would go, then erase. Needs free disk the size of sync.db for the VACUUM.
docker run --rm -v /var/lib/potyro:/data -v /opt/potyro-tools:/tools:ro node:22-bookworm \
  node /tools/erase-space.mjs --db /data/sync.db --space co_z… --dry-run
docker run --rm -v /var/lib/potyro:/data -v /opt/potyro-tools:/tools:ro node:22-bookworm \
  node /tools/erase-space.mjs --db /data/sync.db --space co_z…
# 4. Start it again.
docker start potyro-relay
```

(`--account co_z…` the same way; `--json` for a machine-readable plan; `--no-vacuum` to skip the
rebuild, which leaves the erased bytes in free pages until the next `VACUUM`.)

**What it cannot do — say so to whoever asked:**

- **A device that still holds the space sends it back** the next time it syncs. Sync is two-way and
  the relay cannot tell a returning copy from a new one; `packages/store/test/erase-space.test.ts`
  shows it happen. So step 1 is not
  optional: an erase while a member still has the app is undone by that member's next edit.
- **Backups still hold it** (#214) until they age out. Say how long in the privacy text.
- **Finding the id.** An account's id is under You → Advanced ("Identity `co_z…`"). Nothing in the
  app shows a space's id yet: it is the `group` in the space's invite link (`#join=…` is base64 of
  URI-encoded JSON).
- **The person's other traces stay where they belong to others:** their membership entry and edits
  in spaces other people hold, and their name in those members' copies.

The lasting fix is in the product, not here: the space's admin deleting it from the app, with
cojson's own delete (a signed tombstone the relay keeps, after which it refuses the content back).
cojson 0.20 can delete a space's CoValues that way but not the group itself, and `jazz-run sync` does
not turn on erasing the content of deleted CoValues (`enableDeletedCoValuesErasure`). Not built.

## 4. Caddy in front

The whole file is [`deploy/potyro.app.Caddyfile`](../deploy/potyro.app.Caddyfile); it goes to
`/etc/caddy/Caddyfile`. The `potyro.app` block, without its comments:

```caddy
potyro.app {
	encode zstd gzip

	header {
		Content-Security-Policy "frame-src 'none'"
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	handle_path /sync* {
		reverse_proxy 127.0.0.1:4201
	}
	handle /rooms/* {
		reverse_proxy 127.0.0.1:4205
	}
	@share path_regexp share ^/s/[A-Za-z0-9_-]{22}(/preview\.(jpg|png))?/?$
	handle @share {
		reverse_proxy 127.0.0.1:4203
	}
	handle /share-api/* {
		reverse_proxy 127.0.0.1:4203
	}
	handle_path /ai/* {
		reverse_proxy 127.0.0.1:4204 {
			flush_interval -1
			transport http {
				response_header_timeout 310s
				read_timeout 310s
			}
		}
	}
	handle_path /requests/* {
		reverse_proxy 127.0.0.1:4202
	}

	handle {
		root * /srv/potyro/site
		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"
		@fresh path / /index.html /sw.js /privacy* /terms*
		header @fresh Cache-Control "no-cache"
		try_files {path} {path}.html {path}index.html /index.html
		file_server
	}
}
```

What each part is for:

- **`handle` blocks are exclusive.** A request goes to one of them only, the most specific that
  matches, and the block with no matcher (the shell) always comes last, so every service path is
  answered by its service and never by `index.html`. A path that reaches the shell by mistake looks
  like a working site and is a broken service: the Studio reads an HTML answer from `/requests/` as "not reachable" and keeps saving.
- **`handle_path` takes the prefix off; `handle` keeps it.** `jazz-run`, the AI relay and the request
  relay serve at their root (`/health`, `/complete`, `/platform-requests`). The rooms relay and the
  share service serve under `/rooms/` and `/share-api/` themselves.
- **Websockets need nothing.** `reverse_proxy` passes an upgrade through as it is, for `/sync` and
  `/rooms/`, and Caddy's defaults put no timeout on an open connection.
- **`frame-src 'none'`** on every response: the shell embeds no frame that fetches, and this is what
  stops a shared app's sandboxed frame navigating itself to a URL (#272, docs/22 §3.2).
  `index.html` carries the same as a `<meta>` for the native WebView, which serves no headers.
- **Cache headers.** Hashed assets are `immutable`; `index.html`, `sw.js` and the legal pages are
  `no-cache`, or a deploy stays invisible until someone clears their cache.
- **`try_files`** sends every path that is not a file to `index.html`, the app. `{path}.html` and
  `{path}index.html` are for the legal pages
  ([below](#the-privacy-page-and-the-terms-117-built-not-yet-served)).
- **Addresses.** Caddy's `reverse_proxy` sets `X-Forwarded-For` to the peer it saw and ignores what
  the client sent (no `trusted_proxies`), so the services count each address by the last entry. Leave
  `trusted_proxies` unset unless something (a CDN) stands in front of Caddy.

After any change:

```bash
caddy validate --config /etc/caddy/Caddyfile     # "Valid configuration"
sudo systemctl reload caddy                      # reload, not restart: open websockets are kept
```

## 5. Check it

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://potyro.app/                             # 200, no credentials
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://potyro.app/icon-512.png  # 200 image/png
curl -sI https://potyro.app/ | grep -i content-security-policy                           # frame-src 'none'
curl -s https://potyro.app/version.json                                                  # names the live commit
```

The icon **must** come back `image/png`. If it says `text/html`, the fallback to `index.html` is
answering real files, which is a broken PWA wearing a working site. Each service's own check is in
its section.

Then the only check that really counts, in two browsers:

1. Open the site on device A, and open an app (a built-in one is fine).
2. Share it. Answer the name prompt.
3. Open the link on device B. It should receive the app **source** and the **data** over sync.
4. Write on each side. Each should see the other without a reload.
5. `💬 Chat` should be present, and a message should arrive attributed to the other person **by name**.

If sync never connects, check the relay URL first: **⌾ You → Sync relay** shows the one in force.

## 6. Backups (#214)

`deploy/backup.sh` makes the copy. A restore from one has been performed
([the drill](#the-restore-drill), 2026-11-10). **The nightly run and the offsite copy are the
owner's to set up, and are not done yet:** until they are, the only copy is one made by hand, on
the server's own disk, which a lost server takes with it.

What holds state on the server:

| What | Where | |
|---|---|---|
| The relay's database | `/var/lib/potyro/sync.db` | every shared space, encrypted, and every shared file's bytes ([below](#what-the-relay-holds-for-a-shared-apps-files-255)). For anyone who turned on "Back up my apps" it is the only copy off their device. |
| The share links | `/var/lib/potyro/shares` | each link's sealed package and preview; a lost one answers 404. |
| The AI ledger | `/var/lib/potyro-ai/ai-ledger.json` | the month's spend; lost, the caps start the month again from zero. |
| The secrets | `/etc/potyro/*.env` | the owner's to keep, apart from the data, never in the repository and never in a backup. |

The Caddyfile, the containers and the code are in the repository and need no backup. The rooms
relay and the request relay keep nothing on disk.

### What the script does

Each night it writes `/var/backups/potyro/<date>/`: the relay's database through SQLite's online
backup (a consistent moment of a database that is being written, which a plain `cp` is not), checked
with `PRAGMA integrity_check`; the share links as one tar; the AI ledger. With `BACKUP_REMOTE` set it
copies the folder offsite with `rclone` (any remote rclone knows: an S3-compatible bucket, a storage
box over SFTP), encrypted first with `age` when `BACKUP_AGE_RECIPIENT` is set. It keeps the newest
seven days and the newest four Sundays, here and offsite, and fails when a disk is over 85% full.

A failure exits non-zero, says why, and with `ALERT_URL` set posts that line there. A good run
calls `OK_URL` when set: point it at a check that tells you when the nightly call did NOT come,
because a backup that silently stopped is found out on the day it is needed.

### Installing it (once, on the server)

```
sudo apt install sqlite3 rclone age
sudo rclone config                                  # name the offsite remote, as root
sudo install -m 600 deploy/env.example/backup.env.example /etc/potyro/backup.env   # then fill it in
sudo deploy/backup.sh                               # by hand, once: read what it says
echo '17 3 * * * root /opt/potyro-src/deploy/backup.sh >> /var/log/potyro-backup.log 2>&1' | sudo tee /etc/cron.d/potyro-backup
```

`bash deploy/backup.test.sh` checks the script against a scratch folder, on any machine with
`sqlite3`. It does not prove the offsite remote works; the first run by hand does.

### The restore drill

Do it once before relying on the backup, and again after any change to the relay or the script.
It runs beside the live relay and touches nothing of it.

1. Fetch a night's folder from offsite into a scratch folder, and decrypt it if it was encrypted:
   `rclone copy <remote>/<date> /tmp/drill && age -d -i <key file> -o /tmp/drill/sync.db /tmp/drill/sync.db.age`
2. Check it: `sqlite3 /tmp/drill/sync.db 'PRAGMA integrity_check;'` answers `ok`.
3. Start a scratch relay on it, on another port, with the relay's own pinned `jazz-run`:
   `docker run --rm -p 127.0.0.1:4299:4299 -v /opt/potyro-relay:/app:ro -v /tmp/drill:/data -w /app node:22-bookworm node node_modules/.bin/jazz-run sync --host 0.0.0.0 --port 4299 --db /data/sync.db`
4. Point a device at it and watch a real app arrive: a fresh browser profile on a build whose sync
   address is the scratch relay, signed in with an account's recovery words, offered its apps, one
   opened with its records in it. `e2e/restore-drill-trusted.spec.ts` does both ends with a
   throwaway account, from a checkout with the scratch relay's port forwarded
   (`ssh -N -L 4299:127.0.0.1:4299 <server>`): its `write` half before the backup is made (an
   account, an app that syncs through the live relay, one note), its `read` half against the
   scratch relay. Run `read` once more against a scratch relay on an EMPTY folder: it must fail,
   or the drill proved nothing.
5. Write the date and what was seen in the table below. Stop the scratch relay, delete the folder.

A real restore is the same, onto the real path: stop the relay (`docker stop potyro-relay`), put the
checked `sync.db` at `/var/lib/potyro/sync.db` (remove any `sync.db-wal` and `sync.db-shm` left
beside it), unpack `shares.tar` into `/var/lib/potyro`, copy the ledger back, start the relay.
Devices send again whatever they hold that the restored copy lacks; what existed only on the server
after the night of the copy is gone.

| Drill | Copy from | Result |
|---|---|---|
| 2026-11-10 | the same evening's copy, made by hand, from the server's own disk (no offsite yet) | `integrity_check` ok (9.2 MB database, 300 share-link files in the tar). A new account made an app with one note through the live relay; after the backup, a scratch relay on the copy alone gave a fresh device, signed in with the recovery words, the app and the note. Against an empty scratch relay the same steps failed, as they must. Not covered: the offsite leg, the encryption, unpacking the share links. |

## 7. Redeploying

- **The shell**: the watcher on the CI machine deploys every green `main` within minutes (CONTRIBUTING.md, The gate). No restart, no
  reload.
- **A service**: from a checkout on the server, `sudo deploy/containers.sh <name>` (or none for all).
  It copies the package again and restarts the container only if its code changed; a service's
  state on disk survives. After editing an env file, `sudo RECREATE=1 deploy/containers.sh <name>`:
  an env file is read when a container is created.
- **The relay** needs touching only when `cojson` changes version: bump `jazz-run` in the root
  `package.json` with it, and `sudo deploy/containers.sh relay` installs the new pin and restarts it.

## The agent

**A deployed build has the Studio, but not the `claude -p` engine.** `/__generate`, which `claude -p`
goes through, is a Vite *dev-server* middleware, so the route does not exist in a build, and the
shell offers that engine only where it does (`canGenerate` in `packages/shell/src/generate-client.ts`).
Everything else works on any build: the Studio opens (its source editor and History need no model),
and the agent writes and changes apps through whichever other engine the person chose in Model
settings — their own Anthropic or OpenRouter key, an OpenAI-compatible endpoint, the on-device model
or Chrome's built-in one (docs/00 "Engines"). A deployed build starts on OpenRouter
(`packages/shell/src/engine-store.ts`).

`VITE_POTYRO_GENERATOR=1` at build time is the switch for a deployment that stands up its own
`/__generate`. That is a piece of work, not a flag: an API key held server-side, plus auth and rate
limiting in front of it, or it is your bill and anyone's to spend. The free allowance meant for the
Studio and Ask is the AI relay's chat route instead ([AI for apps](#ai-for-apps-docs23-deployed)),
which the shell does not call yet.

## Requests to the Potyro team (#263): deployed

**Running on potyro.app**: container `potyro-requests`, port 4202, `/requests/*`
(`/requests/health` answered `{"ok":true}` on 2026-10-30).

When the Studio's agent finds that what someone asked for needs something Potyro itself lacks, it
writes a request in their words and the Studio offers to send it. People have no GitHub account, so
a small relay files it as an issue in `potyro-app/potyro`, labelled `platform-request`
(`packages/platform-requests`). **When the relay is not reachable, nothing is lost:** the Studio
says "couldn't send, saved to send later", keeps the request on the device, and sends it the next
time the Studio opens and `/requests/` answers.

The same relay carries **wording suggestions** (#300): You → Language → "Something reads wrong?
Suggest a better wording" sends the person's wording beside the words it would replace (their
English and the message's id), as a request of `kind: "translation"`, filed under the label
`translation` and grouped only with other suggestions. Until the relay runs they wait on the device
too, and go the next time You is opened.

What it accepts and does, so you know what you are putting on the internet:

| | |
|---|---|
| Route | `POST /platform-requests` (and `GET /health`). Nothing else. |
| What is in a request | The request's title and body in the person's words, the app's **structure** (its declaration as data, every function and piece of code shown as a marker — never its records), the app's name, the language, a request id and a random device id. |
| Size | 64 KiB a request, checked before parsing; per-part caps after (`LIMITS` in `src/request.ts`). Too long is refused, never cut. |
| Rate limit | 5 a day per device id **and** 20 a day per address (the last `X-Forwarded-For` entry, which Caddy sets), in memory. |
| Duplicates | A title that normalises to an open issue's under the same label (`platform-request`, or `translation` for a wording suggestion) (case, accents, punctuation, filler words, plurals and word order ignored) becomes a **comment** on that issue rather than a new one. |
| Retries | The same request id again gets the first answer back; it is filed once. |
| On the issue | The words quoted, marked as untrusted text, and the structure folded away. Never the device id or the address. |

The issues are public. The review card in the Studio says so before anyone sends one.

### 1. A token that can do one thing

A **fine-grained** personal access token (GitHub → Settings → Developer settings → Fine-grained
tokens): resource owner `potyro-app`, **only** the repository `potyro-app/potyro`, repository permission
**Issues: Read and write**, nothing else; an expiry you will notice. Then, once, the label:

```bash
gh label create platform-request -R potyro-app/potyro --color 5319e7 \
  --description "Asked for from the Studio: something Potyro itself does not offer yet (#263, #288)"
gh label create translation -R potyro-app/potyro --color 0e8a16 \
  --description "A better wording for Potyro's own words, suggested from You → Language (#300)"
```

On the server, out of the repository and readable by root only:

```bash
sudo mkdir -p /etc/potyro && sudo install -m 600 /dev/null /etc/potyro/requests.env
sudoedit /etc/potyro/requests.env     # the names in deploy/env.example/requests.env.example
#   GITHUB_TOKEN           the token above
#   POTYRO_REQUESTS_REPO   potyro-app/potyro
#   HOST                   0.0.0.0, inside the container; published to loopback only, below
#   PORT                   4202
```

### 2. Run it

Node 22 runs the TypeScript as it is (`--experimental-strip-types`); the package has no
dependencies, so there is nothing to install. `sudo deploy/containers.sh requests` copies
`packages/platform-requests` to `/opt/potyro-requests` and runs:

```bash
docker run -d --name potyro-requests --restart unless-stopped \
  -p 127.0.0.1:4202:4202 \
  --env-file /etc/potyro/requests.env \
  -v /opt/potyro-requests:/app:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-requests     # "[platform-requests] filing into potyro-app/potyro, listening on 0.0.0.0:4202"
```

Without `GITHUB_TOKEN` it refuses to start. `-p 127.0.0.1:…` keeps it reachable only through Caddy,
for the same reason as the sync relay.

### 3. Route it

`handle_path /requests/*` → `127.0.0.1:4202` ([§4](#4-caddy-in-front)). The prefix is taken off:
the relay answers `/platform-requests` and `/health`. Same origin, so the browser needs no CORS.

### 4. Check it

```bash
curl -s https://potyro.app/requests/health                                    # {"ok":true}
curl -s -X POST https://potyro.app/requests/platform-requests \
  -H 'content-type: application/json' -d '{}'                                 # 400 {"ok":false,…}
```

Then send one from the Studio for real (ask a change that needs, say, a barcode scanner), look at the
issue it opens, and close it. A request saved earlier on a device goes the next time that device
opens the Studio.

**The Android and iOS apps** are not on this origin, and this service sends no CORS headers, so
from them a request keeps waiting on the device (docs/27 §2.1).

**Updating it:** `sudo deploy/containers.sh requests`. Its rate limits and
its index of open issues are in memory; a restart forgets them, and the index is read again from
GitHub on the next request.

## AI for apps (docs/23): deployed

**Running at `https://potyro.app/ai/`**: container `potyro-ai`, port 4204, `/ai/*` (`/ai/health`
answered `{"ok":true}` on 2026-10-30). The running relay predates the chat route and the counts
(#468): on 2026-10-30 `POST /ai/v1/chat/completions` and `GET /ai/count` answered 404 there, so only
`/complete` and `/health` are live until the container is updated. Who pays: a **free allowance**
first, through a small relay that holds Potyro's OpenRouter key (`packages/ai-relay`), then the
person's own key from Model settings. It serves two kinds of request:

- **`POST /ai/complete`** — apps' AI (`ctx.caps.ai`): read a photo, a text or a recording. The relay
  decides everything but the parts. This is what the shell uses today.
- **`POST /ai/v1/chat/completions`** — the Studio and Ask, through the shell's Potyro engine (#121,
  docs/23). An OpenAI-shaped chat request, piped to OpenRouter, held to a per-device allowance in US
  dollars. The shell offers that engine only while `/health` says `chat: true`.

Beside them, `GET /ai/health` (`{"ok":true,"chat":…,"model":…}`: `chat` is the chat route on and
its kill switch not thrown, `model` the one it sends), and `POST`/`GET /ai/count` for the demand
counts (below).

If the relay is down, the shell gets the site's own page or a 404 back, and apps fall back to the
person's own key: "Free AI isn't available yet — add your own key in Model settings."

What it accepts and does, so you know what is on the internet:

| | |
|---|---|
| `/complete` | Exactly the payload `readAiPayload` takes: the host's instructions, the parts the app's call named (words, pictures resized to 1600 px, one recording), the JSON Schema for the answer, a token cap, a random device id. The model is `google/gemini-2.5-flash-lite` (or `AI_MODEL`), always; the token cap ≤ 4 000; `data_collection: "deny"`. No tools, no web search. 6 MiB a request; ≤ 4 pictures of ≤ 3 MiB; ≤ 40 000 characters of text; one WAV recording of ≤ 2.7 MB, never with a picture. Too big is refused, never cut. |
| `/complete` limits | 20 a day and 100 a month per device id, 60 a day per address, 2 at once per device. A request is counted when it is sent, whatever comes back. |
| Chat: what passes | `model` (from `AI_CHAT_MODELS` only), `messages`, `tools` and `tool_choice`, `reasoning`, `stream`, the sampling settings, `response_format`, `provider`. Messages, tools, tool calls and reasoning go on unchanged. Any other field is refused, not dropped (a `models` fallback list, a `user` id). |
| Chat: what the relay decides | `max_tokens` clamped to `AI_CHAT_MAX_TOKENS`, 64 000 by default (and set to it when absent): the Studio's high thinking level asks for that much, and what a request may cost is held to the allowances by the estimate below, not by the clamp; `provider.data_collection: "deny"`, `usage.include: true`. OpenRouter's server tools (a tool of type `openrouter:web_search`, `plugins`, `web_search_options`) are refused with `403 plan`, and a `:online` model is not in the list: they cost per call, and only a plan token may ask for them. **No plan exists yet**, so every one is refused; the seam is `planAllows` in `src/chat.ts`, fed by the `x-potyro-plan` header. |
| Chat: who it is | `Authorization: Bearer potyro-device:<id>`, the same random device id as `/complete`. Anything else is `401` with code `device`; the Studio's OpenRouter engine can point at `/ai/v1` with that token as its key. |
| Chat: money | Before dispatch, each with room for the most this request could cost (the **estimate**, below): the service's month and day, the device's month (`AI_DEVICE_MONTH_USD`), the address's day (`AI_ADDRESS_DAY_USD`, so a fresh device id per request does not get past it). That much (at least `AI_CHAT_RESERVE_USD`) is held while the request is out. After it, OpenRouter's `usage.cost` (from the final chunk when streamed) is charged; when the answer does not carry it, see "Chat: no cost reported" below. Used up — what was really **spent** leaves no room: `429` with `x-potyro-left-usd: 0` and a code (docs/23 "The chat route's refusals"). Busy — room is left, but the requests in flight hold it (the service's day or month, this address's day), or `AI_MAX_IN_FLIGHT` are out: `503` with code `service-busy` and `Retry-After: 5`, which the shell does not keep. An answer that went out carries `x-potyro-left-usd`: what the device had left before it. |
| Chat: no cost reported | Charged what the request can defensibly have cost, never more than its estimate (`src/chat.ts`, "WHAT A REQUEST WITHOUT A COST IS CHARGED"). OpenRouter never reached (the connection was not made): nothing. An error status with no cost (Potyro's key refused, a 5xx, a 400 or OpenRouter's own 429 passed back): nothing; no model wrote, and the sender got no answer. An answer that was **cut** (the sender went away, a timeout, the upstream broke off, before the first byte or mid-stream): the input side of the estimate, plus output tokens for the larger of the bytes of answer that came (one token a byte, which is more than they cost) and the seconds it was out × 300 tokens a second (what could have been written unseen), up to `max_tokens`. A whole 2xx answer with no cost: the full estimate. So leaving a stream just before its usage chunk pays for every byte received, and pressing Stop after two seconds pays for two seconds. |
| The estimate | Input: the body's characters / 4, as tokens, at the model's price per million input tokens; output: the request's `max_tokens` after the clamp at its price per million output tokens. Both on the high side (a picture's base64 counts as text). Prices are a small table in `src/prices.ts` — Gemini 2.5 Flash Lite $0.10/$0.40, DeepSeek V4 Flash $0.14/$0.28 a million tokens — overridden or added to with `AI_MODEL_PRICES`. A model the relay may send without a price stops it starting. A Studio turn at the high thinking level is held for about 2¢. `/complete` uses the same estimate: held while it is out, and charged for a failure, an empty answer or a missing `usage.cost` (its requests are small and cannot be left half-way). |
| Chat: the answer | Piped, not buffered: a stream and OpenRouter's `: OPENROUTER PROCESSING` lines reach the sender as they come. 300 s for the whole request, body included (the Studio's own timeout). 3 at once per device. A sender that goes away stops the request upstream. 4 MiB a request. Potyro's key refused or out of credit, or OpenRouter down, is `502` with code `upstream`; a refusal the sender can act on (a 400) comes back as it is. Neither ran a model, so neither is charged unless it reports a cost. |
| Spending caps | `AI_MONTHLY_CAP_USD` (default **$10**) for the whole service, both routes together, a calendar month (UTC), and `AI_DAY_USD` (default an eighth of it, $1.25) a calendar day (UTC), so one day cannot eat the month. Both are checked **before** each request with its estimate on top of what every request still out on either route holds (`src/budget.ts`). Past either by what was **spent**, every device is told "used up" and moves to its own key; past either only by what is held, the request is refused as busy (`503`, `Retry-After`) and nothing is remembered. At most `AI_MAX_IN_FLIGHT` requests (default 50) are out towards OpenRouter at once, both routes together; the next is busy too. A request that settles after its month or day ended is not counted (the ledger never goes back to an ended month); the relay logs how many. |
| Kill switch | The chat route answers `503` with code `off` and sends nothing while `AI_CHAT_OFF=1`, or while the file `AI_CHAT_OFF_FILE` names exists. Both are read on every request; the file needs no restart. `/complete` is not affected. |
| Counts (#118) | `POST /count {"event":"exhausted"\|"own-key"\|"want-plan"\|"visit"}`; `GET /count` returns `{"months":{"2026-10":{…}}}`. Numbers a month and nothing else. An address counts each event once a day and may post 20 times a day (`AI_COUNT_PER_ADDRESS_DAY`), checked in memory under a salted hash a restart forgets (an IPv6 address by its /64; at most 100 000 addresses remembered, each forgotten within a day and an hour). The relay counts `exhausted` itself the first time a device uses up an allowance in a month, so the shell need not post it after the relay's 429. |
| State | The month's spend, the day's spend, each device's `/complete` count and chat dollars, which devices used theirs up, and the counts per month, in `AI_LEDGER` (a JSON file), written on every change. A file from before the chat route still loads. A file it cannot read stops it starting. The per-device and per-address daily limits, and what requests in flight hold, are in memory. |
| Addresses | `TRUST_PROXY=caddy` (default): the last `X-Forwarded-For` entry. Caddy's `reverse_proxy` ignores the client's own `X-Forwarded-*` headers unless the peer is in `trusted_proxies` and sets the peer it saw, so with no `trusted_proxies` the header has one entry, and with them the peer is appended, last. A forged entry is never last. `TRUST_PROXY=none` ignores the header (the relay reached directly). Every per-address limit counts an IPv4 address as itself and an IPv6 address by its **/64** (`addressKey` in `src/address.ts`): a home or a phone is usually given a whole /64. An IPv4 address written as IPv6 (`::ffff:…`) is the IPv4 one. |
| CORS | The site's pages are the same origin and need none. The native apps' WebViews (`https://localhost` on Android, `capacitor://localhost` on iOS) are other origins: those, and only those (`AI_CORS_ORIGINS`), are answered, on every route, without credentials. |
| Logs | The upstream's status or error message only. Never a request's content, a device id or an address. |

At ~$0.0003 a receipt, $10 is ~30 000 photos a month; a Studio turn on DeepSeek V4 Flash is a cent
or less, so the default $0.50 a device is a few dozen apps built or changed. Set the same ceiling, or
a lower one, as the key's own **credit limit** on OpenRouter: that is the cap that holds even if this
code is wrong.

### 1. A key that can only spend a little

On openrouter.ai, under the Potyro account: Settings → **Keys** → Create key, named
`potyro-free-ai`, with a **credit limit** (e.g. $10). Settings → Privacy: leave model training and
logging **off**. On the server, out of the repository and readable by root only:

```bash
sudo install -m 600 /dev/null /etc/potyro/ai.env
sudoedit /etc/potyro/ai.env     # the names in deploy/env.example/ai.env.example
#   OPENROUTER_API_KEY     the key above
#   AI_MONTHLY_CAP_USD     10
#   AI_DAY_USD             1.25
#   AI_LEDGER              /data/ai-ledger.json
#   AI_CHAT_MODELS         deepseek/deepseek-v4-flash-0731
#   AI_DEVICE_MONTH_USD    0.5
#   AI_CHAT_OFF_FILE       /data/chat-off
#   TRUST_PROXY            caddy
#   HOST                   0.0.0.0, inside the container; published to loopback only, below
#   PORT                   4204
```

Every variable, with its default, is at the top of `packages/ai-relay/src/server.ts`. The new ones:

| Variable | Default | |
|---|---|---|
| `AI_CHAT_MODELS` | `deepseek/deepseek-v4-flash-0731` | Comma-separated; the only models the chat route sends. |
| `AI_PLAN_URL` | — | The plan's page, once there is one (#120). `/health` carries it as `plan`; a device that pressed "I'd pay for a plan" is told there, in the app (#118). Empty: no plan. |
| `AI_DEVICE_MONTH_USD` | `0.5` | One device's chat allowance a month. |
| `AI_DAY_USD` | `AI_MONTHLY_CAP_USD` / 8 | The whole service's spend a calendar day (UTC), both routes. |
| `AI_MODEL_PRICES` | — | JSON, `{"<model>": {"input": 0.14, "output": 0.28}}` in US dollars a million tokens, over the table in `src/prices.ts`. Use the dearest provider's price on OpenRouter. |
| `AI_MAX_IN_FLIGHT` | `50` | Requests out towards OpenRouter at once, both routes together. The next is answered `503` busy with `Retry-After: 5`. A chat request can be out for minutes, so this is about how many people may be waiting for an answer in the same moment. |
| `AI_ADDRESS_DAY_USD` | 4 × `AI_DEVICE_MONTH_USD`, at most `AI_ADDRESS_DAY_SHARE` of `AI_DAY_USD` | One address's chat spend a day (IPv6: its /64), whatever device ids it sends. A whole home, school or mobile carrier shares it. Must be below `AI_DAY_USD`, or it does not start. With the defaults: $0.25. |
| `AI_ADDRESS_DAY_SHARE` | `0.2` | The most of `AI_DAY_USD` one address may have when `AI_ADDRESS_DAY_USD` is not set (above 0, below 1): it takes five networks to close a day, not two. It only binds on a small budget: from `AI_DAY_USD` = $10 the four devices' months ($2) are the lower. Below `AI_DAY_USD` = $2.50 (a $20 month) one address's day is less than one device's month. |
| `AI_CHAT_RESERVE_USD` | `0.02` | The least a chat request is held for while it is out; more when its estimate is more. |
| `AI_CHAT_MAX_TOKENS` | `64000` | The clamp on `max_tokens`, the Studio's high thinking level. Reasoning comes out of it too. |
| `AI_CHAT_OFF` | — | `1` turns the chat route off. Changing it needs a new container. |
| `AI_CHAT_OFF_FILE` | — | While this file exists, the chat route is off. No restart. |
| `AI_COUNT_PER_ADDRESS_DAY` | `20` | `POST /count` from one address a day. |
| `AI_CORS_ORIGINS` | `https://localhost,capacitor://localhost` | Origins answered with CORS. |
| `TRUST_PROXY` | `caddy` | `caddy` or `none`; anything else stops it starting. |

### 2. Run it

No dependencies. Port **4204**: 4201 is the sync relay, 4202 the request relay and 4203 the share
links (docs/24). `sudo deploy/containers.sh ai` copies `packages/ai-relay` to `/opt/potyro-ai` and
runs:

```bash
docker run -d --name potyro-ai --restart unless-stopped \
  -p 127.0.0.1:4204:4204 \
  --env-file /etc/potyro/ai.env \
  -v /opt/potyro-ai:/app:ro -v /var/lib/potyro-ai:/data -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-ai     # "[ai-relay] google/gemini-2.5-flash-lite; chat deepseek/…; cap $10 a month, $1.25 a day; proxy caddy; listening on 0.0.0.0:4204"
```

Without `OPENROUTER_API_KEY` it refuses to start.

### 3. Route it (Caddy)

In the `potyro.app` site block ([§4](#4-caddy-in-front)):

```caddy
    # The free AI allowance (docs/23). The prefix is taken off: the relay serves /health,
    # /complete, /v1/chat/completions and /count.
    handle_path /ai/* {
        reverse_proxy 127.0.0.1:4204 {
            flush_interval -1
            transport http {
                response_header_timeout 310s
                read_timeout 310s
            }
        }
    }
```

`handle_path`, so `/ai/complete` reaches the relay as `/complete`. (The relay also accepts its routes
with the `/ai` prefix kept, so a `handle /ai/*` route works too; potyro.app's takes it off.)

**The timeout must match the relay's.** The chat route gives OpenRouter 300 s for the whole request,
so nothing in front of it may give up sooner: hence 310 s. If the site (or the global options'
`servers { timeouts { write … } }`) ever sets a shorter one, it must be over 300 s for `/ai/*`.
OpenRouter's keep-alive lines keep the connection busy while a model thinks; `flush_interval -1`
sends them, and each piece of a streamed answer, on at once. The site's `encode` covers this route
too; the streamed check below is what shows the pieces still arrive one by one. Leave
`trusted_proxies` unset unless something (a CDN) stands in front of Caddy: the relay's
`TRUST_PROXY=caddy` relies on the last `X-Forwarded-For` entry being the peer Caddy saw.

The `flush_interval` and the timeouts are in `deploy/potyro.app.Caddyfile` and were being put on
the server on 2026-11-01; until then the live route was a plain `reverse_proxy 127.0.0.1:4204`.

`caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`.

### 4. Check it

```bash
curl -s https://potyro.app/ai/health                                                # {"ok":true,"chat":true,"model":"…"}
curl -s -X POST https://potyro.app/ai/complete -d '{}' -H 'content-type: application/json'   # 400 {"ok":false,…}
curl -s -X POST https://potyro.app/ai/v1/chat/completions -d '{}' \
  -H 'content-type: application/json'                                               # 401 {"ok":false,"error":"device"}
curl -s https://potyro.app/ai/count                                                 # {"ok":true,"months":{…}}
sudo cat /var/lib/potyro-ai/ai-ledger.json                                          # after a real request
```

Then, with no key in Model settings, open Receipt Split (`apps/receipt-split`), **Read a receipt**
with a real photo, and check the items and the ledger's spend. For the chat route, one streamed
request with a made-up device id:

```bash
curl -sN https://potyro.app/ai/v1/chat/completions \
  -H 'authorization: Bearer potyro-device:check-0001' -H 'content-type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash-0731","stream":true,"max_tokens":20,"messages":[{"role":"user","content":"Say hi"}]}'
```

The `data:` lines should arrive one by one, the last before `[DONE]` carrying `usage.cost`, and the
ledger's `deviceUsd["check-0001"]` should then hold that cost.

### Turning the chat route off

```bash
sudo touch /var/lib/potyro-ai/chat-off      # off at once: 503 {"error":{"code":"off",…}}
sudo rm /var/lib/potyro-ai/chat-off         # on again
```

Nothing restarts. The shell, once it sends this route (E1/E3), is to treat the 503 like an
unreachable relay and move to the person's own key. `/complete` keeps working; to stop it too, stop
the container.

**The Android and iOS apps** are not on this origin: build them with
`VITE_POTYRO_AI=https://potyro.app/ai`. Their WebView origins are answered with CORS (above), so the
same requests work there.

**Changing the model** for apps is `AI_MODEL` here, plus `AI_MODEL` in `src/request.ts` for the
person's own key; pick one with image input and structured outputs on OpenRouter. For the chat route
it is `AI_CHAT_MODELS`; the Studio must ask for a model in that list.

**Updating it:** `sudo deploy/containers.sh ai`. The ledger survives. This is also what brings the
chat route and the counts to potyro.app, while the running relay is older than them (above).

## Demo links and their previews (docs/24): deployed

**Running on potyro.app**: container `potyro-share-links`, port 4203, `/s/<id>` and `/share-api/*`
(`/share-api/health` answered `{"ok":true}` on 2026-10-30). It runs without its env file so far:
no `SHARE_ADMIN_TOKEN` (links are taken down on the server) and no `SHARE_ABUSE_CONTACT` (a
taken-down link names `contact@potyro.com`).

A demo link opens an app running in the browser with sample records, and a chat shows a preview
card for it (title, one line, a picture). The site is static, so the preview needs a small service
beside the relay: `packages/share-links`. **Where it is not running, nothing breaks:** the shell sees no
`/share-api/health` and makes the *inline* form of the link (`/#try=…`). That form carries the
whole app in the fragment, works on the static site as it is, and has no preview. Each link is
10–20 KB, and some messengers cut a link that long (Telegram stops at 4096 characters).

What the service accepts and does:

| | |
|---|---|
| Routes | `POST /share-api/shares`, `GET /share-api/shares/<id>/payload`, `DELETE /share-api/shares/<id>` (with `x-delete-token`), `DELETE /share-api/admin/shares/<id>` (the operator's takedown, [below](#taking-a-link-down)), `GET /share-api/health`, `GET /s/<id>` (the shell's `index.html` with the link's Open Graph and Twitter meta written in), `GET /s/<id>/preview.jpg`. |
| What it holds | Per link: the **sealed** app package (AES-GCM, ≤ 2 MiB). The key is in the link's fragment and never reaches the service. Beside it, what the sharer's device made public for the preview: a title (the app's name), one line, a language, and a 1200×630 JPEG or PNG of ≤ 300 KB drawn from **demo** records. It also keeps the sha256 of the token that takes the link down. For a link the operator took down: only the time and the reason. |
| Checks | Body size before parsing, then each part. The picture is checked by its first bytes (JPEG/PNG only). Meta text is cleaned and capped, and HTML-escaped where it goes into the page. Ids are 128 random bits. |
| Limits | Per address and per day, in memory: 30 links made, 300 packages fetched, 2000 link pages and pictures; an IPv6 /48 eight times that. For the whole service: 2 GB of new links a day, and none while the disk would have under 1 GB free ([below](#limits-per-address)). |
| Pages | `noindex, nofollow` (header and meta). A link is for whoever it was sent to. |
| It never | runs app code or reads a package. It has no accounts and no list of links. |

### 1. Run it

Node 22 runs the TypeScript as it is, and the package has no dependencies. It reads the built
shell's `index.html` (read-only) on every request, so a deploy shows at once.
`sudo deploy/containers.sh share-links` copies `packages/share-links` to `/opt/potyro-share-links`
and runs:

```bash
docker run -d --name potyro-share-links --restart unless-stopped \
  -p 127.0.0.1:4203:4203 \
  -e HOST=0.0.0.0 -e PORT=4203 \
  -e POTYRO_SHARES_DIR=/data -e POTYRO_SHELL_INDEX=/site/index.html \
  -e POTYRO_PUBLIC_ORIGIN=https://potyro.app \
  --env-file /etc/potyro/share-links.env \
  -v /opt/potyro-share-links:/app:ro -v /var/lib/potyro/shares:/data -v /srv/potyro/site:/site:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-share-links   # "[share-links] keeping shares in /data, page from /site/index.html, listening on 0.0.0.0:4203"
```

The `--env-file` line is there only when `/etc/potyro/share-links.env` exists; it does since 2026-11-01.

`POTYRO_PUBLIC_ORIGIN` is what preview URLs are built on. Crawlers need absolute `https://` URLs,
and the service does not read the scheme from the request.

`/etc/potyro/share-links.env` (mode 600, owned by root; the names in
`deploy/env.example/share-links.env.example`) holds the one secret, `SHARE_ADMIN_TOKEN` (made with
`openssl rand -base64 33`), and the report address: `SHARE_ABUSE_CONTACT=abuse@potyro.com`, the address the
terms name (the same one as `abuse` in `packages/shell/src/contacts.json`). Until it is set — or
while it is still a placeholder like `<ABUSE EMAIL>`, which the service says in its log at start —
a taken-down link's page names `contact@potyro.com`. The token is the operator's token for taking a
link down over HTTPS ([below](#taking-a-link-down)); at least 32 characters, or the service will not
start. Leave it out and the takedown route does not exist; links are then taken down on the server
itself. It is in a file, not on the command line, so it is not in `ps`, the shell's history or
`docker inspect`'s `Cmd`. The service never logs it. Adding the file changes the container's run
line, so the next `sudo deploy/containers.sh share-links` re-creates it; after editing it,
`sudo RECREATE=1 deploy/containers.sh share-links`.

`TRUST_PROXY` is unset, so the default, `caddy`: it believes the LAST `X-Forwarded-For` entry,
which Caddy writes; anything before it is what the client sent. `none` ignores the header (a service
reached directly). The rule and its test are the AI relay's (`packages/share-links/src/address.ts`
is a copy of `packages/ai-relay/src/address.ts`).

### 2. Route it, before the shell

`@share` (`^/s/<22 characters>(/preview.jpg|png)?/?$`) and `handle /share-api/*` →
`127.0.0.1:4203`, both keeping the path ([§4](#4-caddy-in-front)). Previews need these routes open
to anyone: WhatsApp, Telegram, iMessage, Discord and X fetch `/s/<id>` and the picture without
credentials, so a gate in front of these routes would cut every preview.

### 3. Check it

```bash
curl -s https://potyro.app/share-api/health                                   # {"ok":true}
```

Then make a link from a tile (*Share → Make the link*). It should look like `/s/<id>#k=…`, and the
sheet should not say "without a preview picture". Check:

- `curl -s https://potyro.app/s/<id> | grep og:` shows the title and the image URL.
- The image URL answers `image/jpeg`.
- Pasting the link into a chat shows the card.

**Disk:** links are never expired. Budget about 20–60 KB per link (sealed package + picture);
`du -sh /var/lib/potyro/shares` to watch it. No more than 2 GB of new links a day are kept, and none
while the disk would have under 1 GB free ([Limits per address](#limits-per-address)).

### Taking a link down

For a notice about illegal content (the terms' "Reporting illegal content", to the report address),
or anything else the terms say may be removed. **Who may run it:** the operator — whoever holds
`SHARE_ADMIN_TOKEN` or a shell on the server. Today that is the owner, alone. Say why every time:
the reason is kept with the takedown, with no end date. Keep it to what was decided and why (the
notice's date, the rule or law); the reporter's name and address stay in the mail, not here.

From anywhere, over HTTPS, once `SHARE_ADMIN_TOKEN` is set (it is not yet on potyro.app; Node 18
or later; a whole link is fine, its key after `#` is never sent).
Paste the token at the silent prompt, so it is in neither the screen nor the shell's history. The
script sends it only to an `https://` site (or to this machine):

```bash
read -rs SHARE_ADMIN_TOKEN && export SHARE_ADMIN_TOKEN
node packages/share-links/scripts/takedown.mjs \
  'https://potyro.app/s/<id>#k=…' --reason "notice of 2026-11-02 from …: …" --site https://potyro.app
# Taken down: <id>. The link now answers 410.
unset SHARE_ADMIN_TOKEN
```

On the server, straight into the shares folder (no token needed):

```bash
docker exec potyro-share-links node --experimental-strip-types scripts/takedown.mjs <id> --reason "…" --dir /data
```

Both do the same: `taken-down.json` (the time and the reason) is written into the link's folder
first, then its `meta.json`, `payload.bin` and `preview` are removed. From then on:

- `GET /s/<id>` answers **410** with a page that is not the shell: "This link was taken down. The
  app behind it was removed from Potyro. If you think this was a mistake, write to
  `SHARE_ABUSE_CONTACT`." — in the visitor's language (English, Portuguese, German, Spanish, Italian,
  Polish), with no script and nothing of the link: no title, no picture, no preview tags. Without
  `SHARE_ABUSE_CONTACT` (or with a placeholder in it) it names `contact@potyro.com`.
- The package and the picture answer 410 too, and the sharer's own `DELETE` answers 410: it cannot
  bring the link back or turn it into a 404.
- Where the shell itself opens the link instead of this page (a shell already running, a build
  whose pages are on the device), it gets the 410 from the package, and its splash says the link
  was taken down and where to write. No device answers either from its own cache: the service
  worker never serves `/s/…` or `/share-api/…` from its cache. That rule comes with the PWA work
  (`packages/shell/public/sw.js`), which this needs: until it is in, a device that opened the link
  before can keep opening the package it kept.

Check: `curl -s -o /dev/null -w '%{http_code}' https://potyro.app/s/<id>` → `410`. The record:
`cat /var/lib/potyro/shares/<first two characters of id>/<id>/taken-down.json`.

What it cannot reach: a chat app that already drew the link's card keeps its own copy of the
picture and title; the service now serves the picture with `max-age=3600`, so browsers and caches
that obey it let go within the hour. There are no accounts, so the sharer is not told
(docs/legal/terms.md says so). A link its sharer removed (the delete token kept on their device,
`potyro:shares`) answers 404 instead: nothing is kept of it.

The takedown is the mechanism; the notice-and-action path around it (reading the report, deciding,
answering the reporter) is the operator's, and the DSA note on it still applies.

### Limits per address

Each address (an IPv6 address counts as its /64: one home or phone is usually given a whole /64)
gets, per calendar day in UTC, in memory. An IPv6 /48 is counted as well, at eight times each
limit for all its /64s together: a household is often given a /56 and a server a /48, which would
otherwise be hundreds or thousands of "addresses".

| What | Default | Env | Code when it is reached |
|---|---|---|---|
| Links made (`POST /share-api/shares`; a malformed one does not count) | 30 | `SHARE_CREATE_PER_ADDRESS_DAY` | `too-many-links` |
| Packages fetched (`GET …/payload`, up to 2 MiB each: one per demo opened) | 300 | `SHARE_PAYLOAD_PER_ADDRESS_DAY` | `too-many-opens` |
| Link pages and preview pictures (`GET /s/…`, which chat apps fetch for their cards) | 2000 | `SHARE_PAGE_PER_ADDRESS_DAY` | `too-many-pages` |
| Takedowns with a wrong operator token | 10 | — | `too-many-tries` |

A refusal is `429` with `retry-after` (seconds to midnight UTC) and JSON:
`{"ok":false,"code":"too-many-opens","error":"Too many apps were opened from this address today. Try again tomorrow."}`.
The shell says it in the person's language — "Too many apps were opened from this network today.
Try again tomorrow, or on another network." — with Try again. A link's own page (`GET /s/<id>`),
which a person opened in a browser, is not JSON: it is a short page in their language, with no
script, saying how many hours until they can try again. An address out of wrong-token tries is
refused whatever token it sends, the right one too: the limit is on guesses, not on error messages.

For the whole service, from every address together:

| What | Default | Env | Code when it is reached |
|---|---|---|---|
| Bytes of new links (package + picture) kept a day | 2 000 000 000 | `SHARE_STORED_BYTES_DAY` | `full-today` (503, `retry-after` to midnight UTC) |
| Free disk left after a new link, at least | 1 000 000 000 | `SHARE_MIN_FREE_BYTES` | `no-room` (503, `retry-after: 3600`) |

Either says so in the service's log, at most once an hour. Links already made keep opening; only
new ones are refused, and the sharer's device then makes the link that carries the app itself.
`/share-api/health` is never limited. At most 100 000 addresses are counted at once; past that the
one counted longest ago starts its day again. A restart starts every count again. The pages limit is
high on purpose: one chat service's crawler fetches the cards of everyone who pastes a link there.

## Rooms for multiplayer apps (docs/26): deployed

First deployed 2026-10-16; **running on potyro.app**: container `potyro-rooms`, port 4205,
`/rooms/*` (`/rooms/health` answered ok on 2026-10-30, and an upgrade with
`Origin: https://potyro.app` got 101 where `https://apps.vaz.io` got 403).

Real-time multiplayer apps (the first is a draw-and-guess game whose rooms are joined by a share
link) need a server that passes messages between the people in a room. `packages/rooms` is that
server: `wss://<site>/rooms/<roomId>`, every frame one member sends goes as-is to the others,
plus a small presence envelope (who is here, who joined, who left). The protocol, written for app
authors, is [docs/26](26-rooms-relay.md). Apps reach it through `ctx.caps.network.room(id)`
(docs/28), which connects to the site's own `/rooms/` — the native app to its `VITE_POTYRO_SITE`'s;
`VITE_POTYRO_ROOMS` at build time names another. **Until the relay runs, joining a room is refused**
(the app hears `"refused"`), and nothing else breaks.

What it accepts and does, so you know what you are putting on the internet:

| | |
|---|---|
| Routes | A websocket on `/rooms/<roomId>` (22–64 base64url characters, the app's random id), and `GET /rooms/health`. Nothing else: any other path is a 404, a room path without the upgrade a 426. |
| What it holds | Only what is live, in memory: the rooms that have members, each member's random id and display name, and per-address counts. **Nothing on disk.** A room is gone when its last member leaves. |
| What it reads | Each frame's size and rate, and whether a text frame begins with the envelope's reserved prefix. Never the payload. |
| Limits | 64 KiB a message, 16 members a room, 8 rooms and 64 connections at once per address, 30 messages/s (bursts of 60) and 64 KiB/s (bursts of 256 KiB) per connection, 1 MiB queued for a slow member, 2000 rooms and 5000 connections in all; a room with no message for 30 minutes is closed. Each one closes with its own code (docs/26 §3). |
| Address | The **last** `X-Forwarded-For` entry — the one Caddy writes. The first entry is whatever the client sent, so it is never used for limits. |
| Origins | By default browsers only from `https://potyro.app`, `https://localhost` (the Android app) and `capacitor://localhost` (`DEFAULT_ORIGINS` in `src/server.ts`); anything else gets HTTP 403 on the upgrade. potyro.app's container sets the same list in `ROOMS_ORIGINS`. |
| Keepalive | A ping every 30 s; a member that has not answered the last one is dropped. That also keeps a quiet room's connection from looking idle to anything in between. |
| Logs | Its own start and stop. Never a payload, a room id, a name or an address. |

### 1. Run it

Port **4205**: 4201 is the sync relay, 4202 the request relay, 4203 the share links, 4204 the AI
relay. Unlike those, this package has **one dependency**, the `ws` websocket library (pinned in its
`package.json`), so it needs one `npm install`, the way the sync relay does.
`sudo deploy/containers.sh rooms` copies `packages/rooms` to `/opt/potyro-rooms` (never
`node_modules`, so the server's installed `ws` stays and the laptop's pnpm links never arrive),
installs `ws` in a throwaway Node 22 container when the package changed, and runs:

```bash
docker run -d --name potyro-rooms --restart unless-stopped \
  -p 127.0.0.1:4205:4205 \
  -e HOST=0.0.0.0 -e PORT=4205 \
  -e ROOMS_ORIGINS=https://potyro.app,https://localhost,capacitor://localhost \
  -v /opt/potyro-rooms:/app:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-rooms   # "[rooms] origins https://potyro.app https://localhost capacitor://localhost, listening on 0.0.0.0:4205"
```

No secrets, so no env file. `-p 127.0.0.1:…` keeps it reachable only through Caddy, for the same
reason as the sync relay.

Every limit is an environment variable (`ROOMS_MAX_MEMBERS`, `ROOMS_MESSAGES_PER_SECOND`, …, the
full list at the top of `src/server.ts`); a value that is not a positive number stops it starting.
`ROOMS_ORIGINS` replaces the origin list (comma-separated, or `*`). To change one, add it to the
`docker run` line in `deploy/containers.sh` and run the script again: a changed line re-creates the
container.

### 2. Route it

`handle /rooms/*` → `127.0.0.1:4205`, the path kept ([§4](#4-caddy-in-front)). The upgrade is passed
through as it is, the query string (`?name=`) too, and `/rooms/health` answers over plain http.
potyro.app has no gate, so the native apps, which are other origins and send no credentials, reach
it as the site does.

### 3. Check it

```bash
curl -s https://potyro.app/rooms/health        # {"ok":true,"rooms":0,"connections":0}

# a real upgrade: expect "HTTP/1.1 101 Switching Protocols", then the welcome frame's text
ROOM=$(head -c16 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')
curl -s --http1.1 -i -N --max-time 3 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: https://potyro.app' \
  "https://potyro.app/rooms/$ROOM?name=check"
```

The second should print `{"potyro-rooms":1,"type":"welcome",…}` after the headers. A `200` with HTML
instead means the shell's route answered first; a `403` means the `Origin` is not on the list.

**Updating it:** `sudo deploy/containers.sh rooms`. A restart closes every
member with 1001 ("relay restarting"); apps reconnect, and since nothing was kept, nothing is lost
but the current member ids.

## The site on potyro.com (#8): the home, the gallery at /apps/, the legal pages

potyro.com is one static folder, built by `pnpm site:build` into `dist/site/`: the home
(`site/src/home.mjs`, the words in `site/words.json`, in Potyro's six languages; the docs and the Learn-more pages are English), the gallery page at `/apps/` (the same
`gallery/src/build.mjs` page, its files at the root), the privacy page and the terms when their
texts are ready, and beside them the design system's tokens and fonts, the colour clock, the logo,
the apps' screenshots (`gallery/shots`, `site/shots`) and the recordings (`site/media`). Nothing runs
on the server for it, it keeps no logs, and it loads nothing from anyone else, so it is served
with a strict policy: no inline style, no inline script, and `media-src 'self'` for the clips.

The recordings are made by `e2e/site-recordings-trusted.spec.ts`, which runs only when asked
(`POTYRO_SITE_RECORD=1 POTYRO_E2E_PORT_BASE=5100 pnpm exec playwright test
e2e/site-recordings-trusted.spec.ts --project trusted`): the real product on a phone-sized screen,
every model answer replayed from a saved one, so a re-shoot after a UI change costs nothing. It
writes the clips and marks into `dist/site-recordings/`; cut them from the marks (the two phones
are filmed through the browser's screencast, so they share one clock) and copy them into
`site/media/`.

```bash
pnpm site:build                       # → dist/site/ (refuses gallery data with a problem, or a missing picture)
rsync -av --delete dist/site/ <admin>@<server>:/srv/potyro.com/
```

By hand, with an account that can write `/srv/potyro.com`: the deploy key cannot, since `rrsync`
holds it to the app's web root. Nothing deploys the site automatically. The Caddy block is
`potyro.com, www.potyro.com` in [`deploy/potyro.app.Caddyfile`](../deploy/potyro.app.Caddyfile):
`file_server`, `no-cache` on the pages, a day's cache on the files (the pages name their
stylesheets and scripts with `?v=<hash>`), `/gallery/*` → `/apps/`, and `log { output discard }`.

## The gallery's links (docs/24 §10)

The gallery page lists the apps in `gallery/gallery.json` with the demo link each one opens.
`pnpm gallery:build` still writes the page alone into `dist/gallery/` (the tests use it); on
potyro.com it is the site's `/apps/`.

### 1. Make the links (once per change to the list, from a machine with a browser)

```bash
# Against the real site. It adds each ready app the way a person does, makes its demo link from the
# tile's Share sheet, opens the link as a stranger (sealed, named, no console errors, and the remix
# link opens Make it mine), screenshots it, and writes the link and screenshot into gallery.json.
# An app with a link on this site already keeps it; --refresh makes new ones.
pnpm gallery:publish --site https://potyro.app
git add gallery/gallery.json gallery/shots && git commit -m "chore(gallery): links for potyro.app"
```

The publishing browser is new and empty, so the links carry no one's name unless `--by "Potyro"` is
passed, and no records but the apps' own samples (docs/24 §3). The share service limits each address to
30 links a day; one run makes at most one per ready app.

### 2. Build and upload

`pnpm site:build` and the rsync above: the gallery page goes up with the site.

### 3. Serve it (Caddy)

The site's block (above). Its policy:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
media-src 'self'; base-uri 'none'; form-action https://potyro.app; frame-ancestors 'none'
```

`img-src data:` is for the page's paper grain, an inline SVG; `font-src 'self'` for its own fonts;
`media-src 'self'` for the home's recordings. `form-action https://potyro.app` is for the one form,
the "describe an app" box, which opens the app with the words. The gallery page's data is a
`<script type="application/json">` block, which a CSP does not treat as a script. There is no
inline script or style anywhere, so it needs nothing looser.

### 4. Check it

```bash
curl -sI https://potyro.com/ | grep -i content-security-policy
curl -s https://potyro.com/ | grep -c 'potyro.app/s/'       # one Try it and one Make it mine per app
```

Open it in a private window with the network panel open: every request should go to potyro.com. Then
tap one card's **Try it** (the app opens sealed) and **Make it mine** (the Make it mine card opens over it).

## The privacy page and the terms (#117): built, not yet served

`/privacy` and `/terms` are static pages made from `docs/legal/privacy.md` and `terms.md` by
`packages/legal` (docs/legal/README.md). **While either text still has a placeholder, an open point
in words ("to confirm", "to decide", "to verify"), no `Effective: YYYY-MM-DD` line, or its Draft
note, no build makes them**: `vite build` and `pnpm gallery:build` print one line instead
(`legal: /privacy and /terms not built: …`) and the app and the gallery link nothing. That is the
state of main today (2026-11-01: both texts still have placeholders and the Draft note), and both
sites deploy as they always have.

Once the owner has filled the texts, the next build of each site has them, with nothing to set:

- **potyro.app** (the watcher's `vite build`): `privacy.html`, `privacy/index.html`, the same for
  terms, and `legal/` in `packages/shell/dist`. The shell's route serves them:
  `try_files {path} {path}.html {path}index.html /index.html` answers `/privacy` with `privacy.html`
  and `/privacy/` with `privacy/index.html`, and `@fresh` marks them `no-cache`. A plain
  `try_files {path} /index.html`, as the server had until 2026-11-01, answers both with the app:
  try_files matches a path without a trailing slash only against files, and `privacy` is a directory
  (checked with Caddy 2.11.7).
- **potyro.com** (`pnpm site:build`, rsync as above): `privacy/index.html`, `terms/index.html`
  and `legal/` beside the home and the gallery. The `file_server` serves them as they are (`/privacy` redirects
  to `/privacy/`). They have no script and no inline style, so the CSP above holds. They are not in
  the block's `no-cache` rule yet: add `/privacy/* /terms/*` to `@page` when they are first served.

The service worker serves a navigation network first, so `/privacy` comes from the server whenever
the device is online; offline it is the copy from the last visit, or the app if there is none. Every
file a page loads (the stylesheets, the fonts, the logo) is named by a hash of its bytes
(`legal/legal.<hash>.css`, `legal/fonts/figtree-latin.<hash>.woff2`, with `tokens.css` rewritten to
those names), so the worker's cache-first copy of one is never stale.

```bash
curl -s https://potyro.app/privacy | grep -c 'data-legal="privacy"'   # 1, not the app's index.html
curl -s https://potyro.app/terms   | grep -c 'data-legal="terms"'     # 1
curl -sL https://potyro.com/privacy | grep -c 'data-legal="privacy"'  # 1
```

## What this does NOT protect

Be straight with anyone you invite:

- **The relay is unauthenticated** (KA-29). On potyro.app, which has no gate, nothing is in front of
  it (`/sync` upgrades without credentials, checked 2026-10-30). Anyone who reaches it can push and
  fetch CoValues by id — they cannot *read* them (everything is encrypted to the space's members, and
  the decryption key travels in a URL fragment that never reaches the server), but they can consume
  storage.
- **You can see the social graph** (KA-33). Transactions are encrypted; group and account metadata
  are not. As operator you can see which accounts share which spaces, and when they are active. Do
  not claim "we can see nothing" — it is not true yet.
- **No quotas, no metering, no abuse controls.** The log grows with every edit and nothing compacts
  it (KA-30). A chatty pair can out-transaction the app's own data, permanently, on your disk.
  (The share service has per-address limits a day, [Limits per address](#limits-per-address); the
  relay has none.) Erasing a space is by hand, with its limits:
  [Erasing a space or an account from the relay](#erasing-a-space-or-an-account-from-the-relay-119).
- **Anyone with a share link is in.** The invite secret is the whole capability; there is no second
  factor and no way to revoke one link short of rotating the space's keys (KA-17).
- **No backups yet** ([§6](#6-backups-214)). A lost disk is every shared space and every link.
- **The first load is ~2.1 MB gzipped.** Not a security issue, but it is what a phone on mobile data
  will feel first.

## Verifying a build before it ships

`pnpm test:e2e:prod` builds the shell for real, serves it with `vite preview`, and asserts what only
a deployed build can be wrong about: that there is a relay URL, that it can be changed without
devtools, that no agent surface is offered, and that a built-in app runs with no server behind it.
The dev server hides every one of those by construction — which is why KA-28 existed at all.

