// `ctx.files` (#252): the app's own folder, trusted and in the sealed box.
//
// One action, written once as source text, runs both ways: as a real function in a trusted app and
// inside the QuickJS isolate for an untrusted one. The two runs must leave the same log. That is the
// claim the isolate makes everywhere ("same code, two authority levels"), and files are where it is
// easiest to break: bytes cannot cross a JSON bridge as they are, and the picker is a dialog.
import { describe, expect, it } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { MemoryStore, fileSpace } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { defineApp } from "potyro";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

const ACTION = `async function (r, ctx) {
  var log = [];
  await ctx.files.write("notes/a.md", "# A");
  await ctx.files.write("bin/x.bin", new Uint8Array([0, 1, 2, 127, 128, 250, 255]));
  await ctx.files.write("plan.json", '{"weeks":3}');
  log.push((await ctx.files.list()).map(function (f) { return f.path + " " + f.mime + " " + f.size + " " + f.origin; }).join(" | "));
  log.push(await ctx.files.text("notes/a.md"));
  log.push(Array.prototype.join.call(await ctx.files.bytes("bin/x.bin"), ","));
  log.push(String((await ctx.files.json("plan.json")).weeks));
  var moved = await ctx.files.rename("notes/a.md", "notes/b.md");
  log.push(await ctx.files.text({ id: moved.id }));
  log.push(String((await ctx.files.stat("notes/a.md")) === null));
  await ctx.files.remove("plan.json");
  try { await ctx.files.text("plan.json"); log.push("read a removed file"); } catch (e) { log.push("removed: " + e.message); }
  var imported = await ctx.files.import({ folder: "in", multiple: true });
  log.push(imported.map(function (f) { return f.path + " " + f.origin; }).join(", "));
  log.push(await ctx.files.text("in/hello.txt"));
  await ctx.files.export("notes/b.md");
  log.push((await ctx.files.list("notes")).map(function (f) { return f.path; }).join(","));
  await ctx.patch("run", r.id, { out: log.join("\\n") });
}`;

const DEFINITION = {
  id: "folder",
  name: "Folder",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { run: { fields: { out: { type: "text" } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "run", display: { primary: "out" } } }],
};

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const picked = () => [new File(["hi there"], "hello.txt", { type: "text/plain" })];

async function run(trust: "trusted" | "untrusted") {
  const store = new MemoryStore();
  await store.open("folder");
  const caps = new FakeCapabilities({ files: picked() });
  const host =
    trust === "trusted"
      ? createHost()
      : createHost({ loadIsolated: createIsolateLoader({ store, newContext: () => newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike> }) });
  const loaded =
    trust === "trusted"
      ? await host.load({
          kind: "module",
          app: defineApp({
            ...DEFINITION,
            entities: { run: { ...DEFINITION.entities.run, actions: { go: new Function(`return ${ACTION}`)() } } },
          } as never),
        })
      : await host.load({
          kind: "bundle",
          code: `globalThis.__potyroApp = ${JSON.stringify(DEFINITION).replace(/"fields":\{"out":\{"type":"text"\}\}/, `"fields":{"out":{"type":"text"}},"actions":{"go":${ACTION.replace(/\$/g, "$$$$")}}`)};`,
          provenance: "untrusted",
        });
  const ctx = host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase);
  const row = await store.insert("run", { out: "" });
  await loaded.callAction("run", "go", { ...row } as never, ctx);
  const out = String((await store.get("run", row.id))!.out);
  loaded.dispose?.();
  return { out, store, caps };
}

describe("ctx.files", () => {
  it("writes, lists, reads in every form, renames, removes, imports and exports — trusted", async () => {
    const { out, store, caps } = await run("trusted");
    const lines = out.split("\n");

    expect(lines[0]).toBe(
      "bin/x.bin application/octet-stream 7 app | notes/a.md text/markdown 3 app | plan.json application/json 11 app",
    );
    expect(lines.slice(1, 5)).toEqual(["# A", "0,1,2,127,128,250,255", "3", "# A"]);
    expect(lines[5]).toBe("true");
    expect(lines[6]).toMatch(/^removed: .*plan\.json/);
    expect(lines.slice(7)).toEqual(["in/hello.txt imported", "hi there", "notes/b.md"]);
    expect(await caps.savedFiles().get("b.md")?.text()).toBe("# A");
    expect((await fileSpace(store).list()).map((f) => f.path)).toEqual(["bin/x.bin", "in/hello.txt", "notes/b.md"]);
  });

  it("does exactly the same in the sealed box, bytes and the picker included", async () => {
    const trusted = await run("trusted");
    const sealed = await run("untrusted");

    expect(sealed.out).toBe(trusted.out);
    expect(await sealed.caps.savedFiles().get("b.md")?.text()).toBe("# A");
  });

  it("an import the person cancels lands nothing and is not an error", async () => {
    const store = new MemoryStore();
    await store.open("folder");
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: defineApp(DEFINITION as never) });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav } as MakeCtxBase);

    expect(await ctx.files.import()).toEqual([]);
    expect(await ctx.files.list()).toEqual([]);
  });

  it("the app's own code (.modules/, .src/) is not the app's to see or change (#266, #258)", async () => {
    const store = new MemoryStore();
    await store.open("folder");
    const space = fileSpace(store);
    const lib = await space.write(".modules/abc.js", new Blob(["export const x = 1;"]), { origin: "shipped" });
    await space.write(".src/plan.ts", new Blob(["export const weeks = 12;"]), { origin: "shipped" });
    await space.write("plan.json", new Blob(["{}"]), { origin: "shipped" });
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: defineApp(DEFINITION as never) });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities({ files: picked() }), ui, nav } as MakeCtxBase);

    expect((await ctx.files.list()).map((f) => f.path)).toEqual(["plan.json"]);
    expect(await ctx.files.list(".src")).toEqual([]);
    expect(await ctx.files.stat(".src/plan.ts")).toBeNull();
    expect(await ctx.files.stat({ id: lib.id })).toBeNull();
    await expect(ctx.files.text(".modules/abc.js")).rejects.toThrow(/No file/);
    await expect(ctx.files.bytes({ id: lib.id })).rejects.toThrow(/No file/);
    await expect(ctx.files.write(".src/plan.ts", "export const weeks = 1;")).rejects.toThrow(/kept for the app's own code/);
    await expect(ctx.files.write("./.modules/abc.js", "x")).rejects.toThrow(/kept for the app's own code/);
    await expect(ctx.files.rename("plan.json", ".src/plan.json")).rejects.toThrow(/kept for the app's own code/);
    await expect(ctx.files.remove(".src/plan.ts")).rejects.toThrow(/No file/);
    await expect(ctx.files.import({ folder: ".modules" })).rejects.toThrow(/kept for the app's own code/);
    await expect(ctx.files.export(".src/plan.ts")).rejects.toThrow(/No file/);
    expect(await (await space.read(".src/plan.ts"))!.text()).toBe("export const weeks = 12;");
  });

  it("says which file is not valid JSON", async () => {
    const store = new MemoryStore();
    await store.open("folder");
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: defineApp(DEFINITION as never) });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav } as MakeCtxBase);
    await ctx.files.write("broken.json", "{nope");

    await expect(ctx.files.json("broken.json")).rejects.toThrow(/"broken\.json" is not valid JSON/);
  });
});
