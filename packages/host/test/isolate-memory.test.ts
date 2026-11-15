// What one shared app may hold in the QuickJS isolate (docs/07, docs/22 §6.1).
//
// The engine's own limit never added up what a box held — only one allocation larger than the
// limit was refused — so a box that kept many buffers grew its WebAssembly memory to 2 GB, in the
// shell's own process. Each box now lives in a memory with a maximum (bounded-memory.ts): the engine
// is refused past it, the box is stopped, and what it held is let go.

import { describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import * as quickjsEngine from "quickjs-emscripten";
import { FakeCapabilities } from "@potyro/capabilities";
import { MemoryStore } from "@potyro/store";
import { createHost, HostFault, type LoadedApp, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { boundedContexts, createIsolateLoader, DEFAULT_MEMORY, type QuickJSAsyncContextLike, type QuickJSEngine } from "../src/isolate/index.js";

const MB = 1024 * 1024;
const engine = quickjsEngine as unknown as QuickJSEngine;

setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
/** True once nothing holds any of `refs` any more. */
async function gone(refs: Array<WeakRef<object>>): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    collect();
    if (refs.every((r) => r.deref() === undefined)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

const definition = {
  id: "hoard",
  name: "Hoard",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { camera: true },
  entities: { run: { fields: { out: { type: "text" }, photo: { type: "media" } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "run", display: { primary: "out" } } }],
};

interface Box {
  loaded: LoadedApp;
  call(action: string): Promise<string>;
  /** The engine's memory, in bytes, now — and the most it was seen at. */
  bytes(): number;
  /** Nothing in the test holds the memory after this; `memory` says when nothing else does either. */
  memory: WeakRef<object>;
  store: MemoryStore;
}

/** A box with these actions (each an async function's body over `r`, `ctx`), and a look at its memory. */
async function open(actions: Record<string, string>, opts: { limit?: number; top?: string; picture?: Blob } = {}): Promise<Box> {
  const store = new MemoryStore();
  await store.open("hoard");
  const caps = new FakeCapabilities({});
  if (opts.picture) caps.camera = { capture: async () => opts.picture! };
  let memory!: WebAssembly.Memory;
  const host = createHost({
    loadIsolated: await createIsolateLoader({
      store,
      newContext: (m) => ((memory = m), boundedContexts(engine)(m)),
      // Filling 96 MB with small things takes most of the ordinary second on a busy machine.
      timeoutMs: 20_000,
      loadTimeoutMs: 20_000,
      ...(opts.limit ? { memoryLimitBytes: opts.limit } : {}),
    }),
  });
  const source = Object.entries(actions)
    .map(([name, body]) => `${JSON.stringify(name)}: async function (r, ctx) { ${body} }`)
    .join(",");
  const code = `${opts.top ?? ""}; globalThis.__potyroApp = ${JSON.stringify(definition).replace(/"photo":\{"type":"media"\}\}/, () => `"photo":{"type":"media"}},"actions":{${source}}`)};`;
  let loaded: LoadedApp;
  try {
    loaded = await host.load({ kind: "bundle", code, provenance: "untrusted" });
  } catch (e) {
    // The memory the failed load was given, for whoever asks what became of it.
    (e as { memory?: WeakRef<object>; bytes?: number }).memory = new WeakRef(memory);
    (e as { bytes?: number }).bytes = memory.buffer.byteLength;
    // An error keeps the frames it was thrown through until its stack is read, and this closure with them.
    memory = undefined as never;
    throw e;
  }
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  const row = await store.insert("run", { out: "" });
  const ref = new WeakRef(memory);
  const peek = (): number => ref.deref()?.buffer.byteLength ?? 0;
  memory = undefined as never;
  return {
    loaded,
    async call(action) {
      await loaded.callAction("run", action, { ...(await store.get("run", row.id))! } as never, ctx);
      return String((await store.get("run", row.id))!.out);
    },
    bytes: peek,
    memory: ref as WeakRef<object>,
    store,
  };
}

/** How a call ended: the fault it was stopped with, or what it threw instead. */
async function fault(run: Promise<unknown>): Promise<{ why: string; message: string }> {
  try {
    await run;
  } catch (e) {
    if (e instanceof HostFault) return { why: e.why, message: e.message };
    return { why: `not a HostFault: ${(e as Error).name}`, message: String((e as Error).message) };
  }
  return { why: "it was not stopped", message: "" };
}

const STOPPED = { why: "stopped", message: "stopped: the app asked for more memory than a shared app may hold (96 MB)" };

/** Ways to keep more and more, each piece well under the limit. `keep` outlives the call. */
const HOARDS: Record<string, string> = {
  "typed arrays": `globalThis.keep = []; for (var i = 0; i < 400; i++) keep.push(new Uint8Array(8 * 1024 * 1024));`,
  "array buffers": `globalThis.keep = []; for (var i = 0; i < 400; i++) keep.push(new ArrayBuffer(8 * 1024 * 1024));`,
  "strings": `globalThis.keep = []; for (var i = 0; i < 3200; i++) keep.push("x".repeat(1024 * 1024) + i);`,
  "plain arrays": `globalThis.keep = []; for (var i = 0; i < 3200; i++) keep.push(Array(131072).fill(i));`,
  "small objects": `globalThis.keep = []; for (;;) keep.push({ a: keep.length, b: [keep.length] });`,
};

describe("a shared app's memory in the QuickJS isolate", () => {
  for (const [what, body] of Object.entries(HOARDS)) {
    it(`stops an app that keeps ${what} past the limit, and holds none of it afterwards`, async () => {
      const box = await open({ hoard: body, after: `await ctx.patch("run", r.id, { out: "still here" });` });
      const before = box.bytes();
      expect(await fault(box.call("hoard"))).toEqual(STOPPED);
      // The engine never had more than the limit: 3.2 GB was asked for, in pieces of at most 8 MB.
      expect(before).toBeLessThanOrEqual(16 * MB);
      // It is over for this box: the next call is answered the same, and nothing of its runs.
      expect(await fault(box.call("after"))).toEqual(STOPPED);
      expect((await box.store.all("run"))[0]!.out).toBe("");
      // And its memory is let go though the app is still held (a screen that has not unmounted).
      expect(await gone([box.memory])).toBe(true);
      expect(box.loaded.definition.id).toBe("hoard");
    }, 30_000);
  }

  it("never lets the engine's memory pass the limit, whatever is asked for", async () => {
    // Watched from outside while the box fills: the memory object itself, at every refusal.
    const store = new MemoryStore();
    await store.open("hoard");
    let most = 0;
    let start = 0;
    const host = createHost({
      loadIsolated: await createIsolateLoader({
        store,
        newContext: (memory) => {
          start = memory.buffer.byteLength;
          const grow = memory.grow;
          memory.grow = (delta: number): number => {
            try {
              return grow(delta);
            } finally {
              most = Math.max(most, memory.buffer.byteLength);
            }
          };
          return boundedContexts(engine)(memory);
        },
        loadTimeoutMs: 20_000,
      }),
    });
    const loading = host.load({ kind: "bundle", code: `globalThis.keep = []; for (;;) keep.push(new Uint8Array(1024 * 1024));`, provenance: "untrusted" });
    expect(await fault(loading)).toEqual(STOPPED);
    expect(start).toBe(16 * MB);
    expect(most).toBeGreaterThan(DEFAULT_MEMORY * 0.9);
    expect(most).toBeLessThanOrEqual(DEFAULT_MEMORY);
  }, 30_000);

  it("stops an app that catches the refusal and carries on", async () => {
    const box = await open({
      hoard: `globalThis.keep = []; for (var i = 0; i < 400; i++) { try { keep.push(new Uint8Array(8 * 1024 * 1024)); } catch (e) { keep.push(String(e)); } } await ctx.patch("run", r.id, { out: "carried on" });`,
    });
    expect(await fault(box.call("hoard"))).toEqual(STOPPED);
    expect((await box.store.all("run"))[0]!.out).toBe("");
    expect(await gone([box.memory])).toBe(true);
  }, 30_000);

  it("stops an app that fills its memory after waiting on the host, and the call waiting on it", async () => {
    const box = await open({
      hoard: `await ctx.storage.get("nothing"); globalThis.keep = []; for (var i = 0; i < 400; i++) keep.push(new Uint8Array(8 * 1024 * 1024));`,
    });
    expect(await fault(box.call("hoard"))).toEqual(STOPPED);
    expect(await gone([box.memory])).toBe(true);
  }, 30_000);

  it("stops an app whose own top level fills its memory, before it is ever loaded", async () => {
    const e = (await open({}, { top: `globalThis.keep = []; for (var i = 0; i < 400; i++) keep.push(new Uint8Array(8 * 1024 * 1024))` }).catch((x: unknown) => x)) as HostFault & { memory: WeakRef<object>; bytes: number };
    expect({ why: e.why, message: e.message }).toEqual(STOPPED);
    expect(e.bytes).toBeLessThanOrEqual(DEFAULT_MEMORY);
    expect(await gone([e.memory])).toBe(true);
  }, 30_000);

  it("takes the limit it is given, and says it", async () => {
    const box = await open({ hoard: HOARDS["typed arrays"]! }, { limit: 32 * MB });
    expect(await fault(box.call("hoard"))).toEqual({ why: "stopped", message: "stopped: the app asked for more memory than a shared app may hold (32 MB)" });
  }, 30_000);

  it("keeps one app's memory its own: twelve stopped one after another leave nothing behind, and a neighbour runs on", async () => {
    const neighbour = await open({ go: `globalThis.n = (globalThis.n || 0) + 1; await ctx.patch("run", r.id, { out: "ran " + n });` });
    expect(await neighbour.call("go")).toBe("ran 1");
    const stopped: Array<WeakRef<object>> = [];
    for (let i = 0; i < 12; i++) {
      const box = await open({ hoard: HOARDS["typed arrays"]! });
      expect((await fault(box.call("hoard"))).why).toBe("stopped");
      stopped.push(box.memory);
    }
    // Twelve times the limit is over a gigabyte, if any of it were kept.
    expect(await gone(stopped)).toBe(true);
    // The neighbour's engine is another module in another memory: it never noticed.
    expect(await neighbour.call("go")).toBe("ran 2");
    expect(neighbour.bytes()).toBe(16 * MB);
    neighbour.loaded.dispose?.();
    expect(await gone([neighbour.memory])).toBe(true);
  }, 120_000);

  it("refuses to run an app in an engine that was not built on the bounded memory", async () => {
    const store = new MemoryStore();
    await store.open("hoard");
    const host = createHost({
      loadIsolated: await createIsolateLoader({ store, newContext: () => quickjsEngine.newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike> }),
    });
    const loading = host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${JSON.stringify(definition)};`, provenance: "untrusted" });
    expect(await fault(loading)).toEqual({ why: "fault", message: "the isolate was not built on the memory it was given: nothing would bound what the app holds" });
  }, 30_000);

  it("leaves an honest app its room: a 25 MB picture read, a changed copy made, and the copy kept", async () => {
    const picture = new Uint8Array(25 * MB);
    picture[0] = 7;
    const box = await open(
      {
        edit: `
          var shot = await ctx.caps.camera.capture();
          var bytes = new Uint8Array(await shot.arrayBuffer());
          var copy = new Uint8Array(bytes.length);
          copy.set(bytes);
          copy[copy.length - 1] = 42;
          var ref = await ctx.media.put(copy);
          await ctx.patch("run", r.id, { out: bytes.length + " " + bytes[0] + " " + typeof ref.key, photo: ref });`,
        // Called again and again: what one call held is free for the next, so it does not add up.
      },
      { picture: new Blob([picture], { type: "image/png" }) },
    );
    for (let i = 0; i < 3; i++) expect(await box.call("edit")).toBe(`${25 * MB} 7 string`);
    const photo = (await box.store.all("run"))[0]!.photo as { key: string; mime: string };
    const kept = new Uint8Array(await (await box.store.getBlob(photo))!.arrayBuffer());
    expect([kept.length, kept[0], kept.at(-1)]).toEqual([25 * MB, 7, 42]);
    // Three pictures' worth at once — the one read, the copy, the engine's own copy on the way out.
    expect(box.bytes()).toBeGreaterThan(75 * MB);
    expect(box.bytes()).toBeLessThanOrEqual(DEFAULT_MEMORY);
    box.loaded.dispose?.();
    expect(await gone([box.memory])).toBe(true);
  }, 60_000);
});
