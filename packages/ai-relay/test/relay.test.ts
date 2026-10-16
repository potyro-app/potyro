import { describe, expect, it } from "vitest";
import { createAiRelay, memoryLedger, persistentLedger, UNPRICED_USD, type LedgerState } from "../src/relay.ts";
import { AI_FORMAT, AI_MODEL, openRouterBody, readAiPayload, readOpenRouterReply, type AiPayload } from "../src/request.ts";
import type { UpstreamReply } from "../src/request.ts";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

const payload = (over: Partial<AiPayload> = {}): AiPayload => ({
  format: AI_FORMAT,
  device: "device-0001",
  system: "Answer with JSON.",
  parts: [{ type: "text", text: "A receipt." }, { type: "image", data: JPEG }],
  json: { type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false },
  maxTokens: 4000,
  ...over,
});

function upstream(replies: Array<UpstreamReply | Error> = []) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    fn: async (body: Record<string, unknown>): Promise<UpstreamReply> => {
      sent.push(body);
      const r = replies.shift() ?? { ok: true, text: '{"total":12.5}', cost: 0.0003 };
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const post = (body: unknown, ip = "1.2.3.4") => ({ method: "POST", path: "/complete", body: typeof body === "string" ? body : JSON.stringify(body), ip });
const NOW = Date.UTC(2026, 9, 15, 12);

describe("the request format", () => {
  it("accepts exactly the payload, and refuses anything else rather than dropping it", () => {
    expect(readAiPayload(payload()).ok).toBe(true);
    expect(readAiPayload({ ...payload(), model: "openai/gpt-6" })).toEqual({ ok: false, error: "unknown field model" });
    expect(readAiPayload(payload({ parts: [{ type: "image", data: "https://evil.test/x.jpg" }] }))).toEqual({ ok: false, error: "image" });
    expect(readAiPayload(payload({ parts: [{ type: "text", text: "x".repeat(40_001) }] }))).toEqual({ ok: false, error: "text too long" });
    expect(readAiPayload(payload({ parts: Array.from({ length: 5 }, () => ({ type: "image" as const, data: JPEG })) }))).toEqual({ ok: false, error: "too many images" });
    expect(readAiPayload(payload({ maxTokens: 64_000 }))).toEqual({ ok: false, error: "maxTokens" });
    expect(readAiPayload(payload({ device: "x" }))).toEqual({ ok: false, error: "device" });
  });

  it("becomes a body whose model, provider rules and caps are decided by the code, not the sender", () => {
    const body = openRouterBody(payload());
    expect(body.model).toBe(AI_MODEL);
    expect(body.max_tokens).toBe(4000);
    expect(body.provider).toEqual({ data_collection: "deny", require_parameters: true });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "answer", strict: true } });
    expect((body.messages as Array<{ content: unknown }>)[1]!.content).toEqual([
      { type: "text", text: "A receipt." },
      { type: "image_url", image_url: { url: JPEG } },
    ]);
    // Words back: no schema, no schema rules.
    const words = openRouterBody(payload({ json: undefined }));
    expect(words.response_format).toBeUndefined();
    expect(words.provider).toEqual({ data_collection: "deny" });
  });

  it("reads OpenRouter's answers, its errors and an error sent with a 200", () => {
    expect(readOpenRouterReply(200, ': OPENROUTER PROCESSING\n{"choices":[{"message":{"content":"hi"}}],"usage":{"cost":0.0002}}')).toEqual({ ok: true, text: "hi", cost: 0.0002 });
    expect(readOpenRouterReply(402, '{"error":{"message":"Insufficient credits"}}')).toEqual({ ok: false, status: 402, message: "Insufficient credits" });
    expect(readOpenRouterReply(200, '{"error":{"message":"upstream died"}}')).toEqual({ ok: false, status: 502, message: "upstream died" });
    expect(readOpenRouterReply(200, '{"choices":[{"message":{"content":""}}]}').ok).toBe(false);
  });
});

describe("a recording to write down (voice input, docs/29)", () => {
  const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
  const voice = (data = WAV): AiPayload => payload({ system: "Write down what is said.", parts: [{ type: "text", text: "Language: pl-PL" }, { type: "audio", data }], json: undefined, maxTokens: 1000 });

  it("accepts one WAV recording, and refuses anything else", () => {
    expect(readAiPayload(voice()).ok).toBe(true);
    expect(readAiPayload(voice("data:audio/ogg;base64,T2dnUw=="))).toEqual({ ok: false, error: "audio" });
    expect(readAiPayload(voice(`data:audio/wav;base64,${"A".repeat(2_700_000)}`))).toEqual({ ok: false, error: "audio" });
    expect(readAiPayload(payload({ parts: [{ type: "audio", data: WAV }, { type: "audio", data: WAV }] }))).toEqual({ ok: false, error: "too many recordings" });
    expect(readAiPayload(payload({ parts: [{ type: "audio", data: WAV }, { type: "image", data: JPEG }] }))).toEqual({ ok: false, error: "a recording goes alone" });
    expect(readAiPayload(payload({ parts: [{ type: "audio", data: WAV, format: "mp3" } as never] }))).toEqual({ ok: false, error: "part" });
  });

  it("goes to OpenRouter as input_audio, base64 without the prefix", () => {
    const body = openRouterBody(voice()) as { messages: Array<{ content: unknown }> };
    expect(body.messages[1]!.content).toEqual([
      { type: "text", text: "Language: pl-PL" },
      { type: "input_audio", input_audio: { data: WAV.slice(WAV.indexOf(",") + 1), format: "wav" } },
    ]);
  });

  it("is counted on the same ledger as every other request", async () => {
    const up = upstream([{ ok: true, text: "kup mleko", cost: 0.0004 }]);
    const ledger = memoryLedger();
    const relay = createAiRelay({ upstream: up.fn, now: () => NOW, ledger });
    const res = await relay.handle(post(voice()));
    expect(res).toMatchObject({ status: 200, body: { ok: true, text: "kup mleko" } });
    expect(ledger.spent("2026-10")).toBeCloseTo(0.0004);
    expect(ledger.count("2026-10", "device-0001")).toBe(1);
  });
});

describe("the relay", () => {
  it("answers a request with the model's words and what is left this month", async () => {
    const up = upstream();
    const relay = createAiRelay({ upstream: up.fn, now: () => NOW });
    const res = await relay.handle(post(payload()));
    expect(res).toEqual({ status: 200, body: { ok: true, text: '{"total":12.5}', model: AI_MODEL, left: 99 } });
    expect(up.sent[0]!.model).toBe(AI_MODEL);
  });

  it("refuses what is not a request before anything is sent", async () => {
    const up = upstream();
    const relay = createAiRelay({ upstream: up.fn, now: () => NOW });
    expect((await relay.handle(post("{nope"))).status).toBe(400);
    expect((await relay.handle(post({ ...payload(), format: "other" }))).status).toBe(400);
    expect((await relay.handle(post("x".repeat(7 * 1024 * 1024)))).status).toBe(413);
    expect((await relay.handle({ method: "GET", path: "/complete", body: "", ip: "1" })).status).toBe(405);
    expect((await relay.handle({ method: "POST", path: "/chat/completions", body: "{}", ip: "1" })).status).toBe(404);
    expect((await relay.handle({ method: "GET", path: "/health", body: "", ip: "1" })).status).toBe(200);
    expect(up.sent).toHaveLength(0);
  });

  it("holds a device to its day and its month", async () => {
    const up = upstream();
    const relay = createAiRelay({ upstream: up.fn, now: () => NOW, limits: { perDeviceDay: 2, perDeviceMonth: 3 } });
    expect((await relay.handle(post(payload()))).status).toBe(200);
    expect((await relay.handle(post(payload()))).status).toBe(200);
    expect(await relay.handle(post(payload()))).toEqual({ status: 429, body: { ok: false, error: "allowance", reason: "device-day" } });
    // Another device on the same address is its own allowance.
    expect((await relay.handle(post(payload({ device: "device-0002" })))).status).toBe(200);
    expect(up.sent).toHaveLength(3);
  });

  it("counts an address whatever device ids it uses", async () => {
    const relay = createAiRelay({ upstream: upstream().fn, now: () => NOW, limits: { perAddressDay: 2 } });
    await relay.handle(post(payload({ device: "fresh-id-1" })));
    await relay.handle(post(payload({ device: "fresh-id-2" })));
    expect((await relay.handle(post(payload({ device: "fresh-id-3" })))).body).toMatchObject({ reason: "address-day" });
  });

  it("stops the whole service at the monthly cap, BEFORE the request that would cross it", async () => {
    const up = upstream([
      { ok: true, text: "a", cost: 0.004 },
      { ok: true, text: "b", cost: 0.004 },
    ]);
    const relay = createAiRelay({ upstream: up.fn, now: () => NOW, limits: { monthlyUsd: 0.011, reserveUsd: 0.004 } });
    expect((await relay.handle(post(payload({ device: "device-a-001" })))).status).toBe(200);
    expect((await relay.handle(post(payload({ device: "device-b-001" })))).status).toBe(200);
    // 0.008 spent + 0.004 for the next one would be over 0.011: refused unsent.
    const third = await relay.handle(post(payload({ device: "device-c-001" })));
    expect(third.body).toMatchObject({ error: "allowance", reason: "service-month" });
    expect(up.sent).toHaveLength(2);
  });

  it("starts a new month afresh", async () => {
    let now = NOW;
    const relay = createAiRelay({ upstream: upstream().fn, now: () => now, limits: { perDeviceMonth: 1, perDeviceDay: 100 } });
    expect((await relay.handle(post(payload()))).status).toBe(200);
    expect((await relay.handle(post(payload()))).body).toMatchObject({ reason: "device-month" });
    now = Date.UTC(2026, 10, 1, 1);
    expect((await relay.handle(post(payload()))).status).toBe(200);
  });

  it("counts an unpriced answer as costing something, and a failed one as nothing", async () => {
    const ledger = memoryLedger();
    const relay = createAiRelay({ upstream: upstream([{ ok: true, text: "x" }, { ok: false, status: 500, message: "down" }, new Error("timeout")]).fn, now: () => NOW, ledger });
    await relay.handle(post(payload()));
    expect(ledger.spent("2026-10")).toBe(UNPRICED_USD);
    expect((await relay.handle(post(payload()))).status).toBe(502);
    expect((await relay.handle(post(payload()))).status).toBe(502);
    expect(ledger.spent("2026-10")).toBe(UNPRICED_USD);
    expect(ledger.count("2026-10", "device-0001")).toBe(1);
  });

  it("lets a device have two requests in flight, not three", async () => {
    const waiting: Array<() => void> = [];
    const slow = () => new Promise<UpstreamReply>((resolve) => waiting.push(() => resolve({ ok: true, text: "x", cost: 0 })));
    const relay = createAiRelay({ upstream: slow, now: () => NOW });
    const a = relay.handle(post(payload()));
    const b = relay.handle(post(payload()));
    expect(await relay.handle(post(payload()))).toEqual({ status: 429, body: { ok: false, error: "busy" } });
    waiting.forEach((w) => w());
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
  });

  it("keeps the month's spend across a restart, and refuses a damaged ledger", () => {
    let saved: LedgerState | null = null;
    const one = persistentLedger(null, (s) => (saved = structuredClone(s)));
    one.addSpend("2026-10", 3.5);
    one.addCount("2026-10", "device-0001");
    const two = persistentLedger(saved, () => {});
    expect(two.spent("2026-10")).toBe(3.5);
    expect(two.count("2026-10", "device-0001")).toBe(1);
    expect(() => persistentLedger({ month: 1 } as never, () => {})).toThrow(/not a ledger/);
  });
});
