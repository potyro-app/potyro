// Live connections inside the realm (docs/28 §4): the sealed app's `Socket` and `Room`, as proxies.
//
// The connection is the host's (socket-bridge.ts); here is a number for it and the app's callbacks.
// Events arrive on the app's port in order (`{ t: "sock" }`); each one handed to an `onMessage` is
// acked, which is what lets the host send more. Messages that arrive before the app listens are held
// — the host's window bounds how many — and handed to the first `onMessage`, as in a trusted app.
//
// Nothing here is trusted by the host: app code shares this realm and may rewrite it all. It can
// only ever name its own connections, and every send is checked again on the host.

import type { Room, RoomMember, RoomPresence, Socket, SocketClose, SocketData } from "potyro";
import type { Transport } from "./port-transport.js";
import type { Op } from "./protocol.js";

/** What the host sends for one connection (socket-bridge.ts `BoxSocketEvent`). */
export type RealmSocketEvent =
  | { sid: number; kind: "message"; data: SocketData }
  | { sid: number; kind: "presence"; type: "join" | "leave"; member: RoomMember }
  | { sid: number; kind: "close"; code: number; reason: string; why: SocketClose["why"] };

export interface RealmSocketInfo {
  sid: number;
  url: string;
  protocol: string;
  room?: { id: string; me: RoomMember; members: RoomMember[] };
}

type Call = (op: Op, ...args: unknown[]) => Promise<unknown>;

const live = new Map<number, RealmSocket>();

const sizeOf = (d: SocketData): number => (typeof d === "string" ? d.length : d.byteLength);

function warn(where: string, e: unknown): void {
  console.warn(`${where} threw:`, e);
}

class RealmSocket implements Socket {
  readyState: "open" | "closing" | "closed" = "open";
  readonly url: string;
  readonly protocol: string;
  private messageCbs: Array<(d: SocketData) => void> = [];
  private closeCbs: Array<(c: SocketClose) => void> = [];
  protected presenceCbs: Array<(e: RoomPresence) => void> = [];
  private held: SocketData[] = [];
  private closedWith: SocketClose | null = null;

  constructor(
    readonly sid: number,
    info: RealmSocketInfo,
    private readonly call: Call,
    private readonly tx: Transport,
  ) {
    this.url = info.url;
    this.protocol = info.protocol;
  }

  event(ev: RealmSocketEvent): void {
    if (ev.kind === "message") {
      if (!this.messageCbs.length) {
        this.held.push(ev.data);
        return;
      }
      this.give(ev.data);
      this.tx.ack(this.sid, 1, sizeOf(ev.data));
      return;
    }
    if (ev.kind === "presence") return this.presence(ev);
    this.finish({ code: Number(ev.code), reason: String(ev.reason ?? ""), why: ev.why });
  }

  protected presence(_ev: Extract<RealmSocketEvent, { kind: "presence" }>): void {}

  private give(d: SocketData): void {
    for (const cb of [...this.messageCbs]) {
      try {
        cb(d);
      } catch (e) {
        warn("a socket's onMessage", e);
      }
    }
  }

  private finish(c: SocketClose): void {
    if (this.closedWith) return;
    this.closedWith = c;
    this.readyState = "closed";
    live.delete(this.sid);
    this.held = [];
    for (const cb of this.closeCbs.splice(0)) {
      try {
        cb(c);
      } catch (e) {
        warn("a socket's onClose", e);
      }
    }
    this.messageCbs = [];
    this.presenceCbs = [];
  }

  async send(data: SocketData): Promise<void> {
    if (typeof data !== "string" && !(data instanceof Uint8Array)) throw new TypeError("send takes a string or a Uint8Array");
    if (this.readyState !== "open") throw Object.assign(new Error("The connection is not open"), { code: "closed" });
    await this.call("caps.network.socket.send", this.sid, data);
  }

  onMessage(cb: (data: SocketData) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onMessage takes a function");
    if (this.closedWith) return () => {};
    this.messageCbs.push(cb);
    if (this.held.length) {
      const held = this.held;
      this.held = [];
      queueMicrotask(() => {
        for (const d of held) {
          try {
            cb(d);
          } catch (e) {
            warn("a socket's onMessage", e);
          }
        }
        this.tx.ack(this.sid, held.length, held.reduce((n, d) => n + sizeOf(d), 0));
      });
    }
    return () => {
      this.messageCbs = this.messageCbs.filter((x) => x !== cb);
    };
  }

  onClose(cb: (close: SocketClose) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onClose takes a function");
    const done = this.closedWith;
    if (done) {
      queueMicrotask(() => cb(done));
      return () => {};
    }
    this.closeCbs.push(cb);
    return () => {
      this.closeCbs = this.closeCbs.filter((x) => x !== cb);
    };
  }

  close(code?: number, reason?: string): void {
    if (this.readyState !== "open") return;
    this.readyState = "closing";
    void this.call("caps.network.socket.close", this.sid, code == null ? undefined : Number(code), reason == null ? undefined : String(reason)).catch(() => {});
  }
}

class RealmRoom extends RealmSocket implements Room {
  readonly id: string;
  me: RoomMember;
  members: RoomMember[];

  constructor(sid: number, info: RealmSocketInfo, call: Call, tx: Transport) {
    super(sid, info, call, tx);
    this.id = info.room!.id;
    this.me = { ...info.room!.me };
    this.members = info.room!.members.map((m) => ({ ...m }));
  }

  protected override presence(ev: Extract<RealmSocketEvent, { kind: "presence" }>): void {
    const member = { id: String(ev.member?.id ?? ""), name: String(ev.member?.name ?? "") };
    this.members = ev.type === "join" ? [...this.members.filter((m) => m.id !== member.id), member] : this.members.filter((m) => m.id !== member.id);
    for (const cb of [...this.presenceCbs]) {
      try {
        cb({ type: ev.type, member });
      } catch (e) {
        warn("a room's onPresence", e);
      }
    }
  }

  onPresence(cb: (event: RoomPresence) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onPresence takes a function");
    if (this.readyState === "closed") return () => {};
    this.presenceCbs.push(cb);
    return () => {
      this.presenceCbs = this.presenceCbs.filter((x) => x !== cb);
    };
  }
}

/** A connection the host opened for this realm, as the app holds it. */
export function realmSocket(info: RealmSocketInfo, call: Call, tx: Transport): RealmSocket | RealmRoom {
  const s = info.room ? new RealmRoom(Number(info.sid), info, call, tx) : new RealmSocket(Number(info.sid), info, call, tx);
  live.set(s.sid, s);
  return s;
}

/** One event from the host, to the connection it names. */
export function dispatchSocketEvent(ev: RealmSocketEvent): void {
  live.get(Number(ev?.sid))?.event(ev);
}
