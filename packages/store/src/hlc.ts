// A hybrid logical clock, for ordering messages between devices whose clocks disagree.
//
// ## The problem it solves
//
// Chat was ordered by each sender's wall clock, taken from the CRDT transaction that wrote the
// message. That is not an ordering, it is a collection of unrelated opinions: a device five minutes
// fast puts its messages five minutes into everyone's future, and a reply written on a correct clock
// sorts BEFORE the message it answers. The conversation reads backwards, and nothing about it looks
// like a bug — just a chat that makes no sense.
//
// A ULID tiebreak (what was there before) does not fix this. It makes every peer agree on the same
// order, which is necessary but not sufficient: they agree on an order that is wrong.
//
// ## What a hybrid clock gives
//
// Each message carries a stamp of `(physical, counter)`:
//
//   physical = max(this device's clock, the highest physical it has SEEN)
//   counter  = 0 when physical advanced on its own, else (highest seen counter) + 1
//
// Two properties follow, and they are the two that matter:
//
//   - **Causality holds.** Writing a message after seeing another always produces a greater stamp,
//     because the sender has folded that message's stamp into its own clock. A reply can no longer
//     precede its cause, whatever the clocks say.
//   - **It still reads like time.** Unlike a pure Lamport counter, the physical part is a real
//     timestamp, so the conversation is ordered roughly when things actually happened and the stamp
//     can be shown to a person.
//
// ## Deliberately not defended against a hostile stamp
//
// A peer could stamp a message far in the future to pin it to the bottom of the thread forever, so
// `MAX_DRIFT_MS` refuses to adopt a stamp implausibly far ahead of this device's own clock. That
// caps the damage at a nuisance. It is not a security boundary and does not need to be: everyone in
// the space can already write to it, and authorship — the thing that must not be forgeable — comes
// from the signing transaction and not from anything here.

/** How far ahead of our own clock another device's stamp may be before we stop adopting it. */
const MAX_DRIFT_MS = 60 * 60 * 1000; // an hour: generous for real skew, useless for pinning

/** Wide enough for milliseconds since the epoch until the year 5138, so it sorts lexicographically. */
const PHYSICAL_DIGITS = 13;
const COUNTER_DIGITS = 5;

export interface Hlc {
  physical: number;
  counter: number;
}

/**
 * A stamp as a string that sorts correctly with plain `<`.
 *
 * Fixed-width and zero-padded on purpose: these are compared as strings wherever they are stored,
 * and `"9" < "10"` is false, which would be a sorting bug that only appears once a counter reaches
 * two digits — i.e. only under exactly the concurrency this exists to handle.
 */
export function formatHlc(h: Hlc): string {
  return `${String(h.physical).padStart(PHYSICAL_DIGITS, "0")}.${String(h.counter).padStart(COUNTER_DIGITS, "0")}`;
}

export function parseHlc(s: string): Hlc | null {
  const m = /^(\d{13})\.(\d{5})$/.exec(s);
  return m ? { physical: Number(m[1]), counter: Number(m[2]) } : null;
}

/**
 * This device's clock.
 *
 * Held in memory only. It is rebuilt from what a thread contains the moment anything is read, so a
 * reload costs nothing — and persisting it would be a second source of truth to disagree with the
 * messages themselves.
 */
export class HybridClock {
  private last: Hlc = { physical: 0, counter: 0 };

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Fold in a stamp seen from someone else. Call this for every message read.
   *
   * Ignores anything implausibly far ahead — see MAX_DRIFT_MS.
   */
  observe(stamp: string | Hlc | null | undefined): void {
    const h = typeof stamp === "string" ? parseHlc(stamp) : stamp ?? null;
    if (!h) return;
    if (h.physical > this.now() + MAX_DRIFT_MS) return;
    if (h.physical > this.last.physical || (h.physical === this.last.physical && h.counter > this.last.counter)) {
      this.last = { physical: h.physical, counter: h.counter };
    }
  }

  /** The stamp for something written NOW. Strictly greater than anything issued or observed. */
  issue(): Hlc {
    const wall = this.now();
    // A clock that went backwards (NTP correction, a suspended laptop) must not produce a stamp that
    // sorts before one already issued — that would let a later message precede an earlier one on the
    // SAME device, which is the one case nobody would accept.
    const next =
      wall > this.last.physical
        ? { physical: wall, counter: 0 }
        : { physical: this.last.physical, counter: this.last.counter + 1 };
    this.last = next;
    return next;
  }
}
