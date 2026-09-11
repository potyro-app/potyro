import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// `scope` (#134): the one record everything else belongs to. Declarative, so it is validated; the
// selection itself is runtime state (`ctx.scope`), not part of the definition.

const trips = (extra: Partial<AppDefinition> = {}): AppDefinition => ({
  id: "trips",
  name: "Trips",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    trip: { label: "Trip", displayField: "city", fields: { city: { type: "text", required: true }, location: { type: "geo" } } },
    place: { label: "Place", displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" }, location: { type: "geo" } } },
  },
  pages: [
    { id: "places", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } },
    { id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location" } },
  ],
  ...extra,
});

describe("scope", () => {
  it("accepts a scope over a real entity", () => {
    const app = defineApp(trips({ scope: { entity: "trip", label: "Trip", required: true } }));
    expect(app.scope).toEqual({ entity: "trip", label: "Trip", required: true });
  });

  it("rejects a scope over an entity the app does not have, naming it", () => {
    expect(() => defineApp(trips({ scope: { entity: "voyage" } }))).toThrow(ValidationError);
    expect(() => defineApp(trips({ scope: { entity: "voyage" } }))).toThrow(/scope references unknown entity "voyage"/);
  });
});

describe("Dynamic<MapCamera> (#133, the first function-valued option)", () => {
  it("accepts a function of ctx where a literal camera was accepted", () => {
    const camera = (ctx: { scope: Record<string, { location?: { lat: number; lng: number } } | undefined> }) => {
      const at = ctx.scope.trip?.location;
      return at ? { center: [at.lng, at.lat] as [number, number], zoom: 11 } : ("fit" as const);
    };
    const app = defineApp(
      trips({
        scope: { entity: "trip" },
        pages: [{ id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location", camera: camera as never } }],
      }),
    );
    expect(typeof (app.pages[0]!.view as { camera?: unknown }).camera).toBe("function");
  });

  it("accepts a function page title, empty text and aggregate title", () => {
    const app = defineApp(
      trips({
        scope: { entity: "trip" },
        pages: [
          {
            id: "places",
            title: ((ctx: { scope: Record<string, { city?: string } | undefined> }) => `Places in ${ctx.scope.trip?.city ?? "…"}`) as never,
            view: { type: "list", entity: "place", emptyText: (() => "Nothing here for this trip") as never },
          },
          { id: "totals", title: "Totals", view: { type: "aggregate", entity: "place", rows: () => [], title: (() => "Totals for the trip") as never } },
        ],
      }),
    );
    expect(typeof app.pages[0]!.title).toBe("function");
  });

  it("still rejects a camera that is neither a mode, a position nor a function", () => {
    expect(() =>
      defineApp(trips({ pages: [{ id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location", camera: "zoomed" as never } }] })),
    ).toThrow(ValidationError);
  });
});
