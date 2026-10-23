// The picture a chat shows for a demo link (docs/24 §5), drawn on the sharer's device.
//
// A card, not a screenshot: a screenshot would be taken from the person's screen, which shows their
// records. This draws only what the link already carries — the app's name, icon and colour, and a few
// lines of its DEMO records — 1200×630, the size every network's large card expects, as a JPEG kept
// under 300 KB (WhatsApp drops bigger ones).
import { isLucideName, lucidePath, lucideReady } from "@potyro/design";
import type { DemoSeed } from "./demo-package.js";

export const CARD_W = 1200;
export const CARD_H = 630;
export const MAX_CARD_BYTES = 300 * 1024;

export interface CardContent {
  name: string;
  icon?: string;
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

const PAPER = "#f7f3ea";
const SURFACE = "#fffdf8";
const INK = "#2b2219";
const INK_SOFT = "#6b5d50";
const LINE = "#e3dccf";
const POTYRO = "#e4a93c";

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

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the card. Separate from encoding so a test can look at what was drawn. */
export function drawCard(ctx: Ctx, c: CardContent): void {
  const accent = c.accent || POTYRO;
  const serif = `Georgia, "Iowan Old Style", "Palatino Linotype", serif`;
  const sans = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // A wash of the app's own colour from the left edge: the card is this app's, not Potyro's.
  const wash = ctx.createLinearGradient(0, 0, CARD_W * 0.6, 0);
  wash.addColorStop(0, accent);
  wash.addColorStop(1, PAPER);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.globalAlpha = 1;

  // The tile.
  const tile = { x: 72, y: 96, s: 220 };
  ctx.save();
  ctx.shadowColor = "rgba(43,34,25,0.18)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, tile.x, tile.y, tile.s, tile.s, 52);
  ctx.fillStyle = SURFACE;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, tile.x, tile.y, tile.s, tile.s, 52);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  const icon = c.icon?.trim();
  const path = icon && isLucideName(icon) ? lucidePath(icon) : undefined;
  if (path && typeof Path2D !== "undefined") {
    // The icon in the system's stroke (#425): Lucide's 24-box scaled to 120px, the stroke with it.
    const box = 120;
    ctx.save();
    ctx.translate(tile.x + (tile.s - box) / 2, tile.y + (tile.s - box) / 2);
    ctx.scale(box / 24, box / 24);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.stroke(new Path2D(path));
    ctx.restore();
  } else {
    // An emoji as the character it is; a name Lucide has not, or no icon, as the monogram.
    const emoji = icon && !isLucideName(icon) ? icon : undefined;
    ctx.font = emoji ? `120px ${sans}` : `bold 96px ${serif}`;
    ctx.fillText(emoji ?? c.name.slice(0, 2).toUpperCase(), tile.x + tile.s / 2, tile.y + tile.s / 2 + 6);
  }

  // Name and maker.
  const left = 350;
  const width = CARD_W - left - 72;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 66px ${serif}`;
  const nameLines = wrap(ctx, c.name, width, 2);
  let y = 150;
  for (const l of nameLines) {
    ctx.fillText(l, left, y);
    y += 74;
  }
  if (c.by) {
    ctx.font = `30px ${sans}`;
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(wrap(ctx, c.by, width, 1)[0]!, left, y - 20);
    y += 26;
  }

  // A few of its demo records, as rows: what the app is for, at a glance.
  if (c.lines.length) {
    const rowH = 58;
    const top = Math.max(y, 270);
    const boxH = c.lines.length * rowH + 16;
    ctx.save();
    ctx.shadowColor = "rgba(43,34,25,0.10)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, left, top, width, boxH, 22);
    ctx.fillStyle = SURFACE;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    roundRect(ctx, left, top, width, boxH, 22);
    ctx.stroke();
    ctx.font = `32px ${sans}`;
    c.lines.forEach((line, i) => {
      const cy = top + 8 + i * rowH + rowH / 2;
      ctx.beginPath();
      ctx.arc(left + 38, cy, 12, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textBaseline = "middle";
      ctx.fillText(wrap(ctx, line, width - 100, 1)[0]!, left + 70, cy + 1);
      if (i < c.lines.length - 1) {
        ctx.fillStyle = LINE;
        ctx.fillRect(left + 24, top + 8 + (i + 1) * rowH, width - 48, 2);
      }
    });
    ctx.textBaseline = "alphabetic";
  }

  // Footer: where it was made, and what the link does.
  ctx.fillStyle = INK;
  ctx.fillRect(0, CARD_H - 84, CARD_W, 84);
  ctx.beginPath();
  ctx.arc(102, CARD_H - 42, 20, 0, Math.PI * 2);
  ctx.fillStyle = POTYRO;
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `bold 22px ${sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✦", 102, CARD_H - 41);
  ctx.textAlign = "left";
  ctx.fillStyle = PAPER;
  ctx.font = `bold 28px ${sans}`;
  ctx.fillText(c.made, 138, CARD_H - 41);
  ctx.textAlign = "right";
  ctx.font = `28px ${sans}`;
  ctx.fillStyle = "#d8cfc2";
  ctx.fillText(wrap(ctx, c.tryIt, 620, 1)[0]!, CARD_W - 72, CARD_H - 41);
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
  drawCard(ctx, c);
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    if (blob.size <= MAX_CARD_BYTES) return new Uint8Array(await blob.arrayBuffer());
  }
  return null;
}
