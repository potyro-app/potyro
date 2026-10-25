// __TITLE__ — a Potyro app.
//
// The app is this one module. Its default export is `defineApp({ … })`: the SHAPE of the app as
// plain data (what it keeps, which pages it has) and its LOGIC as ordinary functions that receive
// `ctx`, the app's way to reach everything Potyro can do.
//
// `npm run build` makes dist/__NAME__.potyro-app.zip; in Potyro, Add an app → From this device installs it.
import { defineApp } from "potyro";

/** The line under a thing in the list: its note, or nothing. Plain functions are easy to test. */
export function lineOf(note: unknown): string {
  return String(note ?? "").trim();
}

export default defineApp({
  id: "__NAME__",
  name: "__TITLE__",
  icon: "sparkles",
  version: "0.1.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#3D7DD8" },

  entities: {
    thing: {
      label: "Thing",
      icon: "sparkles",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name", placeholder: "Something to keep" },
        note: { type: "text", multiline: true, label: "Note" },
        done: { type: "boolean", default: false, label: "Done" },
      },
      computed: {
        line: { label: "Note", value: (thing) => lineOf(thing.note) },
      },
      actions: {
        toggle: {
          label: "Done",
          icon: "check",
          run: async (thing, ctx) => {
            await ctx.patch("thing", thing.id, { done: !thing.done });
            ctx.ui.toast(thing.done ? "Back on the list" : "Done!");
          },
        },
      },
    },
  },

  pages: [
    {
      id: "things",
      title: "Things",
      icon: "list",
      view: {
        type: "list",
        entity: "thing",
        sort: (a, b) => Number(a.done) - Number(b.done) || String(a.name).localeCompare(String(b.name)),
        display: { primary: "name", secondary: "line" },
        rowActions: ["toggle"],
        emptyText: "Nothing here yet. Add the first thing.",
        onOpen: { page: "thing", param: { thingId: "id" } },
      },
    },
    {
      id: "thing",
      title: "Thing",
      hidden: true,
      view: {
        type: "detail",
        entity: "thing",
        param: "thingId",
        actions: ["toggle"],
        sections: [{ fields: ["note", "done"] }],
      },
    },
  ],
});
