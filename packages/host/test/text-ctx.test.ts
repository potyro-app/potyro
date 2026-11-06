// `ctx.text` (docs/04 "Writing together"): the same surface on the direct ctx and across both sealed
// runners, a store that cannot merge falling back to read-modify-write and "everything is mine".

import { describe, expect, it } from "vitest";
import { MemoryStore, type Store } from "@potyro/store";
import { defineApp, type TextEdit, type TextRun } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS } from "./runners.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const ana = { id: "co_zAna", name: "Ana" };

const pad = () =>
  defineApp({
    id: "pad",
    name: "Pad",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      doc: {
        label: "Doc",
        displayField: "title",
        fields: {
          title: { type: "text", required: true },
          body: { type: "text", multiline: true, collaborative: true },
          notes: { type: "text", multiline: true },
        },
      },
    },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "doc", display: { primary: "title" } } }],
  });

/** A store that merges: records what it was asked, the way JazzStore would answer. */
class MergingStore extends MemoryStore {
  edits: Array<{ entity: string; id: string; field: string; edits: TextEdit[] }> = [];
  async editText(entity: string, id: string, field: string, edits: TextEdit[]): Promise<string> {
    this.edits.push({ entity, id, field, edits });
    const row = await this.get(entity, id);
    const text = `${String(row?.[field] ?? "")}+${edits.length}`;
    await this.update(entity, id, { [field]: text });
    return text;
  }
  async textRuns(): Promise<TextRun[]> {
    return [
      { text: "a", by: "co_zAna" },
      { text: "b", by: "co_zBo" },
    ];
  }
  async textAnchor(_e: string, _i: string, _f: string, at: number): Promise<string> {
    return `o:${at}`;
  }
  async textIndex(_e: string, _i: string, _f: string, anchor: string): Promise<number | null> {
    return anchor === "o:4" ? 40 : null;
  }
}

async function direct(store: Store = new MemoryStore()) {
  await store.open("pad");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: pad() });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me: ana } as MakeCtxBase);
  return { ctx, store };
}

describe("ctx.text on the direct ctx", () => {
  it("edits a plain store by read-modify-write, and calls everything the person's own", async () => {
    const { ctx } = await direct();
    const doc = await ctx.create("doc", { title: "Plan", body: "Hello world" });
    const text = ctx.text("doc", doc.id, "body");
    const after = await text.edit([{ at: 5, insert: "," }, { from: 0, to: 5 }, { at: 0, insert: "Hi" }]);
    expect(after.body).toBe("Hi, world");
    expect((await ctx.get("doc", doc.id))?.body).toBe("Hi, world");
    expect(await text.runs()).toEqual([{ text: "Hi, world", by: "co_zAna" }]);
    expect(await text.anchor(4)).toBe("i:4");
    expect(await text.anchor(99)).toBe("end");
    expect(await text.index("i:4")).toBe(4);
    expect(await text.index("i:99")).toBe(9);
    expect(await text.index("end")).toBe(9);
    expect(await text.index("o:whatever")).toBeNull();
  });

  it("hands the edits to a store that merges, and reads authorship and anchors from it", async () => {
    const store = new MergingStore();
    const { ctx } = await direct(store);
    const doc = await ctx.create("doc", { title: "Plan", body: "x" });
    const text = ctx.text("doc", doc.id, "body");
    const after = await text.edit([{ at: 1, insert: "y" }, { from: 0, to: 1 }]);
    expect(after.body).toBe("x+2");
    expect(store.edits).toEqual([{ entity: "doc", id: doc.id, field: "body", edits: [{ at: 1, insert: "y" }, { from: 0, to: 1 }] }]);
    expect((await text.runs()).map((r) => r.by)).toEqual(["co_zAna", "co_zBo"]);
    expect(await text.anchor(4)).toBe("o:4");
    expect(await text.index("o:4")).toBe(40);
  });

  it("refuses a field that is not a collaborative text, and malformed edits, before any store sees them", async () => {
    const store = new MergingStore();
    const { ctx } = await direct(store);
    const doc = await ctx.create("doc", { title: "Plan", body: "x", notes: "n" });
    expect(() => ctx.text("doc", doc.id, "notes")).toThrow(/not a collaborative text/);
    expect(() => ctx.text("doc", doc.id, "title")).toThrow(/not a collaborative text/);
    expect(() => ctx.text("doc", doc.id, "nope")).toThrow(/no field "nope"/);
    await expect(ctx.text("doc", doc.id, "body").edit([{ at: -1, insert: "x" }] as never)).rejects.toThrow(/edit 0/);
    await expect(ctx.text("doc", doc.id, "body").edit([{ from: 3, to: 1 }])).rejects.toThrow(/edit 0/);
    await expect(ctx.text("doc", doc.id, "body").edit("x" as never)).rejects.toThrow(/array/);
    expect(store.edits).toEqual([]);
  });
});

const PAD_BUNDLE = `
globalThis.__potyroApp = {
  id: "pad", name: "Pad", version: "1.0.0", schemaVersion: 1,
  entities: { doc: { fields: {
    title: { type: "text" },
    body: { type: "text", multiline: true, collaborative: true },
    notes: { type: "text", multiline: true }
  }, actions: {
    greet: async function(r, ctx){
      var t = ctx.text("doc", r.id, "body");
      var after = await t.edit([{ at: 0, insert: "Hi " }]);
      var runs = await t.runs();
      var anchor = await t.anchor(1);
      var index = await t.index(anchor);
      await ctx.patch("doc", r.id, { notes: JSON.stringify({ body: after.body, runs: runs, anchor: anchor, index: index }) });
    },
    wrong: async function(r, ctx){ await ctx.text("doc", r.id, "notes").edit([{ at: 0, insert: "x" }]); }
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "doc" } }],
  reminders: []
};
`;

describe.each(RUNNERS)("ctx.text across the sealed runner: $name", (runner) => {
  async function setup(store: MemoryStore) {
    await store.open("pad");
    const loadIsolated = await runner.loader(store);
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: PAD_BUNDLE, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me: ana } as MakeCtxBase);
    return { loaded, ctx, store };
  }

  it("edits, reads runs and anchors through the bridge, with the fallback on a plain store", async () => {
    const { loaded, ctx, store } = await setup(new MemoryStore());
    const row = await store.insert("doc", { title: "Plan", body: "there" });
    await loaded.callAction("doc", "greet", { ...row } as never, ctx);
    const after = await store.get("doc", row.id);
    expect(after?.body).toBe("Hi there");
    expect(JSON.parse(String(after?.notes))).toEqual({ body: "Hi there", runs: [{ text: "Hi there", by: "co_zAna" }], anchor: "i:1", index: 1 });
    loaded.dispose();
  });

  it("reaches a store that merges, and is refused for a field that is not collaborative", async () => {
    const store = new MergingStore();
    const { loaded, ctx } = await setup(store);
    const row = await store.insert("doc", { title: "Plan", body: "x" });
    await loaded.callAction("doc", "greet", { ...row } as never, ctx);
    expect(store.edits.map((e) => e.edits)).toEqual([[{ at: 0, insert: "Hi " }]]);
    expect(JSON.parse(String((await store.get("doc", row.id))?.notes))).toMatchObject({ body: "x+1", anchor: "o:1", index: null, runs: [{ by: "co_zAna" }, { by: "co_zBo" }] });
    await expect(loaded.callAction("doc", "wrong", { ...row } as never, ctx)).rejects.toThrow(/not a collaborative text/);
    loaded.dispose();
  });
});

describe("edits to one field go one after the other", () => {
  it("keeps every keystroke on a store that cannot merge, however fast they come", async () => {
    const { ctx } = await direct();
    const doc = await ctx.create("doc", { title: "Plan", body: "" });
    const text = ctx.text("doc", doc.id, "body");
    const word = "Hello from Ana.";
    // Each keystroke sent without waiting for the one before, as a textarea does.
    await Promise.all([...word].map((ch, i) => text.edit([{ at: i, insert: ch }])));
    expect((await ctx.get("doc", doc.id))?.body).toBe(word);
  });
});
