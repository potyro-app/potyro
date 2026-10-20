# Pantry — what's in my kitchen

Photograph a fridge shelf, the shopping on the table or a receipt. What is on it becomes a list sorted
by what goes off first, with a reminder the day before, a tally of what was used and what was thrown
away, and **What can I cook?** for what expires first.

```
pantry.app.ts   the app: Kitchen, Cook, Waste, an item's page and an idea's page
read.ts         Add from a photo: the photo, the reading, the honest failures, the confirm form
reading.ts      what a photo is read into (`SHELF`), and the reading turned into items to check
shelf-life.ts   how long food keeps by kind and place, which printed dates to believe, the reminder, the tally
cook.ts         What can I cook?: what is sent, the ideas, keeping them to what is really there
sample.ts       the sample shelf (an SVG drawn for today) and the answer it "reads"
words.ts        how an item reads, in six languages
fields.ts       an item's fields, and the confirm form's card
test/           the arithmetic, the reading, and every path against a scripted ctx
```

## How it works

- **Add from a photo** offers *Take a photo*, *Choose a photo*, *Try it on a sample photo* and *Type it
  in myself*. One `ctx.caps.ai.extract` reads the photo into a plain shape: each thing's name, its kind
  (one of ten), where it is kept if the photo shows it, how much, and a best-before **only when one is
  printed and readable**. Only the photo and the instructions are sent; no record is.
- **The app, not the model, decides the dates** (`shelf-life.ts`). A printed date is kept unless it
  cannot be right (months past, years ahead: a lot number or a "packed on"). A missing one is guessed
  from the kind of food and where it is kept — chicken in the fridge 2 days, yogurt 7, rice a year —
  counted from today, or from a receipt's date when it is recent. A guessed date says so wherever it is
  shown ("5 days left · date guessed") and is a switch on the item.
- **The person checks before anything is saved**: one card per thing — name, date, whether the date
  is a guess, kind. Where it is kept and how much come along and can be changed on the item.
- **Kitchen** lists what is still there under *Past its date / Use today / In the next 3 days / This
  week / Later / No date*, soonest first. The headings are a computed key, so a sealed copy groups
  them too. An item's page has **Used it** and **Threw it out**.
- **Reminders**: 9:00 the day before something expires; on the day itself when it was added too late
  for that; none for something used, thrown away, past its date or without one.
- **Waste**: thrown away and used this month against last month, the share thrown away over the last
  30 days, a bar per month, and what went lately.
- **What can I cook?** says first what it will send — the names of up to ten things that go off
  soonest and how many days each has left, nothing else — then asks for 2–3 simple ideas. An idea keeps
  only the things that are really in the kitchen, as they are named there. **Send it to someone** opens
  the share sheet (`ctx.ui.share`).
- **When reading fails** it says so: a blurry photo, a photo with no food, no AI here, or the AI's own
  words (offline, no key, turned off) — and offers what still works: the sample, or typing it in.
- **The sample shelf** is an SVG drawn for today, in the person's language, with SAMPLE across its top:
  three packs with a printed date and three without. A fixture answer made from the same dates reads it,
  through the same steps as a photo, with no key and nothing sent. **What can I cook?** has sample ideas
  for it too.

Every screen is a built-in view, so a friend who opens a shared copy (sealed) gets the whole app; it
asks them before the camera and before the AI. Linking an idea to the Recipes example is not here:
`ctx` has no way to reach another app, and an app must not reach past it.

## Build and check

```
pnpm --filter @potyro/app-pantry build       # → apps/pantry/dist/pantry.potyro-app.zip
pnpm --filter @potyro/app-pantry test
pnpm --filter @potyro/app-pantry typecheck
pnpm e2e e2e/pantry-trusted.spec.ts          # sealed, with a mocked OpenRouter: nothing is spent
```
