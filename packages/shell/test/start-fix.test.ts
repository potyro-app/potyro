import { describe, expect, it, vi, beforeEach } from "vitest";
import { addStep, newCase, type Case } from "@potyro/runtime";
import { startFix } from "../src/start-fix.js";
import { DEFAULT_ENGINE_CONFIG } from "../src/engines.js";
import type { InvestigationDeps } from "@potyro/generator/agent";
import type { OpenRouterOptions } from "@potyro/generator/backends";

const aCase = () => addStep(newCase("city-maps", "clicking a city"), { kind: "open", page: "nowhere" });

// FINDING 3: the composition's central claim — that `startFix` wires `runAgentLoop`, `buildAppTools`
// and the OpenRouter engine together correctly — was previously untested; both tests above exercise
// only the refusal short-circuit and never reach any of that wiring. These spies wrap the REAL
// implementations of `buildAppTools` and `runAgentLoop` (rather than replacing them with fakes), so
// the assertions below are against actual computed values — the real `access`/`target` `buildAppTools`
// was called with, the real `task` `runAgentLoop` was called with — not just "was it called". Only
// the network-touching part (`createOpenRouterEngine`'s `ChatEngine`) is faked, since that's the one
// piece that would otherwise make a real HTTP call.
//
// `vi.hoisted` is required because `vi.mock` factories run before this file's own top-level code —
// without it, a plain `const` here would still be `undefined` inside the factory closure.
const mocks = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  createOpenRouterEngine: vi.fn(),
  buildAppTools: vi.fn(),
  runAgentLoop: vi.fn(),
}));

vi.mock("@potyro/generator/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/backends")>();
  return {
    ...actual,
    // Faked: returns a `ChatEngine` whose `create` is the shared `mocks.chatCreate`, so each test
    // controls the model's reply without any network call ever happening.
    createOpenRouterEngine: (opts: OpenRouterOptions) => {
      mocks.createOpenRouterEngine(opts);
      return { chat: { completions: { create: mocks.chatCreate } } };
    },
  };
});

vi.mock("@potyro/generator/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/agent")>();
  // Real implementation underneath — these spies only observe the arguments they were called with;
  // they do not change behavior. That is what lets the "baseline passes -> no-repro, engine never
  // called" test below prove something real: it is `runAgentLoop`'s ACTUAL baseline-first check
  // (loop.ts) short-circuiting, not a stub pretending to.
  mocks.buildAppTools.mockImplementation(actual.buildAppTools);
  mocks.runAgentLoop.mockImplementation(actual.runAgentLoop);
  return { ...actual, buildAppTools: mocks.buildAppTools, runAgentLoop: mocks.runAgentLoop };
});

// FINDING 1: simulate the exact future misconfiguration the fix guards against — `canInvestigate`
// flipped to true for a cloud engine other than OpenRouter (see engines.ts) — WITHOUT actually
// editing engines.ts, whose real `canInvestigate("anthropic") === false` other tests below still
// rely on. Every other export (`isCloud`, `keyFor`, `DEFAULT_ENGINE_CONFIG`, …) stays real.
vi.mock("../src/engines.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engines.js")>();
  return {
    ...actual,
    canInvestigate: (engine: Parameters<typeof actual.canInvestigate>[0]) =>
      engine === "anthropic" ? true : actual.canInvestigate(engine),
  };
});

const runtime = {
  definition: { pages: [{ id: "all", title: "Cities", view: { type: "list", entity: "city" } }] },
  queryPage: async () => ({ rows: [], ctx: {} }),
  ctx: { query: async () => [] },
} as never;

describe("startFix", () => {
  beforeEach(() => {
    mocks.buildAppTools.mockClear();
    mocks.chatCreate.mockReset();
  });

  // The engine picker offers five engines; only one can drive a tool loop. Discovering that at
  // runtime, mid-loop, would be the worst place to find out.
  it("refuses an engine that cannot investigate, before spending anything", async () => {
    const out = await startFix({
      source: "x",
      theCase: aCase(),
      runtime,
      store: null as never,
      engine: { ...DEFAULT_ENGINE_CONFIG, engine: "cli" },
    });

    expect(out.kind).toBe("refused");
    expect((out as { text: string }).text).toMatch(/claude -p|cannot investigate/i);
  });

  it("refuses a cloud engine with no key", async () => {
    const out = await startFix({
      source: "x",
      theCase: aCase(),
      runtime,
      store: null as never,
      engine: { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "" },
    });

    expect(out.kind).toBe("refused");
    expect((out as { text: string }).text).toMatch(/key/i);
  });

  it("refuses when the case has no title and no expectation, before spending anything", async () => {
    const emptyCase = addStep(newCase("city-maps", ""), { kind: "open", page: "all" });
    const cloudEngine = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "test-key" };
    const out = await startFix({
      source: "x",
      theCase: emptyCase,
      runtime,
      store: null as never,
      engine: cloudEngine,
    });

    expect(out.kind).toBe("refused");
    expect((out as { text: string }).text).toMatch(/nothing to investigate|note|expected/i);
    expect(mocks.buildAppTools).not.toHaveBeenCalled();
    expect(mocks.chatCreate).not.toHaveBeenCalled();
  });
});

describe("startFix — wiring (FINDING 3)", () => {
  const cloudEngine = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "test-key" };

  // Opens a page that doesn't exist, so the baseline FAILS — the loop must go on to build tools and
  // call the model. Carries both a title and an `expect` note so `task` is non-empty and finding 2's
  // guard does not intercept it before the wiring under test even runs.
  const buggyCase = (): Case =>
    addStep(
      addStep(newCase("city-maps", "Search stays empty"), { kind: "open", page: "nowhere" }),
      { kind: "expect", note: "it should list the matching cities" },
    );

  // Opens a page that DOES exist (`runtime.definition.pages` has "all"), so the baseline PASSES.
  // Still carries a title and note, so `task` is non-empty and the ONLY reason the model is never
  // reached is `runAgentLoop`'s own no-repro short-circuit — not finding 2's earlier guard.
  const noReproCase = (): Case =>
    addStep(
      addStep(newCase("city-maps", "Nothing seemed wrong"), { kind: "open", page: "all" }),
      { kind: "expect", note: "it should have shown the list" },
    );

  beforeEach(() => {
    mocks.chatCreate.mockReset();
    mocks.createOpenRouterEngine.mockClear();
    mocks.buildAppTools.mockClear();
    mocks.runAgentLoop.mockClear();
    // A reply that ends the loop in exactly one model turn: `NOT-IN-APP:` at the head of the
    // message is `runAgentLoop`'s marker for "diagnosis, not a fix" (loop.ts) — no tool calls, no
    // second turn, so a test doesn't need to script a whole conversation to observe the wiring.
    mocks.chatCreate.mockResolvedValue({
      choices: [{ message: { content: "NOT-IN-APP: this looks like a data problem, not the app." } }],
    });
  });

  it("passes buildAppTools an access of exactly { locality: \"cloud\" }", async () => {
    // Regression this catches: `access: { locality: "local", rawGranted: true } as const` (or any
    // non-cloud variant) would let the model see the user's raw records — every other assertion in
    // this file would still pass, and only this one, reading the REAL argument `buildAppTools` was
    // called with, would fail.
    await startFix({ source: "x", theCase: buggyCase(), runtime, store: null as never, engine: cloudEngine });

    expect(mocks.buildAppTools).toHaveBeenCalledTimes(1);
    const deps = mocks.buildAppTools.mock.calls[0]![0] as InvestigationDeps;
    expect(deps.access).toEqual({ locality: "cloud" });
  });

  it("builds a ReplayTarget with no runAction property", async () => {
    // Regression this catches: wiring a real `runAction` into the target used for investigation
    // would let the loop's tools mutate the user's live store while diagnosing a bug about it (see
    // the SAFETY CRITICAL note on `ReplayTarget.runAction` in packages/runtime/src/replay.ts).
    // Checked with `hasOwnProperty`, not `=== undefined` — `{ runAction: undefined }` would pass a
    // looser check while still being the wrong shape to hand a reviewer proving the omission.
    await startFix({ source: "x", theCase: buggyCase(), runtime, store: null as never, engine: cloudEngine });

    const deps = mocks.buildAppTools.mock.calls[0]![0] as InvestigationDeps;
    expect(Object.prototype.hasOwnProperty.call(deps.target, "runAction")).toBe(false);
  });

  it("composes task as exactly the case title and expectation, nothing else", async () => {
    // Regression this catches: `task: \`Fix this bug: ${task}\`` (or any other prepended text) would
    // still contain the person's words, so a substring match would pass it — only an exact-equals
    // assertion on the REAL `task` `runAgentLoop` was called with catches an added prefix.
    await startFix({ source: "x", theCase: buggyCase(), runtime, store: null as never, engine: cloudEngine });

    expect(mocks.runAgentLoop).toHaveBeenCalledTimes(1);
    const deps = mocks.runAgentLoop.mock.calls[0]![0] as { task: string };
    expect(deps.task).toBe("Search stays empty\n\nit should list the matching cities");
  });

  it("shows the model the app source it was handed, in the very first request", async () => {
    // Regression this catches: `source` reaching `runAgentLoop` as "" (or as some other app's
    // source) — the loop would still run, still call the model, and every other assertion in this
    // file would still pass, while the agent diagnosed a bug with no app in front of it. Read from
    // the REAL request body the engine was called with, and with a marker no other fixture carries,
    // so a `toContain` cannot be satisfied by coincidence (`source: "x"` elsewhere would be).
    const APP = [
      'import { defineApp } from "potyro";',
      "// marker-4f21c8: only this test's source contains this line",
      'export default defineApp({ id: "city-maps", name: "City maps", version: "1.0.0", schemaVersion: 1 });',
    ].join("\n");

    await startFix({ source: APP, theCase: buggyCase(), runtime, store: null as never, engine: cloudEngine });

    expect(mocks.chatCreate).toHaveBeenCalled();
    const body = mocks.chatCreate.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    // messages[0] is the system prompt; messages[1] is the opening user turn — the task plus the app.
    expect(body.messages[1]!.role).toBe("user");
    expect(body.messages[1]!.content).toContain(APP);
  });

  // This used to assert the opposite — that a passing baseline refused to start and spent no model
  // call. That behaviour shipped and a person hit it in ten minutes: replay sees navigation and
  // data, never what RENDERED, so a page stuck on "Loading…" forever replays clean and the tool
  // insisted it could not reproduce a bug the person was staring at. It investigates now; what it
  // must never do is call the result proven.
  it("investigates a passing baseline instead of refusing, and does not call it a fix", async () => {
    const out = await startFix({ source: "x", theCase: noReproCase(), runtime, store: null as never, engine: cloudEngine });

    expect(mocks.chatCreate).toHaveBeenCalled(); // it actually ran
    expect(out.kind).not.toBe("no-repro");
    expect(out.kind).not.toBe("fix"); // a green baseline cannot prove a fix
  });
});

describe("startFix — engine/client mismatch (FINDING 1)", () => {
  const buggyCase = (): Case =>
    addStep(
      addStep(newCase("city-maps", "Search stays empty"), { kind: "open", page: "nowhere" }),
      { kind: "expect", note: "it should list the matching cities" },
    );

  beforeEach(() => {
    mocks.chatCreate.mockReset();
    mocks.createOpenRouterEngine.mockClear();
  });

  // With `../src/engines.js` mocked above, `canInvestigate("anthropic")` now reports true — the
  // exact future edit the finding warns about — while `EngineConfig.openrouterKey` is still "".
  // Before the fix, this reached `createOpenRouterEngine({ apiKey: "", ... })`, which sends
  // `Authorization: Bearer ` (OpenRouter's own `?? ""` fallback does not catch an empty string).
  it("refuses as a diagnosis instead of building an OpenRouter client for a non-OpenRouter engine", async () => {
    const out = await startFix({
      source: "x",
      theCase: buggyCase(),
      runtime,
      store: null as never,
      // `keyFor` is real: for "anthropic" it returns `anthropicKey`, so `refusal()`'s key check
      // passes too — nothing upstream of the new guard stops this without the fix.
      engine: { ...DEFAULT_ENGINE_CONFIG, engine: "anthropic", anthropicKey: "sk-real-anthropic-key" },
    });

    expect(out.kind).toBe("refused");
    expect((out as { text: string }).text).toMatch(/anthropic/i);
    expect((out as { text: string }).text).toMatch(/no client|not wired/i);
    // The never-throw guarantee this finding is about: no attempt was made to build the (wrong)
    // client at all, so there was never an empty-bearer-token request to fail on.
    expect(mocks.createOpenRouterEngine).not.toHaveBeenCalled();
    expect(mocks.chatCreate).not.toHaveBeenCalled();
  });
});

// #73: a fix resumed after a question must be about the app the agent was shown.
describe("startFix — resuming after the app changed", () => {
  const engine = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "test-key" };
  const transcript = (source: string) => [
    { role: "system" as const, content: "system" },
    { role: "user" as const, content: `Search stays empty\n\nThe app as it is:\n\`\`\`ts\n${source}\n\`\`\`` },
    { role: "assistant" as const, content: "Which city did you type?" },
    { role: "user" as const, content: "Lisbon" },
  ];

  it("reads the source the opening turn showed", async () => {
    const { sourceShownIn } = await import("../src/start-fix.js");
    expect(sourceShownIn(transcript("const a = 1;\n```inner```\nconst b = 2;"))).toBe("const a = 1;\n```inner```\nconst b = 2;");
    expect(sourceShownIn([{ role: "user", content: "no app here" }])).toBeNull();
  });

  it("refuses, before spending anything, when the saved app is no longer the one shown", async () => {
    mocks.chatCreate.mockClear();
    const outcome = await startFix({ source: "export default NEW", theCase: aCase(), runtime, store: {} as never, engine, resumeFrom: transcript("export default OLD") as never });
    expect(outcome.kind).toBe("refused");
    expect((outcome as { text: string }).text).toMatch(/changed after the question/);
    expect(mocks.chatCreate).not.toHaveBeenCalled();
  });

  it("resumes when the app is the one the agent was shown", async () => {
    mocks.chatCreate.mockReset();
    mocks.chatCreate.mockResolvedValue({ choices: [{ message: { content: "NOT-IN-APP: a data problem." } }] });
    const outcome = await startFix({ source: "export default SAME", theCase: aCase(), runtime, store: {} as never, engine, resumeFrom: transcript("export default SAME") as never });
    expect(outcome.kind).not.toBe("refused");
    expect(mocks.chatCreate).toHaveBeenCalled();
  });
});
