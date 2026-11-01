// The rooms relay (docs/26): one HTTP server that upgrades `/rooms/<roomId>` to a websocket and
// forwards every frame a member sends to every other member of that room, as-is.
//
// What it keeps is only what is live: the rooms that have members, each member's random id and
// display name, and per-address counts. Nothing is written to disk and nothing a member sends is
// read, logged or kept — a frame is checked for its size, its rate and (text only) the reserved
// prefix, then written to the other sockets and dropped.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Bucket } from "./bucket.ts";
import {
  CLOSE,
  CLOSE_REASON,
  ROOMS_PROTOCOL,
  ROOM_ID,
  ROOM_LIMITS,
  SERVER_PREFIX,
  cleanName,
  type JoinEvent,
  type LeaveEvent,
  type Member,
  type RoomLimits,
  type WelcomeEvent,
} from "./protocol.ts";

export interface RelayOptions {
  port: number;
  host: string;
  limits?: Partial<RoomLimits>;
  /**
   * Origins a browser may connect from, or "*" for any. A request with no Origin header (not a
   * browser) is allowed: a non-browser client can claim any origin anyway, so this check only stops
   * other websites from using the relay through their visitors' browsers.
   */
  origins: readonly string[] | "*";
  /**
   * Take the client's address from the LAST `X-Forwarded-For` entry — the one the proxy in front
   * appended — rather than the socket. Default true: the relay is meant to sit behind the site's proxy
   * (Caddy) on loopback. The first entry is whatever the client sent, so it is never used.
   */
  trustProxy?: boolean;
  /** Lifecycle lines only (start, stop, errors). Never a payload, a room id or an address. */
  log?: (line: string) => void;
  now?: () => number;
}

export interface RoomsRelay {
  server: Server;
  stats(): { rooms: number; connections: number };
  /** Closes every member with 1001 and stops listening. */
  close(): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  member: Member;
  address: string;
  room: Room | null;
  alive: boolean;
  messages: Bucket;
  bytes: Bucket;
}

interface Room {
  id: string;
  members: Set<Conn>;
  lastActivity: number;
}

interface AddressUse {
  connections: number;
  /** room id → this address's members in it */
  rooms: Map<string, number>;
}

const PREFIX_BYTES = Buffer.from(SERVER_PREFIX, "utf8");
/** How long a closing connection may take to finish the close handshake before it is cut. */
const CLOSE_GRACE_MS = 5_000;

export function startRoomsRelay(opts: RelayOptions): Promise<RoomsRelay> {
  const limits: RoomLimits = { ...ROOM_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const trustProxy = opts.trustProxy ?? true;
  const rooms = new Map<string, Room>();
  const addresses = new Map<string, AddressUse>();
  const conns = new Set<Conn>();
  /** Every accepted socket, admitted or not, so shutdown can close them all. */
  const sockets = new Set<WebSocket>();
  let closing = false;

  // perMessageDeflate off: compression costs CPU per frame and lets a small frame inflate into a
  // big one. maxPayload makes `ws` close an oversized message with 1009 before it is buffered.
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.messageBytes, perMessageDeflate: false, clientTracking: false });

  const server = createServer((req, res) => answerHttp(req, res));
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    if (!originAllowed(req.headers.origin)) return refuseUpgrade(socket, 403, "Forbidden");
    wss.handleUpgrade(req, socket, head, (ws) => admit(ws, req));
  });
  server.on("clientError", (_err, socket) => socket.destroy());

  function answerHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = pathOf(req.url);
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, ...stats() }));
      return;
    }
    const isRoom = ROOM_ID.test(path.slice(1));
    res.writeHead(isRoom ? 426 : 404, { "content-type": "text/plain", "cache-control": "no-store", ...(isRoom ? { upgrade: "websocket" } : {}) });
    res.end(isRoom ? "websocket only" : "not found");
  }

  function originAllowed(origin: string | undefined): boolean {
    if (origin === undefined || opts.origins === "*") return true;
    return opts.origins.includes(origin);
  }

  function addressOf(req: IncomingMessage): string {
    const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",").pop()!.trim() : "";
    return forwarded || req.socket.remoteAddress || "unknown";
  }

  function shut(ws: WebSocket, code: number): void {
    if (ws.readyState === WebSocket.OPEN) ws.close(code, CLOSE_REASON[code]);
    // A peer that never answers the close frame is cut after a short grace.
    setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
  }

  function admit(ws: WebSocket, req: IncomingMessage): void {
    sockets.add(ws);
    ws.on("error", () => {}); // `ws` closes the socket itself (1009, bad frames); the close event follows
    ws.on("close", () => sockets.delete(ws));
    const url = new URL(req.url ?? "/", "http://rooms.invalid");
    const id = pathOf(req.url).slice(1);
    if (closing) return shut(ws, CLOSE.goingAway);
    if (!ROOM_ID.test(id)) return shut(ws, CLOSE.badRoomId);
    const existing = rooms.get(id);
    if (conns.size >= limits.connections || (!existing && rooms.size >= limits.rooms)) return shut(ws, CLOSE.busy);
    if (existing && existing.members.size >= limits.membersPerRoom) return shut(ws, CLOSE.roomFull);
    const address = addressOf(req);
    const use = addresses.get(address) ?? { connections: 0, rooms: new Map<string, number>() };
    if (use.connections >= limits.connectionsPerAddress) return shut(ws, CLOSE.tooManyRooms);
    if (!use.rooms.has(id) && use.rooms.size >= limits.roomsPerAddress) return shut(ws, CLOSE.tooManyRooms);

    const t = now();
    const room = existing ?? { id, members: new Set<Conn>(), lastActivity: t };
    rooms.set(id, room);
    use.connections++;
    use.rooms.set(id, (use.rooms.get(id) ?? 0) + 1);
    addresses.set(address, use);
    const conn: Conn = {
      ws,
      member: { id: randomBytes(9).toString("base64url"), name: cleanName(url.searchParams.get("name")) },
      address,
      room,
      alive: true,
      messages: new Bucket(limits.messagesPerSecond, limits.messageBurst, t),
      bytes: new Bucket(limits.bytesPerSecond, limits.byteBurst, t),
    };
    const welcome: WelcomeEvent = {
      "potyro-rooms": ROOMS_PROTOCOL,
      type: "welcome",
      room: id,
      you: conn.member,
      members: [...room.members].map((c) => c.member),
      limits: {
        messageBytes: limits.messageBytes,
        membersPerRoom: limits.membersPerRoom,
        messagesPerSecond: limits.messagesPerSecond,
        bytesPerSecond: limits.bytesPerSecond,
        idleMs: limits.idleMs,
      },
    };
    ws.send(JSON.stringify(welcome));
    const joined: JoinEvent = { "potyro-rooms": ROOMS_PROTOCOL, type: "join", member: conn.member };
    broadcast(room, conn, Buffer.from(JSON.stringify(joined)), false);
    room.members.add(conn);
    room.lastActivity = t;
    conns.add(conn);

    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (data: RawData, isBinary: boolean) => relay(conn, data, isBinary));
    ws.on("close", () => leave(conn));
  }

  function relay(conn: Conn, data: RawData, isBinary: boolean): void {
    const room = conn.room;
    if (!room) return; // already on its way out
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    const t = now();
    if (!conn.messages.take(1, t) || !conn.bytes.take(buf.length, t)) return kick(conn, CLOSE.tooFast);
    if (!isBinary && buf.length >= PREFIX_BYTES.length && buf.subarray(0, PREFIX_BYTES.length).equals(PREFIX_BYTES)) {
      return kick(conn, CLOSE.reservedPrefix);
    }
    room.lastActivity = t;
    broadcast(room, conn, buf, isBinary);
  }

  /** Writes a frame to everyone in the room but `from`; a member too far behind is closed instead. */
  function broadcast(room: Room, from: Conn | null, buf: Buffer, isBinary: boolean): void {
    for (const other of room.members) {
      if (other === from || other.ws.readyState !== WebSocket.OPEN) continue;
      if (other.ws.bufferedAmount + buf.length > limits.bufferedBytes) {
        kick(other, CLOSE.tooSlow);
        continue;
      }
      other.ws.send(buf, { binary: isBinary });
    }
  }

  /** Takes a member out of its room at once (the others hear `leave` now), then closes it. */
  function kick(conn: Conn, code: number): void {
    leave(conn);
    shut(conn.ws, code);
  }

  function leave(conn: Conn): void {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.members.delete(conn);
    release(conn, room.id);
    if (room.members.size === 0) {
      rooms.delete(room.id);
      return;
    }
    const left: LeaveEvent = { "potyro-rooms": ROOMS_PROTOCOL, type: "leave", member: conn.member };
    broadcast(room, null, Buffer.from(JSON.stringify(left)), false);
  }

  /** Gives back what a member counted against the relay and its address. */
  function release(conn: Conn, roomId: string): void {
    conns.delete(conn);
    const use = addresses.get(conn.address);
    if (!use) return;
    use.connections--;
    const inRoom = (use.rooms.get(roomId) ?? 1) - 1;
    if (inRoom > 0) use.rooms.set(roomId, inRoom);
    else use.rooms.delete(roomId);
    if (use.connections <= 0) addresses.delete(conn.address);
  }

  // Keepalive: a member that has not answered the previous ping is gone (a phone that lost its
  // network sends no close frame). Browsers answer pings on their own.
  const pinger = setInterval(() => {
    for (const conn of [...conns]) {
      if (!conn.alive) {
        leave(conn);
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, limits.pingMs);
  pinger.unref();

  const sweeper = setInterval(
    () => {
      const t = now();
      for (const room of [...rooms.values()]) {
        if (t - room.lastActivity < limits.idleMs) continue;
        // The whole room goes at once: nobody is told about the others leaving.
        for (const conn of room.members) {
          conn.room = null;
          release(conn, room.id);
          shut(conn.ws, CLOSE.idle);
        }
        room.members.clear();
        rooms.delete(room.id);
      }
    },
    Math.max(10, Math.min(60_000, Math.floor(limits.idleMs / 4))),
  );
  sweeper.unref();

  function stats(): { rooms: number; connections: number } {
    return { rooms: rooms.size, connections: conns.size };
  }

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    clearInterval(pinger);
    clearInterval(sweeper);
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.close(CLOSE.goingAway, CLOSE_REASON[CLOSE.goingAway]);
    const deadline = Date.now() + 2_000;
    while (sockets.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    for (const ws of sockets) ws.terminate();
    wss.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    log("[rooms] stopped");
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve({ server, stats, close });
    });
  });
}

/** The path without the query and without a `/rooms` prefix the proxy may have left on. */
function pathOf(url: string | undefined): string {
  return (url ?? "/").split("?")[0]!.replace(/^\/rooms(?=\/|$)/, "") || "/";
}

function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
