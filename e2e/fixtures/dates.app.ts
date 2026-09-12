// A fixture for the date field (#103), holding the two precisions side by side: `due` is an
// ordinary day and `startsAt` is a moment. Committed rather than generated, so what the browser
// test drives never drifts.

import { defineApp } from "karta";

export default defineApp({
  id: "dates",
  name: "Dates",
  icon: "📅",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    task: {
      label: "Task",
      icon: "✅",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        due: { type: "datetime", label: "Due" },
        startsAt: { type: "datetime", precision: "minute", label: "Starts At" },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Tasks",
      view: {
        type: "list",
        entity: "task",
        display: { primary: (t) => t.title as string, secondary: "due" },
        onOpen: { page: "task", param: { taskId: "id" } },
        emptyText: "Nothing yet.",
      },
    },
    {
      id: "task",
      title: "Task",
      hidden: true,
      view: { type: "detail", entity: "task", param: "taskId" },
    },
  ],
  quickActions: [{ id: "new-task", label: "New task", icon: "＋", entity: "task" }],
});
