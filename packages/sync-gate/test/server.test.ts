import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { limitsFromEnv, originsFromEnv, upstreamFromEnv } from "../src/server.ts";
import { CLOSE, GATE_LIMITS } from "../src/limits.ts";
import { cleanup, fakeRelay, from, open, refusal } from "./helpers.ts";

afterEach(cleanup);

describe("configuration from the environment", () => {
  it("reads each limit it is given and leaves the rest to the defaults", () => {
    expect(limitsFromEnv({})).toEqual({});
    expect(limitsFromEnv({ SYNC_CONNECTIONS_PER_ADDRESS: "8", SYNC_BYTES_DAY: "5000000000", SYNC_MAX_MESSAGE_BYTES: "" })).toEqual({
      connectionsPerAddress: 8,
      bytesPerDay: 5_000_000_000,
    });
  });

  it("refuses a limit that is not a positive number: a typo never turns a limit off", () => {
    expect(() => limitsFromEnv({ SYNC_BYTES_PER_SECOND: "lots" })).toThrow("SYNC_BYTES_PER_SECOND must be a positive number");
    expect(() => limitsFromEnv({ SYNC_CONNECTIONS_PER_ADDRESS: "0" })).toThrow("SYNC_CONNECTIONS_PER_ADDRESS");
    expect(() => limitsFromEnv({ SYNC_BYTES_DAY: "-1" })).toThrow("SYNC_BYTES_DAY");
  });

  it("has defaults that hold with nothing set: every limit is a positive number", () => {
    for (const [name, value] of Object.entries(GATE_LIMITS)) expect(value, name).toBeGreaterThan(0);
    // One message always fits the burst, or a single long edit could never be sent.
    expect(GATE_LIMITS.byteBurst).toBeGreaterThanOrEqual(GATE_LIMITS.messageBytes);
    expect(GATE_LIMITS.bytesPerDay).toBeGreaterThanOrEqual(GATE_LIMITS.bytesPerAddressDay);
  });

  it("reads where the relay is, and which origins may connect", () => {
    expect(upstreamFromEnv(undefined)).toEqual({ host: "127.0.0.1", port: 4201 });
    expect(upstreamFromEnv("potyro-relay:4201")).toEqual({ host: "potyro-relay", port: 4201 });
    expect(upstreamFromEnv("[::1]:4201")).toEqual({ host: "::1", port: 4201 });
    expect(() => upstreamFromEnv("4201")).toThrow("SYNC_UPSTREAM must be host:port");
    expect(() => upstreamFromEnv("relay:99999")).toThrow("SYNC_UPSTREAM");
    expect(originsFromEnv(undefined)).toBe("*");
    expect(originsFromEnv(" https://potyro.app , https://localhost ")).toEqual(["https://potyro.app", "https://localhost"]);
  });
});

// The gate is deployed on Node 22 (docs/16), which runs TypeScript with --experimental-strip-types
// from 22.6. A machine with an older Node cannot check the deployed start, and the test says so.
const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
const STRIPS_TYPES = major > 22 || (major === 22 && minor >= 6);

describe("the process", () => {
  let child: ChildProcess | null = null;
  afterEach(() => {
    child?.kill("SIGKILL");
    child = null;
  });

  it.skipIf(!STRIPS_TYPES)("starts as deployed (node --experimental-strip-types src/server.ts), holds the env's limits, and closes with 1001 on SIGTERM", async () => {
    const relay = await fakeRelay();
    const entry = fileURLToPath(new URL("../src/server.ts", import.meta.url));
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", SYNC_UPSTREAM: `127.0.0.1:${relay.port}`, SYNC_CONNECTIONS_PER_ADDRESS: "1", TRUST_PROXY: "caddy" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const port = await new Promise<number>((resolve, reject) => {
      child!.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /listening on 127\.0\.0\.1:(\d+)/.exec(out);
        if (m) resolve(Number(m[1]));
      });
      child!.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      child!.once("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true, connections: 0 });

    const url = `ws://127.0.0.1:${port}/`;
    const a = await open(url, from("9.9.9.9"));
    a.ws.send("hello");
    expect((await refusal(url, from("6.6.6.6, 9.9.9.9"))).status).toBe(429);

    const exited = new Promise<number | null>((resolve) => child!.once("exit", resolve));
    child.kill("SIGTERM");
    expect((await a.closed).code).toBe(CLOSE.goingAway);
    expect(await exited).toBe(0);
    expect(out).not.toContain("9.9.9.9");
    expect(out).toContain('"too-many-connections":1');
  }, 20_000);

  it.skipIf(!STRIPS_TYPES)("does not start on a setting it cannot read", async () => {
    const entry = fileURLToPath(new URL("../src/server.ts", import.meta.url));
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], {
      env: { ...process.env, PORT: "0", TRUST_PROXY: "apache" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
    expect(await new Promise<number | null>((resolve) => child!.once("exit", resolve))).toBe(1);
    expect(err).toContain("TRUST_PROXY must be one of caddy, none");
  }, 20_000);
});
