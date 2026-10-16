# Draw & Guess

A Pictionary-style party game. One person draws a word only they can see; everyone else watches the
drawing appear stroke by stroke and types guesses. The first right guess scores for the guesser
(50–100, more the faster) and for the drawer (half that). Hint letters show as the clock runs down
(60, 70 or 80 seconds a turn), and the turn passes to the next player. After the last round: a
podium, confetti, and **Play again**. Finished games are kept under **Past games**.

Two to sixteen players, each on their own device, in one room on Potyro's rooms relay
(`ctx.caps.network.room`, docs/26 and docs/28). The room is the only channel: nothing about a game
is kept on a server, and the relay only passes messages on.

## Inviting: the game's code

**New game** makes a code like `KQ7M-XR4P-2DHC`. The lobby shows it as big tiles to read out across a
room, and **Invite friends** sends it (`ctx.ui.share`: the share sheet, or Copy). Friends tap
**Join** and type it, in any case, with or without the dashes.

The code *is* the room: its id on the relay is the code behind a fixed prefix (`code.ts`). Why a code
to type, and not a link that opens the game:

- **An app cannot read a link.** A Potyro link opens Potyro (`?user=<app>` for an app you have, a
  demo link for one you do not); nothing hands an app the rest of a URL, and the friend's copy of the
  app has another id anyway. A code works the same whether the invite came by message, was read out,
  or was shown on the host's screen.
- **12 characters with no look-alikes is 59 random bits** (31¹²) — shorter than the 128 bits the relay
  suggests, on purpose: it is typed on a phone. A room lives only while someone is in it, and everyone
  who joins appears in the lobby for all to see. Guessing a live one means ~2⁵⁸ tries at a relay that
  lets one address into 8 rooms at a time.

## How a friend who does not have the app plays

The drawing board is a **custom view** (a canvas), and Potyro runs an app's own views only when the
app runs as yours (docs/05; shared apps' views are a later phase of docs/22). So a friend needs the
app as theirs — and it is fully readable code. The path, as it is today:

1. You send the app: in its menu, **Share → A link anyone can try** (docs/24).
2. They open it (it runs sealed, and the Play page says it needs to run as theirs), tap **Keep this
   app**, **Add app**, then **Run it as mine… → Yes, run it as yours**.
3. They tap **Join** and type the code.

The start screen and the lobby say this in three short steps ("How friends join"), in six languages.

**Not chosen: a built-in-views path for guessers.** A sealed app's logic can join a room, but no
built-in view shows a live drawing; rendering strokes to an image file and refreshing a record a few
times a second would be slow, flickery and fill the app's folder. A guesser who cannot see the
picture is not playing.

## Who decides what

`session.ts` is one device in one game; every device runs the same code.

- **The host** is the oldest connection in the room. Everyone works it out from the relay's
  presence (members oldest first, then joins in order), so nobody is told. The host keeps the game —
  players, turns, rounds, scores, clocks (`game.ts`, pure) — and sends it whole whenever it changes.
- **The drawer's device holds the word.** It offers three, judges every guess (case, accents, a
  leading article, spaces and hyphens forgiven; one letter off is "close", said only to the
  guesser), shows hint letters on time, and says how the turn ended. The word never leaves the
  drawer's device before the turn ends: guesses reach every device (the room is one channel), but no
  device shows one until the drawer has called it wrong, and a right one is never echoed back.
- **Host leaves:** the next oldest becomes host and carries on from the last snapshot it had, with
  its own clock. **The drawer leaves:** the turn ends ("left") and the next one starts. **One player
  left:** the game ends with the scores it has.
- **Reconnects:** a dropped connection retries (1, 2, 4, 8, 15 s) as the same player, who keeps their
  score. When Potyro closes the room because the person left the app or it sat in the background
  for 30 s (docs/28 §5), the screen says so and offers **Rejoin**.
- **Late joiners** get the game from the host and the drawing so far from the drawer (`snap`), then
  the rest live.

## Messages (`protocol.ts`)

Small JSON texts, each checked before it is believed (a peer can send anything):

| `t` | from | what |
|---|---|---|
| `hi` | everyone, on joining and to a new host | my player id and connection |
| `st` | host | the whole game; its clock as milliseconds *left* |
| `go`, `hint` | drawer | the blanks; a hint letter |
| `d` | drawer | a piece of a stroke, every ~50 ms while the pen moves: colour, size, points on a 1000×1000 board, the first absolute and then steps |
| `u`, `x` | drawer | undo an op; clear (itself an op, so it can be undone) |
| `snap` | drawer | the drawing so far, to one late joiner, cut into ≤40 000-character messages |
| `g` | guesser | a guess, for the drawer to judge |
| `v` | drawer | the verdict; a wrong guess carries its text for everyone's feed |
| `end` | drawer | the word, who got it, how much of the clock was left |

A drawer sends about 20 small messages a second; everything stays far under the relay's 64 KiB a
message and ~30 messages a second.

## Files

```
draw-guess.app.ts   the app: Play (custom view) and Past games (list)
play.ts             the screens: start, lobby, game, the end
session.ts          one device in one game: roles, timers, reconnects
game.ts             the host's rules, pure
protocol.ts         the messages and their checks
sketch.ts           a turn's drawing as data
board.ts            drawing a sketch on a canvas; pointer input
words.ts            281 drawable things in six languages; checking a guess; hints
code.ts             the game's code
ui-words.ts         every word the screens say, in six languages
sound.ts            a few synthesized sounds, off until the person turns them on
styles.ts           the stylesheet
```

## Build, install, check

```
pnpm --filter @potyro/app-draw-guess build   # → apps/draw-guess/dist/draw-guess.potyro-app.zip
pnpm --filter @potyro/app-draw-guess test
pnpm --filter @potyro/app-draw-guess typecheck
pnpm e2e e2e/draw-guess-trusted.spec.ts      # three browsers in one room on a local relay
```

In the shell: **Add an app → From this device**, choose the zip, tick **I wrote this. Run it as
mine.**, then **Add app**. While developing, the dev server has no relay behind `/rooms`: start one
and point the browser at it (docs/28 §7).
