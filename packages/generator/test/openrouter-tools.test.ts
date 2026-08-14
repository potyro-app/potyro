import { describe, expect, it } from "vitest";
import { createOpenRouterEngine, type FetchLike } from "../src/index.js";

function fakeFetch(body: unknown): { fetch: FetchLike; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const fetch: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(String((init ?? {}).body)) as Record<string, unknown>);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, sent };
}

const TOOLS = [
  {
    type: "function" as const,
    function: { name: "replay_case", description: "Replay the recording.", parameters: { type: "object", properties: {} } },
  },
];

describe("OpenRouter tool calling", () => {
  it("forwards tools and tool_choice on the request", async () => {
    const { fetch, sent } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], tools: TOOLS, tool_choice: "auto" });

    expect(sent[0]!.tools).toEqual(TOOLS);
    expect(sent[0]!.tool_choice).toBe("auto");
  });

  it("omits tools entirely when none are given, so ordinary generation is unchanged", async () => {
    const { fetch, sent } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect(sent[0]!).not.toHaveProperty("tools");
    expect(sent[0]!).not.toHaveProperty("tool_choice");
  });

  // A tool call arrives with EMPTY content. The existing adapter throws "no completion" on empty
  // content — that check must not fire when the model answered with a tool call instead of prose.
  it("returns a tool call even though its content is empty", async () => {
    const { fetch } = fakeFetch({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "replay_case", arguments: '{"caseId":"c1"}' } }],
          },
        },
      ],
    });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    const res = await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], tools: TOOLS });

    expect(res.choices[0]!.message.tool_calls?.[0]?.function.name).toBe("replay_case");
    expect(res.choices[0]!.finish_reason).toBe("tool_calls");
  });

  it("still fails loudly when there is neither content nor a tool call", async () => {
    const { fetch } = fakeFetch({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await expect(
      engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], tools: TOOLS }),
    ).rejects.toThrow(/no completion/i);
  });

  // FINDING 1: tool_choice override is untested.
  // If someone changed line 158 from `tool_choice: req.tool_choice ?? "auto"` to just `tool_choice: req.tool_choice`,
  // hardcoding "none" would be lost and the request would either send undefined or fail.
  it("respects tool_choice: 'none' from the caller", async () => {
    const { fetch, sent } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], tools: TOOLS, tool_choice: "none" });

    expect(sent[0]!.tool_choice).toBe("none");
  });

  // FINDING 2: tool_calls: [] is untested.
  // If someone changed line 192 from `!toolCalls?.length` to `!toolCalls`, an empty array [] would become truthy,
  // the condition would flip to false, and the error would not be thrown when it should be.
  it("rejects with no completion when response has empty tool_calls array and no content", async () => {
    const { fetch } = fakeFetch({
      choices: [{ message: { content: "", tool_calls: [] }, finish_reason: "stop" }],
    });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await expect(
      engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], tools: TOOLS }),
    ).rejects.toThrow(/no completion/i);
  });
});

// FINDING 3: the two tool-spec shapes can drift apart silently.
// ToolSpec from agent/tools.ts and ChatRequest["tools"] from chat-backend.ts are declared independently.
// They are structurally identical today, but if either changes, the compiler will not notice without this check.
import type { ToolSpec } from "../src/agent/tools.js";
import type { ChatRequest } from "../src/chat-backend.js";

type WireTool = NonNullable<ChatRequest["tools"]>[number];
// If either ToolSpec or the wire shape drifts, these will not compile.
const _specIsWire: WireTool = {} as ToolSpec;
const _wireIsSpec: ToolSpec = {} as WireTool;
void _specIsWire;
void _wireIsSpec;
