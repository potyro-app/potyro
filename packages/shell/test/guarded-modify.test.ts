import { describe, expect, it, vi } from "vitest";
import { guardedModify, retryInstruction } from "../src/guarded-modify.js";
import type { AppShape } from "../src/verify-candidate.js";

// The app as the person has it: two entities, two pages. A rewrite typically keeps one and drops the
// rest — that is the shape the first real modify came back in.
const BEFORE: AppShape = {
  entities: { city: {}, place: {} },
  pages: [
    { id: "cities", view: { type: "list", entity: "city" } },
    { id: "places", view: { type: "list", entity: "place" } },
  ],
};

// `shapeOf` is keyed on the source string so a test can script exactly what each attempt "is".
const shapes = (table: Record<string, AppShape>) => async (source: string): Promise<AppShape> => {
  const s = table[source];
  if (!s) throw new Error(`does not load: ${source}`);
  return s;
};

describe("guardedModify", () => {
  it("returns a good first attempt untouched, without retrying", async () => {
    const attempt = vi.fn(async () => "GOOD");
    const out = await guardedModify({
      attempt,
      shapeOf: shapes({ GOOD: BEFORE }),
      before: BEFORE,
      instruction: "add a rating field",
    });

    expect(out).toEqual({ source: "GOOD", loss: null, retried: false });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  // THE CASE THIS EXISTS FOR. The first reply dropped an entity; the person must never see it.
  it("retries once, telling the model exactly what it dropped, and returns the repaired attempt", async () => {
    const attempt = vi
      .fn<(i: string) => Promise<string>>()
      .mockResolvedValueOnce("REWRITE")
      .mockResolvedValueOnce("REPAIRED");
    const out = await guardedModify({
      attempt,
      shapeOf: shapes({
        REWRITE: { entities: { city: {} }, pages: [{ id: "cities", view: { type: "list", entity: "city" } }] },
        REPAIRED: BEFORE,
      }),
      before: BEFORE,
      instruction: "add a rating field",
    });

    expect(out).toEqual({ source: "REPAIRED", loss: null, retried: true });
    expect(attempt).toHaveBeenCalledTimes(2);
    // The second turn names the loss, verbatim, so the model is not guessing at what went wrong.
    const second = attempt.mock.calls[1]![0];
    expect(second).toContain("add a rating field");
    expect(second).toMatch(/removes the "place" entity/);
    expect(second).toMatch(/apply only the change above/i);
  });

  // Never silent, never a third call: if the retry ALSO rewrites, hand it back WITH the loss so the
  // caller can say so loudly, rather than looping or pretending it was fine.
  it("returns the second attempt with its loss attached when the retry does not help", async () => {
    const attempt = vi.fn(async () => "REWRITE");
    const out = await guardedModify({
      attempt,
      shapeOf: shapes({ REWRITE: { entities: { city: {} }, pages: [] } }),
      before: BEFORE,
      instruction: "add a rating field",
    });

    expect(out.retried).toBe(true);
    expect(out.source).toBe("REWRITE");
    expect(out.loss).toMatch(/removes the "place" entity/);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  // A candidate that does not load is a different failure with its own reporting path (the preview's
  // validation). Guessing that it "lost" something and burning a retry on that guess would be wrong
  // twice over.
  it("does not retry a candidate that cannot be judged because it does not load", async () => {
    const attempt = vi.fn(async () => "BROKEN {{{");
    const out = await guardedModify({
      attempt,
      shapeOf: shapes({}),
      before: BEFORE,
      instruction: "add a rating field",
    });

    expect(out).toEqual({ source: "BROKEN {{{", loss: null, retried: false });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("keeps the original instruction intact in the retry", () => {
    const text = retryInstruction("add a rating field", 'removes the "place" entity the app already had');
    expect(text.startsWith("add a rating field")).toBe(true);
    expect(text).toContain('Your previous attempt removes the "place" entity');
  });
});
