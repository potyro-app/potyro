import { describe, expect, it, vi } from "vitest";

// Edit mode and the Studio ask a model through ONE turn (model-turn.ts). Edit mode used to call the
// dev server's `claude -p` route and nothing else, so on a deployed build the agent was gone even with
// the person's own key pasted. The turn goes to the chosen engine, and carries the view context.

const modify = vi.fn(async () => "REPLY");
vi.mock("@karta/generator/backends", async (orig) => ({
  ...(await orig<object>()),
  createOpenRouterBackend: async () => ({ name: "or", generate: async () => "", modify }),
  createClaudeBackend: async () => ({ name: "claude", generate: async () => "", modify }),
}));

const { canUseEngine, modifyTurn } = await import("../src/model-turn.js");
const { DEFAULT_ENGINE_CONFIG } = await import("../src/engines.js");

describe("modifyTurn", () => {
  it("sends an edit to the chosen cloud engine with the view the person pointed at", async () => {
    const engine = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "sk-or" };
    const ctx = { target: { viewType: "list", fields: ["display?"], pageFields: ["title"] } };
    expect(await modifyTurn({ engine, source: "SRC", instruction: "add a note field", ctx })).toBe("REPLY");
    expect(modify).toHaveBeenCalledWith("SRC", "add a note field", { id: "edit", description: "add a note field" }, ctx);
  });

  it("a cloud engine without its key cannot be used, and says where to add it", async () => {
    const engine = { ...DEFAULT_ENGINE_CONFIG, engine: "anthropic" as const, anthropicKey: "" };
    expect(canUseEngine(engine)).toBe(false);
    expect(canUseEngine({ ...engine, anthropicKey: "sk-ant" })).toBe(true);
    await expect(modifyTurn({ engine, source: "S", instruction: "x" })).rejects.toThrow(/Model settings/);
  });
});
