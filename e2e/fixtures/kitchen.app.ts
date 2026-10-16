// `ctx.ui.timer` and `ctx.ui.keepAwake` (docs/04): a kitchen with two pages, so a timer started on
// one is seen on the other, at home and after a reload. Installed trusted and untrusted by the specs.

import { defineApp } from "potyro";

export default defineApp({
  id: "kitchen",
  name: "Kitchen",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    step: { label: "Step", displayField: "text", fields: { text: { type: "text", required: true } } },
    note: { label: "Note", displayField: "text", fields: { text: { type: "text", required: true } } },
  },
  pages: [
    {
      id: "cook",
      title: "Cook",
      icon: "🍳",
      view: { type: "list", entity: "step", display: { primary: "text" } },
      actions: [
        { label: "Rest 3 s", icon: "⏱", run: async (ctx) => void (await ctx.ui.timer({ label: { en: "Rest" }, seconds: 3, id: "rest" })) },
        { label: "Bake bread", icon: "🍞", run: async (ctx) => void (await ctx.ui.timer({ label: "Bread in the oven", seconds: 45 * 60 })) },
        {
          label: "How many timers",
          run: async (ctx) => {
            const all = await ctx.ui.timers();
            ctx.ui.toast(`${all.length}: ${all.map((t) => `${t.label}${t.paused ? " (paused)" : ""}`).join(", ")}`);
          },
        },
        {
          label: "Screen on",
          run: (ctx) => {
            held = ctx.ui.keepAwake();
            ctx.ui.toast("Screen stays on");
          },
        },
        { label: "Screen off", run: () => void held?.release() },
      ],
    },
    { id: "notes", title: "Notes", icon: "📝", view: { type: "list", entity: "note", display: { primary: "text" } } },
  ],
});

let held: { release(): void } | undefined;
