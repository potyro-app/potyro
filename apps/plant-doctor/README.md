# Plant Doctor

Photograph a plant, or one sick leaf. It says which plant it most likely is and what might be wrong —
in plain words, as sure as one photo allows and no surer — with what to check, what to do, and when to
ask someone who can see it. Keep the plant with a care plan and reminders; a check-up photo later says
whether it is better or worse since last time, and the check-ups line up into a timeline.

```
plant-doctor.app.ts   the app: Plants, Check-ups, a plant's page (its plan and its check-ups), a check-up's page
read.ts               looking: the photo, the finding read first, the care plan form, a check-up, watering
reading.ts            what a photo is read into (`DIAGNOSIS`), the instructions, and the finding the app keeps
care.ts               watering intervals, check-up spacing, health, what counts as serious, the reminders
words.ts              how it all reads — and how sure it sounds — in six languages
sample.ts             the sample pothos (two SVGs, before and after) and the answers they "read"
fields.ts             a plant's and a check-up's fields, and the care plan form
test/                 the arithmetic, the words, and every path against a scripted ctx
```

## How it works

- **Check a plant** offers *Take a photo*, *Choose a photo*, *Try it on a sample photo* and *Add it
  without a photo*. One `ctx.caps.ai.extract` reads the photo: the plant (everyday and botanical name,
  how sure), the problem (one of nine kinds, a plain name, how sure, the signs, 2–4 things to check,
  2–4 things to do, whether it could be serious) and a usual care plan (watering, light, what to watch).
  Only the photo and the instructions are sent.
- **Honest about certainty** (`words.ts`). The app never says a plant *has* something. A sure look is
  "Most likely: …", a medium one "Probably: …", a weak one "Possibly: … — hard to tell from a photo";
  a photo that cannot tell says so. Every finding ends with when to ask a garden centre or a plant
  expert, louder when it could be serious ("keep it away from your other plants"). A disease counts as
  serious whatever the model said: it can spread. The model is told the same: never certain, never
  "high" from one sign or a poor photo, nothing stronger than soapy water for pests.
- **The person reads the finding before anything is kept**, then checks the care plan (name, kind of
  plant, light, water every N days, last watered) — filled in from the look and in range (1–30 days).
  *Not now* keeps nothing, not even the photo.
- **Reminders**: 9:00 on the day it next wants water (counted from the last watering), and 9:00 on the
  day of the next check-up photo — in 3 days when it could be serious, a week when it is struggling, two
  weeks when it is okay, a month when it is doing well. The plant's page lists them as they will come.
- **A check-up** sends the earlier photo beside today's, with the one line the app kept about the
  earlier look (its date and what it seemed to be), and gets back *better / about the same / worse /
  hard to compare* and what changed. The plant's health, photo and next check-up follow it.
- **Check-ups** is the timeline of every look, coloured by better or worse; each plant's page has its own.
- **Sharing**: a plant's care plan, or a check-up — which says it is a guess from a photo, not a
  diagnosis (`ctx.ui.share`).
- **When looking fails** it says so: no plant on the photo, a photo too blurry or dark (with how to take
  a better one), no AI here, or the AI's own words — and offers the sample or adding it without a photo.
- **The sample pothos** is two SVG pictures, before and after, in the person's language with SAMPLE
  across the top, each with the answer the AI would have given. It runs through the same steps — the
  finding, the care plan, the reminders, and a check-up that finds it better — with no key and nothing
  sent. Its check-up is offered only after the sample's first look.

Every screen is a built-in view, so a friend's shared (sealed) copy has the whole app; it asks them
before the camera and before the AI.

## Build and check

```
pnpm --filter @potyro/app-plant-doctor build    # → apps/plant-doctor/dist/plant-doctor.potyro-app.zip
pnpm --filter @potyro/app-plant-doctor test
pnpm --filter @potyro/app-plant-doctor typecheck
pnpm e2e e2e/plant-doctor-trusted.spec.ts       # sealed, with a mocked OpenRouter: nothing is spent
```
