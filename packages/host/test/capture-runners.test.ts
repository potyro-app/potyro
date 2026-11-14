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

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7]);

async function run(trust: "trusted" | Runner, action: string, permissions: Record<string, boolean>) {
  const store = new MemoryStore();
  await store.open("snapper");
  const ai = new FakeAi(['{"name":"Fern"}'], { language: "en" });
  const caps = new FakeCapabilities({ ai, blob: new Blob([PNG], { type: "image/png" }) });
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
  return { out: String(after.out), kept: await bytes(kept), sent: await bytes(sent[0]) };
}

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

const PICTURE = "image/png 137,80,78,71,5,6,7";

describe("a capture, kept and read, in every runner", () => {
  it("trusted: the picture is stored and sent as it was taken", async () => {
    expect(await run("trusted", ACTION, {})).toEqual({ out: "image/png 7\nstring image/png\nFern", kept: PICTURE, sent: PICTURE });
  });

  for (const runner of RUNNERS) {
    it(`${runner.name}: the same action does the same with a declared camera and AI`, async () => {
      expect(await run(runner, ACTION, { camera: true, ai: true })).toEqual({ out: "image/png 7\nstring image/png\nFern", kept: PICTURE, sent: PICTURE });
    }, 30_000);

    it(`${runner.name}: an app that did not declare the camera has none`, async () => {
      expect((await run(runner, NO_CAMERA, { ai: true })).out).toBe("undefined");
    }, 30_000);
  }
});
