// A sealed app's live connections, carried into its box (docs/28 §4).
//
// The connection itself is the host's `HostSocket` (sockets.ts): opened by the page, mediated like a
// trusted app's. A sealed app holds only a number for it, `sid`, in its box — the browser realm's
// worker, over its MessagePort, or QuickJS, over the JSON bridge (bytes as base64 there). This class
// owns that table and the flow control between the two:
//
//   - every event (a message, a presence change, the close) goes to the box in order;
//   - at most `WINDOW_EVENTS` events / `WINDOW_BYTES` bytes are in the box untaken — handed over but
//     not yet given to an `onMessage` the app registered — and the box acks each one it hands on;
//   - what waits beyond that window is bounded by `SOCKET_LIMITS.receiveBufferBytes`: an app that
//     does not keep up has its connection closed (`"slow"`) rather than the page's memory filled.

import type { Ctx, Room, RoomMember, RoomOptions, Socket, SocketCloseWhy, SocketData, SocketOptions } from "potyro";
import { HostRoom, HostSocket, SOCKET_LIMITS, SocketError } from "./sockets.js";

export type BoxSocketEvent =
  | { sid: number; kind: "message"; data: SocketData }
  | { sid: number; kind: "presence"; type: "join" | "leave"; member: RoomMember }
  | { sid: number; kind: "close"; code: number; reason: string; why: SocketCloseWhy };

/** What the box learns when a connection opens. */
export interface BoxSocketInfo {
  sid: number;
  url: string;
  protocol: string;
  room?: { id: string; me: RoomMember; members: RoomMember[] };
}

/** Untaken events in the box at once, and their bytes. */
export const WINDOW_EVENTS = 64;
export const WINDOW_BYTES = 1024 * 1024;

interface Entry {
  s: HostSocket;
  queue: Array<{ ev: BoxSocketEvent; bytes: number }>;
  queuedBytes: number;
  inBox: number;
  inBoxBytes: number;
  closed: boolean;
  /** The box has its handle: until then events wait here, or they would reach a box that cannot name them. */
  ready: boolean;
}

const bytesOf = (ev: BoxSocketEvent): number =>
  ev.kind === "message" ? (typeof ev.data === "string" ? ev.data.length : ev.data.byteLength) : 64;

export class SocketBridge {
  private socks = new Map<number, Entry>();
  private seq = 0;

  /**
   * `deliver` hands one event into the box and says whether it was taken at once (given to the app's
   * callback). One that was not is acked later, through `ack`. `onGone` hears a sid that has ended.
   */
  constructor(
    private readonly deliver: (ev: BoxSocketEvent) => boolean,
    private readonly onGone?: (sid: number) => void,
  ) {}

  /** How many connections the box holds. */
  get size(): number {
    return this.socks.size;
  }

  async open(ctx: Ctx, url: string, opts?: SocketOptions): Promise<BoxSocketInfo> {
    const net = ctx.caps.network;
    if (!net?.socket) throw new SocketError("Permission denied: network", "not-allowed-host");
    return this.adopt(await net.socket(String(url), opts && { protocols: opts.protocols }));
  }

  async room(ctx: Ctx, id: string | undefined, opts?: RoomOptions): Promise<BoxSocketInfo> {
    const net = ctx.caps.network;
    if (!net?.room) throw new SocketError("Permission denied: network", "not-allowed-host");
    return this.adopt(await net.room(id == null ? undefined : String(id), opts && { name: opts.name == null ? undefined : String(opts.name) }));
  }

  private adopt(s: Socket | Room): BoxSocketInfo {
    if (!(s instanceof HostSocket)) throw new Error("socket bridge: not a host socket");
    const sid = ++this.seq;
    const entry: Entry = { s, queue: [], queuedBytes: 0, inBox: 0, inBoxBytes: 0, closed: false, ready: false };
    this.socks.set(sid, entry);
    s.onMessage((data) => this.push(sid, { sid, kind: "message", data }));
    const room = s instanceof HostRoom ? s : null;
    room?.onPresence((e) => this.push(sid, { sid, kind: "presence", type: e.type, member: { ...e.member } }));
    s.onClose((c) => this.push(sid, { sid, kind: "close", code: c.code, reason: c.reason, why: c.why }));
    return {
      sid,
      url: s.url,
      protocol: s.protocol,
      ...(room ? { room: { id: room.id, me: { ...room.me }, members: room.members.map((m) => ({ ...m })) } } : {}),
    };
  }

  private push(sid: number, ev: BoxSocketEvent): void {
    const e = this.socks.get(sid);
    if (!e || e.closed) return;
    const bytes = bytesOf(ev);
    if (ev.kind === "close") e.closed = true;
    else if (e.queuedBytes + bytes > SOCKET_LIMITS.receiveBufferBytes) {
      // The app is not keeping up: end it rather than hold the page's memory. What waits is dropped,
      // so its close is next in line rather than behind the very backlog it is about.
      e.queue = [];
      e.queuedBytes = 0;
      e.s.end(1008, "not reading fast enough", "slow");
      return;
    }
    e.queue.push({ ev, bytes });
    e.queuedBytes += bytes;
    this.pump(sid, e);
  }

  /** The box has been told about `sid` (its open answered): its events may go. */
  ready(sid: number): void {
    const e = this.socks.get(sid);
    if (!e || e.ready) return;
    e.ready = true;
    this.pump(sid, e);
  }

  private pump(sid: number, e: Entry): void {
    if (!e.ready) return;
    while (e.queue.length && (e.queue[0]!.ev.kind === "close" || (e.inBox < WINDOW_EVENTS && e.inBoxBytes + e.queue[0]!.bytes <= WINDOW_BYTES))) {
      const { ev, bytes } = e.queue.shift()!;
      e.queuedBytes -= bytes;
      let taken = true;
      try {
        taken = this.deliver(ev);
      } catch (err) {
        console.warn("[potyro] a socket event could not reach the app:", err);
      }
      if (ev.kind === "close") {
        this.socks.delete(sid);
        this.onGone?.(sid);
        return;
      }
      if (!taken) {
        e.inBox += 1;
        e.inBoxBytes += bytes;
      }
    }
  }

  /** The box handed `n` held events (of `bytes`) to the app: room for more. */
  ack(sid: number, n: number, bytes: number): void {
    const e = this.socks.get(Number(sid));
    if (!e) return;
    e.inBox = Math.max(0, e.inBox - (Number(n) || 0));
    e.inBoxBytes = Math.max(0, e.inBoxBytes - (Number(bytes) || 0));
    this.pump(Number(sid), e);
  }

  send(sid: number, data: unknown): Promise<void> {
    const e = this.socks.get(Number(sid));
    if (!e || e.closed) return Promise.reject(new SocketError("The connection is not open", "closed"));
    if (typeof data !== "string" && !(data instanceof Uint8Array)) return Promise.reject(new TypeError("send takes a string or a Uint8Array"));
    return e.s.send(data);
  }

  close(sid: number, code?: unknown, reason?: unknown): void {
    this.socks.get(Number(sid))?.s.close(code == null ? undefined : Number(code), reason == null ? undefined : String(reason));
  }

  /** The box is gone (stopped, closed): end every connection it held, and forget them. */
  endAll(why: SocketCloseWhy, reason: string): void {
    const all = [...this.socks.values()];
    this.socks.clear();
    for (const e of all) e.s.end(1001, reason, why);
  }
}
