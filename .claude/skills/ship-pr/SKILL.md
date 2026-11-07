---
name: ship-pr
description: Take a change from a branch to potyro.app — the checks to run where, the gate on the CI machine, the PR, the merge, the watcher that deploys main. Use for "ship it", "merge", "deploy", "run the gate", "is main green".
---

# Shipping a change

There is no CI on GitHub (every workflow is off; never turn one on without the owner). The gate is
`pnpm ci:local all`, run by hand on the CI machine, and a cron watcher on that machine tests `main`
and deploys potyro.app when it is green. `CONTRIBUTING.md` §The gate is the public reference; the
owner's operations notes (servers, keys, the watcher's host) are private. This is the order of work.

## 1. Before the PR, on your machine (Node 22)

```
pnpm --filter <package> test typecheck        # the packages you touched
pnpm lint:boundaries && pnpm lint:i18n && pnpm lint:docs
node scripts/ci-select.mjs                    # which browser specs the change touches
```

Regenerate what the change makes stale (the table in CLAUDE.md: reference, corpus, catalogs, docs
index) and commit the generated files with the change. A merge of two branches that both
regenerated the corpus leaves main red: after such a merge, regenerate on main.

## 2. Browser specs: on the CI machine, not a laptop

A laptop is slow and flaky under the suite's load, and a dev server from another checkout on the
same port makes the spec test that checkout. Run specs on `vazio` (`ssh vazio`):

```
cd ~/potyro-gate && git fetch -q origin && git checkout -q -B gate/<name> origin/<branch>
export PATH=$HOME/.npm-global/bin:/snap/bin:$PATH
pnpm e2e e2e/<spec>.spec.ts                   # one spec, one worker
```

Wait until no other `scripts/ci-local.mjs` is running there (`pgrep -f scripts/ci-local.mjs`):
two suites at once share the machine and turn each other red.

## 3. The gate, then the PR

Rebase on `origin/main` first, so the gate judges what main will be. Then, on vazio, in the
background, with its log:

```
cd ~/potyro-gate && git checkout -q -B gate/<name> origin/<branch>
nohup sh -c "pnpm ci:local all --post; echo exit=\$?" > ~/potyro-gate-<name>.log 2>&1 &
```

It takes about ten minutes; `--post` puts a `local-ci` status on the commit. Results per step are
under `~/potyro-gate/.ci-local/<sha>/` (`*.ok`, `*.fail`, `*.log`); a failed shard's log names the
spec. Re-run a failed spec alone before calling it real. Open the PR with `gh pr create`: what and
why in prose, a test plan with what ran where, and `🤖 Generated with [Claude Code]` at the end.
`gh pr edit` fails on a GraphQL deprecation; use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>`.

## 4. Merge and deploy

Merge with a merge commit once the gate is green (in practice the owner merges). The watcher on
vazio (`~/appinator-deploy`, cron every five minutes, `~/ci-watch.log`) fetches main, runs the whole
gate on the merge commit and deploys only if it is still `origin/main` and green; a red main leaves
the site on the last green commit, and while vazio sleeps nothing deploys. Follow it:

```
ssh vazio 'tail -5 ~/ci-watch.log; ls ~/appinator-deploy/.ci-local/<sha>/ | grep -E "ok$|fail$"'
```

`GREEN` and `is already live` means deployed; `RED (unit)` after a merge is almost always a stale
corpus. The public gallery site is separate: `pnpm gallery:build` then an rsync the owner runs.

## Parallel sessions

Before fixing main or a flaky spec, `gh pr list`: another session may have the same fix open, and
two fixes of the same lines merge clean and break the build (it happened with a moved hook).
