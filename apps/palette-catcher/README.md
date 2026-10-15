# Palette Catcher

Point the camera at something whose colours you love — a sunset, a sofa, a dress — and get the five
to eight colours it is made of, as a paint-chip card beside the photo, with a marker on the photo
where each colour was found. Tap a colour for its **HEX**, **RGB** and **OKLCH**, each one tap from
the clipboard, and for how white and black text read on it. Name the palette, keep it in the
Gallery, or share it as an image card.

```
palette-catcher.app.ts   the app: the Catch screen, the colour sheet, the Gallery
palette.ts               the colour science: OKLab, k-means, choosing the set, contrast, where a colour is
names.ts                 what to call a colour and a palette ("Honey & Midnight"), in six languages
card.ts                  the share card, 1080 × 1350
sample.ts                the sample photo (a beach at dusk), painted from a formula
styles.ts                the stylesheet, in the shell's tokens
words.ts                 every word on the screens, in six languages
test/                    the algorithm, the names, the app's shape
```

## How a photo becomes a palette (palette.ts)

1. The photo is shrunk to 260 pixels on its longer side and every pixel goes into **OKLab**, where
   equal distances look like equal differences.
2. Pixels are binned at 5 bits a channel; **weighted k-means** (18 clusters, k-means++ start, seeded,
   so the same photo always gives the same palette) runs on the bins.
3. Each cluster is shown as a colour that is really **in** the photo — the busiest bin near its
   centre — not as the cluster's average, which is how naive palettes turn muddy.
4. The set is chosen greedily: area counts, vivid colours count more than their size, and each pick
   must stand apart from those already chosen (weighted farthest-point). A small red umbrella on a
   grey street makes it in; twelve greys do not. No two colours closer than ΔE 0.045.
5. A photo with fewer colours than asked for is filled with tints and shades, marked as made.
6. Each colour's **marker** is the middle of a patch of it, away from the markers already placed.

Text on a swatch is a tint of the swatch's own hue when that keeps **4.5:1** (WCAG AA), else black
or white — which always reach at least 4.58:1.

## Where it reaches the device

- The photo comes only through `ctx.caps.camera.capture()` (CLAUDE.md rule 2); `permissions: { camera: true }`.
- A kept palette is a `palette` record (`name`, `colors` as hexes, `date`, `photo`); its photo is a
  JPEG in the app's own `photos/` folder, through `ctx.files`.
- **Share card** draws the card, writes it to `cards/…png` and hands it out with `ctx.files.export`
  (the save dialog on a computer, the share sheet on a phone), then removes the app's copy.
- **Copy** uses the page's clipboard, with a selected-text fallback.
- **Type in a palette** (the quick action) adds one by hand; its colours become its picture.

The screens are custom views, so the app runs as your own: tick **I wrote this. Run it as mine.**

## Checks

```
pnpm --filter @potyro/app-palette-catcher test
pnpm --filter @potyro/app-palette-catcher typecheck
pnpm --filter @potyro/app-palette-catcher build   # → dist/palette-catcher.potyro-app.zip
pnpm e2e e2e/palette-catcher-trusted.spec.ts       # installs it, feeds a painted photo, reads what is drawn
```
