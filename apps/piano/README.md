# Piano — a personal practice app

The plan is data; the app only knows that a plan has phases, weeks, five daily blocks, "done when"
goals and optional modules.

```
plan.json        the plan: phases → weeks → blocks, resources with URLs, goals, blues/jazz modules
plan.ts          the contract plan.json must satisfy, and validatePlan()
progress.ts      where you are and how you move: goal-based advance, repeat, modules, rest/review day
styles.ts        the app's stylesheet, as a string
piano.app.tsx    the UI (Today, Log, Plan, Modules, Sessions); reads plan.json with ctx.files
test/            the plan validates, the progress logic, the app
```

## Build and install

```
pnpm --filter @potyro/app-piano build     # → apps/piano/dist/piano.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose `dist/piano.potyro-app.zip`. The card says
it comes with `plan.json`; tick **I wrote this. Run it as mine.** (the custom screens want it), then
**Add app**. To update, pack again and add the zip again: **Replace it, keep its data** is already
chosen, History keeps the previous version, and your progress stays.

`plan.json` is not part of the code any more. It ships in the app's own folder, so a new plan only
needs a new package, and a plan you edited inside the app is kept when the app is updated.

There is no build step of the app's own. `build` is `pnpm pack:app`: it packs `piano.app.tsx` as it is
here, the modules it imports (`plan.ts`, `progress.ts`, `styles.ts`) as the package's `src/`, and
`plan.json` as a file in `files/` (#258). The shell resolves `./plan.js` from `src/` when it bundles
the app; `piano.app.tsx` stays the one file the Studio, History and Ask edit.

## Changing the plan

Edit `plan.json` and pack again, or — without touching the app — bring a plan file in from inside it:
**Modules → Settings → Load plan file…** (it lands in the app's `plans/` folder). Either way the file is checked against `plan.ts` first and
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
pnpm --filter @potyro/app-piano test
pnpm --filter @potyro/app-piano typecheck
pnpm --filter @potyro/shell exec vitest run test/piano-package.test.ts   # packs it and bundles it as the shell does
```
