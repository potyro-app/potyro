// `ctx.space` must not be a snapshot (KA-36 follow-up).
//
// It used to be captured once at boot, so an app opened before someone joined listed only the people
// who were there then — for the whole session. Every later edit of theirs then rendered as an account
// id, which is exactly the case the activity feed exists to report, and the same staleness would hit
// any app reading `ctx.space.members` itself (a Splitwise-style split-among default, a person
// picker, "who is in this list").
//
// The fix is to accept a FUNCTION, resolved per evaluation pass. These pin both forms, because tests
// and fakes legitimately pass a fixed value.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { defineApp } from "karta";
import type { Space } from "karta";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { FakeCapabilities } from "@karta/capabilities";
import { createRuntime } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

const app = () =>
  defineApp({
    id: "who",
    name: "Who",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { note: { displayField: "title", fields: { title: { type: "text" } } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } } }],
  });

const space = (names: string[]): Space =>
  ({
    id: "co_zSpace",
    role: "admin",
    members: names.map((n) => ({ id: `co_z${n}`, name: n, role: "writer" as const })),
    invite: async () => "",
  }) as Space;

async function runtimeWith(spaceDep: Space | (() => Space | undefined)) {
  const store = new MemoryStore();
  await store.open("who");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  return createRuntime({
    app: loaded,
    host,
    store,
    caps: new FakeCapabilities(),
    ui,
    nav,
    me: { id: "co_zAna", name: "Ana" },
    space: spaceDep,
  });
}

describe("ctx.space", () => {
  it("reflects membership as it is NOW when given a function", async () => {
    let current = space(["Ana"]);
    const runtime = await runtimeWith(() => current);

    expect(runtime.ctx.space?.members.map((m) => m.name)).toEqual(["Ana"]);

    // Bruno joins mid-session. No reload, no new runtime.
    current = space(["Ana", "Bruno"]);
    expect(runtime.ctx.space?.members.map((m) => m.name)).toEqual(["Ana", "Bruno"]);
  });

  it("still accepts a plain value, for tests and fakes", async () => {
    const runtime = await runtimeWith(space(["Ana"]));
    expect(runtime.ctx.space?.members.map((m) => m.name)).toEqual(["Ana"]);
  });

  it("is undefined for a solo app either way", async () => {
    const runtime = await runtimeWith(() => undefined);
    expect(runtime.ctx.space).toBeUndefined();
  });
});
