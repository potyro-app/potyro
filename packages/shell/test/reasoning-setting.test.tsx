// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// #280: how hard the model thinks is a setting in Model settings, per engine, default off, and it
// reaches every Studio call — create, modify, repair, Ask (and Fix, which reads the same setting).
// The loop's escalation (think hard for the one turn after it got stuck) is its own toggle, on by
// default, so the two can be measured apart.

const engineOpts: Array<Record<string, unknown>> = [];
const backendOpts: Array<Record<string, unknown>> = [];
vi.mock("@potyro/generator/backends", async (orig) => ({
  ...(await orig<object>()),
  createOpenRouterEngine: (o: Record<string, unknown>) => (engineOpts.push(o), { chat: { completions: { create: async () => ({ choices: [{ message: { content: "" } }] }) } } }),
  createOpenRouterBackend: async (o: Record<string, unknown>) => (backendOpts.push(o), { name: "or", generate: async () => "", modify: async () => "" }),
}));
const loopDeps: Array<Record<string, unknown>> = [];
vi.mock("@potyro/generator/agent", async (orig) => ({
  ...(await orig<object>()),
  runModifyLoop: async (d: Record<string, unknown>) => (loopDeps.push(d), { kind: "failed", reason: "x", cause: "steps" }),
  runAskLoop: async (d: Record<string, unknown>) => (loopDeps.push(d), { kind: "failed", reason: "x" }),
}));

const { DEFAULT_ENGINE_CONFIG, ENGINES, engineLabel, thinkingFor, withThinking } = await import("../src/engines.js");
const { EngineSettings } = await import("../src/engine-settings.js");
const { startModify } = await import("../src/start-modify.js");
const { startAsk } = await import("../src/start-ask.js");
const { backendFor } = await import("../src/model-turn.js");

const openrouter = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "sk-or" };

afterEach(() => {
  cleanup();
  engineOpts.length = 0;
  backendOpts.length = 0;
  loopDeps.length = 0;
});

describe("the setting", () => {
  it("is off by default, and so is the escalation (measured: no gain for 12% more, #293)", () => {
    expect(thinkingFor(openrouter)).toEqual({ level: "off", escalate: false });
  });

  it("is kept per engine", () => {
    const cfg = withThinking(openrouter, { level: "high" });
    expect(thinkingFor(cfg)).toEqual({ level: "high", escalate: false });
    expect(thinkingFor({ ...cfg, engine: "anthropic" })).toEqual({ level: "off", escalate: false });
    // A config saved by an older build has no `thinking` at all.
    const { thinking: _gone, ...old } = cfg;
    expect(thinkingFor(old as typeof cfg)).toEqual({ level: "off", escalate: false });
  });

  it("only engines that can think are offered it", () => {
    expect(ENGINES.filter((e) => e.canThink).map((e) => e.id)).toEqual(["openrouter"]);
  });

  it("shows on the engine's name when it is on", () => {
    expect(engineLabel(openrouter)).not.toMatch(/think/i);
    expect(engineLabel(withThinking(openrouter, { level: "high" }))).toMatch(/thinks hard/);
  });
});

describe("it reaches every Studio call", () => {
  const high = withThinking(openrouter, { level: "high" });
  const expectHigh = (o: Record<string, unknown> | undefined) => {
    expect(o).toMatchObject({ reasoning: { effort: "high" }, maxTokens: 64_000 });
  };

  it("modify: the loop's engine, and the escalation toggle", async () => {
    await startModify({ source: "S", instruction: "x", before: { entities: {}, pages: [] }, engine: high });
    expectHigh(engineOpts[0]);
    expect(loopDeps[0]).toMatchObject({ escalate: false });
    await startModify({ source: "S", instruction: "x", before: { entities: {}, pages: [] }, engine: withThinking(high, { escalate: true }) });
    expect(loopDeps[1]).toMatchObject({ escalate: true });
  });

  it("Ask", async () => {
    await startAsk({ engine: high, definition: { entities: {}, pages: [] } as never, request: "x" } as never);
    expectHigh(engineOpts[0]);
  });

  it("create and repair: the one-turn backend", async () => {
    await backendFor(high);
    expectHigh(backendOpts[0]);
  });

  it("off sends today's request: reasoning none, the usual budget", async () => {
    await backendFor(openrouter);
    expect(backendOpts[0]).toMatchObject({ reasoning: { effort: "none" }, maxTokens: 32_000 });
  });
});

describe("Model settings", () => {
  it("offers the four levels in plain words, says what they cost, and changes the setting", () => {
    const onChange = vi.fn();
    render(<EngineSettings config={openrouter} onChange={onChange} onClose={() => {}} hasWebGPU={false} hasBuiltIn={false} />);
    const group = screen.getByRole("radiogroup", { name: /how hard it thinks/i });
    for (const name of [/^off/i, /^low/i, /^medium/i, /^high/i]) expect(within(group).getByRole("radio", { name })).toBeTruthy();
    expect(group.textContent).toMatch(/cost/i);
    fireEvent.click(within(group).getByRole("radio", { name: /^high/i }));
    expect(thinkingFor(onChange.mock.calls.at(-1)![0])).toEqual({ level: "high", escalate: false });
  });

  it("has the escalation as its own switch, off by default", () => {
    const onChange = vi.fn();
    render(<EngineSettings config={openrouter} onChange={onChange} onClose={() => {}} hasWebGPU={false} hasBuiltIn={false} />);
    const box = screen.getByRole("checkbox", { name: /stuck/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(thinkingFor(onChange.mock.calls.at(-1)![0])).toEqual({ level: "off", escalate: true });
  });

  it("is not shown for an engine that cannot think", () => {
    render(<EngineSettings config={{ ...openrouter, engine: "anthropic" }} onChange={() => {}} onClose={() => {}} hasWebGPU={false} hasBuiltIn={false} />);
    expect(screen.queryByRole("radiogroup", { name: /how hard it thinks/i })).toBeNull();
  });
});
