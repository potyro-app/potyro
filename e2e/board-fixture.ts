import { expect, type Page } from "@playwright/test";

// A board's own app for its specs (#107): tasks in columns by status. The board used to borrow
// Recipes' Cookbook page; Recipes keeps four pages now, so the board brings its own app — with a
// photo field (a card dragged by its photo) and a function binding (the card's second line, which a
// sealed app has to send back from its box).
export const BOARD_APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "tasks", name: "Tasks", icon: "\\u{1F4CC}", version: "1.0.0", schemaVersion: 1,
  entities: {
    task: {
      label: "Task", displayField: "title",
      fields: {
        title: { type: "text", required: true },
        status: { type: "enum", options: ["to do", "doing", "done"], default: "to do" },
        photo: { type: "media", accept: "image" },
        hours: { type: "number" },
      },
    },
  },
  pages: [
    {
      id: "board", title: "Board",
      view: {
        type: "board", entity: "task", column: "status",
        sort: (a, b) => String(a.title).localeCompare(String(b.title)),
        display: { primary: "title", secondary: (t) => (t.hours ? t.hours + " h of work" : ""), media: "photo" },
        onOpen: { page: "task", param: { taskId: "id" } },
      },
    },
    { id: "task", title: "Task", hidden: true, view: { type: "detail", entity: "task", param: "taskId" } },
  ],
});
`;

const TASKS = [
  { title: "Paint the fence", status: "to do", hours: 4 },
  { title: "Fix the bike", status: "to do", hours: 2 },
  { title: "Call the plumber", status: "doing", hours: 1 },
  { title: "Water the plants", status: "doing", hours: 1 },
  { title: "Book the trip", status: "done", hours: 3 },
];

/** The tasks app, the device's own (or sealed), with five tasks across the three columns. */
export async function openBoard(page: Page, trusted = true): Promise<void> {
  await page.addInitScript(
    ([source, isTrusted]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "tasks", name: "Tasks", source, trusted: isTrusted, updatedAt: new Date(0).toISOString() }]));
    },
    [BOARD_APP, trusted] as const,
  );
  await page.goto("/?user=tasks");
  await expect(page.locator(".k-board")).toBeVisible({ timeout: 30_000 });
  // The tasks, written straight into the app's store (dev serves the shell's modules), once.
  const seeded = await page.evaluate(async (tasks) => {
    const { openStore } = await import("/src/open-store.ts");
    const store = await openStore("user:tasks");
    if ((await store.all("task")).length) return false;
    for (const t of tasks) await store.insert("task", t);
    return true;
  }, TASKS);
  if (seeded) await page.reload();
  await expect(page.locator(".k-board-card").first()).toBeVisible({ timeout: 30_000 });
}
