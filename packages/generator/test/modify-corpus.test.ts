import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/edits.js";
import { MODIFY_CASES, type DefinitionShape } from "../src/modify-corpus.js";
import { loadApp, scoreSource } from "../src/score.js";

// The corpus's new case classes (docs/19 F9), proven against the real apps before any model sees
// them: each predicate is false on the app as it is, and true on a change a person would accept —
// so a case can neither pass by doing nothing nor be impossible to pass. The right changes below
// are written by hand for that proof only; nothing reads them during an eval.

const here = dirname(fileURLToPath(import.meta.url));
const dirs = [resolve(here, "../../../examples"), resolve(here, "../fixtures")];
function appFile(app: string): string {
  const f = dirs.flatMap((d) => [join(d, `${app}.app.ts`), join(d, `${app}.app.tsx`)]).find((p) => existsSync(p));
  if (!f) throw new Error(`no app ${app}`);
  return f;
}
const shape = async (src: string, dir: string) => (await loadApp(src, dir)) as unknown as DefinitionShape;

/** A right change for each new case: [search, replace] against the app as it is. */
const RIGHT: Record<string, Array<[string, string]>> = {
  "plants-no-more-pages": [
    [
      '      title: "Plants",\n      view: {\n        type: "list",\n        entity: "plant",',
      '      title: "Plants",\n      view: {\n        type: "list",\n        entity: "plant",\n        filters: [{ label: "Direct sun", param: "sun", type: "boolean" }],\n        filter: (p, ctx) => !ctx.params.sun || p.needsDirectSun,',
    ],
  ],
  "workout-rating-out-of-10": [["        durationSec: { type: \"number\", hidden: true },", "        durationSec: { type: \"number\", hidden: true },\n        rating: { type: \"number\", min: 0, max: 10, integer: true },"]],
  "recipes-put-spice-back": [
    ['        photo: { type: "media", accept: "image" },\n        tags: { type: "tags", options: ["breakfast", "lunch", "dinner", "snack", "vegetarian", "vegan"] },', '        photo: { type: "media", accept: "image" },\n        spiciness: { type: "enum", options: ["mild", "medium", "hot"], colors: { mild: "green", medium: "yellow", hot: "red" } },\n        tags: { type: "tags", options: ["breakfast", "lunch", "dinner", "snack", "vegetarian", "vegan"] },'],
  ],
  "plants-scan-barcode": [['        wiki: { type: "url" },', '        wiki: { type: "url" },\n        barcode: { type: "text" },']],
  "workout-heart-rate-strap": [["        durationSec: { type: \"number\", hidden: true },", "        durationSec: { type: \"number\", hidden: true },\n        avgHeartRate: { type: \"number\", unit: \"bpm\", integer: true },"]],
  "places-phone-wrong-gate": [['        notes: { type: "text", multiline: true },', '        notes: { type: "text", multiline: true },\n        phone: { type: "text" },']],
};

describe("the modify corpus", () => {
  it("has unique ids, and every class case carries what its class needs", () => {
    const ids = MODIFY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of MODIFY_CASES) {
      if (c.class === "conversation") expect(c.earlier?.length, c.id).toBeGreaterThan(0);
      if (c.class === "wrong-gate") expect(c.gateRefuses, c.id).toBeTruthy();
      if (c.class === "platform") expect(c.notDone?.length, c.id).toBeGreaterThan(0);
      if (c.class !== "wrong-gate") expect(c.gateRefuses, c.id).toBeUndefined();
    }
    expect(MODIFY_CASES.filter((c) => c.class).map((c) => c.class)).toEqual(
      expect.arrayContaining(["conversation", "platform", "wrong-gate"]),
    );
  });

  for (const c of MODIFY_CASES.filter((x) => x.class)) {
    it(`${c.id}: not landed on the app as it is, landed on a right change that validates`, async () => {
      const file = appFile(c.app);
      const dir = dirname(file);
      const source = readFileSync(file, "utf8");
      const before = await shape(source, dir);
      expect(c.landed!(before, before)).toBe(false);
      const edits = RIGHT[c.id];
      expect(edits, `no right change written for ${c.id}`).toBeDefined();
      const applied = applyEdits(source, edits!.map(([search, replace]) => ({ search, replace })));
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      const after = applied.ok ? applied.source : source;
      const score = await scoreSource(after, dir);
      expect(score.errors).toEqual([]);
      expect(score.validates).toBe(true);
      expect(c.landed!(await shape(after, dir), before)).toBe(true);
    }, 30_000);
  }
});
