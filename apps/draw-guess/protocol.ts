// What the devices in a room say to each other: small JSON text messages, one kind per `t`.
//
// The room is the only channel and the relay passes every message to everyone else, as sent, with
// no sender (docs/26 §2). So each message names what it is about (the turn `k`, a player `p`), and
// everything that arrives is checked here before the game believes it: a message that is not one of
// these, or is out of range, is dropped silently — a peer can send anything.
//
// Sizes: a stroke piece is a few dozen numbers (one every ~50 ms while a finger moves), a game
// snapshot about a kilobyte for a full room, a late joiner's drawing cut into pieces of at most
// 40 000 characters. The relay's limit is 64 KiB a message and ~30 messages a second (docs/26 §3).
import { BOARD, COLORS, SIZES, type WireOp } from "./sketch.js";
import { MAX_NAME, type Game, type Phase, type Player, type Reveal } from "./game.js";
import { isLang, WORD_COUNT } from "./words.js";

export const MAX_GUESS = 40;
/** Points in one stroke piece, at most (x and y each count). */
export const MAX_PIECE = 600;
/** The longest message this app sends, well under the relay's 64 KiB. */
export const MAX_MESSAGE = 48_000;

/** The game as a snapshot carries it: the clock as milliseconds LEFT, since no two devices agree on the time. */
export type WireGame = Omit<Game, "ends"> & { left: number };

export type Msg =
  /** Hello: who I am in this game (`p`), on this connection (`m`). Sent on joining and to every new host. */
  | { t: "hi"; m: string; p: string; n: string }
  /** The host's game, all of it. `h` is the host's connection. */
  | { t: "st"; h: string; g: WireGame }
  /** The drawer chose; guessers see the blanks. */
  | { t: "go"; k: number; mask: string }
  /** A hint letter. */
  | { t: "hint"; k: number; mask: string }
  /** A piece of stroke `s`: colour `c`, size `w`, points `p` (the first absolute, then steps); `e` ends it. */
  | { t: "d"; k: number; s: number; q: number; c: number; w: number; p: number[]; e?: 1 }
  /** Undo op `s`. */
  | { t: "u"; k: number; s: number }
  /** Clear the board, as op `s`. */
  | { t: "x"; k: number; s: number }
  /** The drawing so far, for one late joiner (`to`, a connection). */
  | { t: "snap"; to: string; k: number; ops: WireOp[] }
  /** A guess, for the drawer's device to judge. Nobody else shows it until the drawer says it was wrong. */
  | { t: "g"; k: number; p: string; id: number; text: string }
  /** The drawer's verdict. A wrong guess carries its words, for everyone's feed; a right one does not. */
  | { t: "v"; k: number; p: string; id: number; r: "yes" | "close" | "no"; text?: string }
  /** The turn is over (from the drawer): the word, who got it, how much of the clock was left. */
  | { t: "end"; k: number; word: string; by: string | null; left: number; row: number };

// ---- checks ----

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
const isStr = (x: unknown, max: number, min = 0): x is string => typeof x === "string" && x.length <= max && x.length >= min;
const isId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const BIG = 2 ** 31;
const isTurn = (x: unknown): x is number => isInt(x, 0, BIG);
const isMask = (x: unknown): x is string => isStr(x, 64, 1);
const PHASES: readonly Phase[] = ["lobby", "pick", "draw", "reveal", "final"];
const isPts = (x: unknown, max = MAX_PIECE): x is number[] => Array.isArray(x) && x.length <= max && x.length % 2 === 0 && x.every((v) => isInt(v, -BOARD, BOARD));

function isPlayer(x: unknown): x is Player {
  return isObj(x) && isId(x.p) && (x.m === null || isId(x.m)) && isStr(x.name, MAX_NAME) && isInt(x.score, 0, BIG);
}

function isReveal(x: unknown): x is Reveal {
  if (x === null) return true;
  if (!isObj(x)) return false;
  const gained = x.gained;
  return (
    (x.word === null || isStr(x.word, 64)) &&
    (x.by === null || isId(x.by)) &&
    isId(x.drawer) &&
    ["guessed", "time", "left", "skipped"].includes(x.why as string) &&
    isObj(gained) &&
    Object.entries(gained).every(([k, v]) => isId(k) && isInt(v, 0, 1000))
  );
}

function isWireGame(x: unknown): x is WireGame {
  if (!isObj(x)) return false;
  return (
    isInt(x.v, 0, BIG) &&
    PHASES.includes(x.phase as Phase) &&
    isLang(x.lang) &&
    isInt(x.rounds, 1, 10) &&
    isInt(x.seconds, 10, 300) &&
    Array.isArray(x.players) &&
    x.players.length <= 32 &&
    x.players.every(isPlayer) &&
    isInt(x.round, 0, 10) &&
    Array.isArray(x.drawn) &&
    x.drawn.every(isId) &&
    (x.drawer === null || isId(x.drawer)) &&
    isTurn(x.turn) &&
    isInt(x.left, -BIG, BIG) &&
    isStr(x.mask, 64) &&
    isReveal(x.last) &&
    Array.isArray(x.used) &&
    x.used.length <= WORD_COUNT &&
    x.used.every((u) => isInt(u, 0, WORD_COUNT - 1))
  );
}

function isWireOp(x: unknown): x is WireOp {
  if (!isObj(x)) return false;
  if ("x" in x) return isTurn(x.x);
  return (
    isTurn(x.s) &&
    isInt(x.c, 0, COLORS.length) &&
    isInt(x.w, 0, SIZES.length - 1) &&
    (x.e === undefined || x.e === 1) &&
    Array.isArray(x.q) &&
    x.q.every((piece) => Array.isArray(piece) && piece.length === 2 && isInt(piece[0], 0, BIG) && isPts(piece[1]))
  );
}

/** A message, or null when it is not one this app knows (or not one it believes). */
export function decode(data: unknown): Msg | null {
  if (typeof data !== "string" || data.length > 70_000) return null;
  let x: unknown;
  try {
    x = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObj(x) || typeof x.t !== "string") return null;
  switch (x.t) {
    case "hi":
      return isId(x.m) && isId(x.p) && isStr(x.n, 80) ? { t: "hi", m: x.m, p: x.p, n: x.n } : null;
    case "st":
      return isId(x.h) && isWireGame(x.g) ? { t: "st", h: x.h, g: x.g } : null;
    case "go":
    case "hint":
      return isTurn(x.k) && isMask(x.mask) ? { t: x.t, k: x.k, mask: x.mask } : null;
    case "d":
      if (!isTurn(x.k) || !isTurn(x.s) || !isInt(x.q, 0, BIG) || !isInt(x.c, 0, COLORS.length) || !isInt(x.w, 0, SIZES.length - 1) || !isPts(x.p)) return null;
      if (x.e !== undefined && x.e !== 1) return null;
      return { t: "d", k: x.k, s: x.s, q: x.q, c: x.c, w: x.w, p: x.p, ...(x.e === 1 ? { e: 1 as const } : {}) };
    case "u":
    case "x":
      return isTurn(x.k) && isTurn(x.s) ? { t: x.t, k: x.k, s: x.s } : null;
    case "snap":
      return isId(x.to) && isTurn(x.k) && Array.isArray(x.ops) && x.ops.length <= 5000 && x.ops.every(isWireOp) ? { t: "snap", to: x.to, k: x.k, ops: x.ops } : null;
    case "g":
      return isTurn(x.k) && isId(x.p) && isTurn(x.id) && isStr(x.text, MAX_GUESS, 1) ? { t: "g", k: x.k, p: x.p, id: x.id, text: x.text } : null;
    case "v": {
      if (!isTurn(x.k) || !isId(x.p) || !isTurn(x.id) || !["yes", "close", "no"].includes(x.r as string)) return null;
      if (x.text !== undefined && !isStr(x.text, MAX_GUESS)) return null;
      const r = x.r as "yes" | "close" | "no";
      return { t: "v", k: x.k, p: x.p, id: x.id, r, ...(r === "no" && typeof x.text === "string" ? { text: x.text } : {}) };
    }
    case "end":
      return isTurn(x.k) && isStr(x.word, 64, 1) && (x.by === null || isId(x.by)) && typeof x.left === "number" && x.left >= 0 && x.left <= 1 && isInt(x.row, 0, WORD_COUNT - 1)
        ? { t: "end", k: x.k, word: x.word, by: x.by as string | null, left: x.left, row: x.row }
        : null;
    default:
      return null;
  }
}

/** A message as text for the room. Throws when it would be too big: a bug, never something to word. */
export function encode(msg: Msg): string {
  const text = JSON.stringify(msg);
  if (text.length > MAX_MESSAGE) throw new RangeError(`a ${msg.t} message of ${text.length} characters`);
  return text;
}

/** The game, as a snapshot carries it at `now`. */
export const toWireGame = (g: Game, now: number): WireGame => {
  const { ends, ...rest } = g;
  return { ...rest, left: g.ends ? Math.round(ends - now) : 0 };
};

/** A snapshot, on this device's clock. */
export const fromWireGame = (w: WireGame, now: number): Game => {
  const { left, ...rest } = w;
  return { ...rest, ends: left || rest.phase === "pick" || rest.phase === "draw" || rest.phase === "reveal" ? now + left : 0 };
};
