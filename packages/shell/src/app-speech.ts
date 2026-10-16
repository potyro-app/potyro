// One app's voice input (docs/29): the page's `SpeechCap`, with what is the person's per app — which
// ways of listening they let it use, the question in their words, and, where the browser cannot turn
// speech into words, the AI service that writes a recording down (the app's own `ctx.caps.ai`
// machinery: its switch, the free allowance, then the person's own key, the same spend).
//
// The standing answer lives in localStorage under `potyro:speech:<appId>` — a list of the engines
// allowed ("device", "browser", "cloud") — like AI's and the sockets', never in `ctx.storage`, which
// the app itself can write. Deleting the app forgets it (remove-app.ts).

import { t } from "@lingui/core/macro";
import type { AiCap, ConsentWords, SpeechCap, SpeechWhere, Transcriber } from "@potyro/capabilities";
import type { SpeechEngine } from "potyro";

const key = (appId: string): string => `potyro:speech:${appId}`;
const ENGINES: readonly SpeechEngine[] = ["device", "browser", "cloud"];

/** The ways of listening this app may use without asking again, on this device. */
export function speechStanding(appId: string): SpeechEngine[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key(appId)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is SpeechEngine => ENGINES.includes(x as SpeechEngine)) : [];
  } catch {
    return [];
  }
}

export function forgetSpeechStanding(appId: string): void {
  try {
    globalThis.localStorage?.removeItem(key(appId));
  } catch {
    // nothing to forget
  }
}

function remember(appId: string, engine: SpeechEngine): void {
  const all = new Set(speechStanding(appId));
  all.add(engine);
  try {
    globalThis.localStorage?.setItem(key(appId), JSON.stringify([...all]));
  } catch {
    // Storage refused: the app asks again next time, which errs on the person's side.
  }
}

/** Where the words are made, in a few words for the person: under the question, and beside the Studio's microphone. */
export function speechWhereWords(where: SpeechWhere): string {
  if (where.engine === "device") return t({ message: "On this device", comment: "Voice input: the words are made on the phone or computer itself; nothing leaves it" });
  if (where.engine === "cloud") {
    const service = where.service ?? "OpenRouter";
    return t({ message: `Sent to ${service} to write down`, comment: "Voice input: the recording leaves the device and an AI service ({service}) writes it down" });
  }
  if (where.service) {
    const service = where.service;
    return t({ message: `Through ${service}’s speech service`, comment: "Voice input: the browser's speech recognition runs on its maker's servers ({service} = Google, Apple, Microsoft)" });
  }
  return t({ message: "Through your browser’s speech service", comment: "Voice input: the browser's own speech recognition, maker unknown" });
}

/** The detail of a voice question: what happens to the recording, honestly. */
export function speechDetail(where: SpeechWhere): string {
  if (where.engine === "device") {
    return t({
      message: "Your words are turned into text on this device; only the text reaches the app. The microphone is on only while it listens.",
      comment: "Detail of the question before voice input, when the words are made on the device",
    });
  }
  if (where.engine === "cloud") {
    const service = where.service ?? "OpenRouter";
    return t({
      message: `This browser can’t turn speech into words itself, so the recording is sent to an AI service (${service}) to be written down — it leaves your device. Only the text reaches the app.`,
      comment: "Detail of the question before voice input in a browser without speech recognition (Firefox); {service} is the AI service",
    });
  }
  if (where.service) {
    const service = where.service;
    return t({
      message: `Your browser turns your voice into text on ${service}’s servers, so the recording leaves your device. Only the text reaches the app.`,
      comment: "Detail of the question before voice input through the browser's speech service; {service} = Google, Apple or Microsoft",
    });
  }
  return t({
    message: "Your browser turns your voice into text with its own speech service, which may send the recording off your device. Only the text reaches the app.",
    comment: "Detail of the question before voice input through a browser's speech service whose maker is unknown",
  });
}

/** The question an app's first listening asks, in the person's language. */
export function speechConsentWords(appName: string, where: SpeechWhere): ConsentWords {
  return {
    message: t({ message: `“${appName}” wants to listen to you through the microphone.`, comment: "Asked before an app first uses voice input (ctx.caps.speech); {appName} is the app" }),
    detail: speechDetail(where),
    ok: t({ message: "Allow", comment: "Button: let an app listen through the microphone" }),
    cancel: t({ message: "Not now", comment: "Button: refuse an app's voice input this time" }),
  };
}

/** What the model is told when it writes a recording down. Model-facing: English. */
export const TRANSCRIBE_SYSTEM =
  "You write down speech. Answer with exactly the words said in the recording, in the language spoken, with normal punctuation — nothing else: no quotes, no notes, no translation. If nothing is said, answer with a single hyphen: -";

/** A recording written down by the app's AI service (docs/29 §3). */
export function aiTranscriber(ai: AiCap): Transcriber {
  return {
    service: ai.service,
    async transcribe(audio, language) {
      const reply = await ai.complete({ system: TRANSCRIBE_SYSTEM, parts: [{ text: `The person most likely speaks ${language}.` }, { audio }], maxTokens: 1_000 });
      const text = reply.text.trim();
      return text === "-" ? "" : text;
    },
  };
}

/** The page's speech, as one app sees it. `null` when the device cannot listen. */
export function appSpeech(page: SpeechCap | null | undefined, appId: string, ai?: AiCap | null): SpeechCap | null {
  if (!page) return null;
  const base = ai && page.withTranscriber ? page.withTranscriber(aiTranscriber(ai)) : page;
  return {
    where: (language) => base.where(language),
    listen: (opts, events) => base.listen(opts, events),
    stopAll: (why) => base.stopAll(why),
    get listening() {
      return base.listening;
    },
    allowed: (engine) => speechStanding(appId).includes(engine),
    allow: (engine) => remember(appId, engine),
    consentWords: speechConsentWords,
  };
}
