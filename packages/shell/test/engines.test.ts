// The engine list is a plain data table, but two things about it must never drift silently: which
// engine can drive the investigate loop (a multi-step tool-calling agent — only a ChatEngine that
// carries tool calls qualifies), and the small pile of derived helpers every caller trusts instead
// of re-deriving the answer themselves.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGINE_CONFIG,
  ENGINES,
  canInvestigate,
  engineLabel,
  engineReady,
  isCloud,
  keyFor,
  type EngineConfig,
} from "../src/engines.js";

describe("canInvestigate", () => {
  it("is true for exactly the chat engines — Potyro's free one, openrouter and an OpenAI-compatible endpoint", () => {
    const investigators = ENGINES.filter((e) => e.canInvestigate).map((e) => e.id);
    expect(investigators).toEqual(["potyro", "openrouter", "endpoint"]);
  });

  it("agrees with the data in ENGINES for every engine, so the helper never drifts from the table", () => {
    for (const e of ENGINES) {
      expect(canInvestigate(e.id)).toBe(e.canInvestigate);
    }
  });

  it("falls back to false for an id not present in ENGINES", () => {
    // Defensive: a bad id (e.g. a stale persisted config) must not be treated as capable.
    expect(canInvestigate("not-a-real-engine" as never)).toBe(false);
  });
});

describe("engineLabel", () => {
  const cfg = (patch: Partial<EngineConfig>): EngineConfig => ({ ...DEFAULT_ENGINE_CONFIG, ...patch });

  it("names the plain engines by their label alone", () => {
    expect(engineLabel(cfg({ engine: "cli" }))).toBe("claude -p");
    expect(engineLabel(cfg({ engine: "builtin" }))).toBe("Chrome built-in");
    expect(engineLabel(cfg({ engine: "anthropic" }))).toBe("Anthropic");
  });

  it("appends the chosen model for openrouter and edge", () => {
    expect(engineLabel(cfg({ engine: "openrouter" }))).toContain("OpenRouter ·");
    expect(engineLabel(cfg({ engine: "edge" }))).toContain("On-device ·");
  });
});

describe("engineReady", () => {
  it("is always ready for on-device/local engines — no key needed", () => {
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "cli" })).toBe(true);
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "edge" })).toBe(true);
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "builtin" })).toBe(true);
  });

  it("gates cloud engines on their key", () => {
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "" })).toBe(false);
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "sk-ant-x" })).toBe(true);
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "" })).toBe(false);
    expect(engineReady({ ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "sk-or-x" })).toBe(true);
  });
});

describe("isCloud / keyFor", () => {
  it("treats anthropic and openrouter as cloud, everything else as local", () => {
    expect(isCloud("anthropic")).toBe(true);
    expect(isCloud("openrouter")).toBe(true);
    expect(isCloud("cli")).toBe(false);
    expect(isCloud("edge")).toBe(false);
    expect(isCloud("builtin")).toBe(false);
  });

  it("returns the current engine's own key, and an empty string for local engines", () => {
    expect(keyFor({ ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "a" })).toBe("a");
    expect(keyFor({ ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "b" })).toBe("b");
    expect(keyFor({ ...DEFAULT_ENGINE_CONFIG, engine: "cli", anthropicKey: "a", openrouterKey: "b" })).toBe("");
  });
});
