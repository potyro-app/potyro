---
title: Testing guide
description: A hands-on walkthrough of everything built: how to try Potyro and give feedback.
status: current
order: 12
---

# 12 · Testing guide — try it & give feedback

A hands-on walkthrough of everything built so far. Work top to bottom, or jump to a section. For each
item there's **what to do** and **what you should see** — note anything that surprises you, breaks, or
feels off, and report back (see *Feedback* at the end).

## Run it

```bash
pnpm i
pnpm dev            # the sync relay (port 4201) and the shell → http://localhost:5173
pnpm dev:sandbox    # the same, with the examples UNTRUSTED: their logic in the browser realm (#272)
pnpm dev:sandbox:quickjs   # the same, in the QuickJS-WASM fallback
```

Opening `/` shows the **launcher**: your apps, the ones you open often and lately first, pinned ones
before them (#84). Look (on the home screen) switches it between **Classic**, the default, and
**Tiles**, a Start screen you arrange by holding a tile (#96). The examples (`ls examples/*.app.ts*`:
groceries, places, plants, recipes, split, workout) are seeded into it on first run as ordinary
apps (#152): open them in the Studio, rename, share or delete them, and a deleted example stays
deleted. Click a tile to launch it. Inside an app, the **Switch app** button at the left of the top
bar brings the launcher back. Deep links: `?user=<id>`; the older `?app=recipes` form opens the same
app.

> **Note on durability:** the durable store is SQLite over OPFS, run in a dedicated worker, which is
> where browsers offer the OPFS access handles (docs/00 "Storage"). Where a worker cannot get
> storage at all (a Firefox private window, for instance) a local-only app falls back to
> `localStorage`: data still persists per browser, just not as a SQLite file. A synced app never
> falls back; it says it cannot open instead.

## Run the checks

```bash
pnpm i
pnpm -r test        # unit suites, every package
pnpm typecheck      # every package, plus the docs spikes
pnpm lint:boundaries && pnpm lint:tokens && pnpm lint:i18n && pnpm lint:docs
pnpm e2e            # the browser suite (Playwright starts the servers it needs)
```

### On Windows, say `pnpm.cmd`

PowerShell refuses to run `pnpm.ps1` under the default execution policy, and a *spawned* process
does not find a bare `pnpm` on PATH either — the shim is `pnpm.cmd`.

```powershell
pnpm.cmd -r test
pnpm.cmd typecheck
pnpm.cmd exec playwright test --project=trusted
```

Do **not** change the machine's execution policy to make a command work. Anything in this repo that
spawns the package manager names the extension itself (`relay-reconnect-trusted.spec.ts`), and a
suite that only runs on a machine somebody reconfigured is not a suite anybody can trust.

### The browser suite runs one spec at a time

`pnpm e2e` uses a single worker on purpose. Every spec drives the same origin against the same dev
server, the durable store is OPFS and the sync specs share one relay — so parallel workers are
parallel clients of the same state (`playwright.config.ts` says what broke at the default worker
count).

`POTYRO_PARALLEL=4 pnpm e2e` is available for a quick local sweep; confirm anything it reports at one
worker before believing it. `pnpm ci:local` (below) gets its speed differently: whole copies of the
suite side by side, each on its own ports and so its own origin.

### A test that leaves an error in the console fails

Every spec takes `test` and `expect` from `e2e/console-guard.ts` (`pnpm lint:boundaries` refuses
`test` from `@playwright/test`). On the trusted and sandbox projects it collects `console.error` and
uncaught page errors from every page the test opens, its own contexts included, and fails a test
that otherwise passed on any it was not told to expect. A test that fails on purpose says so:
`consoleGuard.allow(/pattern/, "why")`. The guard's own allow-list holds noise that is nobody's
fault, each entry with its reason. It exists because two tabs of Potyro printed nine
`NoModificationAllowedError`s per load while the suite stayed green (fix/opfs-access-handles).

Two tabs of one origin: one owns the storage (`packages/store/src/storage-owner.ts`), the other
says "Potyro is open in another tab" — `e2e/storage-owner-trusted.spec.ts`, also in Firefox and
WebKit with `POTYRO_STORAGE_BROWSERS=1 pnpm e2e --project=storage-firefox --project=storage-webkit`.

### The launcher harness (`e2e/launcher/`)

The launcher is audited by *operating* it, on the device it is for (#94). One directory, one spec
per concern, most of them on the same seeded library (`fixture.ts`: eight apps, trusted and
untrusted, synced and local, names colliding on their first letter). Among them:

- `touch-trusted.spec.ts` — 375×812 with touch: open, switch, share, rename, delete. Every control
  tapped is measured against 44px.
- `keyboard-trusted.spec.ts` — 1440: Tab order through the grid, the tile menu as a real menu.
- `a11y-trusted.spec.ts` — axe on home, switcher and open menu (zero serious/critical), and a
  reduced-motion run in which nothing animates.
- `start-arrange-trusted.spec.ts` — the Tiles home screen: sizes, order and groups by finger, mouse
  and keyboard.
- `baselines-trusted.spec.ts` — screenshots of home, the tile menu, the switcher, the share dialog
  and the Plants form at several widths, light and dark.

`pnpm e2e:launcher` runs the directory.

**The baselines are a CI runner's pixels**, and they are not compared anywhere today. Two Linux
machines with the same Chromium and the same fonts still disagree (glyph hinting by a few hundred
pixels a page; a classic scrollbar on one shifts a layout that overlay scrollbars on the other leave
alone), so the spec skips itself unless `CI` or `POTYRO_BASELINES=1` is set, and `ci:local` leaves it
out. The committed images were made by GitHub's `baselines.yml`, which is disabled with every other
workflow since 2026-10-25 (docs/16 §8). `POTYRO_BASELINES=1 pnpm e2e:launcher` compares on your
machine anyway (expect noise); `pnpm e2e:baselines` rewrites them from your machine's pixels.

### Specs that skip themselves, and say why

- `studio-generate-trusted.spec.ts` drives a **real** `claude -p`. With no `claude` on PATH it skips
  immediately rather than waiting out a 330-second timeout for something knowable up front. The
  deterministic cover for the same path — Studio → save → History → rollback, with the generator
  endpoint stubbed — is `create-modify-rollback-trusted.spec.ts`, which needs no CLI and no money.
- `deployment-prod.spec.ts` needs a production build: `pnpm test:e2e:prod`.
- **Firefox** runs every trusted and sandbox spec (`pnpm test:e2e:firefox`; `pnpm ci:local e2e:firefox`
  as shards), console guard on. What differs between the engines is said once, in `e2e/engines.ts`:
  - Specs that drive a finger or the CPU through Chromium's DevTools protocol (`newCDPSession`:
    a hold, a drag, a flick, a throttled CPU) skip in Firefox — Playwright's Firefox can only tap
    (`NEEDS_CDP`).
  - Specs of the **drawn** map (its pins, its camera, a tap on it) skip where the browser has no
    WebGL2 (`skipWithoutMaps`) — Playwright's headless Firefox on Linux has none. What a person
    sees then — the places listed, the form's coordinates — is `map-no-webgl-trusted.spec.ts`, in
    every engine.
  - Permissions Playwright's Firefox does not know by name (`camera`, `clipboard-read`) are its
    prefs instead (`e2e/firefox-prefs.ts`, `grantClipboard`).
  - A deliberately refused WebSocket is allowed in each engine's words (`socketRefused`).

### The gate: `pnpm ci:local all`

GitHub Actions does not run anything: every workflow has been disabled since 2026-10-25. The merge
gate is `pnpm ci:local all` (`scripts/ci-local.mjs`): install, build, every unit suite, typecheck, the
boundary, token and i18n lints, and the trusted + sandbox browser suite as parallel shards
(`CI_LOCAL_SHARDS`, default 8), each a whole copy of the suite on its own block of ports and one
worker, one retry for a flake. Each step records its result under `.ci-local/<commit>/`, so an
interrupted run picks up where it stopped (`pnpm ci:local status` shows what is left), and it refuses
to run on uncommitted changes so a result always describes a commit. `pnpm ci:local status --post`
marks the commit with a `local-ci` check on GitHub once everything passed. Firefox
(`ci:local e2e:firefox`) is a step of its own and not part of the verdict; the pixel baselines are
skipped. On a laptop the whole run is slow and some shards fail on timeouts under the load; the CI
machine, `vazio`, is where it is meant to run, and where a cron watcher runs it on every new `main`
and deploys `main` when it is green (docs/16 §8).

---

## 0. The chrome around every app (#111)

Open any app at 375 wide: a top bar (Switch app, the app's name, one `⋯` menu), the page, and a
bottom tab bar with the app's pages and More. The shell's tools — Ask, Studio, Edit mode, History,
People, Share, Data, Import, Export, the trust line (Runs as yours / Runs sealed), "Something's
wrong" — are in the `⋯` menu, each only where it
applies; on a wide screen they are the "This app" group in the sidebar. There is no TRUSTED pill: an
app that runs sealed carries a quiet **🛡 sealed** button that opens the trust dialog, and specs read
the app root's `data-provenance` instead. A record's page shows its title, one filled action, the
others plain, and Edit / Delete behind "More actions". `chrome-trusted.spec.ts` drives it at 375 and
1440.

## 1. The six examples

Each one is made for the moment it is used most; its header comment says what it is for and what it
stresses. Its spec is the authoritative version of each walk below.

### Recipes (`?app=recipes`) — the M1 core

| Do | Expect |
|---|---|
| Open the app | **Recipes**: a gallery of photo cards; each card's second line is a computed `… kcal` |
| Open a recipe | It opens on its ingredients, as lines ("20 ml Olive oil"), over its photo; **Start cooking** is the bar at the bottom |
| **Start cooking** | The **custom cook view** (a full React component): one step at a time ("Step 1 of …"), **Next step** ticks the step it leaves, a step's timer starts from its button and the screen stays on |
| **Add a recipe → Type it in** → a name → **Add recipe** | It opens the new recipe; back on Recipes, its card is there, and still there after a reload |
| Type in **Search**; turn on **Can cook now**; **Filter** → a meal → **Done** | The cards narrow: a name match, what the pantry covers (a real JS predicate), the meal, kept as a chip |

Also: This week (meals planned on days), Shopping and Pantry (checklists).
`e2e/recipes-trusted.spec.ts`.

### Plants (`?app=plants`) — reminders and dates

| Do | Expect |
|---|---|
| Open the app | **Today**: Water now, room by room, each plant with a **Water** button, and what comes up next |
| **Water** on the Fern | It leaves Water now; **Care log** has "Watered · Fern" |
| Open a thirsty plant → **Soil still wet** | "Water in 2 days" on its page; Water is the bar at the bottom |
| A plant → **Log care…** | A form asking what and when: care can be backdated |

Reminders reconcile on load and change; on the web without notification permission they degrade to
the in-app Today view (native exact notifications are a device-only track). `e2e/plants-trusted.spec.ts`.

### Places (`?app=places`) — map and geo

| Do | Expect |
|---|---|
| Open the app | **Map**: a MapLibre map with a pin per place, and the places in view as cards along the bottom |
| The **Open now** chip on the map | It toggles (a JS predicate over opening hours) |
| **All places** → **Near me** | The browser asks for your location; places within 2 km stay |
| **All places** → a place → **Favourite** | The action runs and the page says so |
| A place → **Log a visit** | When, what you had, who with; the visit joins **Memories**, a timeline |

A browser without WebGL2 shows the places listed instead of the drawn map
(`map-no-webgl-trusted.spec.ts`). `e2e/places-trusted.spec.ts`.

### Workout (`?app=workout`) — nested lists and async computed

| Do | Expect |
|---|---|
| Open the app | **Train**: "Next up: Pull A", each exercise saying what to try today and why |
| **Start Pull A** | Every set filled from last time, the previous column beside it; ticking a set starts the rest clock (+30s, skip) |
| **Finish → Save and finish** | The summary names the records you just broke |
| **History** | Sessions on a timeline by week, newest first; the week's heading sticks under the top bar |
| **Progress** (under More on a phone) | Tiles for this week against last, and a bar chart of sessions per week you can hover, tap, or read with ← → |

An exercise's rolling best is an async computed that reads the session history.
`e2e/workout-train-trusted.spec.ts`, `e2e/timeline-trusted.spec.ts`, `e2e/progress-trusted.spec.ts`.

### Groceries (`?app=groceries`) — the checklist view

The list opens on its items in the aisles' walking order. A tap anywhere on a row ticks it, and the
ticked thing folds into "In the basket"; **Done shopping** appears at the bottom only once something
is in the basket. Tap the add box and it offers your usual items; a new one lands in the aisle it was
in last time. Several lists ("Weekly shop", "Party") are switched from the title, where the shell
also makes, renames, copies and deletes them. `e2e/groceries-trusted.spec.ts`; `groceries-sandbox`
proves the same ticking sealed.

### Split (`?app=split`) — money between people

Expenses in a group, with the answer above them ("You're owed …") and the shortest way to square it,
one row per payment with Settle on it. **Add expense** is the bar at the bottom; an expense splits
evenly, by shares or by exact amounts. Its point is two devices agreeing to the cent, so its specs
use two: `e2e/split-trusted.spec.ts`, `split-settle-trusted`, `split-guests-trusted`.

---

## 2. What the views and forms do

Each feature below has its own spec, which says where it is shown; the place named here is the one
to try by hand.

- **Dates are days (#103)** — any date field, e.g. Plants' "Last watered": the box says the day in
  words, chips set today, yesterday or tomorrow, the calendar opens a month grid (a popover on a wide
  screen, a bottom sheet on a phone), and no hour is asked for. Only a `precision: "minute"` field —
  Workout's session date — keeps a time box beside the day. `dates-trusted.spec.ts`.
- **Choosing one of a set (#98)** — Recipes' ingredient "Diet" has three options, so they sit in a row
  of buttons; Places' "Kind" has more, so it opens a searchable list. A tags field with no options
  (Plants' "Labels") takes a typed word as a chip. No browser `<select>` in any form; the chosen
  value wears the same colour in the form, on the record page and in the list. `enums-trusted.spec.ts`.
- **Photos (#102)** — Plants' "Photo" is a tile that says Add photo; on a phone it asks camera or
  library. No "Choose File" button anywhere. `media-trusted.spec.ts`.
- **Nested rows (#104)** — edit a recipe: its steps are cards with a grip (drag, or focus and ↑/↓),
  Remove in each card's menu, and the order you leave is the order saved. `list-rows-trusted.spec.ts`.
- **Relations by searching** — a recipe's ingredient rows: the ingredient is a searchable picker (a
  bottom sheet on a phone), not a dropdown. `relation-picker-trusted.spec.ts`.
- **Grouped sections (#108)** — Places → All places: places under their kind, in the enum's order,
  each heading with a count, folding and remembering the fold; a recipe's Nutrition section starts
  folded. `grouped-sections-trusted.spec.ts`.
- **Timeline (#110)** and **stats and a chart (#109)** — Workout's History and Progress, above.
- **Board (#107)** — records in columns, dragged between them or moved with a card's "Move to…". No
  example uses it; `board-trusted.spec.ts` drives it on a fixture app (`e2e/board-fixture.ts`).

## 3. Data export / import (KA-04) — "your data is a file"

| Do | Expect |
|---|---|
| Any app → `⋯` → **Export** | Downloads `<app>.potyro.zip` — unzip it: `data.sqlite` (opens in any SQLite tool), `manifest.json`, `app.ts`, `data.json`, `csv/<entity>.csv`; an app with libraries or modules also has `lock.json`, `files/.modules/` and `src/` |
| Add or change some data, then `⋯` → **Import** → pick the earlier `.potyro.zip` | The app reloads with the **bundle's** data: your later change is replaced, not merged |

Open the exported `data.sqlite` in **Datasette** or `sqlite3` to confirm it's a real, standalone DB.
What the bundle is and is not: docs/06 "Backup and portability".

## 4. Studio — make and change apps by asking

`⋯` → **Studio** (or **New app** on the launcher) opens a conversation, full screen: describe the app
you want, answer the agent's questions, and each version it makes arrives as a card. Open a card to
see the app as it will be — the whole screen on a phone, beside the conversation on a wide one.
Every version that passes the gates is saved as it is made; one that fails (it does not load, its
structure is wrong, or it rewrote the app instead of editing it) is held back on a card of its own
that says why. The code, its files and the version history are behind the Studio menu
(**Code, files and history**): edit the source, **Run ▶**, or go back to an older version.

**Model settings** chooses which engine writes, one of six (docs/00 "Engines"): `claude -p` (the
local Claude Code CLI through the dev server, no API key; dev only), On-device (WebLLM on WebGPU),
Chrome built-in (Gemini Nano, where the browser has it), Anthropic and OpenRouter (your own key), and
an OpenAI-compatible endpoint (a base URL, an optional key and a model). Keys are kept for the tab
only.

### Letting a sealed app run as yours

An app you make in the Studio is yours and runs directly (trusted); editing it does not change
that. One that came from someone else (a link, an import, `pnpm dev:sandbox`'s examples) runs sealed:

| Do | Expect |
|---|---|
| Open a sealed app → the **🛡 sealed** button in its top bar | **Let it run as yours?**, listing what it asks for |
| **Yes, run it as yours** | The app loads again as a module, directly. Its data is kept |
| An app that runs as yours → `⋯` → **Runs as yours** → **Put it back in the sealed box** | Sealed again |

The same dialog is reachable from the app's tile, from a sealed custom screen and from the screen
that says a sealed app could not open (`promote-always-trusted.spec.ts`).

## 5. Sandbox mode (untrusted execution)

```bash
pnpm dev:sandbox
```

Every example now runs **sealed**: look for the 🛡 sealed mark in the top bar. Everything (lists,
computed, filters, the custom views, the map) should still work — the app's functions run in the
browser realm (a Worker inside a sandboxed iframe, `#potyro-realms` in the DOM) with mediated
capabilities, not directly. `pnpm dev:sandbox:quickjs` (or `localStorage["potyro:sandbox"] = "quickjs"`)
runs them in the QuickJS-WASM fallback instead (#272).

---

## 6. The modification eval — is *changing* an app safe?

The browser suite proves the mechanism works. This measures the thing the mechanism is for: give a
model an app that **already holds records**, ask for three changes in a row, and see what survives.
Each modification is applied to whatever the last one produced, mistakes included — because that is
what happens to somebody who did not notice the first one.

```bash
# No model, no money. Writes a sample review sheet so the FORMAT can be argued about first.
pnpm --filter @potyro/generator eval:modify:fixture

# The real thing. It spends money, so every default is the cautious one.
pnpm --filter @potyro/generator eval:modify -- --only todo-groups --max-calls 5 --max-cost 6
```

Windows: `pnpm.cmd --filter @potyro/generator eval:modify -- …`.

Every check is mechanical. Nothing here asks a model whether a model did well.

| Check | What it means |
|---|---|
| **valid** | compiles and validates (the old bar, and the weakest) |
| **works** | every computed, filter, action, binding and custom view runs without throwing |
| **records survived** | every record that existed before is still **stored**. The gate that stops a chain |
| **values survived** | every stored field value is unchanged, or a migration step declared the change |
| **still reachable** | every surviving record can still be got to from some page |
| **nothing emptied** | no page filtered every record away |
| **feature works** | a behavioural assertion, on the scenarios that carry one |

The value check is the one worth having. A record can sit on the list screen with its title intact
and the paragraph you wrote gone — reachability calls that a pass. It also catches the tidy version:
the app stops declaring a field, every mention of it disappears with it, the app validates and
renders, and the values sit in the store where nothing will ever show them again.

Where nothing can be decided mechanically (a migration that ran a `transform`, an unattributable
value change) the verdict is **review**, not pass, and a person fills in the score.

### The edits eval — does the model edit, and does it refuse what it could do?

`eval:modify:edits` is the sibling: one change against a fixed corpus (`modify-corpus.ts`), through
the same guard the Studio uses, reporting whether the reply was edits or a rewrite, whether the
change landed, and whether the result validates. Two numbers were added for the ladder (#132, #135):

| Number | What it means |
|---|---|
| **refused when feasible** | the reply was `NOT-IN-APP` on a case that has a doable part. The failure the ladder exists to end; the target is 0 |
| **named what it could not do** | on a case with a part the host cannot do (`notDone` patterns), the reply's `Not done:` lines named every one |

`--loop` runs the corpus through the product's modify loop (#131: `lookup`/`check`/`example`, a
refusal without a lookup sent back once) instead of the one-turn guard; OpenRouter only.
`--backend scripted-decline` proves the harness: every case with a predicate scores refused.

```bash
pnpm --filter @potyro/generator eval:modify:edits -- --backend scripted-decline      # free proof
pnpm --filter @potyro/generator eval:modify:edits -- --backend openrouter --loop --only trip-scope,recipes-chart
```

### Cost controls

| Flag | Default | |
|---|---|---|
| `--only a,b` | whole corpus | run named scenarios |
| `--attempts N` | 1 | model output varies; each attempt costs again |
| `--concurrency N` | 1 | one chain at a time, so a failure and a charge are attributable |
| `--max-calls N` | none | hard stop, failures included |
| `--max-cost N` | none | hard stop on **reported** spend, in USD |
| `--allow-unmetered` | off | continue under `--max-cost` when the backend reports no cost |
| `--no-metering` | off | plain text out of the CLI: no tokens, no cost |

`claude -p` only reports spend under `--output-format json`, which is what the harness asks for. If
a call comes back with no cost anyway, the run **stops** rather than continuing under a ceiling that
was never going to fire; `--allow-unmetered` is how a person says they know it is unmetered. The
report then says so in as many words and gives call count and duration instead. **Call count is not
cost** and is never printed as though it were.

Reaching a limit is a graceful stop: the partial report and every source generated so far are
written, and the process exits non-zero so nothing mistakes a partial run for a passing one.

### Output

`eval-out/modify/` (git-ignored) holds every generated source, `report.json`, and `review.md` — the
sheet that links each step to the source it produced, with a blank human score beside it. Read the
sheet; open the failures.

Unit tests never call a model. The whole chain — migrations, repair, accounting, budget — is
exercised against canned sources in `packages/generator/test/modify-eval.test.ts`.

---

## What is not here yet

- **The native apps** (Capacitor: Android, docs/13; iOS, docs/27) build from the same web build; exact
  offline notifications, the camera and the rest need a device build to exercise.
- **A community registry.** Apps travel by link, invite and file (docs/24), and the launcher's
  "Browse the gallery" opens a hand-picked page on potyro.com; there is no search or catalogue of
  everyone's apps inside Potyro.
- **Merging a file into an app.** Sync across devices is the CRDT store (docs/00 "Sync, CRDT and
  identity"); an exported bundle is a snapshot, and importing it replaces the app's records
  (docs/06 "Backup and portability").

## Feedback — what's most useful to hear

1. **Anything that breaks or errors** (with the app id + steps).
2. **Confusing UX** — a control you didn't understand, a flow that felt wrong.
3. **The generator** — for a given description, was the generated app usable? How many fix rounds?
4. **The sealed box** — did an app someone sent you run as expected?
5. **Missing app examples** — a domain you'd want to see as a fixture (habits? budget? notes?).
6. **Design/quality** — does it look like a real product or a prototype?

Drop notes per section; I'll turn them into issues/fixes.
