// A sealed app's listenings, carried into its box (docs/29 §5).
//
// The listening itself is the host's `HostSpeechSession` (speech.ts), mediated like a trusted app's.
// A sealed app holds only a number for it, `lid` — in the browser realm's worker, over its
// MessagePort, or in QuickJS, over the JSON bridge. This owns that table:
//
//   - every event (the text so far, the end) goes to the box in order, and only once the box has the
//     listening's number;
//   - words come at the speed of a person, but a box that is slow to take them does not get a
//     backlog: a text still waiting is replaced by the newer one (each carries everything so far);
//   - the box going away (stopped, closed) ends every listening it held.

import type { Ctx, SpeechEngine, SpeechOptions } from "potyro";
import { HostSpeechSession, SpeechError } from "./speech.js";

export type BoxSpeechEvent = { lid: number; kind: "text"; text: string; final: boolean } | { lid: number; kind: "end"; text: string; code?: string; message?: string };

/** What the box learns when a listening starts. */
export interface BoxSpeechInfo {
  lid: number;
  language: string;
  engine: SpeechEngine;
}

interface Entry {
  s: HostSpeechSession;
  queue: BoxSpeechEvent[];
  ready: boolean;
  ended: boolean;
}

export class SpeechBridge {
  private live = new Map<number, Entry>();
  private seq = 0;

  /** `deliver` hands one event into the box; `onGone` hears a listening that has ended. */
  constructor(
    private readonly deliver: (ev: BoxSpeechEvent) => void,
    private readonly onGone?: (lid: number) => void,
  ) {}

  get size(): number {
    return this.live.size;
  }

  async listen(ctx: Ctx, opts?: SpeechOptions): Promise<BoxSpeechInfo> {
    const speech = ctx.caps.speech;
    if (!speech) throw new SpeechError("Permission denied: the microphone", "denied");
    const s = await speech.listen({
      ...(opts?.language == null ? {} : { language: String(opts.language) }),
      ...(opts?.interim == null ? {} : { interim: opts.interim !== false }),
    });
    if (!(s instanceof HostSpeechSession)) throw new Error("speech bridge: not a host listening");
    const lid = ++this.seq;
    const e: Entry = { s, queue: [], ready: false, ended: false };
    this.live.set(lid, e);
    s.onText((text, final) => this.push(lid, { lid, kind: "text", text, final }));
    s.result.then(
      (text) => this.push(lid, { lid, kind: "end", text }),
      (err: unknown) => {
        const code = (err as { code?: unknown } | null)?.code;
        this.push(lid, { lid, kind: "end", text: "", code: typeof code === "string" ? code : "failed", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return { lid, language: s.language, engine: s.engine };
  }

  private push(lid: number, ev: BoxSpeechEvent): void {
    const e = this.live.get(lid);
    if (!e || e.ended) return;
    const last = e.queue[e.queue.length - 1];
    // Each text is everything so far: one still waiting is spent by a newer one.
    if (ev.kind === "text" && last?.kind === "text") e.queue[e.queue.length - 1] = ev;
    else e.queue.push(ev);
    if (ev.kind === "end") e.ended = true;
    this.pump(lid, e);
  }

  /** The box has been told about `lid`: its events may go. */
  ready(lid: number): void {
    const e = this.live.get(Number(lid));
    if (!e || e.ready) return;
    e.ready = true;
    this.pump(Number(lid), e);
  }

  private pump(lid: number, e: Entry): void {
    if (!e.ready) return;
    while (e.queue.length) {
      const ev = e.queue.shift()!;
      try {
        this.deliver(ev);
      } catch (err) {
        console.warn("[potyro] a speech event could not reach the app:", err);
      }
      if (ev.kind === "end") {
        this.live.delete(lid);
        this.onGone?.(lid);
        return;
      }
    }
  }

  stop(lid: number): void {
    this.live.get(Number(lid))?.s.stop();
  }

  /** The box is gone: end every listening it held, and forget them. */
  endAll(): void {
    const all = [...this.live.values()];
    const lids = [...this.live.keys()];
    this.live.clear();
    for (const e of all) e.s.abort();
    for (const lid of lids) this.onGone?.(lid);
  }
}
