# 03 · Definition Model (`*.app.ts`)

An app is a TypeScript module that default-exports `defineApp({...})`. The object mixes
**declarative structure** (data: entities, fields, view layout — gives storage/forms/
validation/migrations for free) with **code logic** (functions: computed, filters, actions,
reminders, custom views — full TypeScript, no restrictions).

`defineApp` is a typed builder (identity + normalize + dev-time Zod check of the declarative
parts). It does not restrict logic; functions are just typed by TS.

## Top-level shape

```ts
import { defineApp, f } from "karta";          // f = field builders (optional sugar)
import { scoreDifficulty } from "./lib/difficulty";   // your own imports — allowed

export default defineApp({
  id: "recipes",
  name: "Recipes",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#E4A93C" },

  // declares what native powers this app expects; used for the trust prompt when the app
  // is run untrusted. Trusted (own) apps get everything without prompting.
  permissions: { camera: true, filesystem: true /* network, notifications, geo … */ },

  entities: { /* … */ },   // declarative shape + co-located computed/action functions
  pages:    [ /* … */ ],   // declarative view layout; display/filter/sort may be functions
  reminders:[ /* … */ ],   // functions
  migrations: [ /* … */ ], // see docs/06 (functions allowed)
});
```

## Entities: declarative shape + co-located logic

```ts
entities: {
  recipe: {
    label: "Recipe",
    displayField: "name",
    fields: {
      name:       { type: "text", required: true },
      photo:      { type: "media", accept: "image" },
      servings:   { type: "number", default: 2, min: 1, integer: true },
      ingredients:{ type: "list", of: {
        ingredient: { type: "relation", to: "ingredient", required: true },
        quantity:   { type: "number", min: 0, required: true },
        unit:       { type: "enum", options: ["g","ml","tbsp","tsp","cup","piece"] },
      }},
      steps:      { type: "list", ordered: true, of: {
        text: { type: "text", multiline: true, required: true },
        durationSec: { type: "number", min: 0 },
      }},
    },

    // ---- LOGIC: real functions. Relations on `r` are pre-resolved by the runtime. ----
    computed: {
      calories: (r) => r.ingredients.reduce(
        (s, i) => s + i.ingredient.caloriesPer100 * i.quantity / 100, 0),
      protein:  (r) => r.ingredients.reduce(
        (s, i) => s + i.ingredient.proteinPer100 * i.quantity / 100, 0),
      caloriesPerServing: (r, ctx) => r.calories / Math.max(r.servings, 1),
      difficulty: (r) => scoreDifficulty(r),          // imported helper — full code
    },

    actions: {
      markCooked: async (r, ctx) => {
        await ctx.patch("recipe", r.id, {
          lastCookedAt: ctx.now(),
          timesCooked: (r.timesCooked ?? 0) + 1,
        });
      },
    },
  },
}
```

- **Fields** are declarative — the runtime uses them for persistence, form generation,
  validation, view binding, migrations. Same closed type set as before (see "Field types").
- **`computed`** are functions `(record, ctx) => value | Promise<value>`. Relations are
  resolved one level deep on `record`; deeper or cross-entity work uses `ctx.query`. Memoized
  per query pass. Referenced in views exactly like fields.
- **`actions`** are functions `(record, ctx, input?) => void | Promise<void>`. They do whatever
  you want through `ctx` (patch, create, call caps, prompt the user…).

## Field types (declarative, closed set)

`text · richtext · number · boolean · enum · tags · datetime · duration · url · geo · media ·
relation · list`. (No `computed` field *type* — computed is a function block. This cleanly
separates shape from logic.) Options per type are unchanged from the prior schema draft
(min/max/unit, enum options, relation `to`/`many`, list `of`/`ordered`, media `accept`/
`multiple`, etc.). `default` may be a value or a function `(ctx) => value`.

## Pages & views: declarative layout, code where it's logic

```ts
pages: [
  {
    id: "all", title: "Recipes",
    view: {
      type: "list", entity: "recipe",
      sort: (a, b) => a.name.localeCompare(b.name),         // JS comparator
      display: {
        primary: (r) => r.name,                             // functions or field keys
        secondary: (r) => `${Math.round(r.caloriesPerServing)} kcal/serving`,
        media: "photo",
      },
      rowActions: ["markCooked"],
    },
  },
  {
    id: "cook-with", title: "What can I cook?",
    view: {
      type: "list", entity: "recipe",
      // arbitrary JS predicate — reads ctx.params, set by a picker in the view chrome
      filter: (r, ctx) => {
        const have = new Set((ctx.params.pantry as string[]) ?? []);
        return r.ingredients.every((i) => have.has(i.ingredient.id));
      },
      display: { primary: "name", media: "photo" },
    },
  },
  {
    id: "cook", title: "Cook", hidden: true,
    view: {
      type: "custom", entity: "recipe", param: "recipeId",
      render: (props) => <CookAlong {...props} />,          // a full React component
      onFinish: "markCooked",
    },
  },
]
```

### Built-in view types (conveniences)

`list · table · detail · gallery · calendar · map · steps`. Their bindings (`date` for
calendar, `geo` for map, `list` for steps, `columns` for table, `sections` for detail) are as
before, except **any binding, filter, or sort may be a function** instead of a field key.

### `custom` view — the no-ceiling escape hatch

`{ type: "custom", render: (props: ViewProps) => JSX }`. The app ships a real React component
with full `ctx` access via `props.runtime`. This is the ultimate "fully control the app":
when the built-ins don't fit, write the screen yourself. Built-ins exist only to save you from
writing list/table/etc. by hand.

## Reminders (functions)

```ts
reminders: [
  {
    id: "water-due",
    entity: "plant",
    when:  (p) => p.active ? addDays(p.lastWatered, effectiveInterval(p)) : null, // Date|null
    title: (p) => `Water ${p.name}`,
    body:  (p) => `Last watered ${relativeTime(p.lastWatered)}`,
  },
]
```

The runtime reconciles reminders on writes and schedules future ones via
`ctx.caps.notifications` (see docs/07 for platform limits).

## What the runtime does with a module

1. **Load** the module (direct import if trusted; bundle→isolate if untrusted — docs/07).
2. **Validate** the declarative parts (`packages/schema` Zod) — entity/field/view *structure*
   only. Functions are typed by TS at author time; the runtime just calls them.
3. **Run**: resolve records + relations from the `Store`, execute `computed`/`filter`/`sort`
   over the in-memory result set (personal scale → no query DSL, no pushdown planner), invoke
   `actions`/`reminders`, and render views — all with `ctx` injected.

## Why keep structure declarative at all?

Because shape isn't logic. Declaring fields as data is what buys automatic storage columns,
generated forms, validation, view binding, and migrations. It's a schema (like Prisma/Zod),
not a DSL — it never made you hit a wall. The wall was always in *logic*, and logic is now
unrestricted TypeScript.
