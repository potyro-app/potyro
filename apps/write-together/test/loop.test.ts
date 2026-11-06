import { describe, expect, it } from "vitest";
import type { TextEdit } from "potyro";
import { SyncLoop } from "../loop.js";

// A host as `ctx.text(...).edit` behaves: the text as the store has it, edits mapped from the base
// they were counted in, and other people's keystrokes landing whenever the test says.

function region(from: string, to: string): { at: number; removed: number; inserted: number } {
  const min = Math.min(from.length, to.length);
  let p = 0;
  while (p < min && from[p] === to[p]) p++;
  let s = 0;
  while (s < min - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  return { at: p, removed: from.length - p - s, inserted: to.length - p - s };
}
const mapPos = (x: number, r: { at: number; removed: number; inserted: number }, end = false): number =>
  (end ? x <= r.at : x < r.at) ? x : x >= r.at + r.removed ? x + r.inserted - r.removed : r.at + r.inserted;
const apply = (t: string, e: TextEdit): string => ("insert" in e ? t.slice(0, e.at) + e.insert + t.slice(e.at) : t.slice(0, e.from) + t.slice(e.to));

class FakeHost {
  text: string;
  shown: string[] = [];
  private waiting: Array<() => void> = [];
  constructor(text: string) {
    this.text = text;
  }
  /** Someone else typed: lands in the store at once. */
  remote(e: TextEdit): void {
    this.text = apply(this.text, e);
  }
  /** Rounds wait until the test lets them through, so other keys can land in between. */
  edit = (edits: TextEdit[], base: string): Promise<string> =>
    new Promise((resolve) => {
      this.waiting.push(() => {
        let seen = base;
        let actual = this.text;
        for (const e of edits) {
          const r = region(seen, actual);
          const m: TextEdit = "insert" in e ? { at: Math.min(mapPos(e.at, r), actual.length), insert: e.insert } : { from: mapPos(e.from, r), to: mapPos(e.to, r, true) };
          if ("insert" in m ? m.insert : m.to > m.from) actual = apply(actual, m);
          seen = apply(seen, e);
        }
        this.text = actual;
        resolve(this.text);
      });
    });
  show = (t: string): void => void this.shown.push(t);
  /** Let the oldest round answer. */
  async answer(): Promise<void> {
    const next = this.waiting.shift();
    next?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  get pending(): number {
    return this.waiting.length;
  }
}

async function drain(host: FakeHost): Promise<void> {
  for (let i = 0; i < 20 && host.pending; i++) await host.answer();
}

describe("the editor's sync loop", () => {
  it("sends a keystroke counted in the confirmed text, and takes the answer as the next base", async () => {
    const host = new FakeHost("Hello");
    const loop = new SyncLoop(host, "Hello");
    loop.typed("Hello!");
    await drain(host);
    expect(host.text).toBe("Hello!");
    expect(loop.base).toBe("Hello!");
    expect(loop.shown).toBe("Hello!");
  });

  it("keeps typing while a round is out, and sends the rest as the next round", async () => {
    const host = new FakeHost("Hello");
    const loop = new SyncLoop(host, "Hello");
    loop.typed("Hello!");
    loop.typed("Hello!?");
    loop.typed("Hello!?!");
    expect(host.pending).toBe(1);
    await host.answer(); // "!" lands; the loop sends "?!"
    expect(host.pending).toBe(1);
    await drain(host);
    expect(host.text).toBe("Hello!?!");
    expect(loop.shown).toBe("Hello!?!");
  });

  it("merges someone else's keystrokes that landed while its own were out, and puts both on the screen", async () => {
    const host = new FakeHost("Hello from Ana.");
    const loop = new SyncLoop(host, "Hello from Ana.");
    loop.typed("NHello from Ana.");
    host.remote({ at: 15, insert: " " }); // Bo, at the end, before Ana's N lands
    loop.typed("NoHello from Ana.");
    await host.answer(); // N lands after the space arrived: "NHello from Ana. "
    expect(host.text).toBe("NHello from Ana. ");
    expect(loop.shown).toBe("NoHello from Ana. "); // Bo's space shown, Ana's o kept
    host.remote({ at: 17, insert: "A" });
    loop.typed("NotHello from Ana. ");
    await drain(host);
    expect(host.text).toBe("NotHello from Ana. A");
    expect(loop.shown).toBe("NotHello from Ana. A");
    expect(loop.base).toBe("NotHello from Ana. A");
  });

  it("starts from an empty screen, takes the first answer whole, and never doubles the text", async () => {
    const host = new FakeHost("Hello from Ana.");
    const loop = new SyncLoop(host, ""); // mounted before the record arrived
    loop.notified();
    await drain(host);
    expect(loop.shown).toBe("Hello from Ana.");
    loop.typed("NHello from Ana.");
    loop.notified(); // the store announcing our own keystroke, while it is out
    host.remote({ at: 15, insert: " And Bo." });
    await drain(host);
    expect(host.text).toBe("NHello from Ana. And Bo.");
    expect(loop.shown).toBe("NHello from Ana. And Bo.");
  });

  it("a notification while idle is an empty round, and what it brings is merged with later keys", async () => {
    const host = new FakeHost("abc");
    const loop = new SyncLoop(host, "abc");
    host.remote({ at: 3, insert: "d" });
    loop.notified();
    loop.typed("Xabc"); // typed before the answer is back
    await drain(host);
    expect(host.text).toBe("Xabcd");
    expect(loop.shown).toBe("Xabcd");
  });

  it("does not let two people typing letter by letter at opposite ends double anything", async () => {
    const host = new FakeHost("Hello from Ana.");
    const loop = new SyncLoop(host, "Hello from Ana.");
    const left = "Note: ";
    const right = " And Bo.";
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (i < left.length) loop.typed(left.slice(0, i + 1) + loop.shown.slice(i));
      if (i < right.length) host.remote({ at: host.text.length, insert: right[i]! });
      loop.notified();
      await host.answer();
    }
    await drain(host);
    expect(host.text).toBe("Note: Hello from Ana. And Bo.");
    expect(loop.shown).toBe(host.text);
  });
});
