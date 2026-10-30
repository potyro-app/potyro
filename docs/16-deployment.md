---
title: Deployment
description: Deploying the shell, the sync relay and the optional services on your own domain, as it was done.
status: current
order: 16
---

# Deploying Potyro on your own domain (KA-34)

**`https://potyro.app` is the live deployment**: public, with no gate in front of it, the shell, the
sync relay and all four optional services answering there (each section below says what was checked,
and when). It runs on its own server behind Caddy, whose configuration is not in this repository.

The recipe below was **written by deploying `https://apps.vaz.io`**, the first site and a private
test: Apache, gated with basic auth so only invited people could reach it, the relay not exposed on
its own. It is a real recipe, not a sketch — the awkward parts are the ones that actually bit — and
it is how to put Potyro on a domain of your own; its paths and hostnames are that deployment's.
`apps.vaz.io` itself has not been updated since 2026-10-17 ([Redeploying](#redeploying)). Read
[What this does NOT protect](#what-this-does-not-protect) before pointing anyone at either shape.

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
and the [rooms relay](#rooms-for-multiplayer-apps-docs26-deployed) for multiplayer apps.
Each section says what is running on potyro.app. Without them requests wait on the device, apps' AI runs on
the person's own key, links carry the whole app, and multiplayer apps cannot meet.

## The deployments, as configured

**potyro.app** (live): host `65.109.228.5`, web root `/srv/potyro/site` (§8), Caddy in front, no
gate. Checked 2026-10-30: `/` answers 200 without credentials, `/sync` upgrades, and `/ai/health`,
`/share-api/health`, `/rooms/health` and `/requests/health` answer ok.

**apps.vaz.io** (the private test this recipe was written on; not updated since 2026-10-17):

| | |
|---|---|
| Host | `vaz.io` (Debian 13), Apache 2 already serving ~28 other vhosts |
| Site | `/var/www/karta` ← `packages/shell/dist` |
| Relay | Docker container `potyro-relay`, `127.0.0.1:4201`, db at `/var/lib/potyro/sync.db` |
| Vhost | `/etc/apache2/sites-available/apps.vaz.io.conf` |
| Gate | Basic auth, `/etc/apache2/karta.htpasswd`, user `potyro` |
| TLS | the existing **wildcard** `*.vaz.io` certificate — nothing new to issue or renew |

---

## 1. Build the shell (on your machine)

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

Neither site sets **either** of the first two: potyro.app's build is the watcher's plain `vite build`
(§8). The build derives `wss://potyro.app/sync` from the origin it is served from, which is the whole point of the default: proxy one path and sync works with no
build-time configuration at all.

## 2. Upload it

```bash
rsync -az --delete packages/shell/dist/ e@vaz.io:/var/www/karta/
```

`--delete` matters: without it, old hashed assets accumulate forever.

## 3. Run the relay

The server has **Node 20**, and cojson needs **22**. Rather than install a second Node system-wide,
the relay runs in a container — which also sidesteps the `better-sqlite3` native build, the thing
that makes `--db` fail on some machines.

```bash
# once: pin the version, install it with the right Node
sudo mkdir -p /opt/potyro-relay /var/lib/potyro && sudo chown -R "$USER": /opt/potyro-relay /var/lib/potyro
cat > /opt/potyro-relay/package.json <<'JSON'
{ "name": "potyro-relay", "private": true, "dependencies": { "jazz-run": "0.20.19" } }
JSON
docker run --rm -v /opt/potyro-relay:/app -w /app node:22-bookworm npm install --omit=dev

# the service itself
docker run -d --name potyro-relay --restart unless-stopped \
  -p 127.0.0.1:4201:4201 \
  -v /opt/potyro-relay:/app -v /var/lib/potyro:/data -w /app \
  node:22-bookworm \
  node node_modules/.bin/jazz-run sync --host 0.0.0.0 --port 4201 --db /data/sync.db
```

Three details, each load-bearing:

- **`--db`, never `--in-memory`.** With in-memory storage a restart loses everything the relay was
  holding, and a peer that was offline at the time can never catch up — its edits and everyone
  else's diverge permanently. `pnpm dev` uses `--in-memory` because a dev relay has nothing worth
  keeping. Yours does.
- **`-p 127.0.0.1:4201:4201`** — published to loopback only, so the relay is reachable only through
  Apache. Bound to `0.0.0.0` it would be an open, unauthenticated websocket on the public internet.
- **Pin the version.** `jazz-run` must match the `cojson` the shell was built against (`0.20.19`
  here). Read it from the repo's `package.json`, not from `latest`.

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
rsync -az packages/store/scripts/erase-space.mjs e@vaz.io:/opt/potyro-tools/
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

## 4. The Apache vhost

`proxy_wstunnel`, `rewrite`, `headers` and `ssl` were already enabled — check yours with
`ls /etc/apache2/mods-enabled/`. The full file is at
`/etc/apache2/sites-available/apps.vaz.io.conf`; the parts that matter:

```apache
<VirtualHost *:443>
    ServerName apps.vaz.io

    SSLEngine on
    # A WILDCARD cert (*.vaz.io) already covers this name — nothing to issue, nothing to renew.
    SSLCertificateFile      /etc/letsencrypt/live/vaz.io/cert.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/vaz.io/privkey.pem
    SSLCertificateChainFile /etc/letsencrypt/live/vaz.io/fullchain.pem

    DocumentRoot /var/www/karta
    <Directory /var/www/karta>
        Options -Indexes +FollowSymLinks
        Require all granted
    </Directory>

    # The private-test gate. Covers the websocket too: same origin, so the browser replays these
    # credentials on the upgrade request.
    <Location "/">
        AuthType Basic
        AuthName "Potyro"
        AuthUserFile /etc/apache2/karta.htpasswd
        Require valid-user
    </Location>

    RewriteEngine On

    # The relay, FIRST — before the SPA rule, or /sync is answered with index.html.
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/sync(.*)$ ws://127.0.0.1:4201$1 [P,L]
    RewriteRule ^/sync(.*)$ http://127.0.0.1:4201$1 [P,L]
    ProxyPreserveHost On
    ProxyTimeout 600      # a sync connection is long-lived and mostly idle

    # SPA: anything that is not a real file is the shell.
    RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI} !-f
    RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI} !-d
    RewriteRule . /index.html [L]
</VirtualHost>
```

> **The one that bit.** Write that SPA condition against `%{DOCUMENT_ROOT}%{REQUEST_URI}`, not
> `%{REQUEST_FILENAME}`. In `<VirtualHost>` context mod_rewrite runs *before* the URL is mapped to a
> path, so `REQUEST_FILENAME` is still the URI and `!-f` is true for **everything** — every real
> asset gets answered with `index.html`. The site loads and looks fine; the icons and the manifest
> come back as `text/html`, so it is a broken PWA wearing a working site.

Cache headers are worth getting right too — hashed assets `immutable`, `index.html` and `sw.js`
`no-cache`, or a deploy stays invisible until someone clears their cache.

## 5. Gate it

```bash
sudo htpasswd -cB /etc/apache2/karta.htpasswd potyro      # -c only the first time
sudo chown root:www-data /etc/apache2/karta.htpasswd && sudo chmod 640 /etc/apache2/karta.htpasswd
```

Add a person: `sudo htpasswd -B /etc/apache2/karta.htpasswd <name>` (no `-c`). No reload needed —
Apache reads the file per request.

Basic auth covers the websocket because it is the **same origin**. That is the reason to keep the
relay on this host under `/sync` rather than on a separate one: a split origin would need its own
gate and its own credentials, and the browser would not replay these.

## 6. Enable it — config test first

There are other sites on this Apache. **Never reload without testing**, or one typo takes all of
them down:

```bash
sudo a2ensite apps.vaz.io.conf
sudo apache2ctl configtest        # must end in "Syntax OK"
sudo systemctl reload apache2     # reload, not restart — existing connections are kept
```

`configtest` on this server also prints pre-existing warnings from *other* vhosts (missing
DocumentRoots, a deprecated `NameVirtualHost`). Read them, then ignore them — `Syntax OK` is the line
that matters.

## 7. Check it

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://apps.vaz.io/                 # 401 — the gate works
curl -su USER:PASS -o /dev/null -w '%{http_code} %{content_type}\n' https://apps.vaz.io/
curl -su USER:PASS -o /dev/null -w '%{http_code} %{content_type}\n' https://apps.vaz.io/icon-512.png
```

The icon **must** come back `image/png`. If it says `text/html`, the SPA rule is eating real files —
see the warning in step 4.

Then the only check that really counts, in two browsers:

1. Open the site on device A. There is no Studio (see below), so start from a built-in example or an
   app you built locally.
2. Share it. Answer the name prompt.
3. Open the link on device B. It should receive the app **source** and the **data** over sync.
4. Write on each side. Each should see the other without a reload.
5. `💬 Chat` should be present, and a message should arrive attributed to the other person **by name**.

That whole flow was run against the live deployment before this document was written, in two real
browser contexts through `wss://apps.vaz.io/sync`.

If sync never connects, check the relay URL first: **⌾ You → Sync relay** shows the one in force.

## Redeploying

**The CI machine does it.** Every five minutes a cron watcher on `vazio` looks at GitHub's `main`; when
it is new, it runs the gate on it and deploys it when green ([§8](#8-merging-and-deploying-the-gate-on-vazio)).
By hand, from a clean checkout of `origin/main` that has passed the gate in that same checkout:

```bash
pnpm ci:local all --post     # the gate; `deploy` refuses anything that has not passed it
pnpm ci:local deploy         # build, rsync to potyro-deploy: (potyro.app), write version.json
```

`deploy` refuses a commit that is not `origin/main` or has not passed every step, so what is live is
always something the gate passed. `https://potyro.app/version.json` names the live commit.

**Only potyro.app is deployed.** Since 2026-10-17 the gate no longer updates apps.vaz.io: it stays on
the last commit it was given, and this section's setup of it is history.

No restart, no reload. The relay only needs touching when `cojson` changes version, in
which case bump the pin in `/opt/potyro-relay/package.json`, re-run the `npm install` container, and
`docker restart potyro-relay`.

## 8. Merging and deploying: the gate on vazio

Every GitHub Actions workflow is off. The owner disabled them by hand on 2026-10-25 (`ci.yml`,
`ship.yml`, `bench.yml`, `baselines.yml`), because Blacksmith's runners cost too much. A push runs
nothing, and `pnpm ship` fails: GitHub refuses to dispatch a disabled workflow. Do not turn one back
on without the owner. The gate is `pnpm ci:local all`, and the CI machine, `vazio`, runs it on every
new `main` and deploys `main` when it is green: its cron watcher (below) is on again (checked
2026-10-30: `crontab -l` has the line, and `~/ci-watch.log` shows `8dda1fc` gated and deployed that
afternoon).

A pull request ships in four steps:

1. **Rebase** the branch on `origin/main`, so the gate judges what main will be.
2. **Run the gate** on that head: `pnpm ci:local all --post`. Every step, the whole browser suite
   as parallel shards ([below](#the-browser-suite-runs-as-parallel-shards)); `--post` puts a
   `local-ci` status on the commit, so the PR shows the result. Run it on the CI machine, `vazio`.
   A laptop takes ~45 minutes, and under that load some shards fail on timeouts: re-run a failed
   spec alone (`pnpm exec playwright test <file> --workers=1`) before calling it real.
3. **Merge** the PR on GitHub with a merge commit (`gh pr merge <pr> --merge`).
4. **Deploy** main. The watcher does it within a few minutes of the merge, once the gate is green on
   the merge commit (`ssh vazio tail -f ci-watch.log` to follow it). By hand: the merge commit is
   new, so `pnpm ci:local deploy` refuses it until the gate has run on it too. Either run
   `pnpm ci:local all` on main and then `deploy`, or do what the workflow's deploy job did, which is
   §2's upload with the current target:

   ```bash
   git fetch -q origin && git checkout -q --detach origin/main     # a clean checkout, not your work
   pnpm install --frozen-lockfile
   pnpm --filter @potyro/shell exec vite build
   echo "{\"commit\":\"$(git rev-parse HEAD)\",\"deployedAt\":\"$(date -u +%FT%TZ)\"}" \
     > packages/shell/dist/version.json
   rsync -az --delete packages/shell/dist/ potyro-deploy:
   curl -s https://potyro.app/version.json                          # names the commit
   ```

   `potyro-deploy` is the ssh alias for `deploy@65.109.228.5`, whose key `rrsync` locks to the web
   root `/srv/potyro/site` (the table below). The target is relative to that root.

`node scripts/ci-select.mjs` still says which browser specs a change touches. Nothing runs it now;
the gate runs everything.

### How it was: the ship gate on GitHub Actions (2026-10-19 to 2026-10-25)

For six days the gate ran on GitHub Actions, on Blacksmith's runners (GitHub's own were blocked by
the account's billing). Every push to a branch ran `ci.yml`: the checks and a ten-file browser smoke,
~4 min. `pnpm ship <pr>` (`scripts/ship.mjs`) dispatched `ship.yml` on the PR's head, waited, and
merged when green with `gh pr merge --match-head-commit`. `ship.yml` ran the checks and the browser
specs `scripts/ci-select.mjs` picked from the files the change touched: all of them as sixteen
shards when it touched what every spec boots (the shell, views, runtime, host, store, schema and
the e2e helpers), a named few for one app or one surface, none for docs. On main it ran everything,
then built and rsynced the shell to potyro.app with the `POTYRO_DEPLOY_KEY` repository secret.
The whole suite took under 4 min, and it cost too much to keep. The workflows and
`scripts/bench-ci.sh` are still in the repository.

### vazio as the gate and the deployer

Until 2026-10-19 GitHub Actions was unavailable, so the CI machine (`vazio`) was both the gate and
the deployer, and since the workflows went off it is again. Of what follows, the **cron watcher** is
what runs today. The push path through `pnpm ship` is history: `scripts/ship.mjs` now dispatches
the disabled `ship.yml`. Until 2026-10-19, **merge with `pnpm ship <pr-number>`** meant:

```
laptop:  pnpm ship 232          merge commit on GitHub's main, pushed to vazio:appinator.git
vazio:   pre-receive            refuses at once anything but main, or a main not built on GitHub's
         post-receive           in the background: full local CI on that exact commit
           green →              pushed to GitHub's main (the PR shows merged) → deployed
           red   →              nothing moves; the local-ci check on the commit says why
```

The gate runs **before** main moves, so a red commit never reaches GitHub's main. The push returns
at once; follow with `ssh vazio tail -f ci-watch.log`. `ship` wakes vazio if it is asleep.

**Merged on GitHub instead?** cron is the backstop. Every five minutes `ci-watch.mjs` checks
GitHub's main; when it is new, it runs the gate on it and deploys it when green. A red main leaves
the site on the last green commit. It also moves the bare repo along, so the next `ship` builds on
it. **While vazio sleeps, neither runs.** They catch up when it wakes.

The pieces on `vazio`:

| | |
|---|---|
| Bare repo | `~/appinator.git`, with `hooks/pre-receive` and `hooks/post-receive` from [`deploy/vazio-hooks/`](../deploy/vazio-hooks/). |
| Checkout | `~/appinator-deploy`, the watcher's own. It is checked out detached at whatever is being judged, so nothing is ever edited there. |
| Lock | `~/.karta-ci.lock`, shared by the hook and cron, so the watcher judges one commit at a time. (Ports no longer need it: every shard claims its own block, below.) |
| Key | `~/.ssh/potyro_deploy`. It is authorized on the server as `command="/usr/bin/rrsync /var/www/karta",restrict …`, so it can rsync into the web root and do nothing else: no shell, no other path. |
| ssh alias | `Host potyro-deploy` in `~/.ssh/config` → `deploy@65.109.228.5` (potyro.app, web root `/srv/potyro/site`), its key locked by `rrsync` to the web root. (`Host karta-deploy` → `e@vaz.io`, apps.vaz.io, is no longer a target.) |
| cron | `*/5 * * * * cd ~/appinator-deploy && PATH=$HOME/.npm-global/bin:/usr/bin:/bin POTYRO_DEPLOY_TARGET="potyro-deploy:" flock -n ~/.karta-ci.lock node scripts/ci-watch.mjs >> ~/ci-watch.log 2>&1` |

### The browser suite runs as parallel shards

The browser suite is ~93% of a run. `ci:local all` (and `ci:local e2e` on its own) runs its shards
**at once** — `CI_LOCAL_SHARDS`, default 8 — each still one Playwright worker, each recorded as its
own step (`e2e-<n>.ok` / `.fail` / `.log` under `.ci-local/<sha>/`), so resuming, `status --post` and
the watcher work as before. `CI_LOCAL_E2E=sequential` runs them one after another, the old way.

The same specs run in **Firefox** with `ci:local e2e:firefox`, as shards of their own (`ff:<n>`,
`CI_LOCAL_FF_SHARDS`, default 8): the `trusted-firefox` and `sandbox-firefox` projects
(`POTYRO_FIREFOX=1`), console guard on, with their own plan (`ff-plan.json`) and their own timings
(keyed `ff:e2e/…`). Each suite names its Playwright projects, so nothing in the caller's environment
adds an engine to a shard. What differs between the engines is in `e2e/engines.ts` (docs/12).

**Firefox is not part of the gate.** Measured on vazio (2026-10-17): Chromium's eight shards alone
take ~6 min (the whole `all` ~8) and Firefox's eight alone ~5; all sixteen at once took 11.5 min,
and the CPU they fought over made Chromium's shards fail on timeouts. One after the other the run
is ~13 min. So `all`,
`status --post` and the watcher judge Chromium; `status` also prints Firefox's result for the commit
when it has run. Run it before merging anything a person sees, and nightly — a crontab line on vazio,
in a checkout of its own (not `~/appinator-deploy`, which the watcher moves):

```
30 3 * * * cd ~/appinator-firefox && git fetch -q && git checkout -q --detach origin/main && export PATH=$HOME/.npm-global/bin:/usr/bin:/bin && pnpm install --frozen-lockfile -s && node scripts/ci-local.mjs e2e:firefox >> ~/ci-firefox.log 2>&1
```

What makes that safe is that the shards share **nothing**:

- **Ports.** Every port the suite must know in advance is in `e2e/ports.ts`: the trusted, sandbox,
  prod and QuickJS dev servers, the sync relay, relay-reconnect's own relay and the port nothing
  listens on. Unset, `POTYRO_E2E_PORT_BASE` leaves them where they always were (4188, 4189, 4190,
  4191, 4201, 4321, 4299) — `pnpm e2e` and `pnpm dev` are unchanged. Set, the suite takes ten
  consecutive ports from that base, and the dev servers default their relay to the block's
  (`VITE_POTYRO_DEV_RELAY`, read in development only). Ports a spec needs only for itself — echo
  servers, the rooms relay, the realm's probe — come from the OS (`freePort()`).
- **Browser storage.** A port is part of an origin, so each block has its own OPFS, localStorage
  and IndexedDB. Within one origin the specs DO share state — the reason for one worker per shard,
  which `playwright.config.ts` explains.
- **Claims.** Each shard claims a block in 20000–32000 (below Linux's ephemeral range, where
  `freePort()` lands) with a lockfile in `/tmp/potyro-e2e-ports/<base>.lock` naming its process,
  bind-tests all ten ports, and releases it when it ends. A claim whose process is dead is taken
  over. Two whole runs on one machine — the gate and somebody's `ci:local` in another checkout —
  therefore take different blocks, and neither touches the default ports a developer's `pnpm dev`
  or `pnpm e2e` holds.
- **Files.** Each shard has its own Playwright output (`test-results/shard-<n>`, Firefox's
  `test-results/ff-shard-<n>`), its own Vite dependency cache (`node_modules/.vite-e2e/shard-<n>`,
  `ff-shard-<n>`), and its own build of the rooms relay on a
  Node without type stripping.

Files are dealt to shards by their **measured duration**, longest first into the lightest shard,
so the shards end together. Every shard's Playwright JSON report updates
`.ci-local/e2e-timings.json` (per checkout, kept across commits), read over the committed seed
`e2e/timings.json` (measured on vazio; refresh it by copying a checkout's file over it when the
suite has changed a lot). A file never timed counts as the median, and with no timings at all the
files are dealt by index. The deal is written to
`.ci-local/<sha>/e2e-plan.json` the first time and reused, so a resumed or re-run shard runs exactly
the files it ran before.

What was installed on vazio before the rename may still say `KARTA_DEPLOY_TARGET` (the crontab no
longer does: it says `POTYRO_DEPLOY_TARGET`, checked 2026-10-30); `ci-local.mjs` reads either name.

`POTYRO_DEPLOY_TARGET=potyro-deploy:` is relative to the web root, because `rrsync` anchors every path
there. After changing a hook in `deploy/vazio-hooks/`, copy it to `~/appinator.git/hooks/` on vazio.

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

**Running on potyro.app** (`/requests/health` answered `{"ok":true}` on 2026-10-30). The setup below
is as it was written for apps.vaz.io, behind its gate.


When the Studio's agent finds that what someone asked for needs something Potyro itself lacks, it
writes a request in their words and the Studio offers to send it. People have no GitHub account, so
a small relay files it as an issue in `fuzue/potyro`, labelled `platform-request`
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
| Rate limit | 5 a day per device id **and** 20 a day per address (the first `X-Forwarded-For` entry, which Apache sets), in memory. |
| Duplicates | A title that normalises to an open issue's under the same label (`platform-request`, or `translation` for a wording suggestion) (case, accents, punctuation, filler words, plurals and word order ignored) becomes a **comment** on that issue rather than a new one. |
| Retries | The same request id again gets the first answer back; it is filed once. |
| On the issue | The words quoted, marked as untrusted text, and the structure folded away. Never the device id or the address. |

The issues are public. The review card in the Studio says so before anyone sends one.

### 1. A token that can do one thing

A **fine-grained** personal access token (GitHub → Settings → Developer settings → Fine-grained
tokens): resource owner `fuzue`, **only** the repository `fuzue/potyro`, repository permission
**Issues: Read and write**, nothing else; an expiry you will notice. Then, once, the label:

```bash
gh label create platform-request -R fuzue/potyro --color 5319e7 \
  --description "Asked for from the Studio: something Potyro itself does not offer yet (#263, #288)"
gh label create translation -R fuzue/potyro --color 0e8a16 \
  --description "A better wording for Potyro's own words, suggested from You → Language (#300)"
```

On the server, out of the repository and readable by root only:

```bash
sudo mkdir -p /etc/potyro && sudo install -m 600 /dev/null /etc/potyro/requests.env
sudoedit /etc/potyro/requests.env
#   GITHUB_TOKEN=github_pat_…
#   POTYRO_REQUESTS_REPO=fuzue/potyro
#   HOST=0.0.0.0          # inside the container; published to loopback only, below
#   PORT=4202
```

### 2. Run it

Node 22 runs the TypeScript as it is (`--experimental-strip-types`); the package has no
dependencies, so there is nothing to install. The same container shape as the relay:

```bash
# from a checkout of the commit you are deploying
rsync -az --delete packages/platform-requests/ e@vaz.io:/opt/potyro-requests/

docker run -d --name potyro-requests --restart unless-stopped \
  -p 127.0.0.1:4202:4202 \
  --env-file /etc/potyro/requests.env \
  -v /opt/potyro-requests:/app:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-requests     # "[platform-requests] filing into fuzue/potyro, listening on 0.0.0.0:4202"
```

Without `GITHUB_TOKEN` it refuses to start. `-p 127.0.0.1:…` keeps it reachable only through Apache,
for the same reason as the sync relay.

### 3. Put it behind the site's gate

In the vhost (`deploy/apps.vaz.io.conf`), next to the `/sync` rules and **before** the SPA rule — or
`/requests/…` is answered with `index.html`, which the Studio reads as "not reachable" and keeps
saving:

```apache
    # Requests to the Potyro team (#263): the relay files them as GitHub issues.
    RewriteRule ^/requests/(.*)$ http://127.0.0.1:4202/$1 [P,L]
```

Same origin, so the basic-auth gate covers it and the browser needs no CORS. Then
`sudo apache2ctl configtest` and `sudo systemctl reload apache2`, as in §6, and copy the new vhost
into `deploy/` so the repository says what runs.

### 4. Check it

```bash
curl -su USER:PASS https://apps.vaz.io/requests/health                       # {"ok":true}
curl -su USER:PASS -X POST https://apps.vaz.io/requests/platform-requests \
  -H 'content-type: application/json' -d '{}'                                 # 400 {"ok":false,…}
```

Then send one from the Studio for real (ask a change that needs, say, a barcode scanner), look at the
issue it opens, and close it. A request saved earlier on a device goes the next time that device
opens the Studio.

**The Android app** is not on this origin: build it with `VITE_POTYRO_REQUESTS=https://apps.vaz.io/requests`
— and note that the basic-auth gate then stands in its way, so it keeps saving until the gate is
lifted or the route is exempted from it (with the rate limit as its only guard).

**Updating it:** rsync the package again and `docker restart potyro-requests`. Its rate limits and
its index of open issues are in memory; a restart forgets them, and the index is read again from
GitHub on the next request.

## AI for apps (docs/23): deployed

**Running at `https://potyro.app/ai/`** behind Caddy (`/ai/health` answered `{"ok":true}` on
2026-10-30). The running relay predates the chat route and the counts (#468): on 2026-10-30
`POST /ai/v1/chat/completions` and `GET /ai/count` answered 404 there, so only `/complete` and
`/health` are live until the container is updated. Who pays: a **free allowance** first, through a small relay that holds Potyro's
OpenRouter key (`packages/ai-relay`), then the person's own key from Model settings. It serves two
kinds of request:

- **`POST /ai/complete`** — apps' AI (`ctx.caps.ai`): read a photo, a text or a recording. The relay
  decides everything but the parts. This is what the shell uses today.
- **`POST /ai/v1/chat/completions`** — the Studio and Ask, once the shell has the engine for it
  (E1/E3). An OpenAI-shaped chat request, piped to OpenRouter, held to a per-device allowance in US
  dollars. Until the shell sends it, nothing calls it.

Beside them, `GET /ai/health`, and `POST`/`GET /ai/count` for the demand counts (below).

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
| Chat: money | Before dispatch, each with room for the most this request could cost (the **estimate**, below): the service's month and day, the device's month (`AI_DEVICE_MONTH_USD`), the address's day (`AI_ADDRESS_DAY_USD`, so a fresh device id per request does not get past it). That much (at least `AI_CHAT_RESERVE_USD`) is held while the request is out. After it, OpenRouter's `usage.cost` (from the final chunk when streamed) is charged; when the answer does not carry it — the sender went away, a timeout, a cut stream, no usage chunk, an error answer — the estimate is. Used up: `429` with `x-potyro-left-usd: 0` and a code (docs/23 "The chat route's refusals"). An answer that went out carries `x-potyro-left-usd`: what the device had left before it. |
| The estimate | Input: the body's characters / 4, as tokens, at the model's price per million input tokens; output: the request's `max_tokens` after the clamp at its price per million output tokens. Both on the high side (a picture's base64 counts as text). Prices are a small table in `src/prices.ts` — Gemini 2.5 Flash Lite $0.10/$0.40, DeepSeek V4 Flash $0.14/$0.28 a million tokens — overridden or added to with `AI_MODEL_PRICES`. A model the relay may send without a price stops it starting. A Studio turn at the high thinking level is held for about 2¢. `/complete` uses the same estimate: held while it is out, and charged for a failure, an empty answer or a missing `usage.cost`. |
| Chat: the answer | Piped, not buffered: a stream and OpenRouter's `: OPENROUTER PROCESSING` lines reach the sender as they come. 300 s for the whole request, body included (the Studio's own timeout). 3 at once per device. A sender that goes away stops the request upstream. 4 MiB a request. Potyro's key refused or out of credit, or OpenRouter down, is `502` with code `upstream`; a refusal the sender can act on (a 400) comes back as it is. Neither carries a `usage.cost`, so both are charged the estimate. |
| Spending caps | `AI_MONTHLY_CAP_USD` (default **$10**) for the whole service, both routes together, a calendar month (UTC), and `AI_DAY_USD` (default an eighth of it, $1.25) a calendar day (UTC), so one day cannot eat the month. Both are checked **before** each request with its estimate on top of what every request still out on either route holds (`src/budget.ts`). Past either, every device is told "used up" and moves to its own key. A request that settles after its month or day ended is not counted (the ledger never goes back to an ended month); the relay logs how many. |
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
sudoedit /etc/potyro/ai.env
#   OPENROUTER_API_KEY=sk-or-v1-…
#   AI_MONTHLY_CAP_USD=10
#   AI_DAY_USD=1.25
#   AI_LEDGER=/data/ai-ledger.json
#   AI_CHAT_MODELS=deepseek/deepseek-v4-flash-0731
#   AI_DEVICE_MONTH_USD=0.5
#   AI_CHAT_OFF_FILE=/data/chat-off
#   TRUST_PROXY=caddy
#   HOST=0.0.0.0          # inside the container; published to loopback only, below
#   PORT=4204
```

Every variable, with its default, is at the top of `packages/ai-relay/src/server.ts`. The new ones:

| Variable | Default | |
|---|---|---|
| `AI_CHAT_MODELS` | `deepseek/deepseek-v4-flash-0731` | Comma-separated; the only models the chat route sends. |
| `AI_DEVICE_MONTH_USD` | `0.5` | One device's chat allowance a month. |
| `AI_DAY_USD` | `AI_MONTHLY_CAP_USD` / 8 | The whole service's spend a calendar day (UTC), both routes. |
| `AI_MODEL_PRICES` | — | JSON, `{"<model>": {"input": 0.14, "output": 0.28}}` in US dollars a million tokens, over the table in `src/prices.ts`. Use the dearest provider's price on OpenRouter. |
| `AI_ADDRESS_DAY_USD` | 4 × `AI_DEVICE_MONTH_USD`, at most half of `AI_DAY_USD` | One address's chat spend a day (IPv6: its /64), whatever device ids it sends. A whole home or office shares it. Must be below `AI_DAY_USD`, or it does not start. With the defaults: $0.625. |
| `AI_CHAT_RESERVE_USD` | `0.02` | The least a chat request is held for while it is out; more when its estimate is more. |
| `AI_CHAT_MAX_TOKENS` | `64000` | The clamp on `max_tokens`, the Studio's high thinking level. Reasoning comes out of it too. |
| `AI_CHAT_OFF` | — | `1` turns the chat route off. Changing it needs a new container. |
| `AI_CHAT_OFF_FILE` | — | While this file exists, the chat route is off. No restart. |
| `AI_COUNT_PER_ADDRESS_DAY` | `20` | `POST /count` from one address a day. |
| `AI_CORS_ORIGINS` | `https://localhost,capacitor://localhost` | Origins answered with CORS. |
| `TRUST_PROXY` | `caddy` | `caddy` or `none`; anything else stops it starting. |

### 2. Run it

No dependencies. Port **4204**: 4201 is the sync relay, 4202 the request relay and 4203 the share
links (docs/24).

```bash
rsync -az --delete packages/ai-relay/ SERVER:/opt/potyro-ai/
sudo mkdir -p /var/lib/potyro-ai

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

In the `potyro.app` site block, **before** the shell's `file_server` (or `/ai/…` is answered with
`index.html`):

```caddy
    # The free AI allowance (docs/23). Not under `encode`: a streamed answer goes out as it comes.
    handle /ai/* {
        reverse_proxy 127.0.0.1:4204 {
            flush_interval -1
            transport http {
                response_header_timeout 310s
                read_timeout 310s
            }
        }
    }
```

**The timeout must match the relay's.** The chat route gives OpenRouter 300 s for the whole request,
so nothing in front of it may give up sooner. Caddy's own defaults have no response-header or read
timeout, so with the block above nothing cuts in early; but if the site (or the global options'
`servers { timeouts { write … } }`) sets one, it must be over 300 s for `/ai/*`. OpenRouter's
keep-alive lines keep the connection busy while a model thinks; `flush_interval -1` sends them on at
once. Leave `trusted_proxies` unset unless something (a CDN) stands in front of Caddy: the relay's
`TRUST_PROXY=caddy` relies on the last `X-Forwarded-For` entry being the peer Caddy saw.

`caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`.

### 4. Check it

```bash
curl -s https://potyro.app/ai/health                                                # {"ok":true}
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

**Updating it:** rsync the package again and `docker restart potyro-ai`. The ledger survives.

## Demo links and their previews (docs/24): deployed

**Running on potyro.app** (`/share-api/health` answered `{"ok":true}` on 2026-10-30). The setup below
is as it was written for apps.vaz.io, behind its gate; potyro.app has none, so §3 does not apply
there.


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

Node 22 runs the TypeScript as it is, and the package has no dependencies. Same container shape as
the relay and the requests relay. It reads the built shell's `index.html` (read-only) on every
request, so a deploy shows at once.

```bash
sudo mkdir -p /var/lib/potyro/shares && sudo chown -R "$USER": /var/lib/potyro/shares
rsync -az --delete packages/share-links/ e@vaz.io:/opt/potyro-share-links/

docker run -d --name potyro-share-links --restart unless-stopped \
  -p 127.0.0.1:4203:4203 \
  -e HOST=0.0.0.0 -e PORT=4203 \
  -e POTYRO_SHARES_DIR=/data -e POTYRO_SHELL_INDEX=/site/index.html \
  -e POTYRO_PUBLIC_ORIGIN=https://apps.vaz.io \
  -e TRUST_PROXY=caddy \
  --env-file /etc/potyro/share-links.env \
  -v /opt/potyro-share-links:/app:ro -v /var/lib/potyro/shares:/data -v /var/www/karta:/site:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-share-links   # "[share-links] keeping shares in /data, page from /site/index.html, listening on 0.0.0.0:4203"
```

`POTYRO_PUBLIC_ORIGIN` is what preview URLs are built on. Crawlers need absolute `https://` URLs,
and Apache does not tell the service which scheme it was reached by.

`/etc/potyro/share-links.env` (mode 600, owned by root) holds the one secret,
`SHARE_ADMIN_TOKEN=…` (made with `openssl rand -base64 33`), and the report address: a line
`SHARE_ABUSE_CONTACT=` with the real address the terms name after it (the same one as `abuse` in
`packages/shell/src/contacts.json`). Until it is set — or while it is still a placeholder like
`<ABUSE EMAIL>`, which the service says in its log at start — a taken-down link's page names
`contact@potyro.com`. The token is the operator's token for taking a
link down over HTTPS ([below](#taking-a-link-down)); at least 32 characters, or the service will not
start. Leave it out and the takedown route does not exist; links are then taken down on the server
itself. It is in a file, not on the command line, so it is not in `ps`, the shell's history or
`docker inspect`'s `Cmd`. The service never logs it.

`TRUST_PROXY=caddy` (the default) believes the LAST `X-Forwarded-For` entry: Caddy writes it, and so
does Apache's `mod_proxy`, which appends the peer it saw. Anything before it is what the client sent.
`none` ignores the header (a service reached directly). The rule and its test are the AI relay's
(`packages/share-links/src/address.ts` is a copy of `packages/ai-relay/src/address.ts`).

### 2. Route it, before the SPA rule

In `deploy/apps.vaz.io.conf`, next to `/sync`:

```apache
    # Demo links (docs/24): the link's page, its preview picture, and the share API.
    RewriteRule ^/s/([A-Za-z0-9_-]{22})(/preview\.(jpg|png))?/?$ http://127.0.0.1:4203/s/$1$2 [P,L]
    RewriteRule ^/share-api/(.*)$ http://127.0.0.1:4203/share-api/$1 [P,L]
```

Then `sudo apache2ctl configtest`, `sudo systemctl reload apache2` (§6), and copy the vhost back
into `deploy/`.

### 3. The gate

**Previews cannot work behind basic auth.** WhatsApp, Telegram, iMessage, Discord and X fetch
`/s/<id>` and the picture without credentials. While `apps.vaz.io` is a private test, the gate
stays. Invited people still get the short link and the demo, but chats show no card. When the site
goes public, or to test previews before then, exempt exactly these paths:

```apache
    <LocationMatch "^/s/[A-Za-z0-9_-]{22}(/preview\.(jpg|png))?/?$">
        Require all granted
    </LocationMatch>
```

That alone shows the **preview**. Opening the demo also needs the shell's assets (`/assets/`,
`/sw.js`, the manifest, the icons) and `GET /share-api/shares/<id>/payload` reachable without the
gate. Exempting those is deciding to make the site public, so take that decision on purpose and not
as a side effect of this section.

### 4. Check it

```bash
curl -s https://apps.vaz.io/share-api/health                                   # {"ok":true}
```

Then make a link from a tile (*Share → Make the link*). It should look like `/s/<id>#k=…`, and the
sheet should not say "without a preview picture". Check:

- `curl -s https://apps.vaz.io/s/<id> | grep og:` shows the title and the image URL.
- The image URL answers `image/jpeg`.
- Pasting the link into a chat shows the card, once the gate allows it (§3).

**Disk:** links are never expired. Budget about 20–60 KB per link (sealed package + picture);
`du -sh /var/lib/potyro/shares` to watch it. No more than 2 GB of new links a day are kept, and none
while the disk would have under 1 GB free ([Limits per address](#limits-per-address)).

### Taking a link down

For a notice about illegal content (the terms' "Reporting illegal content", to the report address),
or anything else the terms say may be removed. **Who may run it:** the operator — whoever holds
`SHARE_ADMIN_TOKEN` or a shell on the server. Today that is the owner, alone. Say why every time:
the reason is kept with the takedown, with no end date. Keep it to what was decided and why (the
notice's date, the rule or law); the reporter's name and address stay in the mail, not here.

From anywhere, over HTTPS (Node 18 or later; a whole link is fine, its key after `#` is never sent).
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

First deployed 2026-10-16; **running on potyro.app** (`/rooms/health` answered ok on 2026-10-30, and
an upgrade with `Origin: https://potyro.app` got 101 where `https://apps.vaz.io` got 403). The setup
below is as it was written for apps.vaz.io.


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
| Address | The **last** `X-Forwarded-For` entry — the one Apache appends. The first entry is whatever the client sent, so it is never used for limits. |
| Origins | By default browsers only from `https://potyro.app`, `https://localhost` (the Android app) and `capacitor://localhost` (`DEFAULT_ORIGINS` in `src/server.ts`; `https://apps.vaz.io` until #458); anything else gets HTTP 403 on the upgrade. potyro.app's accepts `https://potyro.app`. |
| Keepalive | A ping every 30 s; a member that has not answered the last one is dropped. That also keeps Apache's `ProxyTimeout 600` from cutting a quiet room. |
| Logs | Its own start and stop. Never a payload, a room id, a name or an address. |

### 1. Run it

Port **4205**: 4201 is the sync relay, 4202 the request relay, 4203 the share links, 4204 the AI
relay. Unlike those three, this package has **one dependency**, the `ws` websocket library (pinned
in its `package.json`), so it needs one `npm install`, the way the sync relay does. Everything else
is the same container shape:

```bash
# from a checkout of the commit you are deploying
ssh e@vaz.io 'sudo mkdir -p /opt/potyro-rooms && sudo chown -R "$USER": /opt/potyro-rooms'
rsync -az --delete --exclude node_modules packages/rooms/ e@vaz.io:/opt/potyro-rooms/

# on the server: install ws (once, and again whenever package.json changes)
docker run --rm -v /opt/potyro-rooms:/app -w /app node:22-bookworm npm install --omit=dev --no-package-lock

docker run -d --name potyro-rooms --restart unless-stopped \
  -p 127.0.0.1:4205:4205 \
  -e HOST=0.0.0.0 -e PORT=4205 \
  -v /opt/potyro-rooms:/app:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-rooms   # "[rooms] origins https://potyro.app https://localhost capacitor://localhost, listening on 0.0.0.0:4205"
```

No secrets, so no env file. `-p 127.0.0.1:…` keeps it reachable only through Apache, for the same
reason as the sync relay: published on `0.0.0.0` it would be an open websocket relay on the public
internet with no gate in front of it. `--exclude node_modules` keeps the server's installed `ws`
(and keeps the laptop's pnpm links off the server).

Every limit is an environment variable (`ROOMS_MAX_MEMBERS`, `ROOMS_MESSAGES_PER_SECOND`, …, the
full list at the top of `src/server.ts`); a value that is not a positive number stops it starting.
`ROOMS_ORIGINS` replaces the origin list (comma-separated, or `*`). Add `-e NAME=value` to the
`docker run` and re-create the container to change one. The default named `https://apps.vaz.io`
until #458: a relay re-created from a later commit for a site that still serves pages from there
needs `-e ROOMS_ORIGINS=https://apps.vaz.io,https://localhost,capacitor://localhost`.

### 2. Put it behind the site's gate, with the upgrade

In `deploy/apps.vaz.io.conf`, next to the `/sync` rules and **before** the SPA rule (or `/rooms/…`
is answered with `index.html`). Like `/sync`, an upgrade is proxied as a websocket and anything else
goes to the same place over http, so `/rooms/health` works and a misrouted request says so:

```apache
    # Rooms for multiplayer apps (docs/26): a websocket per room, and its health check.
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/rooms/(.*)$ ws://127.0.0.1:4205/rooms/$1 [P,L]
    RewriteRule ^/rooms/(.*)$ http://127.0.0.1:4205/rooms/$1 [P,L]
```

`proxy_wstunnel` is already enabled for `/sync`; the query string (`?name=`) is passed on as it is.
`ProxyPreserveHost On` and `ProxyTimeout 600` from the `/sync` block already apply. Then
`sudo apache2ctl configtest`, `sudo systemctl reload apache2` (§6), and copy the vhost back into
`deploy/` so the repository says what runs.

**The basic-auth gate** covers `/rooms/` from the site itself: same origin, so the browser replays
the credentials on the upgrade, exactly as for `/sync`. It does **not** work for the Android app
(origin `https://localhost`, another origin: no credentials are sent, and the upgrade gets a 401). To
let the APK in before the site goes public, exempt exactly this route; the relay's own limits are
then its only guard:

```apache
    <LocationMatch "^/rooms/">
        Require all granted
    </LocationMatch>
```

### 3. Check it

```bash
curl -su USER:PASS https://apps.vaz.io/rooms/health        # {"ok":true,"rooms":0,"connections":0}

# a real upgrade: expect "HTTP/1.1 101 Switching Protocols", then the welcome frame's text
ROOM=$(head -c16 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')
curl -su USER:PASS --http1.1 -i -N --max-time 3 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: https://apps.vaz.io' \
  "https://apps.vaz.io/rooms/$ROOM?name=check"
```

The second should print `{"potyro-rooms":1,"type":"welcome",…}` after the headers. A `200` with HTML
instead means the SPA rule answered first; a `403` means the `Origin` is not on the list.

**Updating it:** rsync the package again (with `--exclude node_modules`), run the `npm install`
container again if `package.json` changed, and `docker restart potyro-rooms`. A restart closes every
member with 1001 ("relay restarting"); apps reconnect, and since nothing was kept, nothing is lost
but the current member ids.

## Moving to a new home: apps.vaz.io → potyro.app

Browser storage belongs to one origin. Everything a person made on `apps.vaz.io` — apps, records,
photos and files, Studio conversations, who they are — lives in that site's storage in their browser,
and `potyro.app` cannot read a byte of it. So the old site carries it across, once, when the person
asks, and **no server sees any of it**.

**What the person sees.** On the old site's home, a banner: *Potyro has a new home — bring your apps
over to potyro.app*. "Bring my apps over" opens potyro.app in a new window, which shows exactly what
will come in — every app, its records and files, which ones arrive sealed, and that they come too —
and waits. Nothing is written until they press **Bring them in**. Then the old banner says *Done — your
apps are on potyro.app*. Nothing on the old site is deleted. "Save them as a file instead" is the
fallback where a window cannot be opened: a `potyro-move-<date>.zip` to choose on `potyro.app/?move`.

**How it travels** (`packages/shell/src/move-*.ts`):

| Step | |
|---|---|
| Pack (`move-gather.ts`) | Each app the way Export packs one: records, photos, files, `ctx.storage` and its own code, copied with their ids into an in-memory SQLite. A synced app is packed from its *space* (that is where its records are), with the files it kept on the device. Studio conversations, version history, cases and diagnoses come as rows; the person's look, language and per-app choices as preferences. |
| Hand over (`move-protocol.ts`) | The old site opens `potyro.app/?move=<channel>` — a fresh 128-bit id, the only thing in the URL. The new window says a content-free *hello* to its opener; the old site answers with an **offer** (the manifest and the archive's SHA-256), addressed to the new home's exact origin. |
| Confirm | The new site shows the offer. Only after **Bring them in** does it ask for the archive, and it takes it only from the origin that offered, only from its opener, only on its channel, and only if its digest is the one offered. Anything else — another site, a frame, a message out of turn — is ignored without a word. |
| Bring in (`move-bring-in.ts`) | Through the existing paths: `copyStoreData` (an upsert by id, so a merge), `saveUserApp` (so it is in History), `adoptPortableIdentity` (which checks the seed gives the secret and the secret the id before writing anything). |

**Which sites count.** `move-origins.ts`, and nowhere else: `https://potyro.app` and
`https://apps.vaz.io` exactly, plus `VITE_POTYRO_MOVE_ORIGINS` (comma-separated) for a self-hosted
Potyro that moves too, plus `localhost` on any port on a dev server. The old → new pair is
`NEW_HOMES` (or `VITE_POTYRO_NEW_HOME` for a build); a dev server takes
`localStorage["potyro:dev:new-home"] = "http://localhost:<port>"`, which is how two `pnpm dev`
servers on two ports play both parts (`e2e/move-home-trusted.spec.ts`).

**Merge, never duplicate** (`move-plan.ts`). An app not on the new site comes as it was. One with the
same code joins the one there (its records merged by id). An untouched example joins the newer copy;
an untouched example there is replaced by the person's edited one. Changed on both sides, it comes in
beside the one there, as "Notes (from apps.vaz.io)". Where each app went is remembered
(`potyro:move:received`), so moving again — after a closed window, or after more work on the old
site — lands in the same place and doubles nothing.

**Trust.** An app runs directly on the new site only if it did on the old one *and* it was the
person's own; one that came from someone else (a link, a maker's credit, someone's space) stays
sealed. A saved file brings **every** app sealed, because a file can be from anyone.

**Who you are moves too — over the window, never in a file.** The identity is a seed (`@potyro/identity`):
carrying it is what entering the recovery words on a second device does, done for the person between
two windows they have open. So their records' `createdBy` still names them, their words still work,
and the new site is the same account. It replaces an identity the new site minted by itself and
never shared under; one that is in use there is kept, and the person is told to enter their words if
they want to be the old one. A file never carries it: whoever finds a file in Downloads holding the
secret could sign as them. After a file move, the words under **You** do it.

**Shared apps come as the person's own copy.** A site's relay is its own `/sync`, so the spaces on
apps.vaz.io's relay are not where potyro.app looks. A synced or shared app arrives with everything in it, local to the
new site; the people it was shared with keep the space on the old site, and sharing again from
potyro.app makes a new one. (If the relay's data is ever moved to potyro.app's relay, nothing here
needs to change: the account is the same.)

**For the deployment.** Neither site may send `Cross-Origin-Opener-Policy` (other than
`unsafe-none`): it cuts `window.opener` across origins, and only the file path would work. The shell's
`frame-src 'none'` is unaffected — nothing here is a frame.

## The gallery on potyro.com (docs/24 §10): deployed 2026-10-16

The gallery is a static folder: `index.html`, `gallery.css`, `gallery.js`, `favicon.svg` and
`shots/*.jpg`. Nothing runs on the server for it, it keeps no logs of its own, and it loads nothing
from anyone else (no fonts, analytics or CDN), so it can be served with a strict policy. Until
potyro.com has a website, the gallery is its front page. All its paths are relative, so it works at
`/` or under `/gallery/` without being rebuilt.

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

```bash
pnpm gallery:build                    # → dist/gallery/ (refuses data with a problem, or a missing screenshot)
rsync -av --delete dist/gallery/ SERVER:/srv/potyro.com/
```

### 3. Serve it (Caddy)

```caddy
potyro.com, www.potyro.com {
    root * /srv/potyro.com
    encode zstd gzip
    file_server

    header {
        Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }
    # The page and its data change on every build; the style, script and pictures are named by version.
    @page path / /index.html
    header @page Cache-Control "no-cache"
    @assets path /gallery.css /gallery.js /shots/* /favicon.svg
    header @assets Cache-Control "public, max-age=86400"

    # No access log: a gallery that keeps no record of you, on the server too.
    log {
        output discard
    }
}
```

`img-src data:` is for the page's paper grain, an inline SVG. The page's data is a
`<script type="application/json">` block, which a CSP does not treat as a script. The page has no form
and no inline script or style, so it needs nothing looser.

### 4. Check it

```bash
curl -sI https://potyro.com/ | grep -i content-security-policy
curl -s https://potyro.com/ | grep -c 'potyro.app/s/'       # one Try it and one Make it mine per app
```

Open it in a private window with the network panel open: every request should go to potyro.com. Then
tap one card's **Try it** (the app opens sealed) and **Make it mine** (the Make it mine card opens over it).

## What this does NOT protect

Be straight with anyone you invite:

- **The relay is unauthenticated** (KA-29). On a gated site the basic-auth gate is the only thing in
  front of it; on potyro.app, which has no gate, nothing is (`/sync` upgrades without credentials,
  checked 2026-10-30). Anyone who reaches it can push and fetch CoValues by id — they cannot *read* them (everything is
  encrypted to the space's members, and the decryption key travels in a URL fragment that never
  reaches the server), but they can consume storage.
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
- **The first load is ~2.1 MB gzipped.** Not a security issue, but it is what a phone on mobile data
  will feel first.

## Verifying a build before it ships

`pnpm test:e2e:prod` builds the shell for real, serves it with `vite preview`, and asserts what only
a deployed build can be wrong about: that there is a relay URL, that it can be changed without
devtools, that no agent surface is offered, and that a built-in app runs with no server behind it.
The dev server hides every one of those by construction — which is why KA-28 existed at all.
