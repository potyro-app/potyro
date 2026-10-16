// Voice input (docs/29): `ctx.caps.speech.listen()` turns what the person says into words, live. The
// same API for your own apps and for shared (sealed) ones; a shared app needs `permissions: { speech:
// true }` and asks the person once. Words are made on the device where it can (the phone's own
// recognizer); where it cannot, the browser's speech service or an AI service does it — the
// question says which, and that the recording then leaves the device.
//
// Outside the model's core reference (#341): read through `lookup("ctx.caps.speech")`, and beside a
// request that asks for voice.

/**
 * Where the words are made. `"device"` — on this phone or computer, nothing leaves it; `"browser"` —
 * the browser's own speech service (Chrome's is Google's servers); `"cloud"` — the recording is sent
 * to an AI service to be written down (where the browser has no speech recognition of its own).
 */
export type SpeechEngine = "device" | "browser" | "cloud";

/**
 * Why `listen()` did not start, or why `result` rejected: the `code` of the Error, for the app to
 * word. `"denied"` — the person said Not now, or the microphone is blocked (asked again next time);
 * `"unavailable"` — this device has no microphone or no way to turn speech into words; `"offline"` —
 * the words are made online and the device is offline; `"failed"` — the engine stopped with an error.
 */
export type SpeechFailure = "denied" | "unavailable" | "offline" | "failed";

export interface SpeechOptions {
  /** A language tag ("pt-BR", "en-GB") or a Potyro language ("pl"). Default: the person's, `ctx.locale`. */
  language?: string;
  /** Words while the person is still speaking (default true). False: only finished sentences. */
  interim?: boolean;
}

/**
 * One listening, from the microphone turning on until `stop()`, a pause the engine takes as the end,
 * the person leaving the app, or five minutes (one minute when the words are made by an AI service).
 */
export interface SpeechSession {
  /** The language tag it listens in. */
  readonly language: string;
  readonly engine: SpeechEngine;
  /** False once it has ended. */
  readonly listening: boolean;
  /**
   * Everything heard so far in this session (not just the newest piece), each time it changes;
   * `final` is false while the last words may still change. Returns the unsubscribe.
   */
  onText(cb: (text: string, final: boolean) => void): () => void;
  /** Stop listening: `result` then resolves with what was heard. Safe to call twice. */
  stop(): void;
  /** The whole text once it has ended ("" when nothing was said); rejects with a `code` (SpeechFailure) when the engine failed. */
  readonly result: Promise<string>;
}

/** `ctx.caps.speech` (docs/29). Resolves once the microphone is on; one listening at a time — a new one ends the last. */
export interface SpeechCapability {
  listen(opts?: SpeechOptions): Promise<SpeechSession>;
}
