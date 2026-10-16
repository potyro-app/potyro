// `ctx.caps.speech` (docs/29): voice input, the same API for every app.
//
// The page owns the microphone (capabilities' `SpeechCap`). This is the mediation every app goes
// through, trusted or sealed:
//
//   - a sealed app has `speech` only when its manifest says `permissions: { speech: true }`, and asks
//     the person once per app on this device, in words that say where the words are made
//     ("“Pantry” wants to listen to you through the microphone." — and whether the recording leaves
//     the device, and to whom); Not now refuses this call (`"denied"`) and is asked again next time;
//   - the person's own app is asked only when the recording would leave the device (the browser's
//     speech service, or an AI service writing it down) — once per app, the same words;
//   - one listening at a time per page; five minutes at most (one when an AI service writes it
//     down); a transcript longer than `SPEECH_LIMITS.textChars` is cut there.
//
// The objects made here ARE what a trusted app holds. A sealed app holds a proxy in its box that
// reaches them through `SpeechBridge` (speech-bridge.ts).

import type { SpeechCapability, SpeechEngine, SpeechFailure, SpeechOptions, SpeechSession } from "potyro";
import { CLOUD_MAX_MS, SPEECH_MAX_MS, SpeechError as PlatformSpeechError, speechLanguage, type ConsentWords, type PlatformListening, type SpeechCap, type SpeechWhere } from "@potyro/capabilities";
import type { UiBridge } from "./types.js";

export const SPEECH_LIMITS = {
  maxMs: SPEECH_MAX_MS,
  cloudMaxMs: CLOUD_MAX_MS,
  /** The most of a transcript an app is handed. */
  textChars: 20_000,
} as const;

/** A refusal with a `code` the app can word (SpeechFailure). */
export class SpeechError extends Error {
  override name = "SpeechError";
  constructor(
    message: string,
    readonly code: SpeechFailure,
  ) {
    super(message);
  }
}

/** The question in English, for a shell that brings no words of its own. */
export function englishSpeechConsent(appName: string, where: SpeechWhere): ConsentWords {
  const detail =
    where.engine === "device"
      ? "Your words are turned into text on this device; only the text reaches the app. The microphone is on only while it listens."
      : where.engine === "browser"
        ? `Your browser turns your voice into text${where.service ? ` on ${where.service}’s servers` : " with its own speech service"}, so the recording leaves this device. Only the text reaches the app.`
        : `This browser cannot turn speech into words itself, so the recording is sent to an AI service (${where.service ?? "online"}) to be written down: it leaves this device. Only the text reaches the app.`;
  return { message: `“${appName}” wants to listen to you through the microphone.`, detail, ok: "Allow", cancel: "Not now" };
}

/** Does this way of listening send the recording off the device? */
export const leavesDevice = (where: SpeechWhere): boolean => where.engine !== "device";

// ---------------------------------------------------------------- a listening, as the app holds it

export class HostSpeechSession implements SpeechSession {
  private text = "";
  private final = true;
  private cbs: Array<(text: string, final: boolean) => void> = [];
  private ended = false;
  private handle: PlatformListening | null = null;
  private resolveResult!: (t: string) => void;
  private rejectResult!: (e: Error) => void;
  readonly result: Promise<string>;

  constructor(
    readonly language: string,
    readonly engine: SpeechEngine,
  ) {
    this.result = new Promise<string>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // An app that never reads `result` must not leave an unhandled rejection behind; one that does still gets it.
    this.result.catch(() => {});
  }

  get listening(): boolean {
    return !this.ended;
  }

  /** @internal The platform's listening, once it has started. */
  attach(h: PlatformListening): void {
    this.handle = h;
    if (this.ended) h.abort("app");
  }

  /** @internal What the platform heard. */
  heard(text: string, final: boolean): void {
    if (this.ended) return;
    const t = text.length > SPEECH_LIMITS.textChars ? text.slice(0, SPEECH_LIMITS.textChars) : text;
    if (t === this.text && final === this.final) return;
    this.text = t;
    this.final = final;
    for (const cb of [...this.cbs]) {
      try {
        cb(t, final);
      } catch (e) {
        console.warn("a speech onText threw:", e);
      }
    }
  }

  /** @internal It ended. */
  end(e: { text: string; code?: SpeechFailure; message?: string }): void {
    if (this.ended) return;
    if (e.text && !e.code) this.heard(e.text, true);
    this.ended = true;
    this.cbs = [];
    if (e.code) this.rejectResult(new SpeechError(e.message ?? e.code, e.code));
    else this.resolveResult(this.text);
  }

  onText(cb: (text: string, final: boolean) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onText takes a function");
    if (this.ended) return () => {};
    this.cbs.push(cb);
    // Words that came before the app listened are not lost: the newest goes to it at once.
    if (this.text) {
      const [t, f] = [this.text, this.final];
      queueMicrotask(() => {
        if (this.cbs.includes(cb)) cb(t, f);
      });
    }
    return () => {
      this.cbs = this.cbs.filter((x) => x !== cb);
    };
  }

  stop(): void {
    if (this.ended) return;
    if (this.handle) this.handle.stop();
    else this.end({ text: this.text });
  }

  /** @internal End it now and keep nothing still being recorded (the app's box went away). */
  abort(): void {
    if (this.ended) return;
    if (this.handle) this.handle.abort("left");
    else this.end({ text: this.text });
  }
}

// ---------------------------------------------------------------- the capability

interface AppSpeech {
  asking: Promise<boolean> | null;
  /** Allowed in this page's life even when the device could not remember it, by engine. */
  allowedHere: Set<SpeechEngine>;
}
const byOwner = new WeakMap<object, AppSpeech>();

function stateOf(owner: object): AppSpeech {
  let s = byOwner.get(owner);
  if (!s) {
    s = { asking: null, allowedHere: new Set() };
    byOwner.set(owner, s);
  }
  return s;
}

export interface MakeSpeechArgs {
  cap: SpeechCap;
  trusted: boolean;
  ui: UiBridge;
  appName: string;
  /** Whose question and answer this is (the loaded app), so they outlive one pass's ctx. */
  owner: object;
  /** The person's language, `ctx.locale`. */
  locale: string;
  /** The browser's preferred language tags, for a region. */
  preferred?: readonly string[];
}

const failureOf = (e: unknown): SpeechError => {
  if (e instanceof SpeechError) return e;
  if (e instanceof PlatformSpeechError) return new SpeechError(e.message, e.code);
  return new SpeechError(e instanceof Error ? e.message : String(e), "failed");
};

export function makeSpeech(a: MakeSpeechArgs): SpeechCapability {
  const state = stateOf(a.owner);
  const preferred = a.preferred ?? (globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages ?? [];

  const consent = async (where: SpeechWhere): Promise<void> => {
    const needs = !a.trusted || leavesDevice(where);
    // An answer is for a way of listening: yes to "on this device" is not yes to "sent to a service".
    if (!needs || state.allowedHere.has(where.engine) || a.cap.allowed?.(where.engine)) return;
    // Two listens at once ask one question.
    state.asking ??= (async () => {
      try {
        const w = a.cap.consentWords?.(a.appName, where) ?? englishSpeechConsent(a.appName, where);
        return await a.ui.confirm(w.message, { detail: w.detail, ok: w.ok, cancel: w.cancel });
      } finally {
        state.asking = null;
      }
    })();
    if (!(await state.asking)) throw new SpeechError(`Permission denied: ${a.appName} → the microphone`, "denied");
    state.allowedHere.add(where.engine);
    a.cap.allow?.(where.engine);
  };

  return {
    async listen(opts?: SpeechOptions): Promise<SpeechSession> {
      const asked = opts?.language == null ? undefined : String(opts.language);
      const interim = opts?.interim !== false;
      const language = speechLanguage(asked, a.locale, preferred);
      let where: SpeechWhere | null;
      try {
        where = await a.cap.where(language);
      } catch (e) {
        throw failureOf(e);
      }
      if (!where) throw new SpeechError("This device cannot turn speech into words", "unavailable");
      await consent(where);
      const session = new HostSpeechSession(language, where.engine);
      try {
        const handle = await a.cap.listen(
          { language, interim, maxMs: where.engine === "cloud" ? SPEECH_LIMITS.cloudMaxMs : SPEECH_LIMITS.maxMs },
          {
            onText: (t, f) => session.heard(t, f),
            onEnd: (e) => session.end(e),
          },
        );
        session.attach(handle);
      } catch (e) {
        throw failureOf(e);
      }
      return session;
    },
  };
}
