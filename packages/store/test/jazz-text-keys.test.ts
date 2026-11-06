import { describe, expect, it } from "vitest";
import { createPeerPair } from "../src/peer-harness.js";

const DOC = { doc: { body: { type: "text" as const, multiline: true, collaborative: true } } };

describe("keystrokes one at a time", () => {
  it("prepends a word letter by letter", async () => {
    const { a, close } = await createPeerPair("keys");
    a.describe?.(DOC);
    const doc = await a.insert("doc", { body: "Hello from Ana." });
    const word = "Note: ";
    for (let i = 0; i < word.length; i++) await a.editText!("doc", doc.id, "body", [{ at: i, insert: word[i]! }]);
    expect(String((await a.get("doc", doc.id))?.body)).toBe("Note: Hello from Ana.");
    await close();
  });

  it("two people typing letter by letter at opposite ends, at the same time", async () => {
    const { a, b, settle, close } = await createPeerPair("keys2");
    a.describe?.(DOC);
    b.describe?.(DOC);
    const doc = await a.insert("doc", { body: "Hello from Ana." });
    await settle();
    const left = "Note: ";
    const right = " And Bo.";
    const typeA = (async () => {
      for (let i = 0; i < left.length; i++) {
        await a.editText!("doc", doc.id, "body", [{ at: i, insert: left[i]! }]);
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    const typeB = (async () => {
      // Bo's end moves as Ana's letters land in front: he appends, wherever the end is now.
      for (let i = 0; i < right.length; i++) {
        await b.editText!("doc", doc.id, "body", [{ at: Number.MAX_SAFE_INTEGER, insert: right[i]! }]);
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    await Promise.all([typeA, typeB]);
    await settle(600);
    const onA = String((await a.get("doc", doc.id))?.body);
    const onB = String((await b.get("doc", doc.id))?.body);
    expect(onA).toBe(onB);
    expect(onA).toBe("Note: Hello from Ana. And Bo.");
    await close();
  });
});
