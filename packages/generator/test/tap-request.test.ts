// The request that exposed the limit (2026-10-20): "when I click one of the places at the bottom, the
// pin of this place is selected, focused" — on Places. What the model is handed for it must name the
// mechanism outright: the map view's `onSelect`, and `ctx.views.map().select`. A refusal, or a custom
// view that redraws the strip, is the harness's failure, not the model's.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityPassages, SYSTEM_PROMPT } from "../src/prompt.js";

const PLACES = readFileSync(new URL("../../../examples/places.app.ts", import.meta.url), "utf8");
const REQUEST = "I want that when I click in one of the places in the bottom, the pin of this place is selected, focused.";

describe("a tap on a built-in view, asked of the Studio", () => {
  it("hands the model the mechanism with the request: onSelect and select(id), with the one-line answer", () => {
    const passages = capabilityPassages(REQUEST, PLACES);
    expect(passages).toContain("onSelect: (record, ctx) =>");
    expect(passages).toContain("select(id: Id)");
    expect(passages).toContain('ctx.views.map("map").select(p.id)');
    expect(passages).toContain("never a custom view that redraws the strip");
  });

  it("keeps the rule in the core too: onOpen may be a function, the map's onSelect likewise", () => {
    expect(SYSTEM_PROMPT).toContain("`onOpen` may instead be a function `(record, ctx)`");
    expect(SYSTEM_PROMPT).toContain("onSelect?: (record: Resolved, ctx: Ctx)");
  });
});
