// The pure parts of the editor: what changed between two texts, where a caret goes when the text
// changes under it, the runs of colour, and the segments the coloured backdrop draws. No DOM, no
// ctx, so every one of them runs in a unit test.
import type { TextEdit, TextRun } from "potyro";

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/**
 * The shortest "take this out, put that in" between two texts: the common prefix and suffix are
 * left alone. Never cuts a surrogate pair in half (a changed emoji is replaced whole).
 */
export function diffEdits(before: string, after: string): TextEdit[] {
  if (before === after) return [];
  const min = Math.min(before.length, after.length);
  let p = 0;
  while (p < min && before[p] === after[p]) p++;
  if (p > 0 && p < min && isHigh(before.charCodeAt(p - 1))) p--;
  let s = 0;
  while (s < min - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  if (s > 0 && isHigh(before.charCodeAt(before.length - 1 - s))) s--;
  const removed = before.length - p - s;
  const inserted = after.slice(p, after.length - s);
  const edits: TextEdit[] = [];
  if (removed > 0) edits.push({ from: p, to: p + removed });
  if (inserted) edits.push({ at: p, insert: inserted });
  return edits;
}

/**
 * Where a position in `before` is in `after`, when `after` is `before` with one stretch changed:
 * before the change it stays, after it shifts, inside it lands at the change's end.
 */
export function mapIndex(before: string, after: string, index: number): number {
  if (before === after) return Math.min(index, after.length);
  const min = Math.min(before.length, after.length);
  let p = 0;
  while (p < min && before[p] === after[p]) p++;
  let s = 0;
  while (s < min - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  if (index <= p) return index;
  if (index >= before.length - s) return index + (after.length - before.length);
  return after.length - s;
}

/** The runs after `edits` by `me`, so the backdrop keeps up with the keys without waiting for the store. */
export function applyEditsToRuns(runs: readonly TextRun[], edits: readonly TextEdit[], me: string): TextRun[] {
  let out = runs.map((r) => ({ ...r }));
  for (const e of edits) {
    if ("insert" in e) out = insertRun(out, e.at, e.insert, me);
    else out = deleteRange(out, e.from, e.to);
  }
  return merge(out);
}

function insertRun(runs: TextRun[], at: number, text: string, by: string): TextRun[] {
  if (!text) return runs;
  const out: TextRun[] = [];
  let pos = 0;
  let placed = false;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (!placed && at <= end) {
      const cut = at - pos;
      if (cut > 0) out.push({ text: r.text.slice(0, cut), by: r.by });
      out.push({ text, by });
      if (cut < r.text.length) out.push({ text: r.text.slice(cut), by: r.by });
      placed = true;
    } else out.push(r);
    pos = end;
  }
  if (!placed) out.push({ text, by });
  return out;
}

function deleteRange(runs: TextRun[], from: number, to: number): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    const a = Math.max(from, pos) - pos;
    const b = Math.min(to, end) - pos;
    if (b > a) {
      const kept = r.text.slice(0, a) + r.text.slice(b);
      if (kept) out.push({ text: kept, by: r.by });
    } else out.push(r);
    pos = end;
  }
  return out;
}

function merge(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.by === r.by) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** A comment's place in the text now, from its resolved anchors; `null` once its words are gone. */
export interface Placed {
  id: string;
  from: number;
  to: number;
}

/** A stretch of the backdrop: one author, the comments that cover it. */
export interface Segment {
  text: string;
  by: string | null;
  comments: readonly string[];
}

/**
 * The text cut wherever a run or a comment starts or ends, so each piece has one colour and one set
 * of comments. `runs` must spell `text` exactly; where they do not (a store answer from before the
 * last keystroke) the text is drawn uncoloured rather than wrongly coloured.
 */
export function segments(text: string, runs: readonly TextRun[], placed: readonly Placed[]): Segment[] {
  const colored = runs.map((r) => r.text).join("") === text ? runs : [{ text, by: null }];
  const cuts = new Set<number>([0, text.length]);
  let pos = 0;
  for (const r of colored) cuts.add((pos += r.text.length));
  for (const c of placed) {
    cuts.add(Math.min(c.from, text.length));
    cuts.add(Math.min(c.to, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  let runAt = 0;
  let run = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (to <= from) continue;
    while (run < colored.length && runAt + colored[run]!.text.length <= from) runAt += colored[run++]!.text.length;
    const by = colored[run]?.by ?? null;
    const comments = placed.filter((c) => (c.from < to && c.to > from) || (c.from === c.to && c.from === from)).map((c) => c.id);
    out.push({ text: text.slice(from, to), by, comments });
  }
  return out;
}

/** The colours writers get, by index: hues around the clock, tinted onto the page's own background. */
export const HUES = [20, 60, 110, 160, 210, 260, 300, 340] as const;
export const COLORS = HUES.length;

/** The tint for a colour index, as CSS: readable under the page's ink in light and dark alike. */
export const tintOf = (color: number): string => `color-mix(in oklab, oklch(72% 0.17 ${HUES[((color % COLORS) + COLORS) % COLORS]}) 38%, var(--bg, #fff))`;
/** The same hue, strong, for a dot or a border. */
export const strokeOf = (color: number): string => `oklch(62% 0.18 ${HUES[((color % COLORS) + COLORS) % COLORS]})`;

/** The first colour nobody has, else the one least taken. */
export function freeColor(taken: readonly number[]): number {
  const counts = new Array<number>(COLORS).fill(0);
  for (const c of taken) if (Number.isInteger(c) && c >= 0) counts[c % COLORS]!++;
  let best = 0;
  for (let i = 1; i < COLORS; i++) if (counts[i]! < counts[best]!) best = i;
  return best;
}

/** A stable colour for an account the app has no record for: from its id, so every device agrees. */
export function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % COLORS;
}

/** Initials for a swatch: "Ana Lima" → "AL", "bo" → "B". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0]!.slice(0, 1).toUpperCase() : (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

/** The one stretch where `from` and `to` differ, and what it became. */
function changed(from: string, to: string): { at: number; removed: number; inserted: string } {
  const min = Math.min(from.length, to.length);
  let p = 0;
  while (p < min && from[p] === to[p]) p++;
  let s = 0;
  while (s < min - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  return { at: p, removed: from.length - p - s, inserted: to.slice(p, to.length - s) };
}

/**
 * `base` changed two ways at once — `ours` on this screen, `theirs` as the store has it — as one
 * text with both changes. Two stretches apart are both kept where they were; two that overlap keep
 * theirs and put ours right after it, and the next round sends ours to the store from there.
 */
export function merge3(base: string, ours: string, theirs: string): string {
  if (ours === base || ours === theirs) return theirs;
  if (theirs === base) return ours;
  const o = changed(base, ours);
  const t = changed(base, theirs);
  // Two stretches apart: both, in place. Two inserts at the very same point: theirs first.
  if (o.at + o.removed <= t.at && !(o.at === t.at && o.removed === 0)) return base.slice(0, o.at) + o.inserted + base.slice(o.at + o.removed, t.at) + t.inserted + base.slice(t.at + t.removed);
  if (t.at + t.removed <= o.at) return base.slice(0, t.at) + t.inserted + base.slice(t.at + t.removed, o.at) + o.inserted + base.slice(o.at + o.removed);
  const from = Math.min(o.at, t.at);
  const to = Math.max(o.at + o.removed, t.at + t.removed);
  const tail = base.length - to;
  return base.slice(0, from) + theirs.slice(from, theirs.length - tail) + ours.slice(from, ours.length - tail) + base.slice(to);
}

/**
 * Each writer's colour, the same on every device: a writer keeps the colour on their record unless
 * an earlier writer (by when the record was made) already wears it — two people who opened the
 * document at the same moment both took the first free colour — in which case the later one moves
 * to the next free. Read, never written, so nobody's copy has to win.
 */
export function resolveColors(writers: ReadonlyArray<{ person: string; color: number; createdAt: string }>): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  const sorted = [...writers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.person.localeCompare(b.person));
  for (const w of sorted) {
    if (out.has(w.person)) continue;
    let color = ((Math.floor(w.color) % COLORS) + COLORS) % COLORS;
    for (let i = 0; i < COLORS && taken.has(color); i++) color = (color + 1) % COLORS;
    out.set(w.person, color);
    taken.add(color);
  }
  return out;
}
