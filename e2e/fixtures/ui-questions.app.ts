// The structured questions an action can ask (#112), each on a note's page: a menu hanging off the
// button, a progress bar, and a form with several kinds of field. Installed trusted and untrusted by
// the specs, so every one of them is checked crossing the isolate too.

import { defineApp } from "karta";

export default defineApp({
  id: "ui-questions",
  name: "Questions",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [{ id: "new", label: "New note", entity: "note", mode: "instant", open: true, prefill: { title: "First" } }],
  entities: {
    note: {
      label: "Note",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        colour: { type: "enum", options: ["red", "green", "blue"], colors: { red: "red", green: "green", blue: "blue" } },
        pinned: { type: "boolean", default: false },
      },
      actions: {
        recolour: async (n, ctx) => {
          const c = await ctx.ui.menu({
            title: "Colour",
            items: [
              { id: "red", label: "Red", detail: "Urgent" },
              { id: "green", label: "Green", detail: "Done" },
              { id: "blue", label: "Blue" },
            ],
          });
          if (c) await ctx.patch("note", n.id, { colour: c });
        },
        importDemo: async (_n, ctx) => {
          const bar = ctx.ui.progress("Importing notes");
          bar.update(0.5, "2 of 4");
          const go = await ctx.ui.confirm("Keep importing?");
          bar.done();
          ctx.ui.toast(go ? "Imported" : "Stopped");
        },
        quickNote: async (_n, ctx) => {
          const v = await ctx.ui.form<{ title: string; colour: string; pinned: boolean }>({
            title: "Quick note",
            submit: "Add note",
            fields: {
              title: { type: "text", required: true },
              colour: { type: "enum", options: ["red", "green", "blue"] },
              pinned: { type: "boolean" },
            },
            initial: { colour: "green" },
          });
          if (!v) return ctx.ui.toast("No note");
          await ctx.create("note", v);
          ctx.ui.toast(`Added ${v.title} (${v.colour}${v.pinned ? ", pinned" : ""})`);
        },
        badForm: async (_n, ctx) => {
          try {
            await ctx.ui.form({ title: "Broken", fields: { when: { type: "calendar" } as never } });
          } catch (e) {
            ctx.ui.toast(String((e as Error).message).split("\n")[0]!);
          }
        },
      },
    },
  },
  pages: [
    { id: "notes", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title", badges: ["colour"] }, onOpen: { page: "note", param: { noteId: "id" } } } },
    { id: "note", title: "Note", hidden: true, view: { type: "detail", entity: "note", param: "noteId", actions: ["recolour", "importDemo", "quickNote", "badForm"] } },
  ],
});
