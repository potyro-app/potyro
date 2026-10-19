// An app's catalogs reach it through its folder (docs/30): `locales/<lang>.po`, read when it opens.

import { describe, expect, it } from "vitest";
import { defineApp, type AppDefinition } from "potyro";
import { MemoryStore, fileSpace } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import type { UiBridge } from "@potyro/host";
import { compose } from "../src/compose.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

const app = () =>
  defineApp({
    id: "po-app",
    name: "Plants",
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    entities: { plant: { label: "Plant", fields: { name: { type: "text", label: "Name" } } } },
    pages: [{ id: "today", title: "Today", view: { type: "list", entity: "plant", emptyText: "Nothing yet" } }],
  } as never);

const PL = `msgid ""
msgstr "Language: pl\\n"

msgid "Today"
msgstr "Dziś"

msgid "Name"
msgstr "Nazwa"

msgid "{n} plants"
msgstr "{n} roślin"
`;

async function open(withCatalog: boolean, languages: string[], po = PL) {
  const store = new MemoryStore();
  await store.open("po-app");
  if (withCatalog) await fileSpace(store).write("locales/pl.po", new Blob([po], { type: "text/x-gettext-translation" }), { origin: "shipped" });
  return compose({ provenance: "trusted", app: app(), store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, languages });
}

describe("an app's catalogs, from its folder", () => {
  it("a Polish speaker reads the app through locales/pl.po; what it lacks stays English", async () => {
    const { runtime } = await open(true, ["pl-PL"]);
    const def = runtime.definition as unknown as AppDefinition & { pages: { title: string; view: { emptyText: string } }[] };
    expect(runtime.language.current).toBe("pl");
    expect(def.pages[0]!.title).toBe("Dziś");
    expect(def.pages[0]!.view.emptyText).toBe("Nothing yet");
    expect(runtime.ctx.t("{n} plants", { n: 5 })).toBe("5 roślin");
    expect(runtime.language.available).toEqual(["en", "pl"]);
  });

  it("without a catalog, or for an English speaker, the app is as written", async () => {
    expect((await open(false, ["pl-PL"])).runtime.definition.pages[0]!.title).toBe("Today");
    expect((await open(true, ["en-GB"])).runtime.definition.pages[0]!.title).toBe("Today");
  });

  it("a catalog that is not a .po file does not stop the app opening", async () => {
    const { runtime } = await open(true, ["pl-PL"], 'msgid "unterminated');
    expect(runtime.definition.pages[0]!.title).toBe("Today");
  });
});
