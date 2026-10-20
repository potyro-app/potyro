// The jigsaw as arithmetic: the levels, the cut (which way every knob points), the outline of each
// piece, where the pieces start, when one snaps home, and the score. No DOM, no ctx — the tests run
// all of it, and the screen only draws what these functions say.

/** A level: how the photo is cut. Pieces are square, so the photo is cropped to cols:rows. */
export interface Level {
  id: LevelId;
  cols: number;
  rows: number;
}
export type LevelId = "easy" | "medium" | "hard";

export const LEVELS: Record<LevelId, Level> = {
  easy: { id: "easy", cols: 3, rows: 4 },
  medium: { id: "medium", cols: 4, rows: 5 },
  hard: { id: "hard", cols: 6, rows: 8 },
};
export const LEVEL_IDS = Object.keys(LEVELS) as LevelId[];
export const isLevel = (v: unknown): v is LevelId => typeof v === "string" && v in LEVELS;
export const pieceCount = (l: Level): number => l.cols * l.rows;

/** A small seeded generator (mulberry32): the same seed, the same cut, on every device. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string as a 32-bit seed. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * One edge between two pieces: which way its knob points (+1 out of the first piece, -1 into it),
 * and how it is shaped, so no two knobs look stamped from one die. A border edge is `null`: flat.
 */
export interface Knob {
  dir: 1 | -1;
  /** Where along the edge the knob sits, 0.4–0.6. */
  at: number;
  /** How big it is, as a share of the piece's side. */
  size: number;
  /** A lean to one side, -0.06–0.06. */
  lean: number;
}

export interface Cut {
  level: Level;
  /** `h[r][c]`: the edge under piece (r, c), for r < rows - 1. */
  h: Knob[][];
  /** `v[r][c]`: the edge right of piece (r, c), for c < cols - 1. */
  v: Knob[][];
}

const knob = (random: () => number): Knob => ({
  dir: random() < 0.5 ? 1 : -1,
  at: 0.4 + random() * 0.2,
  size: 0.2 + random() * 0.06,
  lean: (random() - 0.5) * 0.12,
});

/** Cut a level: the same seed, the same pieces. */
export function cut(level: Level, seed: number): Cut {
  const random = rng(seed);
  const h = Array.from({ length: level.rows - 1 }, () => Array.from({ length: level.cols }, () => knob(random)));
  const v = Array.from({ length: level.rows }, () => Array.from({ length: level.cols - 1 }, () => knob(random)));
  return { level, h, v };
}

/** A piece's four edges, as seen from the piece: +1 a knob out, -1 a hole in, 0 flat. */
export interface Sides {
  top: Knob | null;
  right: Knob | null;
  bottom: Knob | null;
  left: Knob | null;
  /** Each side's direction from this piece's point of view. */
  dirs: { top: -1 | 0 | 1; right: -1 | 0 | 1; bottom: -1 | 0 | 1; left: -1 | 0 | 1 };
}

export function sides(c: Cut, row: number, col: number): Sides {
  const top = row > 0 ? c.h[row - 1]![col]! : null;
  const bottom = row < c.level.rows - 1 ? c.h[row]![col]! : null;
  const left = col > 0 ? c.v[row]![col - 1]! : null;
  const right = col < c.level.cols - 1 ? c.v[row]![col]! : null;
  return {
    top,
    right,
    bottom,
    left,
    dirs: {
      // An edge's `dir` is from the piece above / left of it; the piece below / right sees it reversed.
      top: top ? (-top.dir as -1 | 1) : 0,
      right: right ? right.dir : 0,
      bottom: bottom ? bottom.dir : 0,
      left: left ? (-left.dir as -1 | 1) : 0,
    },
  };
}

export const isEdgePiece = (c: Cut, row: number, col: number): boolean => row === 0 || col === 0 || row === c.level.rows - 1 || col === c.level.cols - 1;

/** A point of an outline, in piece units (the piece's square is 0..1 on both axes). */
export type Pt = [number, number];
/** One step of an outline: a line to a point, or a cubic curve through two controls to a point. */
export type Seg = { to: Pt } | { c1: Pt; c2: Pt; to: Pt };

/**
 * One side of a piece, from its start corner to its end corner, as segments in a local frame where
 * the side runs along x from 0 to 1 and "out of the piece" is -y. `dir` +1 bulges out, -1 in.
 */
function edgeLocal(k: Knob | null, dir: -1 | 0 | 1): Seg[] {
  if (!k || dir === 0) return [{ to: [1, 0] }];
  const s = k.size;
  const a = k.at;
  const l = k.lean;
  const y = (v: number): number => -dir * v; // out of the piece is -y
  const neck = s * 0.42;
  return [
    { to: [a - neck, 0] },
    { c1: [a - neck + 0.02, y(s * 0.35)], c2: [a - s * 0.95 + l, y(s * 0.55)], to: [a - s * 0.5 + l, y(s * 0.95)] },
    { c1: [a - s * 0.15 + l, y(s * 1.3)], c2: [a + s * 0.15 + l, y(s * 1.3)], to: [a + s * 0.5 + l, y(s * 0.95)] },
    { c1: [a + s * 0.95 + l, y(s * 0.55)], c2: [a + neck - 0.02, y(s * 0.35)], to: [a + neck, 0] },
    { to: [1, 0] },
  ];
}

/** Map a point from a side's local frame to the piece's square. */
function place(p: Pt, side: "top" | "right" | "bottom" | "left"): Pt {
  const [x, y] = p;
  if (side === "top") return [x, y]; // runs left→right along y=0, out is -y
  if (side === "right") return [1 - y, x]; // runs top→bottom along x=1, out is +x
  if (side === "bottom") return [1 - x, 1 - y]; // runs right→left along y=1, out is +y
  return [y, 1 - x]; // left: runs bottom→top along x=0, out is -x
}

/** A piece's whole outline, clockwise from its top-left corner, in piece units. */
export function outline(c: Cut, row: number, col: number): Seg[] {
  const s = sides(c, row, col);
  const out: Seg[] = [];
  for (const side of ["top", "right", "bottom", "left"] as const) {
    // Each side is drawn in the piece's own clockwise direction; the knob's own shape is defined from
    // the piece above/left, so a side seen from below/right is the same curve walked backwards.
    const k = s[side];
    const flipped = side === "bottom" || side === "left";
    const local = edgeLocal(k && flipped ? { ...k, at: 1 - k.at, lean: -k.lean } : k, s.dirs[side]);
    for (const seg of local) {
      out.push("c1" in seg ? { c1: place(seg.c1, side), c2: place(seg.c2, side), to: place(seg.to, side) } : { to: place(seg.to, side) });
    }
  }
  return out;
}

/** How far a piece's outline reaches past its square, in piece units: room for the knobs. */
export const BLEED = 0.34;

// ---- the table: where pieces start and when one is home ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The board (where the picture goes) and the whole table, laid out for a stage of `w`×`h`. */
export function layout(level: Level, w: number, h: number): { board: Rect; piece: number; table: Rect } {
  // The board takes the width (most of it on a phone, a column on a wide screen) and leaves room
  // below or beside it for loose pieces.
  const wide = w > h * 1.05;
  // On a phone the board keeps the top 55% or so, and the pieces get the rest.
  const maxBoardW = wide ? Math.min(w * 0.46, ((h - 32) * level.cols) / level.rows) : Math.min(w - 24, ((h * 0.55) * level.cols) / level.rows);
  const piece = Math.floor(maxBoardW / level.cols);
  const bw = piece * level.cols;
  const bh = piece * level.rows;
  const board = wide ? { x: Math.round(w * 0.06), y: Math.round((h - bh) / 2), w: bw, h: bh } : { x: Math.round((w - bw) / 2), y: 12, w: bw, h: bh };
  return { board, piece, table: { x: 0, y: 0, w, h } };
}

/** Where a piece's square sits when it is home. */
export const home = (board: Rect, piece: number, row: number, col: number): { x: number; y: number } => ({ x: board.x + col * piece, y: board.y + row * piece });

/**
 * Where `n` loose pieces go: spread over the room the board leaves (below it on a phone, beside it on a
 * wide screen), shuffled, each a little off a grid so the table looks tipped out rather than laid.
 * Away from the board whenever the table has room for them, and always wholly on the table.
 */
export function scatter(n: number, board: Rect, piece: number, table: Rect, random: () => number): Array<{ x: number; y: number }> {
  const pad = Math.ceil(piece * BLEED);
  const below = { x: table.x + pad, y: board.y + board.h + pad, w: table.w - 2 * pad - piece, h: table.y + table.h - (board.y + board.h) - 2 * pad - piece };
  const beside = { x: board.x + board.w + pad * 2, y: table.y + pad, w: table.x + table.w - (board.x + board.w) - 3 * pad - piece, h: table.h - 2 * pad - piece };
  // The bigger free area holds them; when it is too small for a loose spread they overlap the board.
  const area = beside.w * beside.h > below.w * below.h ? beside : below;
  const room = area.w > piece * 0.5 && area.h > piece * 0.5 ? area : { x: table.x + pad, y: table.y + pad, w: table.w - 2 * pad - piece, h: table.h - 2 * pad - piece };
  const cols = Math.max(1, Math.round(Math.sqrt((n * Math.max(room.w, 1)) / Math.max(room.h, 1))));
  const rows = Math.ceil(n / cols);
  const slots = Array.from({ length: n }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  return slots.map((slot) => {
    const gx = cols > 1 ? (slot % cols) / (cols - 1) : 0.5;
    const gy = rows > 1 ? Math.floor(slot / cols) / (rows - 1) : 0.5;
    const jitter = () => (random() - 0.5) * piece * 0.35;
    const x = room.x + gx * Math.max(0, room.w) + jitter();
    const y = room.y + gy * Math.max(0, room.h) + jitter();
    return {
      x: Math.round(Math.min(table.x + table.w - piece - pad, Math.max(table.x + pad, x))),
      y: Math.round(Math.min(table.y + table.h - piece - pad, Math.max(table.y + pad, y))),
    };
  });
}

/** How close to home a dropped piece has to land to snap in, in pixels: a third of a piece. */
export const snapDistance = (piece: number): number => Math.max(14, piece * 0.34);

export function snaps(at: { x: number; y: number }, to: { x: number; y: number }, piece: number): boolean {
  return Math.hypot(at.x - to.x, at.y - to.y) <= snapDistance(piece);
}

// ---- score ----

/** "1:07", "12:30", "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

export interface Solve {
  puzzle: string;
  level: LevelId;
  seconds: number;
  by?: string;
}

/** The best (fastest) solve for each level, of one puzzle or of all of them. */
export function bests(solves: readonly Solve[], puzzle?: string): Partial<Record<LevelId, Solve>> {
  const out: Partial<Record<LevelId, Solve>> = {};
  for (const s of solves) {
    if (puzzle !== undefined && s.puzzle !== puzzle) continue;
    if (!isLevel(s.level) || !Number.isFinite(s.seconds) || s.seconds <= 0) continue;
    const was = out[s.level];
    if (!was || s.seconds < was.seconds) out[s.level] = s;
  }
  return out;
}

/** Whether a time beats the best before it (a first solve is a best too). */
export const isBest = (seconds: number, before: Solve | undefined): boolean => !before || seconds < before.seconds;

/** The crop that fills a cols:rows frame from a w×h photo, centred. */
export function coverCrop(w: number, h: number, cols: number, rows: number): Rect {
  const want = cols / rows;
  if (w / h > want) {
    const cw = Math.round(h * want);
    return { x: Math.round((w - cw) / 2), y: 0, w: cw, h };
  }
  const ch = Math.round(w / want);
  return { x: 0, y: Math.round((h - ch) / 2), w, h: ch };
}
