# Photo Puzzle

Take or pick a photo and it becomes a jigsaw: real knobbed pieces, tipped out beside the board, that
you drag into place until they click in. Three sizes — **Easy** 12, **Medium** 20, **Hard** 48 pieces —
a clock, best times, and a finish where the seams fade and the photo is whole again. Then **send it
to a friend**: they open the link and solve *your* photo, and their time comes back to you.

## Why a jigsaw, not a sliding puzzle

On a phone a sliding puzzle is a chore: one move at a time, a 4×4 takes hundreds of taps, and the
picture is scrambled until the very end. A jigsaw is touch-native — pick a piece up, put it down — and
it rewards you all the way through: every piece that clicks in shows more of the photo. The pieces
are real jigsaw shapes (cut by `jigsaw.ts`, seeded, so a puzzle cuts the same every time), so it looks
like what it is in a screenshot.

## How it works

```
photo-puzzle.app.ts   the app: entities (puzzle, solve), the two pages
puzzles.ts            Puzzles: make one from a photo, every puzzle with its best times, Send, Delete
play.ts               the table: a canvas, the pieces, dragging, snapping, the finish
jigsaw.ts             the arithmetic: levels, the cut, piece outlines, layout, scatter, snapping, score
common.ts             the photo in (camera → JPEG → the app's folder) and out, and sending
words.ts              every word on screen, in the six languages
styles.ts             the stylesheet, in the shell's tokens, so light and dark follow the shell
test/                 jigsaw.ts (neighbours fit exactly; nothing starts home; times) and the app
```

- **The photo** comes only through `ctx.caps.camera` (CLAUDE.md rule 2), is cropped to 3:4 and kept
  as a JPEG in the app's own folder (`photos/…jpg`, `ctx.files`). A `puzzle` record points at it.
- **Each piece** is cut once into two small bitmaps (loose, with its shadow baked in; laid, flat), so
  a frame is a few dozen `drawImage` calls, and a frame is drawn only when something moves. No
  library: it opens offline from the first time.
- **A game in progress** is kept in `ctx.storage` (in table fractions, so it survives a rotated
  phone); a **finished** one is a `solve` record (level, seconds, moves, who).
- **Accessible**: every loose piece is also a (visually hidden) button that puts it in place, so a
  keyboard or a screen reader can finish a puzzle; **Place one** does the same for anyone stuck.
  **Peek** shows the photo while held, the faint picture on the board can be turned off, **Tidy**
  spreads the loose pieces (edge pieces first). With *reduce motion*, nothing floats or slides.

## Sending a puzzle, and the photo with it

A puzzle travels inside the app. Sharing Photo Puzzle (from its tile, **⋯ → Share**) puts it in a
shared space; whoever opens the link joins it, sees every puzzle in it, and the photos arrive on
their device when they open them (files on demand, #255). Their solves sync back, so the card says
**🏁 Ana · 0:52**. Once the app is shared, **Send to a friend** mints more links right in the app
(`ctx.space.invite()`) and hands them on with `ctx.ui.share`. Before any link exists, the app says it
plainly: *whoever gets the link can see, keep and play every photo in it — only send photos you are
happy to give away.* A friend joining runs it trusted, because its screens are its own code.

## Build and install

```
pnpm --filter @potyro/app-photo-puzzle build   # → apps/photo-puzzle/dist/photo-puzzle.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose the zip, tick **I wrote this. Run it as
mine.**, then **Add app**.

## Checks

```
pnpm --filter @potyro/app-photo-puzzle test
pnpm --filter @potyro/app-photo-puzzle typecheck
pnpm e2e e2e/photo-puzzle-trusted.spec.ts      # a real solve by dragging, then a friend on a second device
POTYRO_SHOTS=/some/dir pnpm e2e e2e/photo-puzzle-trusted.spec.ts   # plus the launch screenshots
```
