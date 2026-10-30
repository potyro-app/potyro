// The `openai` dialect (#121): one engine for any server that speaks the OpenAI chat API — OpenAI,
// Ollama, LM Studio. OpenAI answers an unknown field with a 400, so what must hold is that none of
// OpenRouter's own fields go out, while tools and tool calls still make the round trip the loops
// depend on.

import { describe, expect, it } from "vitest";
import { createOpenRouterBackend, createOpenRouterEngine, type FetchLike } from "../src/index.js";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(...replies: Array<{ status?: number; body: unknown }>): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, sent };
}

const TOOLS = [
  { type: "function" as const, function: { name: "check", description: "Check the app.", parameters: { type: "object", properties: {} } } },
];

describe("the openai dialect", () => {
  it("sends none of OpenRouter's own fields or headers, and no max_tokens unless one is set", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const engine = createOpenRouterEngine({ dialect: "openai", baseUrl: "http://localhost:11434/v1/", apiKey: "sk-x", model: "qwen3", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], temperature: 0.2, reasoning: "high" });

    expect(sent[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(sent[0]!.body).toEqual({ model: "qwen3", messages: [{ role: "user", content: "hi" }], temperature: 0.2 });
    expect(sent[0]!.headers).toEqual({ Authorization: "Bearer sk-x", "Content-Type": "application/json" });
  });

  it("the openrouter dialect still sends them — the default is unchanged", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const engine = createOpenRouterEngine({ apiKey: "sk-or", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect(sent[0]!.body).toHaveProperty("provider");
    expect(sent[0]!.body).toHaveProperty("reasoning");
    expect(sent[0]!.body).toHaveProperty("max_tokens");
    expect(sent[0]!.headers).toHaveProperty("X-Title");
  });

  it("sends a max_tokens that was configured", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const engine = createOpenRouterEngine({ dialect: "openai", model: "m", maxTokens: 4000, fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect(sent[0]!.body.max_tokens).toBe(4000);
  });

  it("sends no Authorization header when there is no key, as a local server wants", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const engine = createOpenRouterEngine({ dialect: "openai", model: "m", fetch, env: { OPENROUTER_API_KEY: "sk-or-leak" } });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    // The OpenRouter key in the environment is never sent to another server.
    expect(sent[0]!.headers).not.toHaveProperty("Authorization");
  });

  it("reads a key given as a function on every request, so a refreshed token is used", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    let n = 0;
    const engine = createOpenRouterEngine({ dialect: "openai", model: "m", fetch, apiKey: async () => `tok-${++n}` });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "a" }] });
    await engine.chat.completions.create({ messages: [{ role: "user", content: "b" }] });

    expect(sent.map((s) => s.headers.Authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("carries tools out and tool calls back, and drops server tools no other server has", async () => {
    const call = { id: "c1", type: "function", function: { name: "check", arguments: "{}" } };
    const { fetch, sent } = fakeFetch(
      { body: { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [call] } }] } },
      { body: { choices: [{ message: { content: "done" } }] } },
    );
    const engine = createOpenRouterEngine({ dialect: "openai", model: "m", fetch });

    const first = await engine.chat.completions.create({
      messages: [{ role: "user", content: "fix it" }],
      tools: TOOLS,
      serverTools: [{ type: "openrouter:web_search" }],
    });
    expect(sent[0]!.body.tools).toEqual(TOOLS);
    expect(sent[0]!.body.tool_choice).toBe("auto");
    expect(first.choices[0]!.message.tool_calls).toEqual([call]);

    // The transcript goes back with the call and its result, as the loops send it.
    const transcript = [
      { role: "user" as const, content: "fix it" },
      { role: "assistant" as const, content: "", tool_calls: first.choices[0]!.message.tool_calls! },
      { role: "tool" as const, content: "no problems", tool_call_id: "c1" },
    ];
    const second = await engine.chat.completions.create({ messages: transcript, tools: TOOLS });
    expect(sent[1]!.body.messages).toEqual(transcript);
    expect(second.choices[0]!.message.content).toBe("done");
  });

  it("sends no tools field when the only tools are server tools", async () => {
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "ok" } }] } });
    const engine = createOpenRouterEngine({ dialect: "openai", model: "m", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], serverTools: [{ type: "openrouter:web_search" }] });

    expect(sent[0]!.body).not.toHaveProperty("tools");
    expect(sent[0]!.body).not.toHaveProperty("tool_choice");
  });

  it("asks again without a temperature when the model refuses one", async () => {
    const { fetch, sent } = fakeFetch(
      { status: 400, body: { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model." } } },
      { body: { choices: [{ message: { content: "ok" } }] } },
    );
    const engine = createOpenRouterEngine({ dialect: "openai", model: "o-model", fetch });

    const res = await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], temperature: 0.2 });

    expect(res.choices[0]!.message.content).toBe("ok");
    expect(sent[1]!.body).not.toHaveProperty("temperature");
  });

  it("names the endpoint, not OpenRouter, when it fails", async () => {
    const { fetch } = fakeFetch({ status: 404, body: { error: { message: "model 'nope' not found" } } });
    const engine = createOpenRouterEngine({ dialect: "openai", model: "nope", fetch });

    await expect(engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      "The endpoint 404: model 'nope' not found",
    );
  });

  it("a backend needs a model, not a key, and sends no max_tokens of its own", async () => {
    await expect(createOpenRouterBackend({ dialect: "openai" })).rejects.toThrow(/model/);
    const { fetch, sent } = fakeFetch({ body: { choices: [{ message: { content: "```ts\nexport default 1;\n```" } }] } });
    const backend = await createOpenRouterBackend({ dialect: "openai", model: "llama3", fetch });

    await backend.generate({ id: "x", description: "a list" });

    expect(backend.name).toBe("openai:llama3");
    expect(sent[0]!.body).not.toHaveProperty("max_tokens");
    expect(sent[0]!.body).not.toHaveProperty("provider");
  });
});
