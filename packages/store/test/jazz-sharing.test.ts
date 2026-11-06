// A record shared on its own (record-sharing.ts), through the Store seam on real nodes: Ana and Bo
// share an app; Cy has nothing of theirs and gets ONE document by its link — with its comments, live,
// and nothing else of the app's.
import { describe, expect, it } from "vitest";
import { createPeerPair, type PeerPair } from "../src/peer-harness.js";
import type { Store } from "../src/types.js";

const SCHEMA = {
  doc: { title: { type: "text" as const }, body: { type: "text" as const, multiline: true, collaborative: true } },
  comment: { doc: { type: "relation" as const, to: "doc" }, text: { type: "text" as const } },
  note: { text: { type: "text" as const } },
};
const RULES = { sharedRecords: ["doc"] };

async function pair(): Promise<PeerPair> {
  const p = await createPeerPair("pad");
  p.a.describe?.(SCHEMA, RULES);
  p.b.describe?.(SCHEMA, RULES);
  return p;
}
async function stranger(p: PeerPair): Promise<Store> {
  const c = await p.another!("Cy");
  c.describe?.(SCHEMA, RULES);
  return c;
}
const titles = async (s: Store) => (await s.all("doc")).map((d) => d.title).sort();
const texts = async (s: Store) => (await s.all("comment")).map((c) => c.text).sort();

describe("JazzStore — a record shared on its own", () => {
  it("a shared record and the records that point at it reach the app's members as before", async () => {
    const { a, b, settle, close } = await pair();
    const plan = await a.insert("doc", { title: "Plan", body: "Hello" });
    await a.insert("doc", { title: "Private", body: "Mine" });
    await a.insert("comment", { doc: plan.id, text: "first" });
    await a.insert("note", { text: "a note" });
    await settle();
    expect(await titles(b)).toEqual(["Plan", "Private"]);
    expect(await texts(b)).toEqual(["first"]);
    expect((await b.get("comment", (await b.all("comment"))[0]!.id))?.text).toBe("first");
    // The app's members have in the record what they have in the app.
    expect(await a.recordAccess!("doc", plan.id)).toBe("admin");
    expect(await b.recordAccess!("doc", plan.id)).toBe("writer");
    await b.insert("comment", { doc: plan.id, text: "from Bo" });
    await b.editText!("doc", plan.id, "body", [{ at: 5, insert: "!" }]);
    await settle();
    expect(await texts(a)).toEqual(["first", "from Bo"]);
    expect((await a.get("doc", plan.id))?.body).toBe("Hello!");
    await close();
  });

  it("someone with only the document's link gets that document, its comments, and nothing else", async () => {
    const p = await pair();
    const { a, b, settle, close } = p;
    const plan = await a.insert("doc", { title: "Plan", body: "Hello" });
    const secret = await a.insert("doc", { title: "Private", body: "Mine" });
    await a.insert("comment", { doc: plan.id, text: "first" });
    await a.insert("comment", { doc: secret.id, text: "private comment" });
    await a.insert("note", { text: "a note" });
    await settle();

    const invite = await a.createRecordInvite!("doc", plan.id, "writer");
    expect(invite).toMatchObject({ entity: "doc", id: plan.id });
    const c = await stranger(p);
    expect(await c.all("doc")).toEqual([]);
    const joined = await c.joinRecord!(invite);
    await settle(600);
    expect(joined?.title).toBe("Plan");
    expect(await titles(c)).toEqual(["Plan"]);
    expect((await c.get("doc", plan.id))?.body).toBe("Hello");
    expect(await c.get("doc", secret.id)).toBeNull();
    expect(await texts(c)).toEqual(["first"]);
    expect(await c.all("note")).toEqual([]);
    expect(await c.recordAccess!("doc", plan.id)).toBe("writer");

    // Cy writes: the words and a comment reach Ana and Bo; Bo's reach Cy.
    await c.editText!("doc", plan.id, "body", [{ at: 5, insert: " Cy" }]);
    await c.insert("comment", { doc: plan.id, text: "from Cy" });
    await settle(600);
    expect((await a.get("doc", plan.id))?.body).toBe("Hello Cy");
    expect(await texts(a)).toEqual(["first", "from Cy", "private comment"]);
    expect(await texts(b)).toEqual(["first", "from Cy", "private comment"]);
    await b.insert("comment", { doc: plan.id, text: "from Bo" });
    await settle(600);
    expect(await texts(c)).toEqual(["first", "from Bo", "from Cy"]);
    // Cy may not pass the document on: only its maker invites.
    await expect(c.createRecordInvite!("doc", plan.id, "writer")).rejects.toThrow(/Only the person who made this/);
    await expect(b.createRecordInvite!("doc", plan.id, "writer")).rejects.toThrow(/Only the person who made this/);
    await close();
  });

  it("a read-only link lets its holder look and not change", async () => {
    const p = await pair();
    const { a, settle, close } = p;
    const plan = await a.insert("doc", { title: "Plan", body: "Hello" });
    await settle();
    const d = await stranger(p);
    await d.joinRecord!(await a.createRecordInvite!("doc", plan.id, "reader"));
    await settle(600);
    expect((await d.get("doc", plan.id))?.body).toBe("Hello");
    expect(await d.recordAccess!("doc", plan.id)).toBe("reader");
    await expect(d.editText!("doc", plan.id, "body", [{ at: 0, insert: "x" }])).rejects.toThrow(/can't change this|can only view/);
    await settle();
    expect((await a.get("doc", plan.id))?.body).toBe("Hello");
    await close();
  });

  it("a comment that arrives through the document notifies the subscriber, and a deleted one goes for everyone", async () => {
    const p = await pair();
    const { a, settle, close } = p;
    const plan = await a.insert("doc", { title: "Plan", body: "Hello" });
    await settle();
    const c = await stranger(p);
    await c.joinRecord!(await a.createRecordInvite!("doc", plan.id, "writer"));
    await settle(600);
    let notified = 0;
    a.subscribe("comment", () => notified++);
    await settle();
    const before = notified;
    const theirs = await c.insert("comment", { doc: plan.id, text: "from Cy" });
    await settle(600);
    expect(notified).toBeGreaterThan(before);
    expect(await texts(a)).toEqual(["from Cy"]);
    await c.delete("comment", theirs.id);
    await settle(600);
    expect(await texts(a)).toEqual([]);
    expect(await texts(c)).toEqual([]);
    await close();
  });

  it("a shared record's own bookkeeping never shows as a field", async () => {
    const { a, close } = await pair();
    const plan = await a.insert("doc", { title: "Plan", body: "" });
    expect(Object.keys((await a.get("doc", plan.id))!).some((k) => k.includes("\u0004"))).toBe(false);
    await close();
  });
});
