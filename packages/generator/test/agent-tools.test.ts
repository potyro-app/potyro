import { describe, expect, it } from "vitest";
import { runTool, toolSpecs, type AgentTool } from "../src/agent/tools.js";

const echo: AgentTool = {
  name: "echo",
  description: "Repeat a message back.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  run: async (args) => ({ ok: true, detail: String((args as { text: string }).text) }),
};

describe("tool protocol", () => {
  it("exposes each tool as a spec the model can be given", () => {
    const [spec] = toolSpecs([echo]);
    expect(spec).toEqual({
      type: "function",
      function: { name: "echo", description: "Repeat a message back.", parameters: echo.parameters },
    });
  });

  it("runs the named tool and returns its result", async () => {
    const r = await runTool([echo], { id: "c1", name: "echo", args: { text: "hi" } });
    expect(r).toEqual({ id: "c1", name: "echo", ok: true, detail: "hi" });
  });

  // A hallucinated tool name is the model's most common failure. It must come back as a normal
  // result the model can read and correct, not as a thrown error that kills the whole loop.
  it("reports an unknown tool as a failed result rather than throwing", async () => {
    const r = await runTool([echo], { id: "c2", name: "nope", args: {} });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unknown tool "nope"/i);
    expect(r.detail).toMatch(/echo/); // it is told what it CAN call
  });

  it("reports a throwing tool as a failed result, keeping the loop alive", async () => {
    const boom: AgentTool = { ...echo, name: "boom", run: async () => { throw new Error("kaboom"); } };
    const r = await runTool([boom], { id: "c3", name: "boom", args: {} });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("kaboom");
  });
});
