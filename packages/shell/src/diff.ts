// Line diff — what changed between two versions of an app's source.
//
// Small and dependency-free on purpose: app sources are a few hundred lines, and the shell already
// carries enough weight (esbuild-wasm, QuickJS). Common prefix/suffix are trimmed first, which for
// an AI edit ("add a rating field") usually leaves a handful of lines to align; the remainder gets
// a classic LCS. A guard keeps pathological inputs from quadratic blow-up.

export type DiffKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the OLD source (absent for additions). */
  a?: number;
  /** 1-based line number in the NEW source (absent for deletions). */
  b?: number;
}

export interface DiffStat {
  added: number;
  removed: number;
}

/** Beyond this many cells the LCS table is not worth building; fall back to a block replace. */
const MAX_CELLS = 4_000_000;

function splitLines(src: string): string[] {
  if (src === "") return []; // an empty source is zero lines, not one blank one
  // A trailing newline shouldn't read as an extra empty line in the diff.
  const lines = src.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line-level diff of two sources, oldest→newest. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ kind: "ctx", text: a[i], a: i + 1, b: i + 1 });

  for (const line of middle(midA, midB, head)) out.push(line);

  for (let i = 0; i < tail; i++) {
    const ai = a.length - tail + i;
    const bi = b.length - tail + i;
    out.push({ kind: "ctx", text: a[ai], a: ai + 1, b: bi + 1 });
  }
  return out;
}

/** Align the differing middle. `offset` is how many identical lines were trimmed off the front. */
function middle(a: string[], b: string[], offset: number): DiffLine[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text, i) => ({ kind: "add" as const, text, b: offset + i + 1 }));
  if (b.length === 0) return a.map((text, i) => ({ kind: "del" as const, text, a: offset + i + 1 }));

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    // Too big to align precisely — report the block as replaced rather than pretending to be exact.
    return [
      ...a.map((text, i) => ({ kind: "del" as const, text, a: offset + i + 1 })),
      ...b.map((text, i) => ({ kind: "add" as const, text, b: offset + i + 1 })),
    ];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i], a: offset + i + 1, b: offset + j + 1 });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      out.push({ kind: "del", text: a[i], a: offset + i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], b: offset + j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i], a: offset + i++ + 1 });
  while (j < m) out.push({ kind: "add", text: b[j], b: offset + j++ + 1 });
  return out;
}

export function diffStat(lines: readonly DiffLine[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

export interface DiffHunk {
  /** Lines to show, in order. */
  lines: DiffLine[];
  /** Unchanged lines skipped immediately BEFORE this hunk. */
  skippedBefore: number;
}

/** Collapse long runs of unchanged lines, keeping `context` lines around each change. */
export function toHunks(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "ctx") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });

  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], skippedBefore: skipped };
      skipped = 0;
      hunks.push(current);
    }
    current.lines.push(l);
  });
  return hunks;
}
