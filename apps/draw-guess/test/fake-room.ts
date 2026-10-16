// An in-memory rooms relay with the real one's rules that matter here (docs/26): your own messages
// never come back, members are listed oldest first, a join/leave reaches everyone else, a reconnect
// is a new member id. Delivery is a queue the test drains (`run`), and time is a fake clock the test
// moves (`advance`), so a whole game plays out deterministically.
import type { Clock, RoomCloseLike, RoomLike, RoomMemberLike } from "../session.js";

type Event = () => void;

export class FakeClock implements Clock {
  t = 1_000_000;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  constructor(private readonly relay: FakeRelay) {}
  now(): number {
    return this.t;
  }
  later(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), fn, id });
    return id;
  }
  cancel(h: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  /** Move time on, firing every timer that comes due, in order, with the room drained after each. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
      this.relay.run();
    }
    this.t = end;
    this.relay.run();
  }
}

export class FakeRelay {
  private rooms = new Map<string, FakeConn[]>();
  private queue: Event[] = [];
  private nextId = 0;
  /** Every text frame sent, by whom, in order. */
  log: Array<{ from: string; text: string }> = [];
  /** Refuse the next opens with this error code. */
  refuse: string | null = null;

  open = async (roomId: string, name: string): Promise<RoomLike> => {
    if (this.refuse) {
      const e = new Error(this.refuse) as Error & { code: string };
      e.code = this.refuse;
      throw e;
    }
    const conn = new FakeConn(this, roomId, `m${++this.nextId}`, name);
    const list = this.rooms.get(roomId) ?? [];
    for (const other of list) this.enqueue(() => other.presence("join", conn.me));
    this.rooms.set(roomId, [...list, conn]);
    return conn;
  };

  members(conn: FakeConn): RoomMemberLike[] {
    return (this.rooms.get(conn.roomId) ?? []).filter((c) => c !== conn).map((c) => c.me);
  }

  enqueue(e: Event): void {
    this.queue.push(e);
  }

  send(from: FakeConn, text: string): void {
    this.log.push({ from: from.me.id, text });
    for (const other of this.rooms.get(from.roomId) ?? []) if (other !== from) this.enqueue(() => other.deliver(text));
  }

  remove(conn: FakeConn, why: string): void {
    const list = (this.rooms.get(conn.roomId) ?? []).filter((c) => c !== conn);
    this.rooms.set(conn.roomId, list);
    for (const other of list) this.enqueue(() => other.presence("leave", conn.me));
    conn.ended({ code: why === "app" ? 1000 : 1006, reason: "", why });
  }

  /** Deliver everything waiting, and whatever that causes. */
  run(): void {
    let guard = 0;
    while (this.queue.length) {
      if (++guard > 100_000) throw new Error("the room never went quiet");
      this.queue.shift()!();
    }
  }

  /** The open connection with this member id. */
  conn(id: string): FakeConn {
    for (const list of this.rooms.values()) for (const c of list) if (c.me.id === id) return c;
    throw new Error(`no connection ${id}`);
  }

  count(roomId: string): number {
    return this.rooms.get(roomId)?.length ?? 0;
  }
}

export class FakeConn implements RoomLike {
  readonly me: RoomMemberLike;
  private msgs: Array<(d: string) => void> = [];
  private pres: Array<(e: { type: "join" | "leave"; member: RoomMemberLike }) => void> = [];
  private closes: Array<(c: RoomCloseLike) => void> = [];
  private held: string[] = [];
  open = true;
  constructor(
    private readonly relay: FakeRelay,
    readonly roomId: string,
    id: string,
    name: string,
  ) {
    this.me = { id, name };
    this.snapshot = relay.members(this);
  }
  private snapshot: RoomMemberLike[];
  get members(): readonly RoomMemberLike[] {
    return this.open ? this.relay.members(this) : this.snapshot;
  }
  async send(data: string): Promise<void> {
    if (!this.open) throw Object.assign(new Error("closed"), { code: "closed" });
    this.relay.send(this, data);
  }
  onMessage(cb: (d: string) => void): () => void {
    this.msgs.push(cb);
    for (const d of this.held.splice(0)) cb(d);
    return () => (this.msgs = this.msgs.filter((x) => x !== cb));
  }
  onPresence(cb: (e: { type: "join" | "leave"; member: RoomMemberLike }) => void): () => void {
    this.pres.push(cb);
    return () => (this.pres = this.pres.filter((x) => x !== cb));
  }
  onClose(cb: (c: RoomCloseLike) => void): () => void {
    this.closes.push(cb);
    return () => (this.closes = this.closes.filter((x) => x !== cb));
  }
  close(): void {
    if (this.open) this.relay.remove(this, "app");
  }
  /** The network drops this connection (the others get its leave). */
  drop(why = "network"): void {
    if (this.open) this.relay.remove(this, why);
  }
  deliver(d: string): void {
    if (!this.open) return;
    if (!this.msgs.length) this.held.push(d);
    for (const cb of this.msgs) cb(d);
  }
  presence(type: "join" | "leave", member: RoomMemberLike): void {
    if (!this.open) return;
    for (const cb of this.pres) cb({ type, member });
  }
  ended(c: RoomCloseLike): void {
    this.open = false;
    for (const cb of this.closes.splice(0)) cb(c);
  }
}
