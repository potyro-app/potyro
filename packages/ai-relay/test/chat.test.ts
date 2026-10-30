import { describe, expect, it } from "vitest";
import { createChatProxy, readChatRequest, type ChatReply, type ChatRequest } from "../src/chat.ts";
import { memoryLedger } from "../src/ledger.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const MODEL = "deepseek/deepseek-v4-flash-0731";
const AUTH = "Bearer potyro-device:device-0001";
const enc = new TextEncoder();

const chatBody = (over: Record<string, unknown> = {}) => ({ model: MODEL, messages: [{ role: "user", content: "Make me a plant app." }], ...over });
const post = (body: unknown, over: Partial<ChatRequest> = {}): ChatRequest => ({
  method: "POST",
  body: typeof body === "string" ? body : JSON.stringify(body),
  ip: "1.2.3.4",
  authorization: AUTH,
  ...over,
});

const answer = (cost: number | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }], ...(cost === null ? {} : { usage: { prompt_tokens: 10, completion_tokens: 2, cost } }), ...extra });

/** An upstream that answers each request with the next Response (a function makes it lazily). */
function upstream(replies: Array<(() => Response) | Error> = []) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    fn: async (body: Record<string, unknown>): Promise<Response> => {
      sent.push(body);
      const r = replies.shift() ?? (() => new Response(answer(0.001), { status: 200, headers: { "content-type": "application/json" } }));
      if (r instanceof Error) throw r;
      return r();
    },
  };
}

async function text(r: ChatReply): Promise<string> {
  if ("json" in r) return JSON.stringify(r.json);
  return new Response(r.stream).text();
}

/** A body the test feeds a piece at a time. */
function controlled() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return { stream, push: (s: string) => ctl.enqueue(enc.encode(s)), end: () => ctl.close() };
}

describe("what a chat request may be", () => {
  const opts = { models: [MODEL], maxTokens: 32_000, planned: false };

  it("refuses an unknown model, or one with OpenRouter's :online suffix", () => {
    expect(readChatRequest(chatBody({ model: "openai/gpt-6" }), opts)).toMatchObject({ ok: false, status: 400, error: "model" });
    expect(readChatRequest(chatBody({ model: `${MODEL}:online` }), opts)).toMatchObject({ ok: false, error: "model" });
    expect(readChatRequest(chatBody({ model: undefined }), opts)).toMatchObject({ ok: false, error: "model" });
  });

  it("refuses fields it does not know, among them a model list and a user id", () => {
    expect(readChatRequest(chatBody({ models: [MODEL, "openai/gpt-6"] }), opts)).toMatchObject({ ok: false, error: "unknown field models" });
    expect(readChatRequest(chatBody({ user: "someone" }), opts)).toMatchObject({ ok: false, error: "unknown field user" });
  });

  it("refuses OpenRouter's server tools without a plan, in each of the ways they are asked for", () => {
    expect(readChatRequest(chatBody({ tools: [{ type: "openrouter:web_search" }] }), opts)).toMatchObject({ ok: false, status: 403, error: "plan" });
    expect(readChatRequest(chatBody({ plugins: [{ id: "web" }] }), opts)).toMatchObject({ ok: false, status: 403, error: "plan" });
    expect(readChatRequest(chatBody({ web_search_options: { search_context_size: "high" } }), opts)).toMatchObject({ ok: false, status: 403 });
    // With a plan (none exist yet), they go through.
    expect(readChatRequest(chatBody({ tools: [{ type: "openrouter:web_search" }] }), { ...opts, planned: true }).ok).toBe(true);
  });

  it("passes messages, tools, tool calls and reasoning on unchanged", () => {
    const tools = [{ type: "function", function: { name: "write_file", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
    const messages = [
      { role: "system", content: "You build apps." },
      { role: "user", content: "Make me a plant app." },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"plants.app.ts"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "written" },
    ];
    const reasoning = { effort: "high", exclude: true };
    const read = readChatRequest(chatBody({ messages, tools, tool_choice: "auto", reasoning, temperature: 0.2 }), opts);
    if (!read.ok) throw new Error(read.error);
    expect(read.body.messages).toEqual(messages);
    expect(read.body.tools).toEqual(tools);
    expect(read.body.tool_choice).toBe("auto");
    expect(read.body.reasoning).toEqual(reasoning);
    expect(read.body.temperature).toBe(0.2);
  });

  it("decides the token cap, the provider's data rule and the usage report itself", () => {
    const read = readChatRequest(chatBody({ max_tokens: 64_000, provider: { sort: "throughput", data_collection: "allow" }, usage: { include: false } }), opts);
    if (!read.ok) throw new Error(read.error);
    expect(read.body.max_tokens).toBe(32_000);
    expect(read.body.provider).toEqual({ sort: "throughput", data_collection: "deny" });
    expect(read.body.usage).toEqual({ include: true });
    // No cap asked for: the clamp, never open-ended.
    const open = readChatRequest(chatBody(), opts);
    expect(open.ok && open.body.max_tokens).toBe(32_000);
    const small = readChatRequest(chatBody({ max_tokens: 500 }), opts);
    expect(small.ok && small.body.max_tokens).toBe(500);
    expect(readChatRequest(chatBody({ max_tokens: -1 }), opts)).toMatchObject({ ok: false, error: "max_tokens" });
  });
});

describe("the chat route", () => {
  it("sends a request on and pipes the answer back, with what the device has left", async () => {
    const up = upstream();
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { deviceMonthUsd: 0.5 } });
    const res = await chat.handle(post(chatBody()));
    expect(res.status).toBe(200);
    expect(res.headers["x-potyro-left-usd"]).toBe("0.5");
    expect(JSON.parse(await text(res))).toMatchObject({ choices: [{ message: { content: "ok" } }] });
    expect(up.sent[0]).toMatchObject({ model: MODEL, provider: { data_collection: "deny" }, usage: { include: true } });
    // Debited from what the answer said it cost, on the device's month and the service's.
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBeCloseTo(0.001);
    expect(ledger.spent("2026-10")).toBeCloseTo(0.001);
    const next = await chat.handle(post(chatBody()));
    expect(next.headers["x-potyro-left-usd"]).toBe("0.499");
    await text(next);
  });

  it("refuses before anything is sent: no device, not JSON, too big, unknown model, a server tool", async () => {
    const up = upstream();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW });
    expect((await chat.handle(post(chatBody(), { authorization: undefined }))).status).toBe(401);
    expect((await chat.handle(post(chatBody(), { authorization: "Bearer sk-or-v1-someones-key" }))).status).toBe(401);
    expect((await chat.handle(post("{nope"))).status).toBe(400);
    expect((await chat.handle(post("x".repeat(5 * 1024 * 1024)))).status).toBe(413);
    expect(await chat.handle(post(chatBody({ model: "anthropic/claude-opus-5" })))).toMatchObject({ status: 400, json: { ok: false, error: "model" } });
    expect(await chat.handle(post(chatBody({ tools: [{ type: "openrouter:web_search" }] })))).toMatchObject({ status: 403, json: { error: "plan" } });
    // A plan token is no use while no plan exists.
    expect((await chat.handle(post(chatBody({ plugins: [{ id: "web" }] }), { plan: "anything" }))).status).toBe(403);
    expect((await chat.handle({ ...post(chatBody()), method: "GET" })).status).toBe(405);
    expect(up.sent).toHaveLength(0);
  });

  it("refuses a device past its monthly allowance BEFORE dispatch, and counts it as exhausted once", async () => {
    const up = upstream([() => new Response(answer(0.3)), () => new Response(answer(0.15))]);
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { deviceMonthUsd: 0.5, reserveUsd: 0.1 } });
    await text(await chat.handle(post(chatBody())));
    // 0.3 spent + 0.1 held fits under 0.5: sent.
    await text(await chat.handle(post(chatBody())));
    // 0.45 spent + 0.1 would not: refused unsent, with nothing left.
    const third = await chat.handle(post(chatBody()));
    expect(third).toMatchObject({ status: 429, json: { ok: false, error: "allowance", reason: "device-month" }, headers: { "x-potyro-left-usd": "0" } });
    await chat.handle(post(chatBody()));
    expect(up.sent).toHaveLength(2);
    expect(ledger.events()["2026-10"]).toEqual({ exhausted: 1 });
    // Another device is its own allowance.
    expect((await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:device-0002" }))).status).toBe(200);
  });

  it("stops the whole service at the monthly cap, checked BEFORE the request that would cross it, shared with /complete", async () => {
    const up = upstream();
    const ledger = memoryLedger();
    ledger.addSpend("2026-10", 9.99); // what /complete spent this month
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { monthlyUsd: 10, reserveUsd: 0.02 } });
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: "allowance", reason: "service-month" } });
    expect(up.sent).toHaveLength(0);
  });

  it("holds a reserve for requests in flight, so a device cannot fire past its allowance at once", async () => {
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    const chat = createChatProxy({ upstream: slow, now: () => NOW, limits: { deviceMonthUsd: 0.05, reserveUsd: 0.02, concurrentPerDevice: 4 } });
    const a = await chat.handle(post(chatBody()));
    const b = await chat.handle(post(chatBody()));
    // Two reserves (0.04) are out; a third would need 0.06 of 0.05.
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: "busy" } });
    pending.forEach((p) => (p.push(answer(0.001)), p.end()));
    await Promise.all([text(a), text(b)]);
    expect((await chat.handle(post(chatBody()))).status).toBe(200);
  });

  it("lets a device have three requests in flight, not four", async () => {
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    const chat = createChatProxy({ upstream: slow, now: () => NOW });
    const out = [await chat.handle(post(chatBody())), await chat.handle(post(chatBody())), await chat.handle(post(chatBody()))];
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: "busy" } });
    pending.forEach((p) => (p.push(answer(0)), p.end()));
    await Promise.all(out.map(text));
    expect((await chat.handle(post(chatBody()))).status).toBe(200);
  });

  it("holds one address to its daily dollars whatever device ids it sends", async () => {
    const up = upstream([() => new Response(answer(0.6)), () => new Response(answer(0.6))]);
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, limits: { addressDayUsd: 1, deviceMonthUsd: 5, reserveUsd: 0.02 } });
    await text(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-1" })));
    const second = await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-2" }));
    expect(second.status).toBe(200);
    // A third fits while the second is out: 0.6 spent and 0.04 held of 1.
    expect(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-9" }))).toMatchObject({ status: 200 });
    await text(second);
    expect(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-3" }))).toMatchObject({ json: { reason: "address-day" } });
  });

  it("forwards a streamed answer piece by piece, keep-alive lines included, and debits the cost in its final chunk", async () => {
    const c = controlled();
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response(c.stream, { headers: { "content-type": "text/event-stream" } }), now: () => NOW, ledger });
    const res = await chat.handle(post(chatBody({ stream: true })));
    if (!("stream" in res)) throw new Error("not piped");
    expect(res.headers["content-type"]).toBe("text/event-stream");
    const reader = res.stream.getReader();
    const dec = new TextDecoder();
    c.push(": OPENROUTER PROCESSING\n\n");
    expect(dec.decode((await reader.read()).value)).toBe(": OPENROUTER PROCESSING\n\n");
    c.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    expect(dec.decode((await reader.read()).value)).toContain('"Hel"');
    // The usage chunk, split across two reads.
    c.push('data: {"choices":[],"usage":{"prompt_tokens":9,"completion');
    c.push('_tokens":3,"cost":0.0042}}\n\ndata: [DONE]\n\n');
    c.end();
    while (!(await reader.read()).done);
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBeCloseTo(0.0042);
    expect(ledger.spent("2026-10")).toBeCloseTo(0.0042);
  });

  it("debits an unstreamed answer padded with keep-alive lines from its usage.cost", async () => {
    const ledger = memoryLedger();
    const body = `: OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n${answer(0.0031)}`;
    const chat = createChatProxy({ upstream: async () => new Response(body), now: () => NOW, ledger });
    const res = await chat.handle(post(chatBody()));
    expect(await text(res)).toBe(body);
    expect(ledger.spent("2026-10")).toBeCloseTo(0.0031);
  });

  it("charges the reserve when the cost is not known, and nothing when OpenRouter refused or failed", async () => {
    const ledger = memoryLedger();
    const up = upstream([
      () => new Response(answer(null)),
      () => new Response('{"error":{"message":"reasoning is mandatory"}}', { status: 400 }),
      () => new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 }),
      () => new Response('{"error":{"message":"upstream died"}}'),
      new Error("network"),
    ]);
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { reserveUsd: 0.02 } });
    await text(await chat.handle(post(chatBody())));
    expect(ledger.spent("2026-10")).toBeCloseTo(0.02);
    // A refusal the Studio acts on comes back as it is.
    const refused = await chat.handle(post(chatBody()));
    expect(refused.status).toBe(400);
    expect(await text(refused)).toContain("reasoning is mandatory");
    // Potyro's key out of credit is not the sender's business.
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 502, json: { error: "upstream" } });
    await text(await chat.handle(post(chatBody())));
    expect((await chat.handle(post(chatBody()))).status).toBe(502);
    expect(ledger.spent("2026-10")).toBeCloseTo(0.02);
  });

  it("stops reading upstream when the sender goes away, and frees the device's slot", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(enc.encode(": OPENROUTER PROCESSING\n\n")), cancel: () => void (cancelled = true) });
    const ledger = memoryLedger();
    const replies = [() => new Response(stream), () => new Response(answer(0))];
    const chat = createChatProxy({ upstream: async () => replies.shift()!(), now: () => NOW, ledger, limits: { reserveUsd: 0.02, concurrentPerDevice: 1 } });
    const res = await chat.handle(post(chatBody({ stream: true })));
    if (!("stream" in res)) throw new Error("not piped");
    const reader = res.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    // The cost is not known: the reserve is charged, and the slot is free again.
    expect(ledger.spent("2026-10")).toBeCloseTo(0.02);
    const again = await chat.handle(post(chatBody()));
    expect(again.status).toBe(200);
  });

  it("answers 503 and sends nothing while the kill switch is on, read on every request", async () => {
    let off = true;
    const up = upstream();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, isOff: () => off });
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 503, json: { ok: false, error: "off" } });
    off = false;
    expect((await chat.handle(post(chatBody()))).status).toBe(200);
    expect(up.sent).toHaveLength(1);
  });

  it("starts a new month afresh", async () => {
    let now = NOW;
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: upstream([() => new Response(answer(0.5))]).fn, now: () => now, ledger, limits: { deviceMonthUsd: 0.5 } });
    await text(await chat.handle(post(chatBody())));
    expect((await chat.handle(post(chatBody()))).status).toBe(429);
    now = Date.UTC(2026, 10, 1, 1);
    expect((await chat.handle(post(chatBody()))).status).toBe(200);
  });
});
