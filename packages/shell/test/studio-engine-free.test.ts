// @vitest-environment happy-dom
//
// Potyro's free engine saying no (#121): a used-up month, a pause, a busy device reach the
// conversation as the person's words with what to do next, never as "Could not make it: …429…".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const calls = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("../src/start-create.js", async (orig) => ({
  ...(await orig<typeof import("../src/start-create.js")>()),
  startCreate: async () => {
    throw calls.error;
  },
}));
vi.mock("../src/start-modify.js", async (orig) => ({
  ...(await orig<typeof import("../src/start-modify.js")>()),
  startModify: async () => {
    throw calls.error;
  },
}));
vi.mock("../src/trusted-loader.js", () => ({ loadTrustedModule: async () => ({ pages: [], entities: {} }) }));

const { studioEngine } = await import("../src/studio-engine.js");
const { FreeAiRefusal, checkFreeAi, refusalText, resetFreeAi } = await import("../src/free-ai.js");
const { resetRelayMemory } = await import("../src/app-ai.js");

const potyro: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "potyro" };
const healthy = (async () => new Response(JSON.stringify({ ok: true, chat: true }), { status: 200 })) as unknown as typeof fetch;

beforeEach(async () => {
  resetRelayMemory();
  resetFreeAi();
  await checkFreeAi({ url: "https://apps.test/ai/health", fetch: healthy, online: () => true });
});

describe("the free engine's refusals in the Studio", () => {
  it("a create that was refused says so in words", async () => {
    calls.error = new FreeAiRefusal("allowance", refusalText("allowance"));
    const out = await studioEngine(potyro, () => {}).create("a reading tracker");
    expect(out).toMatchObject({ kind: "failed", text: refusalText("allowance") });
  });

  it("a change that was refused says so in words", async () => {
    calls.error = new FreeAiRefusal("busy", refusalText("busy"));
    const out = await studioEngine(potyro, () => {}).modify('export default {}', { pages: [], entities: {} }, "add a field");
    expect(out).toMatchObject({ kind: "failed", text: "This device already has a request going. Wait for it to finish, then try again." });
  });
});
