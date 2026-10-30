// `ctx.caps.ai` (docs/23), host side: a shape is checked, a request carries only what the call named,
// an answer reaches the app only once it fits, and the person is asked before a sealed app's first
// request. The model is a script (`FakeAi`); nothing here touches a network.

import { describe, expect, it } from "vitest";
import { FakeAi, FakeCapabilities, type AiCap } from "@potyro/capabilities";
import type { AiCapability, PermissionManifest } from "potyro";
import { AiError, checkShape, fitShape, jsonSchemaFor, mediateCaps, numberIn, parseJsonReply, type UiBridge } from "../src/index.js";

const RECEIPT = {
  shop: "text?",
  date: "date?",
  items: [{ name: "text", price: "number", kind: { oneOf: ["food", "drink", "other"] } }],
} as const;

const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" });

function setup(opts: { provenance?: "trusted" | "untrusted"; permissions?: PermissionManifest; answer?: boolean; ai?: AiCap; replies?: Array<string | Error> } = {}) {
  const asked: Array<{ message: string; detail?: string; privacy?: string }> = [];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async (message, o) => (asked.push({ message, detail: o?.detail, ...(o?.privacy ? { privacy: o.privacy } : {}) }), opts.answer ?? true),
    prompt: async () => null,
    pick: async () => null,
  };
  const ai = opts.ai ?? new FakeAi(opts.replies ?? [], { language: "pl" });
  const caps = new FakeCapabilities({ ai });
  const mediated = mediateCaps({ caps, provenance: opts.provenance ?? "untrusted", permissions: opts.permissions ?? { ai: true }, ui, appName: "Receipt Split" });
  return { asked, ai: ai as FakeAi, mediated };
}

const good = JSON.stringify({ shop: "Żabka", date: "2026-10-14", items: [{ name: "Mleko 2%", price: 4.99, kind: "food" }] });

describe("the shape", () => {
  it("accepts the documented forms and refuses anything else, naming where", () => {
    expect(() => checkShape(RECEIPT)).not.toThrow();
    expect(() => checkShape("number?")).not.toThrow();
    expect(() => checkShape([{ oneOf: ["a"], optional: true }])).not.toThrow();
    expect(() => checkShape({ items: [{ price: "money" }] })).toThrow(/schema\.items\[0\]\.price is "money"/);
    expect(() => checkShape({ items: ["text", "number"] })).toThrow(/exactly one shape/);
    expect(() => checkShape({ kind: { oneOf: [] } })).toThrow(/oneOf must list/);
    expect(() => checkShape({})).toThrow(/no keys/);
    expect(() => checkShape(undefined)).toThrow(/must be a shape/);
  });

  it("becomes a strict JSON Schema with an object at its root", () => {
    expect(jsonSchemaFor(RECEIPT).schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["shop", "date", "items"],
      properties: {
        shop: { type: ["string", "null"] },
        date: { type: ["string", "null"], description: "a date, YYYY-MM-DD" },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "price", "kind"],
            properties: { name: { type: "string" }, price: { type: "number" }, kind: { type: "string", enum: ["food", "drink", "other"] } },
          },
        },
      },
    });
    const list = jsonSchemaFor([{ name: "text" }]);
    expect(list.wrapped).toBe(true);
    expect((list.schema.properties as Record<string, unknown>).value).toMatchObject({ type: "array" });
  });

  it("fits what models really send: numbers in strings, another case, empty optionals, a missing list, extra keys", () => {
    const fit = fitShape({ shop: "", date: "2026-10-14T10:00:00Z", items: [{ name: 12, price: "12,50 zł", kind: "Food", note: "x" }], extra: 1 }, RECEIPT);
    expect(fit).toEqual({ ok: true, value: { shop: null, date: "2026-10-14", items: [{ name: "12", price: 12.5, kind: "food" }] } });
    expect(fitShape({ shop: null, date: null }, RECEIPT)).toEqual({ ok: true, value: { shop: null, date: null, items: [] } });
  });

  it("says what does not fit", () => {
    const fit = fitShape({ shop: "A", date: "14.10.2026", items: [{ name: "Milk", price: "a lot", kind: "toys" }] }, RECEIPT);
    expect(fit.ok).toBe(false);
    expect(!fit.ok && fit.problems).toEqual([
      expect.stringMatching(/answer\.date must be a date/),
      expect.stringMatching(/answer\.items\[0\]\.price must be a number/),
      expect.stringMatching(/answer\.items\[0\]\.kind must be one of food, drink, other/),
    ]);
  });

  it("reads numbers the way receipts write them", () => {
    expect(numberIn("12,50")).toBe(12.5);
    expect(numberIn("€ 1.234,50")).toBe(1234.5);
    expect(numberIn("1,234.50")).toBe(1234.5);
    expect(numberIn("1.234.567")).toBe(1234567);
    expect(numberIn("-3 zł")).toBe(-3);
    expect(numberIn("12 of 20")).toBeNull();
  });

  it("finds the JSON in a fenced or chatty reply", () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonReply('Here you go: {"a":1} — enjoy')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonReply("no json at all").ok).toBe(false);
  });
});

describe("ctx.caps.ai.extract", () => {
  it("returns the answer as the shape, and sends only what the call named", async () => {
    const { mediated, ai } = setup({ replies: [good] });
    const out = await mediated.ai!.extract({ schema: RECEIPT, image: PHOTO, instructions: "A shop receipt." });
    expect(out).toEqual({ shop: "Żabka", date: "2026-10-14", items: [{ name: "Mleko 2%", price: 4.99, kind: "food" }] });
    // Typed from the shape: this line is a compile-time check as much as a runtime one.
    const price: number = out.items[0]!.price;
    expect(price).toBe(4.99);

    const call = ai.calls[0]!;
    expect(call.parts).toEqual([{ text: "What this is, from the app: A shop receipt." }, { image: PHOTO }]);
    expect(call.json).toEqual(jsonSchemaFor(RECEIPT).schema);
    // The person's language, by name: words the model writes itself are in it.
    expect(call.system).toContain("in Polish");
  });

  it("asks once more with what was wrong, and takes the second answer when it fits", async () => {
    const { mediated, ai } = setup({ replies: ['{"shop":"A","date":"yesterday","items":[]}', good] });
    await expect(mediated.ai!.extract({ schema: RECEIPT, image: PHOTO })).resolves.toMatchObject({ shop: "Żabka" });
    expect(ai.calls).toHaveLength(2);
    expect(JSON.stringify(ai.calls[1]!.parts)).toContain("answer.date must be a date");
  });

  it("throws, without the bad value, when the second answer does not fit either", async () => {
    const { mediated, ai } = setup({ replies: ["not json", '{"items":[{"name":"x","price":"lots","kind":"food"}]}'] });
    const err = await mediated.ai!.extract({ schema: RECEIPT, image: PHOTO }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("mismatch");
    expect((err as Error).message).toMatch(/did not fit what this app asked for/);
    expect(ai.calls).toHaveLength(2); // and no third: twice wrong is a photo it cannot read
  });

  it("wraps a list or a leaf shape and unwraps the answer", async () => {
    const { mediated } = setup({ replies: ['{"value":[{"name":"Tea"}]}'] });
    await expect(mediated.ai!.extract({ schema: [{ name: "text" }], text: "Tea" })).resolves.toEqual([{ name: "Tea" }]);
  });

  it("refuses an app's mistakes before anything is sent", async () => {
    const { mediated, ai } = setup({ replies: [good] });
    await expect(mediated.ai!.extract({ schema: RECEIPT })).rejects.toThrow(/needs an image or a text/);
    await expect(mediated.ai!.extract({ schema: { a: "money" } as never, text: "x" })).rejects.toThrow(/"money"/);
    await expect(mediated.ai!.extract({ schema: RECEIPT, text: "x".repeat(20_001) })).rejects.toThrow(/at most 20000/);
    await expect(mediated.ai!.extract({ schema: RECEIPT, image: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO] })).rejects.toThrow(/at most 4 images/);
    await expect(mediated.ai!.extract({ schema: RECEIPT, image: new Blob(["<html>"], { type: "text/html" }) })).rejects.toThrow(/must be a picture/);
    expect(ai.calls).toHaveLength(0);
  });

  it("passes the service's refusal on in its own words: offline, used up, no key", async () => {
    const { mediated } = setup({ replies: [new Error("You're offline. AI needs the internet — try again when you're connected.")] });
    await expect(mediated.ai!.extract({ schema: RECEIPT, image: PHOTO })).rejects.toThrow(/You're offline/);
    const used = setup({ replies: [new Error("This month's free AI is used up — add your own OpenRouter key in Model settings.")] });
    await expect(used.mediated.ai!.ask("hi")).rejects.toThrow(/used up/);
  });
});

describe("ctx.caps.ai.ask", () => {
  it("answers in words, with the app's instructions and the picture", async () => {
    const { mediated, ai } = setup({ replies: ["  Overwatered. Let it dry.  "] });
    await expect(mediated.ai!.ask("What is wrong with this plant?", { image: PHOTO, instructions: "Two sentences." })).resolves.toBe("Overwatered. Let it dry.");
    expect(ai.calls[0]!.json).toBeUndefined();
    expect(ai.calls[0]!.system).toContain("Two sentences.");
    expect(ai.calls[0]!.parts).toEqual([{ text: "What is wrong with this plant?" }, { image: PHOTO }]);
  });
});

describe("who may use it", () => {
  it("a sealed app that did not declare it has no ctx.caps.ai at all", () => {
    expect(setup({ permissions: {} }).mediated.ai).toBeUndefined();
  });

  it("a device with no AI gives no app ctx.caps.ai", () => {
    const caps = new FakeCapabilities();
    const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    expect(mediateCaps({ caps, provenance: "trusted", permissions: {}, ui, appName: "Mine" }).ai).toBeUndefined();
  });

  it("asks a sealed app's person first, naming the service and what goes, and remembers a yes", async () => {
    const { mediated, asked, ai } = setup({ replies: [good, good] });
    await mediated.ai!.extract({ schema: RECEIPT, image: PHOTO });
    await mediated.ai!.extract({ schema: RECEIPT, image: PHOTO });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.message).toBe("“Receipt Split” wants to send a photo to an AI service (FakeAI) to read it.");
    expect(asked[0]!.detail).toMatch(/nothing else in the app/);
    expect(ai.standing()).toBe("on");
    // The next ctx (a new pass) does not ask again: the yes is the shell's to keep, per app.
    const again = mediateCaps({ caps: new FakeCapabilities({ ai }), provenance: "untrusted", permissions: { ai: true }, ui: { toast: () => {}, confirm: async () => (asked.push({ message: "again" }), true), prompt: async () => null, pick: async () => null }, appName: "Receipt Split" });
    await expect(again.ai!.ask("x")).rejects.toThrow(/no reply scripted/); // it went straight to the service
    expect(asked).toHaveLength(1);
  });

  it("a no sends nothing, is not remembered, and is asked again next time", async () => {
    const { mediated, asked, ai } = setup({ answer: false, replies: [good] });
    await expect(mediated.ai!.extract({ schema: RECEIPT, text: "Milk 4.99" })).rejects.toThrow(/Permission denied/);
    await expect(mediated.ai!.extract({ schema: RECEIPT, text: "Milk 4.99" })).rejects.toThrow(/Permission denied/);
    expect(asked).toHaveLength(2);
    expect(asked[0]!.message).toMatch(/send some text/);
    expect(ai.calls).toHaveLength(0);
    expect(ai.standing()).toBeUndefined();
  });

  it("the platform's words may link the privacy page's AI section; the fallback links nothing (#117)", async () => {
    const plain = setup({ replies: ["a"] });
    await plain.mediated.ai!.ask("one");
    expect(plain.asked[0]!.privacy).toBeUndefined();
    const ai = Object.assign(new FakeAi(["a"]), {
      consentWords: () => ({ message: "May it?", detail: "Only this.", ok: "Allow", cancel: "Not now", privacy: "ai" as const }),
    });
    const linked = setup({ ai });
    await linked.mediated.ai!.ask("one");
    expect(linked.asked).toEqual([{ message: "May it?", detail: "Only this.", privacy: "ai" }]);
  });

  it("two calls at once ask one question", async () => {
    const { mediated, asked } = setup({ replies: ["a", "b"] });
    await Promise.all([mediated.ai!.ask("one"), mediated.ai!.ask("two")]);
    expect(asked).toHaveLength(1);
  });

  it("the off switch refuses every app, trusted too, before anything is sent", async () => {
    for (const provenance of ["trusted", "untrusted"] as const) {
      const ai = new FakeAi([good], { standing: "off" });
      const { mediated, asked } = setup({ provenance, ai });
      const err = await mediated.ai!.ask("hi").catch((e: unknown) => e);
      expect((err as AiError).code).toBe("off");
      expect((err as Error).message).toMatch(/turned off for this app/);
      expect(ai.calls).toHaveLength(0);
      expect(asked).toHaveLength(0);
    }
  });

  it("a trusted app is not asked, and its first use shows the switch", async () => {
    const { mediated, asked, ai } = setup({ provenance: "trusted", permissions: {}, replies: ["ok"] });
    await (mediated.ai as AiCapability).ask("hi");
    expect(asked).toHaveLength(0);
    expect(ai.standing()).toBe("on");
  });
});
