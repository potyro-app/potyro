---
title: Self-host Potyro
description: Put Potyro on your own domain: the shell as static files, the sync relay, the optional services, a reverse proxy in front, and the checks that tell you it works.
section: guides
order: 11
---

# Self-host Potyro

Potyro on your own domain is two things: the shell, a folder of static files, and the sync relay,
a websocket server that stores and forwards encrypted updates it cannot read. Everything else runs
in the browser.

```sh
pnpm i
pnpm --filter @potyro/shell exec vite build      # → packages/shell/dist
rsync -az --delete packages/shell/dist/ deploy@potyro.example:/srv/potyro/site/
```

Four optional services sit beside the relay: an AI relay for a free allowance in apps, a request
relay that files people's requests as issues, a share service for demo-link previews, and a rooms
relay for multiplayer apps. Without them AI runs on each person's own key, requests wait on the
device, links carry the whole app, and rooms are refused. Apps keep working with the relay down.

Everything is on one origin. The shell derives its relay (`wss://<host>/sync`) and every service
path (`/ai`, `/requests`, `/share-api`, `/rooms`) from where it is served. The proxy routes paths
and nothing is configured at build time.

## 1. Build and upload the shell

Build with no variables set. Two exist for other situations:

| Variable | Set it when |
|---|---|
| `VITE_POTYRO_RELAY` | The relay is on a different host than the site. |
| `VITE_POTYRO_SITE` | A native build (Android, iOS): the site the app belongs to. |

Upload the build folder with `--delete`, or old hashed assets accumulate.

## 2. Run the relay

The relay is `jazz-run sync`. Pin it to the version in the repository's root `package.json`: it
must match the sync library the shell was built with. Run it under Node 22 and give it a database:

```sh
docker run -d --name potyro-relay --restart unless-stopped \
  -p 127.0.0.1:4201:4201 \
  -v /opt/potyro-relay:/app -v /var/lib/potyro:/data -w /app \
  node:22-bookworm \
  node node_modules/.bin/jazz-run sync --host 0.0.0.0 --port 4201 --db /data/sync.db
```

Two details matter. `--db`, never `--in-memory`: with memory storage a restart loses what the
relay holds, and a device that was offline can never catch up. Publish on loopback only: bound to
the internet the relay is an unauthenticated websocket with nothing in front of it.

## 3. Put a reverse proxy in front

Caddy gets its own certificates. The block for the shell and the relay:

```caddy
potyro.example {
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
	handle {
		root * /srv/potyro/site
		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"
		@fresh path / /index.html /sw.js
		header @fresh Cache-Control "no-cache"
		try_files {path} {path}.html {path}index.html /index.html
		file_server
	}
}
```

- `frame-src 'none'` is required: it is part of how a sealed app is kept in its sandbox.
- `handle` blocks are exclusive and the one without a matcher comes last, so a service path is
  never answered by `index.html`. `handle_path` strips the prefix; the relay serves at its root.
- Hashed assets are immutable; `index.html` and the service worker are `no-cache`, or a deploy
  stays invisible until people clear their cache.

After a change: `caddy validate --config /etc/caddy/Caddyfile`, then `systemctl reload caddy`.
A reload keeps open websockets; a restart does not.

## 4. Add the optional services

Each is a Node 22 process with no build step, published on loopback and routed by Caddy. From a
checkout on the server, `sudo deploy/containers.sh <name>` copies the package and (re)creates its
container, the relay included; `RECREATE=1` after editing an env file. Secrets go in root-only
env files, never on the command line.

| Service | Route | Environment that matters |
|---|---|---|
| AI relay | `handle_path /ai/*` → `:4204`, with `flush_interval -1` and `read_timeout 310s` | `OPENROUTER_API_KEY` (required), `AI_MONTHLY_CAP_USD`, `AI_DAY_USD`, `AI_DEVICE_MONTH_USD`, `AI_LEDGER`, `AI_CHAT_MODELS`, `AI_CHAT_OFF_FILE`, `TRUST_PROXY` |
| Request relay | `handle_path /requests/*` → `:4202` | `GITHUB_TOKEN` (required; a fine-grained token with Issues read and write on one repository), `POTYRO_REQUESTS_REPO` |
| Share service | `handle /share-api/*` and `/s/<id>` → `:4203` | `POTYRO_SHARES_DIR`, `POTYRO_SHELL_INDEX` (the built `index.html`, read-only), `POTYRO_PUBLIC_ORIGIN`, `SHARE_ADMIN_TOKEN`, `SHARE_ABUSE_CONTACT` |
| Rooms relay | `handle /rooms/*` → `:4205` | `ROOMS_ORIGINS` (the site, plus `https://localhost` and `capacitor://localhost` for native apps) |

Set the AI key's own credit limit on the provider to the same ceiling as `AI_MONTHLY_CAP_USD`.
That is the cap that holds even if the relay is wrong. Leave the share and rooms routes open to
anyone: chat apps fetch link previews without credentials.

## 5. Check it

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://potyro.example/                      # 200
curl -s -o /dev/null -w '%{content_type}\n' https://potyro.example/icon-512.png        # image/png
curl -sI https://potyro.example/ | grep -i content-security-policy                     # frame-src 'none'
curl -s https://potyro.example/version.json                                            # the build
curl -s https://potyro.example/ai/health         # {"ok":true,…}; the same under /requests, /share-api and /rooms
```

The icon must come back as an image. HTML means the fallback to `index.html` is answering real
files. Then the check that counts: open the site on two devices, share an app with **Use it
together** from one, open the link on the other, and write on both sides. Each should see the
other without a reload. If sync never connects, **You → Sync relay** shows the address in force.

## What to back up and what this does not protect

Back up the relay's database, the share service's folder and the AI ledger. The database holds
every shared space, encrypted.

Be straight with the people you invite. The relay is unauthenticated: anyone who reaches it can
push and fetch updates by id and use your disk, though not read them. Group and account metadata
is visible to you as operator, so you can see who shares a space with whom. The log grows with
every edit and nothing compacts it. An invite link is the whole capability; revoking one means
removing the person, which rotates the space's key.

## Next

- [Build for Android](build-for-android.md): a native build that points at your site.
- [Data and sync](../concepts/data-and-sync.md): what the relay holds and what it cannot read.
- [Running the repository](../contributing/running-the-repository.md): the checkout these
  commands run from.
