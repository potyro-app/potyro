// `ctx.caps.ai` in every runner (docs/23): one action, written once as source, run as a trusted
// function, in the QuickJS isolate and in the browser realm. Each reads a picture three ways — a path
// in its folder, a media field's value and raw bytes — has it read into a shape and writes what came
// back as records. All three must leave the same records and send the same pictures.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore, fileSpace } from "@potyro/store";
import { FakeAi, FakeCapabilities } from "@potyro/capabilities";
import { defineApp } from "potyro";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, liveThreads, type Runner } from "./runners.js";

const ACTION = `async function (r, ctx) {
  var log = [typeof ctx.caps.ai];
  var shape = { shop: "text?", items: [{ name: "text", price: "number" }] };
  var a = await ctx.caps.ai.extract({ schema: shape, image: "in/receipt.jpg", instructions: "A receipt." });
  for (var i = 0; i < a.items.length; i++) await ctx.create("item", { name: a.items[i].name, price: a.items[i].price });
  log.push(a.shop + " " + a.items.length);
  var b = await ctx.caps.ai.extract({ schema: [{ name: "text" }], image: r.photo });
  log.push(b.map(function (x) { return x.name; }).join(","));
  var c = await ctx.caps.ai.ask("What is it?", { image: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]) });
  log.push(c);
  try { await ctx.caps.ai.extract({ schema: { a: "money" }, text: "x" }); log.push("took a bad shape"); } catch (e) { log.push("refused: " + e.message); }
  await ctx.patch("run", r.id, { out: log.join("\\n") });
}`;

const UNDECLARED = `async function (r, ctx) { await ctx.patch("run", r.id, { out: typeof ctx.caps.ai }); }`;

const definition = (permissions: Record<string, boolean>) => ({
  id: "reader",
  name: "Reader",
  version: "1.0.0",
  schemaVersion: 1,
  permissions,
  entities: {
    run: { fields: { out: { type: "text" }, photo: { type: "media" } } },
    item: { fields: { name: { type: "text" }, price: { type: "number" } } },
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "run", display: { primary: "out" } } }],
});

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 7, 7]);

const REPLIES = () => ['{"shop":"Żabka","items":[{"name":"Milk","price":"4,99"},{"name":"Bread","price":3.5}]}', '{"value":[{"name":"Fern"}]}', "A small PNG."];

async function run(trust: "trusted" | Runner, action: string, permissions: Record<string, boolean>) {
  const store = new MemoryStore();
  await store.open("reader");
  await fileSpace(store).write("in/receipt.jpg", new Blob([JPEG], { type: "image/jpeg" }));
  const photo = await store.putBlob(new Blob([GIF], { type: "image/gif" }));
  const ai = new FakeAi(REPLIES(), { language: "en" });
  const caps = new FakeCapabilities({ ai });
  const def = definition(permissions);
  const host = trust === "trusted" ? createHost() : createHost({ loadIsolated: await trust.loader(store) });
  const loaded =
    trust === "trusted"
      ? await host.load({ kind: "module", app: defineApp({ ...def, entities: { ...def.entities, run: { ...def.entities.run, actions: { go: new Function(`return ${action}`)() } } } } as never) })
      : await host.load({
          kind: "bundle",
          code: `globalThis.__potyroApp = ${JSON.stringify(def).replace(/"photo":\{"type":"media"\}\}/, `"photo":{"type":"media"}},"actions":{"go":${action.replace(/\$/g, "$$$$")}}`)};`,
          provenance: "untrusted",
        });
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  const row = await store.insert("run", { out: "", photo });
  await loaded.callAction("run", "go", { ...row } as never, ctx);
  const out = String((await store.get("run", row.id))!.out);
  const items = (await store.all("item")).map((i) => `${i.name} ${i.price}`);
  loaded.dispose?.();
  // What left the device: each picture's type and bytes, in order.
  const sent = await Promise.all(
    ai.calls.flatMap((c) => c.parts).flatMap((p) => ("image" in p ? [p.image] : [])).map(async (b) => `${b.type} ${Array.from(new Uint8Array(await b.arrayBuffer())).join(",")}`),
  );
  return { out, items, sent };
}

const EXPECTED_OUT = ["object", "Żabka 2", "Fern", "A small PNG.", expect.stringMatching(/^refused: .*"money"/)];
const EXPECTED_SENT = ["image/jpeg 255,216,255,224,9,9,9", "image/gif 71,73,70,56,7,7", "image/png 137,80,78,71,1,2"];

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

describe("ctx.caps.ai in every runner", () => {
  it("trusted: reads a path, a media field and bytes; the answer is validated before the app sees it", async () => {
    const { out, items, sent } = await run("trusted", ACTION, {});
    expect(out.split("\n")).toEqual(EXPECTED_OUT);
    expect(items).toEqual(["Milk 4.99", "Bread 3.5"]);
    expect(sent).toEqual(EXPECTED_SENT);
  });

  for (const runner of RUNNERS) {
    it(`${runner.name}: the same records and the same pictures as trusted`, async () => {
      const { out, items, sent } = await run(runner, ACTION, { ai: true });
      expect(out.split("\n")).toEqual(EXPECTED_OUT);
      expect(items).toEqual(["Milk 4.99", "Bread 3.5"]);
      expect(sent).toEqual(EXPECTED_SENT);
    }, 60_000);

    it(`${runner.name}: an app that did not declare it has no ctx.caps.ai`, async () => {
      const { out } = await run(runner, UNDECLARED, {});
      expect(out).toBe("undefined");
    }, 60_000);
  }
});
