// Real `ws` clients against a real relay on an ephemeral port.
import { WebSocket, type RawData } from "ws";
import type { AddressInfo } from "node:net";
import { startRoomsRelay, type RelayOptions, type RoomsRelay } from "../src/relay.ts";
import { newRoomId, type ServerEvent, type WelcomeEvent } from "../src/protocol.ts";

export interface Frame {
  data: string | Buffer;
  binary: boolean;
}

export interface Client {
  ws: WebSocket;
  welcome: WelcomeEvent;
  /** The next frame, server event or peer message, in order. */
  next(ms?: number): Promise<Frame>;
  /** The next frame that is a server event, parsed. */
  nextEvent(ms?: number): Promise<ServerEvent>;
  /** Resolves when the relay closes the connection. */
  closed: Promise<{ code: number; reason: string }>;
  /** Frames received and not yet taken. */
  pending(): Frame[];
}

const running: RoomsRelay[] = [];
const clients: WebSocket[] = [];

export async function relay(opts: Partial<RelayOptions> = {}): Promise<{ relay: RoomsRelay; url: (room: string, query?: string) => string; port: number }> {
  const r = await startRoomsRelay({ port: 0, host: "127.0.0.1", origins: ["https://apps.vaz.io"], ...opts });
  running.push(r);
  const { port } = r.server.address() as AddressInfo;
  return { relay: r, port, url: (room, query = "") => `ws://127.0.0.1:${port}/rooms/${room}${query}` };
}

export async function cleanup(): Promise<void> {
  for (const ws of clients.splice(0)) ws.terminate();
  await Promise.all(running.splice(0).map((r) => r.close()));
}

/** Opens a connection and resolves once it is open, with every frame queued from the first. */
export function connect(
  url: string,
  headers: Record<string, string> = { origin: "https://apps.vaz.io" },
  options: { autoPong?: boolean } = {},
): Promise<Omit<Client, "welcome">> {
  const ws = new WebSocket(url, { headers, ...options });
  clients.push(ws);
  const queue: Frame[] = [];
  const waiters: Array<(f: Frame) => void> = [];
  ws.on("message", (data: RawData, binary: boolean) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    const frame: Frame = { data: binary ? buf : buf.toString("utf8"), binary };
    const w = waiters.shift();
    if (w) w(frame);
    else queue.push(frame);
  });
  ws.on("error", () => {});
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  const next = (ms = 2000): Promise<Frame> => {
    const f = queue.shift();
    if (f) return Promise.resolve(f);
    return new Promise((resolve, reject) => {
      const waiter = (frame: Frame): void => (clearTimeout(t), resolve(frame));
      const t = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error("no frame arrived"));
      }, ms);
      waiters.push(waiter);
    });
  };
  const nextEvent = async (ms?: number): Promise<ServerEvent> => {
    const f = await next(ms);
    if (typeof f.data !== "string" || !f.data.startsWith('{"potyro-rooms":')) throw new Error(`expected a server event, got ${String(f.data)}`);
    return JSON.parse(f.data) as ServerEvent;
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, next, nextEvent, closed, pending: () => queue }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

/** Joins a room and takes the welcome. */
export async function join(url: string, headers?: Record<string, string>): Promise<Client> {
  const c = await connect(url, headers);
  const welcome = (await c.nextEvent()) as WelcomeEvent;
  if (welcome.type !== "welcome") throw new Error(`expected welcome, got ${welcome.type}`);
  return { ...c, welcome };
}

/** Resolves true if no frame arrives within `ms`. */
export async function silent(c: Pick<Client, "next">, ms = 150): Promise<boolean> {
  try {
    await c.next(ms);
    return false;
  } catch {
    return true;
  }
}

export { newRoomId };
