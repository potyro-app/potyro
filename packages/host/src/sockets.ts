// `ctx.caps.network.socket` and `.room` (docs/28): live connections, the same API for every app.
//
// The page owns the WebSockets (capabilities' `SocketCap`, opened in the shell's realm). This is the
// mediation every app goes through, trusted or sealed:
//
//   - a sealed app may reach only the hosts its `permissions.network` names (and Potyro's rooms only
//     with `rooms: true`); anything else is refused at once, with no question (`"not-allowed-host"`);
//   - a sealed app asks the person once per app and host on this device, in words that name the
//     host ("“Price Board” wants a live connection to stream.binance.com"); Not now refuses this call
//     (`"denied"`) and is asked again next time, as for AI;
//   - every app has at most `SOCKET_LIMITS.perApp` connections; one message is at most
//     `messageBytes` each way (a room's own limit, 64 KiB, from its welcome); more than
//     `sendBufferBytes` waiting to go out refuses a send (`"full"`); messages held for an app that has
//     not taken them (no `onMessage` yet) are bounded too — past it the connection closes `"slow"`.
//
// The objects made here ARE what a trusted app holds. A sealed app holds a proxy in its box (the
// realm's worker, or QuickJS) that reaches these through `SocketBridge` (socket-bridge.ts).

import type { NetworkPermission, Room, RoomMember, RoomOptions, RoomPresence, Socket, SocketClose, SocketCloseWhy, SocketData, SocketFailure, SocketOptions, SocketSendFailure } from "potyro";
import { HIDDEN_KEEP_MAX_MS, SocketOpenError, parseLocalAddress, type ConsentNote, type ConsentWords, type PlatformCloseWhy, type PlatformSocket, type SocketCap, type SocketTarget } from "@potyro/capabilities";
import { ROOM_ID, SERVER_PREFIX, cleanName, newRoomId, readServerEvent } from "@potyro/rooms";
import type { UiBridge } from "./types.js";

export const SOCKET_LIMITS = {
  /** Connections one app may hold at once (opening ones count). */
  perApp: 4,
  /** One message, either way. Bigger from the server closes the connection (1009, `"too-big"`). */
  messageBytes: 1024 * 1024,
  /** Sent but not on the wire yet; past it `send` refuses (`"full"`) until it drains. */
  sendBufferBytes: 1024 * 1024,
  /** Arrived but not taken by the app yet; past it the connection is closed (`"slow"`). */
  receiveBufferBytes: 1024 * 1024,
} as const;

/** How long a room's relay has to say welcome once connected. */
const WELCOME_TIMEOUT_MS = 10_000;

/** A refusal with a `code` the app can word (SocketFailure, SocketSendFailure). */
export class SocketError extends Error {
  override name = "SocketError";
  constructor(
    message: string,
    readonly code: SocketFailure | SocketSendFailure,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- what a manifest allows

/** The hosts a network permission names: any (`true`, or the object form without hosts), none, or these. */
export function permittedHosts(perm: NetworkPermission | undefined): "any" | readonly string[] {
  if (!perm) return [];
  if (perm === true) return "any";
  if (perm.hosts && perm.hosts.length > 0) return perm.hosts;
  // `{}` has always meant any host; `{ rooms: true }` alone means the rooms and nothing else.
  return perm.rooms ? [] : "any";
}

/** May a sealed app connect to this address? A host named without a port matches it on any port. */
export function socketHostAllowed(perm: NetworkPermission | undefined, url: URL): boolean {
  const hosts = permittedHosts(perm);
  if (hosts === "any") return true;
  const host = url.host.toLowerCase();
  const name = url.hostname.toLowerCase();
  return hosts.some((h) => {
    const d = h.trim().toLowerCase();
    return d === host || (!d.includes(":") && d === name) || (d.startsWith("[") && !d.includes("]:") && d === name);
  });
}

/** May a sealed app join Potyro's rooms? `network: true`, `{ rooms: true }`, or the legacy any-host form. */
export function roomsAllowed(perm: NetworkPermission | undefined): boolean {
  if (!perm) return false;
  if (perm === true) return true;
  return perm.rooms === true || (perm.rooms === undefined && permittedHosts(perm) === "any");
}

// ---------------------------------------------------------------- one app's connections

interface AppSockets {
  open: Set<HostSocket>;
  /** One question at a time per target: two connects at once ask once. */
  asking: Map<string, Promise<boolean>>;
  /** Allowed in this session, for a platform that keeps no standing answer (tests, a fake). */
  allowedHere: Set<string>;
  /** The app was closed: nothing new opens for it (a retry timer of a trusted app outlives it). */
  closed?: boolean;
  /** Listening for the person turning a target off in Edit tile: while the app holds a connection. */
  offSub?: () => void;
  /** The person is being asked for a home device's address: two connects at once ask once. */
  askingAddress?: Promise<string | null>;
}

const byOwner = new WeakMap<object, AppSockets>();

function stateOf(owner: object): AppSockets {
  let s = byOwner.get(owner);
  if (!s) {
    s = { open: new Set(), asking: new Map(), allowedHere: new Set() };
    byOwner.set(owner, s);
  }
  return s;
}

/**
 * The app was closed: end what it holds ("left") and refuse whatever it asks for afterwards. A sealed
 * app's box dies with it; a trusted app's module lives on in the page, and a reconnect timer it set
 * would otherwise open a connection for an app nobody has open (docs/28 §5).
 */
export function retireAppSockets(owner: object): void {
  const state = stateOf(owner);
  state.closed = true;
  state.offSub?.();
  state.offSub = undefined;
  for (const s of [...state.open]) s.end(1001, "the app was closed", "left");
}

/** End every connection this app holds, now (its sealed box stopped; it was closed). */
export function closeAppSockets(owner: object, why: SocketCloseWhy, reason = "the app was stopped"): void {
  for (const s of [...stateOf(owner).open]) s.end(1001, reason, why);
}

/** How many connections an app holds (tests, and the shell's own count). */
export function openSocketsOf(owner: object): number {
  return stateOf(owner).open.size;
}

const targetKey = (t: SocketTarget): string => ("rooms" in t ? "rooms" : "local" in t ? `local:${t.local.toLowerCase()}` : `host:${t.host.toLowerCase()}`);

/** The host an app writes for "a device on the person's home network" (`hosts: ["local"]`, docs/28 §6). */
export const LOCAL_HOST = "local";

export function englishSocketConsent(appName: string, target: SocketTarget, note?: ConsentNote): ConsentWords {
  const secure = note?.secureOnly ? " In a browser it connects only if the device offers a secure (wss://) connection; the Potyro app for Android connects either way." : "";
  if ("rooms" in target) {
    return {
      message: `“${appName}” wants a live connection to Potyro’s rooms.`,
      detail: "Everyone with the room’s link sees what the app sends there. Potyro closes the connection when you leave the app.",
      ok: "Allow",
      cancel: "Not now",
    };
  }
  return {
    message: "local" in target ? `“${appName}” wants a live connection to ${target.local} on your home network.` : `“${appName}” wants a live connection to ${target.host}.`,
    detail: `While the app is open it can send and receive anything there. Potyro closes the connection when you leave the app.${"local" in target ? secure : ""}`,
    ok: "Allow",
    cancel: "Not now",
  };
}

export function englishLocalAddressAsk(appName: string, retry: string | null): string {
  const again = retry ? `“${retry.slice(0, 60)}” is not an address on your home network. ` : "";
  return `${again}“${appName}” wants to connect to a device on your home network. What is its address? For example 192.168.1.20 or homeassistant.local`;
}

/** `keepWhileHidden: "90s" | "5m"` in milliseconds, held to 15 minutes; `undefined` for the default. */
export function keepWhileHiddenMs(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|m)\s*$/.exec(String(value));
  if (!m) throw new TypeError(`keepWhileHidden is seconds or minutes, like "90s" or "5m" — not "${String(value).slice(0, 20)}"`);
  const ms = Number(m[1]) * (m[2] === "m" ? 60_000 : 1000);
  return Math.min(Math.round(ms), HIDDEN_KEEP_MAX_MS);
}

// ---------------------------------------------------------------- sizes

const encoder = new TextEncoder();

/** A message's size in bytes, without encoding a string that obviously fits. */
function sizeOf(d: SocketData): number {
  if (typeof d !== "string") return d.byteLength;
  return d.length * 3 <= 4096 ? d.length * 3 : encoder.encode(d).length;
}

function exactSize(d: SocketData, limit: number): number {
  if (typeof d !== "string") return d.byteLength;
  if (d.length > limit) return d.length; // at least one byte a character: over for certain
  if (d.length * 3 <= limit) return d.length; // at most three a UTF-16 unit: under for certain
  return encoder.encode(d).length;
}

const warn = (where: string, e: unknown): void => {
  console.warn(`[potyro] ${where} threw:`, e);
};

// ---------------------------------------------------------------- the socket

/** The close codes an app may send: 1000, or its own 3000–4999 (what WebSocket.close accepts). */
const closeCodeOf = (code: number | undefined): number => (code === 1000 || (typeof code === "number" && Number.isInteger(code) && code >= 3000 && code <= 4999) ? code : 1000);

export class HostSocket implements Socket {
  readyState: "open" | "closing" | "closed" = "open";
  protocol = "";
  private ps: PlatformSocket | null = null;
  private messageCbs: Array<(d: SocketData) => void> = [];
  private closeCbs: Array<(c: SocketClose) => void> = [];
  private held: SocketData[] = [];
  private heldBytes = 0;
  private closedWith: SocketClose | null = null;
  protected maxMessage: number = SOCKET_LIMITS.messageBytes;
  /** Whom it goes to, as the person's switches name it (`targetKey`): turning that off ends it. */
  target = "";

  constructor(
    private address: string,
    private readonly state: AppSockets,
  ) {
    state.open.add(this);
  }

  get url(): string {
    return this.address;
  }

  /** Before it opens: where it really goes (`ws://local:…` → the address the person gave). */
  retarget(href: string): void {
    if (!this.ps) this.address = href;
  }

  /** The platform's events for this connection. */
  events() {
    return {
      message: (d: string | Uint8Array) => this.fromServer(d),
      close: (code: number, reason: string, why: PlatformCloseWhy) => this.finish({ code, reason, why }),
    };
  }

  attach(ps: PlatformSocket): void {
    this.ps = ps;
    this.protocol = ps.protocol;
  }

  /** The platform's message: checked for size, then the app's (or held until it listens). */
  protected fromServer(d: SocketData): void {
    if (this.closedWith) return;
    if (exactSize(d, SOCKET_LIMITS.messageBytes) > SOCKET_LIMITS.messageBytes) return this.end(1009, "message too big", "too-big");
    this.toApp(d);
  }

  protected toApp(d: SocketData): void {
    if (this.messageCbs.length === 0) {
      this.heldBytes += sizeOf(d);
      if (this.heldBytes > SOCKET_LIMITS.receiveBufferBytes) return this.end(1008, "not reading fast enough", "slow");
      this.held.push(d);
      return;
    }
    for (const cb of [...this.messageCbs]) {
      try {
        cb(d);
      } catch (e) {
        warn("a socket's onMessage", e);
      }
    }
  }

  /** End it from this side (the platform's own close is not waited for). */
  end(code: number, reason: string, why: SocketCloseWhy): void {
    if (this.closedWith) return;
    try {
      this.ps?.close(code === 1009 || code === 1008 || code === 1001 ? 1000 : closeCodeOf(code), reason.slice(0, 120));
    } catch {
      // already closing
    }
    this.finish({ code, reason, why });
  }

  protected finish(c: SocketClose): void {
    if (this.closedWith) return;
    this.closedWith = c;
    this.readyState = "closed";
    this.state.open.delete(this);
    if (this.state.open.size === 0) {
      this.state.offSub?.();
      this.state.offSub = undefined;
    }
    this.held = [];
    this.heldBytes = 0;
    for (const cb of this.closeCbs.splice(0)) {
      try {
        cb(c);
      } catch (e) {
        warn("a socket's onClose", e);
      }
    }
    this.messageCbs = [];
  }

  async send(data: SocketData): Promise<void> {
    if (typeof data !== "string" && !(data instanceof Uint8Array)) throw new TypeError("send takes a string or a Uint8Array");
    if (this.readyState !== "open" || !this.ps) throw new SocketError("The connection is not open", "closed");
    const size = exactSize(data, this.maxMessage);
    if (size > this.maxMessage) throw new SocketError(`One message is at most ${this.maxMessage} bytes; this is ${size}`, "too-big");
    if (this.ps.bufferedAmount + size > SOCKET_LIMITS.sendBufferBytes) throw new SocketError("Too much is still waiting to be sent: send again in a moment", "full");
    this.ps.send(data);
  }

  onMessage(cb: (data: SocketData) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onMessage takes a function");
    if (this.closedWith) return () => {};
    this.messageCbs.push(cb);
    if (this.held.length) {
      const held = this.held;
      this.held = [];
      this.heldBytes = 0;
      // After this call returns, in order, before anything that arrives later.
      queueMicrotask(() => {
        for (const d of held) {
          try {
            cb(d);
          } catch (e) {
            warn("a socket's onMessage", e);
          }
        }
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
      queueMicrotask(() => {
        try {
          cb(done);
        } catch (e) {
          warn("a socket's onClose", e);
        }
      });
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
    if (!this.ps) return this.finish({ code: 1000, reason: "", why: "app" });
    try {
      this.ps.close(closeCodeOf(code), String(reason ?? "").slice(0, 120));
    } catch {
      this.finish({ code: 1000, reason: "", why: "app" });
    }
  }
}

/** A room: the relay's envelope read here, so the app hears typed presence and only its peers' messages. */
export class HostRoom extends HostSocket implements Room {
  me: RoomMember = { id: "", name: "" };
  members: RoomMember[] = [];
  private presenceCbs: Array<(e: RoomPresence) => void> = [];
  private welcomed: ((ok: boolean) => void) | null = null;

  constructor(
    url: string,
    state: AppSockets,
    readonly id: string,
  ) {
    super(url, state);
  }

  /** Resolves true on the relay's welcome, false if the connection ends first. */
  welcome(): Promise<boolean> {
    return new Promise<boolean>((resolve) => (this.welcomed = resolve));
  }

  protected override fromServer(d: SocketData): void {
    if (typeof d === "string" && d.startsWith(SERVER_PREFIX)) {
      const ev = readServerEvent(d);
      if (!ev) return;
      if (ev.type === "welcome") {
        this.me = { id: String(ev.you?.id ?? ""), name: String(ev.you?.name ?? "") };
        this.members = (ev.members ?? []).map((m) => ({ id: String(m.id), name: String(m.name ?? "") }));
        const limit = Number(ev.limits?.messageBytes);
        if (Number.isFinite(limit) && limit > 0) this.maxMessage = Math.min(limit, SOCKET_LIMITS.messageBytes);
        this.welcomed?.(true);
        this.welcomed = null;
      } else if (ev.type === "join" || ev.type === "leave") {
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
      return; // an event this version does not know is ignored, as docs/26 asks
    }
    super.fromServer(d);
  }

  protected override finish(c: SocketClose): void {
    this.welcomed?.(false);
    this.welcomed = null;
    super.finish(c);
    this.presenceCbs = [];
  }

  override async send(data: SocketData): Promise<void> {
    if (typeof data === "string" && data.startsWith(SERVER_PREFIX)) throw new TypeError(`A room message cannot begin with ${SERVER_PREFIX}`);
    return super.send(data);
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

// ---------------------------------------------------------------- the capability

export interface LiveNetworkArgs {
  cap: SocketCap | null | undefined;
  trusted: boolean;
  /** The app's `permissions.network`. */
  permission: NetworkPermission | undefined;
  ui: UiBridge;
  appName: string;
  /** Whose connections these are: the loaded app (its count, its questions). */
  owner: object;
}

export interface LiveNetwork {
  socket(url: string, opts?: SocketOptions): Promise<Socket>;
  room(id?: string, opts?: RoomOptions): Promise<Room>;
}

function protocolsOf(opts: SocketOptions | undefined): string[] | undefined {
  const p = opts?.protocols;
  if (p === undefined || p === null) return undefined;
  const list = (Array.isArray(p) ? p : [p]).map(String);
  if (list.length > 16) throw new TypeError("at most 16 protocols");
  return list;
}

const failureOf = (e: unknown): SocketError => {
  if (e instanceof SocketError) return e;
  if (e instanceof SocketOpenError) return new SocketError(e.message, e.code);
  if (e instanceof TypeError) throw e;
  return new SocketError(e instanceof Error ? e.message : String(e), "refused");
};

export function makeLiveNetwork(args: LiveNetworkArgs): LiveNetwork {
  const { cap, trusted, permission, ui, appName } = args;
  const state = stateOf(args.owner);

  // The person turning a target off in Edit tile ends this app's connections there at once. Heard
  // while the app holds one (or is opening one); the last to end stops listening (HostSocket.finish).
  const watchSwitches = (): void => {
    if (state.offSub || !cap?.onTurnedOff) return;
    state.offSub = cap.onTurnedOff((target) => {
      const key = targetKey(target);
      for (const s of [...state.open]) if (s.target === key) s.end(1000, "turned off in Edit tile", "off");
    });
  };

  const refuseIfOff = (target: SocketTarget): void => {
    if (cap?.turnedOff?.(target)) {
      throw new SocketError(`Live connections from “${appName}” to ${describe(target)} are turned off. Turn them on again in Edit tile.`, "off");
    }
  };

  /** Ask once per target, on this device, for a sealed app; a trusted app is not asked. */
  const consent = async (target: SocketTarget): Promise<void> => {
    refuseIfOff(target);
    if (trusted) return;
    const key = targetKey(target);
    if (cap?.allowed?.(target) || state.allowedHere.has(key)) return;
    let asking = state.asking.get(key);
    if (!asking) {
      asking = (async () => {
        try {
          const note: ConsentNote = { secureOnly: "local" in target && cap?.plainLocal === false };
          const w = cap?.consentWords?.(appName, target, note) ?? englishSocketConsent(appName, target, note);
          return await ui.confirm(w.message, { detail: w.detail, ok: w.ok, cancel: w.cancel });
        } finally {
          state.asking.delete(key);
        }
      })();
      state.asking.set(key, asking);
    }
    if (!(await asking)) throw new SocketError(`Permission denied: ${appName} → ${describe(target)}`, "denied");
    state.allowedHere.add(key);
    cap?.allow?.(target);
  };

  /**
   * `ws://local:…`: which device on the home network. The one the person gave this app before, or
   * they are asked for it (once at a time, however many connects wait) — an address on the local
   * network, or they are asked again; cancelling is Not now.
   */
  const localAddress = async (): Promise<string> => {
    const known = cap?.localAddress?.();
    if (known) return known;
    let asking = state.askingAddress;
    if (!asking) {
      asking = (async (): Promise<string | null> => {
        try {
          let retry: string | null = null;
          for (let i = 0; i < 5; i++) {
            const words = cap?.localAddressWords?.(appName, retry) ?? englishLocalAddressAsk(appName, retry);
            const typed = await ui.prompt(words, { default: "" });
            if (typed === null || typed === undefined || !String(typed).trim()) return null;
            const address = parseLocalAddress(String(typed));
            if (address) return address;
            retry = String(typed).trim();
          }
          return null;
        } finally {
          state.askingAddress = undefined;
        }
      })();
      state.askingAddress = asking;
    }
    const address = await asking;
    if (!address) throw new SocketError(`Permission denied: ${appName} → a device on your home network`, "denied");
    return address;
  };

  const roomOrSlot = (): void => {
    if (state.closed) throw new SocketError(`“${appName}” was closed: it opens nothing until it is opened again`, "refused");
    if (state.open.size >= SOCKET_LIMITS.perApp) throw new SocketError(`An app may hold ${SOCKET_LIMITS.perApp} live connections at once; close one first`, "too-many");
  };

  const connect = async <S extends HostSocket>(s: S, protocols: string[] | undefined, keep: number | undefined): Promise<S> => {
    try {
      if (!cap) throw new SocketError("This device cannot open live connections", "offline");
      s.attach(await cap.open(s.url, { protocols, ...(keep === undefined ? {} : { keepWhileHiddenMs: keep }) }, s.events()));
      return s;
    } catch (e) {
      s.end(1006, "", "network");
      throw failureOf(e);
    }
  };

  return {
    async socket(url, opts) {
      let u: URL;
      try {
        u = new URL(String(url));
      } catch {
        throw new TypeError(`ctx.caps.network.socket needs a whole address (wss://…), not "${String(url).slice(0, 80)}"`);
      }
      if (u.protocol !== "wss:" && u.protocol !== "ws:") throw new TypeError(`ctx.caps.network.socket needs a wss:// address, not ${u.protocol}//`);
      const protocols = protocolsOf(opts);
      const keep = keepWhileHiddenMs(opts?.keepWhileHidden);
      if (!trusted && !socketHostAllowed(permission, u)) {
        throw new SocketError(`“${appName}” may not connect to ${u.host}: its permissions.network.hosts do not name it`, "not-allowed-host");
      }
      const home = u.hostname.toLowerCase() === LOCAL_HOST;
      // An https web page cannot open ws:// to the home network (mixed content): say so before asking
      // the person for an address that could not work.
      if (home && u.protocol === "ws:" && cap?.plainLocal === false) {
        throw new SocketError("ws:// to a device on your home network works in the Potyro app for Android, not on this website: use wss:// there", "insecure");
      }
      roomOrSlot();
      // The slot is held while the person is asked: four questions at once cannot become five sockets.
      const s = new HostSocket(u.href, state);
      watchSwitches();
      let target: SocketTarget = { host: u.host };
      try {
        if (home) {
          const address = await localAddress();
          target = { local: address };
          refuseIfOff(target);
          // The port the person typed wins; without one, the app's stays (URL's host setter keeps it).
          const real = new URL(u.href);
          real.host = address;
          s.retarget(real.href);
          // A trusted app is not asked, but the address is remembered (and listed in Edit tile).
          if (trusted && !cap?.allowed?.(target)) cap?.allow?.(target);
        }
        s.target = targetKey(target);
        await consent(target);
      } catch (e) {
        s.end(1000, "", "app");
        throw e;
      }
      return connect(s, protocols, keep);
    },

    async room(id, opts) {
      const roomId = id === undefined || id === null ? newRoomId() : String(id);
      if (!ROOM_ID.test(roomId)) throw new TypeError("A room id is 22–64 characters of A–Z a–z 0–9 _ - (room() without one makes one)");
      const keep = keepWhileHiddenMs(opts?.keepWhileHidden);
      if (!trusted && !roomsAllowed(permission)) throw new SocketError(`“${appName}” may not join rooms: its permissions.network does not say rooms: true`, "not-allowed-host");
      const base = cap?.roomsUrl;
      if (!base) throw new SocketError("This build of Potyro has no rooms relay", "unreachable");
      roomOrSlot();
      const name = cleanName(opts?.name);
      const url = `${base.replace(/\/+$/, "")}/${roomId}${name ? `?name=${encodeURIComponent(name)}` : ""}`;
      const r = new HostRoom(url, state, roomId);
      watchSwitches();
      r.target = targetKey({ rooms: true });
      try {
        await consent({ rooms: true });
      } catch (e) {
        r.end(1000, "", "app");
        throw e;
      }
      const welcomed = r.welcome();
      const ended: { close: SocketClose | null } = { close: null };
      const stopListening = r.onClose((c) => (ended.close = c));
      await connect(r, undefined, keep);
      // The relay's first frame is the welcome; one that never comes is a relay that is not there.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), WELCOME_TIMEOUT_MS)));
      const got = await Promise.race([welcomed, late]);
      clearTimeout(timer);
      stopListening();
      if (got === "late") {
        r.end(1000, "", "network");
        throw new SocketError("The rooms relay did not answer", "unreachable");
      }
      if (!got) throw new SocketError(`The rooms relay closed the connection${ended.close?.reason ? `: ${ended.close.reason}` : ""}`, "refused");
      return r;
    },
  };
}

const describe = (t: SocketTarget): string => ("rooms" in t ? "Potyro’s rooms" : "local" in t ? `${t.local} (your home network)` : t.host);
