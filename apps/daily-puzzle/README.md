# Potyro Daily

One colour code a day, the same for everyone. Five gems, seven colours (they can repeat), six tries.
Each guess is told, gem by gem, what Wordle tells a letter: **right place**, **in the code but
elsewhere**, or **not in it**. Crack it and send the grid everyone already knows how to read:

```
Potyro Daily #6 4/6
🟨⬛⬛🟩⬛
⬛🟩🟨🟩⬛
🟩🟩⬛🟩🟨
🟩🟩🟩🟩🟩
```

## Why a colour code

- **No words, so no word lists.** It plays the same in English, Portuguese, German, Spanish, Polish
  and Italian, and a result pasted into any chat reads the same.
- **Two to five minutes.** Measured, not guessed: a careful player (every guess fits everything told
  so far) needs four or five guesses on most days and cracks about 98% within six
  (`test/puzzle.test.ts`). Five gems of seven colours with repeats is the size where that holds.
- **The grid is the share.** Feedback per place is exactly Wordle's, so the squares need no
  explaining — and they never give away a colour.

## How it works

```
daily-puzzle.app.ts   the app: Today (the board, the palette, the result) and Stats
puzzle.ts             the arithmetic: which puzzle today is, its code, what a guess is told, the
                      palette's hints, the stats and streaks, the shared line
gems.ts               the seven gems: a colour and a shape each (nothing is told by hue alone)
words.ts              every word on screen, in the six languages
styles.ts             the stylesheet, in the shell's tokens, so light and dark follow the shell
test/                 puzzle.ts and the app's shape and words
```

- **Same for everyone, no server.** The puzzle number is the count of calendar days since 15 October
  2026 (#1), read from the person's own calendar (a new code at local midnight). The code is a pure
  function of the number (a seeded generator, `potyro-daily/v1/<n>`), pinned by a test: changing it
  would change every shared result and streak under people.
- **A day in progress** is kept in `ctx.storage`, so leaving and coming back shows the same board. A
  **finished day** is a `game` record (number, date, won, guesses, grid); Stats and the streak are
  worked out from those. A practice round is never kept.
- **Sharing** goes through `ctx.ui.share`: the shell's dialog shows exactly what will be sent, with
  Copy and the device's share sheet. The app never touches the clipboard itself (CLAUDE.md rule 2).
- **Haptics** through `ctx.caps.haptics` on a phone: a tick per gem, a pulse per right place, a
  flourish on a win.

## Playing

Tap a colour to drop it in the next place, tap a place to change it, **Check**. On a keyboard: `1`–`7`
place a colour, `Backspace` takes one back, `Enter` checks, the arrows move between places. The
palette strikes out a colour that is not in the code and dots one that is. **High-contrast marks**
(orange and blue, in the board and in the shared grid) are under **How to play**. With *reduce
motion* on, nothing flips or flies; the marks simply appear.

## Build and install

```
pnpm --filter @potyro/app-daily-puzzle build   # → apps/daily-puzzle/dist/daily-puzzle.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose the zip, tick **I wrote this. Run it as
mine.** (its screens are its own code), then **Add app**. It fetches nothing and works offline.

## Checks

```
pnpm --filter @potyro/app-daily-puzzle test
pnpm --filter @potyro/app-daily-puzzle typecheck
pnpm e2e e2e/daily-puzzle-trusted.spec.ts      # installs it, plays a whole day, shares, comes back
POTYRO_SHOTS=/some/dir pnpm e2e e2e/daily-puzzle-trusted.spec.ts   # plus the launch screenshots
```
