// A computed is a bare function or `{ value, label }` (#310). Everything that runs or names one reads
// it through computed.ts, so the two spellings cannot drift apart.

import { describe, expect, test } from "vitest";
import { computedInfo, computedRun } from "../src/computed.js";
import { localize, wordGaps } from "../src/words.js";
import { structureSchema } from "../src/validate.js";
import type { AppDefinition, EntityDef } from "../src/types/app.js";

const entity: EntityDef = {
  fields: { qty: { type: "number" } },
  computed: {
    perServing: (r) => Number(r.qty ?? 0) / 2,
    total: { label: { en: "Total", pl: "Razem" }, value: (r) => Number(r.qty ?? 0) },
    plain: { label: "Plain words", value: () => 1 },
  },
};

describe("computedInfo / computedRun", () => {
  test("a bare function has no label of its own", () => {
    expect(computedInfo(entity, "perServing")?.label).toBeUndefined();
    expect(typeof computedRun(entity, "perServing")).toBe("function");
  });

  test("the object form's value runs, and its label is read as words", () => {
    expect(computedRun(entity, "total")?.({ qty: 3 } as never, {} as never)).toBe(3);
    expect(computedInfo(entity, "plain")?.label).toBe("Plain words");
    expect(computedInfo(entity, "total")?.label).toBe("Total"); // a map, before localize: its first entry
  });

  test("an unknown key, or the sealed box's placeholder, has nothing to run", () => {
    expect(computedInfo(entity, "nope")).toBeUndefined();
    expect(computedRun({ fields: {}, computed: { k: { value: "__potyro_fn__" as never, label: "K" } } }, "k")).toBeUndefined();
  });
});

describe("a computed's own words for its value", () => {
  const app = {
    id: "x", name: "X", version: "1.0.0", schemaVersion: 1, language: "en", languages: ["en", "pl"],
    entities: {
      dish: {
        fields: { qty: { type: "number" } },
        computed: {
          diet: {
            label: { en: "Diet", pl: "Dieta" },
            labels: { vegan: { en: "vegan", pl: "wegański" }, unknown: "?" },
            value: () => "vegan",
          },
          best: { label: "Best", format: { en: "{kg} kg × {reps}", pl: "{kg} kg × {reps} powt." }, value: () => ({ kg: 80, reps: 8 }) },
        },
      },
    },
    pages: [{ id: "p", title: "P", view: { type: "list", entity: "dish" } }],
  };

  test("computedInfo reads labels and format, as words", () => {
    const entity = app.entities.dish as unknown as EntityDef;
    expect(computedInfo(entity, "diet")?.labels).toEqual({ vegan: "vegan", unknown: "?" });
    expect(computedInfo(entity, "best")?.format).toBe("{kg} kg × {reps}");
    expect(computedInfo(entity, "best")?.labels).toBeUndefined();
  });

  test("they are words slots: localize picks the language, wordGaps sees a missing one", () => {
    const shown = localize(app as unknown as AppDefinition, "pl");
    const entity = shown.entities.dish as unknown as EntityDef;
    expect(computedInfo(entity, "diet")?.labels).toEqual({ vegan: "wegański", unknown: "?" });
    expect(computedInfo(entity, "best")?.format).toBe("{kg} kg × {reps} powt.");
    const gappy = { ...app, entities: { dish: { ...app.entities.dish, computed: { diet: { labels: { vegan: { en: "vegan" } }, value: () => "vegan" } } } } };
    expect(wordGaps(gappy as unknown as AppDefinition)).toEqual([{ path: "entities.dish.computed.diet.labels.vegan", missing: ["pl"] }]);
  });

  test("the schema takes them, and refuses an empty format", () => {
    expect(structureSchema.safeParse(app).success).toBe(true);
    const bad = { ...app, entities: { dish: { ...app.entities.dish, computed: { best: { format: "", value: () => 1 } } } } };
    expect(structureSchema.safeParse(bad).success).toBe(false);
  });
});
