// The sample photo, for someone who wants to see what the app does before pointing it at anything:
// a beach at dusk, painted from a formula, so it ships as a dozen lines rather than a JPEG. Edges
// are anti-aliased (each layer's coverage ramps over about a pixel), so it holds up when shown large.
import type { Picture, RGB } from "./palette.js";

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

const SKY: RGB[] = [
  [43, 45, 92],
  [118, 72, 128],
  [199, 92, 122],
  [242, 166, 90],
  [251, 217, 160],
];
const SUN: RGB = [255, 240, 200];
const FAR: RGB = [107, 78, 122];
const NEAR: RGB = [63, 91, 110];
const SEA_TOP: RGB = [36, 66, 92];
const SEA_LOW: RGB = [20, 37, 54];
const GLINT: RGB = [242, 197, 138];
const DUNE: RGB = [196, 103, 63];
const DUNE_SHADE: RGB = [150, 72, 46];

/** The sample, `w`×`h` pixels, RGBA. */
export function paintSample(w = 640, h = 480): Picture {
  const data = new Uint8ClampedArray(w * h * 4);
  const px = 1 / h; // one pixel, in the units the scene is drawn in
  const edge = (d: number) => clamp01(0.5 + d / (1.4 * px)); // coverage of a layer `d` inside its edge
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // Sky: indigo at the top to pale gold at the horizon.
      const k = clamp01(v / 0.6) * (SKY.length - 1);
      const i0 = Math.min(SKY.length - 2, Math.floor(k));
      let c = mix(SKY[i0]!, SKY[i0 + 1]!, k - i0);
      // The sun, with a soft glow around it.
      const sd = Math.hypot((u - 0.68) * (w / h), v - 0.47);
      c = mix(c, SUN, clamp01((0.16 - sd) * 3.2) * 0.35);
      c = mix(c, SUN, edge(0.075 - sd));
      // Far hills, then near hills.
      const far = 0.5 + 0.035 * Math.sin(u * 6.1 + 0.4) + 0.018 * Math.sin(u * 17 + 1.3);
      c = mix(c, FAR, edge(v - far));
      const near = 0.585 + 0.03 * Math.sin(u * 4.3 + 2.1) + 0.012 * Math.sin(u * 23);
      c = mix(c, NEAR, edge(v - near));
      // The sea, darker towards us, with the sun's road glinting on it.
      const sea = 0.64;
      if (v > sea - 2 * px) {
        let s = mix(SEA_TOP, SEA_LOW, clamp01((v - sea) / 0.25));
        // Short horizontal glints, thinning out away from the sun's line.
        const off = Math.abs(u - 0.68) / (0.03 + (v - sea) * 0.6);
        const row = Math.sin(v * 900);
        const dash = Math.sin(u * 140 + Math.floor(v * 140) * 2.3);
        if (off < 1 && row > 0.7 && dash > 0.1 + off * 0.8) s = mix(s, GLINT, (1 - off) * (0.85 - clamp01((v - sea) / 0.35) * 0.5));
        c = mix(c, s, edge(v - sea));
      }
      // A warm dune in front, lit from the sun's side.
      const dune = 0.82 + 0.05 * Math.sin(u * 3.2 - 0.6) - 0.03 * u;
      const lit = mix(DUNE_SHADE, DUNE, clamp01(u * 1.3));
      c = mix(c, lit, edge(v - dune));
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
