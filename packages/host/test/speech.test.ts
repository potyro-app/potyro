// `ctx.caps.speech` mediation (docs/29): who gets it, the question asked once (and what it says),
// Not now, a listening's life — words so far, stop, the end, a failure's code — the language it
// listens in, and the bridge a sealed app's box hears through.

import { describe, expect, it } from "vitest";
import { FakeCapabilities, createFakeSpeech, type SpeechWhere } from "@potyro/capabilities";
import type { Caps, PermissionManifest, SpeechEngine } from "potyro";
import { SpeechBridge, englishSpeechConsent, mediateCaps, type BoxSpeechEvent, type UiBridge } from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(o: { trusted?: boolean; permissions?: PermissionManifest; answer?: boolean | (() => boolean); where?: SpeechWhere | null; remembered?: SpeechEngine[]; language?: string } = {}) {
  const fake = createFakeSpeech({ where: o.where });
  const asked: Array<{ msg: string; detail?: string }> = [];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async (msg, opts) => {
      asked.push({ msg, detail: opts?.detail });
      return typeof o.answer === "function" ? o.answer() : (o.answer ?? true);
    },
    prompt: async () => null,
    pick: async () => null,
  };
  const standing = new Set<SpeechEngine>(o.remembered ?? []);
  const cap = { ...fake.cap, allowed: (e: SpeechEngine) => standing.has(e), allow: (e: SpeechEngine) => void standing.add(e) };
  Object.defineProperty(cap, "listening", { get: () => fake.active });
  const platform = new FakeCapabilities({ speech: cap });
  const owner = {};
  const make = (): Caps =>
    mediateCaps({ caps: platform, provenance: o.trusted ? "trusted" : "untrusted", permissions: o.permissions ?? {}, ui, appName: "Pantry", owner, ai: { language: o.language ?? "en", image: async () => new Blob() } });
  return { caps: make(), again: make, fake, asked, standing };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return String((e as { code?: string }).code ?? `no code: ${(e as Error).message}`);
  }
}

describe("who gets ctx.caps.speech", () => {
  it("a sealed app only when its manifest asks; a trusted app always; none where the device cannot listen", () => {
    expect(setup().caps.speech).toBeUndefined();
    expect(setup({ permissions: { speech: true } }).caps.speech).toBeDefined();
    expect(setup({ trusted: true }).caps.speech).toBeDefined();
    expect(mediateCaps({ caps: new FakeCapabilities(), provenance: "trusted", permissions: {}, ui: setup().asked as never, appName: "x" }).speech).toBeUndefined();
  });
});

describe("the question", () => {
  it("a sealed app asks once, naming the app and the microphone; Allow is remembered for that way of listening", async () => {
    const s = setup({ permissions: { speech: true } });
    const a = await s.caps.speech!.listen();
    a.stop();
    const b = await s.again().speech!.listen();
    b.stop();
    expect(s.asked.map((q) => q.msg)).toEqual(["“Pantry” wants to listen to you through the microphone."]);
    expect(s.asked[0]!.detail).toMatch(/on this device/);
    expect([...s.standing]).toEqual(["device"]);
  });

  it("Not now refuses this listening with 'denied' and is asked again next time", async () => {
    let n = 0;
    const s = setup({ permissions: { speech: true }, answer: () => ++n > 1 });
    expect(await codeOf(s.caps.speech!.listen())).toBe("denied");
    expect(s.fake.listenings).toHaveLength(0);
    expect(await codeOf(s.caps.speech!.listen())).toBe("resolved");
    expect(s.asked).toHaveLength(2);
  });

  it("two listens at once ask one question", async () => {
    const s = setup({ permissions: { speech: true } });
    await Promise.all([s.caps.speech!.listen(), s.caps.speech!.listen()]);
    expect(s.asked).toHaveLength(1);
  });

  it("the person's own app is not asked on the device, but is when the recording would leave it", async () => {
    const local = setup({ trusted: true });
    await local.caps.speech!.listen();
    expect(local.asked).toEqual([]);
    const cloud = setup({ trusted: true, where: { engine: "cloud", service: "OpenRouter" } });
    await cloud.caps.speech!.listen();
    expect(cloud.asked.map((q) => q.msg)).toEqual(["“Pantry” wants to listen to you through the microphone."]);
    expect(cloud.asked[0]!.detail).toMatch(/AI service \(OpenRouter\).*leaves this device/);
  });

  it("yes on the device is not yes to a service", async () => {
    const s = setup({ permissions: { speech: true }, where: { engine: "browser", service: "Google" }, remembered: ["device"] });
    await s.caps.speech!.listen();
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]!.detail).toMatch(/Google’s servers/);
  });

  it("the English words name where it goes", () => {
    expect(englishSpeechConsent("Pantry", { engine: "browser" }).detail).toMatch(/its own speech service/);
    expect(englishSpeechConsent("Pantry", { engine: "cloud", service: "OpenRouter" }).message).toBe("“Pantry” wants to listen to you through the microphone.");
  });

  it("a device that cannot listen says 'unavailable'; a blocked microphone 'denied'", async () => {
    expect(await codeOf(setup({ trusted: true, where: null }).caps.speech!.listen())).toBe("unavailable");
    const s = setup({ trusted: true });
    s.fake.refuse("denied");
    expect(await codeOf(s.caps.speech!.listen())).toBe("denied");
  });
});

describe("a listening", () => {
  it("hears everything so far, ends with it on stop, and says its language and engine", async () => {
    const s = setup({ trusted: true, language: "pl" });
    const l = await s.caps.speech!.listen();
    expect([l.language, l.engine, l.listening]).toEqual(["pl-PL", "device", true]);
    expect(s.fake.listenings[0]!.opts).toMatchObject({ language: "pl-PL", interim: true, maxMs: 300_000 });
    const got: Array<[string, boolean]> = [];
    l.onText((t, f) => got.push([t, f]));
    s.fake.say("kup", false);
    s.fake.say("kup mleko");
    l.stop();
    expect(await l.result).toBe("kup mleko");
    expect(l.listening).toBe(false);
    expect(got).toEqual([
      ["kup", false],
      ["kup mleko", true],
    ]);
  });

  it("the app's language and interim are passed on; the cloud engine is held to a minute", async () => {
    const s = setup({ trusted: true, where: { engine: "cloud", service: "OpenRouter" } });
    await s.caps.speech!.listen({ language: "pt-br", interim: false });
    expect(s.fake.listenings[0]!.opts).toEqual({ language: "pt-BR", interim: false, maxMs: 60_000 });
  });

  it("an onText added late hears the newest words at once", async () => {
    const s = setup({ trusted: true });
    const l = await s.caps.speech!.listen();
    s.fake.say("hello");
    const got: string[] = [];
    l.onText((t) => got.push(t));
    await tick();
    expect(got).toEqual(["hello"]);
  });

  it("a failure rejects the result with its code; a pause resolves it", async () => {
    const s = setup({ trusted: true });
    const a = await s.caps.speech!.listen();
    s.fake.fail("offline", "You're offline");
    expect(await codeOf(a.result)).toBe("offline");
    const b = await s.caps.speech!.listen();
    s.fake.say("milk");
    s.fake.finish("silence");
    expect(await b.result).toBe("milk");
  });

  it("a new listening ends the last", async () => {
    const s = setup({ trusted: true });
    const a = await s.caps.speech!.listen();
    s.fake.say("first");
    await s.caps.speech!.listen();
    expect(await a.result).toBe("first");
  });
});

describe("SpeechBridge", () => {
  it("holds events until the box has the number, keeps only the newest text waiting, and ends with the result", async () => {
    const s = setup({ trusted: true });
    const got: BoxSpeechEvent[] = [];
    const gone: number[] = [];
    const bridge = new SpeechBridge((ev) => got.push(ev), (lid) => gone.push(lid));
    const info = await bridge.listen({ caps: s.caps } as never, { language: "de" });
    expect(info).toEqual({ lid: 1, language: "de-DE", engine: "device" });
    s.fake.say("ein", false);
    s.fake.say("ein Brot", false);
    expect(got).toEqual([]);
    bridge.ready(info.lid);
    expect(got).toEqual([{ lid: 1, kind: "text", text: "ein Brot", final: false }]);
    s.fake.say("ein Brot bitte");
    bridge.stop(info.lid);
    await tick();
    expect(got.slice(1)).toEqual([
      { lid: 1, kind: "text", text: "ein Brot bitte", final: true },
      { lid: 1, kind: "end", text: "ein Brot bitte" },
    ]);
    expect(gone).toEqual([1]);
    expect(bridge.size).toBe(0);
  });

  it("a box that goes away ends its listenings without keeping a recording", async () => {
    const s = setup({ trusted: true });
    const bridge = new SpeechBridge(() => {});
    await bridge.listen({ caps: s.caps } as never);
    bridge.endAll();
    expect(s.fake.listenings[0]!.ended?.why).toBe("left");
  });

  it("a ctx without speech is refused 'denied'", async () => {
    expect(await codeOf(new SpeechBridge(() => {}).listen({ caps: {} } as never))).toBe("denied");
  });
});
