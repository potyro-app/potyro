// A text several people type into at once (text-field.ts), through the Store seam on two real nodes.
//
// The property under test is the one `docs/17` lists as the whole-value class: `update(id, { body })`
// from two devices keeps the newer save and loses the other's words. `editText` must keep both —
// and remember who typed what, from the signing session rather than from anything the app said.

import { describe, expect, it } from "vitest";
import { createPeerPair, type PeerPair } from "../src/peer-harness.js";
import type { Store } from "../src/types.js";

const DOC = { doc: { title: { type: "text" as const }, body: { type: "text" as const, multiline: true, collaborative: true } } };

async function pair(): Promise<PeerPair> {
  const p = await createPeerPair("pad");
  p.a.describe?.(DOC);
  p.b.describe?.(DOC);
  return p;
}

const body = async (s: Store, id: string): Promise<string> => String((await s.get("doc", id))?.body ?? "");

describe("JazzStore — a collaborative text field", () => {
  it("reads as one string, and edits land where they were asked", async () => {
    const { a, close } = await pair();
    const doc = await a.insert("doc", { title: "Plan", body: "Hello world" });
    expect(doc.body).toBe("Hello world");
    expect(await body(a, doc.id)).toBe("Hello world");

    expect(await a.editText!("doc", doc.id, "body", [{ at: 5, insert: "," }])).toBe("Hello, world");
    expect(await a.editText!("doc", doc.id, "body", [{ from: 0, to: 5 }, { at: 0, insert: "Goodbye" }])).toBe("Goodbye, world");
    expect(await a.editText!("doc", doc.id, "body", [{ at: 99, insert: "!" }])).toBe("Goodbye, world!");
    expect(await body(a, doc.id)).toBe("Goodbye, world!");
    expect((await a.all("doc"))[0]?.body).toBe("Goodbye, world!");
    await close();
  });

  it("counts UTF-16 units like app code does, and never splits a family", async () => {
    const { a, close } = await pair();
    const doc = await a.insert("doc", { body: "a👩‍👩‍👧b" });
    // Inside the family (unit 5): the insert lands after it.
    expect(await a.editText!("doc", doc.id, "body", [{ at: 5, insert: "X" }])).toBe("a👩‍👩‍👧Xb");
    // Deleting the family by its units.
    expect(await a.editText!("doc", doc.id, "body", [{ from: 1, to: 9 }])).toBe("aXb");
    await close();
  });

  it("two people typing at the same moment both keep their words (the whole-value hazard, closed)", async () => {
    const { a, b, settle, close } = await pair();
    const doc = await a.insert("doc", { body: "The plan: " });
    await settle();
    expect(await body(b, doc.id)).toBe("The plan: ");

    // Concurrent: neither has seen the other's edit yet.
    await Promise.all([a.editText!("doc", doc.id, "body", [{ at: 10, insert: "buy milk" }]), b.editText!("doc", doc.id, "body", [{ at: 4, insert: "big " }])]);
    await settle();

    const onA = await body(a, doc.id);
    const onB = await body(b, doc.id);
    expect(onA).toBe(onB);
    expect(onA).toContain("big ");
    expect(onA).toContain("buy milk");
    expect(onA).toBe("The big plan: buy milk");
    await close();
  });

  it("remembers who typed each stretch, from the signing session", async () => {
    const { a, b, settle, close } = await pair();
    const doc = await a.insert("doc", { body: "Ana wrote this. " });
    await settle();
    await b.editText!("doc", doc.id, "body", [{ at: 16, insert: "Bo added that." }]);
    await settle();

    const runs = await a.textRuns!("doc", doc.id, "body");
    expect(runs.map((r) => r.text)).toEqual(["Ana wrote this. ", "Bo added that."]);
    expect(runs[0]!.by).not.toBe(runs[1]!.by);
    expect(runs[0]!.by).toMatch(/^co_z/);
    expect(runs[1]!.by).toMatch(/^co_z/);
    // The same answer from the other side.
    expect(await b.textRuns!("doc", doc.id, "body")).toEqual(runs);
    await close();
  });

  it("an anchor follows its character through other people's edits, and goes once it is deleted", async () => {
    const { a, b, settle, close } = await pair();
    const doc = await a.insert("doc", { body: "one two three" });
    await settle();
    const anchor = await a.textAnchor!("doc", doc.id, "body", 4); // "t" of "two"
    const end = await a.textAnchor!("doc", doc.id, "body", 13);
    expect(await a.textIndex!("doc", doc.id, "body", anchor)).toBe(4);
    expect(await a.textIndex!("doc", doc.id, "body", end)).toBe(13);

    await b.editText!("doc", doc.id, "body", [{ at: 0, insert: "zero " }]);
    await settle();
    expect(await a.textIndex!("doc", doc.id, "body", anchor)).toBe(9);
    expect(await b.textIndex!("doc", doc.id, "body", anchor)).toBe(9);
    expect(await a.textIndex!("doc", doc.id, "body", end)).toBe(18);

    await b.editText!("doc", doc.id, "body", [{ from: 9, to: 13 }]); // "two " gone
    await settle();
    expect(await a.textIndex!("doc", doc.id, "body", anchor)).toBeNull();
    // A position anchor from before the app was shared still resolves, to where it was.
    expect(await a.textIndex!("doc", doc.id, "body", "i:3")).toBe(3);
    expect(await a.textIndex!("doc", doc.id, "body", "i:999")).toBe(14);
    expect(await a.textIndex!("doc", doc.id, "body", "garbage")).toBeNull();
    await close();
  });

  it("tells a subscriber when the OTHER person types", async () => {
    const { a, b, settle, close } = await pair();
    const doc = await a.insert("doc", { body: "" });
    await settle();
    let notified = 0;
    b.subscribe("doc", () => notified++);
    await settle();
    const before = notified;
    await a.editText!("doc", doc.id, "body", [{ at: 0, insert: "hi" }]);
    await settle();
    expect(notified).toBeGreaterThan(before);
    expect(await body(b, doc.id)).toBe("hi");
    await close();
  });

  it("a whole text written with update() replaces the words in place, so anchors on the end still hold", async () => {
    const { a, b, settle, close } = await pair();
    const doc = await a.insert("doc", { body: "draft" });
    await settle();
    await a.update("doc", doc.id, { body: "final text" });
    await settle();
    expect(await body(b, doc.id)).toBe("final text");
    expect((await b.textRuns!("doc", doc.id, "body")).map((r) => r.text)).toEqual(["final text"]);
    await close();
  });

  it("a plain string written before the field was collaborative gets its text on the first edit", async () => {
    const { a, b, settle, close } = await pair();
    // A copy that knew nothing of the field: `note.text` is not described, so it is stored plain.
    const doc = await a.insert("note", { text: "old words" });
    await settle();
    expect(await a.editText!("note", doc.id, "text", [{ at: 9, insert: "!" }])).toBe("old words!");
    await settle();
    expect(String((await b.get("note", doc.id))?.text)).toBe("old words!");
    expect((await b.textRuns!("note", doc.id, "text")).length).toBe(1);
    await close();
  });

  it("an edit to someone else's row in a creator-only entity is refused, like any other change", async () => {
    const { a, b, settle, close } = await pair();
    const rules = { creatorOnly: ["doc"] };
    a.describe?.(DOC, rules);
    b.describe?.(DOC, rules);
    const doc = await a.insert("doc", { body: "mine" });
    await settle();
    await expect(b.editText!("doc", doc.id, "body", [{ at: 0, insert: "x" }])).rejects.toThrow(/Only the person who added this/);
    await close();
  });
});
