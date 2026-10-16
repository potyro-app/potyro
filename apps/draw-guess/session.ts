// One device in one game: the room connection, the roles it plays (host, drawer, guesser) and the
// state every screen reads. No DOM, no `ctx` — the room is opened through `open`, time comes from
// `clock` — so three devices, a host leaving and a reconnect run in a unit test over an in-memory
// relay (test/session.test.ts), and the app wires it to `ctx.caps.network.room` (draw-guess.app.ts).
//
// Who decides what (game.ts has the rules):
//   - the HOST is the oldest connection in the room — every device works it out from the relay's
//     presence, which reaches everyone in the same order, so nobody has to be told. It keeps the game
//     and sends it whole (`st`) whenever it changes; when it leaves, the next oldest carries on from
//     the last snapshot it had.
//   - the DRAWER's device holds the word, offers three, judges each guess, shows the hint letters on
//     time and says how the turn ended (`end`). A guess reaches every device (the room is one
//     channel), but no device shows it until the drawer has said it was wrong — so a right guess,
//     the word itself, is never on a guesser's screen before the turn is over.
//   - every device keeps the turn's drawing (sketch.ts); the drawer sends a late joiner the drawing
//     so far (`snap`).
import { decode, encode, fromWireGame, MAX_GUESS, MAX_PIECE, toWireGame, type Msg } from "./protocol.js";
import * as G from "./game.js";
import type { Game } from "./game.js";
import { addClear, addPiece, emptySketch, fromWire, lastOp, packPoints, toWire, undo as undoOp, unpackPoints, type Sketch } from "./sketch.js";
import { blankMask, chooseWords, hintPlan, judge, wordAt, type Hint, type Lang } from "./words.js";
import { roomIdFor } from "./code.js";

// ---- what the session needs from outside ----

export interface RoomMemberLike {
  id: string;
  name: string;
}
export interface RoomCloseLike {
  code: number;
  reason: string;
  why: string;
}
/** The part of `ctx.caps.network.room()`'s Room this uses. */
export interface RoomLike {
  readonly me: RoomMemberLike;
  readonly members: readonly RoomMemberLike[];
  send(data: string): Promise<void>;
  onMessage(cb: (data: string | Uint8Array) => void): () => void;
  onPresence(cb: (e: { type: "join" | "leave"; member: RoomMemberLike }) => void): () => void;
  onClose(cb: (c: RoomCloseLike) => void): () => void;
  close(): void;
}
export type OpenRoom = (roomId: string, name: string) => Promise<RoomLike>;

export interface Clock {
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}
export const realClock: Clock = {
  now: () => Date.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ---- what the screens read ----

export type Status =
  /** Opening the room. */
  | "connecting"
  /** In the room, waiting for the host's game. */
  | "joining"
  | "live"
  /** The connection dropped; trying again. */
  | "reconnecting"
  /** Potyro closed it because the person left the app or it was in the background: Rejoin. */
  | "away"
  /** Could not get in (`problem` says why). */
  | "failed"
  /** The person left the game. */
  | "ended";

export type Problem = "nobody" | "full" | "offline" | "unreachable" | "denied" | "refused" | "idle" | "unavailable";

export type FeedItem =
  | { kind: "guess"; p: string; text: string }
  | { kind: "close"; text: string }
  | { kind: "got"; p: string }
  | { kind: "joined"; name: string }
  | { kind: "left"; name: string };

/** The drawer's own secret, on the drawer's device only. */
export interface Mine {
  turn: number;
  /** Rows of words.ts offered. */
  choices: number[];
  /** The row chosen, once chosen. */
  row: number | null;
  word: string | null;
  lang: Lang;
  /** When the drawer's clock started (this device's time). */
  started: number;
  plan: Hint[];
  over: boolean;
}

export type Change = "status" | "game" | "sketch" | "feed" | "mine" | "host";

export const PIECE_MS = 50;
export const AUTO_PICK_MS = G.PICK_MS - 3_000;
const GUESS_GAP_MS = 300;
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const MAX_FEED = 60;

export interface SessionOptions {
  open: OpenRoom;
  clock?: Clock;
  random?: () => number;
  /** A new id for this player (crypto-random in the app). */
  newId: () => string;
  /** The words' language of a game this device starts: the person's own. */
  lang?: Lang;
}

export class Session {
  readonly code: string;
  readonly p: string;
  name: string;
  status: Status = "connecting";
  problem: Problem | null = null;
  /** My connection's id now. */
  me = "";
  /** Every connection in the room, oldest first, me included. */
  present: string[] = [];
  host = "";
  game: Game | null = null;
  sketch: Sketch = emptySketch();
  /** The turn `sketch` belongs to. */
  sketchTurn = -1;
  feed: FeedItem[] = [];
  mine: Mine | null = null;
  /** My guesses waiting for the drawer's verdict, by id. */
  pending = new Map<number, string>();

  private room: RoomLike | null = null;
  private offs: Array<() => void> = [];
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly open: OpenRoom;
  private readonly lang: Lang;
  /** The host whose snapshot I hold: a new host's first snapshot is taken whatever its number. */
  private adoptedFrom = "";
  private readonly listeners = new Set<(c: Change) => void>();
  private hostTimer: unknown = null;
  private drawerTimers: unknown[] = [];
  private retry = 0;
  private retryTimer: unknown = null;
  private wanted = true;
  private lastGuess = -Infinity;
  private guessId = 0;
  private opId = 0;
  private pen: { s: number; q: number; c: number; w: number; pts: number[]; timer: unknown } | null = null;

  constructor(code: string, name: string, o: SessionOptions) {
    this.code = code;
    this.name = G.cleanName(name);
    this.p = o.newId();
    this.open = o.open;
    this.clock = o.clock ?? realClock;
    this.random = o.random ?? Math.random;
    this.lang = o.lang ?? "en";
  }

  // ---- listening ----

  subscribe(cb: (c: Change) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(c: Change): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(c);
      } catch (e) {
        console.warn("[draw-guess] a screen failed to follow the game:", e);
      }
    }
  }

  // ---- who is who ----

  get isHost(): boolean {
    return this.host !== "" && this.host === this.me;
  }
  get isDrawer(): boolean {
    return !!this.game && this.game.drawer === this.p && (this.game.phase === "pick" || this.game.phase === "draw");
  }
  /** The name for a player id, as the game knows it. */
  nameOf(p: string | null): string {
    return (p && this.game ? G.playerOf(this.game, p)?.name : undefined) ?? "?";
  }
  /** The player whose connection is the host's. */
  get hostPlayer(): string | null {
    return this.game ? (G.byMember(this.game, this.host)?.p ?? null) : null;
  }

  // ---- connecting ----

  /**
   * Open the room. `fresh`: the person is starting a new game, so an empty room is theirs. Joining by
   * code, an empty room means there is no game with that code (any more): it says so and leaves.
   */
  async connect(fresh: boolean): Promise<void> {
    this.wanted = true;
    this.setStatus(this.game ? "reconnecting" : "connecting");
    let room: RoomLike;
    try {
      room = await this.open(roomIdFor(this.code), this.name);
    } catch (e) {
      this.failed(e, fresh);
      return;
    }
    if (!this.wanted) {
      room.close();
      return;
    }
    if (!fresh && !this.game && room.members.length === 0) {
      room.close();
      this.problem = "nobody";
      this.setStatus("failed");
      return;
    }
    this.attach(room);
  }

  private failed(e: unknown, fresh: boolean): void {
    const code = String((e as { code?: unknown })?.code ?? "");
    const reason = String((e as { message?: unknown })?.message ?? "");
    const retryable = code === "offline" || code === "unreachable";
    if (this.game && retryable) return this.scheduleRetry(fresh);
    this.problem =
      code === "offline" || code === "unreachable" || code === "denied"
        ? code
        : code === "refused" && /full/i.test(reason)
          ? "full"
          : code === "refused"
            ? "refused"
            : "unavailable";
    this.setStatus("failed");
  }

  private scheduleRetry(fresh: boolean): void {
    if (!this.wanted) return;
    if (this.retry >= RETRY_MS.length) {
      this.problem = "unreachable";
      this.setStatus("failed");
      return;
    }
    this.setStatus("reconnecting");
    const wait = RETRY_MS[this.retry++]!;
    this.retryTimer = this.clock.later(() => void this.connect(fresh), wait);
  }

  private attach(room: RoomLike): void {
    this.detach();
    this.room = room;
    this.retry = 0;
    this.me = room.me.id;
    this.present = [...room.members.map((m) => m.id), room.me.id];
    this.offs = [
      room.onMessage((d) => {
        if (typeof d !== "string") return;
        const msg = decode(d);
        if (msg) this.receive(msg);
      }),
      room.onPresence((e) => (e.type === "join" ? this.joined(e.member) : this.left(e.member))),
      room.onClose((c) => this.closed(room, c)),
    ];
    this.setStatus(this.game ? "live" : "joining");
    const before = this.host;
    this.host = this.present[0]!;
    if (this.isHost) this.becomeHost();
    else this.hello();
    this.emit("host");
  }

  private detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.room = null;
  }

  private closed(room: RoomLike, c: RoomCloseLike): void {
    if (room !== this.room) return;
    this.detach();
    this.stopPen();
    if (!this.wanted || c.why === "app") return;
    if (c.why === "left" || c.why === "hidden") {
      this.setStatus("away");
      return;
    }
    if (c.why === "server" && c.code === 4007) {
      this.problem = "idle";
      this.setStatus("failed");
      return;
    }
    this.scheduleRetry(false);
  }

  /** Back in after Potyro closed the room (the person left the app, or it was in the background). */
  rejoin(): Promise<void> {
    this.retry = 0;
    return this.connect(false);
  }

  /** Leave the game for good. */
  leave(): void {
    this.wanted = false;
    if (this.retryTimer) this.clock.cancel(this.retryTimer);
    this.stopTimers();
    this.stopPen();
    const room = this.room;
    this.detach();
    room?.close();
    this.setStatus("ended");
  }

  private setStatus(s: Status): void {
    if (s === "live" || s === "joining" || s === "connecting" || s === "reconnecting") this.problem = s === "reconnecting" ? this.problem : null;
    this.status = s;
    this.emit("status");
  }

  // ---- sending ----

  /** To everyone else, and handled here as if it had come back: one path for what I say and what I hear. */
  private say(msg: Msg): void {
    const room = this.room;
    if (room) {
      let text: string;
      try {
        text = encode(msg);
      } catch (e) {
        console.warn("[draw-guess]", e);
        return;
      }
      void room.send(text).catch(() => undefined); // closed or full: the room's close or the next snapshot says the rest
    }
    this.receive(msg);
  }

  /** To one late joiner only (others drop it), not handled here. */
  private tell(msg: Msg): void {
    void this.room?.send(encode(msg)).catch(() => undefined);
  }

  private hello(): void {
    this.say({ t: "hi", m: this.me, p: this.p, n: this.name });
  }

  // ---- presence ----

  private joined(member: RoomMemberLike): void {
    if (!this.present.includes(member.id)) this.present = [...this.present, member.id];
  }

  private left(member: RoomMemberLike): void {
    this.present = this.present.filter((id) => id !== member.id);
    const gone = this.game ? G.byMember(this.game, member.id) : undefined;
    if (gone) this.push({ kind: "left", name: gone.name });
    const before = this.host;
    this.host = this.present[0] ?? this.me;
    if (this.isHost && before !== this.me) this.becomeHost();
    else if (this.isHost && this.game) this.setGame(G.drop(this.game, member.id, this.clock.now()));
    else if (before !== this.host) this.hello(); // a new host: make sure it knows me
    if (before !== this.host) this.emit("host");
  }

  /** I am the oldest here now: a new game, or the old host's, carried on. */
  private becomeHost(): void {
    const now = this.clock.now();
    if (!this.game) this.setGame(G.newGame({ p: this.p, m: this.me, name: this.name }, this.lang));
    else this.setGame(G.join(G.takeOver(this.game, this.present, now), { p: this.p, m: this.me, name: this.name }));
  }

  // ---- the host's side ----

  private setGame(g: Game): void {
    if (!this.isHost) return;
    if (this.game && g === this.game) return;
    this.say({ t: "st", h: this.me, g: toWireGame(g, this.clock.now()) });
  }

  private hostClock(): void {
    if (this.hostTimer) this.clock.cancel(this.hostTimer);
    this.hostTimer = null;
    if (!this.isHost || !this.game) return;
    const at = G.nextDeadline(this.game);
    if (at === null) return;
    this.hostTimer = this.clock.later(() => {
      this.hostTimer = null;
      if (this.isHost && this.game) this.setGame(G.tick(this.game, this.clock.now()));
    }, Math.max(0, at - this.clock.now()) + 5);
  }

  /** Host only: the lobby's choices. */
  configure(s: { rounds?: number; seconds?: number; lang?: Lang }): void {
    if (this.isHost && this.game) this.setGame(G.settings(this.game, s));
  }
  start(): void {
    if (this.isHost && this.game) this.setGame(G.start(this.game, this.clock.now()));
  }
  playAgain(): void {
    if (this.isHost && this.game && this.game.phase === "final") this.setGame(G.again(this.game));
  }

  // ---- everything that arrives ----

  private receive(msg: Msg): void {
    const now = this.clock.now();
    switch (msg.t) {
      case "hi": {
        if (this.isHost && this.game && this.present.includes(msg.m)) {
          const before = this.game;
          const g = G.join(this.game, { p: msg.p, m: msg.m, name: msg.n });
          if (g !== before && !G.playerOf(before, msg.p) && msg.m !== this.me) this.push({ kind: "joined", name: G.cleanName(msg.n) });
          // Always sent: whoever said hello needs the game, changed or not.
          this.say({ t: "st", h: this.me, g: toWireGame(g === before ? { ...g, v: g.v + 1 } : g, now) });
        } else if (this.game && !this.isHost && !G.playerOf(this.game, msg.p) && msg.m !== this.me) {
          this.push({ kind: "joined", name: G.cleanName(msg.n) });
        }
        if (this.isDrawer && msg.m !== this.me) this.sendDrawing(msg.m);
        return;
      }
      case "st":
        return this.adopt(msg.h, fromWireGame(msg.g, now));
      case "go":
        if (this.isHost && this.game) this.setGame(G.drawing(this.game, msg.k, msg.mask, now));
        return;
      case "hint":
        if (this.isHost && this.game) this.setGame(G.hint(this.game, msg.k, msg.mask));
        return;
      case "end":
        if (this.isHost && this.game) this.setGame(G.endTurn(this.game, msg.k, { word: msg.word, by: msg.by, left: msg.left, why: msg.by ? "guessed" : "time", row: msg.row }, now));
        return;
      case "d":
        if (!this.onTurn(msg.k)) return;
        this.sketch = addPiece(this.sketch, { s: msg.s, q: msg.q, c: msg.c, w: msg.w, pts: unpackPoints(msg.p), end: msg.e === 1 });
        this.emit("sketch");
        return;
      case "u":
        if (!this.onTurn(msg.k)) return;
        this.sketch = undoOp(this.sketch, msg.s);
        this.emit("sketch");
        return;
      case "x":
        if (!this.onTurn(msg.k)) return;
        this.sketch = addClear(this.sketch, msg.s);
        this.emit("sketch");
        return;
      case "snap":
        if (msg.to !== this.me || !this.onTurn(msg.k)) return;
        this.sketch = fromWire(this.sketch, msg.ops);
        this.emit("sketch");
        return;
      case "g":
        return this.judgeGuess(msg);
      case "v":
        return this.verdict(msg);
    }
  }

  /** A message about turn `k`: the drawing it belongs to, started fresh when the turn is new. */
  private onTurn(k: number): boolean {
    if (!this.game || k !== this.game.turn) return false;
    return true;
  }

  private adopt(from: string, g: Game): void {
    if (from !== this.host) return;
    if (this.game && from === this.adoptedFrom && from !== this.me && g.v <= this.game.v) return;
    this.adoptedFrom = from;
    const prev = this.game;
    this.game = g;
    if (g.turn !== this.sketchTurn) {
      this.sketch = emptySketch();
      this.sketchTurn = g.turn;
      this.pending.clear();
      this.emit("sketch");
    }
    if (prev && prev.turn !== g.turn) this.feed = [];
    if (this.status === "joining" || this.status === "reconnecting" || this.status === "connecting") this.setStatus("live");
    this.drawerRole(g);
    this.hostClock();
    this.emit("game");
  }

  // ---- the drawer's side ----

  private drawerRole(g: Game): void {
    const mineNow = g.drawer === this.p && (g.phase === "pick" || g.phase === "draw");
    if (!mineNow) {
      if (this.mine) {
        this.mine = null;
        this.stopTimers();
        this.stopPen();
        this.emit("mine");
      }
      return;
    }
    if (this.mine && this.mine.turn === g.turn) return;
    // A new turn of mine. (After a reconnect into a turn that was mine, there is no word any more:
    // the host ends it when its clock runs out.)
    if (g.phase !== "pick") return;
    this.stopTimers();
    this.opId = 0;
    this.mine = { turn: g.turn, choices: chooseWords(3, g.used, this.random), row: null, word: null, lang: g.lang, started: 0, plan: [], over: false };
    this.drawerTimers.push(this.clock.later(() => this.mine && this.mine.row === null && this.choose(0), AUTO_PICK_MS));
    this.emit("mine");
  }

  /** The drawer picks one of the three words; the turn's clock starts now. */
  choose(i: number): void {
    const m = this.mine;
    if (!m || m.row !== null || !this.game || this.game.turn !== m.turn) return;
    const row = m.choices[i] ?? m.choices[0]!;
    const word = wordAt(m.lang, row);
    const ms = this.game.seconds * 1000;
    this.mine = { ...m, row, word, started: this.clock.now(), plan: hintPlan(word, ms, this.random) };
    this.stopTimers();
    for (const h of this.mine.plan) this.drawerTimers.push(this.clock.later(() => this.mine?.turn === m.turn && !this.mine.over && this.say({ t: "hint", k: m.turn, mask: h.mask }), h.at));
    this.drawerTimers.push(this.clock.later(() => this.finishTurn(null, 0), ms));
    this.say({ t: "go", k: m.turn, mask: blankMask(word) });
    this.emit("mine");
  }

  private finishTurn(by: string | null, left: number): void {
    const m = this.mine;
    if (!m || m.over || m.word === null || m.row === null) return;
    this.mine = { ...m, over: true };
    this.stopTimers();
    this.stopPen();
    this.say({ t: "end", k: m.turn, word: m.word, by, left, row: m.row });
  }

  private judgeGuess(msg: Extract<Msg, { t: "g" }>): void {
    const m = this.mine;
    if (!m || m.over || m.word === null || msg.k !== m.turn || msg.p === this.p) return;
    const r = judge(m.word, msg.text, m.lang);
    this.say({ t: "v", k: msg.k, p: msg.p, id: msg.id, r, ...(r === "no" ? { text: msg.text } : {}) });
    if (r === "yes") {
      const ms = (this.game?.seconds ?? 80) * 1000;
      const left = Math.max(0, Math.min(1, 1 - (this.clock.now() - m.started) / ms));
      this.finishTurn(msg.p, Math.round(left * 1000) / 1000);
    }
  }

  private verdict(msg: Extract<Msg, { t: "v" }>): void {
    if (!this.game || msg.k !== this.game.turn) return;
    if (msg.p === this.p) this.pending.delete(msg.id);
    if (msg.r === "no" && msg.text !== undefined) this.push({ kind: "guess", p: msg.p, text: msg.text });
    else if (msg.r === "close" && msg.p === this.p) this.push({ kind: "close", text: this.pendingText(msg.id) });
    else if (msg.r === "yes") this.push({ kind: "got", p: msg.p });
    else this.emit("feed");
  }

  /** What I guessed, by id: a "close" verdict does not repeat it, so it is looked up here. */
  private sentGuesses = new Map<number, string>();
  private pendingText(id: number): string {
    return this.sentGuesses.get(id) ?? "";
  }

  /** The drawing so far, to a late joiner (or someone back after a reconnect). */
  private sendDrawing(to: string): void {
    if (!this.game) return;
    for (const ops of toWire(this.sketch)) this.tell({ t: "snap", to, k: this.game.turn, ops });
  }

  // ---- drawing (the drawer's device) ----

  get canDraw(): boolean {
    return !!this.mine && this.mine.row !== null && !this.mine.over && !!this.game && this.game.phase === "draw";
  }

  /** A finger or the mouse went down at board point (x, y). */
  penDown(c: number, w: number, x: number, y: number): void {
    if (!this.canDraw) return;
    this.stopPen();
    const s = ++this.opId;
    this.pen = { s, q: 0, c, w, pts: [Math.round(x), Math.round(y)], timer: null };
    this.local();
    this.pen.timer = this.clock.later(() => this.flushPen(false), PIECE_MS);
  }

  /** More points of the stroke under way. Points closer than a unit and a half to the last are dropped. */
  penMove(points: ReadonlyArray<readonly [number, number]>): void {
    const pen = this.pen;
    if (!pen || !this.canDraw) return;
    let changed = false;
    for (const [x, y] of points) {
      const lx = pen.pts.at(-2);
      const ly = pen.pts.at(-1);
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (lx !== undefined && ly !== undefined && Math.hypot(rx - lx, ry - ly) < 1.5) continue;
      pen.pts.push(rx, ry);
      changed = true;
      // A piece never outgrows what a receiver accepts (MAX_PIECE): a fast pen sends early.
      if (pen.pts.length >= MAX_PIECE - 2) {
        this.local();
        this.flushPen(false);
        changed = false;
      }
    }
    if (changed) this.local();
  }

  penUp(): void {
    if (this.pen) this.flushPen(true);
  }

  /** The stroke under way, on my own board at once (the others get it every 50 ms). */
  private local(): void {
    const pen = this.pen!;
    this.sketch = addPiece(this.sketch, { s: pen.s, q: pen.q, c: pen.c, w: pen.w, pts: pen.pts.slice() });
    this.emit("sketch");
  }

  private flushPen(end: boolean): void {
    const pen = this.pen;
    if (!pen || !this.game) return;
    if (pen.timer) this.clock.cancel(pen.timer);
    pen.timer = null;
    const k = this.game.turn;
    if (pen.pts.length || end) {
      // Sent only to the others: my own board has these points already.
      const msg: Msg = { t: "d", k, s: pen.s, q: pen.q, c: pen.c, w: pen.w, p: packPoints(pen.pts), ...(end ? { e: 1 as const } : {}) };
      this.tell(msg);
      this.sketch = addPiece(this.sketch, { s: pen.s, q: pen.q, c: pen.c, w: pen.w, pts: pen.pts.slice(), end });
      pen.q += 1;
      pen.pts = [];
      if (end) this.emit("sketch");
    }
    if (end) this.pen = null;
    else pen.timer = this.clock.later(() => this.flushPen(false), PIECE_MS);
  }

  private stopPen(): void {
    if (this.pen?.timer) this.clock.cancel(this.pen.timer);
    this.pen = null;
  }

  undo(): void {
    if (!this.canDraw || this.pen || !this.game) return;
    const id = lastOp(this.sketch);
    if (id !== null) this.say({ t: "u", k: this.game.turn, s: id });
  }

  clear(): void {
    if (!this.canDraw || this.pen || !this.game) return;
    this.say({ t: "x", k: this.game.turn, s: ++this.opId });
  }

  // ---- guessing ----

  get canGuess(): boolean {
    return !!this.game && this.game.phase === "draw" && this.game.drawer !== this.p && !!G.playerOf(this.game, this.p);
  }

  /** A guess: off to the drawer's device. False when it was not sent (too soon, empty, not now). */
  guess(text: string): boolean {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_GUESS);
    const now = this.clock.now();
    if (!clean || !this.canGuess || !this.game || now - this.lastGuess < GUESS_GAP_MS) return false;
    this.lastGuess = now;
    const id = ++this.guessId;
    this.pending.set(id, clean);
    this.sentGuesses.set(id, clean);
    this.say({ t: "g", k: this.game.turn, p: this.p, id, text: clean });
    this.emit("feed");
    return true;
  }

  private push(item: FeedItem): void {
    this.feed = [...this.feed, item].slice(-MAX_FEED);
    this.emit("feed");
  }

  private stopTimers(): void {
    for (const t of this.drawerTimers) this.clock.cancel(t);
    this.drawerTimers = [];
  }
}
