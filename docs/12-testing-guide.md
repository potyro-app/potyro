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

Switch apps with the header dropdown or the URL: `?app=recipes | plants | places | workout`.

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

## 6. "Create an app" panel — run any app safely

| Do | Expect |
|---|---|
| Header **New app** | A panel with a starter `.app.ts` in an editable source box |
| Click **Preview** | The source is bundled in-browser (esbuild-wasm) and run **untrusted in the QuickJS isolate**; the app renders inline with an `untrusted` badge |
| Edit the source (add a field/entity/page) → **Preview** again | Your edited app renders |
| **Describe an app…** + your **Anthropic API key** → **Generate** | Claude writes a `.app.ts` into the source box; **Preview** it. If it errors, **Fix with AI** feeds the error back |

> The API key is your own, held only in memory for this local tool. Generation needs a valid key
> (and Anthropic browser access). Edge/on-device generation (WebGPU) is wired in the backend but not
> yet in this panel.

## 7. Sandbox mode (untrusted execution)

```bash
pnpm dev:sandbox
```

Every example now runs **untrusted in the isolate**. Look for the **untrusted** badge in the header.
Everything (lists, computed, filters, calendar, map) should still work — the app's functions run inside
QuickJS-WASM with mediated capabilities, not directly.

---

## What's intentionally not done yet

- **Native app** (Capacitor) — exact offline notifications, camera, etc. (needs a device build).
- **On-device generation** in the panel (WebGPU/WebLLM) — backend exists, panel wiring pending.
- **Run an arbitrary *shared* app** (community fork) — the runtime path exists; the discovery/registry UI does not.
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
