# Photo Garden

Take a photo, and it turns into a living picture: thousands of specks that carry its colours drift
on a slow current, gather into the image, and scatter wherever you touch or drag. Keep the moments
you like; they hang in the Gallery.

It is a showcase for a library imported by URL (#266): the drawing is [p5.js](https://p5js.org/)
1.11.11 in instance mode, fetched once from esm.sh when the app is added and kept with it.

**It only runs as your own app.** p5 draws on a `<canvas>` and needs a real web page. Add it with
**I wrote this. Run it as mine.** ticked. Left unticked, the app runs in the sealed box, which has no
web page to draw in, so the Studio cannot work there.

```
photo-garden.app.ts   the app: the Studio (the p5 sketch) and the Gallery
garden.ts             the arithmetic: photo → colours, how many specks, how they move, the names
styles.ts             the Studio's and the Gallery's stylesheet, in the shell's tokens
p5.d.ts               types for the part of p5 the app uses, at the URL it imports it from
test/                 garden.ts and the app's shape
```

## What you see

- **Studio** — before there is a photo, a dusk sky drifts behind **Take a photo** / **Choose one**.
  - **Flow**: brush strokes riding a noise field, held loosely to their place in the picture.
  - **Points**: a halftone of dots; each dot is as big as it differs from the paper.
  - **Mosaic**: hand-laid tiles. A tile you knock turns and shrinks, then settles back.
  - Drag (mouse or finger) to scatter them; a mouse hovering brushes them gently. The **density**
    slider goes from sparse to dense. Style and density are remembered.
  - **Keep this** saves the canvas as a PNG in the app's own folder (`garden/…png`, through
    `ctx.files`) and an **Artwork** record with a name made from the picture's colour and the style
    ("Rose Drift", "Fern Tessera II"). For a few seconds a note over the picture names it and offers
    **Share**, which hands the PNG to `ctx.files.export`: the save dialog on a computer, the share
    sheet on a phone.
- **Gallery** — what you kept, newest first. Tap one to see it large, **Share** it, **Save a copy**
  outside the app, or **Delete** it.

An artwork is only made by keeping the canvas, so the app declares `quickActions: []`: no
"Add: Artwork" form, which would make a record with no picture.

## How it gets the photo

Only through `ctx.caps.camera.capture()` — the app never calls `navigator.mediaDevices` or anything
else in the browser for it (CLAUDE.md rule 2), and it declares `permissions: { camera: true }`. That
capability hands back one photo, not a live stream, so the motion is the garden's, not the camera's.

## On a phone

The number of specks follows the size of the screen and stops at 2,800 on a phone (7,000 on a
desktop), so a mid-range phone keeps its frame rate. The sketch stops drawing when the Studio is
scrolled out of view or the app is in the background, and the p5 instance (its loop, canvas and
listeners) is removed when you leave the Studio. With *reduce motion* on, the garden settles at once
and stays still until you touch it.

## Build and install

```
pnpm --filter @potyro/app-photo-garden build   # → apps/photo-garden/dist/photo-garden.potyro-app.zip
```

In the shell: **Add an app → From this device**, choose the zip. The card says it asks for the camera
and fetches **p5 1.11.11 from esm.sh**. Tick **I wrote this. Run it as mine.**, then **Add app**.

### Why p5 1.11.11, and why `?bundle`

- `https://esm.sh/p5@1.11.11?bundle` is two files: a one-line module and p5 itself. It used to be
  refused at install as "decides while it runs what else to load": p5 1.x is a browserify bundle that
  keeps `typeof require == "function" && require`, and the fetcher took any `require` for a dynamic
  import it could not follow. A browser has no `require`, so that code loads nothing; the fetcher now
  only refuses an `import()` whose address is decided at run time (see `shell/src/library-fetch.ts`).
- p5 2.3.4 works too as `https://esm.sh/p5@2.3.4?bundle`. Without `?bundle` it does not: esm.sh
  serves one of its dependencies (`@davepagurek/bezier-path`) with a default export only, while p5
  imports a named one, so the module graph is broken on esm.sh itself — a browser would fail the same
  way. 1.11.11 is the smaller (1 MB against 1.6 MB) and the better-known API.

## Checks

```
pnpm --filter @potyro/app-photo-garden test
pnpm --filter @potyro/app-photo-garden typecheck
pnpm e2e e2e/photo-garden-trusted.spec.ts    # installs it for real, feeds a photo, reads the canvas
```
