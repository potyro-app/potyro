// A picture as an app's icon, made small enough to keep (#425): the launcher's identity cache and
// a person's own tile icon (#83) hold a `data:` URL of at most ICON_SIZE px, so a 4 MB photo picked
// for a tile becomes a few KB in localStorage, and a shipped `icon.png` is shown on the Home card
// without opening the app's files again. An SVG stays text (it scales); anything else is drawn
// into a square and kept as PNG.

import { cleanSvg } from "@potyro/views";
import { ICON_IMAGE_MAX } from "potyro";
import { mimeOf } from "@potyro/store";

export const ICON_SIZE = 128;

/** A `data:` URL for the picture, or null when this browser cannot draw it (or it is not an image). */
export async function iconDataUrl(blob: Blob, size = ICON_SIZE): Promise<string | null> {
  if (!blob.type.startsWith("image/")) return null;
  if (blob.type === "image/svg+xml") {
    if (blob.size > ICON_IMAGE_MAX) return null;
    return `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg(await blob.text()))}`;
  }
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    // Fit inside the square, centred, transparent around: a logo keeps its shape.
    const k = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

/**
 * The picture behind a URL (a shipped file's blob URL from `ctx.files.url`), as a small `data:` URL.
 * A blob URL may carry no type; the file's path says what it is.
 */
export async function iconDataUrlFrom(url: string, path?: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let blob = await res.blob();
    if (!blob.type.startsWith("image/") && path) blob = new Blob([await blob.arrayBuffer()], { type: mimeOf(path) });
    return await iconDataUrl(blob);
  } catch {
    return null;
  }
}
