// The `member` field type (KA-19).
//
// Stored as an account id; app code sees a `Person`, so `e.paidBy.name` reads naturally and a view
// can render a real chip. The candidate set is SPACE MEMBERSHIP, not a table the app maintains —
// which is the whole reason this is a distinct type rather than a relation to a `person` entity.
// Membership is maintained by the invite and key machinery; rows are not, so a relation would let
// any app forge a member.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { defineApp } from "potyro";
import type { NavBridge, UiBridge } from "@potyro/host";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase } from "../src/index.js";

const app = () =>
  defineApp({
    id: "ledger",
    name: "Ledger",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      expense: {
        label: "Expense",
        displayField: "description",
        fields: {
          description: { type: "text", required: true },
          paidBy: { type: "member" },
          splitAmong: { type: "member", many: true },
        },
      },
    },
    pages: [
      { id: "all", title: "All", view: { type: "list", entity: "expense", display: { primary: "description" } } },
    ],
  });

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

const ana = { id: "co_zAna", name: "Ana" };
const bruno = { id: "co_zBruno", name: "Bruno", role: "writer" as const };

/** A store with a space: every account that has ever been a member, removed ones included. */
class SpaceStore extends MemoryStore {
  constructor(private readonly ever: string[]) {
    super();
  }
  memberIds(): readonly string[] {
    return this.ever;
  }
}

async function setup(extra?: Partial<MakeCtxBase>) {
  const store = extra?.store ?? new MemoryStore();
  await store.open("ledger");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, ...extra } as MakeCtxBase);
  return { ctx, store };
}

const shared = {
  me: ana,
  space: {
    id: "co_zSpace",
    role: "admin" as const,
    members: [{ ...ana, role: "admin" as const }, bruno],
    invite: async () => "https://example.test/#join=…",
  },
};

describe("member fields resolve to people", () => {
  it("turns a stored id into a person", async () => {
    const { ctx } = await setup(shared);
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zBruno" });
    expect(made.paidBy).toMatchObject({ id: "co_zBruno", name: "Bruno" });
  });

  it("resolves every id in a `many` field", async () => {
    const { ctx } = await setup(shared);
    const made = await ctx.create("expense", {
      description: "Dinner",
      splitAmong: ["co_zAna", "co_zBruno"],
    });
    expect(made.splitAmong.map((p: { name: string }) => p.name)).toEqual(["Ana", "Bruno"]);
  });

  it("stores plain ids, not the resolved objects", async () => {
    // Writing people back into the record would put a name — a piece of space metadata that changes
    // when someone renames themselves — into every row of a shared ledger.
    const { ctx, store } = await setup(shared);
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zBruno" });
    expect((await store.get("expense", made.id))?.paidBy).toBe("co_zBruno");
  });

  it("resolves YOU without a space at all", async () => {
    // Solo degradation. Without this a `member` field would be useless until the app was shared,
    // which would make every shared app broken right up to the moment it mattered.
    const { ctx } = await setup({ me: ana });
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zAna" });
    expect(made.paidBy).toMatchObject({ id: "co_zAna", name: "Ana" });
  });

  it("keeps a departed member readable rather than blanking the field", async () => {
    // A ledger entry naming someone who has since left the space must still make sense. "Unknown"
    // beside their id is more honest than an empty cell, which reads as data loss. Written while
    // they were here — today you can only name someone who is in the app (see below).
    const store = new SpaceStore(["co_zAna", "co_zBruno", "co_zGone"]);
    const { ctx } = await setup({ ...shared, store });
    const row = await store.insert("expense", { description: "Dinner", paidBy: "co_zGone" } as never);
    expect((await ctx.get("expense", row.id))?.paidBy).toMatchObject({ id: "co_zGone", name: "Unknown" });
  });

  it("leaves an unset member field alone", async () => {
    const { ctx } = await setup(shared);
    const made = await ctx.create("expense", { description: "Dinner" });
    expect(made.paidBy ?? null).toBeNull();
  });
});

describe("member vs createdBy", () => {
  it("keeps who-paid separate from who-entered", async () => {
    // The spike's F5: you often log a friend's payment. Conflating the two would make the
    // unforgeable one useless.
    const { ctx, store } = await setup(shared);
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zBruno" });

    expect(made.paidBy.id).toBe("co_zBruno"); // app data, freely editable
    expect((await store.get("expense", made.id))?.createdBy).toBe("co_zAna"); // host-stamped
  });
});

// KA-19's last box: a `member` value is checked against the people in the space, not just its shape.
describe("member values name people in the app", () => {
  const ledger = () => new SpaceStore(["co_zAna", "co_zBruno", "co_zGone"]); // Gone was removed

  it("refuses to name someone who is not in the app", async () => {
    const store = ledger();
    const { ctx } = await setup({ ...shared, store });
    await expect(ctx.create("expense", { description: "Dinner", paidBy: "co_zMallory" })).rejects.toThrow("Paid By must be someone in this app.");
    await expect(ctx.create("expense", { description: "Dinner", splitAmong: ["co_zAna", "co_zMallory"] })).rejects.toThrow("Split Among must be people in this app.");
    expect(await store.all("expense")).toEqual([]);
  });

  it("refuses to newly name someone who has left, but keeps a row that already did saveable", async () => {
    const store = ledger();
    const { ctx } = await setup({ ...shared, store });
    const row = await store.insert("expense", { description: "Dinner", paidBy: "co_zGone" } as never);
    // The edit form sends every field back: an unchanged "paid by Gone" must not block the save.
    await ctx.patch("expense", row.id, { description: "Dinner out", paidBy: "co_zGone" });
    expect((await store.get("expense", row.id))?.description).toBe("Dinner out");

    const other = await ctx.create("expense", { description: "Taxi", paidBy: "co_zBruno" });
    await expect(ctx.patch("expense", other.id, { paidBy: "co_zGone" })).rejects.toThrow(/must be someone in this app/);
  });

  it("does not show a value naming someone who was never here", async () => {
    const store = ledger();
    const { ctx } = await setup({ ...shared, store });
    const row = await store.insert("expense", { description: "Dinner", paidBy: "co_zMallory", splitAmong: ["co_zAna", "co_zMallory"] } as never);
    const got = await ctx.get("expense", row.id);
    expect(got?.paidBy).toBeUndefined();
    expect(got?.splitAmong).toBeUndefined();
  });

  it("checks only the shape in a solo app, where there is nobody to check against", async () => {
    const { ctx } = await setup({ me: ana });
    const made = await ctx.create("expense", { description: "Imported", paidBy: "co_zSomeoneElse" });
    expect(made.paidBy).toMatchObject({ id: "co_zSomeoneElse" });
  });
});

