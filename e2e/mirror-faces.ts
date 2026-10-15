// Shared steps for the faces specs (docs/25 §Faces): where a point of the camera's picture lands on
// Mirror Monsters' stage, and how much of the monster's googly-eye white is where it should be.
import type { Locator, Page } from "./console-guard";
import { pixelsOf, type Pixels } from "./library-demos";

export const canvas = (page: Page): Locator => page.locator(".mm-stage canvas");

/** The googly eye's white, the app's own #fffdf7. */
export const isWhite = (p: Pixels, i: number): boolean => p.data[i]! > 250 && p.data[i + 1]! > 248 && p.data[i + 2]! > 240 && p.data[i + 2]! < 252;

/**
 * A point of a `vw`×`vh` picture → canvas pixels, the way the app draws it: cropped to cover the stage,
 * and mirrored when it is the selfie camera (Firefox's fake camera says it faces the other way).
 */
export function onStage(p: { x: number; y: number }, vw: number, vh: number, cw: number, ch: number, mirrored = true): { x: number; y: number; k: number } {
  const scale = Math.max(cw / vw, ch / vh);
  const sw = cw / scale;
  const sh = ch / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  const k = cw / sw;
  const x = (p.x - sx) * k;
  return { x: mirrored ? cw - x : x, y: (p.y - sy) * k, k };
}

/** For each expected eye (canvas pixels, radius `r`): the share of its disc that is white; and the share of all white that is near none. */
export async function eyeWhites(page: Page, eyes: { x: number; y: number }[], r: number): Promise<{ near: number[]; stray: number; total: number }> {
  const p = await pixelsOf(canvas(page));
  const near = eyes.map(() => 0);
  let total = 0;
  let stray = 0;
  for (let y = 0; y < p.height; y += 2)
    for (let x = 0; x < p.width; x += 2) {
      if (!isWhite(p, (y * p.width + x) * 4)) continue;
      total++;
      let hit = false;
      eyes.forEach((e, i) => {
        const d = Math.hypot(x - e.x, y - e.y);
        if (d <= r) near[i]!++;
        if (d <= r * 1.8) hit = true;
      });
      if (!hit) stray++;
    }
  // Sampled every other pixel both ways: a disc of radius r holds about πr²/4 samples.
  const disc = (Math.PI * r * r) / 4;
  return { near: near.map((n) => n / disc), stray: total ? stray / total : 1, total };
}
