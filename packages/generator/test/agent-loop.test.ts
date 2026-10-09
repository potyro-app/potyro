import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type LoopDeps, type LoopStep } from "../src/agent/loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatMessage, ChatRequest, ChatResponse } from "../src/chat-backend.js";

const APP = 'import { defineApp } from "potyro";\nexport default defineApp({ id: "x" });';

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
  source: APP,
  verify: async () => ({ passed: true, detail: "replay passed" }),
  // Failing by default so every existing test below is still allowed to start the loop. Only the
  // dedicated no-repro test overrides this to `passed: true`.
  baseline: { passed: false, detail: 'replay FAILED before any fix: no page "city-detail"' },
  ...over,
});

describe("runAgentLoop", () => {
  // A PASSING BASELINE USED TO REFUSE TO START, returning `no-repro`. That was wrong, and a person
  // found it in ten minutes: replay checks that a page resolved and its query ran, and knows
  // NOTHING about what rendered. A map stuck on "Loading…" forever replays perfectly clean — so the
  // gate fired hardest on exactly the bugs most likely to be reported and least visible to replay,
  // and told the person their app was fine while they were looking at it broken.
  //
  // So it investigates. What it must not do is call the result proven: with a green baseline, a
  // passing verify is guaranteed and means nothing, so the candidate comes back honestly labelled.
  it("investigates a passing baseline anyway, but will not call the result a fix", async () => {
    const { engine, seen } = scripted([{ content: "Added a loading guard.\n```ts\n" + APP + "\n```" }]);

    const out = await runAgentLoop(
      base({ engine, baseline: { passed: true, detail: 'opened "city-map" — 1 records' } }),
    );

    // It ran — the whole complaint was that nothing happened.
    expect(seen).toHaveLength(1);
    expect(out.kind).toBe("unverified-fix");
    const proposal = out as { source: string; rationale: string; why: string };
    expect(proposal.source).toContain("defineApp");
    expect(proposal.rationale).toContain("loading guard");
    // And it says WHY it could not be proven, in terms of what replay can actually see.
    expect(proposal.why).toMatch(/rendered/i);
    expect(proposal.why).toContain('opened "city-map" — 1 records');
  });

  // THE RULE is untouched: a real `fix` still requires a baseline that FAILED and a verify that
  // passed. Only that combination is evidence of anything.
  it("still returns a plain fix when the baseline failed and the candidate passed", async () => {
    const { engine } = scripted([{ content: "```ts\n" + APP + "\n```" }]);
    const out = await runAgentLoop(base({ engine }));
    expect(out.kind).toBe("fix");
  });

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
    // The assistant turn that REQUESTED the call must precede its result — a provider rejects a
    // transcript where a `tool` message has no preceding assistant turn carrying its id.
    const i = seen[1]!.messages.findIndex((m) => m.role === "tool");
    expect(seen[1]!.messages[i - 1]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1" }] });
  });

  it("pairs multiple tool calls from one turn with their results, in order", async () => {
    const twoToolsTurn = {
      content: "",
      tool_calls: [
        { id: "a1", type: "function" as const, function: { name: "replay_case", arguments: "{}" } },
        { id: "a2", type: "function" as const, function: { name: "replay_case", arguments: "{}" } },
      ],
    };
    const { engine, seen } = scripted([twoToolsTurn, { content: "```ts\n" + APP + "\n```" }]);

    await runAgentLoop(base({ engine }));

    const msgs = seen[1]!.messages;
    const assistantIdx = msgs.findIndex((m) => m.role === "assistant" && m.tool_calls);
    expect(msgs[assistantIdx]).toMatchObject({ role: "assistant", tool_calls: [{ id: "a1" }, { id: "a2" }] });
    const toolMsgs = msgs.filter((m) => m.role === "tool");
    // Both results, in the order the calls were made, and both after the turn that requested them.
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["a1", "a2"]);
    expect(msgs.indexOf(toolMsgs[0]!)).toBeGreaterThan(assistantIdx);
    expect(msgs.indexOf(toolMsgs[1]!)).toBeGreaterThan(assistantIdx);
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
    // `toMatchObject` rather than `toEqual`: the outcome also carries a `transcript`, exercised by
    // the resume tests below — this test only cares about `kind` and `text`.
    expect(out).toMatchObject({ kind: "question", text: "which city did you tap?" });
  });

  // Today a question returns and the transcript is discarded — the person answers, the loop
  // restarts from scratch, and the agent has no memory of why it asked. `transcript` on the
  // `question` outcome plus `resumeFrom` on `LoopDeps` close that gap.
  it("carries its transcript out with a question, and resumes from it", async () => {
    const first = scripted([{ content: "ASK: which city did you tap?" }]);
    const out = await runAgentLoop(base({ engine: first.engine }));

    expect(out.kind).toBe("question");
    const transcript = (out as { transcript: ChatMessage[] }).transcript;
    // Everything it had established before asking must survive.
    expect(transcript.some((m) => m.role === "system")).toBe(true);
    expect(transcript.some((m) => m.content.includes("clicking a city"))).toBe(true);

    // Resuming appends the answer to that transcript rather than starting over.
    const second = scripted([{ content: "```ts\n" + APP + "\n```" }]);
    const resumed = await runAgentLoop(
      base({ engine: second.engine, resumeFrom: [...transcript, { role: "user", content: "Lisbon" }] }),
    );

    expect(resumed.kind).toBe("fix");
    const sent = second.seen[0]!.messages;
    expect(sent.some((m) => m.content === "Lisbon")).toBe(true);
    expect(sent.some((m) => m.content.includes("which city did you tap?"))).toBe(true);
  });

  // THE RULE, again, on the path this task adds: resuming from a prior transcript must not become
  // a back door around `verify`. A resumed loop that gets a candidate which fails replay must not
  // return `fix` — it has to behave exactly like a fresh loop that failed the same way.
  it("still cannot return fix on a resumed loop without a passing verify", async () => {
    const { engine } = scripted([
      { content: "```ts\n" + APP + "\n```" },
      { content: "NOT-IN-APP: the host map view ignores the pin" },
    ]);
    const verify = vi.fn(async () => ({ passed: false, detail: 'still FAILED: no page "city-detail"' }));
    const resumeFrom: ChatMessage[] = [
      { role: "system", content: "contract" },
      { role: "user", content: "clicking a city does nothing" },
      { role: "assistant", content: "ASK: which city did you tap?" },
      { role: "user", content: "Lisbon" },
    ];

    const out = await runAgentLoop(base({ engine, verify, resumeFrom }));

    expect(verify).toHaveBeenCalledTimes(1);
    expect(out.kind).not.toBe("fix");
    expect(out.kind).toBe("diagnosis"); // it moved on, same as a fresh loop would after a rejected candidate
  });

  // A marker only counts when it opens the reply. A `NOT-IN-APP:`-prefixed line buried in an
  // explanation must not throw away a genuine, working candidate that follows it.
  it("treats a NOT-IN-APP line mid-reply as prose, not a diagnosis, when a real app follows", async () => {
    const reply =
      "Something else looked suspicious at first.\n" +
      "NOT-IN-APP: the host map view seemed to ignore the pin, but the app itself was the bug:\n" +
      "```ts\n" +
      APP +
      "\n```";
    const { engine } = scripted([{ content: reply }]);
    const verify = vi.fn(async () => ({ passed: true, detail: "replay passed" }));

    const out = await runAgentLoop(base({ engine, verify }));

    expect(verify).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe("fix");
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

  // Honest reporting is the whole point of this loop; "gave up" alone hides WHICH of three very
  // different failures happened. A watcher must be able to tell them apart.
  it("breaks down why it gave up: candidates that failed replay vs replies that were not an app", async () => {
    const notAppTurn = { content: "I dunno, seems fine to me." };
    const candidateTurn = { content: "```ts\n" + APP + "\n```" };
    const { engine } = scripted([notAppTurn, notAppTurn, candidateTurn]);
    const verify = vi.fn(async () => ({ passed: false, detail: "still broken" }));
    const steps: LoopStep[] = [];

    const out = await runAgentLoop(base({ engine, verify, maxSteps: 3, onStep: (s) => steps.push(s) }));

    expect(out.kind).toBe("exhausted");
    const reason = (out as { reason: string }).reason;
    expect(reason).toMatch(/3 steps/);
    expect(reason).toContain("1 candidate");
    expect(reason).toContain("2 replies");
    // A person watching `onStep` sees the unusable replies flagged as such, not just "thinking".
    expect(steps.filter((s) => s.kind === "unusable")).toHaveLength(2);
  });

  // A no-match edit is a distinct failure from "not an app at all" — the model DID try to change
  // the app, it just could not point at real lines — so the exhausted reason must say so separately.
  it("counts edits that did not match separately in the exhausted reason", async () => {
    const miss = "```ts\n<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE\n```";
    const { engine } = scripted([{ content: miss }]);

    const out = await runAgentLoop(base({ engine, maxSteps: 1 }));

    expect(out.kind).toBe("exhausted");
    expect((out as { reason: string }).reason).toContain("had edits that did not match");
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

  // THE MISSING INPUT. The agent was asked for "the complete updated .app.ts" of an app it had
  // never been shown: the task carried the case, the tools returned pages and counts, and the
  // candidate came from imagination. With edits that is impossible, so the app is in the opening turn.
  it("shows the model the app it is fixing, in the opening user turn", async () => {
    const { engine, seen } = scripted([{ content: "```ts\n" + APP + "\n```" }]);
    await runAgentLoop(base({ engine }));
    expect(seen[0]!.messages[1]!.content).toContain(APP);
    expect(seen[0]!.messages[1]!.content).toContain("clicking a city does nothing");
  });

  it("applies an edit-block candidate to the app and verifies the result", async () => {
    const edit = "Guarding the click.\n```ts\n<<<<<<< SEARCH\nexport default defineApp({ id: \"x\" });\n=======\nexport default defineApp({ id: \"y\" });\n>>>>>>> REPLACE\n```";
    const { engine } = scripted([{ content: edit }]);
    const verify = vi.fn(async () => ({ passed: true, detail: "replay passed" }));
    const out = await runAgentLoop(base({ engine, verify }));
    expect(verify).toHaveBeenCalledWith('import { defineApp } from "potyro";\nexport default defineApp({ id: "y" });');
    expect(out).toMatchObject({ kind: "fix", rationale: "Guarding the click." });
  });

  it("tells the model which edit did not match and continues", async () => {
    const miss = "```ts\n<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE\n```";
    const { engine, seen } = scripted([{ content: miss }, { content: "```ts\n" + APP + "\n```" }]);
    const steps: LoopStep[] = [];
    const out = await runAgentLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out.kind).toBe("fix");
    const feedback = seen[1]!.messages.at(-1)!.content;
    expect(feedback).toMatch(/edit 1.*not found/i);
    expect(steps.some((s) => s.kind === "unusable")).toBe(true);
  });
});
