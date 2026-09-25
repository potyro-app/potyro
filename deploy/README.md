# deploy/

The **actual** files running `https://apps.vaz.io`, kept here so the deployment is reviewable and
reproducible rather than living only on the server.

| File | Where it goes |
|---|---|
| `apps.vaz.io.conf` | `/etc/apache2/sites-available/apps.vaz.io.conf` |
| `vazio-hooks/pre-receive`, `vazio-hooks/post-receive` | `~/appinator.git/hooks/` on the CI machine — the merge gate and deploy (docs/16 §8) |

The relay is not a file — it is a container, created once. Both are described end to end in
[`../docs/16-deployment.md`](../docs/16-deployment.md).

Nothing secret is here: the basic-auth hash lives at `/etc/apache2/karta.htpasswd` on the server and
is not in this repository.
