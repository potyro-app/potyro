import { describe, expect, it, vi } from "vitest";
import { guardedModify, noMatchInstruction, readModifyReply, retryInstruction } from "../src/guarded-modify.js";
import type { AppShape } from "@karta/runtime";

// The app as the person has it: two entities, two pages. A rewrite typically keeps one and drops the
// rest — that is the shape the first real modify came back in.
const BEFORE: AppShape = {
  entities: { city: {}, place: {} },
  pages: [
    { id: "cities", view: { type: "list", entity: "city" } },
    { id: "places", view: { type: "list", entity: "place" } },
  ],
};

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { city: {}, place: {} },", "});"].join("\n");

const editReply = (search: string, replace: string, prose = "Changing the id.") =>
  `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;
const fileReply = (body: string) => "```ts\n" + body + "\n```";

// `shapeOf` is keyed on the source string so a test can script exactly what each candidate "is".
// Unknown sources load as BEFORE — the common case is an edit that keeps the app's shape.
const shapes = (table: Record<string, AppShape>, fallback: AppShape | null = BEFORE) => async (source: string): Promise<AppShape> => {
  const s = table[source] ?? fallback;
  if (!s) throw new Error(`does not load: ${source}`);
  return s;
};

describe("readModifyReply", () => {
  it("applies edit blocks to the source and keeps the prose as rationale", () => {
    const r = readModifyReply(SOURCE, editReply('  id: "x",', '  id: "y",'));
    expect(r).toEqual({ kind: "edits", source: SOURCE.replace('"x"', '"y"'), applied: 1, rationale: "Changing the id." });
  });

  it("reports edits that do not match instead of guessing", () => {
    const r = readModifyReply(SOURCE, editReply("  id: 'x',", '  id: "y",'));
    expect(r.kind).toBe("no-match");
  });

  // Still accepted, so a good whole-file reply is not thrown away — but labelled, so the eval can
  // count how often the model ignores the format, and the Studio can say so.
  it("accepts a whole-file reply as a fallback, labelled as such", () => {
    const r = readModifyReply(SOURCE, "Here you go:\n" + fileReply(SOURCE));
    expect(r).toEqual({ kind: "whole-file", source: SOURCE, rationale: "Here you go:" });
  });

  it("a NOT-IN-APP verdict wins over edits in the same reply", () => {
    const r = readModifyReply(SOURCE, "NOT-IN-APP: the map owns taps." + editReply('  id: "x",', '  id: "y",', ""));
    expect(r).toEqual({ kind: "diagnosis", text: "the map owns taps." });
  });

  it("prose with neither edits nor an app is unusable", () => {
    expect(readModifyReply(SOURCE, "I would add a field.")).toEqual({ kind: "unusable", text: "I would add a field." });
  });
});

describe("guardedModify", () => {
  const base = { shapeOf: shapes({}), before: BEFORE, instruction: "change the id", source: SOURCE };

  it("applies a good edit reply on the first call", async () => {
    const attempt = vi.fn(async () => editReply('  id: "x",', '  id: "y",'));
    const out = await guardedModify({ ...base, attempt });
    expect(out).toMatchObject({ kind: "source", via: "edits", applied: 1, loss: null, trace: { attempts: 1, noMatchRetry: false, lossRetry: false } });
    expect(out.kind === "source" && out.source).toContain('"y"');
  });

  // THE NEW RETRY. A SEARCH that is not in the file is the model's mistake, and it is told which
  // edit and why, then asked once more. The second reply applies.
  it("retries once with the failing edit named when SEARCH does not match", async () => {
    const attempt = vi
      .fn<(i: string) => Promise<string>>()
      .mockResolvedValueOnce(editReply("  id: 'x',", '  id: "y",'))
      .mockResolvedValueOnce(editReply('  id: "x",', '  id: "y",'));
    const out = await guardedModify({ ...base, attempt });
    expect(out).toMatchObject({ kind: "source", via: "edits", trace: { attempts: 2, noMatchRetry: true, lossRetry: false } });
    const second = attempt.mock.calls[1]![0];
    expect(second.startsWith("change the id")).toBe(true);
    expect(second).toMatch(/edit 1.*not found/i);
  });

  it("fails, never loops, when the retry does not match either", async () => {
    const attempt = vi.fn(async () => editReply("nope", "x"));
    const out = await guardedModify({ ...base, attempt });
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.reason).toMatch(/not found/i);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  // THE OLD GATE, still here. An edit can delete a page on purpose; a whole-file reply can drop one
  // by accident. Either way the loss is named and the model gets one more try.
  it("retries once with the loss named when the result drops a page, whichever shape it came in", async () => {
    const LOSSY = "LOSSY";
    const attempt = vi
      .fn<(i: string) => Promise<string>>()
      .mockResolvedValueOnce(fileReply(LOSSY))
      .mockResolvedValueOnce(editReply('  id: "x",', '  id: "y",'));
    const out = await guardedModify({
      ...base,
      attempt,
      shapeOf: shapes({ [LOSSY]: { entities: { city: {} }, pages: [BEFORE.pages[0]!] } }),
    });
    expect(out).toMatchObject({ kind: "source", via: "edits", loss: null, trace: { attempts: 2, noMatchRetry: false, lossRetry: true } });
    expect(attempt.mock.calls[1]![0]).toMatch(/removes the "place" entity/);
  });

  it("hands back the lossy result WITH its loss when the loss retry does not help", async () => {
    const LOSSY = "LOSSY";
    const attempt = vi.fn(async () => fileReply(LOSSY));
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({ [LOSSY]: { entities: { city: {} }, pages: [] } }) });
    expect(out).toMatchObject({ kind: "source", via: "whole-file", source: LOSSY, trace: { attempts: 2, lossRetry: true } });
    expect(out.kind === "source" && out.loss).toMatch(/removes the "place" entity/);
  });

  it("hands back the lossy result when the loss retry is unusable, rather than nothing", async () => {
    const LOSSY = "LOSSY";
    const attempt = vi.fn<(i: string) => Promise<string>>().mockResolvedValueOnce(fileReply(LOSSY)).mockResolvedValueOnce("I give up.");
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({ [LOSSY]: { entities: { city: {} }, pages: [] } }) });
    expect(out).toMatchObject({ kind: "source", source: LOSSY });
    expect(out.kind === "source" && out.loss).toMatch(/removes the "place" entity/);
  });

  it("returns a diagnosis as a diagnosis, with no retry", async () => {
    const attempt = vi.fn(async () => "NOT-IN-APP: the map view owns taps.");
    const out = await guardedModify({ ...base, attempt });
    expect(out).toEqual({ kind: "diagnosis", text: "the map view owns taps.", trace: { attempts: 1, noMatchRetry: false, lossRetry: false } });
  });

  it("does not retry a candidate that cannot be judged because it does not load", async () => {
    const attempt = vi.fn(async () => fileReply("BROKEN {{{"));
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({}, null) });
    expect(out).toMatchObject({ kind: "source", via: "whole-file", source: "BROKEN {{{", loss: null, trace: { attempts: 1 } });
  });

  it("keeps the original instruction intact in both retry texts", () => {
    expect(retryInstruction("add a rating field", 'removes the "place" entity').startsWith("add a rating field")).toBe(true);
    const nm = noMatchInstruction("add a rating field", [{ index: 0, reason: "not-found", search: "x", count: 0 }]);
    expect(nm.startsWith("add a rating field")).toBe(true);
    expect(nm).toMatch(/could not be applied/i);
  });
});
