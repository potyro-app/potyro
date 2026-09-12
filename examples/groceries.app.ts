// groceries.app.ts
// Stresses: the `checklist` view (#106) — tick records in place, quick-add, aisle headings, a
// folded Done section — with nothing but declarative structure. The most common personal app
// is a list of things you tick, and it should be one tap, not a form.
import { defineApp } from "karta";

export default defineApp({
  id: "groceries",
  name: "Groceries",
  icon: "🛒",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#5B9C5B" },

  entities: {
    item: {
      label: "Item",
      icon: "🛒",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Milk" },
        aisle: { type: "enum", options: ["produce", "dairy", "bakery", "pantry", "frozen", "household"], default: "pantry" },
        quantity: { type: "text", placeholder: "2 × 1 l", help: "How much, in your own words" },
        bought: { type: "boolean", default: false },
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
        sort: (a, b) => String(a.aisle).localeCompare(String(b.aisle)) || String(a.name).localeCompare(String(b.name)),
        hideDone: "collapse",
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
});
