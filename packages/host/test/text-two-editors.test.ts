// Two editors, two real stores, one document: the claim of docs/04 "Writing together" end to end
// below the browser. Each side runs the loop an editor runs (differential sync: send what the screen
// has that the host has not, counted in the text the host last confirmed; merge the answer with what
// was typed meanwhile) over the host's `ctx.text` — base mapping, the per-field queue, the store's
// CRDT — on the two-peer harness. Letter by letter at the same moment, both keep their words.

import { describe, expect, it } from "vitest";
import { createPeerPair, type Store } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { defineApp, type Ctx, type CtxText, type TextEdit } from "potyro";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

const pad = () =>
  defineApp({
    id: "pad",
    name: "Pad",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { doc: { label: "Doc", displayField: "title", fields: { title: { type: "text" }, body: { type: "text", multiline: true, collaborative: true } } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "doc" } }],
  });

async function person(store: Store, me: { id: string; name: string }): Promise<Ctx> {
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: pad() });
  return host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me } as MakeCtxBase);
}

/** What changed between two texts, as one deletion and one insertion over the common prefix and suffix. */
function diff(before: string, after: string): TextEdit[] {
  const min = Math.min(before.length, after.length);
  let p = 0;
  while (p < min && before[p] === after[p]) p++;
  let s = 0;
  while (s < min - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const out: TextEdit[] = [];
  if (before.length - p - s > 0) out.push({ from: p, to: before.length - s });
  if (after.length - p - s > 0) out.push({ at: p, insert: after.slice(p, after.length - s) });
  return out;
}

/** `base` changed two ways, apart: both, in place. (Enough for a test where the two never touch.) */
function merge(base: string, ours: string, theirs: string): string {
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const o = diff(base, ours);
  const t = diff(base, theirs);
  const at = (e: TextEdit[]) => ("insert" in e[0]! ? e[0].at : e[0]!.from);
  return at(o) < at(t) ? ours.slice(0, ours.length - (base.length - at(t))) + theirs.slice(at(t)) : theirs.slice(0, theirs.length - (base.length - at(o))) + ours.slice(at(o));
}

/** The loop an editor runs over `ctx.text` (apps/write-together/loop.ts), as plain as it can be. */
class EditorLoop {
  shown = "";
  base = "";
  private busy = false;
  private stale = false;
  constructor(
    private readonly text: CtxText,
    private readonly store: Store,
  ) {
    store.subscribe("doc", () => this.notified());
  }
  typed(next: string): void {
    this.shown = next;
    this.flush();
  }
  notified(): void {
    if (this.busy) this.stale = true;
    else this.round([], this.base);
  }
  private flush(): void {
    if (!this.busy && this.shown !== this.base) this.round(diff(this.base, this.shown), this.shown);
  }
  private round(edits: TextEdit[], sent: string): void {
    this.busy = true;
    this.stale = false;
    void this.text.edit(edits, { base: this.base }).then((row) => {
      this.busy = false;
      const theirs = String(row.body ?? "");
      const merged = merge(sent, this.shown, theirs);
      this.base = theirs;
      this.shown = merged;
      if (merged !== theirs) this.flush();
      else if (this.stale) this.notified();
    });
  }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("two editors over two real stores", () => {
  it("typing letter by letter at opposite ends at the same time, both keep their words and both screens agree", async () => {
    const pair = await createPeerPair("pad");
    const schema = { doc: pad().entities.doc!.fields };
    pair.a.describe?.(schema);
    pair.b.describe?.(schema);
    const ana = await person(pair.a, { id: "co_zAna", name: "Ana" });
    const bo = await person(pair.b, { id: "co_zBo", name: "Bo" });
    const doc = await ana.create("doc", { title: "Plan", body: "Hello from Ana." });
    await pair.settle();

    const a = new EditorLoop(ana.text("doc", doc.id, "body"), pair.a);
    const b = new EditorLoop(bo.text("doc", doc.id, "body"), pair.b);
    a.notified();
    b.notified();
    await tick(50);
    expect([a.shown, b.shown]).toEqual(["Hello from Ana.", "Hello from Ana."]);

    const left = "Note: ";
    const right = " And Bo.";
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (i < left.length) a.typed(left.slice(0, i + 1) + a.shown.slice(i));
      if (i < right.length) b.typed(b.shown + right[i]);
      await tick(30);
    }
    await pair.settle(800);
    await tick(100);
    const whole = "Note: Hello from Ana. And Bo.";
    expect(String((await ana.get("doc", doc.id))?.body)).toBe(whole);
    expect(String((await bo.get("doc", doc.id))?.body)).toBe(whole);
    expect(a.shown).toBe(whole);
    expect(b.shown).toBe(whole);

    // Who typed what, from the signing accounts: Ana's start and her opening line, then Bo's end.
    const runs = await ana.text("doc", doc.id, "body").runs();
    expect(runs.map((r) => r.text)).toEqual(["Note: Hello from Ana.", " And Bo."]);
    expect(runs[0]!.by).not.toBe(runs[1]!.by);
    await pair.close();
  });
});
