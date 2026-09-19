import { describe, expect, it } from "vitest";
import { attentionOf, describeAttention } from "../src/launcher-store.js";

// The launcher badge (#86): one number from the last-known counts, with reminders counted by time.

describe("attentionOf", () => {
  const now = Date.parse("2026-09-10T09:00:00Z");
  it("sums messages, and counts only reminders whose time has come", () => {
    const a = attentionOf(
      { key: "user:x", signals: { chat: 2, due: ["2026-09-09T00:00:00Z", "2026-09-10T09:00:00Z", "2026-09-11T00:00:00Z"] } },
      now,
    );
    expect(a).toEqual({ total: 4, chat: 2, due: 2 });
    expect(describeAttention(a)).toBe("2 messages · 2 due");
  });

  it("ignores an edit count left behind by an older build", () => {
    // Edits were counted here once. Dragging one item up a list patches every item it passed, so a
    // single move read as five changes and loading a backup read as hundreds — a number nobody could
    // act on, sitting on top of the one they could.
    const a = attentionOf({ key: "user:x", signals: { chat: 1, due: [], changes: 240 } as never }, now);
    expect(a).toEqual({ total: 1, chat: 1, due: 0 });
    expect(describeAttention(a)).toBe("1 message");
  });

  it("is zero for an app that never reported, and says nothing", () => {
    const a = attentionOf({ key: "user:x" }, now);
    expect(a.total).toBe(0);
    expect(describeAttention(a)).toBe("");
  });
});
