# Mirror Monsters

The selfie camera as a mirror, with a monster in it. Five monsters:

- **Monster** 👹 — horns, googly eyes and a fanged grin that sit on your face and wobble when you
  move. Tap the picture for a new colour.
- **Twin** 🪞 — the left half of the picture mirrored onto the right: one face, two left sides.
- **Kaleido** 🔮 — one slice of the picture around your face, reflected into eight, ten or twelve
  mirrors (tap the picture for more), slowly turning and drifting.
- **Trails** ✨ — neon sparks wherever something moved.
- **Pixel** 👾 — an 8-bit monster in a handheld console's palette.

The round button snaps what is on screen into the **Gallery** (a PNG in the app's own folder and a
record); 🔄 switches between the selfie and the back camera.

It is the demo of the live camera (docs/25): `ctx.caps.camera.live()` hands it a playing `<video>`
and a frame callback, and the app draws each frame on a canvas. It never reaches into the browser for
the camera itself (CLAUDE.md rule 2), and nothing leaves the device: no network, no model, no library
fetched. The "face" is the densest skin-tone blob on a 64-pixel thumbnail (`monsters.ts`) — not a
face detector, which is why a monster will happily sit on your hand.

**It runs as your own app only.** The live camera is for trusted apps until shared apps get custom
views (docs/25), and the drawing needs a page. Add it with **I wrote this. Run it as mine.** ticked;
left unticked, the mirror says so instead of turning the camera on.

## The camera and you

- The browser (or the phone) asks first. The first time, the camera turns on only when you press
  **Turn on the camera**; after that, opening the mirror turns it on.
- While it runs, the shell shows **Camera on** with **Turn off** at the top of the screen. The app
  cannot hide it.
- It turns off whenever the app is not on screen — another tab, Home, the screen locked, leaving the
  app — and stays off until you turn it back on.

```
mirror-monsters.app.ts   the app: the Mirror and the Gallery
monsters.ts              the arithmetic: the face-ish blob, googly eyes, trails, palette, file names
styles.ts                the stylesheet, in the shell's tokens around an always-night stage
test/                    monsters.ts and the app's shape
```

## Build and install

```
pnpm --filter @potyro/app-mirror-monsters build   # → apps/mirror-monsters/dist/mirror-monsters.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose the zip, tick **I wrote this. Run it as
mine.**, then **Add app**.

## Checks

```
pnpm --filter @potyro/app-mirror-monsters test
pnpm --filter @potyro/app-mirror-monsters typecheck
pnpm e2e e2e/mirror-monsters-trusted.spec.ts   # Chromium's fake camera: frames drawn, Camera on, off on leaving
```
