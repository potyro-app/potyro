// What a person actually does: build an app, then change it three times.
//
// The generate corpus (`wild-prompts.ts`) measures the first step only, against an app with no data
// and no history. Every failure that has reached a real user came from the SECOND step — a change to
// an app that already holds their records. Those failures share a shape the generate eval cannot
// see: the app compiles, validates, renders, and either loses the data or quietly does nothing.
//
// So each scenario is a chain. Modification 2 is applied to whatever modification 1 produced,
// mistakes included, because that is what happens to a person who does not notice the first one.
//
// ## On the assertions
//
// Five scenarios carry `expect` — a behavioural check run against the modified app with real records
// in it. They exist because "still validates" is the weakest possible reading of "it worked": the
// report that started this measured `0/0` on a counter and zero rows on a page, from an app that
// passed every structural gate.
//
// They are deliberately NAME-AGNOSTIC. The model may call the grouping entity `group`, `list` or
// `category`, and may name the computed `stats`, `counts` or `taskCounts` — an assertion that
// hardcodes a name measures the model's vocabulary rather than whether the feature works. So they
// look for SHAPE: an entity that some other entity points at, a page that narrows to a subset, a
// string that reads like a ratio.

import type { AppDefinition, Resolved } from "karta";

/** What the harness hands an assertion: the built app and a way to ask it questions. */
export interface AssertContext {
  definition: AppDefinition;
  /**
   * The definition BEFORE this modification.
   *
   * Added after two assertions got it wrong by reasoning about absolutes: "there are fewer than
   * three entities, so no shopping list was added" is a statement about the app, not about the
   * change, and it failed an app that had added exactly what was asked for. What a modification did
   * is only visible as a difference.
   */
  before: AppDefinition;
  /** Every record of an entity, resolved (relations followed, computed evaluated). */
  query: (entity: string) => Promise<Resolved[]>;
  /** A page's rows, with its own filter and sort applied — what the screen would show. */
  page: (pageId: string, params?: Record<string, unknown>) => Promise<Resolved[]>;
  /** Entity keys, in declaration order. */
  entities: string[];
  /** Page ids, in declaration order. */
  pages: string[];
  /**
   * What a page actually SHOWS: each row's resolved primary and secondary display text.
   *
   * Needed because a count is usually not a field. The model computes `openCount` and `totalCount`
   * and joins them in the view's `secondary` binding, so an assertion that reads record fields sees
   * two numbers and no ratio, and reports a working feature as missing. What the person sees is the
   * rendered string, so that is what gets asserted on.
   */
  display: (pageId: string) => Promise<string[]>;
}

/** Returns the reasons it failed. Empty means the modification demonstrably worked. */
export type Assertion = (ctx: AssertContext) => Promise<string[]>;

export interface Modification {
  instruction: string;
  expect?: Assertion;
}

export interface ModifyScenario {
  id: string;
  /** The app to build first. */
  description: string;
  mods: Modification[];
}

/** An entity that another entity has a relation to — the "grouping type", whatever it got called. */
function groupingEntity(def: AppDefinition): string | null {
  for (const [name, entity] of Object.entries(def.entities ?? {})) {
    for (const field of Object.values(entity.fields ?? {})) {
      const f = field as { type?: string; to?: string };
      if (f.type === "relation" && f.to && f.to !== name) return f.to;
    }
  }
  return null;
}

/** The entity that POINTS at `target`, and the field it points with. */
function ownerOf(def: AppDefinition, target: string): { entity: string; field: string } | null {
  for (const [name, entity] of Object.entries(def.entities ?? {})) {
    for (const [key, field] of Object.entries(entity.fields ?? {})) {
      const f = field as { type?: string; to?: string };
      if (f.type === "relation" && f.to === target) return { entity: name, field: key };
    }
  }
  return null;
}

/** Anything that reads like "3/7" — the count the prompt asked for, however it was built. */
const RATIO = /(\d+)\s*\/\s*(\d+)/;

export const MODIFY_SCENARIOS: ModifyScenario[] = [
  {
    // The report that started this. Kept verbatim.
    id: "todo-groups",
    description:
      "A shared todo list. I want to add items, tick them off, and see who added what. It should work offline and I want to share it with my partner.",
    mods: [
      {
        instruction:
          "I want to be able to create multiple todo lists, each one with their own name. there will be the default list as it is now, but we can add a group, give a name and then we can switch between the groups. in the groups selector there will be the number of open tasks in the group and total tasks (e.g. 11/20)",
        async expect(ctx) {
          const failures: string[] = [];
          const group = groupingEntity(ctx.definition);
          if (!group) return ["no grouping entity was added — nothing points at anything"];
          if (!ownerOf(ctx.definition, group)) return [`nothing points at "${group}"`];

          // The count, as it would appear on screen. Somewhere a page must render "open/total"
          // against a grouping row, and it must not be the 0/0 that a relation-vs-id comparison
          // produces — which is the whole reason this assertion exists.
          const shown: string[] = [];
          for (const p of ctx.pages) shown.push(...(await ctx.display(p)));
          const ratios = shown.map((t) => RATIO.exec(t)).filter(Boolean) as RegExpExecArray[];
          if (!ratios.length) failures.push(`no "open/total" count is rendered on any page`);
          else if (ratios.every((m) => m[1] === "0" && m[2] === "0")) {
            failures.push(`every count renders 0/0 — the grouping matches no records`);
          }
          return failures;
        },
      },
      {
        instruction: "let me reorder the items by dragging them, and remember the order",
      },
      {
        instruction: "add a due date to each item and show the ones due today at the top",
      },
    ],
  },
  {
    // The checklist view (#106): a shopping list must come out as one, and stay one when changed.
    id: "groceries",
    description: "A shopping list. I add things as I run out, tick them off in the shop as they go into the basket, and I want the ticked ones out of the way.",
    mods: [
      {
        instruction: "group the items by aisle — produce, dairy, bakery, pantry — with the aisle as a heading",
        async expect(ctx) {
          const failures: string[] = [];
          const checklist = ctx.definition.pages.find((p) => (p.view as { type?: string }).type === "checklist");
          if (!checklist) return ["no page is a checklist view — the list is a list whose rows open a form"];
          const view = checklist.view as { group?: unknown; quickAdd?: boolean };
          if (view.group === undefined) failures.push("the checklist has no `group` binding, so there are no aisle headings");
          if (!view.quickAdd) failures.push("the checklist has no `quickAdd`, so adding an item still opens a form");
          return failures;
        },
      },
      { instruction: "add a quantity next to each item, like 2 × 1 l" },
    ],
  },
  {
    id: "recipes-shopping",
    description:
      "Somewhere to keep my recipes with their ingredients and how long they take. I want to find the ones I can make with what I have.",
    mods: [
      {
        instruction: "add a shopping list — I want to pick a recipe and add all its missing ingredients to it",
        async expect(ctx) {
          // Relative to the previous version, not an absolute entity count — see `before`.
          const added = Object.keys(ctx.definition.entities ?? {}).filter((e) => !(e in (ctx.before.entities ?? {})));
          if (!added.length) return ["no new entity was added for the shopping list"];

          // And it has to be reachable: an entity nothing lists is a table, not a feature.
          for (const p of ctx.pages) {
            const view = (ctx.definition.pages ?? []).find((x) => x.id === p)?.view as { entity?: string } | undefined;
            if (view?.entity && added.includes(view.entity)) return [];
          }
          return [`"${added[0]}" was added but no page shows it`];
        },
      },
      { instruction: "let me mark a recipe as a favourite and filter to just those" },
      { instruction: "track how many times I've cooked each one and when I last did" },
    ],
  },
  {
    id: "habits",
    description: "A habit tracker. I want to tick off habits each day and see a streak.",
    mods: [
      {
        instruction: "let me group habits into morning, evening and weekend",
        async expect(ctx) {
          // Grouping by a fixed set has two good implementations and the harness must accept both:
          // separate pages that each narrow, or ONE page with filter chips. The first version of
          // this assertion demanded a page that shows a subset, and failed an app that had done it
          // with chips — which is arguably the nicer design, and is what the built-in views offer.
          const dimensionAdded = Object.entries(ctx.definition.entities ?? {}).some(([name, e]) =>
            Object.entries(e.fields ?? {}).some(([key, f]) => {
              const before = ctx.before.entities?.[name]?.fields?.[key];
              const field = f as { type?: string; options?: string[] };
              return !before && (field.type === "enum" || field.type === "tags" || field.type === "relation");
            }),
          );
          if (!dimensionAdded) return ["nothing was added to group habits by"];

          const chips = (ctx.definition.pages ?? []).some((p) => {
            const v = p.view as { filters?: unknown[] } | undefined;
            return Array.isArray(v?.filters) && v!.filters!.length > 0;
          });
          if (chips) return [];

          const all = await ctx.query(ctx.entities[0]!);
          if (all.length < 2) return ["not enough records to tell grouping apart"];
          for (const p of ctx.pages) {
            const rows = await ctx.page(p);
            if (rows.length > 0 && rows.length < all.length) return [];
          }
          return ["grouping exists in the schema, but no page filters by it and no chips were added"];
        },
      },
      { instruction: "show me a weekly view with how many I completed each day" },
      { instruction: "let me pause a habit without deleting it, and hide paused ones" },
    ],
  },
  {
    id: "expenses-split",
    description: "Track shared expenses on a trip — who paid, how much, and what for.",
    mods: [
      {
        instruction: "show me who owes who at the end, settled up",
        async expect(ctx) {
          const rows = await ctx.query(ctx.entities[0]!);
          if (!rows.length) return ["no expense records"];
          // A settle-up figure has to be a number that is not identically zero for every record.
          const numbers = rows.flatMap((r) => Object.values(r).filter((v) => typeof v === "number") as number[]);
          return numbers.some((n) => n !== 0) ? [] : ["every computed figure is zero — nothing is actually being summed"];
        },
      },
      { instruction: "let me add a photo of the receipt to each expense" },
      { instruction: "group expenses by category and show a total per category" },
    ],
  },
  {
    id: "plants",
    description: "Remind me when to water my plants, with a photo of each one and where it lives in the house.",
    mods: [
      { instruction: "let me record when I actually watered it, and work the next date from that" },
      {
        instruction: "add rooms, so I can see all the plants in the kitchen at once",
        async expect(ctx) {
          const room = groupingEntity(ctx.definition);
          if (!room) return ["no room entity was added"];
          const owner = ownerOf(ctx.definition, room);
          if (!owner) return [`nothing points at "${room}"`];
          // The point of rooms is a screen that shows one room's plants. Some page must narrow.
          const all = await ctx.query(owner.entity);
          let narrowed = false;
          for (const p of ctx.pages) {
            const rows = await ctx.page(p);
            if (rows.length > 0 && rows.length < all.length) narrowed = true;
          }
          return narrowed ? [] : ["no page narrows to one room's plants"];
        },
      },
      { instruction: "let me mark a plant as dead and stop reminding me about it" },
    ],
  },
  {
    id: "reading",
    description: "Books I'm reading, want to read, and have finished — with what I thought of them.",
    mods: [
      { instruction: "let me track what page I'm on and how far through I am" },
      { instruction: "add tags for genre and let me filter by them" },
      { instruction: "show me how many books I finished each month this year" },
    ],
  },
  {
    id: "workouts",
    description: "Log my gym sessions — which exercises, how many sets and reps, and what weight.",
    mods: [
      { instruction: "let me save a routine and start a session from it" },
      { instruction: "show my personal best for each exercise" },
      { instruction: "let me add a rest timer between sets" },
    ],
  },
  {
    id: "home-inventory",
    description: "What I own, what it cost, and where it is — for insurance.",
    mods: [
      { instruction: "let me put things in boxes and boxes in rooms" },
      { instruction: "add a photo and a receipt to each item" },
      { instruction: "show me the total value per room" },
    ],
  },
  {
    id: "meal-plan",
    description: "Plan what we're eating this week and what to buy.",
    mods: [
      { instruction: "let me assign a meal to each day of the week" },
      { instruction: "build the shopping list from the week's meals" },
      { instruction: "let me mark things I already have at home so they drop off the list" },
    ],
  },
  {
    id: "job-hunt",
    description: "Track job applications — where I applied, when, and what stage each one is at.",
    mods: [
      { instruction: "remind me to follow up if I haven't heard back in a week" },
      { instruction: "let me keep notes from each interview against the application" },
      { instruction: "show me how many applications are at each stage" },
    ],
  },
];
