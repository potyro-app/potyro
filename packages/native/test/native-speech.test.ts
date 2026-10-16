// The JS half of the Android app's voice input (docs/29 §2): the recognizer plugin's events become a
// listening's, on the device when the plugin says so, a refusal keeps its code, and the WebView's own
// speech (with the cloud fallback) is used where the plugin cannot.

import { describe, expect, it } from "vitest";
import { createFakeSpeech, type PlatformSpeechEvents } from "@potyro/capabilities";
import { speechOverPlugin, type SpeechPlugin } from "../src/native-speech.js";

type Listener = (e: never) => void;

function fakePlugin(o: { available?: boolean; onDevice?: boolean; refuse?: string } = {}) {
  const listeners: Record<string, Listener[]> = { partial: [], final: [], end: [] };
  const calls: string[] = [];
  const emit = (event: "partial" | "final" | "end", e: unknown) => listeners[event]!.forEach((l) => l(e as never));
  const plugin: SpeechPlugin = {
    async available() {
      return { available: o.available ?? true, onDevice: o.onDevice ?? true };
    },
    async start(s) {
      calls.push(`start ${s.language} ${s.partial} ${s.maxMs}`);
      if (o.refuse) throw Object.assign(new Error("no"), { code: o.refuse });
    },
    async stop() {
      calls.push("stop");
      emit("end", {});
    },
    async cancel() {
      calls.push("cancel");
      emit("end", {});
    },
    addListener(event: "partial" | "final" | "end", fn: Listener) {
      listeners[event]!.push(fn);
      return { remove() {} };
    },
  } as SpeechPlugin;
  return { plugin, emit, calls };
}

function events() {
  const texts: Array<[string, boolean]> = [];
  const ends: unknown[] = [];
  const ev: PlatformSpeechEvents = { onText: (t, f) => texts.push([t, f]), onEnd: (e) => ends.push(e) };
  return { ev, texts, ends };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("speechOverPlugin", () => {
  it("says on the device when the recognizer is, Google's service when it is not", async () => {
    expect(await speechOverPlugin(fakePlugin().plugin, null).where("pl-PL")).toEqual({ engine: "device" });
    expect(await speechOverPlugin(fakePlugin({ onDevice: false }).plugin, null).where("pl-PL")).toEqual({ engine: "browser", service: "Google" });
  });

  it("streams partials and finals, and ends with the finals on stop", async () => {
    const f = fakePlugin();
    const cap = speechOverPlugin(f.plugin, null);
    const e = events();
    const l = await cap.listen({ language: "pt-BR", interim: true, maxMs: 1000 }, e.ev);
    expect(cap.listening).toBe(true);
    f.emit("partial", { text: "uma lista" });
    f.emit("final", { text: "uma lista de compras" });
    l.stop();
    await tick();
    expect(f.calls).toEqual(["start pt-BR true 1000", "stop"]);
    expect(e.texts).toEqual([
      ["uma lista", false],
      ["uma lista de compras", true],
    ]);
    expect(e.ends).toEqual([{ why: "app", text: "uma lista de compras" }]);
    expect(cap.listening).toBe(false);
  });

  it("a recognizer error ends it with its code; a refusal to start keeps its code", async () => {
    const f = fakePlugin();
    const e = events();
    await speechOverPlugin(f.plugin, null).listen({ language: "en-US", interim: true }, e.ev);
    f.emit("end", { code: "offline", message: "network" });
    expect(e.ends).toEqual([{ why: "failed", text: "", code: "offline", message: "network" }]);
    await expect(speechOverPlugin(fakePlugin({ refuse: "denied" }).plugin, null).listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "denied" });
  });

  it("leaving cancels, keeping nothing", async () => {
    const f = fakePlugin();
    const cap = speechOverPlugin(f.plugin, null);
    const e = events();
    await cap.listen({ language: "en-US", interim: true }, e.ev);
    f.emit("partial", { text: "half" });
    cap.stopAll("left");
    await tick();
    expect(f.calls.at(-1)).toBe("cancel");
    expect(e.ends).toEqual([{ why: "left", text: "" }]);
  });

  it("falls back to the WebView's speech (and its cloud engine) where the plugin cannot", async () => {
    const web = createFakeSpeech({ where: null });
    const cap = speechOverPlugin(fakePlugin({ available: false }).plugin, web.cap);
    expect(await cap.where("en-US")).toBeNull();
    const withCloud = cap.withTranscriber!({ service: "OpenRouter", transcribe: async () => "" });
    expect(await withCloud.where("en-US")).toEqual({ engine: "cloud", service: "OpenRouter" });
    await withCloud.listen({ language: "en-US", interim: true }, events().ev);
    expect(web.listenings).toHaveLength(1);
  });
});
