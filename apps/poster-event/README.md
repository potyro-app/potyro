# Poster to Calendar

Photograph a poster, a flyer, a ticket or an invitation, and it becomes an event: checked by you,
with a reminder, on an agenda and a calendar, as a file your phone's calendar opens, and as a message
for friends.

```
poster-event.app.ts   the app: one entity, Coming up / Calendar / Past, the event's page and its actions
read.ts               "Read a poster": the photo, the AI reading, the honest failures, the confirm form
dates.ts              what a poster says → when the event is (years, times, doors, ranges, timezones)
calendar.ts           when to remind, and the .ics file (RFC 5545)
words.ts              how an event reads: its day and time, its reminder, its heading, the share message
fields.ts             the event's fields — the record and the confirm form are the same fields
sample.ts             the sample poster (an SVG) and the answer it reads as, with no AI
test/                 dates, calendar, and every path through the app against a scripted ctx
```

## How a poster becomes an event

1. **Read a poster** offers *Take a photo*, *Choose a photo*, *Try it on a sample poster* and *Type it
   in myself*. The photo comes through `ctx.caps.camera` (the file picker where there is no camera).
2. One `ctx.caps.ai.extract` (docs/23) reads it into a plain shape: per event its title, the date as
   printed and the model's reading of it, whether a year was printed, start / end / doors as printed,
   a timezone only if one is printed, venue, address, price, link (or a QR code's text), description.
   Only the photo and the instructions are sent — no record, ever.
3. The app, not the model, decides when that is (`dates.ts`):
   - **The year** of a date printed without one: this year or next, whichever is still to come; a
     printed weekday ("Fri 20 Nov") picks between them. A date of the last few days stays this year:
     the poster is for something that has just happened, and the app says so.
   - **Times** as posters write them: `20:00`, `20.30`, `20h30`, `8pm`, `8:30 p.m.`, `20 Uhr`, `noon`;
     ranges (`20:00–23:00`, `8–11pm`); an end past midnight is the next day.
   - **Doors 19:00 / Start 20:00**: the event starts at 20:00, doors are kept beside it; doors alone
     are the start.
   - **Timezones**: a printed `CET`, `UTC+2`, `GMT-03:00` or `ET` places the wall time (US zones follow
     US daylight time); anything else is the device's own zone, which for a poster on the street is
     the right one. Days and weeks count on the calendar, so "a day before 20:00" is 20:00 even across
     a change of the clocks.
4. The person checks it in a form — the record's own fields, filled — and **Save event** makes it.
   A model reads; a person decides.

## When it cannot

- **Blurry** (`legible: false`): *"The photo is too blurry to read"* — *Closer, flat on, with more
  light* — with *Take another photo*, *Choose another photo*, *Type it in myself*.
- **No event on it**: *"There's no event on this photo"*, same choices.
- **No date found**: the form opens titled *"Add the date — it isn't on the poster"*, the date empty
  and required.
- **Several events** (a line-up): a sheet lists them with their days; pick one, or *All 3, one after
  another* (one form each; cancelling one skips it).
- **Already happened**: the form says *"Check the date — this has already happened"*; saved anyway,
  it goes under **Past** and gets no reminder.
- **No AI here**: *Type it in myself* or the sample. Offline, no key, a refused question: the AI's own
  words (docs/23), as the action's failure.

## After

- **Reminder** (`reminders`): a day before by default; at start, 1 or 3 hours, 1 day or 1 week before,
  or none. An all-day event counts back from 9:00. None for an event that is over, so a past event
  never sits on the tile as "due". The event's page says when it will be.
- **Add to my calendar** writes `calendar/<title>-<day>.ics` in the app's folder and exports it
  (`ctx.files.export`): one VEVENT, times in UTC (no VTIMEZONE needed, the same moment in every
  calendar), an all-day event as dates, no DTEND when the poster gave no end, the reminder as a VALARM,
  lines folded at 75 octets. Opened on a phone, it lands in the phone's calendar.
- **Share with friends** (`ctx.ui.share`): the share dialog shows the event in a few lines and its
  link, with Copy — and, on a phone, Share… for the phone's own share sheet. To plan together, share
  the **app** (its Share link): everyone in it sees every event.

## Built-in views only

Coming up (a list under *On now / Today / Tomorrow / Next 7 days / November…*, with the poster as
thumbnail), Calendar, Past, and the event's page are all built-in views. A friend who opens this app
from a share link runs it sealed, where an app's own custom views do not render — so this one works
the same for them, reading posters included, after they say yes to the camera and to the AI.

## The sample

*Try it on a sample poster* needs no key and sends nothing. The poster is drawn as an SVG for the
Friday after next — in the person's own words for the day and month, with SAMPLE POSTER across its
top — and read by a fixture answer made from the same date, through the same steps as a photo. Its
event says it is a sample in its description.

## Storage

The photo is kept with the event as it came from the camera (a `media` field). A phone photo is a few
megabytes; in a shared app every member's device holds it. The AI gets a copy resized on the device
(docs/23), not the original.

## Checks

```
pnpm --filter @potyro/app-poster-event test
pnpm --filter @potyro/app-poster-event typecheck
pnpm e2e e2e/poster-event-trusted.spec.ts   # sealed: photo → card → event, .ics, share; and the sample
```
