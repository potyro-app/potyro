// `ctx.access` and `ctx.ui.share({ record })` (docs/24 §12): the same on the direct ctx and across
// both sealed runners; a store without peers answers "admin" for everything; the share request is
// checked against the definition and handed to the shell without a secret.
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { defineApp } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type ShownShare, type UiBridge } from "../src/index.js";
import { RUNNERS } from "./runners.js";

const nav: NavBridge = { navigate: () => {} };
const ana = { id: "co_zAna", name: "Ana" };

const pad = () =>
  defineApp({
    id: "pad",
    name: "Pad",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      doc: { label: "Doc", displayField: "title", share: "record", fields: { title: { type: "text" } } },
      note: { label: "Note", displayField: "text", fields: { text: { type: "text" } } },
    },
    pages: [
      { id: "all", title: "All", view: { type: "list", entity: "doc", display: { primary: "title" } } },
      { id: "doc", title: "Doc", hidden: true, link: { params: ["docId"] }, view: { type: "detail", entity: "doc", param: "docId" } },
    ],
  });

class GroupedStore extends MemoryStore {
  async recordAccess(_entity: string, id: string): Promise<"reader" | "writer" | "admin"> {
    return id === "theirs" ? "reader" : "admin";
  }
}

function bridges() {
  const sent: ShownShare[] = [];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
    share: async (opts) => {
      sent.push(opts);
      return true;
    },
  };
  return { ui, sent };
}

async function direct(store: MemoryStore = new MemoryStore()) {
  await store.open("pad");
  const { ui, sent } = bridges();
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: pad() });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me: ana } as MakeCtxBase);
  return { ctx, store, sent };
}

describe("ctx.access", () => {
  it("is admin for everything on a store without peers, and the store's answer where it has one", async () => {
    const plain = await direct();
    expect(await plain.ctx.access("doc", "x")).toBe("admin");
    const grouped = await direct(new GroupedStore());
    expect(await grouped.ctx.access("doc", "mine")).toBe("admin");
    expect(await grouped.ctx.access("doc", "theirs")).toBe("reader");
  });
});

describe("ui.share({ record })", () => {
  it("hands the shell the record, its role and where to land — never a secret", async () => {
    const { ctx, sent } = await direct();
    expect(await ctx.ui.share({ text: "Write with me", record: { entity: "doc", id: "d1", page: "doc", param: "docId" } })).toBe(true);
    expect(sent).toEqual([{ text: "Write with me", record: { entity: "doc", id: "d1", role: "writer", page: "doc", param: "docId" } }]);
    await ctx.ui.share({ record: { entity: "doc", id: "d1", role: "reader" } });
    expect(sent[1]).toEqual({ record: { entity: "doc", id: "d1", role: "reader" } });
  });

  it("refuses an entity not declared shared, a bad role, a page that does not take the id, and two links at once", async () => {
    const { ctx, sent } = await direct();
    await expect(ctx.ui.share({ record: { entity: "note", id: "n1" } })).rejects.toThrow(/not declared share: "record"/);
    await expect(ctx.ui.share({ record: { entity: "doc", id: "d1", role: "owner" as never } })).rejects.toThrow(/"writer" or "reader"/);
    await expect(ctx.ui.share({ record: { entity: "doc", id: "d1", page: "all", param: "docId" } })).rejects.toThrow();
    await expect(ctx.ui.share({ record: { entity: "doc", id: "d1" }, url: "https://potyro.app" })).rejects.toThrow(/one of/);
    expect(sent).toEqual([]);
  });
});

const PAD_BUNDLE = `
globalThis.__potyroApp = {
  id: "pad", name: "Pad", version: "1.0.0", schemaVersion: 1,
  entities: { doc: { share: "record", fields: { title: { type: "text" }, notes: { type: "text" } }, actions: {
    look: async function(r, ctx){ await ctx.patch("doc", r.id, { notes: await ctx.access("doc", r.id) }); },
    invite: async function(r, ctx){ await ctx.ui.share({ text: "Join", record: { entity: "doc", id: r.id, role: "reader" } }); }
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "doc" } }],
  reminders: []
};
`;

describe.each(RUNNERS)("across the sealed runner: $name", (runner) => {
  it("ctx.access and a record share cross the bridge", async () => {
    const store = new GroupedStore();
    await store.open("pad");
    const { ui, sent } = bridges();
    const loadIsolated = await runner.loader(store);
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: PAD_BUNDLE, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me: ana } as MakeCtxBase);
    const row = await store.insert("doc", { id: "theirs", title: "Plan" });
    await loaded.callAction("doc", "look", { ...row } as never, ctx);
    expect((await store.get("doc", "theirs"))?.notes).toBe("reader");
    await loaded.callAction("doc", "invite", { ...row } as never, ctx);
    expect(sent).toEqual([{ text: "Join", record: { entity: "doc", id: "theirs", role: "reader" } }]);
    loaded.dispose();
  });
});
