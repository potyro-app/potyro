// The Studio's thread read back from history. Reported on apps.vaz.io: opening a shared app in the
// Studio showed "shared with you" with "Working…" under it, for ever — every version without a
// stored answer looked like a question the model was still thinking about.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppVersion } from "../src/app-history.js";
import { SYSTEM_NOTES, turnsFromHistory } from "../src/studio-thread.js";

const version = (seq: number, origin: AppVersion["origin"], note?: string, rationale?: string): AppVersion => ({
  id: `r${seq}`,
  appId: "todo",
  seq,
  source: `// v${seq}`,
  createdAt: "2026-09-25T10:00:00.000Z",
  origin,
  ...(note ? { note } : {}),
  ...(rationale ? { rationale } : {}),
});

// Newest-first, the way `listVersions` returns them.
const HISTORY = [
  version(5, "edited", "add due dates", "Added a due date field and sorted by it."),
  version(4, "adjusted", `changed "Todo" to "Tasks"`),
  version(3, "restored", "rolled back to version 1"),
  version(2, "edited", "make it a checklist"),
  version(1, "imported", "shared with you"),
];

describe("turnsFromHistory", () => {
  it("never leaves a turn read back from history waiting — nothing is working on it", () => {
    const turns = turnsFromHistory(HISTORY);
    expect(turns.filter((t) => !t.event && t.outcome === undefined)).toEqual([]);
  });

  it("shows the app arriving, a rollback and a hand edit as events, not as questions", () => {
    const turns = turnsFromHistory(HISTORY);
    expect(turns.map((t) => [t.prompt, t.event ?? false])).toEqual([
      ["shared with you", true],
      ["make it a checklist", false],
      ["rolled back to version 1", true],
      [`changed "Todo" to "Tasks"`, true],
      ["add due dates", false],
    ]);
  });

  it("answers a request with the model's own explanation when it left one, else that it was saved", () => {
    const turns = turnsFromHistory(HISTORY);
    expect(turns.find((t) => t.prompt === "add due dates")?.outcome).toBe("Added a due date field and sorted by it.");
    expect(turns.find((t) => t.prompt === "make it a checklist")?.outcome).toBe("Saved.");
  });

  it("leaves out versions with no note, and keeps each turn's version number", () => {
    const turns = turnsFromHistory([version(2, "edited"), version(1, "created", "a todo list")]);
    expect(turns).toEqual([{ id: "v1", prompt: "a todo list", outcome: "Saved.", seq: 1 }]);
  });

  it("shows the shell's own versions — an example, a copy, the history baseline — as events", () => {
    const turns = turnsFromHistory([
      version(4, "created", "from your account, replacing this device's copy"),
      version(3, "created", "the source before history was kept"),
      version(2, "created", "copied from “Groceries”"),
      version(1, "created", "example app"),
    ]);
    expect(turns.every((t) => t.event)).toBe(true);
    // A person's first request creates an app too — that stays an exchange.
    expect(turnsFromHistory([version(1, "created", "a reading tracker with a rating")])[0]?.event).toBeUndefined();
  });

  it("knows every note the shell writes on a created version", () => {
    // The writers, read as text: a new system note there must be added to SYSTEM_NOTES, or it shows
    // up in the Studio as something the person asked for.
    const src = (f: string) => readFileSync(resolve(process.cwd(), "src", f), "utf8");
    const written = [
      ...src("examples.ts").matchAll(/origin: "created", note: "([^"]+)"/g),
      ...src("app-history.ts").matchAll(/origin: "created",\s*note: "([^"]+)"/g),
    ].map((m) => m[1]!);
    written.push("copied from “X”", "from your account");
    expect(written.length).toBeGreaterThan(3);
    for (const note of written) expect(SYSTEM_NOTES.some((re) => re.test(note)), note).toBe(true);
  });
});
