# Deploying Potyro on your own domain (KA-34)

**`https://apps.vaz.io` is live and this is how it was done** — a real recipe, not a sketch. It was
written by deploying it, so the awkward parts below are the ones that actually bit.

This is the **private-test** shape: the site is gated at the proxy so only people you invite can
reach it, and the relay is not exposed on its own. Read
[What this does NOT protect](#what-this-does-not-protect) before pointing anyone at it.

## What actually has to run

Two things, and only two:

| | |
|---|---|
| **The shell** | Static files from `vite build`. No server logic, no database, no API. |
| **The relay** | `jazz-run sync` — a websocket server that stores and forwards **encrypted** CoValues. It cannot read anything it holds. |

Everything else — the store, the runtime, the isolate, identity — runs in the browser. An app keeps
working with the relay down; it just stops reaching other people until it comes back.

Two optional services sit beside them, neither deployed yet: the [request relay](#requests-to-the-potyro-team-263--not-deployed-yet)
and the [free AI allowance](#ai-for-apps-docs23--not-deployed-yet) for apps. Without them requests
wait on the device, and apps' AI runs on the person's own key.

## The live deployment, as configured

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

Two build-time knobs, both optional:

| Variable | Default | When to set it |
|---|---|---|
| `VITE_POTYRO_RELAY` | same origin, `/sync` | Only if the relay is on a different host. |
| `VITE_POTYRO_GENERATOR` | unset | Only once a deployment can actually reach a model — see [The agent](#the-agent). |

`apps.vaz.io` sets **neither**. The build derives `wss://apps.vaz.io/sync` from the origin it is
served from, which is the whole point of the default: proxy one path and sync works with no
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

**It is automatic:** every commit that lands on `main` goes live once it passes the local CI — see
[§8](#8-merging-and-deploying-through-the-ci-machine). By hand, from a clean checkout of `origin/main`:

```bash
pnpm ci:local all --post     # the gate; `deploy` refuses anything that has not passed it
pnpm ci:local deploy         # build, rsync to e@vaz.io:/var/www/karta/, write version.json
```

`deploy` refuses a commit that is not `origin/main` or has not passed every step, so what is live is
always something the gate passed. `https://apps.vaz.io/version.json` names the live commit.

No restart, no reload. The relay only needs touching when `cojson` changes version, in
which case bump the pin in `/opt/potyro-relay/package.json`, re-run the `npm install` container, and
`docker restart potyro-relay`.

## 8. Merging and deploying through the CI machine

GitHub Actions is unavailable, so the CI machine (`vazio`) is both the gate and the deployer.
**Merge with `pnpm ship <pr-number>`**:

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
| Lock | `~/.karta-ci.lock`, shared by the hook and cron, so only one suite ever holds the test ports. |
| Key | `~/.ssh/potyro_deploy`. It is authorized on the server as `command="/usr/bin/rrsync /var/www/karta",restrict …`, so it can rsync into the web root and do nothing else: no shell, no other path. |
| ssh alias | `Host karta-deploy` in `~/.ssh/config` → `e@vaz.io` with that key. |
| cron | `*/5 * * * * cd ~/appinator-deploy && PATH=$HOME/.npm-global/bin:/usr/bin:/bin POTYRO_DEPLOY_TARGET=karta-deploy: flock -n ~/.karta-ci.lock node scripts/ci-watch.mjs >> ~/ci-watch.log 2>&1` |

The hook and the crontab installed on vazio before the rename still say `KARTA_DEPLOY_TARGET`;
`ci-local.mjs` reads either name, so they keep working until they are reinstalled from `deploy/`.

`POTYRO_DEPLOY_TARGET=karta-deploy:` is relative to the web root, because `rrsync` anchors every path
there. After changing a hook in `deploy/vazio-hooks/`, copy it to `~/appinator.git/hooks/` on vazio.

## The agent

**A deployed build has no Studio and no AI editing.** `/__generate` is a Vite *dev-server*
middleware, so the route does not exist in a build. Rather than offer buttons that fail with "Is
`pnpm dev` still running?", the shell hides them (`canGenerate`).

Structural editing (✎ Edit's controls) and History are **not** affected — neither calls a model.

Turning generation on needs a real endpoint and then `VITE_POTYRO_GENERATOR=1` at build time. That is
a piece of work, not a flag: an API key held server-side, plus auth and rate limiting in front of it,
or it is your bill and anyone's to spend. `ClaudeBackend` in `packages/generator` is the client half;
the server half does not exist yet.

## Requests to the Potyro team (#263) — NOT deployed yet

When the Studio's agent finds that what someone asked for needs something Potyro itself lacks, it
writes a request in their words and the Studio offers to send it. People have no GitHub account, so
a small relay files it as an issue in `fuzue/potyro`, labelled `platform-request`
(`packages/platform-requests`). **Until the relay below is running, nothing is lost:** the Studio
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

## AI for apps (docs/23) — NOT deployed yet

Apps can read a photo or a text with AI (`ctx.caps.ai`). Who pays: a **free allowance** first,
through a small relay that holds Potyro's OpenRouter key (`packages/ai-relay`), then the person's
own OpenRouter key from Model settings. **Until the relay below is running**, apps work on the
person's own key, and without one the action fails with "Free AI isn't available yet — add your
own key in Model settings." Nothing else changes: the shell asks `/ai/complete`, gets the site's
own page or a 404 back, and does not ask again for ten minutes.

What it accepts and does, so you know what you are putting on the internet:

| | |
|---|---|
| Route | `POST /complete` (and `GET /health`), behind `/ai/`. Nothing else. |
| What is in a request | The host's instructions to the model, the parts the app's call named (its words and its pictures, resized on the device to 1600 px), the JSON Schema for the answer, a token cap, a random device id. Never a key; never a record the app did not pass. |
| What it sends on | `google/gemini-2.5-flash-lite` (or `AI_MODEL`), always — the sender cannot choose the model, the token cap (≤ 4 000) or the provider rules (`data_collection: "deny"`). No tools, no web search. |
| Size | 6 MiB a request, checked before parsing; ≤ 4 pictures of ≤ 3 MiB each as data URLs; ≤ 40 000 characters of text. Too big is refused, never cut. |
| Limits | 20 a day and 100 a month per device id, 60 a day per address (first `X-Forwarded-For`), 2 at once per device. |
| Spending cap | `AI_MONTHLY_CAP_USD` (default **$10**) for the whole service a calendar month (UTC), checked **before** each request with a cent of room; what each request really cost (OpenRouter's `usage.cost`) is added after it. Past it, every device is told "used up" and moves to its own key. |
| State | The month's spend and each device's count in `AI_LEDGER` (a JSON file), written on every change, so a restart does not start the month again. A file it cannot read stops it starting. Daily limits are in memory. |
| Logs | The upstream's error messages only. Never a request's content, a device id or an address. |

At ~$0.0003 a receipt, $10 is ~30 000 photos a month. Set the same ceiling, or a lower one, as the
key's own **credit limit** on OpenRouter: that is the cap that holds even if this code is wrong.

### 1. A key that can only spend a little

On openrouter.ai, under the Potyro account: Settings → **Keys** → Create key, named
`potyro-free-ai`, with a **credit limit** (e.g. $10). Settings → Privacy: leave model training and
logging **off**. On the server, out of the repository and readable by root only:

```bash
sudo install -m 600 /dev/null /etc/potyro/ai.env
sudoedit /etc/potyro/ai.env
#   OPENROUTER_API_KEY=sk-or-v1-…
#   AI_MONTHLY_CAP_USD=10
#   AI_LEDGER=/data/ai-ledger.json
#   HOST=0.0.0.0          # inside the container; published to loopback only, below
#   PORT=4204
```

### 2. Run it

No dependencies, like the request relay. Port **4204**: 4201 is the sync relay, 4202 the request
relay and 4203 the share links (docs/24).

```bash
rsync -az --delete packages/ai-relay/ e@vaz.io:/opt/potyro-ai/
sudo mkdir -p /var/lib/potyro-ai

docker run -d --name potyro-ai --restart unless-stopped \
  -p 127.0.0.1:4204:4204 \
  --env-file /etc/potyro/ai.env \
  -v /opt/potyro-ai:/app:ro -v /var/lib/potyro-ai:/data -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-ai     # "[ai-relay] google/gemini-2.5-flash-lite, cap $10 a month, listening on 0.0.0.0:4204"
```

Without `OPENROUTER_API_KEY` it refuses to start.

### 3. Put it behind the site's gate

In the vhost, next to `/requests/` and **before** the SPA rule:

```apache
    # The free AI allowance for apps (docs/23).
    RewriteRule ^/ai/(.*)$ http://127.0.0.1:4204/$1 [P,L]
```

`configtest`, reload, and copy the vhost into `deploy/`, as for the request relay. The site's
basic-auth gate covers it, which is today the strongest of its limits.

### 4. Check it

```bash
curl -su USER:PASS https://apps.vaz.io/ai/health                                   # {"ok":true}
curl -su USER:PASS -X POST https://apps.vaz.io/ai/complete -d '{}' \
  -H 'content-type: application/json'                                               # 400 {"ok":false,…}
cat /var/lib/potyro-ai/ai-ledger.json                                               # after a real request
```

Then, with no key in Model settings, open Receipt Split (`apps/receipt-split`), **Read a receipt**
with a real photo, and check the items and the ledger's spend.

**The Android app** is not on this origin: build it with `VITE_POTYRO_AI=https://apps.vaz.io/ai`; the
basic-auth gate then stands in its way as it does for requests, so it uses the person's own key
until the gate is lifted or the route exempted.

**Changing the model** is `AI_MODEL` here, plus `AI_MODEL` in `src/request.ts` for the person's own
key; pick one with image input and structured outputs on OpenRouter.

**Updating it:** rsync the package again and `docker restart potyro-ai`. The ledger survives.

## Demo links and their previews (docs/24): NOT deployed yet

A demo link opens an app running in the browser with sample records, and a chat shows a preview
card for it (title, one line, a picture). The site is static, so the preview needs a small service
beside the relay: `packages/share-links`. **Until it runs, nothing breaks:** the shell sees no
`/share-api/health` and makes the *inline* form of the link (`/#try=…`). That form carries the
whole app in the fragment, works on the static site as it is, and has no preview. Each link is
10–20 KB, and some messengers cut a link that long (Telegram stops at 4096 characters).

What the service accepts and does:

| | |
|---|---|
| Routes | `POST /share-api/shares`, `GET /share-api/shares/<id>/payload`, `DELETE /share-api/shares/<id>` (with `x-delete-token`), `GET /share-api/health`, `GET /s/<id>` (the shell's `index.html` with the link's Open Graph and Twitter meta written in), `GET /s/<id>/preview.jpg`. |
| What it holds | Per link: the **sealed** app package (AES-GCM, ≤ 2 MiB). The key is in the link's fragment and never reaches the service. Beside it, what the sharer's device made public for the preview: a title (the app's name), one line, a language, and a 1200×630 JPEG or PNG of ≤ 300 KB drawn from **demo** records. It also keeps the sha256 of the token that takes the link down. |
| Checks | Body size before parsing, then each part. The picture is checked by its first bytes (JPEG/PNG only). Meta text is cleaned and capped, and HTML-escaped where it goes into the page. Ids are 128 random bits. |
| Rate limit | 30 links a day per address (the first `X-Forwarded-For` entry), in memory. |
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
  -v /opt/potyro-share-links:/app:ro -v /var/lib/potyro/shares:/data -v /var/www/karta:/site:ro -w /app \
  node:22-bookworm \
  node --experimental-strip-types src/server.ts
docker logs potyro-share-links   # "[share-links] keeping shares in /data, page from /site/index.html, listening on 0.0.0.0:4203"
```

`POTYRO_PUBLIC_ORIGIN` is what preview URLs are built on. Crawlers need absolute `https://` URLs,
and Apache does not tell the service which scheme it was reached by.

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

**Taking a link down** (a notice, a takedown, or the sharer's own request):
`sudo rm -rf /var/lib/potyro/shares/<first two characters of id>/<id>`. The page then still loads
the shell, which tells the person the link no longer works. The sharer's device keeps each link's
delete token (`potyro:shares`); `DELETE /share-api/shares/<id>` with `x-delete-token` does the same.
Before opening this to the public, see the research note on the DSA (a hosting service must have a
notice-and-action path). The folder and the `rm` above are that path's mechanism, not the whole of it.

**Disk:** links are never expired. Budget about 20–60 KB per link (sealed package + picture);
`du -sh /var/lib/potyro/shares` to watch it.

## What this does NOT protect

Be straight with anyone you invite:

- **The relay is unauthenticated** (KA-29). The basic-auth gate is the only thing in front of it.
  Anyone past it can push and fetch CoValues by id — they cannot *read* them (everything is
  encrypted to the space's members, and the decryption key travels in a URL fragment that never
  reaches the server), but they can consume storage.
- **You can see the social graph** (KA-33). Transactions are encrypted; group and account metadata
  are not. As operator you can see which accounts share which spaces, and when they are active. Do
  not claim "we can see nothing" — it is not true yet.
- **No quotas, no metering, no abuse controls.** The log grows with every edit and nothing compacts
  it (KA-30). A chatty pair can out-transaction the app's own data, permanently, on your disk.
- **Anyone with a share link is in.** The invite secret is the whole capability; there is no second
  factor and no way to revoke one link short of rotating the space's keys (KA-17).
- **The first load is ~2.1 MB gzipped.** Not a security issue, but it is what a phone on mobile data
  will feel first.

## Verifying a build before it ships

`pnpm test:e2e:prod` builds the shell for real, serves it with `vite preview`, and asserts what only
a deployed build can be wrong about: that there is a relay URL, that it can be changed without
devtools, that no agent surface is offered, and that a built-in app runs with no server behind it.
The dev server hides every one of those by construction — which is why KA-28 existed at all.
