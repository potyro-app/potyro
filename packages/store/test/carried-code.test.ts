// The app's code beyond its source, as it travels WITH the source (#281): to a guest through the
// shared space, and to your other devices through your account.
//
// The lock goes whole; the app's own modules go as text, checked against it on arrival; library bytes
// do not go at all. These pin that format, and that a record from before it — or a broken one — still
// reads as an app.
import { describe, expect, it } from "vitest";
import { carriedModuleFiles, carryCode, lockEntryFor, LockError, moduleFileFor, readCarriedCode, sameCode, type AppLock } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const LIB = "https://esm.sh/fancy-sum@1.2.3?bundle";
const PLAN = "export const weeks = 12;\n";

async function lockFor(): Promise<{ lock: AppLock; libFile: string; libBytes: Uint8Array }> {
  const libBytes = enc("export const sum = (a, b) => a + b;");
  const libFile = await moduleFileFor(libBytes);
  return {
    lock: { [LIB]: await lockEntryFor(libFile, libBytes), "src/plan.ts": await lockEntryFor(".src/plan.ts", enc(PLAN)) },
    libFile,
    libBytes,
  };
}

describe("carrying an app's code with its source", () => {
  it("carries the whole lock and the app's own modules as text — never a library's bytes", async () => {
    const { lock, libFile, libBytes } = await lockFor();
    const files = new Map([[libFile, libBytes], [".src/plan.ts", enc(PLAN)]]);
    const carried = await carryCode(lock, async (f) => files.get(f) ?? null);
    expect(carried.lock).toEqual(lock);
    expect(carried.modules).toEqual({ "src/plan.ts": PLAN });
    expect(JSON.stringify(carried)).not.toContain("a + b");
  });

  it("carries nothing for an app that is one file", async () => {
    expect(await carryCode(undefined, async () => null)).toEqual({});
    expect(await carryCode({}, async () => null)).toEqual({});
  });

  it("leaves out a module whose bytes are not on this device, or no longer match", async () => {
    const { lock } = await lockFor();
    expect((await carryCode(lock, async () => null)).modules).toBeUndefined();
    expect((await carryCode(lock, async (f) => (f === ".src/plan.ts" ? enc("changed") : null))).modules).toBeUndefined();
  });
});

describe("reading carried code from a record", () => {
  it("reads it back exactly", async () => {
    const { lock } = await lockFor();
    const raw = JSON.parse(JSON.stringify({ source: "x", lock, modules: { "src/plan.ts": PLAN } })) as Record<string, unknown>;
    expect(readCarriedCode(raw)).toEqual({ lock, modules: { "src/plan.ts": PLAN } });
  });

  it("reads a record from before the lock travelled as an app with no code beyond its source", () => {
    expect(readCarriedCode({ source: "x", name: "Old" })).toEqual({});
  });

  it("drops a malformed lock rather than the app", () => {
    expect(readCarriedCode({ lock: "nope" })).toEqual({});
    expect(readCarriedCode({ lock: { "http://insecure.example/x@1.0.0": { file: ".modules/x.js", integrity: "sha256-x", size: 1 } } })).toEqual({});
    // A module the lock does not name, or one that is not text, is not carried code.
    expect(readCarriedCode({ modules: { "src/plan.ts": PLAN } })).toEqual({});
  });

  it("keeps only modules the lock names, as text", async () => {
    const { lock } = await lockFor();
    const got = readCarriedCode({ lock, modules: { "src/plan.ts": PLAN, "src/other.ts": "x", "src/bad.ts": 3 } });
    expect(got.modules).toEqual({ "src/plan.ts": PLAN });
  });
});

describe("the modules that arrived", () => {
  it("become files for the app's .src/ folder", async () => {
    const { lock } = await lockFor();
    const files = await carriedModuleFiles({ lock, modules: { "src/plan.ts": PLAN } });
    expect(files.map((f) => [f.path, new TextDecoder().decode(f.data)])).toEqual([[".src/plan.ts", PLAN]]);
  });

  it("are refused by name when they are not what the lock says", async () => {
    const { lock } = await lockFor();
    const changed = carriedModuleFiles({ lock, modules: { "src/plan.ts": "export const weeks = 99;\n" } });
    await expect(changed).rejects.toBeInstanceOf(LockError);
    await expect(changed).rejects.toThrow("Its file plan.ts is not the copy this app was saved with");
  });
});

describe("whether two copies run the same code", () => {
  it("compares locks, not the order their entries were written in", async () => {
    const { lock } = await lockFor();
    const reversed = Object.fromEntries(Object.entries(lock).reverse());
    expect(sameCode(lock, reversed)).toBe(true);
    expect(sameCode(lock, undefined)).toBe(false);
    expect(sameCode(undefined, {})).toBe(true);
    expect(sameCode(lock, { ...lock, [LIB]: { ...lock[LIB]!, size: 1 } })).toBe(false);
  });
});
