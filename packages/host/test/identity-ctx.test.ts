// `ctx.me`, `ctx.space` and host-stamped `createdBy` (KA-18).
//
// The security-relevant half is that `createdBy` is NOT app-settable. In a shared ledger, code that
// could write its own `createdBy` could rewrite authorship — and untrusted code, which reaches the
// store through exactly this `ctx`, is precisely the code that would want to. So the guarantee has
// to hold at the seam rather than by convention, and these tests fail if the stripping is removed.
//
// No store beyond `MemoryStore`, no network, no cojson: identity is engine-independent by design.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { defineApp } from "potyro";
import type { NavBridge, UiBridge } from "@potyro/host";
import { createHost, type MakeCtxBase } from "../src/index.js";
import { FakeCapabilities } from "@potyro/capabilities";

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
        },
      },
    },
    pages: [
      { id: "all", title: "All", view: { type: "list", entity: "expense", display: { primary: "description" } } },
    ],
  });

const ui: UiBridge = {
  toast: () => {},
  confirm: async () => true,
  prompt: async () => null,
  pick: async () => null,
};
const nav: NavBridge = { navigate: () => {} };

async function setup(extra?: Partial<MakeCtxBase>) {
  const store = new MemoryStore();
  await store.open("ledger");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  const ctx = host.makeCtx(loaded, {
    store,
    caps: new FakeCapabilities(),
    ui,
    nav,
    ...extra,
  } as MakeCtxBase);
  return { ctx, store };
}

describe("ctx.me", () => {
  it("is always present, even with no identity supplied", async () => {
    // The contract app code is written against: `ctx.me` never has to be checked for existence, so
    // no app ever branches on whether identity or sync happens to exist.
    const { ctx } = await setup();
    expect(ctx.me).toBeTruthy();
    expect(typeof ctx.me.id).toBe("string");
    expect(typeof ctx.me.name).toBe("string");
  });

  it("is the person the composition root supplies", async () => {
    const { ctx } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    expect(ctx.me).toEqual({ id: "co_zAna", name: "Ana" });
  });
});

describe("ctx.space", () => {
  it("is absent for a solo app", async () => {
    // Solo is a space with one member and no transport (ADR D3) — modelled as "no space" so the
    // idiom `ctx.space?.members ?? [ctx.me]` reads correctly.
    const { ctx } = await setup();
    expect(ctx.space).toBeUndefined();
  });

  it("carries members and this device's role when synced", async () => {
    const { ctx } = await setup({
      me: { id: "co_zAna", name: "Ana" },
      space: {
        id: "co_zSpace",
        role: "admin",
        members: [
          { id: "co_zAna", name: "Ana", role: "admin" },
          { id: "co_zBruno", name: "Bruno", role: "writer" },
        ],
        invite: async () => "https://example.test/#join=…",
      },
    });
    expect(ctx.space?.members.map((m) => m.name)).toEqual(["Ana", "Bruno"]);
    expect(ctx.space?.role).toBe("admin");
  });
});

describe("createdBy is stamped by the host", () => {
  it("records who created a record", async () => {
    const { ctx, store } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    const made = await ctx.create("expense", { description: "Dinner" });

    const raw = await store.get("expense", made.id);
    expect(raw?.createdBy).toBe("co_zAna");
  });

  it("IGNORES an app-supplied createdBy", async () => {
    // The whole point. An app that could set this could claim someone else wrote a ledger entry.
    const { ctx, store } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    const made = await ctx.create("expense", { description: "Dinner", createdBy: "co_zBruno" });

    const raw = await store.get("expense", made.id);
    expect(raw?.createdBy).toBe("co_zAna");
    expect(raw?.createdBy).not.toBe("co_zBruno");
  });

  it("cannot be changed by a later patch", async () => {
    // Authorship is a fact about the insert. Not even the real author may rewrite it.
    const { ctx, store } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    const made = await ctx.create("expense", { description: "Dinner" });

    await ctx.patch("expense", made.id, { description: "Dinner out", createdBy: "co_zBruno" });

    const raw = await store.get("expense", made.id);
    expect(raw?.createdBy).toBe("co_zAna");
    expect(raw?.description).toBe("Dinner out"); // the legitimate part of the patch still applied
  });

  it("does not reject a patch that merely echoes a resolved record back", async () => {
    // Round-tripping a record through a form resends every field it was given, `createdBy` among
    // them. Stripping rather than rejecting is what keeps that from failing for doing nothing wrong.
    const { ctx } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    const made = await ctx.create("expense", { description: "Dinner" });
    await expect(ctx.patch("expense", made.id, { ...made, description: "Brunch" })).resolves.toBeTruthy();
  });

  it("keeps an app field like paidBy entirely under the app's control", async () => {
    // `createdBy` (who entered it) and `paidBy` (who paid) are different questions — conflating
    // them would make the unforgeable one useless, since you often log a friend's payment.
    const { ctx, store } = await setup({ me: { id: "co_zAna", name: "Ana" } });
    const made = await ctx.create("expense", { description: "Dinner", paidBy: "co_zBruno" });

    const raw = await store.get("expense", made.id);
    expect(raw?.createdBy).toBe("co_zAna");
    expect(raw?.paidBy).toBe("co_zBruno");
  });
});
