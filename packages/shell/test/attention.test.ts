import { describe, expect, it } from "vitest";
import { attentionOf, describeAttention } from "../src/launcher-store.js";

// The launcher badge (#86): one number from three last-known counts, with reminders counted by time.

describe("attentionOf", () => {
  const now = Date.parse("2026-09-10T09:00:00Z");
  it("sums chat and changes, and counts only reminders whose time has come", () => {
    const a = attentionOf(
      { key: "user:x", signals: { chat: 2, changes: 1, due: ["2026-09-09T00:00:00Z", "2026-09-10T09:00:00Z", "2026-09-11T00:00:00Z"] } },
      now,
    );
    expect(a).toEqual({ total: 5, chat: 2, changes: 1, due: 2 });
    expect(describeAttention(a)).toBe("2 messages · 1 change · 2 due");
  });

  it("is zero for an app that never reported, and says nothing", () => {
    const a = attentionOf({ key: "user:x" }, now);
    expect(a.total).toBe(0);
    expect(describeAttention(a)).toBe("");
  });
});
