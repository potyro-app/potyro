// groceries.app.ts
// Stresses: the `checklist` view (#106) at full stretch — tick in place, quick-add, rename a row by
// tapping it, drag items between aisles, and aisles that are RECORDS you can rename, reorder and
// delete from the list itself. All of it declared: no custom view, no JSX, not one function beyond
// the sort. If a shopping list needs React to rename a row, nobody but a programmer has one.
import { defineApp } from "potyro";

export default defineApp({
  id: "groceries",
  name: "Groceries",
  icon: "🛒",
  version: "2.0.0",
  schemaVersion: 2,
  theme: { accent: "#5B9C5B" },

  entities: {
    // The aisles of the shop you actually go to — so the list comes out in walking order.
    aisle: {
      label: "Aisle",
      icon: "🧭",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Produce" },
        order: { type: "number", integer: true, default: 0, hidden: true },
      },
    },

    item: {
      label: "Item",
      icon: "🛒",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Milk" },
        aisle: { type: "relation", to: "aisle" },
        quantity: { type: "text", placeholder: "2 × 1 l", help: "How much, in your own words" },
        bought: { type: "boolean", default: false },
        position: { type: "number", integer: true, default: 0, hidden: true },
        note: { type: "text", multiline: true },
      },
      groups: [
        { title: "Item", fields: ["name", "quantity", "aisle"] },
        { title: "More", fields: ["note", "bought"], collapsed: true },
      ],
    },
  },

  pages: [
    {
      id: "shopping",
      title: "Shopping",
      view: {
        type: "checklist",
        entity: "item",
        done: "bought",
        text: "name",
        detail: "quantity",
        group: "aisle",
        groupOrder: "order",
        reorder: "position",
        editText: true,
        quickAdd: true,
        emptyText: "Nothing on the list. Add the first thing below.",
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "item",
      title: "Item",
      hidden: true,
      view: { type: "detail", entity: "item", param: "itemId" },
    },
  ],

  migrations: [
    {
      from: "1.0.0",
      to: "2.0.0",
      // v1 kept the aisle as an enum, so an existing item points at an option, not a record. The
      // items keep everything else and arrive at the top of the list, under no heading, where one
      // tap on an aisle files each — which is the same flow a new item goes through.
      steps: [
        { op: "setDefaultForExisting", entity: "item", field: "aisle", value: null },
        { op: "addField", entity: "item", field: "position", default: 0 },
      ],
    },
  ],
});
