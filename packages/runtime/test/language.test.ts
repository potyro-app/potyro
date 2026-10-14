// The runtime shows an app in the person's language (#302, docs/20 §3.2): the definition views read
// is localized, every function's ctx carries the language, and a switch re-runs what depends on it.

import { describe, expect, it } from "vitest";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type QueryState } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const DAY = 86_400_000;

function shopping(): PotyroApp {
  return defineApp({
    id: "shop",
    name: { en: "Groceries", pl: "Zakupy" },
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    languages: ["en", "pl"],
    entities: {
      item: {
        label: { en: "Item", pl: "Produkt" },
        fields: {
          name: { type: "text", label: { en: "Name", pl: "Nazwa" } },
          aisle: { type: "enum", options: ["produce", "dairy"], labels: { produce: { en: "Produce", pl: "Warzywa" }, dairy: { en: "Dairy", pl: "Nabiał" } } },
          due: { type: "datetime" },
        },
        computed: {
          note: (r, ctx) => ctx.t({ en: "Buy {name}", pl: "Kup: {name}" }, { name: String(r.name) }),
          when: (r, ctx) => ctx.format.date(r.due as Date, { dateStyle: "long" }),
        },
      },
    },
    pages: [
      {
        id: "list",
        title: { en: "Shopping", pl: "Zakupy" },
        view: { type: "list", entity: "item", emptyText: (ctx) => ({ en: `Nothing, ${ctx.locale}`, pl: `Nic, ${ctx.locale}` }) },
      },
      { id: "map", title: "Map", view: { type: "map", entity: "item", geo: "name", camera: { center: [21, 52], zoom: 5 } } as never },
    ],
    reminders: [{ id: "buy", entity: "item", when: (r) => r.due as Date, title: (r, ctx) => ctx.t({ en: "Buy {name}", pl: "Kup: {name}" }, { name: String(r.name) }) }],
  });
}

async function setup(app: PotyroApp, languages: string[]) {
  const store = new MemoryStore();
  await store.open(app.id);
  const host = createHost();
  const caps = new FakeCapabilities({ notifications: true });
  const loaded = await host.load({ kind: "module", app });
  const runtime = createRuntime({ app: loaded, host, store, caps, ui, nav, languages });
  return { store, runtime, caps, loaded };
}

describe("the runtime's language (docs/20 §3.2)", () => {
  it("shows the app in the person's language: the definition, ctx.locale and ctx.format", async () => {
    const { runtime, store } = await setup(shopping(), ["pl-PL", "en"]);
    expect(runtime.language).toEqual({ current: "pl", default: "en", available: ["en", "pl"] });
    expect(runtime.definition.name).toBe("Zakupy");
    expect(runtime.definition.entities.item!.fields.aisle).toMatchObject({ options: ["produce", "dairy"], labels: { produce: "Warzywa" } });
    expect(runtime.ctx.locale).toBe("pl");
    expect(runtime.ctx.format.locale).toBe("pl-PL");

    await store.insert("item", { name: "Mleko", aisle: "dairy", due: new Date("2026-10-20T12:00:00Z") });
    const { rows } = await runtime.queryPage("list");
    expect(rows[0]).toMatchObject({ note: "Kup: Mleko", when: "20 października 2026", aisle: "dairy" }); // the record keeps its value
  });

  it("resolves Dynamic<Words> page and view options — and leaves a camera alone", async () => {
    const { runtime } = await setup(shopping(), ["pl"]);
    expect(await runtime.pageOption("list", "title")).toBe("Zakupy");
    expect(await runtime.viewOption("list", "emptyText")).toBe("Nic, pl");
    expect(await runtime.viewOption("map", "camera")).toEqual({ center: [21, 52], zoom: 5 });
  });

  it("a switch re-localizes, re-runs live watchers and re-titles reminders", async () => {
    const { runtime, store, caps } = await setup(shopping(), ["pl"]);
    const item = await store.insert("item", { name: "Mleko", aisle: "dairy", due: new Date(Date.now() + 3 * DAY) });
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.get(`buy:${item.id}`)!.title).toBe("Kup: Mleko");

    const seen: QueryState[] = [];
    const stop = runtime.watchPageQuery("list", undefined, (s) => void (s.loading || seen.push(s)));
    await vi_waitFor(() => seen.length > 0);
    expect(seen.at(-1)!.rows[0]!.note).toBe("Kup: Mleko");

    let heard = 0;
    runtime.onLanguageChange(() => void heard++);
    expect(runtime.setLanguages(["en-US"])).toBe(true);
    expect(heard).toBe(1);
    expect(runtime.definition.name).toBe("Groceries");
    expect(runtime.ctx.format.locale).toBe("en-US");
    await vi_waitFor(() => seen.at(-1)!.rows[0]!.note === "Buy Mleko");
    await vi_waitFor(() => caps.notifications!.scheduled.get(`buy:${item.id}`)!.title === "Buy Mleko");
    stop();

    expect(runtime.setLanguages(["en-US"])).toBe(false); // nothing changed: nothing re-runs
    expect(heard).toBe(1);
  });

  it("an app that lacks the person's language opens in its own", async () => {
    const { runtime } = await setup(shopping(), ["de-DE"]);
    expect(runtime.language.current).toBe("en");
    expect(runtime.definition.name).toBe("Groceries");
    expect(runtime.ctx.format.locale).toBe("en"); // a German reads "October 20" inside English words
  });

  it("an old app (no language) is shown exactly as written — the same definition object", async () => {
    const old = defineApp({ id: "old", name: "Old", version: "1.0.0", schemaVersion: 1, entities: { a: { fields: { x: { type: "text" } } } }, pages: [{ id: "p", title: "P", view: { type: "list", entity: "a" } }] });
    const { runtime, loaded } = await setup(old, ["pl-PL"]);
    expect(runtime.language).toEqual({ current: undefined, default: undefined, available: [] });
    expect(runtime.definition).toBe(loaded.definition);
    expect(runtime.ctx.locale).toBe("pl"); // functions still learn the person's language
    expect(runtime.ctx.format.locale).toBe("pl-PL");
  });
});

async function vi_waitFor(ok: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}
