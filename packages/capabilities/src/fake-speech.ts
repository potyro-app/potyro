// FakeSpeech — a microphone and a recognizer in memory, for tests (docs/29 §7).
//
// `say` is the person speaking: the listening's `onText` hears everything so far, the way a real
// engine reports it. `finish` is the engine deciding they are done; `fail` is it breaking. Opening can
// be refused (`refuse`), as a blocked microphone is. One listening at a time, like the page's.

import type { SpeechFailure } from "potyro";
import { joinPieces, SpeechError, type ListenOptions, type PlatformSpeechEvents, type SpeechCap, type SpeechEndWhy, type SpeechWhere, type Transcriber } from "./speech.js";

export interface FakeSpeechOptions {
  /** Where the fake says the words are made. Default: on the device. `null`: it cannot listen. */
  where?: SpeechWhere | null;
}

export interface FakeListening {
  readonly opts: ListenOptions;
  readonly ended: { why: SpeechEndWhy; text: string; code?: SpeechFailure } | null;
}

export interface FakeSpeech {
  cap: SpeechCap;
  /** The person says this (a piece; `final` false while still speaking). */
  say(piece: string, final?: boolean): void;
  /** The engine ends it by itself: a pause ("silence") by default. */
  finish(why?: SpeechEndWhy): void;
  /** The engine fails. */
  fail(code: SpeechFailure, message?: string): void;
  /** The next `listen` is refused with this code. */
  refuse(code: SpeechFailure): void;
  /** Every listening so far, oldest first. */
  readonly listenings: FakeListening[];
  readonly active: boolean;
}

export function createFakeSpeech(o: FakeSpeechOptions = {}): FakeSpeech {
  const where: SpeechWhere | null = o.where === undefined ? { engine: "device" } : o.where;
  let refusal: SpeechFailure | null = null;
  let current: { rec: { opts: ListenOptions; ended: FakeListening["ended"] }; events: PlatformSpeechEvents; finals: string[]; interim: string } | null = null;
  const listenings: Array<{ opts: ListenOptions; ended: FakeListening["ended"] }> = [];

  const end = (why: SpeechEndWhy, code?: SpeechFailure, message?: string): void => {
    const c = current;
    if (!c) return;
    current = null;
    const text = joinPieces([...c.finals, c.interim]);
    c.rec.ended = { why: code ? "failed" : why, text, ...(code ? { code } : {}) };
    c.events.onEnd(code ? { why: "failed", text, code, message: message ?? code } : { why, text });
  };

  const make = (transcriber?: Transcriber): SpeechCap => ({
    where: async () => (where ?? (transcriber ? { engine: "cloud", service: transcriber.service } : null)),
    listen: async (opts, events) => {
      if (!where && !transcriber) throw new SpeechError("cannot listen", "unavailable");
      if (refusal) {
        const code = refusal;
        refusal = null;
        throw new SpeechError(`refused: ${code}`, code);
      }
      end("replaced");
      const rec = { opts, ended: null as FakeListening["ended"] };
      listenings.push(rec);
      current = { rec, events, finals: [], interim: "" };
      const mine = current;
      return {
        stop: () => {
          if (current === mine) end("app");
        },
        abort: (why) => {
          if (current === mine) end(why);
        },
      };
    },
    stopAll: (why) => end(why),
    get listening() {
      return current !== null;
    },
    withTranscriber: (t) => make(t),
  });

  return {
    cap: make(),
    say(piece, final = true) {
      const c = current;
      if (!c) return;
      if (final) {
        c.finals.push(piece);
        c.interim = "";
      } else c.interim = piece;
      if (!final && !c.rec.opts.interim) return;
      c.events.onText(joinPieces([...c.finals, c.interim]), final);
    },
    finish: (why = "silence") => end(why),
    fail: (code, message) => end("failed", code, message),
    refuse: (code) => {
      refusal = code;
    },
    get listenings() {
      return listenings;
    },
    get active() {
      return current !== null;
    },
  };
}
