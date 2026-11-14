// A photo taken, kept and read in every runner (#74): one action, written once as source, run as a
// trusted app's function, in the QuickJS isolate and in the browser realm. QuickJS has no Blob, so
// there a capture is its bytes with a type — and it used to be no capture at all ("not marshalable"),
// with `ctx.media.put` refused, so an action that began with a photo stopped at its first line.

import { afterAll, describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeAi, FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
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
