// A map whose taps are the app's own (docs/04): tapping a strip card or a pin runs `onSelect`, which
// brings that pin to the front through `ctx.views.map(...).select` instead of opening the record; a
// second tap on the one in front opens it through `.open`. Kept here as a fixture: this is the shape
// the Studio writes when someone asks "when I tap a place at the bottom, select its pin".
import { defineApp } from "potyro";

let inFront: string | null = null;

export default defineApp({
  id: "map-select",
  name: "Spots",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  entities: {
    spot: {
      label: "Spot",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        at: { type: "geo" },
      },
    },
  },
  pages: [
    {
      id: "map",
      title: "Map",
      actions: [
        {
          label: "Add three spots",
          run: async (ctx) => {
            for (const [name, lat, lng] of [
              ["Bar A", 52.52, 13.4],
              ["Bar B", 52.53, 13.41],
              ["Bar C", 52.51, 13.39],
            ] as const) {
              await ctx.create("spot", { name, at: { lat, lng } });
            }
          },
        },
        {
          label: "Pick Bar B",
          run: async (ctx) => {
            const b = (await ctx.query("spot")).find((s) => s.name === "Bar B");
            if (b) await ctx.views.map("map").select(b.id);
          },
        },
      ],
      view: {
        type: "map",
        entity: "spot",
        geo: "at",
        title: "name",
        strip: true,
        display: { primary: "name" },
        onSelect: async (spot, ctx) => {
          const id = String(spot.id);
          if (inFront === id) {
            await ctx.views.map("map").open(id);
            return;
          }
          inFront = id;
          await ctx.views.map("map").select(id);
        },
      },
    },
    { id: "spot", title: "Spot", view: { type: "detail", entity: "spot", param: "spotId" } },
  ],
});
