import { describe, expect, it } from "vitest";
import {
  NEEDS_PLATFORM,
  appStructure,
  platformLineIn,
  platformOffer,
  platformSignal,
  readPlatformRequest,
  writePlatformRequest,
} from "../src/agent/platform-request.js";
import type { ChatEngine, ChatRequest } from "../src/chat-backend.js";

// #263: what the person asked for that Potyro itself does not offer yet, written as a request to the
// Potyro team. The HARNESS decides when to offer the marker (docs/19 F5, F7); one last call with the
// tools off writes it in plain words (the opencode pattern).

describe("platformSignal: a failure that names something Potyro lacks", () => {
  it("a lookup that found nothing", () => {
    expect(platformSignal('Nothing in the potyro module is called "bluetooth" or declares a "bluetooth". It does not exist.')).toMatch(/bluetooth/);
  });
  it("a library that needs a full web page (the sealed box)", () => {
    expect(platformSignal("The result does not compile: maplibre-gl 4.7.1 needs a full web page to work")).toMatch(/full web page/);
  });
  it("a ctx member that is not there when it runs", () => {
    expect(platformSignal("TypeError: ctx.caps.barcode is not a function")).toMatch(/ctx\.caps\.barcode/);
    expect(platformSignal("Error: ctx.files is not available here")).toMatch(/ctx\.files/);
  });
  it("an ordinary failure is not one", () => {
    expect(platformSignal("The result failed validation:\n- pages.0.view.entity: unknown entity \"plnt\"")).toBeNull();
    expect(platformSignal("TypeError: r.name.toUpperCase is not a function")).toBeNull();
  });
});

describe("the offer", () => {
  it("names the marker, partial work, and what not to do", () => {
    const offer = platformOffer('nothing in Potyro is called "bluetooth"');
    expect(offer).toContain(NEEDS_PLATFORM);
    expect(offer).toContain("bluetooth");
    expect(offer).toMatch(/Not done:/);
    expect(offer).toMatch(/what the app CAN do|can be done/i);
  });
});

describe("platformLineIn", () => {
  it("finds the marker at the start of a line of the prose", () => {
    expect(platformLineIn("Added the field.\nNEEDS-PLATFORM: reading a barcode with the camera\n")).toBe("reading a barcode with the camera");
    expect(platformLineIn("**NEEDS-PLATFORM:** a heart-rate strap")).toBe("a heart-rate strap");
  });
  it("not a mention inside a sentence", () => {
    expect(platformLineIn("I considered NEEDS-PLATFORM: but no.")).toBeNull();
    expect(platformLineIn("nothing here")).toBeNull();
  });
});

describe("readPlatformRequest", () => {
  it("reads a title line and a body", () => {
    expect(readPlatformRequest("TITLE: Scan a barcode\nI wanted to scan the barcode on a plant pot.\nThe app would fill in the name.", "seed")).toEqual({
      title: "Scan a barcode",
      body: "I wanted to scan the barcode on a plant pot.\nThe app would fill in the name.",
    });
  });
  it("falls back to the model's own words when the format is missing", () => {
    const r = readPlatformRequest("", "reading a barcode with the camera, so the name fills itself in");
    expect(r.title.length).toBeLessThanOrEqual(80);
    expect(r.body).toContain("reading a barcode");
  });
  it("drops code fences: a request is words", () => {
    const r = readPlatformRequest("TITLE: X\nWords.\n```ts\nctx.caps.ble()\n```", "seed");
    expect(r.body).not.toContain("```");
  });
});

describe("writePlatformRequest: one last call, tools off", () => {
  it("asks with tool_choice none, in the person's language, and reads the answer", async () => {
    const seen: ChatRequest[] = [];
    const engine: ChatEngine = {
      chat: { completions: { create: async (req) => (seen.push(req), { choices: [{ message: { content: "TITLE: Leer códigos\nQuería escanear." } }] }) } },
    };
    const r = await writePlatformRequest({ engine, messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], seed: "scan a barcode", language: "es" });
    expect(r).toEqual({ title: "Leer códigos", body: "Quería escanear." });
    expect(seen[0]!.tool_choice).toBe("none");
    expect(seen[0]!.messages.at(-1)!.content).toContain("Spanish");
    expect(seen[0]!.messages.at(-1)!.content).toMatch(/no code/i);
  });
  it("keeps the model's own words when the call fails", async () => {
    const engine: ChatEngine = { chat: { completions: { create: async () => Promise.reject(new Error("down")) } } };
    const r = await writePlatformRequest({ engine, messages: [], seed: "scan a barcode" });
    expect(r.body).toContain("scan a barcode");
  });
});

describe("appStructure: what is sent beside the request", () => {
  it("is the declaration, with functions and code as markers and nothing else", async () => {
    const src = [
      'import { defineApp } from "potyro";',
      "const secret = 'abc';",
      "export default defineApp({",
      '  id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1,',
      '  entities: { plant: { label: "Plant", fields: { name: { type: "text" } }, computed: { due: (p) => p.name + secret } } },',
      '  pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant", filter: (p, ctx) => true } }],',
      "});",
    ].join("\n");
    const s = await appStructure(src);
    expect(s).toContain('"plant"');
    expect(s).toContain("(a function)");
    expect(s).not.toContain("secret");
    expect(s).not.toContain("p.name");
    expect(JSON.parse(s).entities.plant.fields.name.type).toBe("text");
  });
  it("is empty for something that is not an app", async () => {
    expect(await appStructure("not an app")).toBe("");
  });
});
