// What the HOST keeps for a sealed app in the browser realm, bounded (#90, docs/22 §7.1).
//
// A realm's own memory is the engine's: no browser gives a page a way to cap a Worker or a frame, and
// nothing here pretends to. What these numbers bound is the shell's side — the page the person's
// other apps and their data live in: the arguments of the ops an app has asked for and not been
// answered yet, the answers being read for it (a download), how many of them there are at once, and
// how much a realm may throw at its port in one go.
//
// One limitation is said once, here: the host can only measure a message AFTER the browser has
// delivered it. A message over a limit has already been copied into the shell's process; the host
// refuses to keep it (it is garbage the moment it is refused), and a realm that keeps sending them
// is stopped. So these bound what the host RETAINS and for how long, not the instant's peak.
//
// Over a bound, the op is refused with an ordinary error the app can catch; nothing is reported
// anywhere (the owner's rule: block silently).

const MB = 1024 * 1024;

export const REALM_LIMITS = {
  /** One op's arguments (a file to write, a picture to keep), or one download's answer. */
  opBytes: 64 * MB,
  /**
   * One op that carries words and choices rather than bytes — a toast, a dialog, a form, a
   * navigation, a log line: the shell lays these out on its own thread.
   */
  wordsBytes: 4 * MB,
  /** All of an app's unanswered ops together, and the answers being read for them: its logic's and its screens'. */
  heldBytes: 192 * MB,
  /** Ops unanswered at once. A page of a few hundred rows asks a few thousand. */
  opsInFlight: 16_384,
  /** Questions to the person open at once (a dialog, a sheet, a picker, a consent). */
  questions: 16,
  /** Progress bars open at once. */
  progressBars: 8,
  /** The name a realm gives a progress bar or a hold: a short number, in practice. */
  nameChars: 64,
  /** What one call of the app's hands back (a computed value, a summary, a tile). */
  resultBytes: 8 * MB,
  /** The app's definition as data, read once when it loads. */
  definitionBytes: 8 * MB,
  /** Bytes a realm may send on a port between two of its watchdog's checks (50 ms): more is a flood, stopped like one. */
  burstBytes: 256 * MB,
  /**
   * Values in one message the host will walk to measure it. A message with more is refused as too
   * much without being walked further: measuring is the shell's own thread.
   */
  nodes: 1_000_000,
  /** Time the host may spend measuring one app's messages in any second: more is a flood, stopped like one. */
  measureMs: 400,
} as const;

/** The ops that carry words and choices, held to `wordsBytes`. `ui.share` carries files and has its own limits (make-ctx.ts). */
export function isWordsOp(op: string): boolean {
  return (op.startsWith("ui.") && op !== "ui.share") || op === "log" || op === "navigate" || op === "view.navigate" || op === "views.call" || op.startsWith("guests.") || op.startsWith("caps.notifications.") || op === "caps.haptics.vibrate";
}

/** What a plain node costs where nothing better is known: its slot and its header, roughly. */
const NODE = 16;

/** A BigInt's bytes, found by a few shifts: one can be as large as the engine allows. */
function bigintBytes(v: bigint): number {
  const n = v < 0n ? -v : v;
  for (const bits of [64, 8 * 1024, 8 * MB, 64 * MB]) if (n >> BigInt(bits) === 0n) return bits / 8;
  return Number.POSITIVE_INFINITY;
}

/**
 * About how many bytes a value that crossed a port holds — a structured clone: plain data, binary,
 * Blobs, Maps, Sets, Dates. An estimate from below for objects (the engines differ) and exact for
 * what is big: strings (two bytes a unit), buffers and Blobs. It stops counting once past `stopAt`,
 * so a value built to be slow to measure costs no more than its first `stopAt` bytes' worth, and
 * gives up — the answer is then infinite, "too much" — after `REALM_LIMITS.nodes` values.
 */
export function sizeOf(value: unknown, stopAt: number = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const stack: object[] = [];
  /** Counted here when it is a leaf; an object waits its turn. */
  const visit = (v: unknown): void => {
    nodes += 1;
    if (typeof v === "string") bytes += NODE + v.length * 2;
    else if (typeof v === "bigint") bytes += NODE + bigintBytes(v);
    else if (v === null || typeof v !== "object") bytes += 8;
    else stack.push(v);
  };
  visit(value);
  while (stack.length && bytes <= stopAt) {
    if (nodes > REALM_LIMITS.nodes) return Number.POSITIVE_INFINITY;
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    if (v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer)) {
      bytes += NODE + v.byteLength;
      continue;
    }
    if (ArrayBuffer.isView(v)) {
      // The whole buffer crossed, whatever part of it the view shows.
      if (!seen.has(v.buffer)) {
        seen.add(v.buffer);
        bytes += v.buffer.byteLength;
      }
      bytes += NODE;
      continue;
    }
    if (typeof Blob !== "undefined" && v instanceof Blob) {
      bytes += NODE + v.size;
      continue;
    }
    bytes += NODE;
    // What a clone carries that is not an own enumerable property: an error's words, a picture's
    // pixels, a pattern's source, a boxed string's text.
    if (v instanceof Error || (typeof DOMException !== "undefined" && v instanceof DOMException)) {
      const e = v as Error;
      visit(e.name);
      visit(e.message);
      visit(e.stack);
      visit((e as { cause?: unknown }).cause);
    } else if (v instanceof RegExp) {
      bytes += v.source.length * 2;
      continue;
    } else if (v instanceof String) {
      bytes += v.length * 2;
      continue;
    } else if (typeof ImageData !== "undefined" && v instanceof ImageData) {
      visit(v.data);
      continue;
    } else if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null && !(v instanceof Map) && !(v instanceof Set) && !(v instanceof Date)) {
      // Something else of the platform's (an ImageBitmap, a video frame): by its picture, when it has one.
      const { width, height, displayWidth, displayHeight } = v as { width?: unknown; height?: unknown; displayWidth?: unknown; displayHeight?: unknown };
      const w = Number(width ?? displayWidth);
      const h = Number(height ?? displayHeight);
      if (w > 0 && h > 0) bytes += w * h * 4;
    }
    if (Array.isArray(v)) {
      // Every slot is charged before any is read, holes too: `new Array(1e9)` is refused, not walked.
      bytes += v.length * 8;
      for (let i = 0; i < v.length && bytes <= stopAt && nodes <= REALM_LIMITS.nodes; i++) visit(v[i]);
      // A clone keeps an array's named properties too.
      for (const key in v) {
        const c = key.charCodeAt(0);
        if (c >= 48 && c <= 57) continue;
        if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
        bytes += NODE + key.length * 2;
        visit((v as unknown as Record<string, unknown>)[key]);
        if (bytes > stopAt) break;
      }
      continue;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        visit(k);
        visit(x);
        if (bytes > stopAt) break;
      }
      continue;
    }
    if (v instanceof Set) {
      for (const x of v) {
        visit(x);
        if (bytes > stopAt) break;
      }
      continue;
    }
    if (v instanceof Date) continue;
    for (const key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
      bytes += NODE + key.length * 2;
      visit((v as Record<string, unknown>)[key]);
      if (bytes > stopAt) break;
    }
  }
  return bytes;
}

const megabytes = (n: number): string => `${Math.round(n / MB)} MB`;

/** An op refused for its size or their number: an ordinary error the app can catch, as any other the host answers with. */
export class RealmLimitError extends RangeError {
  // A RangeError by name too: let go by the app, it is a bug's trace to whoever tells the person
  // ("That did not work"), never these words (app-error.ts `actionFailure`).
  override name = "RangeError";
  readonly code = "too-much";
}

/**
 * One app's account of what the host holds for it right now: its logic's ops and its screens'
 * together. `take` charges or refuses; what it returns gives the bytes back.
 */
export class HeldBudget {
  private bytes = 0;
  private ops = 0;
  private windowBytes = 0;
  private windowStart = 0;
  private busyMs = 0;
  private busyStart = 0;

  constructor(
    private readonly limits: { heldBytes: number; opsInFlight: number; burstBytes: number; measureMs?: number } = REALM_LIMITS,
    private readonly now: () => number = () => performance.now(),
    private readonly windowMs = 50,
  ) {}

  get heldBytes(): number {
    return this.bytes;
  }
  get inFlight(): number {
    return this.ops;
  }

  /**
   * Measure a message that arrived (`sizeOf`), and keep count of the time that took: the measuring
   * is the shell's own thread, and `arrived` calls a realm that takes too much of it a flood.
   */
  measure(value: unknown, stopAt: number): number {
    const t0 = this.now();
    if (t0 - this.busyStart >= 1000) {
      this.busyStart = t0;
      this.busyMs = 0;
    }
    const size = sizeOf(value, stopAt);
    this.busyMs += this.now() - t0;
    return size;
  }

  /** `bytes` arrived on a port. True when that is more than a realm may send in one window: a flood. */
  arrived(bytes: number): boolean {
    if (this.busyMs > (this.limits.measureMs ?? Number.POSITIVE_INFINITY)) return true;
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.windowBytes = 0;
    }
    // A message given up on (`sizeOf`'s infinite answer) is refused where it is answered; here it weighs as the largest one.
    this.windowBytes += Number.isFinite(bytes) ? bytes : REALM_LIMITS.opBytes;
    return this.windowBytes > this.limits.burstBytes;
  }

  /** An op begins: count it, or refuse it. The returned function ends it (idempotent). */
  begin(): () => void {
    if (this.ops >= this.limits.opsInFlight) throw new RealmLimitError(`too many requests are waiting at once (at most ${this.limits.opsInFlight}): wait for some to be answered`);
    this.ops += 1;
    let over = false;
    return () => {
      if (over) return;
      over = true;
      this.ops -= 1;
    };
  }

  /** Hold `bytes` for the app, or refuse them. The returned function lets them go (idempotent). */
  take(bytes: number, what: string): () => void {
    if (this.bytes + bytes > this.limits.heldBytes) {
      throw new RealmLimitError(`${what}: too much is waiting at once (at most ${megabytes(this.limits.heldBytes)} for a shared app): wait for some of it to be answered`);
    }
    this.bytes += bytes;
    let over = false;
    return () => {
      if (over) return;
      over = true;
      this.bytes -= bytes;
    };
  }
}

/** Refuse one op's arguments for their size (`sizeOf`). */
export function checkOpSize(op: string, size: number): void {
  const limit = isWordsOp(op) ? REALM_LIMITS.wordsBytes : REALM_LIMITS.opBytes;
  if (size > limit) throw new RealmLimitError(`ctx.${op}: this is more than a shared app may send at once (at most ${megabytes(limit)})`);
}

/**
 * A response's body, read for a sealed app and held to its account while it is read: at most
 * `opBytes`, and within what the app may have waiting. Past either, the download is cancelled — the
 * rest is never read into the shell — and the app's `fetch` rejects. `release` gives the bytes back,
 * once the answer has been handed to the app.
 */
export async function readBody(res: Response, budget: HeldBudget): Promise<{ body: ArrayBuffer; release(): void }> {
  const tooBig = (): RealmLimitError => new RealmLimitError(`fetch: the answer is more than a shared app may read at once (at most ${megabytes(REALM_LIMITS.opBytes)})`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > REALM_LIMITS.opBytes) {
    void res.body?.cancel().catch(() => {});
    throw tooBig();
  }
  const held: Array<() => void> = [];
  const release = (): void => {
    for (const give of held.splice(0)) give();
  };
  const reader = res.body?.getReader();
  try {
    if (!reader) {
      // No stream to read by parts (a fake in a test, an old engine): the whole body, then the check.
      const all = await res.arrayBuffer();
      if (all.byteLength > REALM_LIMITS.opBytes) throw tooBig();
      held.push(budget.take(all.byteLength, "fetch"));
      return { body: all, release };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REALM_LIMITS.opBytes) throw tooBig();
      held.push(budget.take(value.byteLength, "fetch"));
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return { body: out.buffer, release };
  } catch (e) {
    release();
    void reader?.cancel().catch(() => {});
    throw e;
  }
}
