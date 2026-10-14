// A computed written `{ value, label }` (#310) runs the same as a bare function, at both provenances:
// called on its own, and while resolving rows (where a later computed reads an earlier one). The
// definition a sealed runner hands back keeps the label as data, the value as the box's placeholder.

import { describe, expect, it } from "vitest";
import { defineApp, localize, type AppInput } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type UiBridge } from "../src/index.js";
import { RUNNERS, type Runner } from "./runners.js";

// Plain ES2020: the same text runs in the box.
const APP = `({
  id: "dishes", name: "Dishes", version: "1.0.0", schemaVersion: 1, language: "en", languages: ["en", "pl"],
  entities: { dish: { fields: { kcal: { type: "number" }, servings: { type: "number" } }, computed: {
    perServing: { label: { en: "Calories per serving", pl: "Kalorie na porcję" }, value: function(r){ return r.kcal / r.servings; } },
    doubled: function(r){ return r.perServing * 2; },
    size: { labels: { big: { en: "big", pl: "duża" } }, format: { en: "{value} kcal", pl: "{value} kcal" }, value: function(r){ return r.kcal > 500 ? "big" : "small"; } }
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "dish" } }]
})`;

async function load(kind: "direct" | Runner) {
  const store = new MemoryStore();
  await store.open("dishes");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost(kind === "direct" ? {} : { loadIsolated: await kind.loader(store) });
  const loaded =
    kind === "direct"
      ? await host.load({ kind: "module", app: defineApp(new Function(`return ${APP};`)() as AppInput) })
      : await host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${APP};`, provenance: "untrusted" });
  const base: MakeCtxBase = { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, now: new Date("2026-10-14T10:00:00Z") };
  return { loaded, ctx: host.makeCtx(loaded, base) };
}

describe("a computed with a label", () => {
  for (const kind of ["direct", ...RUNNERS] as const) {
    it(`runs its value, alone and while resolving rows (${kind === "direct" ? kind : kind.name})`, async () => {
      const { loaded, ctx } = await load(kind);
      await ctx.create("dish", { kcal: 900, servings: 3 });
      const [row] = await ctx.query("dish");
      expect(row).toMatchObject({ perServing: 300, doubled: 600 });
      expect(await loaded.callComputed("dish", "perServing", row!, ctx)).toBe(300);
      expect(localize(loaded.definition, "pl").entities.dish!.computed!.perServing).toMatchObject({ label: "Kalorie na porcję" });
      // A value's words are data too, and cross out of the box as data.
      expect(localize(loaded.definition, "pl").entities.dish!.computed!.size).toMatchObject({ labels: { big: "duża" }, format: "{value} kcal" });
      expect(row).toMatchObject({ size: "big" });
      loaded.dispose();
    });
  }
});
