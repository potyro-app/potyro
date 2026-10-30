// Which engines drive the loops (#121). Create, modify, the fix loop and Ask all run on a chat
// engine — OpenRouter, or an OpenAI-compatible endpoint — and every other engine is refused, as an
// outcome, before anything is spent. One table, every engine, every entry point: a new engine that
// answers wrongly in one of them shows up here, not in a person's Studio.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStep, newCase } from "@potyro/runtime";
import type { OpenRouterOptions } from "@potyro/generator/backends";
import { DEFAULT_ENGINE_CONFIG, ENGINES, canSearchWeb, chatEngineOptions, engineLabel, engineReady, type Engine, type EngineConfig } from "../src/engines.js";
import { modifyLoopRefusal } from "../src/start-modify.js";
import { createLoopRefusal } from "../src/start-create.js";
import { askRefusal, startAsk } from "../src/start-ask.js";
import { startFix } from "../src/start-fix.js";

const mocks = vi.hoisted(() => ({ engines: [] as OpenRouterOptions[], askDeps: [] as Array<Record<string, unknown>>, loopDeps: [] as Array<Record<string, unknown>>, askError: null as Error | null }));

vi.mock("@potyro/generator/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/backends")>();
  return {
    ...actual,
    createOpenRouterEngine: (opts: OpenRouterOptions) => {
      mocks.engines.push(opts);
      return { chat: { completions: { create: async () => ({ choices: [{ message: { content: "no" } }] }) } } };
    },
  };
});

vi.mock("@potyro/generator/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/agent")>();
  return {
    ...actual,
    runAskLoop: async (deps: Record<string, unknown>) => {
      mocks.askDeps.push(deps);
      if (mocks.askError) throw mocks.askError;
      return { kind: "stopped" };
    },
    runAgentLoop: async (deps: Record<string, unknown>) => {
      mocks.loopDeps.push(deps);
      return { kind: "stopped" };
    },
  };
});

/** Each engine, set up as a person would set it up: its key, or the endpoint's address and model. */
const ready: Record<Engine, EngineConfig> = {
  cli: { ...DEFAULT_ENGINE_CONFIG, engine: "cli" },
  edge: { ...DEFAULT_ENGINE_CONFIG, engine: "edge" },
  builtin: { ...DEFAULT_ENGINE_CONFIG, engine: "builtin" },
  anthropic: { ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "sk-ant" },
  openrouter: { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "sk-or" },
  endpoint: { ...DEFAULT_ENGINE_CONFIG, engine: "endpoint", endpoint: { baseUrl: "http://localhost:11434/v1", key: "", model: "qwen3" } },
};
/** Which engines run the loops once set up. */
const DRIVES: Record<Engine, boolean> = { cli: false, edge: false, builtin: false, anthropic: false, openrouter: true, endpoint: true };

const theCase = () => addStep(addStep(newCase("city-maps", "Search stays empty"), { kind: "open", page: "all" }), { kind: "expect", note: "it should list cities" });
const runtime = {
  definition: { pages: [{ id: "all", title: "Cities", view: { type: "list", entity: "city" } }] },
  queryPage: async () => ({ rows: [], ctx: {} }),
  ctx: { query: async () => [] },
} as never;

beforeEach(() => {
  mocks.engines.length = 0;
  mocks.askDeps.length = 0;
  mocks.loopDeps.length = 0;
  mocks.askError = null;
});

describe("the refusal matrix", () => {
  it("covers every engine there is", () => {
    expect(Object.keys(ready).sort()).toEqual(ENGINES.map((e) => e.id).sort());
  });

  for (const engine of Object.keys(ready) as Engine[]) {
    const cfg = ready[engine];
    const drives = DRIVES[engine];

    it(`${engine}: create and modify ${drives ? "run the loop" : "are refused the loop"}`, () => {
      expect(modifyLoopRefusal(cfg) === undefined).toBe(drives);
      expect(createLoopRefusal(cfg) === undefined).toBe(drives);
      expect(chatEngineOptions(cfg) !== null).toBe(drives);
    });

    it(`${engine}: Ask ${drives ? "runs" : "is refused"}`, async () => {
      expect(askRefusal(cfg) === null).toBe(drives);
      const out = await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: cfg });
      expect(out.kind === "refused").toBe(!drives);
      expect(mocks.askDeps).toHaveLength(drives ? 1 : 0);
    });

    it(`${engine}: the fix loop ${drives ? "runs" : "is refused"}`, async () => {
      const out = await startFix({ source: "x", theCase: theCase(), runtime, store: null as never, engine: cfg });
      expect(out.kind === "refused").toBe(!drives);
      expect(mocks.loopDeps).toHaveLength(drives ? 1 : 0);
    });
  }

  it("refuses OpenRouter without its key, and an endpoint without its address or model — but not without a key", () => {
    expect(modifyLoopRefusal({ ...ready.openrouter, openrouterKey: "" })).toMatch(/key/);
    expect(askRefusal({ ...ready.openrouter, openrouterKey: "" })).toMatch(/key/);
    const endpoint = ready.endpoint;
    expect(modifyLoopRefusal({ ...endpoint, endpoint: { ...endpoint.endpoint, baseUrl: " " } })).toMatch(/address/);
    expect(modifyLoopRefusal({ ...endpoint, endpoint: { ...endpoint.endpoint, model: "" } })).toMatch(/model/);
    expect(askRefusal({ ...endpoint, endpoint: { ...endpoint.endpoint, model: "" } })).toMatch(/address and a model/);
    expect(engineReady({ ...endpoint, endpoint: { ...endpoint.endpoint, key: "" } })).toBe(true);
  });

  it("refuses the fix loop for an endpoint with no model, before anything is spent", async () => {
    const cfg = { ...ready.endpoint, endpoint: { ...ready.endpoint.endpoint, model: "" } };
    const out = await startFix({ source: "x", theCase: theCase(), runtime, store: null as never, engine: cfg });
    expect(out.kind).toBe("refused");
    // Named as the dialog is named, as Ask names it.
    expect(out.kind === "refused" && out.text).toBe("The endpoint needs its address and a model to investigate. Add them in the Studio’s Model settings.");
    const keyless = await startFix({ source: "x", theCase: theCase(), runtime, store: null as never, engine: { ...ready.openrouter, openrouterKey: "" } });
    expect(keyless.kind === "refused" && keyless.text).toBe("openrouter needs your own API key to investigate. Add one in the Studio’s Model settings.");
    expect(mocks.engines).toHaveLength(0);
  });
});

describe("the endpoint's chat engine", () => {
  it("is OpenRouter's engine in the openai dialect, at the person's address, with their key and model", async () => {
    const cfg = { ...ready.endpoint, endpoint: { baseUrl: " https://api.openai.com/v1 ", key: " sk-proj ", model: " gpt-5-mini " } };
    expect(chatEngineOptions(cfg)).toEqual({ dialect: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-proj", model: "gpt-5-mini" });
    await startFix({ source: "x", theCase: theCase(), runtime, store: null as never, engine: cfg });
    expect(mocks.engines[0]).toMatchObject({ dialect: "openai", baseUrl: "https://api.openai.com/v1" });
    expect(mocks.loopDeps[0]!.model).toBe("gpt-5-mini");
  });

  it("never asks Ask to search the web — that search is OpenRouter's own", async () => {
    expect(canSearchWeb("endpoint")).toBe(false);
    expect(canSearchWeb("openrouter")).toBe(true);
    await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: ready.endpoint, webSearch: true });
    await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: ready.openrouter, webSearch: true });
    expect(mocks.askDeps.map((d) => d.webSearch)).toEqual([false, true]);
  });

  it("names its model on the engine button", () => {
    expect(engineLabel(ready.endpoint)).toBe("OpenAI-compatible endpoint · qwen3");
    expect(engineLabel({ ...ready.endpoint, endpoint: { ...ready.endpoint.endpoint, model: "" } })).toBe("OpenAI-compatible endpoint");
  });
});

describe("Ask on an endpoint that fails", () => {
  it("says what to check when the endpoint never answered", async () => {
    mocks.askError = new Error("The endpoint: no answer from http://localhost:11434/v1 (Failed to fetch)", { cause: { kind: "unreachable" } });
    const out = await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: ready.endpoint });
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.reason).toMatch(/^No answer from http:\/\/localhost:11434\/v1\. .*OLLAMA_ORIGINS.*Model settings\.$/);
  });

  it("says to choose another model when its model takes no tools", async () => {
    mocks.askError = new Error("The endpoint 400: qwen3 does not support tools", { cause: { kind: "tools-unsupported" } });
    const out = await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: ready.endpoint });
    expect(out.kind === "failed" && out.reason).toBe("qwen3 can’t use tools, and Ask needs them. Choose another model in the Studio’s Model settings.");
  });

  it("keeps any other error's own words", async () => {
    mocks.askError = new Error("The endpoint 500: out of memory");
    const out = await startAsk({ definition: { pages: [] } as never, request: "add a city", engine: ready.endpoint });
    expect(out.kind === "failed" && out.reason).toBe("The endpoint 500: out of memory");
  });
});
