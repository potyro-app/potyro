// Voice input (docs/29): the platform half of `ctx.caps.speech` and of the Studio's microphone.
//
// The host does the mediation — the consent question, the per-app memory of it, the limits on what a
// sealed app may hold (host/src/speech.ts). What lives here is what only the page can do: pick the
// engine this device has, own the microphone, and turn it off when the person leaves the app or the
// page is hidden. One listening per page, whoever asks: a new one ends the last ("replaced").
//
// Engines, privacy first (docs/29 §2):
//   1. the browser's SpeechRecognition, on the device when the browser says it can (Chrome's
//      `processLocally`), else in the browser's own speech service — Google's servers for Chrome,
//      Microsoft's for Edge, Apple's for Safari — which the consent words name;
//   2. the native recognizer in the Android and iOS apps (packages/native: on-device preferred);
//   3. where neither exists (Firefox): a recording, sent to an AI service to be written down — only
//      with a `Transcriber` the shell gives (`withTranscriber`), and only after the person agreed.

import type { SpeechEngine, SpeechFailure } from "potyro";
import type { ConsentWords } from "./sockets.js";
import { recordingToWav } from "./wav.js";

/** Why a listening ended. */
export type SpeechEndWhy = "app" | "silence" | "left" | "hidden" | "too-long" | "replaced" | "failed";

/** Where the words would be made now, and by whom when it is not the device. */
export interface SpeechWhere {
  engine: SpeechEngine;
  /** "Google", "Microsoft", "Apple", "OpenRouter"… — absent on the device, or when nobody can tell. */
  service?: string;
}

export class SpeechError extends Error {
  override name = "SpeechError";
  constructor(
    message: string,
    readonly code: SpeechFailure,
  ) {
    super(message);
  }
}

export interface PlatformSpeechEvents {
  /** Everything heard so far in this listening; `final` false while the end may still change. */
  onText(text: string, final: boolean): void;
  /** The microphone is off and the recording is being written down (the cloud engine). */
  onWorking?(): void;
  /** Once. `code` (and words for the person, `message`) when it failed. */
  onEnd(end: { why: SpeechEndWhy; text: string; code?: SpeechFailure; message?: string }): void;
}

export interface PlatformListening {
  /** Stop listening and keep what was heard: `onEnd` follows, with `why: "app"`. */
  stop(): void;
  /** End now, for this reason. */
  abort(why: SpeechEndWhy): void;
}

export interface ListenOptions {
  /** A language tag: "pt-BR". */
  language: string;
  interim: boolean;
  /** Ends it ("too-long") after this long. */
  maxMs?: number;
}

/** How a recording is written down where the device cannot (the cloud engine). The shell's, per app. */
export interface Transcriber {
  /** Named in the consent words: "OpenRouter". */
  readonly service: string;
  /** Words in the person's language; throws words for the person. */
  transcribe(audio: Blob, language: string): Promise<string>;
}

export interface SpeechCap {
  /** Where the words would be made for this language — `null` when this device cannot listen at all. */
  where(language: string): Promise<SpeechWhere | null>;
  /** Resolves once the microphone is on; rejects with a `SpeechError`. A listening already running ends ("replaced"). */
  listen(opts: ListenOptions, events: PlatformSpeechEvents): Promise<PlatformListening>;
  /** End whatever is listening (the person left the app). */
  stopAll(why: SpeechEndWhy): void;
  /** Something is listening on this page. */
  readonly listening: boolean;
  /** This cap, falling back to the cloud engine where it has nothing better. Absent where there is no microphone to record. */
  withTranscriber?(t: Transcriber): SpeechCap;
  // ---- per app, added by the shell (like SocketCap's) ----
  /** Did the person let this app listen this way (on the device, through the browser's service, sent to an AI service)? */
  allowed?(engine: SpeechEngine): boolean;
  allow?(engine: SpeechEngine): void;
  consentWords?(appName: string, where: SpeechWhere): ConsentWords;
}

// ---------------------------------------------------------------- limits and languages

/** The longest a listening runs. A minute when the recording is sent to be written down (the file grows; so does the wait). */
export const SPEECH_MAX_MS = 5 * 60_000;
export const CLOUD_MAX_MS = 60_000;

/** The region a bare language most often means, for a recognizer that wants one. */
const REGION: Record<string, string> = { en: "en-US", pt: "pt-BR", es: "es-ES", it: "it-IT", de: "de-DE", pl: "pl-PL", fr: "fr-FR", nl: "nl-NL", uk: "uk-UA" };
const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/**
 * The tag to listen in: what the app asked (a tag with a region as it is), else Potyro's language;
 * a bare language takes the region the person's browser prefers for it, else the usual one. Pure.
 */
export function speechLanguage(asked: string | undefined, locale: string, preferred: readonly string[] = []): string {
  const pick = asked && TAG.test(asked.trim()) ? asked.trim() : TAG.test(locale) ? locale : "en";
  if (pick.includes("-")) {
    const [l, ...rest] = pick.split("-");
    return [l!.toLowerCase(), ...rest.map((r) => (r.length === 2 ? r.toUpperCase() : r))].join("-");
  }
  const lang = pick.toLowerCase();
  const fromBrowser = preferred.find((p) => p.toLowerCase().startsWith(`${lang}-`));
  return fromBrowser ?? REGION[lang] ?? lang;
}

/** Pieces of a transcript as one text: each trimmed, one space between. Pure. */
export function joinPieces(pieces: readonly string[]): string {
  return pieces
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- one listening per page

interface Slot {
  current: { abort(why: SpeechEndWhy): void } | null;
}

/** The page's one microphone: whatever listens holds it, and a new listening takes it. */
const pageSlot: Slot = { current: null };
const watched = new WeakSet<Slot>();

function watchHidden(doc: { readonly hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void } | undefined, slot: Slot): void {
  if (!doc || watched.has(slot)) return;
  watched.add(slot);
  // A microphone never runs behind the person's back: hidden ends it at once.
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) slot.current?.abort("hidden");
  });
}

function take(slot: Slot, me: { abort(why: SpeechEndWhy): void }): void {
  const before = slot.current;
  slot.current = me;
  if (before && before !== me) before.abort("replaced");
}

function release(slot: Slot, me: object): void {
  if (slot.current === me) slot.current = null;
}

// ---------------------------------------------------------------- the browser's SpeechRecognition

interface RecResult {
  readonly isFinal: boolean;
  readonly length: number;
  [i: number]: { transcript: string };
}
interface RecEvent {
  readonly results: { readonly length: number; [i: number]: RecResult };
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface RecognitionCtor {
  new (): Recognition;
  /** Chrome 139+: can this language be recognised on the device? */
  available?(o: { langs: string[]; processLocally: boolean }): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
}

/** The browser's recognizer, if it has one. */
export function recognitionCtor(g: unknown = globalThis): RecognitionCtor | null {
  const w = g as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whose servers the browser's speech service is, by the browser. Pure. */
export function browserService(nav: { userAgent?: string; vendor?: string } | undefined): string | undefined {
  const ua = nav?.userAgent ?? "";
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "Microsoft";
  if (/Apple/.test(nav?.vendor ?? "") && !/CriOS|FxiOS|Chrome/.test(ua)) return "Apple";
  if (/Chrome|Chromium|CriOS/.test(ua)) return "Google";
  return undefined;
}

const failureOfError = (error: string): SpeechFailure =>
  error === "not-allowed" || error === "service-not-allowed" ? "denied" : error === "audio-capture" || error === "language-not-supported" ? "unavailable" : error === "network" ? "offline" : "failed";

function browserListen(Ctor: RecognitionCtor, local: boolean, opts: ListenOptions, events: PlatformSpeechEvents, slot: Slot): Promise<PlatformListening> {
  return new Promise<PlatformListening>((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = opts.language;
    rec.continuous = true;
    rec.interimResults = opts.interim;
    rec.maxAlternatives = 1;
    if (local) rec.processLocally = true;
    let text = "";
    let started = false;
    let ended = false;
    let why: SpeechEndWhy = "silence";
    let failure: { code: SpeechFailure; message: string } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handle: PlatformListening & { abort(why: SpeechEndWhy): void } = {
      stop: () => {
        if (ended) return;
        why = "app";
        rec.stop();
      },
      abort: (w) => {
        if (ended) return;
        why = w;
        try {
          rec.abort();
        } catch {
          // already stopping
        }
        // Some engines never fire `end` after an abort: end it here, once.
        queueMicrotask(finish);
      },
    };
    function finish(): void {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      release(slot, handle);
      if (!started) {
        reject(new SpeechError(failure?.message ?? "The microphone did not start", failure?.code ?? "failed"));
        return;
      }
      events.onEnd(failure ? { why: "failed", text, code: failure.code, message: failure.message } : { why, text });
    }
    rec.onstart = () => {
      started = true;
      take(slot, handle);
      if (opts.maxMs) {
        timer = setTimeout(() => {
          why = "too-long";
          rec.stop();
        }, opts.maxMs);
      }
      resolve(handle);
    };
    rec.onresult = (e) => {
      const finals: string[] = [];
      const interim: string[] = [];
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i]!;
        (r.isFinal ? finals : interim).push(r[0]?.transcript ?? "");
      }
      const next = joinPieces([...finals, ...interim]);
      const final = interim.length === 0;
      if (!opts.interim && !final) return;
      if (next === text && !final) return;
      text = next;
      events.onText(text, final);
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are ends, not failures.
      if (e.error === "no-speech") why = "silence";
      else if (e.error !== "aborted") failure = { code: failureOfError(e.error), message: e.message || e.error };
    };
    rec.onend = finish;
    try {
      rec.start();
    } catch (e) {
      reject(new SpeechError(e instanceof Error ? e.message : String(e), "failed"));
    }
  });
}

// ---------------------------------------------------------------- the cloud engine: record, then write down

/** Loudness (RMS, 0–1) above which the microphone is hearing someone. */
const VOICE_RMS = 0.02;
/** After speech, this much quiet is the end; with no speech at all, this much. */
const QUIET_AFTER_MS = 2_000;
const QUIET_FIRST_MS = 8_000;

export interface RecorderDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: typeof MediaRecorder;
  AudioContext?: typeof AudioContext;
  toWav?: (recording: Blob) => Promise<Blob>;
  online?: () => boolean;
}

function recorderReady(d: RecorderDeps): boolean {
  return Boolean(d.getUserMedia && d.MediaRecorder);
}

function micFailure(e: unknown): SpeechError {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return new SpeechError("The microphone is blocked", "denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new SpeechError("No microphone", "unavailable");
  return new SpeechError(e instanceof Error ? e.message : String(e), "failed");
}

/** Hears when the person stops talking, so a listening ends by itself as the browser's does. */
function quietWatch(stream: MediaStream, Ctx: typeof AudioContext | undefined, onQuiet: () => void): () => void {
  if (!Ctx) return () => {};
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return () => {};
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const began = Date.now();
  let heard = false;
  let lastVoice = Date.now();
  const tick = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const s of buf) sum += s * s;
    const now = Date.now();
    if (Math.sqrt(sum / buf.length) > VOICE_RMS) {
      heard = true;
      lastVoice = now;
    } else if ((heard && now - lastVoice > QUIET_AFTER_MS) || (!heard && now - began > QUIET_FIRST_MS)) {
      onQuiet();
    }
  }, 120);
  return () => {
    clearInterval(tick);
    void ctx.close().catch(() => {});
  };
}

async function cloudListen(t: Transcriber, d: RecorderDeps, opts: ListenOptions, events: PlatformSpeechEvents, slot: Slot): Promise<PlatformListening> {
  if (d.online && !d.online()) throw new SpeechError("You're offline", "offline");
  let stream: MediaStream;
  try {
    stream = await d.getUserMedia!({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    throw micFailure(e);
  }
  const Recorder = d.MediaRecorder!;
  const rec = new Recorder(stream);
  const chunks: Blob[] = [];
  let why: SpeechEndWhy = "app";
  let ended = false;
  let keep = true;
  const off = (): void => {
    for (const tr of stream.getTracks()) tr.stop();
  };
  const unwatch = quietWatch(stream, d.AudioContext, () => handle.abort("silence"));
  const limit = setTimeout(() => handle.abort("too-long"), Math.min(opts.maxMs ?? CLOUD_MAX_MS, CLOUD_MAX_MS));
  const end = (e: { why: SpeechEndWhy; text: string; code?: SpeechFailure; message?: string }): void => {
    if (ended) return;
    ended = true;
    events.onEnd(e);
  };
  const handle: PlatformListening = {
    stop: () => handle.abort("app"),
    abort: (w) => {
      if (rec.state === "inactive") return;
      why = w;
      // Left, hidden, replaced: the person walked away — nothing is sent.
      keep = w === "app" || w === "silence" || w === "too-long";
      rec.stop();
    },
  };
  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    clearTimeout(limit);
    unwatch();
    off();
    release(slot, handle);
    if (!keep || !chunks.length) return end({ why, text: "" });
    events.onWorking?.();
    void (async () => {
      try {
        const wav = await (d.toWav ?? recordingToWav)(new Blob(chunks, { type: chunks[0]!.type || rec.mimeType }));
        const text = joinPieces([await t.transcribe(wav, opts.language)]);
        if (text) events.onText(text, true);
        end({ why, text });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        end({ why: "failed", text: "", code: d.online && !d.online() ? "offline" : "failed", message });
      }
    })();
  };
  take(slot, handle);
  rec.start(250);
  return handle;
}

// ---------------------------------------------------------------- the web's SpeechCap

/**
 * May `SpeechRecognition.available()` be asked here? In Google Chrome, yes. In other Chromium builds
 * it can take the page down: Playwright's Chromium crashes its renderer on the call (2026-10-16,
 * measured), and Brave, Vivaldi and distribution builds lack the same on-device component. There the
 * browser's service is assumed — the honest, less private answer. A polyfill (not native code) is
 * always asked. Pure apart from reading the function's source.
 */
export function mayAskLocal(Ctor: RecognitionCtor, nav: { userAgentData?: { brands?: Array<{ brand: string }> } } | undefined): boolean {
  if (typeof Ctor.available !== "function") return false;
  if (!/\[native code\]/.test(Function.prototype.toString.call(Ctor.available))) return true;
  return (nav?.userAgentData?.brands ?? []).some((b) => b.brand === "Google Chrome");
}

export interface WebSpeechDeps extends RecorderDeps {
  /** Ask the browser whether it can listen on the device (`mayAskLocal`); asked when absent. */
  askLocal?: boolean;
  recognition?: RecognitionCtor | null;
  navigator?: { userAgent?: string; vendor?: string };
  doc?: { readonly hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void };
  transcriber?: Transcriber;
}

/** The engine this environment has, in the order of docs/29 §2. Pure apart from `available()`. */
export async function pickEngine(d: WebSpeechDeps, language: string): Promise<(SpeechWhere & { local?: boolean }) | null> {
  const Ctor = d.recognition;
  if (Ctor) {
    if (typeof Ctor.available === "function" && d.askLocal !== false) {
      try {
        if ((await Ctor.available({ langs: [language], processLocally: true })) === "available") return { engine: "device", local: true };
      } catch {
        // the browser's service, then
      }
    }
    const service = browserService(d.navigator);
    return { engine: "browser", ...(service ? { service } : {}) };
  }
  if (d.transcriber && recorderReady(d)) return { engine: "cloud", service: d.transcriber.service };
  return null;
}

export function createWebSpeech(deps: WebSpeechDeps = {}, slot: Slot = pageSlot): SpeechCap {
  watchHidden(deps.doc, slot);
  const cap: SpeechCap = {
    where: async (language) => {
      const w = await pickEngine(deps, language);
      return w ? { engine: w.engine, ...(w.service ? { service: w.service } : {}) } : null;
    },
    listen: async (opts, events) => {
      const w = await pickEngine(deps, opts.language);
      if (!w) throw new SpeechError("This device cannot turn speech into words", "unavailable");
      if (w.engine === "cloud") return cloudListen(deps.transcriber!, deps, opts, events, slot);
      return browserListen(deps.recognition!, w.local === true, opts, events, slot);
    },
    stopAll: (why) => slot.current?.abort(why),
    get listening() {
      return slot.current !== null;
    },
    ...(recorderReady(deps) ? { withTranscriber: (t: Transcriber) => createWebSpeech({ ...deps, transcriber: t }, slot) } : {}),
  };
  return cap;
}

/** This page's speech, from the browser it runs in. */
export function sharedWebSpeech(): SpeechCap | null {
  const g = globalThis as unknown as { navigator?: Navigator; document?: Document; MediaRecorder?: typeof MediaRecorder; AudioContext?: typeof AudioContext };
  const media = g.navigator?.mediaDevices;
  const recognition = recognitionCtor();
  const nav = g.navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } } | undefined;
  const deps: WebSpeechDeps = {
    recognition,
    askLocal: recognition ? mayAskLocal(recognition, nav) : false,
    navigator: g.navigator,
    doc: g.document,
    ...(media?.getUserMedia ? { getUserMedia: (c: MediaStreamConstraints) => media.getUserMedia(c) } : {}),
    ...(g.MediaRecorder ? { MediaRecorder: g.MediaRecorder } : {}),
    ...(g.AudioContext ? { AudioContext: g.AudioContext } : {}),
    online: () => g.navigator?.onLine !== false,
  };
  if (!deps.recognition && !recorderReady(deps)) return null;
  return createWebSpeech(deps);
}
