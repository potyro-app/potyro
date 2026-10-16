// What becomes of each app that moves in (move-plan.ts): merge, never duplicate — and an app runs
// directly on the new site only if it was the person's own.

import { describe, expect, it } from "vitest";
import { arrivesTrusted, planMove, receivedKey, sourceHash, type TargetApp } from "../src/move-plan.js";
import type { MovedApp } from "../src/move-archive.js";

const FROM = "https://apps.vaz.io";
const app = (over: Partial<MovedApp> & { id: string }): MovedApp => ({
  name: over.id,
  source: `// ${over.id}`,
  trusted: true,
  wasShared: false,
  entities: ["item"],
  records: 1,
  files: 0,
  missingFiles: 0,
  ...over,
});
const here = (...apps: TargetApp[]): Map<string, TargetApp> => new Map(apps.map((a) => [a.id, a]));
const opts = { via: "window" as const, from: FROM, received: {} };

describe("planning a move", () => {
  it("brings an app that is not here as it was", () => {
    const [p] = planMove([app({ id: "notes" })], here(), opts);
    expect(p).toMatchObject({ kind: "new", id: "notes", trusted: true });
  });

  it("joins an app with the same code, keeping the one here as it is", () => {
    const [p] = planMove([app({ id: "notes" })], here({ id: "notes", source: "// notes" }), opts);
    expect(p).toMatchObject({ kind: "merge", id: "notes" });
  });

  it("an untouched example joins the one here; an edited one replaces an untouched one", () => {
    const target = here({ id: "recipes", source: "// newer recipes", example: "untouched" });
    expect(planMove([app({ id: "recipes", source: "// older recipes", example: "untouched" })], target, opts)[0]!.kind).toBe("merge");
    expect(planMove([app({ id: "recipes", source: "// my recipes", example: "edited" })], target, opts)[0]!.kind).toBe("replace");
  });

  it("puts an app changed on both sides beside the one here, under an id nothing uses", () => {
    const plans = planMove(
      [app({ id: "notes", source: "// a" }), app({ id: "notes-2", source: "// b" })],
      here({ id: "notes", source: "// c" }, { id: "notes-2", source: "// d" }),
      opts,
    );
    expect(plans.map((p) => [p.kind, p.id])).toEqual([
      ["copy", "notes-3"],
      ["copy", "notes-4"],
    ]);
  });

  it("does it again into the same place, never a third copy", () => {
    const received = { [receivedKey(FROM, "notes")]: { id: "notes-2", sourceHash: sourceHash("// a") } };
    const target = here({ id: "notes", source: "// c" }, { id: "notes-2", source: "// a" });
    // Unchanged on both sides: the records join.
    expect(planMove([app({ id: "notes", source: "// a" })], target, { ...opts, received })[0]).toMatchObject({ kind: "merge", id: "notes-2" });
    // Changed there, untouched here since: the new code replaces it, still in the same place.
    expect(planMove([app({ id: "notes", source: "// a2" })], target, { ...opts, received })[0]).toMatchObject({ kind: "replace", id: "notes-2" });
    // Changed here since: what was done here is kept.
    const edited = here({ id: "notes", source: "// c" }, { id: "notes-2", source: "// edited here" });
    expect(planMove([app({ id: "notes", source: "// a2" })], edited, { ...opts, received })[0]).toMatchObject({ kind: "merge", id: "notes-2" });
  });

  it("runs directly only an app that was trusted AND the person's own, and only over the window", () => {
    expect(arrivesTrusted(app({ id: "a" }), "window")).toBe(true);
    expect(arrivesTrusted(app({ id: "a", trusted: false }), "window")).toBe(false);
    expect(arrivesTrusted(app({ id: "a", link: "https://potyro.app/#app=x" }), "window")).toBe(false);
    expect(arrivesTrusted(app({ id: "a", credit: { name: "Tally", by: "Bea" } }), "window")).toBe(false);
    expect(arrivesTrusted(app({ id: "a", joined: true }), "window")).toBe(false);
    // A file can come from anyone.
    expect(arrivesTrusted(app({ id: "a" }), "file")).toBe(false);
  });
});
