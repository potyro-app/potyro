import { describe, expect, it } from "vitest";
import {
  OPENROUTER_MODELS,
  OpenRouterBackend,
  SYSTEM_PROMPT,
  createOpenRouterBackend,
  createOpenRouterEngine,
  runEval,
  type ChatEngine,
  type ChatRequest,
  type FetchLike,
} from "../src/index.js";

// Drives the OpenRouter backend with an injected engine (message assembly) and an injected fetch
// (the HTTP adapter) — no API key, no network, deterministic.

const GOOD = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});`;

function fakeEngine(reply: (r: ChatRequest) => string): { engine: ChatEngine; reqs: ChatRequest[] } {
  const reqs: ChatRequest[] = [];
  const engine: ChatEngine = {
    chat: { completions: { create: async (r) => (reqs.push(r), { choices: [{ message: { content: reply(r) } }] }) } },
  };
  return { engine, reqs };
}

/** A fetch stand-in that records the call and returns a canned HTTP reply. */
function fakeFetch(
  reply: { status?: number; body: unknown },
): { fetch: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const chatReply = (text: string) => ({ choices: [{ message: { role: "assistant", content: text } }] });

describe("OpenRouterBackend prompt assembly", () => {
  it("generate sends the contract as a system message + the description, and strips fences", async () => {
    const { engine, reqs } = fakeEngine(() => "```ts\n" + GOOD + "\n```");
    const backend = new OpenRouterBackend(engine, "deepseek/deepseek-v4-flash-0731");

    const src = await backend.generate({ id: "t", description: "a simple todo list" });

    expect(src).toBe(GOOD);
    expect(reqs[0]!.messages[0]).toMatchObject({ role: "system", content: SYSTEM_PROMPT });
    expect(reqs[0]!.messages[1]!.content).toContain("a simple todo list");
    expect(reqs[0]!.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(backend.name).toBe("openrouter:deepseek/deepseek-v4-flash-0731+reasoning=none");
  });

  it("repair feeds back the prior source and the errors", async () => {
    const { engine, reqs } = fakeEngine(() => "```ts\n" + GOOD + "\n```");
    const backend = new OpenRouterBackend(engine);

    await backend.repair("BROKEN SOURCE", ["validate: boom"], { id: "t", description: "x" });

    const msgs = reqs[0]!.messages;
    expect(msgs).toHaveLength(4); // system + ask + prior attempt + errors
    expect(msgs[2]).toMatchObject({ role: "assistant" });
    expect(msgs[2]!.content).toContain("BROKEN SOURCE");
    expect(msgs[3]!.content).toContain("validate: boom");
  });

  // A modify turn that opens with "Create a Karta app for this request: <the edit>" tells the model
  // the app it should have written is described BY the edit — so the source in the next turn reads
  // as a wrong answer. Strong models reconcile it; a fast one obeys and replaces the whole app,
  // which is exactly the "it deletes my app and writes a new one" report.
  it("never frames the edit as the description of the app to create", async () => {
    const { engine, reqs } = fakeEngine(() => "```ts\n" + GOOD + "\n```");
    const backend = new OpenRouterBackend(engine);

    await backend.modify("CURRENT SOURCE", "add a 5-star rating field", { id: "t", description: "a book tracker" });

    const opener = reqs[0]!.messages[1]!.content;
    expect(opener).not.toContain("Create a Karta app for this request");
    expect(opener).not.toContain("add a 5-star rating field");
    expect(opener).toMatch(/current/i); // it introduces the app as the thing being changed
  });

  it("modify feeds back the current source and the change instruction", async () => {
    const { engine, reqs } = fakeEngine(() => "```ts\n" + GOOD + "\n```");
    const backend = new OpenRouterBackend(engine);

    const src = await backend.modify("CURRENT SOURCE", "add a 5-star rating field", { id: "t", description: "books" });

    // The reply comes back untouched: `guardedModify` reads it (edits, a whole file, or a verdict),
    // so a backend that extracted source here would throw the edits away.
    expect(src).toBe("```ts\n" + GOOD + "\n```");
    const msgs = reqs[0]!.messages;
    expect(msgs[2]!.content).toContain("CURRENT SOURCE"); // the app being adapted
    expect(msgs[3]!.content).toContain("add a 5-star rating field"); // the change, not framed as an error
  });

  it("defaults to a model that is actually served by OpenRouter", () => {
    const name = new OpenRouterBackend(fakeEngine(() => "").engine).name;
    const modelId = name.slice("openrouter:".length).split("+reasoning=")[0];
    expect(OPENROUTER_MODELS.some((m) => m.id === modelId)).toBe(true);
  });
});

describe("createOpenRouterEngine (the HTTP adapter)", () => {
  it("posts an OpenAI-shaped chat completion with the key and returns the content", async () => {
    const { fetch, calls } = fakeFetch({ body: chatReply("```ts\n" + GOOD + "\n```") });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", model: "deepseek/deepseek-v4-flash-0731", fetch });

    const res = await engine.chat.completions.create({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16_000,
    });

    expect(res.choices[0]!.message.content).toContain("defineApp");
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[]; max_tokens: number };
    expect(body.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(body.max_tokens).toBe(16_000);
    expect(body.messages).toHaveLength(1);
  });

  // Every model behind the default is reasoning-capable, and reasoning tokens are drawn from the
  // same max_tokens budget as the answer. Left to think freely, the model spends minutes and can
  // return the budget spent with no code at all.
  it("turns reasoning off and routes for throughput by default", async () => {
    const { fetch, calls } = fakeFetch({ body: chatReply("```ts\n" + GOOD + "\n```") });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      reasoning: unknown;
      provider: unknown;
      max_tokens: number;
    };
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.provider).toEqual({ sort: "throughput" });
    expect(body.max_tokens).toBeGreaterThan(16_000); // headroom once reasoning IS dialled up
  });

  it("lets provider routing be overridden, since it dominates latency", async () => {
    const { fetch, calls } = fakeFetch({ body: chatReply("```ts\n" + GOOD + "\n```") });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch, provider: { sort: "price" } });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect((JSON.parse(String(calls[0]!.init.body)) as { provider: unknown }).provider).toEqual({ sort: "price" });
  });

  it("lets the reasoning effort be dialled per run, so the harness can measure the trade-off", async () => {
    const { fetch, calls } = fakeFetch({ body: chatReply("```ts\n" + GOOD + "\n```") });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch, reasoning: { effort: "none" } });

    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect((JSON.parse(String(calls[0]!.init.body)) as { reasoning: unknown }).reasoning).toEqual({ effort: "none" });
  });

  it("names the reasoning effort in the backend name, so a report says what it measured", () => {
    expect(new OpenRouterBackend(fakeEngine(() => "").engine, "m", { reasoning: { effort: "high" } }).name).toBe(
      "openrouter:m+reasoning=high",
    );
    // A default run has reasoning OFF — the name must say so too, or its report.json cannot be
    // told apart from a run made with some other effort.
    expect(new OpenRouterBackend(fakeEngine(() => "").engine, "m").name).toBe("openrouter:m+reasoning=none");
  });

  it("blames the budget, not the model, when thinking consumed the whole reply", async () => {
    const { fetch } = fakeFetch({ body: { choices: [{ message: { content: "" }, finish_reason: "length" }] } });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await expect(engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /max_tokens|reasoning/i,
    );
  });

  it("reports the status and body when OpenRouter rejects the call", async () => {
    const { fetch } = fakeFetch({ status: 401, body: { error: { message: "No auth credentials found" } } });
    const engine = createOpenRouterEngine({ apiKey: "bad", fetch });

    await expect(engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /401.*No auth credentials found/s,
    );
  });

  it("surfaces an error returned with a 200 (OpenRouter does that for upstream failures)", async () => {
    const { fetch } = fakeFetch({ body: { error: { message: "upstream is down", code: 502 } } });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await expect(engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /upstream is down/,
    );
  });

  // OpenRouter holds the connection open while the upstream works, padding it with SSE comment
  // lines (": OPENROUTER PROCESSING"). They arrive before the JSON and are not JSON — parsing the
  // raw body fails, and the completion that did arrive gets reported as "no completion".
  it("ignores the keep-alive comment padding that precedes a slow completion", async () => {
    const padded =
      ": OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n" +
      JSON.stringify(chatReply("```ts\n" + GOOD + "\n```"));
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => (calls.push(url), new Response(padded, { status: 200 }));
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    const res = await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });

    expect(res.choices[0]!.message.content).toContain("defineApp");
  });

  it("fails loudly rather than returning an empty app when there are no choices", async () => {
    const { fetch } = fakeFetch({ body: { choices: [] } });
    const engine = createOpenRouterEngine({ apiKey: "sk-or-test", fetch });

    await expect(engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /no completion/i,
    );
  });
});

describe("createOpenRouterBackend", () => {
  it("says which env var is missing instead of failing at request time", async () => {
    await expect(createOpenRouterBackend({ apiKey: "", env: {} })).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("reads the key from the environment", async () => {
    const { fetch, calls } = fakeFetch({ body: chatReply("```ts\n" + GOOD + "\n```") });
    const backend = await createOpenRouterBackend({ env: { OPENROUTER_API_KEY: "sk-or-env" }, fetch });

    await backend.generate({ id: "t", description: "a todo list" });

    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-env");
  });
});

describe("OpenRouterBackend drives the KA-06 eval repair loop", () => {
  it("repairs an initially-invalid app into a passing one", async () => {
    // generate() → 2 messages (invalid); repair() → 4 messages (valid).
    const { engine } = fakeEngine((r) => (r.messages.length >= 4 ? "```ts\n" + GOOD + "\n```" : "export default {};"));
    const backend = new OpenRouterBackend(engine);

    const report = await runEval(backend, [{ id: "t", description: "a simple todo list" }], { maxRepairs: 2 });

    expect(report.singlePassValid).toBe(0);
    expect(report.validWithinN).toBe(1);
    expect(report.renders).toBe(1);
    expect(report.outcomes[0]!.repairsUsed).toBe(1);
  });
});

describe("a model that cannot turn reasoning off", () => {
  it("asks again with the model's own default instead of failing", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      if (bodies.length === 1) return new Response('{"error":{"message":"Reasoning is mandatory for this endpoint and cannot be disabled."}}', { status: 400 });
      return new Response('{"choices":[{"message":{"content":"hi"}}]}', { status: 200 });
    };
    const engine = createOpenRouterEngine({ apiKey: "k", fetch: fetch as never });
    const res = await engine.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    expect(res.choices[0]!.message.content).toBe("hi");
    expect(bodies[0]!.reasoning).toEqual({ effort: "none" });
    expect(bodies[1]!.reasoning).toBeUndefined();
  });

  it("passes server tools alongside function tools, and returns the pages a search read", async () => {
    let body: Record<string, unknown> = {};
    const fetch = async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "done", annotations: [{ type: "url_citation", url_citation: { url: "https://www.happycow.net/x", title: "HappyCow" } }] } }] }),
        { status: 200 },
      );
    };
    const engine = createOpenRouterEngine({ apiKey: "k", fetch: fetch as never });
    const res = await engine.chat.completions.create({
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "f", description: "", parameters: {} } }],
      serverTools: [{ type: "openrouter:web_search" }],
    });
    expect((body.tools as Array<{ type: string }>).map((t) => t.type)).toEqual(["function", "openrouter:web_search"]);
    expect(res.choices[0]!.message.citations).toEqual([{ url: "https://www.happycow.net/x", title: "HappyCow" }]);
  });
});

describe("what a call cost", () => {
  it("passes on OpenRouter's usage: cost and tokens", async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00731 } }), { status: 200 });
    const engine = createOpenRouterEngine({ apiKey: "k", fetch: fetch as never });
    const res = await engine.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    expect(res.usage).toEqual({ cost: 0.00731, promptTokens: 1200, completionTokens: 80 });
  });
});
