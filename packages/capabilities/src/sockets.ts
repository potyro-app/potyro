// Live connections for apps (docs/28): the platform half of `ctx.caps.network.socket` and `.room`.
//
// The host does the mediation — which hosts a shared app may reach, the person's consent, the
// per-app limits, the rooms envelope (host/src/sockets.ts). What lives here is what only the page can
// do: own the `WebSocket`s (in the shell's realm, never a sealed frame, whose `Origin: null` the
// rooms relay refuses — docs/26 §5), decide which addresses can be reached at all on this target,
// and close every connection when the person leaves the app or the page has been hidden a while.
//
// One `SocketCap` per page (`createWebSockets`), shared by every `Capabilities`; the shell wraps it
// per app (`allowed` / `allow` / `consentWords`), as it does the AI service.

import type { AiConsentWords } from "./types.js";

/** Why the platform ended a connection (the host adds its own: too big, slow, stopped). */
export type PlatformCloseWhy = "app" | "server" | "network" | "left" | "hidden";

/** Why a connection could not be opened, as a code the host passes on to the app. */
export type SocketOpenFailure = "offline" | "refused" | "unreachable" | "insecure";

export class SocketOpenError extends Error {
  override name = "SocketOpenError";
  constructor(
    message: string,
    readonly code: SocketOpenFailure,
  ) {
    super(message);
  }
}

/** What the platform tells the host about one connection. */
export interface PlatformSocketEvents {
  message(data: string | Uint8Array): void;
  /** Once. After it nothing else arrives. */
  close(code: number, reason: string, why: PlatformCloseWhy): void;
}

export interface PlatformSocket {
  /** The subprotocol the server chose, or "". */
  readonly protocol: string;
  /** Bytes handed to `send` and not yet on the wire. */
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  /** The close event follows, with `why: "app"`. */
  close(code?: number, reason?: string): void;
}

/** The words of a consent question, in the person's language. */
export type ConsentWords = AiConsentWords;

/** Who a connection goes to, for the consent question and its memory: a host, or Potyro's rooms. */
export type SocketTarget = { host: string } | { rooms: true };

export interface SocketCap {
  /** Resolves once the connection is open; rejects with a `SocketOpenError`. */
  open(url: string, opts: { protocols?: string[] }, events: PlatformSocketEvents): Promise<PlatformSocket>;
  /** Potyro's rooms relay, `wss://apps.vaz.io/rooms` — absent when this build knows none. */
  readonly roomsUrl?: string;
  /** End every open connection now ("left": the person left the app; "hidden": the page was hidden a while). */
  closeAll(why: "left" | "hidden"): void;
  /** How many connections are open on this page. */
  readonly openCount: number;
  // ---- per app, added by the shell (like AiCap's): the person's standing answer and the words ----
  /** Did the person allow this app to connect there, on this device? */
  allowed?(target: SocketTarget): boolean;
  /** Remember that they did. */
  allow?(target: SocketTarget): void;
  /** The consent question for a shared app, in the person's language. The host has English ones. */
  consentWords?(appName: string, target: SocketTarget): ConsentWords;
}

// ---------------------------------------------------------------- addresses

/** A host on the device itself: `localhost`, 127.0.0.0/8, ::1. Browsers let an https page reach it with ws://. */
export function isLoopback(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "::1";
}

/**
 * An address on the local network: loopback, the private IPv4 ranges (10/8, 172.16/12, 192.168/16),
 * link-local (169.254/16, fe80::/10), IPv6 unique-local (fc00::/7), or a `.local` name. By its
 * spelling only — a name is not resolved here; the native side checks what it resolves to.
 */
export function isLocalAddress(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopback(h) || h.endsWith(".local")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(":")) return /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
  return false;
}

// ---------------------------------------------------------------- the web's

/** How long a connection may take to open before it is given up as unreachable. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** How long the page may be hidden before every connection is closed ("hidden"). */
export const HIDDEN_CLOSE_MS = 30_000;

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

/** Opens a `ws://` connection to the local network natively (the Android app, docs/28 §6). */
export type LocalOpener = (url: string, opts: { protocols?: string[] }, events: PlatformSocketEvents) => Promise<PlatformSocket>;

export interface WebSocketsDeps {
  WebSocket?: WebSocketCtor;
  doc?: { readonly hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void };
  online?: () => boolean;
  /** The page's own scheme, "https:" or "http:" (`location.protocol`). */
  pageProtocol?: () => string;
  roomsUrl?: string;
  /** Plain `ws://` to the local network, where the target can (the Android app). */
  local?: LocalOpener;
  connectTimeoutMs?: number;
  hiddenCloseMs?: number;
}

interface Tracked {
  /** End it now, as the platform: the event is delivered at once and the browser's is ignored. */
  end(why: "left" | "hidden"): void;
}

/** The page's live connections over the browser's `WebSocket` (and, on Android, the native local one). */
export function createWebSockets(deps: WebSocketsDeps = {}): SocketCap {
  const WS = deps.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  const online = deps.online ?? (() => globalThis.navigator?.onLine !== false);
  const pageProtocol = deps.pageProtocol ?? (() => globalThis.location?.protocol ?? "https:");
  const connectTimeout = deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const hiddenClose = deps.hiddenCloseMs ?? HIDDEN_CLOSE_MS;
  const live = new Set<Tracked>();
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  const closeAll = (why: "left" | "hidden"): void => {
    for (const t of [...live]) t.end(why);
  };
  const doc = deps.doc ?? (typeof document !== "undefined" ? document : undefined);
  const armHidden = (): void => {
    if (hiddenTimer || !doc?.hidden || live.size === 0) return;
    hiddenTimer = setTimeout(() => {
      hiddenTimer = null;
      if (doc.hidden) closeAll("hidden");
    }, hiddenClose);
  };
  doc?.addEventListener("visibilitychange", () => {
    if (!doc.hidden) {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
    } else armHidden();
  });

  /**
   * Count one connection — from the moment it starts opening — and let `closeAll` end it. `stop` ends
   * the real one quietly: while it is still opening, it is abandoned and its open refused; once open,
   * it is closed and its own close event is not passed on (the platform's is delivered at once).
   * `forget` drops one that never opened, without an event: its open says what happened.
   */
  const track = (events: PlatformSocketEvents) => {
    let ended = false;
    let stop: (code: number, reason: string) => void = () => {};
    const tracked: Tracked = {
      end(why) {
        if (ended) return;
        ended = true;
        live.delete(tracked);
        // 1000 on the wire: a page may not send 1001 (WebSocket.close throws on it). The app hears 1001.
        stop(1000, why === "left" ? "the person left the app" : "Potyro was in the background");
        events.close(1001, why === "left" ? "left the app" : "in the background", why);
      },
    };
    live.add(tracked);
    armHidden();
    return {
      get ended() {
        return ended;
      },
      onStop: (fn: (code: number, reason: string) => void) => void (stop = fn),
      forget: () => {
        ended = true;
        live.delete(tracked);
      },
      events: {
        message: (d: string | Uint8Array) => {
          if (!ended) events.message(d);
        },
        close: (code: number, reason: string, why: PlatformCloseWhy) => {
          if (ended) return;
          ended = true;
          live.delete(tracked);
          events.close(code, reason, why);
        },
      } satisfies PlatformSocketEvents,
    };
  };

  /** Refused because Potyro ended it while it was still opening (the person left, or the page hid). */
  const endedWhileOpening = (): SocketOpenError => new SocketOpenError("Potyro closed the connection before it opened", "refused");

  const browserOpen = (url: string, protocols: string[] | undefined, events: PlatformSocketEvents): Promise<PlatformSocket> =>
    new Promise<PlatformSocket>((resolve, reject) => {
      if (!WS) return reject(new SocketOpenError("This device cannot open live connections", "refused"));
      let ws: WebSocket;
      try {
        ws = protocols?.length ? new WS(url, protocols) : new WS(url);
      } catch (e) {
        // A bad subprotocol, a port the browser blocks: refused before anything was sent.
        return reject(new SocketOpenError(e instanceof Error ? e.message : String(e), "refused"));
      }
      ws.binaryType = "arraybuffer";
      const t = track(events);
      let opened = false;
      let byApp = false;
      const abandon = (): void => {
        ws.onclose = ws.onopen = ws.onmessage = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // closing a socket that never opened can throw in some engines; it is gone either way
        }
      };
      const timer = setTimeout(() => {
        if (opened) return;
        abandon();
        t.forget();
        reject(new SocketOpenError(`No answer from ${new URL(url).host} in ${Math.round(connectTimeout / 1000)} s`, "unreachable"));
      }, connectTimeout);
      // Left (or hidden) while still opening: never let it open behind the person's back.
      t.onStop(() => {
        clearTimeout(timer);
        abandon();
        reject(endedWhileOpening());
      });
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        t.onStop((code, reason) => {
          ws.onclose = ws.onmessage = ws.onerror = null;
          try {
            ws.close(code, reason);
          } catch {
            // already closing
          }
        });
        ws.onmessage = (e: MessageEvent) => {
          const d = e.data as unknown;
          t.events.message(typeof d === "string" ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(0));
        };
        ws.onclose = (e: CloseEvent) => t.events.close(e.code, e.reason, byApp ? "app" : e.wasClean ? "server" : "network");
        resolve({
          get protocol() {
            return ws.protocol;
          },
          get bufferedAmount() {
            return ws.bufferedAmount;
          },
          send: (d) => ws.send(d as string | ArrayBufferView<ArrayBuffer>),
          close: (code, reason) => {
            if (byApp) return;
            byApp = true;
            try {
              ws.close(code ?? 1000, reason);
            } catch {
              ws.close(1000);
            }
          },
        });
      };
      // Before it opens, an error is followed by a close; the close says it.
      ws.onclose = (e: CloseEvent) => {
        if (opened) return;
        clearTimeout(timer);
        t.forget();
        reject(
          online()
            ? new SocketOpenError(`${new URL(url).host} refused the connection${e.code && e.code !== 1006 ? ` (${e.code}${e.reason ? ` ${e.reason}` : ""})` : ""}`, "refused")
            : new SocketOpenError("This device is offline", "offline"),
        );
      };
    });

  /** ws:// to the local network, natively (the Android app): counted and ended like the browser's. */
  const localOpen = async (open: LocalOpener, url: string, opts: { protocols?: string[] }, events: PlatformSocketEvents): Promise<PlatformSocket> => {
    const t = track(events);
    let s: PlatformSocket;
    try {
      s = await open(url, opts, t.events);
    } catch (e) {
      t.forget();
      throw e;
    }
    if (t.ended) {
      // Ended while it was opening: it opened anyway, so close it now.
      s.close(1000, "the person left the app");
      throw endedWhileOpening();
    }
    t.onStop((code, reason) => s.close(code, reason));
    return s;
  };

  return {
    roomsUrl: deps.roomsUrl,
    get openCount() {
      return live.size;
    },
    closeAll,
    async open(url, opts, events) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new TypeError(`Not an address: ${url}`);
      }
      if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new TypeError(`A live connection needs a ws:// or wss:// address, not ${u.protocol}`);
      if (!online()) throw new SocketOpenError("This device is offline", "offline");
      if (u.protocol === "ws:") {
        // The web refuses ws:// from an https page (mixed content) except to the device itself; the
        // Android app reaches its local network natively; a page served over http (development) can.
        const local = isLocalAddress(u.hostname);
        if (local && deps.local && !isLoopback(u.hostname)) return localOpen(deps.local, u.href, opts, events);
        if (pageProtocol() !== "http:" && !isLoopback(u.hostname)) {
          throw new SocketOpenError(`ws://${u.host} is not encrypted: this device only connects to wss:// addresses`, "insecure");
        }
      }
      return browserOpen(u.href, opts.protocols, events);
    },
  };
}

let shared: SocketCap | null | undefined;

/**
 * The page's one `SocketCap` — every `Capabilities` on the page shares it, so leaving an app closes
 * whatever any of them opened. `null` where there is no `WebSocket` (Node tests: use the fake).
 * `local` is the Android app's native opener for ws:// on the local network, passed the first time.
 */
export function sharedWebSockets(local?: LocalOpener): SocketCap | null {
  if (shared !== undefined) return shared;
  shared = typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function" ? createWebSockets(local ? { local } : {}) : null;
  return shared;
}
