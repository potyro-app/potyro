// A computed is a bare function or `{ value, label }` (#310). Everything that runs or names one reads
// it through computed.ts, so the two spellings cannot drift apart.

import { describe, expect, test } from "vitest";
import { computedInfo, computedRun } from "../src/computed.js";
import type { EntityDef } from "../src/types/app.js";

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
