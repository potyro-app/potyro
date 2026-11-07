# deploy/

The files that run `https://potyro.app` and `https://potyro.com`, kept here so production can be
rebuilt from the repository plus the owner's secrets. The whole deployment is described in
[`../docs/16-deployment.md`](../docs/16-deployment.md).

| File | Where it goes |
|---|---|
| `potyro.app.Caddyfile` | `/etc/caddy/Caddyfile` on the server: potyro.app, potyro.com, and the names that forward to potyro.app |
| `containers.sh` | run on that server, as root, from a checkout: copies each service's package into `/opt/potyro-*` and (re)creates its container |
| `env.example/*.env.example` | one template per env file in `/etc/potyro/` (`requests.env`, `ai.env`, `share-links.env`): the variable names, never the values |

The shell itself is not here: it is static files, built and rsynced to `/srv/potyro/site` by the
watcher on the CI machine (docs/16 §8).

Nothing secret is in this folder. The tokens and keys live in `/etc/potyro/*.env` on the server
(root, mode 600), and their values are the owner's.
