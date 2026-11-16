// A real gate on an ephemeral port, a real websocket server standing in for the relay behind it, and
// real `ws` clients.
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { startSyncGate, type GateOptions, type SyncGate } from "../src/gate.ts";

const gates: SyncGate[] = [];
const relays: WebSocketServer[] = [];
const clients: WebSocket[] = [];

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
  await Promise.all(gates.splice(0).map((g) => g.close()));
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

export const from = (address: string): Record<string, string> => ({ "x-forwarded-for": address });

export async function until(what: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 10));
  }
}
