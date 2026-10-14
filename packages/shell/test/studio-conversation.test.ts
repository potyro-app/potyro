// What was said about earlier versions reaches the modify loop (#279): the Studio hands the
// conversation before the current request to the engine, the engine to `startModify`, and that to
// the loop — chat text only. The loop's own handling (recap, read_conversation) is tested in the
// generator with scripted engines; this is the wiring between them.

import { describe, expect, it, vi } from "vitest";
import type { ConversationEntry, ModifyLoopDeps } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const seen = vi.hoisted(() => ({ opts: [] as unknown[], deps: [] as unknown[] }));

vi.mock("@potyro/generator/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@potyro/generator/agent")>()),
  runModifyLoop: async (deps: unknown) => {
    seen.deps.push(deps);
    return { kind: "stopped" };
  },
}));

const { startModify } = await import("../src/start-modify.js");

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const earlier: ConversationEntry[] = [
  { kind: "ask", text: "add a rating" },
  { kind: "question", text: "Out of 5 or 10?" },
  { kind: "ask", text: "10, but not now" },
  { kind: "answer", text: "Okay, I didn't change anything." },
];

describe("the earlier conversation reaches the loop (#279)", () => {
  it("startModify hands it to the loop as it was given", async () => {
    await startModify({ source: "SRC", instruction: "now add the rating", before: { pages: [], entities: {} }, engine, conversation: earlier });
    const deps = seen.deps.at(-1) as ModifyLoopDeps;
    expect(deps.conversation).toEqual(earlier);
  });

  it("with none, the loop gets none", async () => {
    await startModify({ source: "SRC", instruction: "make it blue", before: { pages: [], entities: {} }, engine });
    expect((seen.deps.at(-1) as ModifyLoopDeps).conversation).toBeUndefined();
  });
});

describe("the Studio engine passes it on", () => {
  it("modify(…, earlier) reaches startModify", async () => {
    vi.resetModules();
    vi.doMock("../src/start-modify.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/start-modify.js")>()),
      startModify: async (opts: unknown) => {
        seen.opts.push(opts);
        return { kind: "stopped" };
      },
    }));
    const { studioEngine } = await import("../src/studio-engine.js");
    await studioEngine(engine, () => {}).modify("SRC", { pages: [], entities: {} }, "now add the rating", undefined, earlier);
    expect((seen.opts.at(-1) as { conversation?: unknown }).conversation).toEqual(earlier);
  });
});
