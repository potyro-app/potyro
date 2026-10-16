// Voice input in the Android app (docs/29 §2), over Potyro's own `PotyroSpeech` plugin
// (android-templates/SpeechPlugin.java, installed by scripts/patch-android.mjs).
//
// Android's System WebView has no SpeechRecognition, so a page there could only record and send the
// audio away. The plugin uses the phone's own recognizer instead: the on-device one where Android
// has it for the language (API 31+, `createOnDeviceSpeechRecognizer`), else the system recognizer
// asked to prefer offline (`EXTRA_PREFER_OFFLINE`) — which may still use Google's servers, and the
// consent words say so. Where the plugin is missing (iOS until the iOS developer adds its twin, an
// older build) or says it cannot, the WebView's own speech is used, with the cloud fallback.
//
// One utterance per listening: Android's recognizer ends by itself after a pause.

import { SpeechError, joinPieces, type PlatformListening, type SpeechCap, type SpeechEndWhy, type Transcriber } from "@potyro/capabilities";
import type { SpeechFailure } from "potyro";

interface Handle {
  remove(): Promise<void> | void;
}

/** The slice of the plugin this uses (a Capacitor plugin: every method crosses to Java). */
export interface SpeechPlugin {
  available(o: { language: string }): Promise<{ available: boolean; onDevice: boolean }>;
  /** Resolves once the recognizer is ready for speech; rejects with a `code` (SpeechFailure). */
  start(o: { language: string; partial: boolean; maxMs: number }): Promise<void>;
  /** Stop listening and keep what was heard: `end` follows. */
  stop(): Promise<void>;
  /** End now, keeping nothing: `end` follows. */
  cancel(): Promise<void>;
  addListener(event: "partial", fn: (e: { text: string }) => void): Promise<Handle> | Handle;
  addListener(event: "final", fn: (e: { text: string }) => void): Promise<Handle> | Handle;
  addListener(event: "end", fn: (e: { code?: string; message?: string; silence?: boolean }) => void): Promise<Handle> | Handle;
}

const CODES: readonly SpeechFailure[] = ["denied", "unavailable", "offline", "failed"];
const codeOf = (c: unknown): SpeechFailure => (CODES.includes(c as SpeechFailure) ? (c as SpeechFailure) : "failed");

interface Shared {
  current: { abort(why: SpeechEndWhy): void; cancelled?: Promise<void> } | null;
  events: { partial(t: string): void; final(t: string): void; end(e: { code?: string; message?: string; silence?: boolean }): void } | null;
  listening: Promise<void> | null;
}

/** The recognizer's speech, falling back to `web` where the plugin cannot. Every copy (`withTranscriber`) shares one listening. */
export function speechOverPlugin(plugin: SpeechPlugin, web: SpeechCap | null, st: Shared = { current: null, events: null, listening: null }): SpeechCap {
  // One set of listeners, for whichever listening is on. Never awaited as a plugin object (docs/13).
  const listen = (): Promise<void> =>
    (st.listening ??= Promise.all([
      plugin.addListener("partial", (e) => st.events?.partial(String(e.text ?? ""))),
      plugin.addListener("final", (e) => st.events?.final(String(e.text ?? ""))),
      plugin.addListener("end", (e) => st.events?.end(e ?? {})),
    ]).then(() => undefined));

  const native = async (language: string): Promise<{ available: boolean; onDevice: boolean }> => {
    try {
      const r = await plugin.available({ language });
      return { available: r?.available === true, onDevice: r?.onDevice === true };
    } catch {
      return { available: false, onDevice: false };
    }
  };

  const cap: SpeechCap = {
    where: async (language) => {
      const n = await native(language);
      if (n.available) return n.onDevice ? { engine: "device" } : { engine: "browser", service: "Google" };
      return web ? web.where(language) : null;
    },
    listen: async (opts, ev) => {
      const n = await native(opts.language);
      if (!n.available) {
        if (!web) throw new SpeechError("This device cannot turn speech into words", "unavailable");
        return web.listen(opts, ev);
      }
      await listen();
      // The last listening ends first, and its cancel is answered before this one's events begin:
      // the plugin's events carry no id, so they must not overlap.
      const before = st.current;
      if (before) {
        before.abort("replaced");
        await before.cancelled;
      }
      const finals: string[] = [];
      let interim = "";
      let why: SpeechEndWhy = "silence";
      let ended = false;
      const text = (): string => joinPieces([...finals, interim]);
      const handle: PlatformListening & { abort(w: SpeechEndWhy): void; cancelled?: Promise<void> } = {
        stop: () => {
          why = "app";
          void plugin.stop().catch(() => {});
        },
        abort: (w) => {
          if (ended) return;
          // Ended here and now, keeping nothing; what the plugin says after is for nobody.
          ended = true;
          st.events = null;
          if (st.current === handle) st.current = null;
          ev.onEnd({ why: w, text: "" });
          handle.cancelled = plugin.cancel().catch(() => {});
        },
      };
      st.events = {
        partial: (t) => {
          if (ended || !opts.interim) return;
          interim = t;
          ev.onText(text(), false);
        },
        final: (t) => {
          if (ended) return;
          finals.push(t);
          interim = "";
          ev.onText(text(), true);
        },
        end: (e) => {
          if (ended) return;
          ended = true;
          st.events = null;
          if (st.current === handle) st.current = null;
          if (e.code) ev.onEnd({ why: "failed", text: text(), code: codeOf(e.code), message: e.message ?? e.code });
          else ev.onEnd({ why, text: joinPieces(finals) });
        },
      };
      try {
        await plugin.start({ language: opts.language, partial: opts.interim, maxMs: opts.maxMs ?? 300_000 });
      } catch (e) {
        st.events = null;
        throw new SpeechError(e instanceof Error ? e.message : String(e), codeOf((e as { code?: unknown } | null)?.code));
      }
      st.current = handle;
      return handle;
    },
    stopAll: (why) => {
      st.current?.abort(why);
      web?.stopAll(why);
    },
    get listening() {
      return st.current !== null || (web?.listening ?? false);
    },
    withTranscriber: (t: Transcriber) => speechOverPlugin(plugin, web?.withTranscriber ? web.withTranscriber(t) : web, st),
  };
  return cap;
}
