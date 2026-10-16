// The drawing of one turn, as data: strokes and clears in the order the drawer made them. Every device
// holds the same list — the drawer's own, and everyone else's built from the drawer's messages — and
// draws it the same way. Pure, so merging out-of-order pieces, undo and a late joiner's snapshot are
// tested without a canvas (test/sketch.test.ts).
//
// Points live on a square board BOARD units wide, whatever the screen: a phone held upright and a
// laptop see the same picture, scaled. A stroke arrives in pieces (`q` = 0, 1, 2 …), about one every
// 50 ms while the finger moves; a piece that arrives twice, or after a later one, lands in its place.

/** The board is BOARD × BOARD units; a point is two whole numbers in 0…BOARD. */
export const BOARD = 1000;

export const COLORS = ["#1d1a26", "#e5383b", "#f48c06", "#ffd23f", "#2a9d4b", "#1e88e5", "#8e44ad", "#8d5524"] as const;
/** Index of the eraser in the colour list's place: it paints the paper. */
export const ERASER = COLORS.length;
export const PAPER = "#fffdf7";
/** Pen widths in board units: fine, medium, fat. */
export const SIZES = [6, 14, 32] as const;

export interface Stroke {
  kind: "stroke";
  id: number;
  /** Index into COLORS, or ERASER. */
  c: number;
  /** Index into SIZES. */
  w: number;
  /** Absolute points per piece, x0,y0,x1,y1…, by piece number. */
  pieces: Map<number, number[]>;
  done: boolean;
}

export interface Clear {
  kind: "clear";
  id: number;
}

export type Op = Stroke | Clear;

export interface Sketch {
  /** Sorted by id: the order the drawer made them in. */
  ops: Op[];
  /** Ids undone: a late piece of one of them is not allowed to bring it back. */
  gone: Set<number>;
}

export const emptySketch = (): Sketch => ({ ops: [], gone: new Set() });

const clampPt = (v: number) => Math.max(0, Math.min(BOARD, Math.round(v)));

/** Points → the wire: the first point as it is, then each as the step from the one before. */
export function packPoints(abs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < abs.length; i += 2) {
    if (i === 0) out.push(abs[0]!, abs[1]!);
    else out.push(abs[i]! - abs[i - 2]!, abs[i + 1]! - abs[i - 1]!);
  }
  return out;
}

/** The wire → points, each kept on the board. */
export function unpackPoints(rel: readonly number[]): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < rel.length; i += 2) {
    x = i === 0 ? rel[0]! : x + rel[i]!;
    y = i === 0 ? rel[1]! : y + rel[i + 1]!;
    out.push(clampPt(x), clampPt(y));
  }
  return out;
}

function insert(sk: Sketch, op: Op): Sketch {
  const i = sk.ops.findIndex((o) => o.id > op.id);
  const ops = i < 0 ? [...sk.ops, op] : [...sk.ops.slice(0, i), op, ...sk.ops.slice(i)];
  return { ...sk, ops };
}

/** A piece of a stroke: starts the stroke if it is new, fills its place if not. */
export function addPiece(sk: Sketch, piece: { s: number; q: number; c: number; w: number; pts: number[]; end?: boolean }): Sketch {
  if (sk.gone.has(piece.s)) return sk;
  const known = sk.ops.find((o) => o.id === piece.s);
  if (known && known.kind !== "stroke") return sk;
  if (!known) {
    const pieces = new Map([[piece.q, piece.pts]]);
    return insert(sk, { kind: "stroke", id: piece.s, c: piece.c, w: piece.w, pieces, done: piece.end === true });
  }
  const pieces = new Map(known.pieces);
  pieces.set(piece.q, piece.pts);
  const next: Stroke = { ...known, pieces, done: known.done || piece.end === true };
  return { ...sk, ops: sk.ops.map((o) => (o.id === piece.s ? next : o)) };
}

/** Wipe the board — as an op of its own, so it can be undone like a stroke. */
export function addClear(sk: Sketch, id: number): Sketch {
  if (sk.gone.has(id) || sk.ops.some((o) => o.id === id)) return sk;
  return insert(sk, { kind: "clear", id });
}

/** Take back one op by id. */
export function undo(sk: Sketch, id: number): Sketch {
  if (!sk.ops.some((o) => o.id === id)) return { ...sk, gone: new Set([...sk.gone, id]) };
  return { ops: sk.ops.filter((o) => o.id !== id), gone: new Set([...sk.gone, id]) };
}

/** The id `undo` should take back: the newest op. */
export const lastOp = (sk: Sketch): number | null => sk.ops.at(-1)?.id ?? null;

/** A stroke's points, all its pieces in order. */
export function pointsOf(s: Stroke): number[] {
  return [...s.pieces.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, pts]) => pts);
}

/** What is on the paper: the strokes after the last clear. */
export function visible(sk: Sketch): Stroke[] {
  let from = 0;
  sk.ops.forEach((o, i) => {
    if (o.kind === "clear") from = i + 1;
  });
  return sk.ops.slice(from).filter((o): o is Stroke => o.kind === "stroke");
}

// ---- the snapshot a late joiner gets ----

/** One op as the wire carries it in a snapshot. A long stroke may come as several, by piece. */
export type WireOp = { x: number } | { s: number; c: number; w: number; q: Array<[number, number[]]>; e?: 1 };

/** The sketch as snapshot ops, cut so that no batch's JSON passes `maxChars`. */
export function toWire(sk: Sketch, maxChars = 40_000): WireOp[][] {
  const batches: WireOp[][] = [];
  let batch: WireOp[] = [];
  let size = 2;
  const push = (op: WireOp) => {
    const len = JSON.stringify(op).length + 1;
    if (batch.length && size + len > maxChars) {
      batches.push(batch);
      batch = [];
      size = 2;
    }
    batch.push(op);
    size += len;
  };
  for (const op of sk.ops) {
    if (op.kind === "clear") {
      push({ x: op.id });
      continue;
    }
    // A stroke whose pieces would not fit one batch goes as several ops with the same id.
    let group: Array<[number, number[]]> = [];
    let groupSize = 40;
    const flush = (last: boolean) => {
      if (!group.length && !last) return;
      push({ s: op.id, c: op.c, w: op.w, q: group, ...(last && op.done ? { e: 1 as const } : {}) });
      group = [];
      groupSize = 40;
    };
    for (const [q, pts] of [...op.pieces.entries()].sort((a, b) => a[0] - b[0])) {
      const packed = packPoints(pts);
      const len = JSON.stringify(packed).length + 8;
      if (group.length && groupSize + len > maxChars / 2) flush(false);
      group.push([q, packed]);
      groupSize += len;
    }
    flush(true);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Merge snapshot ops into a sketch (what is already there stays; nothing is doubled). */
export function fromWire(sk: Sketch, ops: readonly WireOp[]): Sketch {
  let next = sk;
  for (const op of ops) {
    if ("x" in op) next = addClear(next, op.x);
    else {
      if (!op.q.length) next = addPiece(next, { s: op.s, q: 0, c: op.c, w: op.w, pts: [], end: op.e === 1 });
      op.q.forEach(([q, pts], i) => {
        next = addPiece(next, { s: op.s, q, c: op.c, w: op.w, pts: unpackPoints(pts), end: op.e === 1 && i === op.q.length - 1 });
      });
    }
  }
  return next;
}
