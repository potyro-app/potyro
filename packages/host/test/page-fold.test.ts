// Functions on a PAGE called over its rows, through `callFold` with a `page.` path: a page action's
// `when` ("Done shopping" only once something is ticked) and a checklist's `quickAdd.usuals` (what the
// empty add box offers). Trusted and in both sealed runners, the same answers — a sealed app's
// definition carries no functions on the shell's side, so these only work if the host runs them.

import { describe, expect, it } from "vitest";
import { defineApp, type Ctx, type PotyroApp, type Resolved } from "potyro";
import { MemoryStore, type Store } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type LoadedApp, type UiBridge } from "../src/index.js";
import { RUNNERS } from "./runners.js";

const WHEN = "function (rows) { return rows.some(function (r) { return r.bought; }); }";
const USUALS = 'function (rows) { var on = rows.map(function (r) { return r.name; }); return ["Milk", "Eggs", "Bread"].filter(function (n) { return on.indexOf(n) < 0; }); }';
const RUN = "async function () {}";

const SOURCE = `{
  id: "shop", name: "Shop", version: "1.0.0", schemaVersion: 1,
  entities: { item: { fields: { name: { type: "text" }, bought: { type: "boolean" } } } },
  pages: [{
    id: "list", title: "List",
    actions: [{ label: "Done shopping", run: ${RUN}, when: ${WHEN} }],
    primaryAction: 0,
    view: { type: "checklist", entity: "item", done: "bought", quickAdd: { usuals: ${USUALS} } }
  }],
  reminders: []
}`;

type Make = (store: Store) => Promise<LoadedApp>;
const direct: Make = async () => createHost().load({ kind: "module", app: defineApp(new Function(`return ${SOURCE}`)() as never) as PotyroApp });
const sealed =
  (runner: (typeof RUNNERS)[number]): Make =>
  async (store) =>
    createHost({ loadIsolated: await runner.loader(store) }).load({ kind: "bundle", code: `globalThis.__potyroApp = ${SOURCE};`, provenance: "untrusted" });
const MAKERS: Array<[string, Make]> = [["direct", direct], ...RUNNERS.map((r) => [r.name, sealed(r)] as [string, Make])];

const UI = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null } as unknown as UiBridge;
const row = (name: string, bought: boolean): Resolved => ({ id: name, createdAt: "", updatedAt: "", name, bought }) as Resolved;

describe.each(MAKERS)("%s", (_name, make) => {
  it("a page action's `when` is asked over the page's rows", async () => {
    const store = new MemoryStore();
    await store.open("shop");
    const loaded = await make(store);
    const ctx = createHost().makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: UI, nav: { navigate: () => {} } }) as Ctx;
    expect(await loaded.callFold("list", "page.actions.0.when", [row("Milk", false)], ctx)).toBe(false);
    expect(await loaded.callFold("list", "page.actions.0.when", [row("Milk", false), row("Eggs", true)], ctx)).toBe(true);
    // Only functions, and only own keys: the page's label is not callable, nor is anything inherited.
    await expect(loaded.callFold("list", "page.actions.0.label", [], ctx)).rejects.toThrow(/no function/);
    await expect(loaded.callFold("list", "page.__proto__.constructor", [], ctx)).rejects.toThrow(/no function/);
    loaded.dispose();
  });

  it("a checklist's `quickAdd.usuals` names what the empty box offers", async () => {
    const store = new MemoryStore();
    await store.open("shop");
    const loaded = await make(store);
    const ctx = createHost().makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: UI, nav: { navigate: () => {} } }) as Ctx;
    expect(await loaded.callFold("list", "quickAdd.usuals", [row("Eggs", false)], ctx)).toEqual(["Milk", "Bread"]);
    loaded.dispose();
  });
});
