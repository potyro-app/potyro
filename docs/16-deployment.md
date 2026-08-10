# Deploying Karta on your own domain (KA-34)

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

## The live deployment, as configured

| | |
|---|---|
| Host | `vaz.io` (Debian 13), Apache 2 already serving ~28 other vhosts |
| Site | `/var/www/karta` ← `packages/shell/dist` |
| Relay | Docker container `karta-relay`, `127.0.0.1:4201`, db at `/var/lib/karta/sync.db` |
| Vhost | `/etc/apache2/sites-available/apps.vaz.io.conf` |
| Gate | Basic auth, `/etc/apache2/karta.htpasswd`, user `karta` |
| TLS | the existing **wildcard** `*.vaz.io` certificate — nothing new to issue or renew |

---

## 1. Build the shell (on your machine)

```bash
pnpm i
pnpm --filter @karta/shell exec vite build     # → packages/shell/dist  (~33 MB)
```

Two build-time knobs, both optional:

| Variable | Default | When to set it |
|---|---|---|
| `VITE_KARTA_RELAY` | same origin, `/sync` | Only if the relay is on a different host. |
| `VITE_KARTA_GENERATOR` | unset | Only once a deployment can actually reach a model — see [The agent](#the-agent). |

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
sudo mkdir -p /opt/karta-relay /var/lib/karta && sudo chown -R "$USER": /opt/karta-relay /var/lib/karta
cat > /opt/karta-relay/package.json <<'JSON'
{ "name": "karta-relay", "private": true, "dependencies": { "jazz-run": "0.20.19" } }
JSON
docker run --rm -v /opt/karta-relay:/app -w /app node:22-bookworm npm install --omit=dev

# the service itself
docker run -d --name karta-relay --restart unless-stopped \
  -p 127.0.0.1:4201:4201 \
  -v /opt/karta-relay:/app -v /var/lib/karta:/data -w /app \
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
        AuthName "Karta"
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
sudo htpasswd -cB /etc/apache2/karta.htpasswd karta      # -c only the first time
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

```bash
pnpm --filter @karta/shell exec vite build
rsync -az --delete packages/shell/dist/ e@vaz.io:/var/www/karta/
```

That is all — no restart, no reload. The relay only needs touching when `cojson` changes version, in
which case bump the pin in `/opt/karta-relay/package.json`, re-run the `npm install` container, and
`docker restart karta-relay`.

## The agent

**A deployed build has no Studio and no AI editing.** `/__generate` is a Vite *dev-server*
middleware, so the route does not exist in a build. Rather than offer buttons that fail with "Is
`pnpm dev` still running?", the shell hides them (`canGenerate`).

Structural editing (✎ Edit's controls) and History are **not** affected — neither calls a model.

Turning generation on needs a real endpoint and then `VITE_KARTA_GENERATOR=1` at build time. That is
a piece of work, not a flag: an API key held server-side, plus auth and rate limiting in front of it,
or it is your bill and anyone's to spend. `ClaudeBackend` in `packages/generator` is the client half;
the server half does not exist yet.

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
