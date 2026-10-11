# Piano — a personal practice app

The plan is data; the app only knows that a plan has phases, weeks, five daily blocks, "done when"
goals and optional modules.

```
plan.json        the plan: phases → weeks → blocks, resources with URLs, goals, blues/jazz modules
plan.ts          the contract plan.json must satisfy, and validatePlan()
progress.ts      where you are and how you move: goal-based advance, repeat, modules, rest/review day
piano.app.tsx    the UI (Today, Log, Plan, Modules, Sessions)
build.mjs        inlines the three files above into dist/piano.app.tsx — the ONE file you import
test/            the plan validates, the progress logic, the app and its built file
```

## Build and import

```
pnpm --filter @karta/app-piano build     # → apps/piano/dist/piano.app.tsx
```

Open the shell, go to the **Studio**, switch the stage to **Source**, paste the whole of
`dist/piano.app.tsx`, **Run ▶**, then **Save to My Apps**. Apps saved from the Studio run trusted,
which the custom screens need; if the header badge says **untrusted ▾**, tap it and **Promote to
trusted**. Rebuild and paste again to update it (History keeps the previous version).

Why a build step: the shell bundles an imported app from one source string, where only `karta` and
`react` resolve. The build keeps the output readable TypeScript (comments and types intact).

## Changing the plan

Edit `plan.json` and rebuild, or — without touching the app — pick the file from inside it:
**Modules → Settings → Load plan file…**. Either way the file is checked against `plan.ts` first and
every problem is reported by path. Progress is keyed by week id, so a week the new plan keeps is
still where you were; one it drops lands you on the first week. Sessions and logs are never touched.

Shape, in brief (see `plan.ts` for the full contract):

- `blocks` — the daily blocks in order, each with `id`, `label`, `minutes`.
- `phases[].weeks[]` — one row per plan-table row: `id`, `label`, `spanWeeks` (2 for "Weeks 5–6",
  4 for a month), `blocks` keyed by block id (`{ text, links }`), `doneWhen`. A block a week does
  not name inherits the previous week's; the first week must name them all.
- A link is `{ "resource": "<id>" }` into `resources`, or `{ "title", "url" }`.
- `modules[]` — `id`, `title`, `intro`, `availableFrom` (a week id; starting earlier only warns),
  `suggestedWeeks: [min, max]`, and `weeks[]` whose `blocks` override only the blocks they name
  (blues and jazz override `technique` and `repertoire`). Past the last defined week, it repeats.

## How it behaves

- **Today** shows the current week's five blocks, each with a countdown, the exercise, external
  links and a done check. Day 7 of the cycle (counted from the start date) is the rest day; on the
  review weekday block 5 becomes "Record + log", which opens the week-log form prefilled with the
  days practised this cycle. Done checks are `session` records, one per day.
- **Goal met → next** and **Repeat this week** are the only ways to move. The calendar never does.
- **Modules** starts blues or jazz for N weeks; blocks 2 and 4 follow the module, the rest the main
  plan, and when the module ends (or you leave) the plan resumes where you left it. Settings for the
  start date, review weekday and plan file live on the same tab.
- **Log** lists week logs newest first: days practised, piece recorded, tempo (bpm), one thing to
  fix, notes.
- Plan and progress live in the app's `ctx.storage`; sessions and logs are entity records. Offline,
  persisted, exportable with the app's data.

## Checks

```
pnpm --filter @karta/app-piano test        # also rebuilds dist/ from the sources
pnpm --filter @karta/app-piano typecheck   # covers dist/ once it exists
```
