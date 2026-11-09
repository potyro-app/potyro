---
title: How an app is put together
description: The parts of a Potyro app, which of them are data and which are code, and how an app travels from your editor to a device.
section: concepts
order: 1
---

# How an app is put together

A Potyro app is one TypeScript module that default-exports `defineApp({...})`. Everything the app
is sits in that one object: what it keeps, what it shows, and what it does.

## Shape is data, logic is functions

Two kinds of thing sit side by side in the object.

The **shape** is plain data: entities, their fields, and the pages that show them. Potyro reads the
shape and gives you storage, forms, validation and migrations without code from you. The shape is
checked when the module loads. A field of an unknown type, or a relation to an entity that does not
exist, is reported at once.

The **logic** is ordinary functions: a computed value, a page filter, an action, a reminder, a whole
custom view. TypeScript types them. Nothing else checks them, because arbitrary code cannot be
checked, only run somewhere safe.

```ts
entities: {
  plant: {
    label: "Plant",
    displayField: "name",
    fields: {
      name: { type: "text", required: true, label: "Name" },
      lastWatered: { type: "datetime", label: "Last watered" },
      everyDays: { type: "number", integer: true, min: 1, default: 7, label: "Water every (days)" },
    },
    computed: {
      // a function of the record; addDays is a helper you write in the same file
      nextWatering: { label: "Next watering", value: (p) => addDays(p.lastWatered, p.everyDays) },
    },
    actions: {
      water: {
        label: "Watered",
        run: async (plant, ctx) => {
          await ctx.patch("plant", plant.id, { lastWatered: ctx.now() });
          ctx.ui.toast(`${plant.name} watered`);
        },
      },
    },
  },
},
```

There is no expression language. A filter is a function and a formula is a function. A function
can import your own modules and libraries, like any TypeScript.

## `ctx`: the one door

Every function receives `ctx`. It is the only way app code reaches anything outside itself.
Through it come records, the time, the app's own storage and files, the people, the screen,
navigation and the device.

```ts
const plants = await ctx.query("plant");                 // records
await ctx.patch("plant", plant.id, { everyDays: 10 });   // a change
ctx.today();                                             // the date, fixed for one pass
await ctx.ui.sheet({ title: "How was it?", items });     // a question to the person
if (ctx.caps.camera) { /* the device, only when the app may use it */ }
```

An app never opens a database, a URL or a browser API for these. That is what lets the same code
run with full power when it is yours and sealed when it is not. The code does not know which. See
[Your apps and other people's apps](trusted-and-sealed.md).

## Pages and views

A page names an entity and a view. The view decides how the records look. Built-in views include
a list, a gallery, a table, a detail page, a calendar, a map and a chart. A page's `filter` and
`sort` are functions over the records. A page can be hidden from the navigation and opened from a
row, with a parameter that names the record.

```ts
pages: [
  {
    id: "due",
    title: "Due",
    view: { type: "list", entity: "plant", filter: (p, ctx) => p.nextWatering <= ctx.today(), rowActions: ["water"] },
  },
  { id: "plant", title: "Plant", hidden: true, view: { type: "detail", entity: "plant", param: "plantId" } },
],
```

[Pages and views](../guides/pages-and-views.md) walks through the built-in views.

## Computed values, actions and reminders

A **computed** value is a function of the record, and may read `ctx`. It runs whenever the record
is read and shows wherever a field would.

An **action** receives the record and `ctx`. It can ask the person something first, then write
through `ctx`. It appears as a button where a page lists it. An action may declare `input` fields,
and Potyro draws the form.

A **reminder** returns a date, or `null`, for each record of an entity. Potyro recomputes the
reminders after every change and schedules a notification where the device has them.

```ts
reminders: [
  { id: "water", entity: "plant", when: (p) => p.nextWatering ?? null, title: (p) => `Water ${p.name}` },
],
```

## Custom views

When no built-in view fits, a page's view is `{ type: "custom", entity, render }`. `render` is your
own React component. It receives the records and reaches the app through the same `ctx`. In an app
from someone else, the view draws inside its own sandboxed frame. Potyro keeps the header and
navigation around it. See [Custom views](../guides/custom-views.md).

## From your editor to a device

1. **Pack.** `npm run build` bundles the entry file and the modules it imports into one zip, the
   app package.
2. **Install.** In Potyro, choose **Add an app → From this device** and pick the zip. A card shows
   the app's name, what it keeps, what it asks for and what it ships. It reads that from the
   package without running its code. Behind the card, the app is loaded once in the sandbox and sample records are
   put through its functions. A feature the sandbox lacks is named on the card. You confirm.
3. **Update.** Installing a package whose app is already here offers **Replace, keep its data**.
   Records stay. The previous source stays in History, where you can compare and restore it.
   Sample records from the package are never applied again on an update.

An app also arrives by link, by pasted source, or from the gallery. Every route goes through the
same card.

## The app package

The package is a zip anyone can open:

- `app.ts` or `app.tsx`, the source;
- `src/`, the app's own modules, and the libraries it imports by URL, with a lock that names each
  file and its digest;
- `files/`, files the app ships with, such as pictures;
- `seed.json`, first records, applied once on a first install;
- `manifest.json`, the format name, the app's declaration as data, and who made it;
- `chat.json`, optionally the Studio conversation that made the app.

The declaration in the manifest is the app with every function replaced by a marker. That is what
the install card reads. [Package format](../reference/package-format.md) lists every field.

## Next

- [Your first app](../start/your-first-app.md) builds one of these step by step.
- [Your apps and other people's apps](trusted-and-sealed.md): what changes when the app is not yours.
- [`defineApp` reference](../reference/define-app.md): every top-level option.
