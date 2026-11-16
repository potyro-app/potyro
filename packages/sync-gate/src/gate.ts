// The gate in front of the sync relay (docs/16 "The gate in front of the relay", #11).
//
// The relay is `jazz-run sync`, unmodified: it takes any connection, any number of them, and keeps
// every byte it is sent. The gate is the one way to it. For each websocket it is asked for, it decides
// from the client's address whether the relay is dialled at all, and then passes bytes both ways as
// they come, counting the ones going TO the relay:
//
//   refused before the relay is dialled   too many connections from the address, too many new ones
//   (HTTP 429 / 503, `Retry-After`)       a second, its bytes for today used up, the relay's bytes for
//                                         today used up, its disk nearly full, the gate full
//   slowed, never closed                  an address past its bytes or frames a second: the gate stops
//                                         reading from it until it has paid, and TCP holds the sender
//                                         (what one read brought, 64 KiB at most, is passed on first)
//   closed, with a code                   a message longer than the limit (1009), the address's or the
//                                         relay's bytes for today reached while connected (4021, 4022)
//
// What it holds per connection is two sockets and a few numbers: it never buffers a message, never
// unmasks or parses one, and reads only each frame's header (frames.ts). Per address it holds three
// buckets and a count, for at most `addresses` addresses. It logs its start, its stop and one line of
// totals an hour — never an address, never a single refusal.
//
// It cannot count what a SPACE holds: see docs/16 for why, and for what stands in its place.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { addressKey, clientAddress, type TrustProxy } from "./address.ts";
import { Bucket } from "./bucket.ts";
import { closeFrame, FrameWalker } from "./frames.ts";
import { CLOSE, CLOSE_REASON, dayOf, GATE_LIMITS, secondsLeftToday, type GateLimits } from "./limits.ts";
import { openGate, readOffer, SYNC_PROTOCOL, type TokenGate } from "./token.ts";

export interface GateOptions {
  port: number;
  host: string;
  /** The relay behind: `jazz-run sync`, on loopback. */
  upstream: { host: string; port: number };
  limits?: Partial<GateLimits>;
  /** Whose `X-Forwarded-For` is believed (address.ts). Default `caddy`. */
  trustProxy?: TrustProxy;
  /**
   * Origins a browser may connect from, or "*" for any (the default). A request with no Origin
   * header (not a browser) is allowed: this only stops other websites using the relay through their
   * visitors' browsers, and on those visitors' addresses.
   */
  origins?: readonly string[] | "*";
  /** Where a plan token will be checked (token.ts). Default: everyone is let through. */
  tokenGate?: TokenGate;
  /** Free bytes on the relay's disk. Without it the free-disk floor is not checked. */
  freeBytes?: () => Promise<number>;
  /** How often `freeBytes` is asked. Default 30 s. */
  diskCheckMs?: number;
  /** How often addresses that owe nothing are forgotten. Default 10 minutes. */
  sweepMs?: number;
  /** Start, stop, a line of totals an hour, and the relay being closed to writes. Never an address. */
  log?: (line: string) => void;
  now?: () => number;
}

/** Why a connection was not let through, or was closed: the names the totals are counted under. */
export type Refusal =
  | "bad-request"
  | "origin"
  | "busy"
  | "addresses-full"
  | "too-many-connections"
  | "too-fast"
  | "over-today"
  | "relay-full-today"
  | "disk-low"
  | "token"
  | "relay-down";

export interface GateStats {
  connections: number;
  addresses: number;
  accepted: number;
  refused: Partial<Record<Refusal, number>>;
  closed: Partial<Record<number, number>>;
  /** Bytes passed towards the relay, and back. */
  bytesUp: number;
  bytesDown: number;
  /** Milliseconds senders were held for going over a rate. */
  heldMs: number;
}

export interface SyncGate {
  server: Server;
  stats(): GateStats;
  /** Closes every connection with 1001 and stops listening. */
  close(): Promise<void>;
}

interface AddressUse {
  connections: number;
  connects: Bucket;
  bytes: Bucket;
  frames: Bucket;
  /** The calendar day `dayBytes` is for. */
  day: number;
  dayBytes: number;
}

interface Conn {
  client: Duplex;
  upstream: Socket;
  address: string;
  use: AddressUse;
  up: FrameWalker;
  down: FrameWalker;
  /** Reasons the client is not being read: over a rate, the relay not taking bytes. */
  holds: number;
  upstreamFull: boolean;
  held: ReturnType<typeof setTimeout> | null;
  stall: ReturnType<typeof setTimeout> | null;
  done: boolean;
}

const KEY = /^[A-Za-z0-9+/]{22}==$/;
const HOUR_MS = 60 * 60 * 1000;

export function startSyncGate(opts: GateOptions): Promise<SyncGate> {
  const limits: GateLimits = { ...GATE_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const trust = opts.trustProxy ?? "caddy";
  const origins = opts.origins ?? "*";
  const tokenGate = opts.tokenGate ?? openGate;
  const addresses = new Map<string, AddressUse>();
  /** The counted addresses with no connection, the one that has had none longest first: who may be forgotten. */
  const resting = new Set<string>();
  const conns = new Set<Conn>();
  /** Sockets being answered or dialled for, so a stop can let go of them too. */
  const pending = new Set<Duplex>();
  let closing = false;
  let diskLow = false;
  /** Connections past the address's limits whose relay is still being dialled. */
  let dialling = 0;
  /** The whole relay's day. */
  let day = dayOf(now());
  let dayBytes = 0;
  let warnedAt = -Infinity;

  const totals = { accepted: 0, refused: {} as Partial<Record<Refusal, number>>, closed: {} as Partial<Record<number, number>>, bytesUp: 0, bytesDown: 0, heldMs: 0 };
  let reported = JSON.stringify(totals);

  /** Tell the operator, at most once an hour: a line per refused connection would be a log of people. */
  const warn = (line: string): void => {
    if (now() - warnedAt < HOUR_MS) return;
    warnedAt = now();
    log(line);
  };

  const rollDay = (t: number): void => {
    if (dayOf(t) === day) return;
    day = dayOf(t);
    dayBytes = 0;
  };
  const rollUse = (use: AddressUse, t: number): void => {
    if (use.day === dayOf(t)) return;
    use.day = dayOf(t);
    use.dayBytes = 0;
  };

  /** An address nothing needs to remember: no connection, nothing spent today, every bucket full. */
  const idle = (use: AddressUse, t: number): boolean =>
    use.connections === 0 && (use.day !== dayOf(t) || use.dayBytes === 0) && use.connects.full(t) && use.bytes.full(t) && use.frames.full(t);

  /** The address's counts, made if it has none; null when the table is full of addresses in use. */
  function useOf(address: string, t: number): AddressUse | null {
    const known = addresses.get(address);
    if (known) return known;
    if (addresses.size >= limits.addresses) {
      // The one that has had no connection longest is forgotten: it starts again, which can only be
      // in its favour. The whole relay's limits hold whatever is forgotten here. An address with a
      // connection is never forgotten; when every counted address has one, the newcomer is refused.
      const victim = resting.values().next();
      if (victim.done) return null;
      forget(victim.value);
    }
    const use: AddressUse = {
      connections: 0,
      connects: new Bucket(limits.connectsPerSecond, limits.connectBurst, t),
      bytes: new Bucket(limits.bytesPerSecond, limits.byteBurst, t),
      frames: new Bucket(limits.framesPerSecond, limits.frameBurst, t),
      day: dayOf(t),
      dayBytes: 0,
    };
    addresses.set(address, use);
    resting.add(address);
    return use;
  }

  function forget(address: string): void {
    addresses.delete(address);
    resting.delete(address);
  }
  /** One more connection for an address, or one fewer: keeps `resting` in step. */
  function connected(address: string, use: AddressUse): void {
    use.connections++;
    resting.delete(address);
  }
  function disconnected(address: string, use: AddressUse): void {
    use.connections--;
    if (addresses.get(address) !== use) return;
    if (idle(use, now())) return forget(address);
    if (use.connections === 0) resting.add(address);
  }

  const server = createServer((req, res) => answerHttp(req, res));
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    // The HTTP server's sockets stay half open when the other side ends: a client that has gone
    // would hold its place, and its connection to the relay, for ever.
    socket.on("end", () => socket.destroy());
    pending.add(socket);
    socket.once("close", () => pending.delete(socket));
    void admit(req, socket, head);
  });
  server.on("clientError", (_err, socket) => socket.destroy());

  function answerHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = pathOf(req.url);
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, connections: conns.size }));
      return;
    }
    res.writeHead(426, { "content-type": "text/plain", "cache-control": "no-store", upgrade: "websocket" });
    res.end("websocket only");
  }

  function refuse(socket: Duplex, why: Refusal, status: number, text: string, retryAfter?: number): void {
    totals.refused[why] = (totals.refused[why] ?? 0) + 1;
    const retry = retryAfter === undefined ? "" : `Retry-After: ${Math.max(1, Math.ceil(retryAfter))}\r\n`;
    socket.end(`HTTP/1.1 ${status} ${text}\r\n${retry}Connection: close\r\nContent-Length: 0\r\n\r\n`);
    // Not left to the other side to close: a refused socket that stays half open is still a socket.
    setTimeout(() => socket.destroy(), 1000).unref();
  }

  async function admit(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const key = req.headers["sec-websocket-key"];
    if (
      req.method !== "GET" ||
      String(req.headers.upgrade ?? "").toLowerCase() !== "websocket" ||
      req.headers["sec-websocket-version"] !== "13" ||
      typeof key !== "string" ||
      !KEY.test(key)
    ) {
      return refuse(socket, "bad-request", 400, "Bad Request");
    }
    if (closing) return refuse(socket, "busy", 503, "Service Unavailable", 5);
    const origin = req.headers.origin;
    if (origin !== undefined && origins !== "*" && !origins.includes(origin)) return refuse(socket, "origin", 403, "Forbidden");

    const t = now();
    rollDay(t);
    // The whole relay first: refused there, nothing of the address's own is spent.
    if (diskLow) return refuse(socket, "disk-low", 503, "Service Unavailable", 600);
    if (dayBytes >= limits.bytesPerDay) return refuse(socket, "relay-full-today", 503, "Service Unavailable", secondsLeftToday(t));
    if (conns.size + dialling >= limits.connections) return refuse(socket, "busy", 503, "Service Unavailable", 30);

    const address = addressKey(clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trust));
    const use = useOf(address, t);
    if (!use) return refuse(socket, "addresses-full", 503, "Service Unavailable", 30);
    rollUse(use, t);
    if (!use.connects.take(1, t)) return refuse(socket, "too-fast", 429, "Too Many Requests", 1 / limits.connectsPerSecond);
    if (use.connections >= limits.connectionsPerAddress) return refuse(socket, "too-many-connections", 429, "Too Many Requests", 30);
    if (use.dayBytes >= limits.bytesPerAddressDay) return refuse(socket, "over-today", 429, "Too Many Requests", secondsLeftToday(t));

    // The connection counts from here, so two that arrive together cannot both take the last place.
    connected(address, use);
    dialling++;
    let counted = true;
    const uncount = (): void => {
      if (!counted) return;
      counted = false;
      dialling--;
      disconnected(address, use);
    };
    socket.once("close", uncount);

    // THE TOKEN GATE (token.ts). After the address's limits, before the relay is dialled. Today it
    // lets everyone through; a plan's check is a function passed as `tokenGate`.
    const offer = readOffer(req.headers["sec-websocket-protocol"]);
    let allowed = false;
    let waited: ReturnType<typeof setTimeout> | undefined;
    try {
      // A check that never answers is a "no": it must not hold the connection's place for ever.
      allowed = await Promise.race([
        Promise.resolve(tokenGate({ token: offer.token, address })),
        new Promise<boolean>((resolve) => (waited = setTimeout(() => resolve(false), limits.dialMs))),
      ]);
    } catch {
      allowed = false;
    }
    clearTimeout(waited);
    if (socket.destroyed) return;
    if (!allowed) {
      uncount();
      return refuse(socket, "token", 401, "Unauthorized");
    }

    let upstream: Socket;
    let answer: Buffer;
    try {
      ({ upstream, answer } = await dial(key));
    } catch {
      uncount();
      return refuse(socket, "relay-down", 503, "Service Unavailable", 5);
    }
    if (socket.destroyed || closing) {
      uncount();
      upstream.destroy();
      if (!socket.destroyed) refuse(socket, "busy", 503, "Service Unavailable", 5);
      return;
    }

    // The relay's own answer goes to the client as it is (it holds the accept key for the client's
    // key), with the gate's subprotocol added when the client offered it.
    const end = answer.indexOf("\r\n\r\n");
    const headText = answer.subarray(0, end).toString("latin1") + (offer.named ? `\r\nSec-WebSocket-Protocol: ${SYNC_PROTOCOL}` : "") + "\r\n\r\n";
    socket.write(headText, "latin1");

    // From here the connection is counted in `conns`, not in `dialling`.
    socket.off("close", uncount);
    counted = false;
    dialling--;
    pending.delete(socket);
    totals.accepted++;
    const conn: Conn = {
      client: socket,
      upstream,
      address,
      use,
      up: new FrameWalker(limits.messageBytes, true),
      down: new FrameWalker(Number.MAX_SAFE_INTEGER, false),
      holds: 0,
      upstreamFull: false,
      held: null,
      stall: null,
      done: false,
    };
    conns.add(conn);
    (socket as Partial<Socket>).setKeepAlive?.(true, 30_000);
    (socket as Partial<Socket>).setNoDelay?.(true);
    upstream.setNoDelay(true);

    socket.on("data", (chunk: Buffer) => fromClient(conn, chunk));
    upstream.on("data", (chunk: Buffer) => fromRelay(conn, chunk));
    // The client has gone: what it sent before leaving still goes to the relay.
    socket.on("close", () => finish(conn, true));
    upstream.on("close", () => shut(conn, CLOSE.goingAway));
    upstream.on("error", () => upstream.destroy());

    const rest = answer.subarray(end + 4);
    if (rest.length > 0) fromRelay(conn, rest);
    if (head.length > 0) fromClient(conn, head);
    // The relay may have gone between its answer and here, with nobody listening for it.
    if (upstream.destroyed) return shut(conn, CLOSE.goingAway);
    upstream.resume();
  }

  /**
   * Opens a websocket to the relay for a client's key; resolves with the socket, PAUSED so nothing it
   * sends is lost before the caller listens, and all it has answered so far.
   */
  function dial(key: string): Promise<{ upstream: Socket; answer: Buffer }> {
    return new Promise((resolve, reject) => {
      const upstream = connect({ host: opts.upstream.host, port: opts.upstream.port });
      upstream.on("error", () => {}); // always heard: an error nobody listens for would stop the gate
      let got = Buffer.alloc(0);
      const fail = (): void => {
        clearTimeout(timer);
        upstream.destroy();
        reject(new Error("relay"));
      };
      const timer = setTimeout(fail, limits.dialMs);
      upstream.once("error", fail);
      upstream.once("close", fail);
      upstream.once("connect", () => {
        // A request of the gate's own: nothing the client sent but its key reaches the relay. No
        // address (the relay would name the peer by it), no subprotocol (the token), no extension.
        upstream.write(
          `GET / HTTP/1.1\r\nHost: ${opts.upstream.host}:${opts.upstream.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
            `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
        );
      });
      const onData = (chunk: Buffer): void => {
        got = Buffer.concat([got, chunk]);
        const end = got.indexOf("\r\n\r\n");
        if (end < 0) {
          if (got.length > 8192) fail();
          return;
        }
        if (!/^HTTP\/1\.1 101 /.test(got.subarray(0, 16).toString("latin1"))) return fail();
        clearTimeout(timer);
        upstream.off("data", onData);
        upstream.off("error", fail);
        upstream.off("close", fail);
        upstream.pause();
        resolve({ upstream, answer: got });
      };
      upstream.on("data", onData);
    });
  }

  function hold(conn: Conn): void {
    if (conn.holds++ === 0) conn.client.pause();
  }
  function release(conn: Conn): void {
    if (--conn.holds === 0 && !conn.done) conn.client.resume();
  }

  function fromClient(conn: Conn, chunk: Buffer): void {
    if (conn.done) return;
    const walked = conn.up.feed(chunk);
    if (walked.bad) return shut(conn, CLOSE.protocol);
    if (walked.tooBig) return shut(conn, CLOSE.tooBig);

    const t = now();
    rollDay(t);
    rollUse(conn.use, t);
    conn.use.dayBytes += chunk.length;
    dayBytes += chunk.length;
    totals.bytesUp += chunk.length;
    if (!conn.upstream.write(chunk) && !conn.upstreamFull) {
      conn.upstreamFull = true;
      hold(conn);
      conn.upstream.once("drain", () => {
        conn.upstreamFull = false;
        release(conn);
      });
    }

    if (dayBytes >= limits.bytesPerDay) {
      warn(`[sync-gate] sync is closed until midnight UTC: ${limits.bytesPerDay} bytes were sent to the relay today (SYNC_BYTES_DAY)`);
      for (const other of [...conns]) shut(other, CLOSE.relayFull);
      return;
    }
    if (conn.use.dayBytes >= limits.bytesPerAddressDay) {
      for (const other of [...conns]) if (other.use === conn.use) shut(other, CLOSE.overToday);
      return;
    }

    // Over a rate: what came is already on its way, and the address pays by not being read.
    const wait = Math.max(conn.use.bytes.spend(chunk.length, t), conn.use.frames.spend(walked.frames, t));
    if (wait > 0 && conn.held === null) {
      totals.heldMs += wait;
      hold(conn);
      conn.held = setTimeout(() => {
        conn.held = null;
        release(conn);
      }, wait);
      conn.held.unref();
    }
  }

  function fromRelay(conn: Conn, chunk: Buffer): void {
    if (conn.done) return;
    // Not a websocket stream: the gate could no longer tell where a frame ends, so it stops here.
    if (conn.down.feed(chunk).bad) return cut(conn);
    totals.bytesDown += chunk.length;
    if (conn.client.write(chunk) || conn.stall !== null) return;
    // The client is not taking what the relay sends: stop reading the relay, and do not wait forever.
    conn.upstream.pause();
    conn.stall = setTimeout(() => cut(conn), limits.stallMs);
    conn.stall.unref();
    conn.client.once("drain", () => {
      if (conn.stall) clearTimeout(conn.stall);
      conn.stall = null;
      if (!conn.done) conn.upstream.resume();
    });
  }

  /** Takes a connection out of the counts. Once. `flush`: let what is on its way to the relay arrive first. */
  function finish(conn: Conn, flush = false): void {
    if (conn.done) return;
    conn.done = true;
    if (conn.held) clearTimeout(conn.held);
    if (conn.stall) clearTimeout(conn.stall);
    conns.delete(conn);
    disconnected(conn.address, conn.use);
    if (!flush) return void conn.upstream.destroy();
    conn.upstream.end();
    setTimeout(() => conn.upstream.destroy(), 2000).unref();
  }

  /** Closes a connection with a code — written only between two of the relay's frames — and counts it. */
  function shut(conn: Conn, code: number): void {
    if (conn.done) return;
    totals.closed[code] = (totals.closed[code] ?? 0) + 1;
    const clean = conn.down.atBoundary && conn.client.writable;
    finish(conn);
    if (!clean) return void conn.client.destroy();
    conn.client.end(closeFrame(code, CLOSE_REASON[code] ?? ""));
    setTimeout(() => conn.client.destroy(), 1000).unref();
  }

  function cut(conn: Conn): void {
    finish(conn);
    conn.client.destroy();
  }

  // Addresses that are done for the day, or whose buckets have filled again, are forgotten here; the
  // totals go to the log when there is something to say.
  const sweeper = setInterval(
    () => {
      const t = now();
      for (const [address, use] of addresses) if (idle(use, t)) forget(address);
    },
    opts.sweepMs ?? 10 * 60 * 1000,
  );
  sweeper.unref();
  const reporter = setInterval(() => report("last hour"), HOUR_MS);
  reporter.unref();

  function report(when: string): void {
    const text = JSON.stringify(totals);
    if (text === reported) return;
    reported = text;
    log(`[sync-gate] ${when}: ${text} (totals since start; ${conns.size} connected, ${addresses.size} addresses counted)`);
  }

  let diskTimer: ReturnType<typeof setInterval> | null = null;
  async function checkDisk(): Promise<void> {
    if (!opts.freeBytes) return;
    let free: number;
    try {
      free = await opts.freeBytes();
    } catch {
      return; // unknown is not low: a path that cannot be read must not close sync
    }
    const low = free < limits.minFreeBytes;
    if (low && !diskLow) {
      warn(`[sync-gate] sync is closed: the relay's disk has under ${limits.minFreeBytes} bytes free (SYNC_MIN_FREE_BYTES)`);
      for (const conn of [...conns]) shut(conn, CLOSE.relayFull);
    }
    if (!low && diskLow) log("[sync-gate] sync is open again: the relay's disk has room");
    diskLow = low;
  }

  function stats(): GateStats {
    return { connections: conns.size, addresses: addresses.size, ...structuredClone(totals) };
  }

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    clearInterval(sweeper);
    clearInterval(reporter);
    if (diskTimer) clearInterval(diskTimer);
    for (const conn of [...conns]) shut(conn, CLOSE.goingAway);
    for (const socket of pending) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    report("at stop");
    log("[sync-gate] stopped");
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      void checkDisk().then(() => {
        if (opts.freeBytes) {
          diskTimer = setInterval(() => void checkDisk(), opts.diskCheckMs ?? 30_000);
          diskTimer.unref();
        }
        resolve({ server, stats, close });
      });
    });
  });
}

/** The path without the query and without a `/sync` prefix the proxy may have left on. */
function pathOf(url: string | undefined): string {
  return (url ?? "/").split("?")[0]!.replace(/^\/sync(?=\/|$)/, "") || "/";
}
