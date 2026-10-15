// @vitest-environment happy-dom
//
// Who pays for an app's AI (docs/23): the free relay first, then the person's own OpenRouter key,
// else a refusal that says what to do. And the guards that run before anything leaves: offline, the
// app's off switch, and on the person's key a rate and a monthly cap. No request reaches a network:
// `fetch` is a script.

import { beforeEach, describe, expect, it } from "vitest";
import { AI_FORMAT, AI_MODEL, OPENROUTER_URL } from "@potyro/ai-relay";
import type { AiCall } from "@potyro/capabilities";
import { createAppAi, resetAiGuards, resetRelayMemory, OWN_KEY_PER_MINUTE, type AppAiDeps } from "../src/app-ai.js";
import { setAiStanding } from "../src/ai-setting.js";
import { spentIn } from "../src/ask-spend.js";

const RELAY = "https://apps.test/ai/complete";
const HEALTH = "https://apps.test/ai/health";
const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" });
const CALL: AiCall = { system: "Answer with JSON.", parts: [{ text: "A receipt." }, { image: PHOTO }], json: { type: "object" }, maxTokens: 4000 };

type Route = (init: RequestInit & { url: string }) => Response | Promise<Response>;

function setup(routes: { relay?: Route; openrouter?: Route; health?: Route }, over: Partial<AppAiDeps> = {}) {
  const seen: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetchFake = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, body: init.body ? JSON.parse(String(init.body)) : {}, headers: init.headers as Record<string, string> });
    const route = url === RELAY ? routes.relay : url === OPENROUTER_URL ? routes.openrouter : url === HEALTH ? routes.health : undefined;
    if (!route) throw new TypeError("Failed to fetch");
    return route({ ...init, url });
  }) as typeof fetch;
  const ai = createAppAi({
    appId: "receipts",
    ownKey: () => "",
    device: () => "device-0001",
    relay: RELAY,
    fetch: fetchFake,
    online: () => true,
    resize: async (b) => b,
    ...over,
  });
  return { ai, seen };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (): Response => new Response("<!doctype html><title>Potyro</title>", { status: 200, headers: { "content-type": "text/html" } });
const openRouterOk = (text: string, cost = 0.0004) => () => json(200, { choices: [{ message: { content: text } }], usage: { cost } });

beforeEach(() => {
  globalThis.localStorage.clear();
  resetAiGuards();
  resetRelayMemory();
});

describe("the free allowance first", () => {
  it("answers from the relay and never touches the person's key", async () => {
    const { ai, seen } = setup({ relay: () => json(200, { ok: true, text: '{"total":1}', left: 99 }) }, { ownKey: () => "sk-or-mine" });
    await expect(ai.complete(CALL)).resolves.toEqual({ text: '{"total":1}', via: "free" });
    expect(seen.map((s) => s.url)).toEqual([RELAY]);
    // The payload: the host's parts, the picture as a data URL, a device id — and no key anywhere.
    expect(seen[0]!.body).toEqual({
      format: AI_FORMAT,
      device: "device-0001",
      system: "Answer with JSON.",
      parts: [{ type: "text", text: "A receipt." }, { type: "image", data: "data:image/jpeg;base64,/9j/AQ==" }],
      json: { type: "object" },
      maxTokens: 4000,
    });
    expect(JSON.stringify(seen)).not.toContain("sk-or-mine");
    expect(spentIn("receipts", "ai")).toBe(0);
  });
});

describe("then the person's own key", () => {
  it("when the allowance is used up: OpenRouter with their key, and what it cost is added to the app's AI spend", async () => {
    const { ai, seen } = setup({ relay: () => json(429, { ok: false, error: "allowance", reason: "device-month" }), openrouter: openRouterOk('{"total":2}') }, { ownKey: () => "sk-or-mine" });
    await expect(ai.complete(CALL)).resolves.toEqual({ text: '{"total":2}', via: "own-key", cost: 0.0004 });
    expect(seen.map((s) => s.url)).toEqual([RELAY, OPENROUTER_URL]);
    expect(seen[1]!.headers.Authorization).toBe("Bearer sk-or-mine");
    expect(seen[1]!.body).toMatchObject({ model: AI_MODEL, provider: { data_collection: "deny", require_parameters: true } });
    expect(spentIn("receipts", "ai")).toBe(0.0004);
    expect(spentIn("receipts", "ask")).toBe(0); // Ask's total is its own
  });

  it("when there is no relay (a site answering with its own page): asked once, not again for a while", async () => {
    const { ai, seen } = setup({ relay: html, openrouter: openRouterOk("a") }, { ownKey: () => "sk-or-mine" });
    await ai.complete(CALL);
    await ai.complete(CALL);
    expect(seen.map((s) => s.url)).toEqual([RELAY, OPENROUTER_URL, OPENROUTER_URL]);
  });
});

describe("neither", () => {
  it("says plainly that free AI is not available yet when there is no relay and no key", async () => {
    const { ai } = setup({ relay: () => json(404, { ok: false }) });
    await expect(ai.complete(CALL)).rejects.toThrow("Free AI isn't available yet — add your own key in Model settings.");
  });

  it("says the month's free AI is used up when it is, and there is no key", async () => {
    const { ai } = setup({ relay: () => json(429, { ok: false, error: "allowance", reason: "service-month" }) });
    await expect(ai.complete(CALL)).rejects.toThrow("This month's free AI is used up — add your own OpenRouter key in Model settings.");
  });
});

describe("before anything is sent", () => {
  it("offline: refused at once, nothing sent, never hung", async () => {
    const { ai, seen } = setup({ relay: () => json(200, { ok: true, text: "x" }) }, { online: () => false });
    await expect(ai.complete(CALL)).rejects.toThrow(/You're offline/);
    expect(seen).toHaveLength(0);
  });

  it("turned off for this app: refused, nothing sent", async () => {
    setAiStanding("receipts", "off");
    const { ai, seen } = setup({ relay: () => json(200, { ok: true, text: "x" }) });
    await expect(ai.complete(CALL)).rejects.toThrow(/turned off for this app/);
    expect(seen).toHaveLength(0);
  });

  it("the person's key, past this app's monthly cap: refused before dispatch", async () => {
    const month = new Date().toISOString().slice(0, 7);
    globalThis.localStorage.setItem("potyro:ai-month:receipts", JSON.stringify({ month, usd: 1 }));
    const { ai, seen } = setup({ relay: html, openrouter: openRouterOk("x") }, { ownKey: () => "sk-or-mine" });
    await expect(ai.complete(CALL)).rejects.toThrow(/used \$1 of your OpenRouter credit on AI this month/);
    expect(seen.map((s) => s.url)).toEqual([RELAY]); // OpenRouter was never asked
  });

  it("the person's key, asked too often by one app: refused before dispatch", async () => {
    const { ai, seen } = setup({ relay: html, openrouter: openRouterOk("x", 0) }, { ownKey: () => "sk-or-mine" });
    for (let i = 0; i < OWN_KEY_PER_MINUTE; i++) await ai.complete(CALL);
    await expect(ai.complete(CALL)).rejects.toThrow(/asking the AI too often/);
    expect(seen.filter((s) => s.url === OPENROUTER_URL)).toHaveLength(OWN_KEY_PER_MINUTE);
  });
});

describe("when the service fails", () => {
  it("a refused key, an empty account and a slow answer each say what happened", async () => {
    const refused = setup({ relay: html, openrouter: () => json(401, { error: { message: "No auth" } }) }, { ownKey: () => "sk-bad" });
    await expect(refused.ai.complete(CALL)).rejects.toThrow("Your OpenRouter key was refused. Check it in Model settings.");
    resetRelayMemory();
    const broke = setup({ relay: html, openrouter: () => json(402, { error: { message: "Insufficient credits" } }) }, { ownKey: () => "sk-or-mine" });
    await expect(broke.ai.complete(CALL)).rejects.toThrow("Your OpenRouter account is out of credit.");
    resetRelayMemory();
    const never: Route = (init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const slow = setup({ relay: html, openrouter: never }, { ownKey: () => "sk-or-mine", timeoutMs: 20 });
    await expect(slow.ai.complete(CALL)).rejects.toThrow("The AI service took too long to answer. Try again.");
  });
});

describe("the consent words and the switch", () => {
  it("promise free AI only when the relay answers; else name the person's key, or say a key is needed", async () => {
    const answering = setup({ health: () => json(200, { ok: true }) });
    const free = await answering.ai.consentWords!("Receipt Split", "photo");
    expect(free.message).toBe("“Receipt Split” wants to send a photo to an AI service (OpenRouter) to read it.");
    expect(free.detail).toBe("Only what the app sends goes: this photo and its question — nothing else in the app. Free while this month's allowance lasts; then your own OpenRouter key, usually under 1¢.");
    expect(answering.seen.map((s) => s.url)).toEqual(["https://apps.test/ai/health"]); // a look, no AI request

    resetRelayMemory();
    const withKey = setup({ health: html }, { ownKey: () => "sk-or-mine" });
    const own = await withKey.ai.consentWords!("Receipt Split", "text");
    expect(own.detail).toBe("Only what the app sends goes: this text and its question — nothing else in the app. It uses your own OpenRouter key from Model settings, usually under 1¢ a request.");
    expect(own.detail).not.toMatch(/Free/);

    resetRelayMemory();
    const none = setup({});
    expect((await none.ai.consentWords!("Receipt Split", "photo")).detail).toMatch(/AI isn't available until you add your own OpenRouter key in Model settings\.$/);
  });

  it("remember what the relay last said: a used-up allowance is not promised as free", async () => {
    const { ai, seen } = setup({ relay: () => json(429, { ok: false, error: "allowance", reason: "device-month" }), openrouter: openRouterOk("x"), health: () => json(200, { ok: true }) }, { ownKey: () => "sk-or-mine" });
    await ai.complete(CALL);
    expect((await ai.consentWords!("Receipt Split", "photo")).detail).toMatch(/It uses your own OpenRouter key/);
    expect(seen.some((s) => s.url.endsWith("/health"))).toBe(false);
  });

  it("name the service and what goes; Allow is remembered per app", async () => {
    const { ai } = setup({});
    const w = await ai.consentWords!("Receipt Split", "photo");
    expect(w.detail).toMatch(/nothing else in the app/);
    expect(ai.standing!()).toBeUndefined();
    ai.allow!();
    expect(ai.standing!()).toBe("on");
    expect(globalThis.localStorage.getItem("potyro:ai:receipts")).toBe("on");
  });
});
