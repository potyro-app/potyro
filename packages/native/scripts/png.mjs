// Filled polygons to a PNG, with nothing but node:zlib — the raster half of the brand scripts
// (vector.mjs says why there is no browser or image library here).
//
// Anti-aliasing: each pixel row is cut into SUBROWS scanlines; on each, the spans inside the shape
// (non-zero winding, as SVG fills by default) add their exact horizontal overlap with every pixel.
// So an edge is exact across and 1/SUBROWS down — smooth at 48 px and at 1024 px, never upscaled.
import { deflateSync } from "node:zlib";

const SUBROWS = 8;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** How much of each pixel the polygons cover, 0–1, as a Float32Array of width × height. */
export function coverage(polygons, width, height) {
  const cov = new Float32Array(width * height);
  const edges = [];
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? { x0, y0, x1, y1, dir: 1 } : { x0: x1, y0: y1, x1: x0, y1: y0, dir: -1 });
    }
  }
  const weight = 1 / SUBROWS;
  const crossings = [];
  for (let row = 0; row < height; row++) {
    for (let sub = 0; sub < SUBROWS; sub++) {
      const y = row + (sub + 0.5) / SUBROWS;
      crossings.length = 0;
      for (const e of edges) {
        if (y < e.y0 || y >= e.y1) continue;
        crossings.push({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      }
      crossings.sort((a, b) => a.x - b.x);
      let winding = 0;
      let from = 0;
      for (const c of crossings) {
        const before = winding;
        winding += c.dir;
        if (before === 0 && winding !== 0) from = c.x;
        else if (before !== 0 && winding === 0) addSpan(cov, row * width, width, from, c.x, weight);
      }
    }
  }
  return cov;
}

function addSpan(cov, offset, width, from, to, weight) {
  const a = Math.max(0, from), b = Math.min(width, to);
  if (b <= a) return;
  const first = Math.floor(a), last = Math.min(width - 1, Math.floor(b));
  for (let px = first; px <= last; px++) {
    const overlap = Math.min(b, px + 1) - Math.max(a, px);
    if (overlap > 0) cov[offset + px] += overlap * weight;
  }
}

/**
 * Layers painted in order onto a transparent canvas: `[{ fill: "#rrggbb", polygons }]`. Returns
 * straight (not premultiplied) RGBA bytes.
 */
export function paint(layers, width, height) {
  const acc = new Float32Array(width * height * 4); // premultiplied, 0–1 alpha
  for (const layer of layers) {
    const [r, g, b] = rgb(layer.fill);
    const cov = coverage(layer.polygons, width, height);
    for (let i = 0; i < cov.length; i++) {
      const a = Math.min(1, cov[i]);
      if (a === 0) continue;
      const o = i * 4;
      acc[o] = r * a + acc[o] * (1 - a);
      acc[o + 1] = g * a + acc[o + 1] * (1 - a);
      acc[o + 2] = b * a + acc[o + 2] * (1 - a);
      acc[o + 3] = a + acc[o + 3] * (1 - a);
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, a = acc[o + 3];
    if (a === 0) continue;
    out[o] = Math.round(acc[o] / a);
    out[o + 1] = Math.round(acc[o + 1] / a);
    out[o + 2] = Math.round(acc[o + 2] / a);
    out[o + 3] = Math.round(a * 255);
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

/**
 * RGBA bytes as a PNG file, 8-bit. With `alpha: false` the file has no alpha channel at all (the
 * pixels must be opaque): the App Store refuses an app icon that has one, even a fully opaque one.
 * The same bytes in give the same file out.
 */
export function encodePng(rgba, width, height, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4, to = y * stride + 1 + x * channels;
      if (!alpha && rgba[from + 3] !== 255) throw new Error(`a pixel at ${x},${y} is not opaque; this PNG has no alpha channel to say so`);
      for (let c = 0; c < channels; c++) raw[to + c] = rgba[from + c];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The pixel at (x, y) of RGBA bytes, as `[r, g, b, a]` — for the tests. */
export const pixel = (rgba, width, x, y) => Array.from(rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
