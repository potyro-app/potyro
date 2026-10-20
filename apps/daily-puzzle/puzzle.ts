// The daily colour code, as plain arithmetic: which puzzle today is, the code it hides, what a guess
// is told, what the palette knows, the stats, and the line people paste into a chat. No DOM, no ctx:
// the tests run all of it, and the screen only draws what these functions say.
//
// The same puzzle for everyone, with no server: the code is a pure function of the puzzle number,
// and the number is the count of calendar days since the first puzzle, read from the person's own
// calendar date (like Wordle — a new puzzle at each local midnight).

/** How many gems a code has. */
export const LENGTH = 5;
/** How many colours there are to choose from. Repeats are allowed. */
export const COLOURS = 7;
/** How many guesses a day gets. */
export const TRIES = 6;
/** Puzzle #1's date. Never change it: every number, every streak and every shared result keys on it. */
export const FIRST_DAY = { y: 2026, m: 10, d: 15 } as const;

/** What one gem of a guess is told: in the right place, in the code elsewhere, or not in it (any more). */
export type Mark = "exact" | "present" | "absent";
export type Code = readonly number[];

const DAY_MS = 86_400_000;

/** A calendar date as a day count, through UTC so a daylight-saving change cannot make a day 23 hours. */
const dayCount = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);

/** The puzzle number for a date, read as the person's calendar shows it: 1 on FIRST_DAY. */
export function puzzleNumber(date: Date): number {
  return dayCount(date.getFullYear(), date.getMonth() + 1, date.getDate()) - dayCount(FIRST_DAY.y, FIRST_DAY.m, FIRST_DAY.d) + 1;
}

/** The calendar date puzzle `n` belongs to (local midnight). */
export function puzzleDate(n: number): Date {
  const first = new Date(FIRST_DAY.y, FIRST_DAY.m - 1, FIRST_DAY.d);
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() + (n - 1));
}

/** The next local midnight after `now`: when the next puzzle opens. */
export function nextPuzzleAt(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/** "07:12:03" until `at`. */
export function countdown(now: Date, at: Date): string {
  const s = Math.max(0, Math.floor((at.getTime() - now.getTime()) / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** A 32-bit hash of a string (xmur3's mix): spreads neighbouring numbers far apart. */
function hash(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** A small seeded generator (mulberry32): the same seed, the same numbers, on every device. */
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

/** A code from a generator. */
export function codeFrom(random: () => number): number[] {
  return Array.from({ length: LENGTH }, () => Math.floor(random() * COLOURS));
}

/**
 * Puzzle `n`'s code. Pure and versioned by its salt: the same on every device, forever. A code of one
 * colour five times over is not a puzzle anyone enjoys, so it draws again until two colours differ.
 */
export function dailyCode(n: number): number[] {
  const random = rng(hash(`potyro-daily/v1/${n}`));
  for (;;) {
    const code = codeFrom(random);
    if (new Set(code).size >= 2) return code;
  }
}

/**
 * What a guess is told, gem by gem, by Wordle's rules: right place first; then, left to right, a gem
 * is "present" only while the code still has an unmatched gem of its colour, so a guess with two
 * rubies against a code with one is told about one of them.
 */
export function feedback(guess: Code, code: Code): Mark[] {
  const marks: Mark[] = guess.map(() => "absent");
  const left = new Map<number, number>();
  guess.forEach((g, i) => {
    if (g === code[i]) marks[i] = "exact";
    else left.set(code[i]!, (left.get(code[i]!) ?? 0) + 1);
  });
  guess.forEach((g, i) => {
    if (marks[i] === "exact") return;
    const n = left.get(g) ?? 0;
    if (n > 0) {
      marks[i] = "present";
      left.set(g, n - 1);
    }
  });
  return marks;
}

export const solved = (marks: readonly Mark[]): boolean => marks.length === LENGTH && marks.every((m) => m === "exact");

/** Where a day's game stands. */
export interface Game {
  guesses: number[][];
}
export type Outcome = "playing" | "won" | "lost";

export function outcome(game: Game, code: Code): Outcome {
  const last = game.guesses[game.guesses.length - 1];
  if (last && solved(feedback(last, code))) return "won";
  return game.guesses.length >= TRIES ? "lost" : "playing";
}

/** Whether a stored game is one this puzzle could have produced: whole guesses of known colours. */
export function validGame(raw: unknown): raw is Game {
  const g = raw as Game | null;
  return (
    !!g &&
    Array.isArray(g.guesses) &&
    g.guesses.length <= TRIES &&
    g.guesses.every((row) => Array.isArray(row) && row.length === LENGTH && row.every((c) => Number.isInteger(c) && c >= 0 && c < COLOURS))
  );
}

/**
 * What the palette knows about each colour after these guesses: "exact" once it has been right
 * somewhere, "present" once it is known to be in the code, "absent" once guessed and never either,
 * `undefined` while untried.
 */
export function paletteHints(guesses: readonly Code[], code: Code): Array<Mark | undefined> {
  const hint: Array<Mark | undefined> = Array.from({ length: COLOURS }, () => undefined);
  const rank = { absent: 0, present: 1, exact: 2 } as const;
  for (const g of guesses) {
    feedback(g, code).forEach((m, i) => {
      const c = g[i]!;
      const was = hint[c];
      if (was === undefined || rank[m] > rank[was]) hint[c] = m;
    });
  }
  return hint;
}

// ---- the line people paste into a chat ----

/** The squares: Wordle's, so a chat reads the grid at a glance. High contrast swaps to orange and blue. */
export function squares(marks: readonly Mark[], contrast = false): string {
  const exact = contrast ? "🟧" : "🟩";
  const present = contrast ? "🟦" : "🟨";
  return marks.map((m) => (m === "exact" ? exact : m === "present" ? present : "⬛")).join("");
}

/**
 * "Potyro Daily #12 4/6" and the grid, spoiler-free: the squares say how it went, never which colours.
 * The same in every language — it is the game's own notation, like a chess move.
 */
export function shareText(n: number, game: Game, code: Code, opts: { contrast?: boolean } = {}): string {
  const result = outcome(game, code);
  const score = result === "won" ? String(game.guesses.length) : "X";
  const rows = game.guesses.map((g) => squares(feedback(g, code), opts.contrast));
  return [`Potyro Daily #${n} ${score}/${TRIES}`, ...rows].join("\n");
}

// ---- stats ----

/** A finished day, as the app keeps it. */
export interface Played {
  number: number;
  won: boolean;
  /** Guesses used (TRIES when lost). */
  guesses: number;
}

export interface Stats {
  played: number;
  wins: number;
  /** 0–100, whole. */
  winRate: number;
  /** Wins on consecutive days ending today, or yesterday while today is still unplayed. */
  streak: number;
  best: number;
  /** Wins by guesses used: index 0 is "in one". */
  spread: number[];
}

/** Stats from finished days. `today` is today's puzzle number. One record per number counts. */
export function stats(played: readonly Played[], today: number): Stats {
  const byNumber = new Map<number, Played>();
  for (const p of played) if (!byNumber.has(p.number)) byNumber.set(p.number, p);
  const days = [...byNumber.values()].sort((a, b) => a.number - b.number);
  const wins = days.filter((d) => d.won);
  const spread = Array.from({ length: TRIES }, () => 0);
  for (const w of wins) if (w.guesses >= 1 && w.guesses <= TRIES) spread[w.guesses - 1]!++;

  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const d of days) {
    run = d.won ? (d.number === prev + 1 ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    prev = d.won ? d.number : Number.NaN;
  }

  // The current streak counts back from today, or from yesterday while today is still to play.
  let streak = 0;
  const won = new Set(wins.map((w) => w.number));
  let at = byNumber.has(today) ? today : today - 1;
  while (won.has(at)) {
    streak++;
    at--;
  }

  return {
    played: days.length,
    wins: wins.length,
    winRate: days.length ? Math.round((wins.length / days.length) * 100) : 0,
    streak,
    best,
    spread,
  };
}
