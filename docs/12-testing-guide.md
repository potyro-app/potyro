# 12 · Testing guide — try it & give feedback

A hands-on walkthrough of everything built so far. Work top to bottom, or jump to a section. For each
item there's **what to do** and **what you should see** — note anything that surprises you, breaks, or
feels off, and report back (see *Feedback* at the end).

## Run it

```bash
pnpm i
pnpm dev            # trusted shell → http://localhost:5173
pnpm dev:sandbox    # same apps UNTRUSTED, their logic in the browser realm (#272)
pnpm dev:sandbox:quickjs   # the same, in the QuickJS-WASM fallback
```

Opening `/` shows the **launcher** — one list of your apps, pinned ones first, then by how often
and how recently you open them (#84). The four examples (`recipes`, `plants`, `places`, `workout`)
are seeded into that list on first run as ordinary apps (#152): open them in the Studio, rename,
share or delete them — a deleted example stays deleted. Click a tile to launch it. Inside any app,
the **⊞ Apps** button slides the launcher in to switch. Deep links: `?user=<id>`; the older
`?app=recipes` form still opens the same app.

> **Note on durability:** the durable store is SQLite over OPFS. Some browsers (and headless Chrome)
> lack the sync-access-handle API and silently fall back to `localStorage` — data still persists per
> browser, just not as a real SQLite file. Chrome/Edge desktop have full OPFS.

## Run the checks

```bash
pnpm i
pnpm -r test        # unit suites, every package
pnpm typecheck      # every package, plus the docs spikes
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
parallel clients of the same state. At the default worker count `export-import-trusted.spec.ts`
dies on `Boot error: Missing required OPFS APIs.`; at one worker it passes.

`POTYRO_PARALLEL=4 pnpm e2e` is available for a quick local sweep; confirm anything it reports at one
worker before believing it.

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

### Known intermittent: `export-import-trusted.spec.ts`

It still fails occasionally at one worker, and it is **not a test-isolation problem** — running it
alone, six times, passes every time in about a second. It fails at the assertion *after* the
import, and the page under it reads `Boot error: Missing required OPFS APIs.`

That points at product code, not at the suite. The ordinary open path degrades: `openStore` catches
a failed `createSqliteStore` and falls back to `localStorage`, with a comment saying that is
expected on browsers without OPFS. The **import** path does not — `bootBuiltin` calls
`importSqliteStore` unguarded (`packages/shell/src/main.tsx`), so the same condition that is a
graceful fallback on open is a dead white page on import. Importing is also the one flow that opens
the SAH pool for a name the *previous document* had open moments earlier, which is a plausible
reason it is the only spec that sees it.

Not fixed here: the cause is understood but not confirmed, and guessing at a durability fallback
under time pressure is how an import silently stops being durable. It wants its own change.

### The launcher harness (`e2e/launcher/`)

The launcher is audited by *operating* it, on the device it is for (#94). One directory, one spec
per concern, all on the same seeded library (`fixture.ts`: eight apps, trusted and untrusted, synced
and local, names colliding on their first letter):

- `touch-trusted.spec.ts` — 375×812 with touch: open, switch, share, rename, delete. Every control
  tapped is measured against 44px.
- `keyboard-trusted.spec.ts` — 1440: Tab order through the grid, the tile menu as a real menu.
- `a11y-trusted.spec.ts` — axe on home, switcher and open menu (zero serious/critical), and a
  reduced-motion run in which nothing animates.
- `baselines-trusted.spec.ts` — screenshots of home (empty, seeded), the tile menu and the switcher
  at 375 / 768 / 1440 in light and dark, plus the share dialog at the two ends, and the Plants form
  at 375 / 1440 in both schemes — the one shot the forms epic (#113) lands its controls in: switch
  rows, numbers with units and steppers, groups, help lines and half-width pairs.

`pnpm e2e:launcher` runs the directory (about a minute at one worker).

**The baselines are CI's pixels.** Two Linux machines with the same Chromium and the same fonts
still disagree — glyph hinting by a few hundred pixels a page, and a classic scrollbar on one shifts
a layout that overlay scrollbars on the other leave alone — so the comparison runs on CI and is
skipped locally (`POTYRO_BASELINES=1 pnpm e2e:launcher` compares here anyway, expect noise). After a
change to the launcher's pixels that you meant, regenerate them on the runner and they land on your
branch as a commit:

```
gh workflow run baselines.yml --ref <your-branch>
```

A diff you did not mean is the point: CI's report artifact carries the expected / actual / diff
images for every shot that moved.

### Specs that skip themselves, and say why

- `studio-generate-trusted.spec.ts` drives a **real** `claude -p`. With no `claude` on PATH it skips
  immediately rather than waiting out a 330-second timeout for something knowable up front. The
  deterministic cover for the same path — Studio → save → History → rollback, with the generator
  endpoint stubbed — is `create-modify-rollback-trusted.spec.ts`, which needs no CLI and no money.
- `deployment-prod.spec.ts` needs a production build: `pnpm test:e2e:prod`.
- The Firefox project is opt-in: `pnpm test:e2e:firefox`.

---

## 0. The chrome around every app (#111)

Open any app at 375 wide: a top bar (Apps, the app's icon and name, one `⋯` menu), the page, a
floating button with the page's quick action, and a bottom tab bar with four pages and More. The
shell's tools — Studio, Edit mode, History, Import, Export, "Something's wrong", the trust line —
are in the `⋯` menu; on a wide screen they are the "This app" group at the bottom of the sidebar,
under the pages and the quick actions. There is no TRUSTED pill: an untrusted app carries a grey
"sandbox" mark, and specs read the app root's `data-provenance` instead. A record's page shows its
title, one filled action (the app's first), the others plain, and Edit / Delete behind "More
actions". `chrome-trusted.spec.ts` drives all of it at 375 and 1440.

## 1. Recipes (`?app=recipes`) — the M1 core

| Do | Expect |
|---|---|
| Open the app | A **Recipes** list; each row shows a computed `… kcal · difficulty` secondary line |
| Click a recipe | Detail view with sections (Overview, Per serving, Diet & cost, Ingredients) |
| On a recipe, click **Cook** | The **custom cook-along** view (a full React component) — tick step checkboxes; **Finish** enables when all are ticked |
| Header **+ New Recipe** → type a name → **Create** | The new recipe appears in the list |
| Reload the page | Your added recipe is still there (persistence) |
| Tab **What can I cook?** → tick ingredients under **In my pantry** | The list filters to recipes you can fully make (a real JS predicate) |
| Tabs **High protein / Plant-based / Ready to cook** | Different filtered/sorted views over the same data |

Things to judge: does the computed macro line look right? Is the cook-along clear? Does the pantry
filter behave as you'd expect?

## 2. Plants (`?app=plants`) — M2 reminders + calendar

| Do | Expect |
|---|---|
| Open the app | **Plants** list sorted by next watering; overdue ones say "overdue!" |
| Tab **Due** | Only overdue plants (seed data has one) |
| Click **water** on a due plant | It's watered now → leaves the Due list |
| Tab **Schedule** | A **month calendar** with plants on their next-watering day; prev/next month nav |

Reminders are wired to reconcile on load/change; on web with no notification permission they degrade to
the in-app **Due** view (native exact notifications are a separate, device-only track).

## 3. Places (`?app=places`) — M3 map + geo

| Do | Expect |
|---|---|
| Open the app | Default **Map** page — a MapLibre map with markers for each place |
| On the Map, chips: **Category / Vibe / Open now** | Toggling filters the markers (JS predicate over params) |
| Tab **Near me** → click the **Near me** chip | Browser asks for location; nearby places (≤2 km) filter in |
| Tab **All places** → click a place → **Location** section | Coordinates shown as an OpenStreetMap link |
| Header **+ New Place** → **Use my location** in the geo field | Fills lat/lng from your device |

## 4. Workout (`?app=workout`) — nested lists + async computed

| Do | Expect |
|---|---|
| Open the app | Sessions with nested entries → sets (reps × weight); a detail view walks the nesting |
| Look at exercise stats | `lastBest` is an async computed that scans session history |

---

## 4b. Groceries (`?app=groceries`) — the checklist view

A shopping list that is one tap per item (#106). Seven seeded items under aisle headings, two
already bought and folded into "Done (2)". Tick Milk: it strikes through, holds a beat, moves to
Done, and is still bought after a reload. Type "Coffee" in the box at the bottom and press Enter:
it appears under "pantry" (the aisle's default) and the box keeps the focus. `groceries-sandbox`
proves the same ticking works untrusted, with the app's `sort` crossing the isolate bridge.

## 4m. Actions that ask (#112)

PPL Log → History → open a session → **Log set**: one form with the exercise, weight and reps, starting
from the session's last set; logging adds the set and says so. **Train** → start a workout → **Finish**:
a sheet with Save and finish, Keep training, and Discard workout last in red. On a phone, **More
actions → Delete** on any record asks in a bottom sheet whose button says Delete. `pnpm dev:sandbox`
does the same inside the isolate — Log set included.

## 4l. History — a timeline (#110)

PPL Log → **History**: sessions newest first under "This week", "Last week", then a date range per
week. Each dot is the day's colour (push red, pull blue, legs green) and each card shows the day it
was. Scroll: the heading of the week you are reading sticks under the top bar, and older weeks keep
appearing as you near the end. Tap a card to open the session.

## 4k. Progress — stats and a chart (#109)

PPL Log → **Progress**: three tiles (sessions this week, volume this week, average session), each
with how it compares with last week in words. Under them a bar chart of sessions per week for eight
weeks, the latest bar labelled. Hover a bar, tap it on a phone, or focus the chart and press ← → to
read any week; Escape clears it. In the dark theme the bars turn a lighter amber. `pnpm dev:sandbox`
shows the same numbers — every figure is computed inside the isolate.

## 4j. Board — records in columns (#107)

Recipes → **Cookbook**: every recipe under want to try, tried or keeper, each column with its colour
dot and a count; the empty column says "Nothing here" and offers **＋ Add** starting in that column.
Drag a card to another column — the column lights up under it — and it stays there after a reload.
A plain click still opens the recipe. On a phone the columns snap sideways one at a time; a card's
**⋯ → Move to …** moves it without dragging.

## 4i. Grouped sections — every group at once (#108)

Places → **All places**: the places sit under their category, in the order the enum declares
(restaurant, bar, cafe, …), each heading with a count. Click a heading: its places fold away. Reload
— still folded. The category chips still narrow it to one. On a phone with a long list, scroll: the
heading of the group you are in stays pinned under the top bar. Open a recipe: **Ingredients** folds
from its heading with its count, **Steps** starts folded, and both remember what you did.
## 4g. Relations — pick by searching (#98 follow-up)

Edit a recipe: each ingredient card's **Ingredient** is a button, not a dropdown. Open it, type
"egg", pick **Egg**. Type something that does not exist, "Saffron", and the list's last line reads
**＋ New ingredient “Saffron”…**: it opens a second sheet with the name filled in, and creating it
selects it. On a phone the list is a bottom sheet. A field that holds several records shows the
chosen ones as chips with ✕, and **＋ Add** opens the list with checkmarks and a **Done**.

## 4f. Nested rows — cards you can reorder (#104)

Open a recipe, **More actions → Edit**, and unfold **Steps**. Each step is a card: the text on its
line, its time under it, and Remove in the card's `⋯` menu — no bare ✕ beside the boxes. Steps are
`ordered`, so each card has a grip: drag it with the mouse, or focus it and press ↑/↓. **Save
changes** and the record page lists the steps numbered, in the order you left them. Ingredients are
not ordered, so their cards are numbered instead of gripped. **Add step** names what it adds and
puts the caret in the new card. On a phone, flick a card's grip sideways and Remove appears.

## 4e. Photos — a tile, not a file button (#102)

**New Plant** in Plants: "Photo" is a dashed tile that says **Add photo**. On a desktop, click it
(the file dialog opens) or drag an image onto it; the tile then shows the photo with an ✕ to take it
off. On a phone it asks first: **Take a photo** or **Choose from library**. Save, and the record page
shows the same tile. Places' photo field takes several, so it shows a strip with the add tile last,
and the record page shows all of them. There is **no "Choose File" button** anywhere in a form.

## 4d. Enums — the control the list deserves (#98)

**New Ingredient** in Recipes: "Diet" has three options, so all three sit in a row — tap one, tap it
again to unset it. "Category" has eight, so it opens a searchable list under the field; type "fr",
press Enter, and it takes the first match. On a phone the same list arrives as a bottom sheet. There
is **no `<select>` left in any form**. The value you chose wears the same colour in the form, on the
record page and in the row badge back in the list. In Plants, "Labels" has no fixed options: type a
word, press Enter, it becomes a chip; Backspace on the empty box removes the last one.

## 4c. Dates — a day, not a moment (#103)

Any form with a date: **New Plant** in Plants ("Last Watered"), or the e2e fixture app. The box
says the day in words — "Today, 12 Sep", "In 3 days, 15 Sep", "Thu, 24 Dec" — and **never asks for
an hour**. Tap **Today** / **Yesterday** / **Tomorrow** and the box fills; **Clear** empties it.
The calendar button opens a month grid: a popover under the box on a wide screen, a bottom sheet on
a phone, with the same shortcuts plus **+1 week**. Type into the box too: `2026-12-24`, `24/12/2026`,
`24 dec` and `tomorrow` all land; anything else is ignored and the box goes back to what it held.
Save it and the record page shows the day with no time.

The exception is a field that asks for the hour. Workout's session date says `precision: "minute"`,
so it — and nothing else — has a time box beside the day (below it on a phone).

## 4h. Local CI — the merge gate on this machine

`pnpm ci:local all` runs what GitHub's CI runs: install, build, every unit suite, typecheck, the
boundary and token lints, and the whole trusted + sandbox browser suite in five shards, one worker
each, one retry for a flake. Each step records its result under `.ci-local/<commit>/`, so an
interrupted run picks up where it stopped (`pnpm ci:local status` shows what is left), and it refuses
to run on uncommitted changes so a result always describes a commit. `pnpm ci:local status --post`
marks the commit with a `local-ci` check on GitHub once everything passed. The pixel baselines are
skipped here — they are GitHub's runner's pixels — and want regenerating there when Actions return.

## 5. Data export / import (KA-04) — "your data is a file"

| Do | Expect |
|---|---|
| Any app → header **Export** | Downloads `<app>.potyro.zip` — unzip it: `data.sqlite` (opens in any SQLite tool!), `manifest.json`, `app.ts`, `data.json`, `csv/<entity>.csv`; an app with libraries or modules also has `lock.json`, `files/.modules/` and `src/` |
| Add or change some data, then header **Import** → pick the earlier `.potyro.zip` | The app reloads with the **bundle's** data (your later change is replaced) — the round-trip |

Open the exported `data.sqlite` in **Datasette** or `sqlite3` to confirm it's a real, standalone DB.

## 6. Studio — build, run, and save apps (full screen)

Header **Studio** opens a full-screen builder. The **live app is the default view** — the starter
app renders immediately (bundled in-browser with esbuild-wasm, run **untrusted in the QuickJS
isolate**, `untrusted` badge). It's fully interactive: add records, switch pages, tick things.

| Do | Expect |
|---|---|
| Open **Studio** | Full-screen: controls on the left, the **running app** filling the stage |
| Type in **Describe your app** (a textarea) → **Generate (claude -p)** | Local Claude Code auth via the dev server — **no API key**. The app regenerates and re-runs in the preview |
| **On-device** (WebGPU browser) + the model dropdown | Runs a local coder model (WebLLM): **0.5B** (~0.5 GB, fastest) → **1.5B** (~1 GB, recommended) → **3B** (~2 GB, best); cached then offline |
| **Built-in (Chrome)** — only if your browser exposes the Prompt API | Chrome's built-in **Gemini Nano**, on-device, **no download** (general-purpose → expect more **Fix** rounds) |
| **Cloud** (paste `sk-ant-…`) | Your own Anthropic key (in-memory only) |
| Toggle **Source** (top of the stage) → edit → **Run ▶** | See/edit the `.app.ts`; **Run** re-bundles and previews. **Preview** is the default tab |
| On an error → **Fix with AI** | Feeds the error back (claude -p, or cloud if a key is set) |
| **Save to My Apps** | The app is stored locally and appears in the **My Apps** list (left). Saved apps re-open with a **durable per-app store**, so their data persists — they're usable, not preview-only |
| Click a saved app in **My Apps** | It re-opens and runs; **✕** deletes it |

> **Answers "how do I save an app?"** — Save to My Apps. Everything you make lives in that list and
> re-opens as a real, running app. (A shared/community library is a later layer.)

### Promote untrusted → trusted

Saved apps run **untrusted** (in the sandbox) by default. To run one **directly** (trusted):

| Do | Expect |
|---|---|
| Open a saved app → click the **untrusted ▾** badge (top-left) | A trust prompt listing the app's declared capabilities |
| **Promote to trusted** | The app reloads and runs **directly** as a real module — badge shows **trusted**. Its data persists |
| Click **trusted ▾** → **Revoke trust** | Back to running in the isolate |

Editing a trusted app's source (Studio or Edit mode) resets it to untrusted — a new version isn't
vouched-for until you promote it again. A trusted load that fails (e.g. an invalid edit) falls back to
the sandbox so the app still opens.

## 7. Sandbox mode (untrusted execution)

```bash
pnpm dev:sandbox
```

Every example now runs **untrusted**. Look for the **untrusted** badge in the header. Everything
(lists, computed, filters, calendar, map) should still work — the app's functions run in the browser
realm (a Worker inside a sandboxed iframe, `#potyro-realms` in the DOM) with mediated capabilities,
not directly. `pnpm dev:sandbox:quickjs` (or `localStorage["potyro:sandbox"] = "quickjs"`) runs them in
the QuickJS-WASM fallback instead (#272).

---

## 8. The modification eval — is *changing* an app safe?

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

## What's intentionally not done yet

- **Native app** (Capacitor/Android) — the target is wired (see `docs/13-native-android.md`); exact
  offline notifications, camera, etc. need a device build to exercise.
- **Run an arbitrary *shared* app** (community fork) — the runtime path exists and **My Apps** is the
  local library; the shared/community discovery/registry UI does not exist yet.
- **CRDT sync** across devices.
- Functional **snapshot vs mergeable** export stripping (waits on CRDT).

## Feedback — what's most useful to hear

1. **Anything that breaks or errors** (with the app id + steps).
2. **Confusing UX** — a control you didn't understand, a flow that felt wrong.
3. **The generator** — for a given description, was the generated app usable? How many "Fix" rounds?
4. **The isolate preview** — did a pasted/edited app run as expected?
5. **Missing app examples** — a domain you'd want to see as a fixture (habits? budget? notes?).
6. **Design/quality** — does it look like a real product or a prototype?

Drop notes per section; I'll turn them into issues/fixes.
