// A socket server in memory, for tests (docs/28): unit and integration tests open real
// `ctx.caps.network.socket` / `.room` connections with no network at all.
//
// It is the page's real `SocketCap` (`createWebSockets`) over a fake `WebSocket` class, so closing on
// leave, the hidden timer, the ws:// rule and the open/refused/unreachable mapping are the ones the
// shell runs; only the far side is pretend. A host echoes by default; a test can make one refuse,
// never answer, or run a handler of its own. The rooms relay is simulated with its real envelope
// (docs/26 §2: welcome, join, leave; peers' frames as-is, never your own).

import { createWebSockets, type SocketCap, type SocketTarget, type WebSocketsDeps } from "./sockets.js";

/** One connection as the server sees it. */
export interface FakeConnection {
  readonly url: string;
  readonly host: string;
  /** What the app sent, in order. */
  readonly received: Array<string | Uint8Array>;
  /** The subprotocols the app offered. */
  readonly protocols: string[];
  readonly closed: boolean;
  /** Send something to the app. */
  send(data: string | Uint8Array): void;
  /** The server closes it, with a close frame. */
  end(code?: number, reason?: string): void;
  /** The network drops it: 1006, no close frame. */
  drop(): void;
  /** Hear what the app sends (for a handler that answers). */
  onMessage(cb: (data: string | Uint8Array) => void): void;
}

export type FakeHostBehaviour = "echo" | "refuse" | "unreachable" | ((c: FakeConnection) => void);

/** Someone else in a fake room — another device, driven by the test. */
export interface FakeRoomPeer {
  readonly id: string;
  readonly name: string;
  /** Peer messages and relay events this peer got, in order. */
  readonly received: Array<string | Uint8Array>;
  send(data: string | Uint8Array): void;
  leave(): void;
}

export interface FakeSocketsOptions {
  /** Where the rooms relay is (default `wss://rooms.test/rooms`); `null` = this build knows none. */
  roomsUrl?: string | null;
  /** The page's scheme (default "https:"). */
  pageProtocol?: string;
  /** Give `connectTimeoutMs` / `hiddenCloseMs` / `doc` / `local` when a test needs them. */
  deps?: Pick<WebSocketsDeps, "connectTimeoutMs" | "hiddenCloseMs" | "doc" | "local">;
  /** The per-app standing answer the shell keeps (default: nothing allowed yet). */
  allowed?: string[];
  /** The home-network address this app was given before (`hosts: ["local"]`). */
  localAddress?: string;
}

export interface FakeSockets {
  readonly cap: SocketCap;
  /** Every connection ever opened, in order. */
  readonly connections: FakeConnection[];
  /** What a host does with each new connection (`"echo"` unless told). The key is `host` with port. */
  serve(host: string, behaviour: FakeHostBehaviour): void;
  setOnline(online: boolean): void;
  /** What `bufferedAmount` reports for every connection (default 0). */
  buffered: number;
  /** Targets the person allowed, as the shell remembers them: a host, "rooms", or "local:<address>". */
  readonly allowedTargets: Set<string>;
  /** The person turns a target off in Edit tile (its open connections hear `why: "off"`). */
  turnOff(key: string): void;
  /** …and on again. */
  turnOn(key: string): void;
  /** Join a room from outside, as another member. */
  joinRoom(roomId: string, name?: string): FakeRoomPeer;
  /** The members of a room now, oldest first. */
  roomMembers(roomId: string): Array<{ id: string; name: string }>;
}

const later = (fn: () => void): void => {
  setTimeout(fn, 0);
};

let memberSeq = 0;
const memberId = (): string => `m${(++memberSeq).toString(36).padStart(11, "0")}`;
const envelope = (event: Record<string, unknown>): string => JSON.stringify({ "potyro-rooms": 1, ...event });
const ROOM_LIMITS = { messageBytes: 65536, membersPerRoom: 16, messagesPerSecond: 30, bytesPerSecond: 65536, idleMs: 1800000 };

interface RoomMemberConn {
  id: string;
  name: string;
  deliver(data: string | Uint8Array): void;
  end(code: number, reason: string): void;
}

export function createFakeSockets(opts: FakeSocketsOptions = {}): FakeSockets {
  const behaviours = new Map<string, FakeHostBehaviour>();
  const connections: FakeConnection[] = [];
  const rooms = new Map<string, RoomMemberConn[]>();
  const roomsUrl = opts.roomsUrl === null ? undefined : (opts.roomsUrl ?? "wss://rooms.test/rooms");
  let online = true;
  const state = { buffered: 0 };

  const roomOf = (url: URL): string | null => {
    if (!roomsUrl) return null;
    const base = new URL(roomsUrl);
    if (url.host !== base.host || !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)) return null;
    return decodeURIComponent(url.pathname.slice(base.pathname.replace(/\/$/, "").length + 1));
  };

  const joinMember = (roomId: string, m: RoomMemberConn): void => {
    const members = rooms.get(roomId) ?? [];
    m.deliver(envelope({ type: "welcome", room: roomId, you: { id: m.id, name: m.name }, members: members.map((x) => ({ id: x.id, name: x.name })), limits: ROOM_LIMITS }));
    for (const other of members) other.deliver(envelope({ type: "join", member: { id: m.id, name: m.name } }));
    rooms.set(roomId, [...members, m]);
  };
  const leaveMember = (roomId: string, m: RoomMemberConn): void => {
    const rest = (rooms.get(roomId) ?? []).filter((x) => x !== m);
    if (rest.length) rooms.set(roomId, rest);
    else rooms.delete(roomId);
    for (const other of rest) other.deliver(envelope({ type: "leave", member: { id: m.id, name: m.name } }));
  };
  const relayFrom = (roomId: string, from: RoomMemberConn, data: string | Uint8Array): void => {
    if (typeof data === "string" && data.startsWith('{"potyro-rooms":')) return from.end(4005, "reserved prefix");
    for (const other of rooms.get(roomId) ?? []) if (other !== from) other.deliver(data);
  };

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    protocol = "";
    binaryType = "blob";
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    get bufferedAmount(): number {
      return state.buffered;
    }
    private conn!: FakeConnection & { closedNow(code: number, reason: string, clean: boolean): void; heard(data: string | Uint8Array): void };
    private member: RoomMemberConn | null = null;
    private roomId: string | null = null;

    constructor(url: string, protocols?: string | string[]) {
      const u = new URL(url);
      const offered = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols];
      const received: Array<string | Uint8Array> = [];
      const listeners: Array<(data: string | Uint8Array) => void> = [];
      let closed = false;
      const self = this;
      const conn = {
        url: u.href,
        host: u.host,
        received,
        protocols: offered,
        get closed() {
          return closed;
        },
        send(data: string | Uint8Array) {
          if (closed) return;
          later(() => {
            if (!closed) self.onmessage?.({ data: typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer) });
          });
        },
        end(code = 1000, reason = "") {
          conn.closedNow(code, reason, true);
        },
        drop() {
          conn.closedNow(1006, "", false);
        },
        onMessage(cb: (data: string | Uint8Array) => void) {
          listeners.push(cb);
        },
        heard(data: string | Uint8Array) {
          for (const l of listeners) later(() => l(data));
        },
        closedNow(code: number, reason: string, clean: boolean) {
          if (closed) return;
          closed = true;
          if (self.member && self.roomId) leaveMember(self.roomId, self.member);
          later(() => {
            self.readyState = 3;
            self.onclose?.({ code, reason, wasClean: clean });
          });
        },
      };
      this.conn = conn;
      connections.push(conn);
      const behaviour = behaviours.get(u.host) ?? "echo";
      later(() => {
        if (!online || behaviour === "refuse") {
          closed = true;
          this.readyState = 3;
          this.onerror?.({});
          this.onclose?.({ code: 1006, reason: "", wasClean: false });
          return;
        }
        if (behaviour === "unreachable") return; // never answers: the connect timeout decides
        this.protocol = offered[0] ?? "";
        this.readyState = 1;
        this.onopen?.({});
        const roomId = roomOf(u);
        if (roomId !== null) {
          this.roomId = roomId;
          this.member = { id: memberId(), name: u.searchParams.get("name") ?? "", deliver: (d) => conn.send(d), end: (c, r) => conn.end(c, r) };
          joinMember(roomId, this.member);
        } else if (typeof behaviour === "function") behaviour(conn);
      });
    }

    send(data: string | ArrayBufferView | ArrayBuffer): void {
      if (this.readyState !== 1) throw new Error("InvalidStateError: not open");
      const d = typeof data === "string" ? data : data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      this.conn.received.push(d);
      this.conn.heard(d);
      if (this.member && this.roomId) {
        const [member, roomId] = [this.member, this.roomId];
        later(() => relayFrom(roomId, member, d));
        return;
      }
      if ((behaviours.get(this.conn.host) ?? "echo") === "echo") this.conn.send(d);
    }

    close(code = 1000, reason = ""): void {
      // As browsers do: a page may send only 1000 or its own 3000–4999, and a reason of ≤ 123 bytes.
      if (code !== 1000 && (code < 3000 || code > 4999)) throw new Error(`InvalidAccessError: close code ${code}`);
      if (new TextEncoder().encode(reason).length > 123) throw new Error("SyntaxError: close reason too long");
      if (this.readyState >= 2) return;
      this.readyState = 2;
      this.conn.closedNow(code, reason, true);
    }
  }

  const allowedTargets = new Set<string>(opts.allowed ?? []);
  const offTargets = new Set<string>();
  const offListeners = new Set<(t: SocketTarget) => void>();
  const local = { address: opts.localAddress };
  const keyOf = (t: SocketTarget): string => ("rooms" in t ? "rooms" : "local" in t ? `local:${t.local}` : t.host);
  const targetOf = (key: string): SocketTarget => (key === "rooms" ? { rooms: true } : key.startsWith("local:") ? { local: key.slice(6) } : { host: key });
  const base = createWebSockets({
    WebSocket: FakeWebSocket as unknown as WebSocketsDeps["WebSocket"],
    online: () => online,
    pageProtocol: () => opts.pageProtocol ?? "https:",
    roomsUrl,
    doc: opts.deps?.doc ?? { hidden: false, addEventListener: () => {} },
    ...(opts.deps?.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: opts.deps.connectTimeoutMs }),
    ...(opts.deps?.hiddenCloseMs === undefined ? {} : { hiddenCloseMs: opts.deps.hiddenCloseMs }),
    ...(opts.deps?.local === undefined ? {} : { local: opts.deps.local }),
  });
  const cap: SocketCap = {
    open: (url, o, events) => base.open(url, o, events),
    roomsUrl: base.roomsUrl,
    closeAll: (why) => base.closeAll(why),
    get openCount() {
      return base.openCount;
    },
    get plainLocal() {
      return base.plainLocal;
    },
    allowed: (t) => allowedTargets.has(keyOf(t)) && !offTargets.has(keyOf(t)),
    allow: (t) => {
      allowedTargets.add(keyOf(t));
      if ("local" in t) local.address = t.local;
    },
    turnedOff: (t) => offTargets.has(keyOf(t)),
    onTurnedOff: (cb) => {
      offListeners.add(cb);
      return () => void offListeners.delete(cb);
    },
    localAddress: () => local.address,
  };

  return {
    cap,
    connections,
    serve: (host, b) => void behaviours.set(host, b),
    setOnline: (v) => void (online = v),
    get buffered() {
      return state.buffered;
    },
    set buffered(n: number) {
      state.buffered = n;
    },
    allowedTargets,
    turnOff(key) {
      offTargets.add(key);
      for (const cb of [...offListeners]) cb(targetOf(key));
    },
    turnOn(key) {
      offTargets.delete(key);
      allowedTargets.add(key);
    },
    joinRoom(roomId, name = "") {
      const received: Array<string | Uint8Array> = [];
      let gone = false;
      const m: RoomMemberConn = {
        id: memberId(),
        name,
        deliver: (d) => later(() => !gone && received.push(d)),
        end: () => {
          gone = true;
          leaveMember(roomId, m);
        },
      };
      joinMember(roomId, m);
      return {
        id: m.id,
        name,
        received,
        send: (d) => later(() => relayFrom(roomId, m, d)),
        leave: () => {
          if (gone) return;
          gone = true;
          leaveMember(roomId, m);
        },
      };
    },
    roomMembers: (roomId) => (rooms.get(roomId) ?? []).map((m) => ({ id: m.id, name: m.name })),
  };
}
