import { describe, expect, it, vi } from "vitest";
import { guardedModify, noMatchInstruction, readEditsOrFile, readModifyReply, retryInstruction } from "../src/guarded-modify.js";
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

  // A block with a second ======= is the model splitting REPLACE in two — the divider line ends up
  // written into the file as text. Applying the good edit alongside it would be a silent partial
  // change, so nothing applies: the whole reply is reported as a no-match and retried.
  it("a reply with a malformed block applies nothing and reports it", () => {
    const good = `<<<<<<< SEARCH\n  id: "x",\n=======\n  id: "y",\n>>>>>>> REPLACE`;
    const brokenSecondDivider = `<<<<<<< SEARCH\nentities: { city: {}, place: {} },\n=======\nentities: { city: {} },\n=======\nplace: {},\n>>>>>>> REPLACE`;
    const reply = `${good}\n${brokenSecondDivider}\n`;
    const r = readModifyReply(SOURCE, reply);
    expect(r.kind).toBe("no-match");
    expect(r.kind === "no-match" && r.failures[0]!.reason).toBe("malformed");
  });

  // A model that echoes the format template next to a real answer used to fail: the placeholder
  // SEARCH matched nothing, so the whole reply was a no-match and a perfectly good file was thrown
  // away — twice, then "failed". The template's own placeholder lines are never a real edit.
  it("ignores an echoed template block and applies the real edit beside it", () => {
    const echoed =
      "```ts\n<<<<<<< SEARCH\n<consecutive lines copied from the app above, exactly as they are there>\n=======\n<what those lines become>\n>>>>>>> REPLACE\n```\n" +
      editReply('  id: "x",', '  id: "y",', "");
    const r = readModifyReply(SOURCE, echoed);
    expect(r).toMatchObject({ kind: "edits", applied: 1 });
    expect(r.kind === "edits" && r.source).toContain('"y"');
  });

  it("falls back to a whole file when the only edit blocks are echoed template", () => {
    const echoed =
      "```ts\n<<<<<<< SEARCH\n<consecutive lines copied from the app above, exactly as they are there>\n=======\n<what those lines become>\n>>>>>>> REPLACE\n```\n" +
      fileReply(SOURCE);
    expect(readModifyReply(SOURCE, echoed)).toEqual({ kind: "whole-file", source: SOURCE });
  });

  // The fix loop's contract is head-only markers; a NOT-IN-APP line mid-reply followed by a real
  // edit is prose there. `readEditsOrFile` is the reader without the diagnosis rule.
  it("readEditsOrFile never returns a diagnosis", () => {
    const r = readEditsOrFile(SOURCE, "NOT-IN-APP: the map owns taps.\n" + editReply('  id: "x",', '  id: "y",', ""));
    expect(r.kind).toBe("edits");
  });
});

describe("guardedModify", () => {
  const base = { shapeOf: shapes({}), before: BEFORE, instruction: "change the id", source: SOURCE };
  const LOSSY = 'export default defineApp({ id: "lossy" });';
  const BROKEN = 'export default defineApp({ BROKEN {{{';

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
    // The reason a person reads, not the instruction the model was given.
    expect(out.kind === "failed" && out.reason).toMatch(/could not point at the lines/i);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  // The retry budget, both retries spent: a no-match, then an edit that costs the app an entity, then
  // a loss retry that does not apply. Three calls, never a fourth, and the lossy result comes back
  // WITH its loss rather than as nothing.
  it("never makes a fourth call: no-match, then a lossy edit, then a loss retry that misses", async () => {
    const LOSSY_SOURCE = SOURCE.replace('"x"', '"lossy"');
    const attempt = vi
      .fn<(i: string) => Promise<string>>()
      .mockResolvedValueOnce(editReply("nope", "x"))
      .mockResolvedValueOnce(editReply('  id: "x",', '  id: "lossy",'))
      .mockResolvedValueOnce(editReply("nope again", "x"));
    const out = await guardedModify({
      ...base,
      attempt,
      shapeOf: shapes({ [LOSSY_SOURCE]: { entities: { city: {} }, pages: [] } }),
    });
    expect(out).toMatchObject({ kind: "source", via: "edits", trace: { attempts: 3, noMatchRetry: true, lossRetry: true } });
    expect(out.kind === "source" && out.loss).toMatch(/removes the "place" entity/);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  // THE OLD GATE, still here. An edit can delete a page on purpose; a whole-file reply can drop one
  // by accident. Either way the loss is named and the model gets one more try.
  it("retries once with the loss named when the result drops a page, whichever shape it came in", async () => {
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
    const attempt = vi.fn(async () => fileReply(LOSSY));
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({ [LOSSY]: { entities: { city: {} }, pages: [] } }) });
    expect(out).toMatchObject({ kind: "source", via: "whole-file", source: LOSSY, trace: { attempts: 2, lossRetry: true } });
    expect(out.kind === "source" && out.loss).toMatch(/removes the "place" entity/);
  });

  it("hands back the lossy result when the loss retry is unusable, rather than nothing", async () => {
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
    const attempt = vi.fn(async () => fileReply(BROKEN));
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({}, null) });
    expect(out).toMatchObject({ kind: "source", via: "whole-file", source: BROKEN, loss: null, trace: { attempts: 1 } });
  });

  it("keeps the original instruction intact in both retry texts", () => {
    const rt = retryInstruction("add a rating field", 'removes the "place" entity');
    expect(rt.startsWith("add a rating field")).toBe(true);
    // And it asks for the change as edits — telling the model to reproduce the app is the defect the
    // edit contract exists to remove.
    expect(rt).toMatch(/SEARCH\/REPLACE/);
    const nm = noMatchInstruction("add a rating field", [{ index: 0, reason: "not-found", search: "x", count: 0 }]);
    expect(nm.startsWith("add a rating field")).toBe(true);
    expect(nm).toMatch(/could not be applied/i);
  });

  // The trace on an early result must be a snapshot: a shared, mutated object would make a result
  // captured before the loss retry report attempts:3 afterwards.
  it("gives each result its own trace snapshot", async () => {
    const LOSSY = 'export default defineApp({ id: "lossy" });';
    const attempt = vi.fn<(i: string) => Promise<string>>().mockResolvedValueOnce(fileReply(LOSSY)).mockResolvedValueOnce("I give up.");
    const out = await guardedModify({ ...base, attempt, shapeOf: shapes({ [LOSSY]: { entities: { city: {} }, pages: [] } }) });
    expect(out.trace).toEqual({ attempts: 2, noMatchRetry: false, lossRetry: true });
    expect(Object.isFrozen(out.trace)).toBe(true);
  });
});
