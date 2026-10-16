import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

// Local servers for the live-connection specs (docs/28): an echo server, and Potyro's own rooms relay
// started the way it is deployed (`node --experimental-strip-types packages/rooms/src/server.ts`). No
// network beyond 127.0.0.1.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// The relay's own `ws`, so the test speaks the same library the relay does.
const requireFromRooms = createRequire(new URL("../packages/rooms/package.json", import.meta.url));
const { WebSocketServer } = requireFromRooms("ws") as typeof import("ws");

export interface EchoServer {
  port: number;
  /** Connections open right now. */
  open(): number;
  /** Every connection ever made, with the path it asked for. */
  paths: string[];
  close(): Promise<void>;
}

/** Sends every message back as it came: text as text, binary as binary. */
export async function startEcho(): Promise<EchoServer> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const live = new Set<unknown>();
  const paths: string[] = [];
  wss.on("connection", (ws, req) => {
    live.add(ws);
    paths.push(req.url ?? "");
    ws.on("message", (data, isBinary) => ws.send(data, { binary: isBinary }));
    ws.on("close", () => live.delete(ws));
  });
  return {
    port: (wss.address() as AddressInfo).port,
    open: () => live.size,
    paths,
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

export interface RoomsRelay {
  /** `ws://127.0.0.1:<port>` — the relay serves `/rooms/<roomId>`. */
  origin: string;
  stop(): Promise<void>;
}

/**
 * How to start the relay with the Node running these tests. The deployed way, type stripping, needs
 * Node 22.6+; on an older Node (vazio's CI runs 20) the same source is bundled with the shell's
 * esbuild into dist/, next to the relay's own node_modules, and run as plain JavaScript.
 */
async function relayArgs(): Promise<string[]> {
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  if (major > 22 || (major === 22 && minor >= 6)) return ["--experimental-strip-types", "--no-warnings", "packages/rooms/src/server.ts"];
  const { build } = createRequire(new URL("../packages/shell/package.json", import.meta.url))("esbuild") as typeof import("esbuild");
  // One file per process: ci-local runs several copies of the suite at once from one checkout, and a
  // shard overwriting the bundle another shard is starting would hand it half a file.
  const outfile = fileURLToPath(new URL(`../packages/rooms/dist/e2e-server-${process.pid}.mjs`, import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("../packages/rooms/src/server.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", packages: "external", outfile, logLevel: "silent" });
  return [outfile];
}

/** The real relay, as a process, letting browsers in only from `allowOrigin` (the shell's page). */
export async function startRoomsRelay(allowOrigin: string): Promise<RoomsRelay> {
  const port = await freePort();
  const child = spawn(process.execPath, await relayArgs(), {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ROOMS_ORIGINS: allowOrigin, ROOMS_TRUST_PROXY: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  const end = Date.now() + 15_000;
  while (!(await listening(port))) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`the rooms relay did not start: ${output}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    origin: `ws://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

/**
 * Point the shell's rooms at the local relay. Deployed, the shell connects to its site's own
 * `/rooms/<id>` (docs/26); the dev server has no relay behind that path, so a development build takes
 * the address from `potyro:dev:rooms` (app-sockets.ts — never a production build). The browser then
 * connects straight to the real relay, with the page's own Origin, which the relay checks.
 */
export async function routeRooms(page: Page, relay: RoomsRelay): Promise<void> {
  await page.addInitScript((url) => localStorage.setItem("potyro:dev:rooms", url), `${relay.origin}/rooms`);
}
