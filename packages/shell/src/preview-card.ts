// The picture a chat shows for a demo link (docs/24 §5), drawn on the sharer's device.
//
// A card, not a screenshot: a screenshot would be taken from the person's screen, which shows their
// records. This draws only what the link already carries — the app's name, icon and colour, and a few
// lines of its DEMO records — 1200×630, the size every network's large card expects, as a JPEG kept
// under 300 KB (WhatsApp drops bigger ones).
import { SYMBOL, SYMBOL_GRAPHITE, SYMBOL_VIEWBOX, isLucideName, lucidePath, lucideReady, sheetColour } from "@potyro/design";
import { hueOf, tracoOf } from "./app-colour.js";
import { imageIconSrc } from "@potyro/views";
import { isImageIcon } from "potyro";
import type { DemoSeed } from "./demo-package.js";

export const CARD_W = 1200;
export const CARD_H = 630;
export const MAX_CARD_BYTES = 300 * 1024;

export interface CardContent {
  name: string;
  icon?: string;
  /** When `icon` names a picture the app ships: that picture, small (the launcher's `identity.image`). */
  image?: string;
  /** The app's own colour (`theme.accent`), any CSS colour. */
  accent?: string;
  by?: string;
  /** Up to three short lines from the demo records. */
  lines: string[];
  /** "Made with Potyro" and "Try it in your browser — no account", in the sharer's language. */
  made: string;
  tryIt: string;
}

/** Fields that name a record, best first. */
const NAMING = ["name", "title", "label", "description", "text", "item"];

/**
 * A few lines that show what the app holds, from its demo records only: the first entity that has
 * any, each row's naming field (or its first short text). Never more than three, never long.
 */
export function previewLines(seed: DemoSeed | undefined, entities: readonly string[], max = 3): string[] {
  if (!seed) return [];
  const order = [...entities.filter((e) => seed[e]?.length), ...Object.keys(seed).filter((e) => !entities.includes(e) && seed[e]?.length)];
  for (const entity of order) {
    const lines: string[] = [];
    for (const row of seed[entity] ?? []) {
      const named = NAMING.map((k) => row[k]).find((v): v is string => typeof v === "string" && v.trim().length > 0);
      const any = Object.entries(row).find(([k, v]) => k !== "id" && typeof v === "string" && v.trim().length > 0 && v.length <= 60 && !/^\d{4}-\d\d-\d\dT/.test(v))?.[1] as string | undefined;
      const line = (named ?? any)?.trim();
      if (line) lines.push(line.length > 42 ? `${line.slice(0, 41)}…` : line);
      if (lines.length >= max) break;
    }
    if (lines.length) return lines;
  }
  return [];
}

type Ctx = CanvasRenderingContext2D;


/** Words wrapped to a width, at most `maxLines`, the last one ellipsed when it had to be cut. */
function wrap(ctx: Ctx, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}


/** The tokens the card is drawn with: the light theme's, as DESIGN.md §8.5 names them. */
const BG = "#ffffff";
const INK = "#231f20";
const MUTED = "#6f6c70";
const DISPLAY = `700 96px "Quicksand", "Nunito", ui-rounded, system-ui, sans-serif`;
const BODY = `"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/**
 * Draw the card (DESIGN.md §8.5): the page's ground, a block of the app's colour on the right third
 * with its icon on it, the name in Quicksand 700 96px at the left, the maker under it, the seal
 * bottom-left. Separate from encoding so a test can look at what was drawn.
 */
export function drawCard(ctx: Ctx, c: CardContent, picture?: CanvasImageSource): void {
  const hue = hueOf(c.accent) ?? 0;
  const traco = tracoOf(hue);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // The block of the app's colour: the right third.
  const block = { x: Math.round((CARD_W * 2) / 3), w: CARD_W - Math.round((CARD_W * 2) / 3) };
  ctx.fillStyle = traco;
  ctx.fillRect(block.x, 0, block.w, CARD_H);

  // Its icon on the block, in the system's stroke (or the picture, as it is; or the monogram).
  const icon = c.icon?.trim();
  const path = icon && isLucideName(icon) ? lucidePath(icon) : undefined;
  const box = 200;
  const bx = block.x + (block.w - box) / 2;
  const by = (CARD_H - box) / 2;
  if (picture) {
    const w = "width" in picture && typeof picture.width === "number" ? picture.width : box;
    const h = "height" in picture && typeof picture.height === "number" ? picture.height : box;
    const k = Math.min(box / w, box / h);
    ctx.drawImage(picture, block.x + (block.w - w * k) / 2, (CARD_H - h * k) / 2, w * k, h * k);
  } else if (path && typeof Path2D !== "undefined") {
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(box / 24, box / 24);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.stroke(new Path2D(path));
    ctx.restore();
  } else {
    const emoji = icon && !isLucideName(icon) && !isImageIcon(icon) ? icon : undefined;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.font = emoji ? `160px ${BODY}` : DISPLAY.replace("96px", "120px");
    ctx.fillText(emoji ?? c.name.slice(0, 2).toUpperCase(), block.x + block.w / 2, CARD_H / 2 + 8);
  }

  // The name, and who made it.
  const left = 72;
  const width = block.x - left - 48;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = DISPLAY;
  const nameLines = wrap(ctx, c.name, width, 3);
  const lineH = 104;
  let y = 96 + 88;
  for (const l of nameLines) {
    ctx.fillText(l, left, y);
    y += lineH;
  }
  if (c.by) {
    ctx.font = `500 34px ${BODY}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(wrap(ctx, c.by, width, 1)[0]!, left, y - lineH + 56);
  }

  // The seal, bottom-left: the symbol with its stroke in the sheet colour nearest the app's, the words beside.
  const seal = { x: left, y: CARD_H - 72, s: 40 };
  drawSymbol(ctx, seal.x, seal.y - seal.s + 6, seal.s, sheetColour(hue).hex);
  ctx.font = `600 28px ${BODY}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(c.made, seal.x + seal.s + 14, seal.y);
  // "Try it in your browser" is the link's description text (previewMeta), not the picture's: the
  // card says what the app is, the words under it say what to do.
}

/** The logo's symbol, its stroke in `strokeHex`, scaled to `size` from the sheet's box. */
function drawSymbol(ctx: Ctx, x: number, y: number, size: number, strokeHex: string): void {
  const [vx, vy, vw, vh] = SYMBOL_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  const k = size / Math.max(vw, vh);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  ctx.fillStyle = SYMBOL_GRAPHITE;
  ctx.fill(new Path2D(SYMBOL.body));
  ctx.fillStyle = strokeHex;
  ctx.fill(new Path2D(SYMBOL.stroke));
  ctx.beginPath();
  ctx.arc(SYMBOL.head.cx, SYMBOL.head.cy, SYMBOL.head.r, 0, Math.PI * 2);
  ctx.fillStyle = SYMBOL_GRAPHITE;
  ctx.fill();
  ctx.restore();
}

/** The picture an icon is, loaded for the canvas: the small copy the launcher keeps, or one carried in the string. */
async function pictureOf(c: CardContent): Promise<HTMLImageElement | undefined> {
  const src = c.image ?? imageIconSrc(c.icon?.trim());
  if (!src) return undefined;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

/** The card as JPEG bytes under `MAX_CARD_BYTES`, or null where this browser cannot draw one. */
export async function renderPreviewCard(c: CardContent): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (isLucideName(c.icon?.trim())) await lucideReady();
  // The card is drawn with the shell's own faces; a face not loaded yet would fall back to the system's.
  await Promise.all([document.fonts?.load(DISPLAY), document.fonts?.load(`600 28px ${BODY}`), document.fonts?.load(`500 34px ${BODY}`)]).catch(() => {});
  drawCard(ctx, c, await pictureOf(c));
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    if (blob.size <= MAX_CARD_BYTES) return new Uint8Array(await blob.arrayBuffer());
  }
  return null;
}
