// @vitest-environment happy-dom
//
// Potyro's free engine (#121): the relay's refusals said as words that say what to do next, what is
// left said in words rather than cents, and the engine's own fetch — which reads both off the relay's
// answers. No request reaches a network: `fetch` is a script.

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, chatEngineOptions, engineLabel, engineLeft, engineReady } from "../src/engines.js";
import { resetRelayMemory } from "../src/app-ai.js";
import { backendFor } from "../src/model-turn.js";
import {
  FREE_CODES,
  FreeAiRefusal,
  checkFreeAi,
  freeFetch,
  freeNotNow,
  freeOffered,
  getFreeAi,
  isStop,
  leftOf,
  refusalText,
  reloadFreeAi,
  resetFreeAi,
  stoppedNow,
  type FreeCode,
} from "../src/free-ai.js";
import { CHAT_MESSAGES, NOT_ENOUGH_LEFT } from "../../ai-relay/src/chat.ts";

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const health = (body: unknown) => (async () => json(200, body)) as unknown as typeof fetch;
const HEALTH = "https://apps.test/ai/health";
const potyro = { ...DEFAULT_ENGINE_CONFIG, engine: "potyro" as const };
const refusal = (code: FreeCode, message = "the relay's words", left?: string) =>
  json(code === "off" ? 503 : 429, { error: { code, message, type: "potyro" } }, left === undefined ? {} : { "x-potyro-left-usd": left });

beforeEach(async () => {
  globalThis.localStorage.clear();
  resetRelayMemory();
  resetFreeAi();
});

describe("the relay's refusals, in words", () => {
  it("has a sentence for every code the relay refuses with, and no code the relay does not have", () => {
    expect([...FREE_CODES].sort()).toEqual(Object.keys(CHAT_MESSAGES).sort());
    for (const code of FREE_CODES) expect(refusalText(code).length).toBeGreaterThan(20);
  });

  it("says what to do next: a key, the gallery, later, or tomorrow", () => {
    expect(refusalText("allowance")).toBe("This month's free app making is used up on this device. Add your own key to keep going, or start from an app in the gallery.");
    expect(refusalText("off")).toBe("Free app making is paused right now. Add your own key, or try again later.");
    expect(refusalText("service-day")).toMatch(/back tomorrow/);
    expect(refusalText("service-month")).toMatch(/your own key/);
  });

  it("says this network's day in the shell's own words, never the relay's English", async () => {
    const send = freeFetch(async () => refusal("address-day", CHAT_MESSAGES["address-day"], "0"));
    await expect(send("x")).rejects.toThrow("Free app making is busy on this network today. It's back tomorrow, or add your own key.");
    expect(refusalText(stoppedNow()!.code)).toBe("Free app making is busy on this network today. It's back tomorrow, or add your own key.");
    // The code and the day, nothing of what the relay said.
    expect(JSON.parse(localStorage.getItem("potyro:free-ai-stop")!)).toEqual({ code: "address-day", until: new Date().toISOString().slice(0, 10) });
  });

  it("stops for the month, the day, or the pause — not for a busy device or a request it could not take", () => {
    expect(FREE_CODES.filter(isStop).sort()).toEqual(["address-day", "allowance", "off", "service-day", "service-month"]);
  });
});

describe("what is left, in words", () => {
  it("plenty from 10¢, a little from 2¢, used up under that (the relay's least hold for a request)", () => {
    expect([1, 0.5, 0.1].map(leftOf)).toEqual(["plenty", "plenty", "plenty"]);
    expect([0.0999, 0.05, 0.02].map(leftOf)).toEqual(["little", "little", "little"]);
    expect([0.0199, 0].map(leftOf)).toEqual(["none", "none"]);
  });
});

describe("the free engine", () => {
  it("is offered, and ready, only while the relay's /health says its chat route serves", async () => {
    expect(engineReady(potyro)).toBe(false);
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true }), online: () => true });
    expect(freeOffered()).toBe(false);
    expect(engineReady(potyro)).toBe(false);
    resetRelayMemory();
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true, model: "deepseek/deepseek-v4-pro-0813" }), online: () => true });
    expect(freeOffered()).toBe(true);
    expect(engineReady(potyro)).toBe(true);
  });

  it("is the chat engine pointed at the relay, with this device's random id as its key and the model the relay named", async () => {
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true, model: "deepseek/deepseek-v4-pro-0813" }), online: () => true });
    const options = chatEngineOptions(potyro)!;
    expect(options.baseUrl).toMatch(/\/ai\/v1$/);
    expect(options.model).toBe("deepseek/deepseek-v4-pro-0813");
    expect(typeof options.apiKey === "function" ? await options.apiKey() : options.apiKey).toMatch(/^potyro-device:[A-Za-z0-9_-]{8,100}$/);
    expect(options.reasoning).toEqual({ effort: "none" });
  });

  it("answers a one-turn change and a repair too, not only the loops", async () => {
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    const backend = await backendFor(potyro);
    expect(backend.name).toBe("openrouter:deepseek/deepseek-v4-flash-0731+reasoning=none");
  });

  it("reads what is left off each answer, and names it on the engine", async () => {
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    expect(engineLabel(potyro)).toBe("Potyro");
    expect(engineLeft(potyro)).toBe("");
    const send = freeFetch(async () => json(200, { choices: [] }, { "x-potyro-left-usd": "0.42" }));
    await send("https://apps.test/ai/v1/chat/completions");
    expect(getFreeAi().left).toBe("plenty");
    expect(engineLeft(potyro)).toBe(" · plenty left this month");
    expect(engineLeft({ ...potyro, engine: "openrouter" })).toBe("");
    await freeFetch(async () => json(200, { choices: [] }, { "x-potyro-left-usd": "0.05" }))("x");
    expect(engineLeft(potyro)).toBe(" · a little left this month");
  });

  it("turns a used-up month into a refusal in words, kept for the month, and the engine stops being ready", async () => {
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    const send = freeFetch(async () => refusal("allowance", "This month's free AI on this device is used up.", "0"));
    await expect(send("x")).rejects.toThrow(FreeAiRefusal);
    await expect(send("x")).rejects.toThrow(/^This month's free app making is used up on this device/);
    expect(stoppedNow()?.code).toBe("allowance");
    expect(engineReady(potyro)).toBe(false);
    expect(engineLeft(potyro)).toBe(" · used up this month");
    // Kept on this device for the month (the month and the code, nothing else).
    expect(JSON.parse(localStorage.getItem("potyro:free-ai-stop")!)).toEqual({ code: "allowance", until: new Date().toISOString().slice(0, 7) });
  });

  it("a new page knows this month is used up; once the month is over it is ready again", async () => {
    localStorage.setItem("potyro:free-ai-stop", JSON.stringify({ code: "allowance", until: new Date().toISOString().slice(0, 7) }));
    reloadFreeAi();
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    expect(stoppedNow()?.code).toBe("allowance");
    expect(engineReady(potyro)).toBe(false);
    localStorage.setItem("potyro:free-ai-stop", JSON.stringify({ code: "allowance", until: "2020-01" }));
    reloadFreeAi();
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    expect(stoppedNow()).toBeNull();
    expect(engineReady(potyro)).toBe(true);
  });

  it("an allowance refusal with more than the least hold left is this request too big, not a used-up month", async () => {
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    const send = freeFetch(async () => refusal("allowance", NOT_ENOUGH_LEFT, "0.31"));
    await expect(send("x")).rejects.toThrow("This conversation is too long for the free allowance. Start a new app, or add your own key.");
    // Nothing kept, nothing stopped: a shorter request may still go, and what is left is as the relay said.
    expect(stoppedNow()).toBeNull();
    expect(localStorage.getItem("potyro:free-ai-stop")).toBeNull();
    expect(getFreeAi().left).toBe("plenty");
    expect(engineReady(potyro)).toBe(true);
    // No header at all: not known to be used up either.
    await expect(freeFetch(async () => refusal("allowance", NOT_ENOUGH_LEFT))("x")).rejects.toThrow(/too long for the free allowance/);
    expect(stoppedNow()).toBeNull();
    // Under the least hold ($0.02): used up for the month.
    await expect(freeFetch(async () => refusal("allowance", CHAT_MESSAGES.allowance, "0.015"))("x")).rejects.toThrow(/^This month's free app making is used up/);
    expect(stoppedNow()?.code).toBe("allowance");
  });

  it("a day's stop is over at the day's end, a month's at the month's end", async () => {
    let now = Date.parse("2026-10-30T23:00:00Z");
    resetFreeAi(() => now);
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true });
    for (const code of ["service-day", "address-day"] as const) {
      now = Date.parse("2026-10-30T23:00:00Z");
      await expect(freeFetch(async () => refusal(code, "x", "0"))("x")).rejects.toThrow(FreeAiRefusal);
      expect(stoppedNow()?.code).toBe(code);
      now = Date.parse("2026-10-31T00:00:01Z");
      expect(stoppedNow()).toBeNull();
      expect(engineReady(potyro)).toBe(true);
    }
    now = Date.parse("2026-10-30T23:00:00Z");
    await expect(freeFetch(async () => refusal("service-month", "x", "0"))("x")).rejects.toThrow(FreeAiRefusal);
    now = Date.parse("2026-10-31T12:00:00Z");
    expect(stoppedNow()?.code).toBe("service-month");
    now = Date.parse("2026-11-01T00:00:01Z");
    expect(stoppedNow()).toBeNull();
  });

  it("no answer from /health is unknown, not 'no free route', and is asked again after a minute", async () => {
    let now = 1_000_000;
    let asked = 0;
    const down = (async () => {
      asked++;
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await checkFreeAi({ url: HEALTH, fetch: down, online: () => true, now: () => now });
    expect(getFreeAi().health).toMatchObject({ ok: false, chat: false, unknown: true });
    expect(freeNotNow()).toBe("Free app making can't be reached right now. Check your connection and try again, or add your own key.");
    now += 30_000;
    await checkFreeAi({ url: HEALTH, fetch: down, online: () => true, now: () => now });
    expect(asked).toBe(1);
    now += 31_000;
    await checkFreeAi({ url: HEALTH, fetch: health({ ok: true, chat: true }), online: () => true, now: () => now });
    expect(freeOffered()).toBe(true);
    // Offline: unknown, and not remembered at all.
    resetRelayMemory();
    await checkFreeAi({ url: HEALTH, fetch: down, online: () => false, now: () => now });
    expect(getFreeAi().health?.unknown).toBe(true);
  });

  it("a pause is for this page, and makes /health be asked again", async () => {
    let asked = 0;
    const look = (async () => (asked++, json(200, { ok: true, chat: asked === 1 }))) as unknown as typeof fetch;
    await checkFreeAi({ url: HEALTH, fetch: look, online: () => true });
    await expect(freeFetch(async () => refusal("off"))("x")).rejects.toThrow("Free app making is paused right now. Add your own key, or try again later.");
    expect(stoppedNow()?.code).toBe("off");
    expect(localStorage.getItem("potyro:free-ai-stop")).toBeNull();
    await checkFreeAi({ url: HEALTH, fetch: look, online: () => true });
    expect(asked).toBe(2);
    expect(freeOffered()).toBe(false);
  });

  it("passes on an answer that is not the relay's refusal, as it is", async () => {
    const upstream = json(400, { error: { message: "Reasoning is mandatory", code: 400 } });
    expect((await freeFetch(async () => upstream)("x")).status).toBe(400);
  });
});
