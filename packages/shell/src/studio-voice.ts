// The Studio's microphone (docs/29 §4): say the app you want, see the words as you speak, change them,
// send. The Studio is the person's own, so it listens like their own app does (host speech.ts): no
// question while the words are made on the device; once, in words that name the service, when the
// recording would leave it — the browser's speech service (Chrome's is Google's), or an AI service
// writing it down where the browser cannot (Firefox). Its answers are kept like an app's, under
// `potyro:speech:potyro-studio`.

import { t } from "@lingui/core/macro";
import { sharedWebSpeech, SpeechError, type ConsentWords, type SpeechCap, type SpeechWhere } from "@potyro/capabilities";
import { makeSpeech, type UiBridge } from "@potyro/host";
import type { SpeechSession } from "potyro";
import { createAppAi } from "./app-ai.js";
import { appSpeech } from "./app-speech.js";
import { deviceId } from "./device-id.js";
import { shellDialogs } from "./dialog.js";
import { getEngineConfig } from "./engine-store.js";
import { currentLocale, languagePrefs } from "./locale.js";
import { shellCaps } from "./shell-caps.js";

/** Whose answers and AI spend the Studio's voice is kept under. */
export const STUDIO_VOICE_ID = "potyro-studio";

/** The question before the Studio first sends a recording off the device. */
export function studioVoiceConsent(where: SpeechWhere): ConsentWords {
  const detail =
    where.engine === "cloud"
      ? (() => {
          const service = where.service ?? "OpenRouter";
          return t({
            message: `This browser can’t turn speech into words itself, so what you say is recorded and sent to an AI service (${service}) to be written down — it leaves your device. You can read and change the words before sending them.`,
            comment: "Studio microphone: asked once before voice input in a browser without speech recognition (Firefox); {service} is the AI service",
          });
        })()
      : where.service
        ? (() => {
            const service = where.service;
            return t({
              message: `Your browser turns your voice into text on ${service}’s servers, so what you say leaves your device. You can read and change the words before sending them.`,
              comment: "Studio microphone: asked once before voice input through the browser's speech service; {service} = Google, Apple or Microsoft",
            });
          })()
        : t({
            message: "Your browser turns your voice into text with its own speech service, which may send what you say off your device. You can read and change the words before sending them.",
            comment: "Studio microphone: asked once before voice input through a browser speech service whose maker is unknown",
          });
  return {
    message: t({ message: "Use your voice to describe the app?", comment: "Studio microphone: the question before the recording first leaves the device" }),
    detail,
    ok: t({ message: "Use my voice", comment: "Studio microphone: button that agrees to voice input" }),
    cancel: t({ message: "Not now", comment: "Studio microphone: button that refuses voice input this time" }),
  };
}

const QUIET_UI: UiBridge = {
  confirm: (m, o) => shellDialogs.confirm(m, o),
  toast: () => {},
  prompt: async () => null,
  pick: async () => null,
};

const OWNER = {};

/** The page's speech, as the Studio uses it — `null` when this device cannot listen at all. */
function studioCap(): SpeechCap | null {
  let page: SpeechCap | null | undefined;
  try {
    page = shellCaps().speech;
  } catch {
    page = sharedWebSpeech();
  }
  const ai = createAppAi({ appId: STUDIO_VOICE_ID, ownKey: () => getEngineConfig().openrouterKey, device: deviceId, language: currentLocale });
  return appSpeech(page, STUDIO_VOICE_ID, ai);
}

let capOnce: SpeechCap | null | undefined;
const cap = (): SpeechCap | null => (capOnce === undefined ? (capOnce = studioCap()) : capOnce);

/** Test seam: pick the device's speech again. */
export function resetStudioVoice(): void {
  capOnce = undefined;
}

/** Where the Studio's words would be made now, or null when it cannot listen (no microphone button then). */
export async function studioVoiceWhere(): Promise<SpeechWhere | null> {
  const c = cap();
  if (!c) return null;
  try {
    return await c.where(currentLocale());
  } catch {
    return null;
  }
}

/** Start listening, in the person's language. `onWorking`: the recording is being written down. */
export async function studioListen(onWorking: () => void): Promise<SpeechSession> {
  const c = cap();
  if (!c) throw new SpeechError("This device cannot listen", "unavailable");
  const withWorking: SpeechCap = {
    where: (l) => c.where(l),
    listen: (o, ev) => c.listen(o, { ...ev, onWorking: () => (onWorking(), ev.onWorking?.()) }),
    stopAll: (w) => c.stopAll(w),
    get listening() {
      return c.listening;
    },
    ...(c.allowed ? { allowed: c.allowed } : {}),
    ...(c.allow ? { allow: c.allow } : {}),
    consentWords: (_app, where) => studioVoiceConsent(where),
  };
  return makeSpeech({ cap: withWorking, trusted: true, ui: QUIET_UI, appName: "Studio", owner: OWNER, locale: currentLocale(), preferred: [...languagePrefs(), ...(globalThis.navigator?.languages ?? [])] }).listen();
}

/** A failure, in words for the person. */
export function voiceProblem(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "denied") return t`Potyro can’t use the microphone. Allow it for this site in your browser, then try again.`;
  if (code === "unavailable") return t`This device can’t listen. Type what you want instead.`;
  if (code === "offline") return t`You’re offline, and voice needs the internet here. Type what you want instead.`;
  const said = e instanceof Error && e.message ? e.message : "";
  return said && code === "failed" && !/^[a-z-]+$/.test(said) ? said : t`The microphone stopped. Try again, or type what you want.`;
}

/** The text in the box while dictating: what was there before, then what was heard. Pure. */
export function withHeard(before: string, heard: string): string {
  if (!heard) return before;
  if (!before.trim()) return heard;
  return /\s$/.test(before) ? `${before}${heard}` : `${before} ${heard}`;
}
