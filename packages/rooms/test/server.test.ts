import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_ORIGINS, limitsFromEnv, originsFromEnv } from "../src/server.ts";
import { CLOSE, newRoomId } from "../src/protocol.ts";
import { connect, join } from "./helpers.ts";

describe("configuration from the environment", () => {
  it("reads each limit it is given and leaves the rest to the defaults", () => {
    expect(limitsFromEnv({})).toEqual({});
    expect(limitsFromEnv({ ROOMS_MAX_MEMBERS: "8", ROOMS_MAX_MESSAGE_BYTES: "1024", ROOMS_IDLE_MS: "" })).toEqual({ membersPerRoom: 8, messageBytes: 1024 });
  });

  it("refuses a limit that is not a positive number", () => {
    expect(() => limitsFromEnv({ ROOMS_MAX_MEMBERS: "lots" })).toThrow("ROOMS_MAX_MEMBERS must be a positive number");
    expect(() => limitsFromEnv({ ROOMS_PER_ADDRESS: "0" })).toThrow("ROOMS_PER_ADDRESS");
  });

  it("allows the site and the Android app by default, a list, or any origin", () => {
    expect(originsFromEnv(undefined)).toEqual(DEFAULT_ORIGINS);
    expect(DEFAULT_ORIGINS).toEqual(["https://potyro.app", "https://localhost", "capacitor://localhost"]);
    expect(originsFromEnv(" https://a.example , https://b.example ")).toEqual(["https://a.example", "https://b.example"]);
    expect(originsFromEnv("*")).toBe("*");
  });
});

// The server is deployed on Node 22 (docs/16), which runs TypeScript with --experimental-strip-types
// from 22.6. CI's own Node may be older (vazio runs 20), where the flag does not exist: the deployed
// start is then not something this machine can check, and the test says so instead of failing.
const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
const STRIPS_TYPES = major > 22 || (major === 22 && minor >= 6);

describe("the process", () => {
  let child: ChildProcess | null = null;
  afterEach(() => {
    child?.kill("SIGKILL");
    child = null;
  });

  it.skipIf(!STRIPS_TYPES)("starts as deployed (node --experimental-strip-types src/server.ts), relays, and closes members with 1001 on SIGTERM", async () => {
    const entry = fileURLToPath(new URL("../src/server.ts", import.meta.url));
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", ROOMS_MAX_MEMBERS: "2" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child!.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /listening on 127\.0\.0\.1:(\d+)/.exec(out);
        if (m) resolve(Number(m[1]));
      });
      child!.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      child!.once("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    expect(await (await fetch(`http://127.0.0.1:${port}/rooms/health`)).json()).toMatchObject({ ok: true });

    const room = newRoomId();
    const url = `ws://127.0.0.1:${port}/rooms/${room}`;
    const a = await join(url);
    const b = await join(url);
    await a.nextEvent();
    b.ws.send("hi");
    expect((await a.next()).data).toBe("hi");
    const c = await connect(url); // the env's ROOMS_MAX_MEMBERS=2 is in force
    expect((await c.closed).code).toBe(CLOSE.roomFull);

    const exited = new Promise<number | null>((resolve) => child!.once("exit", resolve));
    child.kill("SIGTERM");
    expect((await a.closed).code).toBe(CLOSE.goingAway);
    expect(await exited).toBe(0);
  }, 20_000);
});
