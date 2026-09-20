import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppInput, type Ctx, type Resolved } from "../src/index.js";

// Chips that take a VALUE from the person at view time (#216).
//
// A chip could be a toggle, a "use my location" button, or a pick from a fixed list — nothing that
// accepted something typed. So an app could not offer search, and could not offer "over £20"
// either. Both are named in the generator's corpus of realistic asks as things the runtime could
// not express, and an app with three hundred rows and no way to find one is barely an app.
//
// The host collects the value; the app's `filter` decides what it means. That division is the point:
// a host that decided what "matching" meant would be wrong for every app that needed it to mean
// something else.

const base = (filters: unknown[], filter?: (r: Resolved, ctx: Ctx) => boolean): AppInput => ({
  id: "recipes",
  name: "Recipes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { recipe: { fields: { name: { type: "text" }, minutes: { type: "number" } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "recipe", filters: filters as never, filter } }],
});

describe("value filter chips", () => {
  it("accepts a text chip — this is how an app gets search", () => {
    const app = defineApp(
      base([{ label: "Search", param: "q", type: "text", placeholder: "Name or tag" }], (r, ctx) =>
        String(r.name).toLowerCase().includes(String(ctx.params.q ?? "").toLowerCase()),
      ),
    );
    const chip = (app.pages[0]!.view as { filters?: Array<{ type?: string; placeholder?: string }> }).filters?.[0];
    expect(chip?.type).toBe("text");
    expect(chip?.placeholder).toBe("Name or tag");
  });

  it("accepts a number chip — a threshold the person picks, not one baked into the app", () => {
    const app = defineApp(
      base([{ label: "Under", param: "max", type: "number" }], (r, ctx) => ctx.params.max == null || Number(r.minutes) <= Number(ctx.params.max)),
    );
    expect((app.pages[0]!.view as { filters?: Array<{ type?: string }> }).filters?.[0]?.type).toBe("number");
  });

  it("still rejects a type nobody implemented, rather than rendering nothing", () => {
    expect(() => defineApp(base([{ label: "Colour", param: "c", type: "colour" }]))).toThrow(ValidationError);
  });

  it("leaves the older chips alone", () => {
    expect(() => defineApp(base([{ label: "Open now", param: "open", type: "boolean" }, { label: "Near me", param: "me", type: "geo" }]))).not.toThrow();
  });
});
