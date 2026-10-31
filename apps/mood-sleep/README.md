# Sleep & Mood — how did you sleep?

A morning check-in, and a screen that shows what the check-ins add up to. It is a showcase for a
library imported by URL (#266): the charts are [chart.js](https://www.chartjs.org/) 4.5.1, fetched
once from esm.sh when the app is added and kept with it.

**It only runs as your own app.** The Patterns screen draws on a `<canvas>` with chart.js, which needs
a real web page. Add it with **I wrote this. Run it as mine.** ticked. Left unticked, the app runs in
the sealed box, which has no web page to draw in, so the Patterns screen cannot work there.

```
mood-sleep.app.ts   the app: the check-in, the Nights list, and the Patterns screen (chart.js)
insights.ts         what the check-ins say — the series, the scatter groups, the one sentence on top
card.ts             the share picture: the sentence, the stats and the nights, on the night palette
styles.ts           the Patterns screen's stylesheet, in the shell's tokens
seed.json           three weeks of sample nights, so the app looks alive the first time it opens
chart-js.d.ts       types for the URL import (the npm package's, same version)
test/               insights.ts, the card's layout, the seed against the fields, the app's shape
```

## What you see

- **Patterns** — one sentence about your nights, worked out in `insights.ts`: "On nights of 7 hours or
  more your mood averages 4.3. Under 6 hours, it's 2.4." A second line names the habit that moves
  things most ("On stressful days you sleep 5.6h on average, against 7h without"). Under it: average
  sleep, average mood, and the share of nights of 7 hours or more.
  - **Night by night**: sleep (left axis, with the 7-hour line) and mood (right axis, as faces) for up
    to the last 30 days, ending on your latest check-in. A day you skipped is a gap, not a zero.
  - **Does a long night lift the day?**: every night as a dot, hours across and mood up, coloured by
    what the day had. The chips above it show or hide each tag; the dashed line is the trend.
  - **Log last night** opens the check-in form right there.
  - **Share** draws the top of the screen as a 1080×1350 picture — the sentence with its numbers in
    the series colours, the three stats and the nights chart — on the dark theme's colours whatever
    the screen's, and hands it to `ctx.ui.share`: Potyro's share dialog shows the picture, then sends
    it through the share sheet where the device has one, or saves a copy. It is drawn in `card.ts`;
    the chart keeps at least 420px of the card, and the sentence takes the size that fits above it.
- **Nights** — every check-in, newest first; tap one to see or change it.

Colours and fonts come from the shell's design tokens (`--ink`, `--line`, `--surface`, `--accent`,
`--font-display`…), read when the screen opens and again when light or dark mode changes, so the
charts follow the theme like everything else.

With fewer than a handful of check-ins it does not invent a pattern; it says how many more nights it
needs.

## Build and install

```
pnpm --filter @potyro/app-mood-sleep build   # → apps/mood-sleep/dist/mood-sleep.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose the zip. The card says it fetches
**chart.js 4.5.1 from esm.sh** and starts with 20 records. Tick **I wrote this. Run it as mine.**, then
**Add app**. chart.js is fetched then, once; after that the app works offline.

## Checks

```
pnpm --filter @potyro/app-mood-sleep test
pnpm --filter @potyro/app-mood-sleep typecheck
pnpm e2e e2e/mood-sleep-trusted.spec.ts      # installs the package for real and reads the chart's pixels
```
