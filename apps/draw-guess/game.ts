// The game, as the host keeps it: who plays, whose turn it is, the scores, the clock. Pure functions
// from a state and an event to the next state, with the time passed in — so every rule here is tested
// without a room, a screen or a timer (test/game.test.ts).
//
// Two devices have a say, each over what only it can know:
//   - the HOST (the oldest member of the room) runs the game: players, turns, rounds, scores, clocks;
//   - the DRAWER holds the word. It never leaves the drawer's device until the turn ends: the drawer
//     judges every guess, shows hint letters, and tells the host how the turn ended.
// A member who lies spoils only their own play (docs/26 §2).
import type { Lang } from "./words.js";

export type Phase = "lobby" | "pick" | "draw" | "reveal" | "final";

export interface Player {
  /** The player's own id for this game: kept across a reconnect, when the relay's member id is new. */
  p: string;
  /** The relay's id for their connection now, or null while they are away. */
  m: string | null;
  name: string;
  score: number;
}

export interface Reveal {
  /** The word, or null when the drawer left before saying it. */
  word: string | null;
  /** Who guessed it (a player id), or null. */
  by: string | null;
  /** Points this turn, by player id. */
  gained: Record<string, number>;
  why: "guessed" | "time" | "left" | "skipped";
  drawer: string;
}

export interface Game {
  /** Bumped on every change: a snapshot with a lower number is old news. */
  v: number;
  phase: Phase;
  lang: Lang;
  rounds: number;
  /** Seconds a turn lasts. */
  seconds: number;
  players: Player[];
  /** 1-based; 0 in the lobby. */
  round: number;
  /** Who has drawn in this round. */
  drawn: string[];
  /** Whose turn it is (a player id). */
  drawer: string | null;
  /** Counts every turn of the game: strokes and guesses name the turn they belong to. */
  turn: number;
  /** When the current phase's clock runs out, in the host's milliseconds (snapshots carry what is left). */
  ends: number;
  /** The word as guessers see it: `_` for a letter not shown yet. "" until the drawer has chosen. */
  mask: string;
  last: Reveal | null;
  /** Rows of words drawn this game (words.ts), so the drawer is not offered them again. */
  used: number[];
}

export const PICK_MS = 15_000;
export const REVEAL_MS = 5_000;
/** How long the host waits past the end of a turn for the drawer to say how it ended. */
export const GRACE_MS = 4_000;
export const ROUNDS = [1, 2, 3, 4, 5] as const;
export const SECONDS = [60, 70, 80] as const;
export const MIN_PLAYERS = 2;
export const MAX_NAME = 24;

/** A fresh room: one player, the host, in the lobby. */
export function newGame(host: { p: string; m: string; name: string }, lang: Lang): Game {
  return {
    v: 1,
    phase: "lobby",
    lang,
    rounds: 3,
    seconds: 80,
    players: [{ p: host.p, m: host.m, name: host.name, score: 0 }],
    round: 0,
    drawn: [],
    drawer: null,
    turn: 0,
    ends: 0,
    mask: "",
    last: null,
    used: [],
  };
}

const bump = (g: Game, next: Partial<Game>): Game => ({ ...g, ...next, v: g.v + 1 });

export const online = (g: Game): Player[] => g.players.filter((x) => x.m !== null);
export const playerOf = (g: Game, p: string | null): Player | undefined => (p ? g.players.find((x) => x.p === p) : undefined);
export const byMember = (g: Game, m: string): Player | undefined => g.players.find((x) => x.m === m);

export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

/**
 * Someone said hello: a new player, or one coming back (same player id, a new connection) — who keeps
 * their score. A member id moves to the newest player that claims it.
 */
export function join(g: Game, who: { p: string; m: string; name: string }): Game {
  const name = cleanName(who.name) || "?";
  const known = g.players.find((x) => x.p === who.p);
  if (known && known.m === who.m && known.name === name) return g;
  const players = g.players.map((x) => (x.m === who.m && x.p !== who.p ? { ...x, m: null } : x));
  if (known) return bump(g, { players: players.map((x) => (x.p === who.p ? { ...x, m: who.m, name } : x)) });
  return bump(g, { players: [...players, { p: who.p, m: who.m, name, score: 0 }] });
}

/** A connection went. Their player stays on the board, away; the drawer's going ends the turn. */
export function drop(g: Game, m: string, now: number): Game {
  const gone = byMember(g, m);
  if (!gone) return g;
  let next = bump(g, { players: g.players.map((x) => (x.m === m ? { ...x, m: null } : x)) });
  if ((g.phase === "pick" || g.phase === "draw") && g.drawer === gone.p) next = endTurn(next, g.turn, { word: null, by: null, left: 0, why: "left" }, now);
  else if (g.phase !== "lobby" && g.phase !== "final" && online(next).length < MIN_PLAYERS) next = finish(next);
  return next;
}

/** The host's choices in the lobby. Anything out of range is ignored. */
export function settings(g: Game, s: { rounds?: number; seconds?: number; lang?: Lang }): Game {
  if (g.phase !== "lobby") return g;
  const rounds = s.rounds !== undefined && (ROUNDS as readonly number[]).includes(s.rounds) ? s.rounds : g.rounds;
  const seconds = s.seconds !== undefined && (SECONDS as readonly number[]).includes(s.seconds) ? s.seconds : g.seconds;
  const lang = s.lang ?? g.lang;
  if (rounds === g.rounds && seconds === g.seconds && lang === g.lang) return g;
  return bump(g, { rounds, seconds, lang });
}

export const canStart = (g: Game): boolean => g.phase === "lobby" && online(g).length >= MIN_PLAYERS;

/** Everyone's score back to nothing, and the first turn. */
export function start(g: Game, now: number): Game {
  if (!canStart(g)) return g;
  const fresh = bump(g, { players: g.players.filter((x) => x.m !== null).map((x) => ({ ...x, score: 0 })), round: 1, drawn: [], used: [], last: null });
  return nextTurn(fresh, now);
}

/**
 * Whose turn next: the first player, in the order they came in, who is here and has not drawn this
 * round. When everyone has, the next round; after the last round, the end.
 */
export function nextTurn(g: Game, now: number): Game {
  if (online(g).length < MIN_PLAYERS) return finish(g);
  const pick = (drawn: readonly string[]) => g.players.find((x) => x.m !== null && !drawn.includes(x.p));
  let round = g.round;
  let drawn = g.drawn;
  let drawer = pick(drawn);
  if (!drawer) {
    if (round >= g.rounds) return finish(g);
    round += 1;
    drawn = [];
    drawer = pick(drawn);
  }
  if (!drawer) return finish(g);
  return bump(g, { phase: "pick", round, drawn, drawer: drawer.p, turn: g.turn + 1, ends: now + PICK_MS, mask: "" });
}

/** The drawer chose a word: the turn's clock starts, and guessers see how many letters it has. */
export function drawing(g: Game, turn: number, mask: string, now: number): Game {
  if (g.phase !== "pick" || g.turn !== turn) return g;
  return bump(g, { phase: "draw", ends: now + g.seconds * 1000, mask });
}

/** A hint letter shown: only ever a mask of the same length, during the turn it belongs to. */
export function hint(g: Game, turn: number, mask: string): Game {
  if (g.phase !== "draw" || g.turn !== turn || mask.length !== g.mask.length || mask === g.mask) return g;
  return bump(g, { mask });
}

/** Points for guessing it with `left` (0–1) of the turn to go: 50 at the buzzer, up to 100 at once. */
export const guesserPoints = (left: number): number => 50 + Math.round(50 * Math.min(1, Math.max(0, left)));
/** The drawer's share: half the guesser's, so a drawing that is guessed quickly pays both. */
export const drawerPoints = (left: number): number => Math.round(guesserPoints(left) / 2);

/** How the turn ended, from the drawer (or the host, when the drawer went quiet or left). */
export function endTurn(g: Game, turn: number, end: { word: string | null; by: string | null; left: number; why: Reveal["why"]; row?: number }, now: number): Game {
  if ((g.phase !== "pick" && g.phase !== "draw") || g.turn !== turn || !g.drawer) return g;
  const drawer = g.drawer;
  const by = end.by && end.by !== drawer && playerOf(g, end.by) ? end.by : null;
  const gained: Record<string, number> = {};
  if (by) {
    gained[by] = guesserPoints(end.left);
    gained[drawer] = drawerPoints(end.left);
  }
  const players = g.players.map((x) => (gained[x.p] ? { ...x, score: x.score + gained[x.p]! } : x));
  const used = end.row !== undefined && Number.isInteger(end.row) && !g.used.includes(end.row) ? [...g.used, end.row] : g.used;
  return bump(g, {
    phase: "reveal",
    players,
    drawn: g.drawn.includes(drawer) ? g.drawn : [...g.drawn, drawer],
    ends: now + REVEAL_MS,
    last: { word: end.word, by, gained, why: by ? "guessed" : end.why, drawer },
    used,
  });
}

/** The game is over: final scores. */
export function finish(g: Game): Game {
  if (g.phase === "final" || g.phase === "lobby") return g;
  return bump(g, { phase: "final", drawer: null, mask: "", ends: 0 });
}

/** Back to the lobby with everyone who is still here, for another game. */
export function again(g: Game): Game {
  return bump(g, { phase: "lobby", players: g.players.filter((x) => x.m !== null).map((x) => ({ ...x, score: 0 })), round: 0, drawn: [], drawer: null, mask: "", last: null, ends: 0 });
}

/**
 * The host's clock: what happens when the current phase runs out. A drawer who never chose is
 * skipped; a drawer who went quiet past the end of the turn is treated as gone; after the reveal,
 * the next turn.
 */
export function tick(g: Game, now: number): Game {
  if (g.phase === "pick" && now >= g.ends) return endTurn(g, g.turn, { word: null, by: null, left: 0, why: "skipped" }, now);
  if (g.phase === "draw" && now >= g.ends + GRACE_MS) return endTurn(g, g.turn, { word: null, by: null, left: 0, why: "time" }, now);
  if (g.phase === "reveal" && now >= g.ends) return nextTurn(g, now);
  return g;
}

/** When `tick` next has something to do, or null. */
export function nextDeadline(g: Game): number | null {
  if (g.phase === "pick" || g.phase === "reveal") return g.ends;
  if (g.phase === "draw") return g.ends + GRACE_MS;
  return null;
}

/**
 * A new host takes over: the old host's connection is gone, along with anyone else who left while
 * nobody was hosting. Everything else carries on from the last snapshot.
 */
export function takeOver(g: Game, present: readonly string[], now: number): Game {
  let next = bump(g, {});
  for (const x of g.players) if (x.m !== null && !present.includes(x.m)) next = drop(next, x.m, now);
  return next;
}

/** Players by score, best first; ties keep the order they came in. */
export function standings(g: Game): Player[] {
  return g.players.map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i).map((e) => e.x);
}
