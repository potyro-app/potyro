// Photos, cut down to a size a personal app can actually keep.
//
// A phone camera hands over a 4000-pixel JPEG of four megabytes or so. Nothing in Potyro ever shows
// one at that size — the biggest it is ever drawn is a phone screen — and the cost of keeping it is
// paid three times over: the device's storage fills, a shared app pushes every one of those
// megabytes to every person in it, and a browser that has fallen back to local storage cannot hold
// even one (which is how this started: "Couldn't add it: The quota has been exceeded").
//
// So an image is re-encoded at 2048 pixels on its longest edge before it is stored. A field that
// needs the original says so (`full: true`) — a scanned document, a receipt, a photo to crop hard.
//
// Three rules keep this from ever losing something it shouldn't:
//   • only bitmaps — an SVG is drawing instructions and a GIF may be an animation; both pass through
//   • never grow a file — if the re-encode comes out larger (already-optimised small JPEGs do), the
//     original is kept
//   • never fail a capture — a format the browser cannot decode (HEIC on a desktop, say) passes
//     through untouched rather than taking the photo down with it

/** The longest edge a stored photo keeps. A phone screen is ~1200 physical pixels at its widest. */
export const MAX_EDGE = 2048;
const QUALITY = 0.85;

/** Formats where re-encoding would destroy what the file is for. */
const PASS_THROUGH = new Set(["image/gif", "image/svg+xml", "image/avif"]);

interface Canvasish {
  width: number;
  height: number;
  getContext(id: "2d"): { drawImage(image: unknown, x: number, y: number, w: number, h: number): void } | null;
}

function makeCanvas(width: number, height: number): Canvasish | null {
  const g = globalThis as { OffscreenCanvas?: new (w: number, h: number) => unknown; document?: Document };
  if (g.OffscreenCanvas) return new g.OffscreenCanvas(width, height) as unknown as Canvasish;
  const el = g.document?.createElement("canvas");
  if (!el) return null;
  el.width = width;
  el.height = height;
  return el as unknown as Canvasish;
}

async function toBlob(canvas: Canvasish, quality: number): Promise<Blob | null> {
  const off = canvas as unknown as { convertToBlob?: (o: { type: string; quality: number }) => Promise<Blob> };
  if (off.convertToBlob) return off.convertToBlob({ type: "image/jpeg", quality });
  const el = canvas as unknown as HTMLCanvasElement;
  if (typeof el.toBlob !== "function") return null;
  return new Promise((resolve) => el.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/**
 * `blob`, re-encoded no larger than `maxEdge` on its longest side — or `blob` itself whenever
 * shrinking it would be wrong, impossible, or pointless.
 */
export async function shrinkImage(blob: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  if (!blob.type.startsWith("image/") || PASS_THROUGH.has(blob.type)) return blob;
  const create = (globalThis as { createImageBitmap?: (b: Blob, o?: unknown) => Promise<ImageBitmap> }).createImageBitmap;
  if (!create) return blob;

  let bitmap: ImageBitmap;
  try {
    // `from-image`: the rotation lives in EXIF, which the re-encode drops — without this, every
    // portrait photo would come back on its side.
    bitmap = await create(blob, { imageOrientation: "from-image" });
  } catch {
    return blob; // a format this browser cannot decode is still a photo someone took
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxEdge) return blob;
    const scale = maxEdge / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(width, height);
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const out = await toBlob(canvas, QUALITY);
    return out && out.size < blob.size ? out : blob;
  } finally {
    bitmap.close?.();
  }
}
