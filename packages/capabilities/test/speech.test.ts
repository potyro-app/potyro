// Voice input's platform half (docs/29): which engine each environment gets, the browser's
// recognizer and the record-then-write-down fallback driven through fakes, one listening a page,
// the language a listening uses, and the WAV the fallback sends.

import { describe, expect, it, vi } from "vitest";
import {
  browserService,
  createFakeSpeech,
  createWebSpeech,
  encodeWav,
  joinPieces,
  mayAskLocal,
  pickEngine,
  speechLanguage,
  type PlatformSpeechEvents,
  type Recognition,
  type RecognitionCtor,
} from "../src/index.js";

const CHROME = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", vendor: "Google Inc." };
const EDGE = { userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0", vendor: "Google Inc." };
const SAFARI = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", vendor: "Apple Computer, Inc." };
const FIREFOX = { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", vendor: "" };

/** A recognizer the test speaks through. */
function fakeRecognition(o: { local?: "available" | "unavailable"; failStart?: string } = {}) {
  const made: FakeRec[] = [];
  class FakeRec implements Recognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    processLocally?: boolean;
    onstart: (() => void) | null = null;
    onresult: Recognition["onresult"] = null;
    onerror: Recognition["onerror"] = null;
    onend: (() => void) | null = null;
    results: Array<{ isFinal: boolean; t: string }> = [];
    stopped = false;
    constructor() {
      made.push(this);
    }
    start() {
      queueMicrotask(() => {
        if (o.failStart) {
          this.onerror?.({ error: o.failStart });
          this.onend?.();
          return;
        }
        this.onstart?.();
      });
    }
    stop() {
      this.stopped = true;
      queueMicrotask(() => this.onend?.());
    }
    abort() {
      this.stopped = true;
    }
    hear(t: string, isFinal: boolean) {
      const last = this.results[this.results.length - 1];
      if (last && !last.isFinal) this.results[this.results.length - 1] = { isFinal, t };
      else this.results.push({ isFinal, t });
      const results = Object.assign(
        this.results.map((r) => Object.assign([{ transcript: r.t }], { isFinal: r.isFinal })),
        {},
      );
      this.onresult?.({ results });
    }
  }
  const Ctor = FakeRec as unknown as RecognitionCtor & { prototype: FakeRec };
  if (o.local) (Ctor as { available?: RecognitionCtor["available"] }).available = async () => o.local!;
  return { Ctor, made };
}

function recorder() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  let instance: { ondataavailable: ((e: BlobEvent) => void) | null; onstop: (() => void) | null; state: string } | null = null;
  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/ogg";
    ondataavailable: ((e: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() {
      instance = this;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["opus"], { type: "audio/ogg" }) } as BlobEvent);
      this.onstop?.();
    }
  }
  return { stream, tracks, Recorder: FakeRecorder as unknown as typeof MediaRecorder, get instance() { return instance; } };
}

function events() {
  const texts: Array<[string, boolean]> = [];
  const ends: Array<Parameters<PlatformSpeechEvents["onEnd"]>[0]> = [];
  let working = 0;
  const ev: PlatformSpeechEvents = {
    onText: (t, f) => texts.push([t, f]),
    onWorking: () => void (working += 1),
    onEnd: (e) => ends.push(e),
  };
  return { ev, texts, ends, get working() { return working; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("speechLanguage", () => {
  it("keeps a tag with a region, normalising its case", () => {
    expect(speechLanguage("pt-br", "en")).toBe("pt-BR");
    expect(speechLanguage("en-GB", "pl")).toBe("en-GB");
  });
  it("gives a bare language the browser's region for it, else the usual one", () => {
    expect(speechLanguage(undefined, "pl")).toBe("pl-PL");
    expect(speechLanguage(undefined, "en", ["en-GB", "en"])).toBe("en-GB");
    expect(speechLanguage("de", "en", ["pt-BR", "de-AT"])).toBe("de-AT");
    expect(speechLanguage(undefined, "pt-BR")).toBe("pt-BR");
  });
  it("falls back to the person's language for a tag that is not one", () => {
    expect(speechLanguage("<script>", "it")).toBe("it-IT");
    expect(speechLanguage("", "es")).toBe("es-ES");
  });
});

describe("browserService", () => {
  it("names whose servers the browser's speech service is", () => {
    expect(browserService(CHROME)).toBe("Google");
    expect(browserService(EDGE)).toBe("Microsoft");
    expect(browserService(SAFARI)).toBe("Apple");
    expect(browserService(FIREFOX)).toBeUndefined();
  });
});

describe("pickEngine — by environment (docs/29 §2)", () => {
  const t = { service: "OpenRouter", transcribe: async () => "" };
  const rec = recorder();
  it("on the device when the browser says it can recognise this language locally", async () => {
    const { Ctor } = fakeRecognition({ local: "available" });
    expect(await pickEngine({ recognition: Ctor, navigator: CHROME }, "en-US")).toMatchObject({ engine: "device" });
  });
  it("the browser's service otherwise, named", async () => {
    const { Ctor } = fakeRecognition({ local: "unavailable" });
    expect(await pickEngine({ recognition: Ctor, navigator: CHROME }, "pl-PL")).toEqual({ engine: "browser", service: "Google" });
    expect(await pickEngine({ recognition: fakeRecognition().Ctor, navigator: SAFARI }, "en-US")).toEqual({ engine: "browser", service: "Apple" });
  });
  it("asks for on-device only where asking is safe: Google Chrome, or a polyfill", async () => {
    const native = Object.assign(function () {}, { available: Math.max }) as unknown as RecognitionCtor; // native code
    const poly = Object.assign(function () {}, { available: async () => "available" }) as unknown as RecognitionCtor;
    expect(mayAskLocal(native, { userAgentData: { brands: [{ brand: "Chromium" }] } })).toBe(false);
    expect(mayAskLocal(native, { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } })).toBe(true);
    expect(mayAskLocal(poly, undefined)).toBe(true);
    const { Ctor } = fakeRecognition({ local: "available" });
    expect(await pickEngine({ recognition: Ctor, navigator: CHROME, askLocal: false }, "en-US")).toEqual({ engine: "browser", service: "Google" });
  });

  it("Firefox: the cloud engine only with a transcriber and a microphone to record", async () => {
    const deps = { navigator: FIREFOX, getUserMedia: async () => rec.stream, MediaRecorder: rec.Recorder };
    expect(await pickEngine(deps, "en-US")).toBeNull();
    expect(await pickEngine({ ...deps, transcriber: t }, "en-US")).toEqual({ engine: "cloud", service: "OpenRouter" });
    expect(await pickEngine({ navigator: FIREFOX, transcriber: t }, "en-US")).toBeNull();
  });
  it("withTranscriber exists only where a recording can be made", () => {
    expect(createWebSpeech({}).withTranscriber).toBeUndefined();
    expect(createWebSpeech({ getUserMedia: async () => rec.stream, MediaRecorder: rec.Recorder }).withTranscriber).toBeTypeOf("function");
  });
});

describe("the browser's recognizer", () => {
  it("starts in the language asked, streams everything heard so far, and ends with it on stop", async () => {
    const { Ctor, made } = fakeRecognition();
    const cap = createWebSpeech({ recognition: Ctor, navigator: CHROME }, { current: null });
    const e = events();
    const l = await cap.listen({ language: "pt-BR", interim: true }, e.ev);
    const r = made[0]!;
    expect([r.lang, r.continuous, r.interimResults, r.processLocally]).toEqual(["pt-BR", true, true, undefined]);
    expect(cap.listening).toBe(true);
    r.hear("um app", false);
    r.hear("um app de receitas", true);
    r.hear("com fotos", false);
    expect(e.texts).toEqual([
      ["um app", false],
      ["um app de receitas", true],
      ["um app de receitas com fotos", false],
    ]);
    l.stop();
    await tick();
    expect(e.ends).toEqual([{ why: "app", text: "um app de receitas com fotos" }]);
    expect(cap.listening).toBe(false);
  });

  it("asks for on-device recognition when the browser has it", async () => {
    const { Ctor, made } = fakeRecognition({ local: "available" });
    await createWebSpeech({ recognition: Ctor }, { current: null }).listen({ language: "en-US", interim: false }, events().ev);
    expect(made[0]!.processLocally).toBe(true);
  });

  it("with interim off, only finished pieces arrive", async () => {
    const { Ctor, made } = fakeRecognition();
    const e = events();
    await createWebSpeech({ recognition: Ctor }, { current: null }).listen({ language: "en-US", interim: false }, e.ev);
    made[0]!.hear("hel", false);
    made[0]!.hear("hello", true);
    expect(e.texts).toEqual([["hello", true]]);
  });

  it("a blocked microphone refuses the listening with 'denied'", async () => {
    const { Ctor } = fakeRecognition({ failStart: "not-allowed" });
    await expect(createWebSpeech({ recognition: Ctor }, { current: null }).listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "denied" });
  });

  it("a failure after starting ends it with a code; no-speech is a quiet end", async () => {
    const { Ctor, made } = fakeRecognition();
    const cap = createWebSpeech({ recognition: Ctor }, { current: null });
    const a = events();
    await cap.listen({ language: "en-US", interim: true }, a.ev);
    made[0]!.onerror?.({ error: "network" });
    made[0]!.onend?.();
    expect(a.ends).toEqual([{ why: "failed", text: "", code: "offline", message: "network" }]);
    const b = events();
    await cap.listen({ language: "en-US", interim: true }, b.ev);
    made[1]!.onerror?.({ error: "no-speech" });
    made[1]!.onend?.();
    expect(b.ends).toEqual([{ why: "silence", text: "" }]);
  });

  it("one listening a page: a new one ends the last ('replaced'); hidden ends it at once", async () => {
    const { Ctor } = fakeRecognition();
    let onVis = (): void => {};
    const doc = { hidden: false, addEventListener: (_: "visibilitychange", fn: () => void) => void (onVis = fn) };
    const slot = { current: null };
    const cap = createWebSpeech({ recognition: Ctor, doc }, slot);
    const a = events();
    await cap.listen({ language: "en-US", interim: true }, a.ev);
    const b = events();
    await cap.listen({ language: "en-US", interim: true }, b.ev);
    await tick();
    expect(a.ends).toEqual([{ why: "replaced", text: "" }]);
    doc.hidden = true;
    onVis();
    await tick();
    expect(b.ends).toEqual([{ why: "hidden", text: "" }]);
  });

  it("stops by itself after maxMs ('too-long')", async () => {
    vi.useFakeTimers();
    try {
      const { Ctor } = fakeRecognition();
      const e = events();
      const p = createWebSpeech({ recognition: Ctor }, { current: null }).listen({ language: "en-US", interim: true, maxMs: 1000 }, e.ev);
      await vi.advanceTimersByTimeAsync(0);
      await p;
      await vi.advanceTimersByTimeAsync(1001);
      expect(e.ends).toEqual([{ why: "too-long", text: "" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the cloud engine: record, then write down", () => {
  const wav = new Blob(["RIFF"], { type: "audio/wav" });

  it("records, says it is working, sends the WAV in the listening's language, and hands the words back", async () => {
    const rec = recorder();
    const sent: Array<[Blob, string]> = [];
    const cap = createWebSpeech({ getUserMedia: async () => rec.stream, MediaRecorder: rec.Recorder, toWav: async () => wav }, { current: null }).withTranscriber!({
      service: "OpenRouter",
      transcribe: async (b, lang) => (sent.push([b, lang]), "  a plant   diary "),
    });
    expect(await cap.where("en-US")).toEqual({ engine: "cloud", service: "OpenRouter" });
    const e = events();
    const l = await cap.listen({ language: "pl-PL", interim: true }, e.ev);
    expect(cap.listening).toBe(true);
    l.stop();
    await tick();
    await tick();
    expect(e.working).toBe(1);
    expect(sent).toEqual([[wav, "pl-PL"]]);
    expect(e.texts).toEqual([["a plant diary", true]]);
    expect(e.ends).toEqual([{ why: "app", text: "a plant diary" }]);
    expect(rec.tracks[0]!.stopped).toBe(true);
  });

  it("leaving or being replaced sends nothing", async () => {
    const rec = recorder();
    const transcribe = vi.fn(async () => "x");
    const cap = createWebSpeech({ getUserMedia: async () => rec.stream, MediaRecorder: rec.Recorder, toWav: async () => wav }, { current: null }).withTranscriber!({ service: "OpenRouter", transcribe });
    const e = events();
    await cap.listen({ language: "en-US", interim: true }, e.ev);
    cap.stopAll("left");
    await tick();
    expect(transcribe).not.toHaveBeenCalled();
    expect(e.ends).toEqual([{ why: "left", text: "" }]);
  });

  it("a blocked microphone is 'denied', none is 'unavailable', offline is refused before recording", async () => {
    const rec = recorder();
    const t = { service: "OpenRouter", transcribe: async () => "" };
    const mk = (getUserMedia: () => Promise<MediaStream>, online = true) =>
      createWebSpeech({ getUserMedia, MediaRecorder: rec.Recorder, online: () => online }, { current: null }).withTranscriber!(t);
    const fail = (name: string) => async () => {
      throw Object.assign(new Error(name), { name });
    };
    await expect(mk(fail("NotAllowedError")).listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "denied" });
    await expect(mk(fail("NotFoundError")).listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "unavailable" });
    await expect(mk(async () => rec.stream, false).listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "offline" });
  });

  it("a service that fails ends it with its words", async () => {
    const rec = recorder();
    const cap = createWebSpeech({ getUserMedia: async () => rec.stream, MediaRecorder: rec.Recorder, toWav: async () => wav }, { current: null }).withTranscriber!({
      service: "OpenRouter",
      transcribe: async () => {
        throw new Error("This month's free AI is used up");
      },
    });
    const e = events();
    (await cap.listen({ language: "en-US", interim: true }, e.ev)).stop();
    await tick();
    await tick();
    expect(e.ends).toEqual([{ why: "failed", text: "", code: "failed", message: "This month's free AI is used up" }]);
  });
});

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit PCM header and clamps samples", () => {
    const b = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...b.subarray(8, 12))).toBe("WAVE");
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16_000, 16, 8]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("joinPieces / createFakeSpeech", () => {
  it("joins pieces with one space", () => {
    expect(joinPieces([" a", "", "b  c "])).toBe("a b c");
  });
  it("the fake speaks, finishes, fails and refuses like an engine", async () => {
    const f = createFakeSpeech();
    const e = events();
    await f.cap.listen({ language: "en-US", interim: true }, e.ev);
    f.say("hello", false);
    f.say("hello there");
    f.finish();
    expect(e.texts).toEqual([
      ["hello", false],
      ["hello there", true],
    ]);
    expect(e.ends).toEqual([{ why: "silence", text: "hello there" }]);
    f.refuse("denied");
    await expect(f.cap.listen({ language: "en-US", interim: true }, events().ev)).rejects.toMatchObject({ code: "denied" });
    expect(await createFakeSpeech({ where: null }).cap.where("en")).toBeNull();
  });
});
