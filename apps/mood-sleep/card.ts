// The share card: a 1080×1350 picture of the Patterns screen's hero — the sentence with its numbers
// in the series colours, the three stats and the night-by-night chart — on the night palette.
//
// The layout (`wrapRuns`, `plotPoints`) is plain functions the tests run without a browser; `drawCard`
// paints them on a canvas and hands back a PNG.
import type { Insight } from "./insights.js";

export const CARD_W = 1080;
export const CARD_H = 1350;

/** The dark theme's neutrals, as DESIGN.md §3.1 sets them: a shared card is always the night one. */
export const NIGHT = {
  bg: "#1c1b1c",
  surface: "#2a2829",
  line: "#3a3839",
  ink: "#f3f3f4",
  inkSoft: "#e6e5e7",
  muted: "#a8a6aa",
} as const;

export interface CardColours {
  /** The app's colour at the dark theme's text level (`--tinta-d`). */
  sleep: string;
  mood: string;
  display: string;
  body: string;
}

export interface CardStat {
  label: string;
  value: string;
  unit: string;
}

export interface CardData {
  kicker: string;
  sentence: Insight;
  stats: CardStat[];
  title: string;
  legend: { sleep: string; mood: string };
  goal: { hours: number; label: string };
  hours: Array<number | null>;
  mood: Array<number | null>;
  /** Under the chart's two ends: "Mon 21", "Sun 11". */
  from: string;
  to: string;
  name: string;
}

export interface Run {
  text: string;
  series?: "sleep" | "mood";
}
export interface Placed extends Run {
  x: number;
}

/**
 * The sentence in lines no wider than `max`. It breaks only at a space in the plain text: a number
 * and its unit ("7 hours") stay together, and so does a number and the stop after it ("4.3.").
 */
export function wrapRuns(parts: Insight["parts"], width: (r: Run) => number, max: number): Placed[][] {
  const words: Run[][] = [[]];
  for (const p of parts) {
    if (typeof p !== "string") {
      words[words.length - 1]!.push({ text: p.value, series: p.series });
      continue;
    }
    p.split(" ").forEach((piece, i) => {
      if (i > 0) words.push([]);
      if (piece) words[words.length - 1]!.push({ text: piece });
    });
  }
  const space = width({ text: " " });
  const lines: Placed[][] = [];
  let line: Placed[] = [];
  let x = 0;
  for (const word of words.filter((w) => w.length > 0)) {
    const w = word.reduce((sum, r) => sum + width(r), 0);
    if (line.length && x + space + w > max) {
      lines.push(line);
      line = [];
      x = 0;
    } else if (line.length) {
      x += space;
    }
    for (const r of word) {
      line.push({ ...r, x });
      x += width(r);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sleep runs 3–10 hours up the plot, mood 1–5 (with half a step of room): as the screen's chart. */
export const SLEEP_AXIS = [3, 10] as const;
export const MOOD_AXIS = [0.5, 5.5] as const;

/** Each logged day as a point in `box`; a day with nothing logged has none. */
export function plotPoints(values: Array<number | null>, axis: readonly [number, number], box: Box): Array<{ x: number; y: number } | null> {
  const n = values.length;
  const step = n > 1 ? box.w / (n - 1) : 0;
  return values.map((v, i) => {
    if (v == null) return null;
    const t = (Math.min(axis[1], Math.max(axis[0], v)) - axis[0]) / (axis[1] - axis[0]);
    return { x: box.x + (n > 1 ? i * step : box.w / 2), y: box.y + box.h - t * box.h };
  });
}

const PAD = 88;

/** The card as a PNG. Waits for the two fonts, so the first share is not drawn in a fallback. */
export async function drawCard(data: CardData, colours: CardColours): Promise<Blob> {
  const display = (size: number) => `700 ${size}px ${colours.display}`;
  const body = (size: number, weight = 500) => `${weight} ${size}px ${colours.body}`;
  try {
    await Promise.all([document.fonts.load(display(64)), document.fonts.load(body(28)), document.fonts.load(body(28, 600))]);
  } catch {
    // A font that will not load draws in the next one in the stack.
  }
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d")!;
  g.fillStyle = NIGHT.bg;
  g.fillRect(0, 0, CARD_W, CARD_H);
  g.textBaseline = "alphabetic";

  // The moon, as the screen's hero has it: a crescent in the sleep colour, cut by the sky.
  g.globalAlpha = 0.28;
  g.fillStyle = colours.sleep;
  g.beginPath();
  g.arc(CARD_W - 140, 112, 72, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = NIGHT.bg;
  g.beginPath();
  g.arc(CARD_W - 168, 90, 66, 0, Math.PI * 2);
  g.fill();

  // Kicker
  g.fillStyle = NIGHT.muted;
  g.font = body(26, 600);
  g.letterSpacing = "3px";
  g.fillText(data.kicker.toLocaleUpperCase(), PAD, 150);
  g.letterSpacing = "0px";

  // The sentence: as large as fits in five lines.
  const width = CARD_W - PAD * 2;
  let size = 72;
  let lines: Placed[][] = [];
  for (; size >= 44; size -= 4) {
    g.font = display(size);
    lines = wrapRuns(data.sentence.parts, (r) => g.measureText(r.text).width, width);
    if (lines.length <= 5) break;
  }
  const lead = Math.round(size * 1.2);
  let y = 150 + 40 + size;
  for (const line of lines) {
    for (const r of line) {
      g.fillStyle = r.series === "sleep" ? colours.sleep : r.series === "mood" ? colours.mood : NIGHT.ink;
      g.fillText(r.text, PAD + r.x, y);
    }
    y += lead;
  }

  // The three stats
  y += 56;
  const col = width / 3;
  data.stats.forEach((s, i) => {
    const x = PAD + i * col;
    g.fillStyle = NIGHT.muted;
    g.font = body(28);
    g.fillText(s.label, x, y, col - 16);
    g.fillStyle = NIGHT.ink;
    g.font = display(84);
    g.fillText(s.value, x, y + 92);
    if (s.unit) {
      const after = g.measureText(s.value).width;
      g.fillStyle = NIGHT.muted;
      g.font = body(32);
      g.fillText(s.unit, x + after + 6, y + 92);
    }
  });

  // Night by night, on its own panel down to the name.
  const panel: Box = { x: PAD - 24, y: y + 150, w: width + 48, h: CARD_H - 150 - (y + 150) };
  g.fillStyle = NIGHT.surface;
  g.beginPath();
  g.roundRect(panel.x, panel.y, panel.w, panel.h, 40);
  g.fill();
  drawChart(g, data, colours, panel, display, body);

  // The app's name at the foot.
  g.fillStyle = NIGHT.inkSoft;
  g.font = display(36);
  g.fillText(data.name, PAD, CARD_H - 64);

  return new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("no picture"))), "image/png"));
}

function drawChart(
  g: CanvasRenderingContext2D,
  data: CardData,
  colours: CardColours,
  panel: Box,
  display: (size: number) => string,
  body: (size: number, weight?: number) => string,
): void {
  const inner = panel.x + 40;
  g.fillStyle = NIGHT.ink;
  g.font = display(40);
  g.fillText(data.title, inner, panel.y + 76);

  // The legend, right-aligned on the title's line: a bar for sleep, a ring for mood.
  g.font = body(26);
  const right = panel.x + panel.w - 40;
  const moodW = g.measureText(data.legend.mood).width;
  const sleepW = g.measureText(data.legend.sleep).width;
  const moodX = right - moodW;
  const sleepX = moodX - 48 - sleepW - 40;
  g.fillStyle = NIGHT.muted;
  g.fillText(data.legend.mood, moodX, panel.y + 74);
  g.fillText(data.legend.sleep, sleepX + 40, panel.y + 74);
  g.fillStyle = colours.sleep;
  g.beginPath();
  g.roundRect(sleepX, panel.y + 61, 30, 8, 4);
  g.fill();
  g.strokeStyle = colours.mood;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(moodX - 22, panel.y + 65, 8, 0, Math.PI * 2);
  g.stroke();

  // The goal's label sits in a gutter at the left, where an axis would be, clear of the points.
  g.font = body(24, 600);
  const gutter = g.measureText(data.goal.label).width + 24;
  const plot: Box = { x: inner + gutter, y: panel.y + 130, w: panel.w - 80 - gutter - 12, h: panel.h - 130 - 84 };

  // The goal line, dashed, with its label on a pill of the panel's colour.
  const goalY = plotPoints([data.goal.hours], SLEEP_AXIS, { ...plot, w: 0 })[0]!.y;
  g.save();
  g.setLineDash([10, 12]);
  g.strokeStyle = colours.sleep;
  g.globalAlpha = 0.55;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(plot.x, goalY);
  g.lineTo(plot.x + plot.w, goalY);
  g.stroke();
  g.restore();

  // Sleep: a soft line over a filled area, across the days with nothing logged. Each bend is a curve
  // through the midpoints, so it never swings past a night's value.
  const sleep = plotPoints(data.hours, SLEEP_AXIS, plot).filter((p): p is { x: number; y: number } => p !== null);
  const curve = () => {
    sleep.forEach((p, i) => {
      const next = sleep[i + 1];
      if (i === 0) g.lineTo(p.x, p.y);
      if (next) g.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      else g.lineTo(p.x, p.y);
    });
  };
  if (sleep.length) {
    const bottom = plot.y + plot.h;
    g.beginPath();
    g.moveTo(sleep[0]!.x, bottom);
    curve();
    g.lineTo(sleep[sleep.length - 1]!.x, bottom);
    g.closePath();
    g.globalAlpha = 0.22;
    g.fillStyle = colours.sleep;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(sleep[0]!.x, sleep[0]!.y);
    curve();
    g.strokeStyle = colours.sleep;
    g.lineWidth = 6;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
  }

  // Mood: a ring on each morning it was logged.
  for (const p of plotPoints(data.mood, MOOD_AXIS, plot)) {
    if (!p) continue;
    g.beginPath();
    g.arc(p.x, p.y, 10, 0, Math.PI * 2);
    g.fillStyle = NIGHT.surface;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = colours.mood;
    g.stroke();
  }

  g.font = body(24, 600);
  g.fillStyle = colours.sleep;
  g.fillText(data.goal.label, inner, goalY + 9);

  // The window's two ends under the chart.
  g.fillStyle = NIGHT.muted;
  g.font = body(24);
  g.fillText(data.from, plot.x, panel.y + panel.h - 36);
  const toW = g.measureText(data.to).width;
  g.fillText(data.to, plot.x + plot.w - toW, panel.y + panel.h - 36);
}
