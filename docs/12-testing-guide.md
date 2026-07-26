# 12 · Testing guide — try it & give feedback

A hands-on walkthrough of everything built so far. Work top to bottom, or jump to a section. For each
item there's **what to do** and **what you should see** — note anything that surprises you, breaks, or
feels off, and report back (see *Feedback* at the end).

## Run it

```bash
pnpm i
pnpm dev            # trusted shell → http://localhost:5173
pnpm dev:sandbox    # same apps UNTRUSTED in the QuickJS-WASM isolate
```

Opening `/` shows the **launcher** — a home screen listing apps by provenance: **Apps** (trusted
built-ins) and **My Apps** (untrusted apps you saved in the Studio). Click a tile to launch it. Inside
any app, the **⊞ Apps** button slides the launcher in to switch. Deep links still work:
`?app=recipes | plants | places | workout` (built-ins) or `?user=<id>` (a saved app).

> **Note on durability:** the durable store is SQLite over OPFS. Some browsers (and headless Chrome)
> lack the sync-access-handle API and silently fall back to `localStorage` — data still persists per
> browser, just not as a real SQLite file. Chrome/Edge desktop have full OPFS.

---

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

## 5. Data export / import (KA-04) — "your data is a file"

| Do | Expect |
|---|---|
| Any app → header **Export** | Downloads `<app>.karta.zip` — unzip it: `data.sqlite` (opens in any SQLite tool!), `manifest.json`, `app.ts`, `data.json`, `csv/<entity>.csv` |
| Add or change some data, then header **Import** → pick the earlier `.karta.zip` | The app reloads with the **bundle's** data (your later change is replaced) — the round-trip |

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

## 7. Sandbox mode (untrusted execution)

```bash
pnpm dev:sandbox
```

Every example now runs **untrusted in the isolate**. Look for the **untrusted** badge in the header.
Everything (lists, computed, filters, calendar, map) should still work — the app's functions run inside
QuickJS-WASM with mediated capabilities, not directly.

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
