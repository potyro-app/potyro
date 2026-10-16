import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/edits.js";
import { MODIFY_CASES, type DefinitionShape } from "../src/modify-corpus.js";
import { DEFAULT_RECAP_ROUNDS, recapCoverage, requestsBack } from "../src/agent/conversation.js";
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
// The examples are in six languages (#303), so a right change gives its new words in all six: one
// in English only is a gap the check sends back.
const PLANTS_LIST_FILTERS =
  '            placeholder: { en: "Name or label", "pt-BR": "Nome ou etiqueta", de: "Name oder Schlagwort", es: "Nombre o etiqueta", pl: "Nazwa lub etykieta", it: "Nome o etichetta" },\n          },';
const PLANTS_LIST_RETURN =
  "          return !q || p.name.toLowerCase().includes(q) || ((p.labels as string[] | undefined) ?? []).some((l) => l.toLowerCase().includes(q));";
const RECIPE_PHOTO = '        photo: { type: "media", accept: "image", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },';
const PLACE_NOTES = '        notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },';
const RIGHT: Record<string, Array<[string, string]>> = {
  "plants-no-more-pages": [
    [
      // The Plants list's search chip, then a second chip; its filter keeps the search and adds sun.
      `${PLANTS_LIST_FILTERS}`,
      `${PLANTS_LIST_FILTERS}\n          { label: { en: "Direct sun", "pt-BR": "Sol direto", de: "Direkte Sonne", es: "Sol directo", pl: "Pełne słońce", it: "Sole diretto" }, param: "sun", type: "boolean" },`,
    ],
    [
      PLANTS_LIST_RETURN,
      `          if (ctx.params.sun && !p.needsDirectSun) return false;\n${PLANTS_LIST_RETURN}`,
    ],
  ],
  "workout-rating-out-of-10": [["        durationSec: { type: \"number\", hidden: true },", "        durationSec: { type: \"number\", hidden: true },\n        rating: { type: \"number\", min: 0, max: 10, integer: true },"]],
  "recipes-put-spice-back": [
    [
      RECIPE_PHOTO,
      `${RECIPE_PHOTO}\n        spiciness: { type: "enum", options: ["mild", "medium", "hot"], colors: { mild: "green", medium: "yellow", hot: "red" }, label: { en: "Spiciness", "pt-BR": "Picância", de: "Schärfe", es: "Picante", pl: "Ostrość", it: "Piccantezza" }, labels: { mild: { en: "mild", "pt-BR": "suave", de: "mild", es: "suave", pl: "łagodne", it: "delicato" }, medium: { en: "medium", "pt-BR": "média", de: "mittel", es: "medio", pl: "średnie", it: "medio" }, hot: { en: "hot", "pt-BR": "forte", de: "scharf", es: "fuerte", pl: "ostre", it: "forte" } } },`,
    ],
  ],
  "plants-scan-barcode": [
    [
      '        wiki: { type: "url", label: "Wiki" }, // the same in every language',
      '        wiki: { type: "url", label: "Wiki" }, // the same in every language\n        barcode: { type: "text", label: { en: "Barcode", "pt-BR": "Código de barras", de: "Strichcode", es: "Código de barras", pl: "Kod kreskowy", it: "Codice a barre" } },',
    ],
  ],
  "plants-water-in-ml": [
    [
      '        wiki: { type: "url", label: "Wiki" }, // the same in every language',
      '        wiki: { type: "url", label: "Wiki" }, // the same in every language\n        waterAmount: { type: "number", unit: "ml", min: 0, label: { en: "Water each time", "pt-BR": "Água por rega", de: "Wasser pro Gießen", es: "Agua por riego", pl: "Woda na podlanie", it: "Acqua a ogni annaffiatura" } },',
    ],
  ],
  "places-visited-starts-off": [
    [
      '          options: ["want to go", "been", "favourite"],\n          default: "been",\n          colors: { "want to go": "yellow", been: "teal", favourite: "pink" },',
      '          options: ["want to go", "been", "favourite"],\n          default: "want to go",\n          colors: { "want to go": "yellow", been: "teal", favourite: "pink" },',
    ],
  ],
  "workout-heart-rate-strap": [["        durationSec: { type: \"number\", hidden: true },", "        durationSec: { type: \"number\", hidden: true },\n        avgHeartRate: { type: \"number\", unit: \"bpm\", integer: true },"]],
  "places-phone-wrong-gate": [
    [PLACE_NOTES, `${PLACE_NOTES}\n        phone: { type: "text", label: { en: "Phone", "pt-BR": "Telefone", de: "Telefon", es: "Teléfono", pl: "Telefon", it: "Telefono" } },`],
  ],
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

  // #279: how far back the request a conversation case turns on is decides which recap sizes can
  // see it. The cases spread over 1, 2, 5 and 7 requests back, so a recap of 1, 3 or 6 and the
  // tool each see a different share — that spread is what the paid ablation chooses N on.
  it("says, for every conversation case, which earlier request it turns on", () => {
    const backs = MODIFY_CASES.filter((c) => c.class === "conversation").map((c) => {
      expect(c.decidedBy, c.id).toBeTruthy();
      const back = requestsBack(c.earlier!, c.decidedBy!);
      expect(back, `${c.id}: "${c.decidedBy}" is in none of its earlier requests`).not.toBeNull();
      return back!;
    });
    const seen = (n: number) => backs.filter((b) => recapCoverage(99, b, n)).length;
    expect([seen(1), seen(3), seen(DEFAULT_RECAP_ROUNDS), seen(99)]).toEqual([2, 3, 4, 5]);
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
    }, 60_000); // bundles a whole six-language example twice: slow under a parallel run
  }
});
