// The Android app's ws:// client for the local network (android-templates/LocalWebSocket.java,
// docs/28 §6), run on a desktop JVM against real servers on 127.0.0.1: an echo server, a port with
// nothing on it, and one that refuses the upgrade with 403. Skipped where there is no JDK (javac).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const templates = fileURLToPath(new URL("../android-templates/", import.meta.url));
// The rooms relay's own `ws`, for the echo server: no new dependency for a test.
const { WebSocketServer } = createRequire(new URL("../../rooms/package.json", import.meta.url))("ws") as typeof import("ws");

function javaHome(): string | null {
  const candidates = [process.env.JAVA_HOME, join(homedir(), "android-studio", "jbr")].filter((x): x is string => Boolean(x));
  for (const c of candidates) if (existsSync(join(c, "bin", "javac"))) return c;
  const which = spawnSync("which", ["javac"], { encoding: "utf8" });
  return which.status === 0 && which.stdout.trim() ? join(which.stdout.trim(), "..", "..") : null;
}

const JAVA = javaHome();
const servers: Array<{ close(cb: () => void): void }> = [];
let echoPort = 0;
let forbiddenPort = 0;
let deadPort = 0;

const listen = async (s: Server): Promise<number> => {
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  servers.push(s);
  return (s.address() as AddressInfo).port;
};

beforeAll(async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", handleProtocols: (p: Set<string>) => (p.has("v1") ? "v1" : false) });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  wss.on("connection", (ws) => ws.on("message", (data, isBinary) => ws.send(data, { binary: isBinary })));
  servers.push(wss);
  echoPort = (wss.address() as AddressInfo).port;
  const forbidden = createServer();
  forbidden.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
  forbiddenPort = await listen(forbidden);
  const dead = createServer();
  deadPort = await listen(dead);
  await new Promise<void>((resolve) => dead.close(() => resolve())); // a port with nothing on it now
  servers.splice(servers.indexOf(dead), 1);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe.skipIf(!JAVA)("LocalWebSocket (the Android app's ws:// to the local network)", () => {
  it("talks to a real server, and refuses what is not on the local network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "potyro-localws-"));
    try {
      const pkg = join(dir, "src", "app", "potyro");
      mkdirSync(pkg, { recursive: true });
      for (const [from, to] of [
        ["LocalWebSocket.java", "LocalWebSocket.java"],
        ["test/LocalWebSocketTest.java", "LocalWebSocketTest.java"],
      ] as const) {
        writeFileSync(join(pkg, to), readFileSync(join(templates, from), "utf8").replaceAll("__PACKAGE__", "app.potyro"));
      }
      const out = join(dir, "out");
      execFileSync(join(JAVA!, "bin", "javac"), ["-d", out, join(pkg, "LocalWebSocket.java"), join(pkg, "LocalWebSocketTest.java")], { stdio: "pipe" });
      // Not spawnSync: the servers are in this process, and a blocked event loop answers nobody.
      const run = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
        const child = spawn(join(JAVA!, "bin", "java"), ["-cp", out, "app.potyro.LocalWebSocketTest", String(echoPort), String(deadPort), String(forbiddenPort)]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        const timer = setTimeout(() => child.kill(), 60_000);
        child.on("close", () => {
          clearTimeout(timer);
          resolve({ stdout, stderr });
        });
      });
      expect(run.stdout, run.stderr).toContain("ALL OK");
      expect(run.stdout).not.toContain("FAIL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
