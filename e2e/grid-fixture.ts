import type { Page } from "@playwright/test";

// An app that lands on an object grid (`nav: "grid"`): a tile per entity on its Home. Workout used to
// be the example that did; it opens on its Train screen now, so the grid's own specs bring their app.
export const GRID_APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "gridhome", name: "Gym Notes", icon: "\\u{1F3CB}", version: "1.0.0", schemaVersion: 1, nav: "grid",
  quickActions: [{ id: "new-exercise", label: "New exercise", icon: "+", entity: "exercise" }],
  entities: {
    exercise: { label: "Exercise", icon: "\\u{1F4AA}", displayField: "name", fields: { name: { type: "text", required: true }, reps: { type: "number" } } },
    session: { label: "Session", icon: "\\u{1F3CB}", displayField: "note", fields: { note: { type: "text" }, date: { type: "datetime", default: (ctx) => ctx.now() } } },
  },
  pages: [
    { id: "exercises", title: "Exercises", view: { type: "list", entity: "exercise" } },
    { id: "sessions", title: "Sessions", view: { type: "list", entity: "session" } },
  ],
});
`;

/** Install the grid app as the device's own before the page loads. */
export async function installGridApp(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "gridhome", name: "Gym Notes", source, trusted: true, updatedAt: new Date().toISOString() }]));
  }, GRID_APP);
}
