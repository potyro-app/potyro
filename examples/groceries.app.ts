// groceries.app.ts
// Stresses: the `checklist` view (#106) at full stretch — tick in place, quick-add, rename a row by
// tapping it, drag items between aisles, and aisles that are RECORDS you can rename, reorder and
// delete from the list itself. All of it declared: no custom view, no JSX, not one function beyond
// the sort. If a shopping list needs React to rename a row, nobody but a programmer has one.
//
// Also: an app in six languages (#302, #303). Every word is a map, and each device shows the
// person's — "Zakupy" on a Polish phone, "Einkäufe" on a German one — over the same records. The
// items and aisles people type are records, so they are never translated. Every language but
// English is a model's draft (#297), not yet read by a native speaker.
import { defineApp } from "potyro";

export default defineApp({
  id: "groceries",
  name: { en: "Groceries", "pt-BR": "Compras", de: "Einkäufe", es: "Compras", pl: "Zakupy", it: "Spesa" },
  icon: "🛒",
  version: "2.3.0",
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5B9C5B" },
  category: "everyday",
  // The launcher tile (docs/04 §Tile): what is still to buy, in the order the list has it.
  tile: async (ctx) => {
    const left = (await ctx.query("item")).filter((i) => !i.bought).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    return {
      count: left.length,
      title: ctx.t(
        {
          en: "{n, plural, =0 {All bought} one {# to buy} other {# to buy}}",
          "pt-BR": "{n, plural, =0 {Tudo comprado} one {# para comprar} other {# para comprar}}",
          de: "{n, plural, =0 {Alles gekauft} one {# zu kaufen} other {# zu kaufen}}",
          es: "{n, plural, =0 {Todo comprado} one {# por comprar} other {# por comprar}}",
          pl: "{n, plural, =0 {Wszystko kupione} one {# do kupienia} few {# do kupienia} many {# do kupienia} other {# do kupienia}}",
          it: "{n, plural, =0 {Tutto comprato} one {# da comprare} other {# da comprare}}",
        },
        { n: left.length },
      ),
      lines: left.slice(0, 3).map((i) => String(i.name)),
    };
  },

  entities: {
    // The aisles of the shop you actually go to — so the list comes out in walking order.
    aisle: {
      label: { en: "Aisle", "pt-BR": "Seção", de: "Abteilung", es: "Sección", pl: "Dział", it: "Reparto" },
      icon: "🧭",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Produce", "pt-BR": "Hortifrúti", de: "Obst & Gemüse", es: "Frutas y verduras", pl: "Warzywa", it: "Frutta e verdura" },
        },
        order: { type: "number", integer: true, default: 0, hidden: true },
      },
    },

    item: {
      label: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" },
      icon: "🛒",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Milk", "pt-BR": "Leite", de: "Milch", es: "Leche", pl: "Mleko", it: "Latte" },
        },
        aisle: {
          type: "relation",
          to: "aisle",
          label: { en: "Aisle", "pt-BR": "Seção", de: "Abteilung", es: "Sección", pl: "Dział", it: "Reparto" },
        },
        quantity: {
          type: "text",
          label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" },
          placeholder: "2 × 1 l", // the same in every language
          help: {
            en: "How much, in your own words",
            "pt-BR": "Quanto, com as suas palavras",
            de: "Wie viel, in deinen eigenen Worten",
            es: "Cuánto, con tus propias palabras",
            pl: "Ile — własnymi słowami",
            it: "Quanto, con parole tue",
          },
        },
        bought: {
          type: "boolean",
          default: false,
          label: { en: "Bought", "pt-BR": "Comprado", de: "Gekauft", es: "Comprado", pl: "Kupione", it: "Comprato" },
        },
        position: { type: "number", integer: true, default: 0, hidden: true },
        note: {
          type: "text",
          multiline: true,
          label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
        },
      },
      groups: [
        { title: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" }, fields: ["name", "quantity", "aisle"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["note", "bought"], collapsed: true },
      ],
    },
  },

  pages: [
    {
      id: "shopping",
      title: { en: "Shopping", "pt-BR": "Lista de compras", de: "Einkaufsliste", es: "Lista de la compra", pl: "Zakupy", it: "Lista della spesa" },
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
        emptyText: {
          en: "Nothing on the list. Add the first thing below.",
          "pt-BR": "A lista está vazia. Adicione a primeira coisa aqui embaixo.",
          de: "Die Liste ist leer. Füge unten das Erste hinzu.",
          es: "La lista está vacía. Añade lo primero aquí abajo.",
          pl: "Lista jest pusta. Dodaj pierwszą rzecz poniżej.",
          it: "La lista è vuota. Aggiungi la prima cosa qui sotto.",
        },
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "item",
      title: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" },
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
