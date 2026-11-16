// A real gate on an ephemeral port, a real websocket server standing in for the relay behind it, and
// real `ws` clients.
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { connect as tcpConnect, createServer as createTcpServer, type AddressInfo, type Server, type Socket } from "node:net";
import { startSyncGate, type GateOptions, type SyncGate } from "../src/gate.ts";

const gates: SyncGate[] = [];
const relays: WebSocketServer[] = [];
const clients: WebSocket[] = [];
const raws: Array<{ server: Server; sockets: Socket[] }> = [];
const rawSockets: Socket[] = [];

export interface FakeRelay {
  port: number;
  /** Every upgrade request the relay got. */
  requests: IncomingMessage[];
  /** Every message it got, in order, with when. */
  got: Array<{ bytes: number; text: string; at: number }>;
  sockets: WebSocket[];
  wss: WebSocketServer;
}

/** A websocket server that greets each connection (as jazz-run's first ping does) and echoes nothing. */
export async function fakeRelay(): Promise<FakeRelay> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  relays.push(wss);
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const out: FakeRelay = { port: (wss.address() as AddressInfo).port, requests: [], got: [], sockets: [], wss };
  wss.on("connection", (ws, req) => {
    out.requests.push(req);
    out.sockets.push(ws);
    ws.on("error", () => {});
    ws.on("message", (data: RawData, binary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
      out.got.push({ bytes: buf.length, text: binary ? "" : buf.toString("utf8"), at: Date.now() });
    });
    ws.send('{"type":"ping"}');
  });
  return out;
}

export async function gate(relay: { port: number }, opts: Partial<GateOptions> = {}): Promise<{ gate: SyncGate; url: string; port: number }> {
  const g = await startSyncGate({ port: 0, host: "127.0.0.1", upstream: { host: "127.0.0.1", port: relay.port }, ...opts });
  gates.push(g);
  const { port } = g.server.address() as AddressInfo;
  return { gate: g, port, url: `ws://127.0.0.1:${port}/` };
}

export async function cleanup(): Promise<void> {
  for (const ws of clients.splice(0)) ws.terminate();
  for (const s of rawSockets.splice(0)) s.destroy();
  await Promise.all(gates.splice(0).map((g) => g.close()));
  for (const raw of raws.splice(0)) {
    for (const s of raw.sockets) s.destroy();
    await new Promise<void>((r) => raw.server.close(() => r()));
  }
  for (const wss of relays.splice(0)) {
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
  }
}

export interface Opened {
  ws: WebSocket;
  /** Messages received, in order. */
  messages: string[];
  closed: Promise<{ code: number; reason: string }>;
}

export interface Refused {
  status: number;
  retryAfter: string | undefined;
}

/** Tries to connect: the open socket (after the relay's greeting came through), or the HTTP refusal. */
export function attempt(url: string, headers: Record<string, string> = {}, protocols?: string[]): Promise<Opened | Refused> {
  return new Promise((resolve, reject) => {
    const ws = protocols ? new WebSocket(url, protocols, { headers }) : new WebSocket(url, { headers });
    clients.push(ws);
    const messages: string[] = [];
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: reason.toString() })));
    ws.on("unexpected-response", (_req, res) => {
      resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string | undefined });
      res.resume();
    });
    ws.on("message", (data: RawData) => {
      messages.push(data.toString());
      if (messages.length === 1) resolve({ ws, messages, closed });
    });
    ws.on("error", (e) => {
      if (!/Unexpected server response/.test(e.message)) reject(e);
    });
    setTimeout(() => reject(new Error("no answer from the gate")), 4000).unref();
  });
}

export async function open(url: string, headers: Record<string, string> = {}, protocols?: string[]): Promise<Opened> {
  const r = await attempt(url, headers, protocols);
  if (!("ws" in r)) throw new Error(`refused with ${r.status}`);
  return r;
}

export async function refusal(url: string, headers: Record<string, string> = {}, protocols?: string[]): Promise<Refused> {
  const r = await attempt(url, headers, protocols);
  if ("ws" in r) throw new Error("the gate let it through");
  return r;
}

/**
 * A relay that is a bare TCP server: it answers the upgrade as a websocket server does and then does
 * what `then` says with the socket — for what no websocket library will send. `got` is every byte
 * that came after the upgrade.
 */
export async function rawRelay(then: (socket: Socket) => void = () => {}): Promise<{ port: number; got: () => Buffer; sockets: Socket[] }> {
  let got = Buffer.alloc(0);
  const sockets: Socket[] = [];
  const server = createTcpServer((s) => {
    sockets.push(s);
    let head = Buffer.alloc(0);
    let upgraded = false;
    s.on("error", () => {});
    s.on("data", (d: Buffer) => {
      if (upgraded) return void (got = Buffer.concat([got, d]));
      head = Buffer.concat([head, d]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      upgraded = true;
      const key = /Sec-WebSocket-Key: (\S+)/.exec(head.toString("latin1"))![1]!;
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      got = Buffer.concat([got, head.subarray(end + 4)]);
      then(s);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  raws.push({ server, sockets });
  return { port: (server.address() as AddressInfo).port, got: () => got, sockets };
}

/** A websocket frame by hand; the payload is zeros (masked with a zero key, so it is zeros on the wire too). */
export function rawFrame(opcode: number, length: number, opts: { masked?: boolean; fin?: boolean; rsv?: boolean } = {}): Buffer {
  const masked = opts.masked ?? true;
  const head: number[] = [(opts.fin === false ? 0 : 0x80) | (opts.rsv ? 0x40 : 0) | opcode];
  const bit = masked ? 0x80 : 0;
  if (length < 126) head.push(bit | length);
  else if (length < 65536) head.push(bit | 126, length >> 8, length & 0xff);
  else head.push(bit | 127, 0, 0, 0, 0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  return Buffer.concat([Buffer.from(head), Buffer.alloc((masked ? 4 : 0) + length)]);
}

/** A client that is a bare TCP socket, upgraded: for leaving, and for sending, as no websocket library does. */
export async function rawClient(port: number, headers: Record<string, string> = {}): Promise<{ socket: Socket; status: string; got: () => Buffer }> {
  const socket = tcpConnect({ port, host: "127.0.0.1" });
  socket.on("error", () => {});
  let got = Buffer.alloc(0);
  socket.on("data", (d: Buffer) => (got = Buffer.concat([got, d])));
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  socket.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\n`);
  await until(() => got.includes("\r\n\r\n"));
  const end = got.indexOf("\r\n\r\n");
  const status = got.subarray(0, got.indexOf("\r\n")).toString("latin1");
  got = got.subarray(end + 4);
  rawSockets.push(socket);
  return { socket, status, got: () => got };
}

export const from = (address: string): Record<string, string> => ({ "x-forwarded-for": address });

export async function until(what: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 10));
  }
}
