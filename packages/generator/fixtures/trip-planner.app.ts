import { defineApp } from "potyro";

export default defineApp({
  id: "trip-planner",
  name: "Trip Planner",
  version: "1.1.0",
  schemaVersion: 2,
  migrations: [
    {
      from: "1.0.0",
      to: "1.1.0",
      steps: [
        { op: "addRelation", entity: "person", field: "trip", to: "trip" },
        { op: "addRelation", entity: "place", field: "trip", to: "trip" },
        { op: "addRelation", entity: "event", field: "trip", to: "trip" },
        { op: "addRelation", entity: "expense", field: "trip", to: "trip" },
        { op: "addRelation", entity: "todoList", field: "trip", to: "trip" },
      ],
    },
  ],
  nav: "grid",
  quickActions: [
    { id: "add-trip", label: "Add trip", icon: "✈️", entity: "trip", open: true },
    { id: "add-person", label: "Add person", icon: "👤", entity: "person", open: true },
    { id: "add-place", label: "Add place", icon: "📍", entity: "place", open: true },
    { id: "add-event", label: "Add event", icon: "📅", entity: "event", open: true },
    { id: "add-expense", label: "Add expense", icon: "💸", entity: "expense", open: true },
  ],
  entities: {
    trip: {
      label: "Trip",
      icon: "✈️",
      displayField: "city",
      fields: {
        city: { type: "text", required: true },
        location: { type: "geo", required: true },
        startDate: { type: "datetime", required: true },
        endDate: { type: "datetime", required: true },
      },
    },
    person: {
      label: "Person",
      icon: "👤",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        trip: { type: "relation", to: "trip", required: true },
      },
    },
    place: {
      label: "Place",
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        trip: { type: "relation", to: "trip", required: true },
        location: { type: "geo", required: true },
        notes: { type: "richtext" },
      },
    },
    event: {
      label: "Event",
      icon: "📅",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        trip: { type: "relation", to: "trip", required: true },
        date: { type: "datetime", required: true },
        place: { type: "relation", to: "place" },
        link: { type: "url" },
        notes: { type: "richtext" },
      },
    },
    expense: {
      label: "Expense",
      icon: "💸",
      displayField: "description",
      fields: {
        description: { type: "text", required: true },
        trip: { type: "relation", to: "trip", required: true },
        amount: { type: "number", required: true, min: 0 },
        date: { type: "datetime", required: true, default: (ctx) => ctx.now() },
        paidBy: { type: "relation", to: "person", required: true },
      },
    },
    todoList: {
      label: "Todo List",
      icon: "📋",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        trip: { type: "relation", to: "trip", required: true },
        phase: { type: "enum", options: ["before", "during"], default: "before" },
      },
    },
    todoItem: {
      label: "Todo",
      icon: "☑️",
      displayField: "task",
      fields: {
        task: { type: "text", required: true },
        done: { type: "boolean", default: false },
        list: { type: "relation", to: "todoList", required: true },
      },
      actions: {
        toggle: async (item, ctx) => {
          await ctx.patch("todoItem", item.id, { done: !item.done });
        },
      },
    },
  },
  pages: [
    {
      id: "trip",
      title: "Trip",
      view: {
        type: "list",
        entity: "trip",
        display: {
          primary: "city",
          secondary: (t) => {
            const start = t.startDate instanceof Date ? t.startDate.toLocaleDateString() : "";
            const end = t.endDate instanceof Date ? t.endDate.toLocaleDateString() : "";
            return `${start} - ${end}`;
          },
        },
        onOpen: { page: "trip-detail", param: { tripId: "id" } },
      },
    },
    {
      id: "trip-detail",
      title: "Trip Details",
      hidden: true,
      view: {
        type: "detail",
        entity: "trip",
        param: "tripId",
        sections: [{ fields: ["city", "location", "startDate", "endDate"] }],
      },
    },
    {
      id: "map",
      title: "Map",
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: "name",
        onOpen: { page: "place-detail", param: { placeId: "id" } },
      },
    },
    {
      id: "place-detail",
      title: "Place",
      hidden: true,
      view: {
        type: "detail",
        entity: "place",
        param: "placeId",
        sections: [{ fields: ["name", "trip", "location", "notes"] }],
      },
    },
    {
      id: "schedule",
      title: "Schedule",
      view: {
        type: "calendar",
        entity: "event",
        date: "date",
        title: "title",
      },
    },
    {
      id: "events",
      title: "Events",
      hidden: true,
      view: {
        type: "list",
        entity: "event",
        display: {
          primary: "title",
          secondary: (e) => {
            const d = e.date instanceof Date ? e.date.toLocaleString() : "";
            return d;
          },
        },
        sort: (a, b) => {
          const aTime = a.date instanceof Date ? a.date.getTime() : 0;
          const bTime = b.date instanceof Date ? b.date.getTime() : 0;
          return aTime - bTime;
        },
        onOpen: { page: "event-detail", param: { eventId: "id" } },
      },
    },
    {
      id: "event-detail",
      title: "Event",
      hidden: true,
      view: {
        type: "detail",
        entity: "event",
        param: "eventId",
        sections: [{ fields: ["title", "trip", "date", "place", "link", "notes"] }],
      },
    },
    {
      id: "people",
      title: "People",
      view: {
        type: "list",
        entity: "person",
        display: { primary: "name" },
        onOpen: { page: "person-detail", param: { personId: "id" } },
      },
    },
    {
      id: "person-detail",
      title: "Person",
      hidden: true,
      view: {
        type: "detail",
        entity: "person",
        param: "personId",
        sections: [{ fields: ["name", "trip"] }],
      },
    },
    {
      id: "expenses",
      title: "Expenses",
      view: {
        type: "list",
        entity: "expense",
        display: {
          primary: "description",
          secondary: (e) => {
            const payer = e.paidBy?.name ?? "Unknown";
            return `${e.amount} • ${payer}`;
          },
        },
        sort: (a, b) => {
          const aTime = a.date instanceof Date ? a.date.getTime() : 0;
          const bTime = b.date instanceof Date ? b.date.getTime() : 0;
          return bTime - aTime;
        },
        onOpen: { page: "expense-detail", param: { expenseId: "id" } },
      },
    },
    {
      id: "expense-detail",
      title: "Expense",
      hidden: true,
      view: {
        type: "detail",
        entity: "expense",
        param: "expenseId",
        sections: [{ fields: ["description", "trip", "amount", "date", "paidBy"] }],
      },
    },
    {
      id: "todos",
      title: "Todos",
      view: {
        type: "list",
        entity: "todoList",
        display: {
          primary: "name",
          secondary: (l) => l.phase === "before" ? "Before trip" : "During trip",
        },
        filters: [{ label: "Phase", param: "phase", from: "phase" }],
        onOpen: { page: "todo-list-detail", param: { listId: "id" } },
      },
    },
    {
      id: "todo-list-detail",
      title: "Todo List",
      hidden: true,
      view: {
        type: "list",
        entity: "todoItem",
        display: {
          primary: "task",
          secondary: (item) => item.done ? "✓ Done" : "○ Pending",
        },
        filter: (item, ctx) => item.list?.id === ctx.params.listId,
        onOpen: { page: "todo-item-detail", param: { itemId: "id" } },
      },
    },
    {
      id: "todo-item-detail",
      title: "Todo",
      hidden: true,
      view: {
        type: "detail",
        entity: "todoItem",
        param: "itemId",
        sections: [{ fields: ["task", "done", "list"] }],
        actions: ["toggle"],
      },
    },
  ],
});
