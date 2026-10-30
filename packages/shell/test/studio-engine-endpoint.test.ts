// An OpenAI-compatible endpoint (#121) whose model takes no tools, or that never answers. Ollama's
// llama3 answers a request with tools with a 400, "does not support tools": the Studio then makes or
// changes the app in one plain turn, which needs none, and goes straight there for the rest of the
// session. An endpoint that never answered is said as what to check, never as the browser's
// "Failed to fetch".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const APP = 'import { defineApp } from "potyro";\nexport default defineApp({ name: "Books" });';
const calls = vi.hoisted(() => ({ loopCreate: 0, loopModify: 0, generate: 0, modifyTurn: 0, loopError: null as unknown, turnError: null as unknown }));

vi.mock("../src/start-create.js", async (orig) => ({
  ...(await orig<typeof import("../src/start-create.js")>()),
  startCreate: async () => {
    calls.loopCreate += 1;
    if (calls.loopError) throw calls.loopError;
    return { kind: "source", source: "LOOPED", warnings: [], draft: 1, candidate: 1 };
  },
}));
vi.mock("../src/start-modify.js", async (orig) => ({
  ...(await orig<typeof import("../src/start-modify.js")>()),
  startModify: async () => {
    calls.loopModify += 1;
    if (calls.loopError) throw calls.loopError;
    return { kind: "stopped" };
  },
}));
vi.mock("../src/model-turn.js", async (orig) => ({
  ...(await orig<typeof import("../src/model-turn.js")>()),
  backendFor: async () => ({
    generate: async () => {
      calls.generate += 1;
      if (calls.turnError) throw calls.turnError;
      return APP;
    },
  }),
  modifyTurn: async () => {
    calls.modifyTurn += 1;
    if (calls.turnError) throw calls.turnError;
    return "```ts\n" + APP.replace("Books", "Reading") + "\n```";
  },
}));
vi.mock("../src/trusted-loader.js", () => ({ loadTrustedModule: async () => ({ pages: [], entities: {} }) }));

const { studioEngine } = await import("../src/studio-engine.js");
const { forgetNoTools } = await import("../src/endpoint-tools.js");

const endpoint = (model = "llama3"): EngineConfig => ({ ...DEFAULT_ENGINE_CONFIG, engine: "endpoint", endpoint: { baseUrl: "http://localhost:11434/v1", key: "", model } });
const noTools = () => new Error("The endpoint 400: registry.ollama.ai/library/llama3:latest does not support tools", { cause: { kind: "tools-unsupported" } });
const noAnswer = () => new Error("The endpoint: no answer from http://localhost:11434/v1 (Failed to fetch)", { cause: { kind: "unreachable" } });
const before = { pages: [], entities: {} };

beforeEach(() => {
  forgetNoTools();
  Object.assign(calls, { loopCreate: 0, loopModify: 0, generate: 0, modifyTurn: 0, loopError: null, turnError: null });
});

describe("an endpoint whose model takes no tools", () => {
  it("a create falls back to one plain turn, and the next create goes straight there", async () => {
    calls.loopError = noTools();
    const studio = studioEngine(endpoint(), () => {});

    expect(await studio.create("a reading list")).toEqual({ kind: "source", source: APP, summary: "" });
    expect(calls).toMatchObject({ loopCreate: 1, generate: 1 });

    expect(await studio.create("a reading list")).toEqual({ kind: "source", source: APP, summary: "" });
    expect(calls).toMatchObject({ loopCreate: 1, generate: 2 });
  });

  it("a change falls back to one plain turn, and the session remembers it for the next request", async () => {
    calls.loopError = noTools();
    const out = await studioEngine(endpoint(), () => {}).modify(APP, before, "call it Reading");
    expect(out.kind).toBe("source");
    expect(out.kind === "source" && out.source).toContain('name: "Reading"');
    expect(calls).toMatchObject({ loopModify: 1, modifyTurn: 1 });

    // A new Studio engine (a new request) for the same address and model: no loop first.
    await studioEngine(endpoint(), () => {}).modify(APP, before, "call it Reading");
    await studioEngine(endpoint(), () => {}).create("a reading list");
    expect(calls).toMatchObject({ loopModify: 1, loopCreate: 0, modifyTurn: 2, generate: 1 });
  });

  it("is remembered per model: another model on the same server still gets the loop", async () => {
    calls.loopError = noTools();
    await studioEngine(endpoint("llama3"), () => {}).create("a reading list");
    calls.loopError = null;
    expect(await studioEngine(endpoint("qwen3"), () => {}).create("a reading list")).toMatchObject({ kind: "source", source: "LOOPED" });
    expect(calls.loopCreate).toBe(2);
  });

  it("any other loop failure is not a reason to fall back", async () => {
    calls.loopError = new Error("The endpoint 400: context too long");
    const out = await studioEngine(endpoint(), () => {}).create("a reading list");
    expect(out).toMatchObject({ kind: "failed" });
    expect(calls.generate).toBe(0);
  });
});

describe("an endpoint that never answered", () => {
  const WORDS = /^No answer from http:\/\/localhost:11434\/v1\. Check the server is running .*OLLAMA_ORIGINS.*Model settings\.$/;

  it("a create says what to check, with the browser's words kept as the detail", async () => {
    calls.loopError = noAnswer();
    const out = await studioEngine(endpoint(), () => {}).create("a reading list");
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.text).toMatch(WORDS);
    expect(out.kind === "failed" && out.detail).toMatch(/Failed to fetch/);
  });

  it("a change says the same, in the loop and in one plain turn", async () => {
    calls.loopError = noAnswer();
    const looped = await studioEngine(endpoint(), () => {}).modify(APP, before, "call it Reading");
    expect(looped.kind === "failed" && looped.text).toMatch(WORDS);

    calls.loopError = noTools();
    calls.turnError = noAnswer();
    const plain = await studioEngine(endpoint(), () => {}).modify(APP, before, "call it Reading");
    expect(plain.kind === "failed" && plain.text).toMatch(WORDS);
    const made = await studioEngine(endpoint(), () => {}).create("a reading list");
    expect(made.kind === "failed" && made.text).toMatch(WORDS);
  });
});
