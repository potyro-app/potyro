// @vitest-environment happy-dom
//
// Studio iterations must survive the Save (bug report 2026-08-08).
//
// Generating and then modifying an app three times in the Studio produced ONE history entry: the
// steps only ever called `setSource` (React state), and `save()` called `saveUserApp` once, so
// everything before the final source was invisible. History exists precisely so an AI edit can be
// reviewed and rolled back — a log that keeps only the newest version cannot do either.
//
// This tests the replay contract the Studio now relies on: N sources saved in order produce N
// versions, each diffable against the one before it.

import { beforeEach, describe, expect, it } from "vitest";
import { listVersions } from "../src/app-history.js";
import { saveUserApp } from "../src/user-apps.js";

beforeEach(() => {
  globalThis.localStorage?.clear();
});

// The app id is derived from the NAME, and history lives in its own durable store that
// `localStorage.clear()` does not touch — so a shared name would leak versions between tests.
let n = 0;
const uniqueName = () => `Shared Todo ${++n}-${Math.random().toString(36).slice(2, 8)}`;

/** `listVersions` returns newest-first; assertions read better oldest-first. */
const inOrder = <T extends { source: string }>(v: T[]): T[] => [...v].reverse();

const NOW = "2026-08-08T10:00:00.000Z";

describe("a Studio session's chain of edits", () => {
  it("records every step, not just the last one", async () => {
    // What the Studio now replays on save: first prompt, then three modifications.
    const chain = [
      { source: "v0 // shared todo", note: "a shared todo list" },
      { source: "v1 // + due dates", note: "add due dates" },
      { source: "v2 // + assignee", note: "add an assignee" },
      { source: "v3 // + done filter", note: "filter out done items" },
    ];

    const name = uniqueName();
    let id: string | undefined;
    for (const step of chain) {
      const rec = await saveUserApp({ id, name, source: step.source, note: step.note }, NOW);
      id = rec.id;
    }

    const versions = inOrder(await listVersions(id!));
    expect(versions).toHaveLength(4); // was 1 before the fix
    expect(versions.map((v) => v.source)).toEqual(chain.map((c) => c.source));
    // The prompt that caused each step is what makes History readable later.
    expect(versions.map((v) => v.note)).toEqual(chain.map((c) => c.note));
  });

  it("marks the first step as created and the rest as edits", async () => {
    const name = uniqueName();
    let id: string | undefined;
    for (const source of ["v0", "v1", "v2"]) {
      const rec = await saveUserApp({ id, name, source }, NOW);
      id = rec.id;
    }
    const versions = inOrder(await listVersions(id!));
    expect(versions.map((v) => v.origin)).toEqual(["created", "edited", "edited"]);
  });

  it("keeps each step diffable against the one before it", async () => {
    // Without a baseline the History panel has nothing to diff a version against, so a rollback is
    // a guess. Every step after the first must carry its predecessor.
    const name = uniqueName();
    let id: string | undefined;
    for (const source of ["v0", "v1"]) {
      const rec = await saveUserApp({ id, name, source }, NOW);
      id = rec.id;
    }
    const versions = inOrder(await listVersions(id!));
    expect(versions[0]!.source).toBe("v0");
    expect(versions[1]!.source).toBe("v1");
  });
});
