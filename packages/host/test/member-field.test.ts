// The `member` field type (KA-19).
//
// Stored as an account id; app code sees a `Person`, so `e.paidBy.name` reads naturally and a view
// can render a real chip. The candidate set is SPACE MEMBERSHIP, not a table the app maintains —
// which is the whole reason this is a distinct type rather than a relation to a `person` entity.
// Membership is maintained by the invite and key machinery; rows are not, so a relation would let
// any app forge a member.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { defineApp } from "karta";
import type { NavBridge, UiBridge } from "@karta/host";
import { FakeCapabilities } from "@karta/capabilities";
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

async function setup(extra?: Partial<MakeCtxBase>) {
  const store = new MemoryStore();
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
    // beside their id is more honest than an empty cell, which reads as data loss.
    const { ctx } = await setup(shared);
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zGone" });
    expect(made.paidBy).toMatchObject({ id: "co_zGone", name: "Unknown" });
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
