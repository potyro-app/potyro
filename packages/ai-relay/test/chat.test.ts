import { describe, expect, it } from "vitest";
import { CHAT_MESSAGES, chatLimits, createChatProxy, NOT_ENOUGH_LEFT, readChatRequest, type ChatReply, type ChatRequest } from "../src/chat.ts";
import { createBudget } from "../src/budget.ts";
import { memoryLedger } from "../src/ledger.ts";
import { estimateUsd, MODEL_PRICES } from "../src/prices.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const MODEL = "deepseek/deepseek-v4-flash-0731";
const AUTH = "Bearer potyro-device:device-0001";
const enc = new TextEncoder();

/** What the relay estimates a body costs at most on the default model (prices.ts). */
const estimate = (body: unknown, maxTokens = 64_000): number => estimateUsd(MODEL_PRICES[MODEL]!, JSON.stringify(body).length, maxTokens);

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
  const opts = { models: [MODEL], maxTokens: 64_000, planned: false };

  it("refuses an unknown model, or one with OpenRouter's :online suffix", () => {
    expect(readChatRequest(chatBody({ model: "openai/gpt-6" }), opts)).toMatchObject({ ok: false, status: 400, code: "model" });
    expect(readChatRequest(chatBody({ model: `${MODEL}:online` }), opts)).toMatchObject({ ok: false, code: "model" });
    expect(readChatRequest(chatBody({ model: undefined }), opts)).toMatchObject({ ok: false, code: "model" });
  });

  it("refuses fields it does not know, among them a model list and a user id", () => {
    expect(readChatRequest(chatBody({ models: [MODEL, "openai/gpt-6"] }), opts)).toMatchObject({ ok: false, code: "request", param: "models" });
    expect(readChatRequest(chatBody({ user: "someone" }), opts)).toMatchObject({ ok: false, code: "request", param: "user" });
  });

  it("refuses OpenRouter's server tools without a plan, in each of the ways they are asked for", () => {
    expect(readChatRequest(chatBody({ tools: [{ type: "openrouter:web_search" }] }), opts)).toMatchObject({ ok: false, status: 403, code: "plan" });
    expect(readChatRequest(chatBody({ plugins: [{ id: "web" }] }), opts)).toMatchObject({ ok: false, status: 403, code: "plan" });
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
    if (!read.ok) throw new Error(read.code);
    expect(read.body.messages).toEqual(messages);
    expect(read.body.tools).toEqual(tools);
    expect(read.body.tool_choice).toBe("auto");
    expect(read.body.reasoning).toEqual(reasoning);
    expect(read.body.temperature).toBe(0.2);
  });

  it("decides the token cap, the provider's data rule and the usage report itself", () => {
    const read = readChatRequest(chatBody({ max_tokens: 100_000, provider: { sort: "throughput", data_collection: "allow" }, usage: { include: false } }), opts);
    if (!read.ok) throw new Error(read.code);
    expect(read.body.max_tokens).toBe(64_000);
    expect(read.maxTokens).toBe(64_000);
    expect(read.body.provider).toEqual({ sort: "throughput", data_collection: "deny" });
    expect(read.body.usage).toEqual({ include: true });
    // No cap asked for: the clamp, never open-ended.
    const open = readChatRequest(chatBody(), opts);
    expect(open.ok && open.body.max_tokens).toBe(64_000);
    const small = readChatRequest(chatBody({ max_tokens: 500 }), opts);
    expect(small.ok && small.body.max_tokens).toBe(500);
    expect(small.ok && small.maxTokens).toBe(500);
    // Only max_completion_tokens: that is the most the answer may be.
    const completion = readChatRequest(chatBody({ max_completion_tokens: 2_000 }), opts);
    expect(completion.ok && [completion.body.max_tokens, completion.maxTokens]).toEqual([undefined, 2_000]);
    expect(readChatRequest(chatBody({ max_tokens: -1 }), opts)).toMatchObject({ ok: false, code: "request", param: "max_tokens" });
  });

  it("leaves the Studio's high thinking level (64 000 tokens) as it asked", () => {
    const read = readChatRequest(chatBody({ max_tokens: 64_000, reasoning: { effort: "high" } }), opts);
    expect(read.ok && read.body.max_tokens).toBe(64_000);
    expect(chatLimits().maxTokens).toBe(64_000);
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
    expect(await chat.handle(post(chatBody({ model: "anthropic/claude-opus-5" })))).toMatchObject({ status: 400, json: { error: { code: "model", type: "potyro" } } });
    expect(await chat.handle(post(chatBody({ tools: [{ type: "openrouter:web_search" }] })))).toMatchObject({ status: 403, json: { error: { code: "plan" } } });
    // A plan token is no use while no plan exists.
    expect((await chat.handle(post(chatBody({ plugins: [{ id: "web" }] }), { plan: "anything" }))).status).toBe(403);
    expect((await chat.handle({ ...post(chatBody()), method: "GET" })).status).toBe(405);
    expect(up.sent).toHaveLength(0);
  });

  it("refuses a device past its monthly allowance BEFORE dispatch, and counts it as exhausted once", async () => {
    const up = upstream([() => new Response(answer(0.3)), () => new Response(answer(0.15))]);
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { deviceMonthUsd: 0.5, reserveUsd: 0.1, addressDayUsd: 0.6 } });
    await text(await chat.handle(post(chatBody())));
    // 0.3 spent + 0.1 held fits under 0.5: sent.
    await text(await chat.handle(post(chatBody())));
    // 0.45 spent + 0.1 would not: refused unsent, with nothing left.
    const third = await chat.handle(post(chatBody()));
    expect(third).toMatchObject({ status: 429, json: { error: { code: "allowance", message: CHAT_MESSAGES.allowance } }, headers: { "x-potyro-left-usd": "0" } });
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
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: { code: "service-month" } } });
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
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: { code: "busy" } } });
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
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, json: { error: { code: "busy" } } });
    pending.forEach((p) => (p.push(answer(0)), p.end()));
    await Promise.all(out.map(text));
    expect((await chat.handle(post(chatBody()))).status).toBe(200);
  });

  it("holds one address to its daily dollars whatever device ids it sends", async () => {
    const up = upstream([() => new Response(answer(0.6)), () => new Response(answer(0.6))]);
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, limits: { addressDayUsd: 1, deviceMonthUsd: 5, reserveUsd: 0.02, dayUsd: 5 } });
    await text(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-1" })));
    const second = await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-2" }));
    expect(second.status).toBe(200);
    // A third fits while the second is out: 0.6 spent and two holds (each the estimate, ~0.018, or
    // the 0.02 reserve, whichever is more) of 1.
    expect(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-9" }))).toMatchObject({ status: 200 });
    await text(second);
    expect(await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:fresh-id-3" }))).toMatchObject({
      json: { error: { code: "address-day", message: "Free AI is busy on this network today; it is back tomorrow, or add your own key in Model settings." } },
    });
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

  it("charges the estimate for a whole answer that does not say what it cost, and nothing for one OpenRouter refused or failed", async () => {
    const ledger = memoryLedger();
    const errors: unknown[] = [];
    const up = upstream([
      () => new Response(answer(null)),
      () => new Response('{"error":{"message":"reasoning is mandatory"}}', { status: 400 }),
      () => new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 }),
      () => new Response('{"error":{"message":"upstream died"}}'),
      () => new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 }),
      () => new Response('{"error":{"message":"Bad gateway"}}', { status: 502 }),
      () => new Response(answer(0.001)),
    ]);
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { reserveUsd: 0.02 }, onError: (e) => errors.push(e) });
    const each = estimate(chatBody());
    // A whole answer with no cost in it: it ran, and how far is not known. The estimate.
    await text(await chat.handle(post(chatBody())));
    expect(ledger.spent("2026-10")).toBeCloseTo(each, 9);
    // A refusal the Studio acts on comes back as it is. It never ran: nothing.
    const refused = await chat.handle(post(chatBody()));
    expect(refused.status).toBe(400);
    expect(await text(refused)).toContain("reasoning is mandatory");
    expect(ledger.spent("2026-10")).toBeCloseTo(each, 9);
    // Potyro's key out of credit is not the sender's business, and not the sender's to pay for.
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 502, json: { error: { code: "upstream" } } });
    expect(ledger.spent("2026-10")).toBeCloseTo(each, 9);
    // A 200 whose body is an error and says no cost: a whole answer again, the estimate.
    await text(await chat.handle(post(chatBody())));
    expect(ledger.spent("2026-10")).toBeCloseTo(2 * each, 9);
    // OpenRouter's own 429, passed through with no cost: nothing.
    const limited = await chat.handle(post(chatBody()));
    expect(limited.status).toBe(429);
    await text(limited);
    // OpenRouter down: nothing.
    expect((await chat.handle(post(chatBody()))).status).toBe(502);
    expect(ledger.spent("2026-10")).toBeCloseTo(2 * each, 9);
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBeCloseTo(2 * each, 9);
    // One that says what it cost: that.
    await text(await chat.handle(post(chatBody())));
    expect(ledger.spent("2026-10")).toBeCloseTo(2 * each + 0.001, 9);
    expect(errors).toHaveLength(2);
  });

  it("charges an error answer what it says it cost, when it says", async () => {
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response('{"error":{"message":"cut"},"usage":{"cost":0.004}}', { status: 400 }), now: () => NOW, ledger });
    await text(await chat.handle(post(chatBody())));
    expect(ledger.spent("2026-10")).toBeCloseTo(0.004, 9);
  });

  it("charges only what was sent when the sender goes away before OpenRouter answers, and does not report it as a failure", async () => {
    const ledger = memoryLedger();
    const errors: unknown[] = [];
    const gone = new AbortController();
    const chat = createChatProxy({
      upstream: (_body, signal) =>
        new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      now: () => NOW,
      ledger,
      onError: (e) => errors.push(e),
    });
    const pending = chat.handle(post(chatBody(), { signal: gone.signal }));
    gone.abort();
    expect((await pending).status).toBe(502);
    // The request's own side of the estimate, none of the 64 000 tokens it might have answered with.
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBeCloseTo(estimate(chatBody(), 0), 12);
    expect(estimate(chatBody(), 0)).toBeLessThan(estimate(chatBody()) / 100);
    expect(errors).toEqual([]);
  });

  it("charges nothing when OpenRouter was never reached", async () => {
    const ledger = memoryLedger();
    const errors: unknown[] = [];
    const refused = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    const chat = createChatProxy({ upstream: async () => Promise.reject(refused), now: () => NOW, ledger, onError: (e) => errors.push(e) });
    expect((await chat.handle(post(chatBody()))).status).toBe(502);
    expect(ledger.spent("2026-10")).toBe(0);
    expect(ledger.daySpent("2026-10-15")).toBe(0);
    expect(errors).toHaveLength(1);
  });

  it("charges a request that timed out with no answer for what it sent and what could have been written meanwhile", async () => {
    let now = NOW;
    const ledger = memoryLedger();
    const errors: unknown[] = [];
    const chat = createChatProxy({
      upstream: async () => {
        now += 10_000;
        throw new DOMException("timed out", "TimeoutError");
      },
      now: () => now,
      ledger,
      limits: { outTokensPerSecond: 300 },
      onError: (e) => errors.push(e),
    });
    expect((await chat.handle(post(chatBody()))).status).toBe(502);
    // Ten seconds out, at 300 tokens a second at most: 3 000 tokens of the 64 000 it could ask for.
    expect(ledger.spent("2026-10")).toBeCloseTo(estimate(chatBody(), 3_000), 12);
    expect(errors).toHaveLength(1);
  });

  it("charges the estimate for a stream that ends without its usage chunk", async () => {
    const c = controlled();
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response(c.stream), now: () => NOW, ledger });
    const res = await chat.handle(post(chatBody({ stream: true, max_tokens: 1_000 })));
    c.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    c.end();
    await text(res);
    expect(ledger.spent("2026-10")).toBeCloseTo(estimate(chatBody({ stream: true, max_tokens: 1_000 }), 1_000), 9);
  });

  it("charges a stream the sender leaves for what it sent and every byte of answer it was given", async () => {
    const c = controlled();
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response(c.stream), now: () => NOW, ledger });
    const body = chatBody({ stream: true });
    const res = await chat.handle(post(body));
    if (!("stream" in res)) throw new Error("not piped");
    const reader = res.stream.getReader();
    c.push(": OPENROUTER PROCESSING\n\n");
    c.push('data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n');
    c.push('data: {"id":"gen-1","choices":[{"index":0,"delta":{"reasoning":"thinking"}}]}\n\n');
    c.push('data: {"id":"gen-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]}}]}\n\n');
    c.push('data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"wörld"}}]}\n\n');
    for (let i = 0; i < 5; i++) await reader.read();
    await reader.cancel();
    // "Hello " 6 + "thinking" 8 + {"a":1} 7 + "wörld" 6 bytes: 27 tokens at the very most, of 64 000.
    expect(ledger.deviceSpent("2026-10", "device-0001")).toBeCloseTo(estimate(body, 27), 12);
    expect(ledger.daySpent("2026-10-15")).toBeCloseTo(estimate(body, 27), 12);
  });

  it("does not give an answer away to a sender that leaves just before the usage chunk", async () => {
    const c = controlled();
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response(c.stream), now: () => NOW, ledger });
    const body = chatBody({ stream: true, max_tokens: 2_000 });
    const res = await chat.handle(post(body));
    if (!("stream" in res)) throw new Error("not piped");
    const reader = res.stream.getReader();
    // 300 chunks of 20 characters: 6 000 bytes of answer, which is more tokens than it may ask for.
    for (let i = 0; i < 300; i++) c.push(`data: {"choices":[{"delta":{"content":"${"x".repeat(20)}"}}]}\n\n`);
    for (let i = 0; i < 300; i++) await reader.read();
    await reader.cancel();
    // Everything but the cost arrived: it pays the whole estimate, as an answer without a cost does.
    expect(ledger.spent("2026-10")).toBeCloseTo(estimate(body, 2_000), 12);
  });

  it("charges a stream OpenRouter cuts for what came, and for the time it was out when little came", async () => {
    let now = NOW;
    const ledger = memoryLedger();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
    const chat = createChatProxy({ upstream: async () => new Response(stream), now: () => now, ledger, limits: { outTokensPerSecond: 300 } });
    const body = chatBody({ stream: true });
    const res = await chat.handle(post(body));
    ctl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
    // Twenty seconds of hidden thinking could be 6 000 tokens; the two bytes that came say less.
    now += 20_000;
    ctl.error(new Error("socket hang up"));
    await text(res).catch(() => {});
    expect(ledger.spent("2026-10")).toBeCloseTo(estimate(body, 6_000), 12);
  });

  it("refuses unsent a request whose estimate is more than the device has left, and says a smaller one may fit", async () => {
    const ledger = memoryLedger();
    ledger.debit("2026-10", "device-0001", 0.47);
    const up = upstream();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, limits: { deviceMonthUsd: 0.5, reserveUsd: 0.02 } });
    // 64 000 tokens out could cost ~$0.018; with a long chat (~400 000 characters ≈ $0.014 in) it is over the $0.03 left.
    const long = chatBody({ messages: [{ role: "user", content: "x".repeat(400_000) }] });
    expect(estimate(long)).toBeGreaterThan(0.03);
    expect(await chat.handle(post(long))).toMatchObject({ status: 429, json: { error: { code: "allowance", message: NOT_ENOUGH_LEFT } }, headers: { "x-potyro-left-usd": "0.03" } });
    expect(up.sent).toHaveLength(0);
    // Not used up: a small one still goes, and nothing was counted as exhausted.
    expect((await chat.handle(post(chatBody({ max_tokens: 1_000 })))).status).toBe(200);
    expect(ledger.events()["2026-10"]).toBeUndefined();
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
    // Nothing of an answer had come (a keep-alive line is not one): what it sent is charged, and the slot is free again.
    expect(ledger.spent("2026-10")).toBeCloseTo(estimate(chatBody({ stream: true }), 0), 12);
    const again = await chat.handle(post(chatBody()));
    expect(again.status).toBe(200);
  });

  it("answers 503 and sends nothing while the kill switch is on, read on every request", async () => {
    let off = true;
    const up = upstream();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, isOff: () => off });
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 503, json: { error: { code: "off", message: CHAT_MESSAGES.off, type: "potyro" } } });
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

  it("does not wipe a new month when a request from the old one settles after it began", async () => {
    let now = Date.UTC(2026, 9, 31, 23, 59);
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: slow, now: () => now, ledger });
    const october = await chat.handle(post(chatBody()));
    now = Date.UTC(2026, 10, 1, 0, 5);
    const november = await chat.handle(post(chatBody(), { authorization: "Bearer potyro-device:device-0002" }));
    pending[1]!.push(answer(0.004));
    pending[1]!.end();
    await text(november);
    expect(ledger.spent("2026-11")).toBeCloseTo(0.004);
    // October's request ends now: written for October, which has ended, so it is dropped — and
    // November's spend is still there.
    pending[0]!.push(answer(0.25));
    pending[0]!.end();
    await text(october);
    expect(ledger.spent("2026-11")).toBeCloseTo(0.004);
    expect(ledger.deviceSpent("2026-11", "device-0002")).toBeCloseTo(0.004);
    expect(ledger.spent("2026-10")).toBe(0);
    expect(ledger.stale()).toBe(1);
  });

  it("counts an IPv6 sender by its /64, so new addresses in it share one day", async () => {
    const up = upstream([() => new Response(answer(0.3)), () => new Response(answer(0.3))]);
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, limits: { addressDayUsd: 0.6, deviceMonthUsd: 5, dayUsd: 5 } });
    const from = (ip: string, id: string) => post(chatBody(), { ip, authorization: `Bearer potyro-device:${id}` });
    await text(await chat.handle(from("2001:db8:1:2::1", "fresh-id-1")));
    await text(await chat.handle(from("2001:db8:1:2:ffff:ffff:ffff:fffe", "fresh-id-2")));
    expect(await chat.handle(from("2001:db8:1:2:aaaa::9", "fresh-id-3"))).toMatchObject({ status: 429, json: { error: { code: "address-day" } } });
    // The next /64 over is someone else.
    expect((await chat.handle(from("2001:db8:1:3::1", "fresh-id-4"))).status).toBe(200);
  });

  it("stops the whole service at its DAILY cap before dispatch, and starts again the next day", async () => {
    let now = NOW;
    const ledger = memoryLedger();
    const up = upstream([() => new Response(answer(0.3)), () => new Response(answer(0.3))]);
    const chat = createChatProxy({ upstream: up.fn, now: () => now, ledger, limits: { dayUsd: 0.6, monthlyUsd: 10, deviceMonthUsd: 5, addressDayUsd: 0.5 } });
    await text(await chat.handle(post(chatBody(), { ip: "1.1.1.1" })));
    // 0.3 spent today + a hold of ~0.02 + this one's: still under 0.6.
    await text(await chat.handle(post(chatBody(), { ip: "2.2.2.2" })));
    expect(await chat.handle(post(chatBody(), { ip: "3.3.3.3" }))).toMatchObject({
      status: 429,
      json: { error: { code: "service-day", message: CHAT_MESSAGES["service-day"] } },
    });
    expect(up.sent).toHaveLength(2);
    now += 24 * 60 * 60 * 1000;
    expect((await chat.handle(post(chatBody(), { ip: "3.3.3.3" }))).status).toBe(200);
  });

  it("holds every request in flight against the service's caps, so many at once cannot cross them, and says busy, not used up", async () => {
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    const each = estimate(chatBody());
    const ledger = memoryLedger();
    // Room for three holds of the 0.02 reserve, not four.
    const chat = createChatProxy({ upstream: slow, now: () => NOW, ledger, limits: { dayUsd: 0.07, monthlyUsd: 10, addressDayUsd: 0.05, reserveUsd: 0.02 } });
    expect(each).toBeLessThan(0.02);
    const from = (i: number) => post(chatBody(), { ip: `10.0.0.${i}`, authorization: `Bearer potyro-device:device-000${i}` });
    const out: ChatReply[] = [];
    for (let i = 0; i < 3; i++) out.push(await chat.handle(from(i)));
    expect(out.map((r) => r.status)).toEqual([200, 200, 200]);
    // Nothing is spent yet: the day is not used up, the relay is full for a moment.
    const fourth = await chat.handle(from(9));
    expect(fourth).toMatchObject({
      status: 503,
      headers: { "retry-after": "5" },
      json: { error: { code: "service-busy", type: "potyro", message: CHAT_MESSAGES["service-busy"] } },
    });
    expect(fourth.headers["x-potyro-left-usd"]).toBeUndefined();
    expect(pending).toHaveLength(3);
    // They settle at a tenth of a cent each, and the same request goes.
    pending.forEach((p) => (p.push(answer(0.001)), p.end()));
    await Promise.all(out.map(text));
    expect(ledger.daySpent("2026-10-15")).toBeCloseTo(0.003, 9);
    expect((await chat.handle(from(9))).status).toBe(200);
  });

  it("says busy, not this network's day, when an address is over only by what its requests in flight hold", async () => {
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    // A classroom behind one address: room for two holds of 0.02 in its 0.05 a day.
    const chat = createChatProxy({ upstream: slow, now: () => NOW, limits: { addressDayUsd: 0.05, dayUsd: 5, reserveUsd: 0.02 } });
    const from = (i: number) => post(chatBody(), { authorization: `Bearer potyro-device:pupil-000${i}` });
    const out = [await chat.handle(from(1)), await chat.handle(from(2))];
    expect(await chat.handle(from(3))).toMatchObject({ status: 503, headers: { "retry-after": "5" }, json: { error: { code: "service-busy" } } });
    pending.forEach((p) => (p.push(answer(0.001)), p.end()));
    await Promise.all(out.map(text));
    expect((await chat.handle(from(3))).status).toBe(200);
  });

  it("lets only so many requests be out at once for the whole service, and says busy to the next", async () => {
    const pending: Array<ReturnType<typeof controlled>> = [];
    const slow = async (): Promise<Response> => {
      const c = controlled();
      pending.push(c);
      return new Response(c.stream);
    };
    const ledger = memoryLedger();
    const budget = createBudget({ now: () => NOW, ledger, monthlyUsd: 1000, maxInFlight: 2 });
    const chat = createChatProxy({ upstream: slow, now: () => NOW, ledger, budget, limits: { addressDayUsd: 50 } });
    const from = (i: number) => post(chatBody(), { ip: `10.0.0.${i}`, authorization: `Bearer potyro-device:device-000${i}` });
    const out = [await chat.handle(from(1)), await chat.handle(from(2))];
    expect(await chat.handle(from(3))).toMatchObject({ status: 503, headers: { "retry-after": "5" }, json: { error: { code: "service-busy" } } });
    expect(pending).toHaveLength(2);
    pending[0]!.push(answer(0));
    pending[0]!.end();
    await text(out[0]!);
    expect((await chat.handle(from(3))).status).toBe(200);
  });

  it("still says used up, before busy, when the day's money really is spent", async () => {
    const ledger = memoryLedger();
    ledger.addDaySpend("2026-10-15", 0.06);
    const budget = createBudget({ now: () => NOW, ledger, monthlyUsd: 10, dayUsd: 0.07, maxInFlight: 1 });
    budget.hold(0.001);
    const up = upstream();
    const chat = createChatProxy({ upstream: up.fn, now: () => NOW, ledger, budget, limits: { addressDayUsd: 0.05 } });
    expect(await chat.handle(post(chatBody()))).toMatchObject({ status: 429, headers: { "x-potyro-left-usd": "0" }, json: { error: { code: "service-day" } } });
    expect(up.sent).toHaveLength(0);
  });

  it("gives an address a fifth of the service's day by default, at most four devices' months, and takes another share", () => {
    expect(chatLimits({ deviceMonthUsd: 0.5, monthlyUsd: 100 }).addressDayUsd).toBe(2);
    // $10 a month is $1.25 a day: one network may have a fifth of it, so no two or three close the day.
    expect(chatLimits({ deviceMonthUsd: 0.5, monthlyUsd: 10 })).toMatchObject({ dayUsd: 1.25, addressDayUsd: 0.25 });
    expect(chatLimits({ deviceMonthUsd: 0.5, monthlyUsd: 10, addressDayShare: 0.1 }).addressDayUsd).toBe(0.125);
    expect(() => chatLimits({ addressDayUsd: 2, dayUsd: 1 })).toThrow(/below the service's daily cap/);
    for (const share of [0, 1, 1.5]) expect(() => chatLimits({ addressDayShare: share })).toThrow(/AI_ADDRESS_DAY_SHARE/);
    // A shared budget's day is the one in force.
    expect(chatLimits({ deviceMonthUsd: 0.5 }, 8)).toMatchObject({ addressDayUsd: 1.6 });
    expect(chatLimits({ deviceMonthUsd: 0.5 }, 80).addressDayUsd).toBe(2);
  });

  it("will not start with a model it has no price for", () => {
    expect(() => createChatProxy({ upstream: upstream().fn, now: () => NOW, models: ["openai/gpt-6"] })).toThrow(/no price for openai\/gpt-6/);
    expect(() => createChatProxy({ upstream: upstream().fn, now: () => NOW, models: ["openai/gpt-6"], prices: { "openai/gpt-6": { input: 1, output: 2 } } })).not.toThrow();
  });

  it("answers every refusal in OpenAI's error shape, with a code and words that say what to do", async () => {
    const ledger = memoryLedger();
    ledger.addSpend("2026-10", 10);
    const full = createChatProxy({ upstream: upstream().fn, now: () => NOW, ledger, budget: createBudget({ now: () => NOW, ledger, monthlyUsd: 10 }) });
    const chat = createChatProxy({ upstream: upstream().fn, now: () => NOW });
    const replies = [
      await chat.handle(post(chatBody(), { authorization: undefined })),
      await chat.handle({ ...post(chatBody()), method: "GET" }),
      await chat.handle(post("{nope")),
      await chat.handle(post("x".repeat(5 * 1024 * 1024))),
      await chat.handle(post(chatBody({ model: "openai/gpt-6" }))),
      await chat.handle(post(chatBody({ plugins: [{ id: "web" }] }))),
      await chat.handle(post(chatBody({ user: "someone" }))),
      await full.handle(post(chatBody())),
    ];
    expect(replies.map((r) => [r.status, "json" in r && (r.json.error as { code: string }).code])).toEqual([
      [401, "device"],
      [405, "method"],
      [400, "request"],
      [413, "too-big"],
      [400, "model"],
      [403, "plan"],
      [400, "request"],
      [429, "service-month"],
    ]);
    for (const r of replies) {
      if (!("json" in r)) throw new Error("not a refusal");
      const error = r.json.error as Record<string, unknown>;
      expect(error.type).toBe("potyro");
      expect(error.message).toBe(CHAT_MESSAGES[error.code as keyof typeof CHAT_MESSAGES]);
      expect(Object.keys(r.json)).toEqual(["error"]);
    }
    expect(replies[6]).toMatchObject({ json: { error: { param: "user" } } });
  });
});
