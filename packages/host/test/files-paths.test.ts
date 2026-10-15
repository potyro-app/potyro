// A file's path reaches the app's folder exactly as the app wrote it, in every runner: dots and all
// ("levels.json", "data/a.b.c.txt"), and the message for a file that is not there names that path,
// character for character. The files are shipped into the store BEFORE the app runs, as an install
// puts them, so this also pins that a sealed runner reads the same store the shell wrote into.

import { describe, expect, it } from "vitest";
import { MemoryStore, fileSpace } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { defineApp, type AppInput } from "potyro";
import { createHost, type MakeCtxBase, type UiBridge } from "../src/index.js";
import { RUNNERS, type Runner } from "./runners.js";

const READ = `async function (r, ctx) {
  var out = [];
  out.push(JSON.stringify(await ctx.files.json("levels.json")));
  out.push(await ctx.files.text("data/a.b.c.txt"));
  out.push(typeof (await ctx.files.url("levels.json")));
  out.push((await ctx.files.stat("data/a.b.c.txt")).path);
  try { await ctx.files.json("no.such.file.json"); out.push("read a missing file"); } catch (e) { out.push(e.message); }
  try { await ctx.files.url("dir.v2/also.missing.txt"); out.push("read a missing file"); } catch (e) { out.push(e.message); }
  await ctx.patch("run", r.id, { out: out.join("\\n") });
}`;

const APP = `({
  id: "paths", name: "Paths", version: "1.0.0", schemaVersion: 1,
  entities: { run: { fields: { out: { type: "text" } }, actions: { go: ${READ} } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "run" } }]
})`;

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

async function run(kind: "direct" | Runner): Promise<string[]> {
  const store = new MemoryStore();
  await store.open("paths");
  const space = fileSpace(store);
  await space.write("levels.json", new Blob(['{"levels":[1,2]}'], { type: "application/json" }), { origin: "shipped" });
  await space.write("data/a.b.c.txt", new Blob(["dotted"], { type: "text/plain" }), { origin: "shipped" });
  const host = createHost(kind === "direct" ? {} : { loadIsolated: await kind.loader(store) });
  const loaded =
    kind === "direct"
      ? await host.load({ kind: "module", app: defineApp(new Function(`return ${APP};`)() as AppInput) })
      : await host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${APP};`, provenance: "untrusted" });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } } as MakeCtxBase);
  const row = await store.insert("run", { out: "" });
  await loaded.callAction("run", "go", { ...row } as never, ctx);
  loaded.dispose();
  return String((await store.get("run", row.id))!.out).split("\n");
}

describe("dotted file paths, in every runner", () => {
  it.each(["direct" as const, ...RUNNERS])("reads them, and names a missing one exactly (%s)", async (kind) => {
    const out = await run(kind);
    expect(out).toEqual([
      '{"levels":[1,2]}',
      "dotted",
      "string",
      "data/a.b.c.txt",
      'No file "no.such.file.json" in this app',
      'No file "dir.v2/also.missing.txt" in this app',
    ]);
  });
});
