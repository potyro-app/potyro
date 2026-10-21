# Countdowns

Days until each thing that matters. The nearest one is the whole top of the screen — one big
number, "days until Lisbon trip", the date — the rest follow as a short list, soonest first, and
what has passed is folded away underneath. Adding is one short form: what, when, an emoji if you
like. The launcher tile shows the next one, and how many fall in the coming week.

```
countdowns.app.tsx   the app: the Soon screen, the event page, the tile, the demo
dates.ts             how days are counted: whole calendar days, in the person's own time zone
words.ts             every word on the screens, in six languages
test/                the counting, the tile, the demo, the app's shape and words
```

## How days are counted (dates.ts)

A whole calendar day at a time, in the person's own time zone: "tomorrow" is 1 all day long and only
turns at midnight; an event today is "Today!"; one that has passed reads "3 days ago". An event's
date is a `datetime` field with `precision: "day"`, stored as `2026-11-30`.

Where the device lets apps remind people (`ctx.caps.notifications`), an event added through the form
rings at nine on its morning. Nothing in the app needs it: with no permission there is no reminder,
and nothing says so.

The demo (`demo`) writes four events relative to today — a trip in 12 days, a birthday in 33, a
driving test in 61, and a move 18 days ago — so a demo link never opens empty or stale.
