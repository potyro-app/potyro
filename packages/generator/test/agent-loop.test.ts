import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type LoopDeps } from "../src/agent/loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

const APP = 'import { defineApp } from "karta";\nexport default defineApp({ id: "x" });';

/** Replies in the order given, one per model turn. */
function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: {
      chat: { completions: { create: async (req) => (seen.push(req), { choices: [{ message: turns[i++]! }] }) } },
    },
  };
}

const replayTool = (ok: boolean): AgentTool => ({
  name: "replay_case",
  description: "replay",
  parameters: { type: "object", properties: {} },
  run: async () => ({ ok, detail: ok ? "all steps ok" : 'FAILED: no page "city-detail"' }),
});

const base = (over: Partial<LoopDeps>): LoopDeps => ({
  engine: scripted([]).engine,
  tools: [replayTool(false)],
  system: "contract",
  task: "clicking a city does nothing",
  verify: async () => ({ passed: true, detail: "replay passed" }),
  ...over,
});

describe("runAgentLoop", () => {
  it("feeds a tool result back and lets the model act on it", async () => {
    const { engine, seen } = scripted([
      { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "replay_case", arguments: "{}" } }] },
      { content: "```ts\n" + APP + "\n```" },
    ]);

    const out = await runAgentLoop(base({ engine }));

    expect(out.kind).toBe("fix");
    // The second request carries the tool's result as a `tool` message the model could read.
    const toolMsg = seen[1]!.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain('no page "city-detail"');
    expect(toolMsg?.tool_call_id).toBe("t1");
  });

  // THE RULE. A proposed fix that does not survive replay is not a fix.
  it("refuses to return a fix when verification fails, and tells the model why", async () => {
    const { engine, seen } = scripted([
      { content: "```ts\n" + APP + "\n```" },
      { content: "NOT-IN-APP: the host map view ignores the pin" },
    ]);
    const verify = vi.fn(async () => ({ passed: false, detail: 'still FAILED: no page "city-detail"' }));

    const out = await runAgentLoop(base({ engine, verify }));

    expect(verify).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe("diagnosis"); // it moved on, because the fix was rejected
    // The rejection was fed back, so the second turn knew its patch had failed.
    expect(JSON.stringify(seen[1]!.messages)).toContain("still FAILED");
  });

  it("returns a question instead of guessing", async () => {
    const { engine } = scripted([{ content: "ASK: which city did you tap?" }]);
    const out = await runAgentLoop(base({ engine }));
    expect(out).toEqual({ kind: "question", text: "which city did you tap?" });
  });

  it("stops at the step budget rather than looping forever", async () => {
    const turn = {
      content: "",
      tool_calls: [{ id: "t", type: "function" as const, function: { name: "replay_case", arguments: "{}" } }],
    };
    const { engine } = scripted(Array.from({ length: 10 }, () => turn));

    const out = await runAgentLoop(base({ engine, maxSteps: 3 }));

    expect(out.kind).toBe("exhausted");
    expect((out as { reason: string }).reason).toMatch(/3 steps/);
  });

  it("stops between steps when the signal aborts, and says it was stopped", async () => {
    const controller = new AbortController();
    const turn = {
      content: "",
      tool_calls: [{ id: "t", type: "function" as const, function: { name: "replay_case", arguments: "{}" } }],
    };
    const { engine } = scripted(Array.from({ length: 5 }, () => turn));
    const tools = [
      {
        ...replayTool(false),
        run: async () => (controller.abort(), { ok: false, detail: "failed" }),
      },
    ];

    const out = await runAgentLoop(base({ engine, tools, signal: controller.signal }));

    // "stopped", not "exhausted": the user ended it, the agent did not give up.
    expect(out.kind).toBe("stopped");
  });

  // A stop that lands on the FINAL step — after the last model reply comes back — must still read
  // as "stopped". Only the tool-call shape was covered before; a fix that fails replay, or a final
  // reply that isn't an app, fell through to "exhausted" with no abort check on the way out.
  it("reports a late stop as stopped, not exhausted, when the final candidate fails verify", async () => {
    const controller = new AbortController();
    const { engine } = scripted([{ content: "```ts\n" + APP + "\n```" }]);
    const verify = vi.fn(async () => {
      controller.abort(); // simulates the user pressing stop while verify (the last thing) ran
      return { passed: false, detail: "still broken" };
    });

    const out = await runAgentLoop(base({ engine, verify, maxSteps: 1, signal: controller.signal }));

    expect(out.kind).toBe("stopped");
  });

  it("reports a late stop as stopped, not exhausted, when the final reply is not an app", async () => {
    const controller = new AbortController();
    const engine: ChatEngine = {
      chat: {
        completions: {
          create: async () => {
            controller.abort(); // simulates the user pressing stop while this (final) reply was in flight
            return { choices: [{ message: { content: "not an app at all" } }] };
          },
        },
      },
    };

    const out = await runAgentLoop(base({ engine, maxSteps: 1, signal: controller.signal }));

    expect(out.kind).toBe("stopped");
  });

  it("reports every step so a person can watch and stop it", async () => {
    const { engine } = scripted([
      { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "replay_case", arguments: "{}" } }] },
      { content: "```ts\n" + APP + "\n```" },
    ]);
    const steps: string[] = [];

    await runAgentLoop(base({ engine, onStep: (s) => steps.push(s.kind === "tool" ? `tool:${s.name}` : s.kind) }));

    expect(steps).toContain("tool:replay_case");
  });
});
