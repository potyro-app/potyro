// groceries.app.ts
// Stresses: the `checklist` view (#106) at full stretch — tick in place, quick-add, rename a row by
// tapping it, drag items between aisles, and aisles that are RECORDS you can rename, reorder and
// delete from the list itself. All of it declared: no custom view, no JSX, not one function beyond
// the sort. If a shopping list needs React to rename a row, nobody but a programmer has one.
//
// Also: an app in two languages (#302). Every word is a map, `{ en, pl }`, and each device shows the
// person's — "Zakupy" on a Polish phone, "Groceries" on an English one — over the same records. The
// items and aisles people type are records, so they are never translated.
import { defineApp } from "potyro";

export default defineApp({
  id: "groceries",
  name: { en: "Groceries", pl: "Zakupy" },
  icon: "🛒",
  version: "2.1.0",
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pl"],
  theme: { accent: "#5B9C5B" },

  entities: {
    // The aisles of the shop you actually go to — so the list comes out in walking order.
    aisle: {
      label: { en: "Aisle", pl: "Dział" },
      icon: "🧭",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", pl: "Nazwa" }, placeholder: { en: "Produce", pl: "Warzywa" } },
        order: { type: "number", integer: true, default: 0, hidden: true },
      },
    },

    item: {
      label: { en: "Item", pl: "Produkt" },
      icon: "🛒",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", pl: "Nazwa" }, placeholder: { en: "Milk", pl: "Mleko" } },
        aisle: { type: "relation", to: "aisle", label: { en: "Aisle", pl: "Dział" } },
        quantity: {
          type: "text",
          label: { en: "Quantity", pl: "Ilość" },
          placeholder: "2 × 1 l", // the same in every language
          help: { en: "How much, in your own words", pl: "Ile — własnymi słowami" },
        },
        bought: { type: "boolean", default: false, label: { en: "Bought", pl: "Kupione" } },
        position: { type: "number", integer: true, default: 0, hidden: true },
        note: { type: "text", multiline: true, label: { en: "Note", pl: "Notatka" } },
      },
      groups: [
        { title: { en: "Item", pl: "Produkt" }, fields: ["name", "quantity", "aisle"] },
        { title: { en: "More", pl: "Więcej" }, fields: ["note", "bought"], collapsed: true },
      ],
    },
  },

  pages: [
    {
      id: "shopping",
      title: { en: "Shopping", pl: "Zakupy" },
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
        emptyText: { en: "Nothing on the list. Add the first thing below.", pl: "Lista jest pusta. Dodaj pierwszą rzecz poniżej." },
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "item",
      title: { en: "Item", pl: "Produkt" },
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
