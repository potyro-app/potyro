// Voice input inside the realm (docs/29 §5): the sealed app's `SpeechSession`, as a proxy.
//
// The listening is the host's (speech-bridge.ts); here is a number for it and the app's callbacks.
// Events arrive on the app's port in order (`{ t: "speech" }`): the text so far, then the end.
//
// Nothing here is trusted by the host: app code shares this realm and may rewrite it all. It can only
// ever stop its own listenings.

import type { SpeechEngine, SpeechSession } from "potyro";
import type { Op } from "./protocol.js";

export type RealmSpeechEvent = { lid: number; kind: "text"; text: string; final: boolean } | { lid: number; kind: "end"; text: string; code?: string; message?: string };

export interface RealmSpeechInfo {
  lid: number;
  language: string;
  engine: SpeechEngine;
}

type Call = (op: Op, ...args: unknown[]) => Promise<unknown>;

const live = new Map<number, RealmSpeech>();

class RealmSpeech implements SpeechSession {
  readonly language: string;
  readonly engine: SpeechEngine;
  listening = true;
  readonly result: Promise<string>;
  private text = "";
  private final = true;
  private cbs: Array<(text: string, final: boolean) => void> = [];
  private settle!: { resolve: (t: string) => void; reject: (e: Error) => void };

  constructor(
    readonly lid: number,
    info: RealmSpeechInfo,
    private readonly call: Call,
  ) {
    this.language = String(info.language);
    this.engine = info.engine;
    this.result = new Promise<string>((resolve, reject) => (this.settle = { resolve, reject }));
    this.result.catch(() => {});
  }

  event(ev: RealmSpeechEvent): void {
    if (!this.listening) return;
    if (ev.kind === "text") return this.give(String(ev.text), ev.final === true);
    if (ev.text && !ev.code) this.give(String(ev.text), true);
    this.listening = false;
    live.delete(this.lid);
    this.cbs = [];
    if (ev.code) this.settle.reject(Object.assign(new Error(String(ev.message ?? ev.code)), { code: String(ev.code) }));
    else this.settle.resolve(this.text);
  }

  private give(text: string, final: boolean): void {
    if (text === this.text && final === this.final) return;
    this.text = text;
    this.final = final;
    for (const cb of [...this.cbs]) {
      try {
        cb(text, final);
      } catch (e) {
        console.warn("a speech onText threw:", e);
      }
    }
  }

  onText(cb: (text: string, final: boolean) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onText takes a function");
    if (!this.listening) return () => {};
    this.cbs.push(cb);
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
    if (!this.listening) return;
    void this.call("caps.speech.stop", this.lid).catch(() => {});
  }
}

/** A listening the host started for this realm, as the app holds it. */
export function realmSpeech(info: RealmSpeechInfo, call: Call): SpeechSession {
  const s = new RealmSpeech(Number(info.lid), info, call);
  live.set(s.lid, s);
  return s;
}

/** One event from the host, to the listening it names. */
export function dispatchSpeechEvent(ev: RealmSpeechEvent): void {
  live.get(Number(ev?.lid))?.event(ev);
}
