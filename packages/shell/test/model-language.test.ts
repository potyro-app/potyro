// The person's language reaching every Studio model turn (#301): where it comes from (`currentLocale`,
// the stand-in #298 replaces) and that create, modify (the loop and the one-turn guard) and repair
// each carry it. The model is never called: the turn functions are observed at their seams.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenPrompt, ModifyContext } from "@potyro/generator/backends";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const seen = vi.hoisted(() => ({
  startModify: [] as Array<{ language?: string }>,
  generate: [] as GenPrompt[],
  modifyTurn: [] as Array<{ ctx?: ModifyContext; instruction: string }>,
}));

vi.mock("../src/start-modify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/start-modify.js")>()),
  startModify: async (opts: { language?: string }) => {
    seen.startModify.push(opts);
    return { kind: "question", text: "Który pokój?", transcript: [] };
  },
}));

vi.mock("../src/model-turn.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/model-turn.js")>()),
  backendFor: async () => ({
    name: "fake",
    generate: async (p: GenPrompt) => {
      seen.generate.push(p);
      return "QUESTION: Jaka lista?";
    },
    modify: async () => "",
  }),
  modifyTurn: async (opts: { ctx?: ModifyContext; instruction: string }) => {
    seen.modifyTurn.push(opts);
    return "NOT-IN-APP: to nie jest sprawa aplikacji.";
  },
}));

const { studioEngine } = await import("../src/studio-engine.js");
const { currentLocale, LOCALE_KEY } = await import("../src/locale.js");

const ENGLISH_APP = 'export default defineApp({\n  id: "x",\n  name: "Plants",\n  entities: { plant: { label: "Plant", fields: {} } },\n});';
const before = { pages: [], entities: {} };
const loopEngine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "k" };
const oneTurnEngine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "k" };

afterEach(() => {
  vi.unstubAllGlobals();
  seen.startModify.length = 0;
  seen.generate.length = 0;
  seen.modifyTurn.length = 0;
});

const storage = (saved: string | null) => ({ getItem: (k: string) => (k === LOCALE_KEY ? saved : null), setItem() {}, removeItem() {} });

describe("currentLocale", () => {
  it("is the language saved on this device", () => {
    vi.stubGlobal("localStorage", storage("pt-BR"));
    vi.stubGlobal("navigator", { language: "pl-PL", languages: ["pl-PL"] });
    expect(currentLocale()).toBe("pt-BR");
  });

  it("else the first of the device's languages Potyro speaks", () => {
    vi.stubGlobal("localStorage", storage(null));
    vi.stubGlobal("navigator", { language: "fr-FR", languages: ["fr-FR", "pl-PL", "en-US"] });
    expect(currentLocale()).toBe("pl");
  });

  it("ignores a saved value it does not know, and falls back to English", () => {
    vi.stubGlobal("localStorage", storage("klingon"));
    vi.stubGlobal("navigator", { language: "fr-FR", languages: [] });
    expect(currentLocale()).toBe("en");
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(currentLocale()).toBe("de");
  });
});

describe("the Studio's turns carry the person's language", () => {
  it("create: the prompt the backend gets says Polish, and the question comes back as one", async () => {
    const out = await studioEngine(loopEngine, () => {}, undefined, "pl").create("lista zakupów");
    expect(seen.generate[0]).toMatchObject({ description: "lista zakupów", language: "pl" });
    expect(out).toEqual({ kind: "question", text: "Jaka lista?" });
  });

  it("modify through the loop: startModify is handed the language", async () => {
    const out = await studioEngine(loopEngine, () => {}, undefined, "pl").modify(ENGLISH_APP, before, "dodaj pokój");
    expect(seen.startModify[0]).toMatchObject({ language: "pl", instruction: "dodaj pokój" });
    expect(out).toEqual({ kind: "question", text: "Który pokój?" });
  });

  it("modify in one turn: the context says the person's language and the app's own, read off it", async () => {
    await studioEngine(oneTurnEngine, () => {}, undefined, "pl").modify(ENGLISH_APP, before, "dodaj pokój");
    expect(seen.modifyTurn[0]!.ctx).toEqual({ language: { person: "pl", app: "en" } });
  });

  it("repair: the same context rides with the repair instruction", async () => {
    await studioEngine(oneTurnEngine, () => {}, undefined, "pt-BR").repair(ENGLISH_APP, ["bad schemaVersion"]).catch(() => undefined);
    expect(seen.modifyTurn[0]!.ctx).toEqual({ language: { person: "pt-BR", app: "en" } });
    expect(seen.modifyTurn[0]!.instruction).toContain("bad schemaVersion");
  });

  it("without a language given, reads it from the device", async () => {
    vi.stubGlobal("localStorage", storage("pl"));
    await studioEngine(loopEngine, () => {}).create("lista");
    expect(seen.generate[0]!.language).toBe("pl");
  });
});
