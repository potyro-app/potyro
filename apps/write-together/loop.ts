// The editor's sync loop, pure (docs/04 "Writing together"): what is on the screen, what the host
// last confirmed, and the rounds between them. No React, no DOM, so a round trip with other people's
// keystrokes landing in the middle of it can be played out in a unit test.
//
// Differential sync: `base` is the text the host last confirmed. A round sends the difference between
// `base` and the screen, counted in `base` (the host moves the positions onto the text as it is by
// then), and gets back everyone's text now. That answer is merged with whatever was typed while the
// round was out (merge3) and becomes the next base; if the screen still differs from it, the next
// round goes at once. A notification from the store is a cue to run an empty round rather than text
// to trust: it comes back in order with this screen's own edits, so answers never overtake each other.
import type { TextEdit } from "potyro";
import { diffEdits, merge3 } from "./diff.js";

export interface LoopHost {
  /** `ctx.text(...).edit`: resolves to the whole text after. */
  edit(edits: TextEdit[], base: string): Promise<string>;
  /** The screen should show this text now (the caret follows on the caller's side). */
  show(text: string): void;
  /** Every round's answer is in: a good moment to ask who wrote what. */
  settled?(): void;
  failed?(e: unknown): void;
}

export class SyncLoop {
  /** The text on the screen. */
  shown: string;
  /** The text the host last confirmed. */
  base: string;
  private inFlight = false;
  private stale = false;

  constructor(
    private readonly host: LoopHost,
    initial = "",
  ) {
    this.shown = initial;
    this.base = initial;
  }

  /** The person typed: the screen now reads `next`. */
  typed(next: string): void {
    this.shown = next;
    this.flush();
  }

  /** The store says the record changed: ask the host what the text is now, in order with our edits. */
  notified(): void {
    if (this.inFlight) {
      this.stale = true;
      return;
    }
    this.round([], this.base, this.base);
  }

  get busy(): boolean {
    return this.inFlight;
  }

  private flush(): void {
    if (this.inFlight || this.shown === this.base) return;
    this.round(diffEdits(this.base, this.shown), this.base, this.shown);
  }

  private round(edits: TextEdit[], from: string, sent: string): void {
    this.inFlight = true;
    this.stale = false;
    this.host.edit(edits, from).then(
      (theirs) => {
        this.inFlight = false;
        this.settle(theirs, sent);
      },
      (e: unknown) => {
        this.inFlight = false;
        this.host.failed?.(e);
      },
    );
  }

  private settle(theirs: string, since: string): void {
    const merged = merge3(since, this.shown, theirs);
    this.base = theirs;
    if (merged !== this.shown) {
      this.shown = merged;
      this.host.show(merged);
    }
    this.host.settled?.();
    if (merged !== theirs) this.flush();
    else if (this.stale) this.notified();
  }
}
