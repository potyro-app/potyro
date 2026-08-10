# Deploying Karta on your own domain (KA-34)

Written for `apps.vaz.io`, but nothing here is specific to it — substitute your host.

This is the **private-test** recipe: the site is gated so only people you invite can reach it, and
the relay is deliberately not exposed to the internet on its own. Read
[What this does NOT protect](#what-this-does-not-protect) before pointing anyone at it.

## What actually has to run

Two things, and only two:

| | |
|---|---|
| **The shell** | Static files from `vite build`. No server logic, no database, no API. |
| **The relay** | `jazz-run sync` — a websocket server that stores and forwards **encrypted** CoValues. It cannot read anything it holds. |

Everything else — the store, the runtime, the isolate, identity — runs in the browser. An app keeps
working with the relay down; it just stops reaching other people until it comes back.

## 1. Build the shell

```bash
pnpm i
pnpm --filter @karta/shell exec vite build     # → packages/shell/dist
```

Two build-time knobs, both optional:

| Variable | Default | When to set it |
|---|---|---|
| `VITE_KARTA_RELAY` | same origin, `/sync` | Only if the relay is on a different host. |
| `VITE_KARTA_GENERATOR` | unset | Only once a deployment can actually reach a model — see [The agent](#the-agent). |

With neither set, the build points at `wss://<the-host-it-was-served-from>/sync`. That is the whole
point of the default: proxy that path and sync works with no configuration at all.

## 2. Run the relay

```bash
jazz-run sync --host 127.0.0.1 --port 4201 --db /var/lib/karta/sync.db
```

**`--db`, never `--in-memory`.** With in-memory storage a relay restart loses everything it was
holding, and a peer that was offline at the time can never catch up — its edits and everyone else's
diverge permanently. `pnpm dev` uses `--in-memory` because a dev relay has nothing worth keeping,
and that is not true of yours.

**`--db` needs `better-sqlite3`'s native bindings**, which fail to build on some machines (they do
not build in this repo's dev environment, which is why dev runs in-memory). If they fail on the
server, run the relay in a container where they do.

**`--host 127.0.0.1`**, so the relay is only reachable through the proxy below. Bound to `0.0.0.0`
it is an open, unauthenticated websocket on the public internet (KA-29).

As a systemd unit:

```ini
# /etc/systemd/system/karta-relay.service
[Unit]
Description=Karta sync relay
After=network.target

[Service]
ExecStart=/usr/bin/npx jazz-run sync --host 127.0.0.1 --port 4201 --db /var/lib/karta/sync.db
Restart=always
RestartSec=2
User=karta
StateDirectory=karta

[Install]
WantedBy=multi-user.target
```

The relay restarting is survivable — the client reconnects on its own (that was fixed; see the
`WebSocketPeerWithReconnection` note in `docs/handoff-sync.md`) — so `Restart=always` is safe.

## 3. Terminate TLS and proxy both

A browser refuses a `ws://` connection from an `https://` page, so the relay **must** be reached
over `wss://`. Same origin also means no CORS and no preflight to think about.

```caddyfile
apps.vaz.io {
	encode gzip zstd

	# The relay. Must come before the SPA fallback, or `/sync` is answered with index.html.
	handle /sync* {
		reverse_proxy 127.0.0.1:4201
	}

	handle {
		root * /srv/karta/dist
		# A hashed asset can be cached forever; index.html and the service worker must not be, or a
		# deploy is invisible until someone clears their cache.
		@immutable path /assets/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"
		header /index.html Cache-Control "no-cache"
		header /sw.js Cache-Control "no-cache"
		try_files {path} /index.html      # SPA: every route is index.html
		file_server
	}
}
```

Caddy proxies websockets natively — no extra `Upgrade` directives needed. On nginx you would need
`proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` explicitly.

## 4. Gate it, for a private test

The relay has **no authentication of its own** (KA-29). Until it does, the gate belongs at the proxy:

```caddyfile
apps.vaz.io {
	basic_auth {
		# caddy hash-password --plaintext '…'
		friend $2a$14$…
	}
	# … the handle blocks above …
}
```

Basic auth covers the websocket too, because the browser sends the same credentials on the upgrade
request for a same-origin URL. That is the reason to keep the relay on the same host rather than a
separate one — a split origin would need its own gate and its own credentials.

An IP allowlist (`@allowed remote_ip …`) works the same way and is less friction if everyone testing
is on known networks.

## 5. Check it

```bash
curl -I https://apps.vaz.io/                # 200, text/html
curl -I https://apps.vaz.io/icon-512.png    # 200, image/png
```

Then in a browser, with two devices:

1. Open the site, create an app in the Studio — **wait**: there is no Studio on a deployed build
   (see below). Instead, build the app locally and share the link, or import a `.karta.zip`.
2. On device A, share the app. Answer the name prompt.
3. Open the link on device B. It should receive the app **source** and the **data** over sync.
4. Write on each side; both should see the other's changes without a reload.
5. The header should show **Synced**, and `💬 Chat` should be present.

If sync never connects, the relay URL is the first thing to check: **⌾ You → Sync relay** shows the
one actually in force.

## The agent

**A deployed build has no Studio and no AI editing.** `/__generate` is a Vite *dev-server*
middleware, so the route simply does not exist in a build. Rather than offer buttons that fail with
"Is `pnpm dev` still running?", the shell hides them (`canGenerate`).

Structural editing (✎ Edit's controls) and History are **not** affected — neither calls a model.

To turn generation on you need a real endpoint, and then `VITE_KARTA_GENERATOR=1` at build time.
That is a genuine piece of work, not a flag: it means an API key held server-side, and auth and rate
limiting in front of it, because otherwise it is your bill and anyone's to spend. `ClaudeBackend` in
`packages/generator` is the client half; the server half does not exist yet.

## What this does NOT protect

Be straight with anyone you invite:

- **The relay is unauthenticated** (KA-29). The proxy gate is the only thing in front of it. Anyone
  past the gate can push and fetch CoValues by id — they cannot *read* them (everything is encrypted
  to the space's members, and the decryption key travels in a URL fragment that never reaches your
  server), but they can consume storage.
- **You can see the social graph** (KA-33). Transactions are encrypted; group and account metadata
  are not. As the operator you can see which accounts share which spaces, and when they are active.
  Do not claim "we can see nothing" — it is not true yet.
- **No quotas, no metering, no abuse controls.** The log grows with every edit and nothing compacts
  it (KA-30). A chatty pair can out-transaction the app's own data, permanently, on your disk.
- **Anyone with the share link is in.** The invite secret is the capability; there is no second
  factor and no way to revoke one link short of rotating the space's keys (KA-17).

## Verifying a build before it ships

`pnpm exec playwright test --project=prod` builds the shell for real, serves it with `vite preview`,
and asserts what only a deployed build can be wrong about: that there is a relay URL, that it can be
changed without devtools, that no agent surface is offered, and that a built-in app runs with no
server behind it. The dev server hides every one of those by construction — which is why KA-28
existed at all.
