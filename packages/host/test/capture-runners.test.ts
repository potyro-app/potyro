// A photo taken, kept and read in every runner (#74): one action, written once as source, run as a
// trusted app's function, in the QuickJS isolate and in the browser realm. QuickJS has no Blob, so
// there a capture is its bytes with a type — and it used to be no capture at all ("not marshalable"),
// with `ctx.media.put` refused, so an action that began with a photo stopped at its first line.

import { afterAll, describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeAi, FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import * as quickjsEngine from "quickjs-emscripten";
import { boundedContexts, createIsolateLoader, type QuickJSAsyncContextLike, type QuickJSEngine } from "../src/isolate/index.js";
import { RUNNERS, liveThreads, type Runner } from "./runners.js";

const ACTION = `async function (r, ctx) {
  var log = [];
  var shot = await ctx.caps.camera.capture();
  log.push(shot.type + " " + shot.size);
  var ref = await ctx.media.put(shot);
  log.push(typeof ref.key + " " + ref.mime);
  var a = await ctx.caps.ai.extract({ schema: { name: "text" }, image: shot });
  log.push(a.name);
  await ctx.patch("run", r.id, { out: log.join("\\n"), photo: ref });
}`;

const NO_CAMERA = `async function (r, ctx) { await ctx.patch("run", r.id, { out: typeof ctx.caps.camera }); }`;

const definition = (permissions: Record<string, boolean>) => ({
  id: "snapper",
  name: "Snapper",
  version: "1.0.0",
  schemaVersion: 1,
  permissions,
  entities: { run: { fields: { out: { type: "text" }, photo: { type: "media" } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "run", display: { primary: "out" } } }],
});

const nav: NavBridge = { navigate: () => {} };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7]);

interface RunOptions {
  /** The picture the camera hands over. */
  picture?: Blob;
  /** The person's answer to a consent question, by what it asks. */
  confirm?: (message: string) => boolean;
}

async function run(trust: "trusted" | Runner, action: string, permissions: Record<string, boolean>, opts: RunOptions = {}) {
  const store = new MemoryStore();
  await store.open("snapper");
  const ai = new FakeAi(['{"name":"Fern"}'], { language: "en" });
  const caps = new FakeCapabilities({ ai, blob: opts.picture ?? new Blob([PNG], { type: "image/png" }) });
  /** What the camera was asked with, each time it was really asked. */
  const captures: unknown[] = [];
  const real = caps.camera!;
  caps.camera = { capture: async (o) => (captures.push(o), real.capture(o)) };
  const ui: UiBridge = { toast: () => {}, confirm: async (m) => (opts.confirm ? opts.confirm(String(m)) : true), prompt: async () => null, pick: async () => null };
  const def = definition(permissions);
  const host = trust === "trusted" ? createHost() : createHost({ loadIsolated: await trust.loader(store) });
  const loaded =
    trust === "trusted"
      ? await host.load({ kind: "module", app: defineApp({ ...def, entities: { run: { ...def.entities.run, actions: { go: new Function(`return ${action}`)() } } } } as never) })
      : await host.load({
          kind: "bundle",
          code: `globalThis.__potyroApp = ${JSON.stringify(def).replace(/"photo":\{"type":"media"\}\}/, `"photo":{"type":"media"}},"actions":{"go":${action.replace(/\$/g, "$$$$")}}`)};`,
          provenance: "untrusted",
        });
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  const row = await store.insert("run", { out: "" });
  await loaded.callAction("run", "go", { ...row } as never, ctx);
  const after = (await store.get("run", row.id))!;
  const photo = after.photo as { key: string; mime: string } | undefined;
  const kept = photo ? await store.getBlob(photo) : null;
  loaded.dispose?.();
  const bytes = async (b: Blob | null | undefined) => (b ? `${b.type} ${Array.from(new Uint8Array(await b.arrayBuffer())).join(",")}` : "nothing");
  const sent = ai.calls.flatMap((c) => c.parts).flatMap((p) => ("image" in p ? [p.image] : []));
  return { out: String(after.out), kept: await bytes(kept), sent: await bytes(sent[0]), asked: ai.calls.length, captures, keptBlob: kept, sentBlob: sent[0] };
}

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

const PICTURE = "image/png 137,80,78,71,5,6,7";

// A phone's photo is megabytes. In QuickJS every byte that crosses as text is encoded by an
// interpreter: one megabyte took over a minute, far past the second a call may run. A capture
// stays with the host, so keeping it and sending it moves no bytes through the box at all.
const PHOTO_BYTES = 5 * 1024 * 1024;
const photo = (size = PHOTO_BYTES): Blob => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) & 255;
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([bytes], { type: "image/jpeg" });
};
const same = async (a: Blob | null | undefined, b: Blob): Promise<boolean> => {
  if (!a || a.size !== b.size) return false;
  const [x, y] = [new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer())];
  for (let i = 0; i < x.length; i += 997) if (x[i] !== y[i]) return false;
  return true;
};

describe("a capture, kept and read, in every runner", () => {
  it("trusted: the picture is stored and sent as it was taken", async () => {
    expect(await run("trusted", ACTION, {})).toMatchObject({ out: "image/png 7\nstring image/png\nFern", kept: PICTURE, sent: PICTURE });
  });

  for (const runner of RUNNERS) {
    it(`${runner.name}: the same action does the same with a declared camera and AI`, async () => {
      expect(await run(runner, ACTION, { camera: true, ai: true })).toMatchObject({ out: "image/png 7\nstring image/png\nFern", kept: PICTURE, sent: PICTURE });
    }, 30_000);

    it(`${runner.name}: an app that did not declare the camera has none`, async () => {
      expect((await run(runner, NO_CAMERA, { ai: true })).out).toBe("undefined");
    }, 30_000);
  }

  for (const runner of RUNNERS) {
    it(`${runner.name}: a 5 MB photo is kept and sent whole, inside one call's ordinary budget`, async () => {
      const picture = photo();
      const started = performance.now();
      const r = await run(runner, ACTION, { camera: true, ai: true }, { picture });
      expect(r.out).toBe(`image/jpeg ${PHOTO_BYTES}\nstring image/jpeg\nFern`);
      expect(await same(r.keptBlob, picture)).toBe(true);
      expect(await same(r.sentBlob, picture)).toBe(true);
      // The default budget is one second a call; nothing here raised it.
      expect(performance.now() - started).toBeLessThan(5_000);
    }, 30_000);
  }
});

const REFUSED = (body: string) => `async function (r, ctx) {
  var log = [];
  async function tried(what, fn) { try { await fn(); log.push(what + ": done"); } catch (e) { log.push(what + ": " + e.message); } }
  ${body}
  await ctx.patch("run", r.id, { out: log.join("\\n") });
}`;

describe("a capture the person or the manifest does not allow", () => {
  const CAPTURE = REFUSED(`await tried("capture", function () { return ctx.caps.camera.capture(); });`);
  const READ = REFUSED(`
    var shot = await ctx.caps.camera.capture();
    await tried("extract", function () { return ctx.caps.ai.extract({ schema: { name: "text" }, image: shot }); });`);

  for (const runner of RUNNERS) {
    it(`${runner.name}: "Not now" to the camera takes no picture`, async () => {
      const r = await run(runner, CAPTURE, { camera: true, ai: true }, { confirm: () => false });
      expect(r.out).toMatch(/^capture: .*Permission denied: Snapper → the camera/);
      expect(r.captures).toEqual([]);
    }, 30_000);

    it(`${runner.name}: "Not now" to the AI sends no picture, though the camera was allowed`, async () => {
      const r = await run(runner, READ, { camera: true, ai: true }, { confirm: (m) => !/AI/.test(m) });
      expect(r.out).toMatch(/^extract: .*Permission denied: Snapper → AI/);
      expect(r.captures).toHaveLength(1);
      expect(r.asked).toBe(0);
    }, 30_000);

    it(`${runner.name}: an app that declared the camera but not AI has a picture and nothing to send it to`, async () => {
      const r = await run(runner, REFUSED(`var shot = await ctx.caps.camera.capture(); log.push(shot.size + " " + typeof ctx.caps.ai);`), { camera: true });
      expect(r.out).toBe("7 undefined");
      expect(r.asked).toBe(0);
    }, 30_000);
  }
});

describe("the QuickJS box's edge, for pictures", () => {
  const quickjs = RUNNERS.find((r) => r.name === "quickjs")!;
  // What a hostile app does: skip ctx, and write to the bridge under it. The answer comes back
  // through the box's own settle, which it can watch.
  const FORGE = `
    function forge(req) {
      return new Promise(function (resolve) {
        var settle = globalThis.__potyro.settle;
        globalThis.__potyro.settle = function (id, ok, json) {
          if (id !== "forged") return settle.apply(this, arguments);
          globalThis.__potyro.settle = settle;
          resolve((ok ? "answered " : "refused ") + json);
        };
        __hostSync(JSON.stringify({ op: "host.call", id: "forged", req: req }));
      });
    }`;

  it("refuses a forged capture when the camera was not declared: the host checks, not only the harness", async () => {
    const r = await run(quickjs, REFUSED(`${FORGE} log.push(typeof ctx.caps.camera); log.push(await forge({ op: "cap.camera.capture", source: null }));`), { ai: true });
    expect(r.out).toBe("undefined\nrefused Permission denied: camera");
    expect(r.captures).toEqual([]);
  });

  it("refuses a forged request to the AI, with a picture, when AI was not declared", async () => {
    const r = await run(
      quickjs,
      REFUSED(`${FORGE} var shot = await ctx.caps.camera.capture();
        log.push(await forge({ op: "cap.ai.extract", req: { schema: { name: "text" }, instructions: null, text: null, image: { __shot: shot.__shot } } }));
        log.push(await forge({ op: "cap.ai.ask", prompt: "What is it?", opts: { instructions: null, image: { __bytes: "iVBORw0KGgo=" } } }));`),
      { camera: true },
    );
    expect(r.out).toBe("refused Permission denied: AI\nrefused Permission denied: AI");
    expect(r.asked).toBe(0);
  });

  it("asks the camera only for a source it has: anything else is no source at all", async () => {
    const r = await run(
      quickjs,
      REFUSED(`await ctx.caps.camera.capture({ source: "library" }); await ctx.caps.camera.capture({ source: "../../etc" }); await ctx.caps.camera.capture({ source: { toString: function () { return "camera"; } } }); await ctx.caps.camera.capture();`),
      { camera: true },
    );
    expect(r.captures).toEqual([{ source: "library" }, undefined, undefined, undefined]);
  });

  it("says what ctx.media.put takes when it is handed something else", async () => {
    const r = await run(
      quickjs,
      REFUSED(`
        await tried("text", function () { return ctx.media.put("x"); });
        await tried("nothing", function () { return ctx.media.put(); });
        await tried("an object", function () { return ctx.media.put({ size: 3, type: "image/png" }); });`),
      { camera: true },
    );
    const takes = "ctx.media.put takes a picture: what ctx.caps.camera.capture() gave, or a Uint8Array";
    expect(r.out.split("\n")).toEqual([`text: ${takes}`, `nothing: ${takes}`, `an object: ${takes}`]);
    expect(r.kept).toBe("nothing");
  });

  it("refuses bytes that are not base64, a picture it never took and bytes it never handed over", async () => {
    const r = await run(
      quickjs,
      REFUSED(`${FORGE}
        log.push(await forge({ op: "media.put", bytes: { b: "!!not base64!!", mime: "image/png" } }));
        log.push(await forge({ op: "media.put", bytes: { b: 12 } }));
        log.push(await forge({ op: "media.put", bytes: { shot: "s999" } }));
        log.push(await forge({ op: "media.put", bytes: { held: "b999" } }));
        log.push(await forge({ op: "shot.bytes", shot: "s1", native: true }));
        log.push(typeof __hostBytesIn("b999"));
        log.push(__hostBytesOut("not a buffer"));`),
      { camera: true },
    );
    expect(r.out.split("\n")).toEqual([
      "refused these bytes did not arrive whole: they are not base64",
      "refused ctx.media.put takes a picture: what ctx.caps.camera.capture() gave, or a Uint8Array",
      "refused that picture is no longer held: take it again, or keep it with ctx.media.put first",
      "refused those bytes did not arrive: hand them over again",
      "refused that picture is no longer held: take it again, or keep it with ctx.media.put first",
      "string",
      "!these are not bytes",
    ]);
    expect(r.kept).toBe("nothing");
  });

  it("reads a 5 MB photo's bytes and keeps bytes of its own, inside one call's ordinary budget", async () => {
    const picture = photo();
    const r = await run(
      quickjs,
      REFUSED(`
        var shot = await ctx.caps.camera.capture();
        var buffer = await shot.arrayBuffer();
        var bytes = new Uint8Array(buffer);
        log.push(bytes.length + " " + bytes[0] + " " + bytes[4096] + " " + bytes[4096 * 300]);
        var ref = await ctx.media.put(bytes.subarray(0, bytes.length - 1));
        var a = await ctx.caps.ai.extract({ schema: { name: "text" }, image: bytes });
        log.push(a.name);
        await ctx.patch("run", r.id, { photo: ref });`),
      { camera: true, ai: true },
      { picture },
    );
    expect(r.out).toBe(`${PHOTO_BYTES} 255 1 44\nFern`);
    expect(r.keptBlob?.size).toBe(PHOTO_BYTES - 1);
    expect(await same(r.sentBlob, picture)).toBe(true);
    expect(r.sentBlob?.type).toBe("image/jpeg");
  }, 30_000);

  it("refuses a picture past 25 MB in words, taking it nowhere", async () => {
    const r = await run(quickjs, REFUSED(`await tried("capture", function () { return ctx.caps.camera.capture(); });`), { camera: true }, { picture: photo(26 * 1024 * 1024) });
    expect(r.out).toMatch(/^capture: .*this picture is 26 MB; a shared app takes at most 25 MB$/);
  }, 30_000);

  it("refuses bytes past 25 MB before they cross", async () => {
    const r = await run(quickjs, REFUSED(`await tried("put", function () { return ctx.media.put(new Uint8Array(26 * 1024 * 1024)); });`), { camera: true });
    expect(r.out).toMatch(/^put: .*ctx\.media\.put: these bytes are 26 MB; at most 25 MB$/);
    expect(r.kept).toBe("nothing");
  }, 30_000);
});

// ---- the box's edge under a hostile app, and across calls (the second review of #74's boundary) ----

const MB = 1024 * 1024;

interface Box {
  /** Run one of the app's actions on its record; resolves with what it logged. */
  call(action: string): Promise<string>;
  /** What the host keeps for this box now. */
  held(): { crossing: number; shots: number };
  /** `held()` each time the app called `ctx.ui.toast` — a look inside a call. */
  marks: Array<{ crossing: number; shots: number }>;
  store: MemoryStore;
  ai: FakeAi;
  /** The photo the record holds, as stored. */
  kept(): Promise<Blob | null>;
  dispose(): void;
}

/** A QuickJS box with several actions, kept open across calls. Each action's body logs into `log`. */
async function open(
  actions: Record<string, string>,
  permissions: Record<string, boolean>,
  opts: { camera?: () => Promise<Blob>; context?: (c: QuickJSAsyncContextLike) => void; replies?: string[] } = {},
): Promise<Box> {
  const store = new MemoryStore();
  await store.open("snapper");
  const ai = new FakeAi(opts.replies ?? ['{"name":"Fern"}'], { language: "en" });
  const caps = new FakeCapabilities({ ai });
  let taken = 0;
  // Each capture is its own picture: its last byte is its number.
  caps.camera = { capture: opts.camera ?? (async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, ++taken])], { type: "image/png" })) };
  const def = definition(permissions);
  const source = Object.entries(actions)
    .map(([name, body]) => `${JSON.stringify(name)}:${REFUSED(body).replace(/\$/g, "$$$$")}`)
    .join(",");
  const host = createHost({
    loadIsolated: await createIsolateLoader({
      store,
      newContext: async (memory) => {
        const context = await boundedContexts(quickjsEngine as unknown as QuickJSEngine)(memory);
        opts.context?.(context);
        return context;
      },
    }),
  });
  const loaded = await host.load({
    kind: "bundle",
    code: `globalThis.__potyroApp = ${JSON.stringify(def).replace(/"photo":\{"type":"media"\}\}/, `"photo":{"type":"media"}},"actions":{${source}}`)};`,
    provenance: "untrusted",
  });
  const held = (): { crossing: number; shots: number } => (loaded as unknown as { heldBytes(): { crossing: number; shots: number } }).heldBytes();
  const marks: Box["marks"] = [];
  const ui: UiBridge = { toast: () => void marks.push(held()), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  const row = await store.insert("run", { out: "" });
  return {
    async call(action) {
      await loaded.callAction("run", action, { ...(await store.get("run", row.id))! } as never, ctx);
      return String((await store.get("run", row.id))!.out);
    },
    held,
    marks,
    store,
    ai,
    async kept() {
      const photo = (await store.get("run", row.id))!.photo as { key: string; mime: string } | undefined;
      return photo ? store.getBlob(photo) : null;
    },
    dispose: () => loaded.dispose?.(),
  };
}

// As above: write to the bridge under ctx, and watch the box's own settle for the answer.
const FORGE_FN = `
  function forge(req) {
    return new Promise(function (resolve) {
      var settle = globalThis.__potyro.settle;
      globalThis.__potyro.settle = function (id, ok, json) {
        if (id !== "forged") return settle.apply(this, arguments);
        globalThis.__potyro.settle = settle;
        resolve((ok ? "answered " : "refused ") + json);
      };
      __hostSync(JSON.stringify({ op: "host.call", id: "forged", req: req }));
    });
  }`;

const NO_LONGER_HELD = "that picture is no longer held: take it again, or keep it with ctx.media.put first";
const NOT_ARRIVED = "those bytes did not arrive: hand them over again";
const bytesOf = async (b: Blob | null): Promise<number[]> => (b ? Array.from(new Uint8Array(await b.arrayBuffer())) : []);

describe("what the host keeps for a QuickJS box", () => {
  it("lets go of the oldest capture at the ninth: its number is refused, never another picture, and no number is used twice", async () => {
    const box = await open(
      {
        take: `globalThis.shots = []; for (var i = 0; i < 9; i++) globalThis.shots.push(await ctx.caps.camera.capture()); log.push(globalThis.shots.map(function (s) { return s.__shot; }).join(" "));`,
        first: `await tried("first", function () { return ctx.media.put(globalThis.shots[0]); });`,
        second: `var ref = await ctx.media.put(globalThis.shots[1]); await ctx.patch("run", r.id, { photo: ref });`,
        ninth: `var ref = await ctx.media.put(globalThis.shots[8]); await ctx.patch("run", r.id, { photo: ref });`,
      },
      { camera: true },
    );
    const ids = (await box.call("take")).split(" ");
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    expect(await box.call("first")).toBe(`first: ${NO_LONGER_HELD}`);
    // The second and the ninth are still theirs, each its own picture.
    await box.call("second");
    expect((await bytesOf(await box.kept())).at(-1)).toBe(2);
    await box.call("ninth");
    expect((await bytesOf(await box.kept())).at(-1)).toBe(9);
    box.dispose();
  });

  it("keeps a capture for the app across calls — taken in one action, kept in another — and for no other instance", async () => {
    const actions = {
      take: `globalThis.shot = await ctx.caps.camera.capture(); log.push(globalThis.shot.__shot);`,
      keep: `var ref = await ctx.media.put(globalThis.shot); await ctx.patch("run", r.id, { photo: ref }); log.push("kept");`,
      steal: `${FORGE_FN} log.push(await forge({ op: "media.put", bytes: { shot: "s1" } })); log.push(await forge({ op: "shot.bytes", shot: "s1", native: true }));`,
    };
    const one = await open(actions, { camera: true });
    const other = await open(actions, { camera: true });
    expect(await one.call("take")).toBe("s1");
    expect(await one.call("keep")).toBe("kept");
    expect((await bytesOf(await one.kept())).at(-1)).toBe(1);
    // The same app, opened again: the first one's number names nothing here.
    expect(await other.call("steal")).toBe(`refused ${NO_LONGER_HELD}\nrefused ${NO_LONGER_HELD}`);
    expect(await other.kept()).toBeNull();
    one.dispose();
    other.dispose();
  });

  it("holds nothing for a box that was closed, and a capture that arrives after is not kept", async () => {
    let arrive!: (b: Blob) => void;
    const box = await open(
      { take: `globalThis.shot = await ctx.caps.camera.capture(); log.push("took");`, late: `await ctx.caps.camera.capture();` },
      { camera: true },
      { camera: () => (box.held().shots ? new Promise<Blob>((r) => (arrive = r)) : Promise.resolve(new Blob([PNG], { type: "image/png" }))) },
    );
    await box.call("take");
    expect(box.held().shots).toBe(PNG.length);
    const pending = box.call("late").catch((e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 20));
    box.dispose();
    expect(box.held()).toEqual({ crossing: 0, shots: 0 });
    arrive(new Blob([new Uint8Array(1000)], { type: "image/png" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(box.held()).toEqual({ crossing: 0, shots: 0 });
    void pending;
  });

  it("bounds what a hostile app can make it hold: buffers handed over and never taken", async () => {
    const box = await open(
      {
        flood: `var out = []; for (var i = 0; i < 12; i++) out.push(__hostBytesOut(new ArrayBuffer(20 * 1024 * 1024)).replace(/^b\\d+$/, "held")); ctx.ui.toast("mark"); log.push(out.join("|"));`,
        after: `log.push("after");`,
      },
      {},
    );
    const out = (await box.call("flood")).split("|");
    const full = "!too many bytes are on their way at once (at most 50 MB): hand over what is waiting first";
    // Two fit the 50 MB there is room for; the other ten are refused, not swapped in.
    expect(out).toEqual(["held", "held", ...Array(10).fill(full)]);
    expect(box.marks).toEqual([{ crossing: 40 * MB, shots: 0 }]);
    // And when the call is over, none of it is still there.
    expect(box.held()).toEqual({ crossing: 0, shots: 0 });
    box.dispose();
  }, 30_000);

  it("bounds the same through a forged read of a capture, without pushing out bytes that are honestly on their way", async () => {
    const box = await open(
      {
        flood: `${FORGE_FN}
          var shot = await ctx.caps.camera.capture();
          var mine = __hostBytesOut(new Uint8Array([7, 8, 9]).buffer);
          var out = []; for (var i = 0; i < 5; i++) out.push((await forge({ op: "shot.bytes", shot: shot.__shot, native: true })).replace(/b\\d+/, "N"));
          ctx.ui.toast("mark");
          log.push(out.join("|"));
          log.push(await forge({ op: "media.put", bytes: { held: mine } }));`,
      },
      { camera: true },
      { camera: async () => new Blob([new Uint8Array(20 * MB)], { type: "image/png" }) },
    );
    const [flood, mine] = (await box.call("flood")).split("\n");
    const full = "refused too many bytes are on their way at once (at most 50 MB): hand over what is waiting first";
    expect(flood!.split("|")).toEqual(['answered {"held":"N"}', 'answered {"held":"N"}', full, full, full]);
    expect(box.marks).toEqual([{ crossing: 40 * MB + 3, shots: 20 * MB }]);
    // The three bytes handed over first were still there to be taken.
    expect(mine).toMatch(/^answered \{"key":/);
    expect(box.held().crossing).toBe(0);
    box.dispose();
  }, 30_000);

  it("refuses 26 MB in the host itself, when the harness's own check is skipped", async () => {
    const box = await open({ big: `log.push(__hostBytesOut(new ArrayBuffer(26 * 1024 * 1024))); ctx.ui.toast("mark");` }, {});
    expect(await box.call("big")).toBe("!these bytes are 26 MB; at most 25 MB");
    expect(box.marks).toEqual([{ crossing: 0, shots: 0 }]);
    box.dispose();
  }, 30_000);

  it("hands a buffer over once: taking it twice is refused", async () => {
    const box = await open(
      {
        twice: `${FORGE_FN} var id = __hostBytesOut(new Uint8Array([1, 2, 3]).buffer);
          log.push((await forge({ op: "media.put", bytes: { held: id } })).slice(0, 8));
          log.push(await forge({ op: "media.put", bytes: { held: id } }));
          var again = __hostBytesOut(new Uint8Array([4]).buffer); log.push(again !== id);
          log.push(typeof __hostBytesIn(again)); log.push(__hostBytesIn(again));`,
      },
      {},
    );
    expect((await box.call("twice")).split("\n")).toEqual(["answered", `refused ${NOT_ARRIVED}`, "true", "object", NOT_ARRIVED]);
    box.dispose();
  });

  it("answers a bad argument with a fixed sentence, and runs nothing of the app's to read it", async () => {
    const box = await open(
      {
        bad: `var ran = [];
          var sly = { toString: function () { ran.push("toString"); return "b1"; }, valueOf: function () { ran.push("valueOf"); return 1; } };
          log.push(__hostBytesIn()); log.push(__hostBytesIn(sly)); log.push(__hostBytesIn(12)); log.push(__hostBytesIn(null));
          log.push(__hostBytesOut()); log.push(__hostBytesOut(sly)); log.push(__hostBytesOut("text")); log.push(__hostBytesOut(12)); log.push(__hostBytesOut(null));
          log.push("ran: " + ran.join(","));`,
      },
      {},
    );
    expect((await box.call("bad")).split("\n")).toEqual([...Array(4).fill(NOT_ARRIVED), ...Array(5).fill("!these are not bytes"), "ran: "]);
    box.dispose();
  });

  it("refuses bytes handed to the AI when AI was not declared, and keeps none of them", async () => {
    const box = await open(
      { sneak: `${FORGE_FN} var id = __hostBytesOut(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer); log.push(await forge({ op: "cap.ai.extract", req: { schema: { name: "text" }, instructions: null, text: null, image: { __held: id } } }));` },
      {},
    );
    expect(await box.call("sneak")).toBe("refused Permission denied: AI");
    expect(box.ai.calls).toEqual([]);
    expect(box.held().crossing).toBe(0);
    box.dispose();
  });

  it("counts the pictures of an AI request before reading any of them", async () => {
    const box = await open(
      { five: `${FORGE_FN} var img = { __bytes: "!!not base64!!" }; log.push(await forge({ op: "cap.ai.ask", prompt: "What?", opts: { instructions: null, image: [img, img, img, img, img] } }));` },
      { ai: true },
    );
    // Were they read first, the answer would be about base64.
    expect(await box.call("five")).toBe("refused ctx.caps.ai: at most 4 images a call, not 5");
    box.dispose();
  });

  it("refuses base64 longer than 4 MB of bytes before decoding it", async () => {
    const box = await open({ long: `${FORGE_FN} log.push(await forge({ op: "media.put", bytes: { b: "A".repeat(5600000), mime: "image/png" } }));` }, {});
    expect(await box.call("long")).toBe("refused these bytes are more than a shared app passes at once (4 MB)");
    expect(await box.kept()).toBeNull();
    box.dispose();
  }, 30_000);

  it("keeps the part of a buffer an app handed over, not the buffer around it", async () => {
    const box = await open(
      { part: `var whole = new Uint8Array([9, 9, 9, 1, 2, 3, 4, 9, 9]); var ref = await ctx.media.put(whole.subarray(3, 7)); await ctx.patch("run", r.id, { photo: ref }); var a = await ctx.caps.ai.ask("What?", { image: new Uint8Array([0, 0, 0x89, 0x50, 0x4e, 0x47, 5, 0]).subarray(2, 7) }); log.push(a);` },
      { ai: true },
      { replies: ["A PNG."] },
    );
    expect(await box.call("part")).toBe("A PNG.");
    expect(await bytesOf(await box.kept())).toEqual([1, 2, 3, 4]);
    const sent = box.ai.calls.flatMap((c) => c.parts).flatMap((p) => ("image" in p ? [p.image] : []));
    expect(await bytesOf(sent[0]!)).toEqual([0x89, 0x50, 0x4e, 0x47, 5]);
    box.dispose();
  });

  it("still takes what an honest app hands over: 25 MB of its own bytes, and several small pictures at once", async () => {
    const box = await open(
      {
        large: `var big = new Uint8Array(25 * 1024 * 1024); big[big.length - 1] = 42; var ref = await ctx.media.put(big); await ctx.patch("run", r.id, { photo: ref }); log.push("kept");`,
        many: `var refs = await Promise.all([1, 2, 3, 4, 5, 6].map(function (n) { return ctx.media.put(new Uint8Array([n, n, n])); })); log.push(refs.filter(function (x) { return x && typeof x.key === "string"; }).length); await ctx.patch("run", r.id, { photo: refs[5] });`,
      },
      {},
    );
    expect(await box.call("large")).toBe("kept");
    const large = await box.kept();
    expect(large?.size).toBe(25 * MB);
    expect((await bytesOf(large)).at(-1)).toBe(42);
    expect(await box.call("many")).toBe("6");
    expect(await bytesOf(await box.kept())).toEqual([6, 6, 6]);
    expect(box.held().crossing).toBe(0);
    box.dispose();
  }, 30_000);

  it("works without buffers across the edge: bytes cross as base64, both ways", async () => {
    const box = await open(
      {
        both: `log.push(typeof __hostBytesOut + " " + typeof __hostBytesIn);
          var shot = await ctx.caps.camera.capture();
          var bytes = await shot.bytes(); log.push(Array.prototype.join.call(bytes, ","));
          var ref = await ctx.media.put(bytes.subarray(1)); await ctx.patch("run", r.id, { photo: ref });
          var a = await ctx.caps.ai.extract({ schema: { name: "text" }, image: bytes }); log.push(a.name);`,
        big: `var shot = await ctx.caps.camera.capture(); await tried("read", function () { return shot.bytes(); }); await tried("put", function () { return ctx.media.put(new Uint8Array(5 * 1024 * 1024)); });`,
      },
      { camera: true, ai: true },
      {
        context: (c) => {
          (c as { newArrayBuffer?: unknown }).newArrayBuffer = undefined;
        },
        camera: (() => {
          let n = 0;
          return async () => (++n === 1 ? new Blob([PNG], { type: "image/png" }) : new Blob([new Uint8Array(5 * MB)], { type: "image/png" }));
        })(),
      },
    );
    expect((await box.call("both")).split("\n")).toEqual(["undefined undefined", "137,80,78,71,5,6,7", "Fern"]);
    expect(await bytesOf(await box.kept())).toEqual([80, 78, 71, 5, 6, 7]);
    expect((await box.call("big")).split("\n")).toEqual([
      "read: this picture is 5 MB; at most 4 MB can be read here",
      "put: these bytes are 5 MB; a shared app passes at most 4 MB at once",
    ]);
    box.dispose();
  }, 30_000);
});
