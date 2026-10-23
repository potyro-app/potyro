// @vitest-environment happy-dom
//
// Structural editing of a real `.app.ts`. Two properties matter above all:
//
//  1. Nothing outside the edited range changes. The source is versioned and diffed, so a label
//     change that reflows the file makes History useless. That is why this parses for POSITIONS and
//     splices text, rather than printing an AST back.
//  2. It refuses rather than guesses. An app may build its fields from a helper or a spread; there is
//     then nothing to edit, and corrupting someone's module is far worse than declining.
//
// Fixtures are the real example apps plus a source the agent actually generated, so "works on
// hand-written and generated code" is tested rather than assumed.

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyEdit, inspect, resetSourceTools, type Edit } from "../src/app-source.js";

// cwd is packages/shell when vitest runs this workspace project.
const read = (name: string): string => readFileSync(resolve(process.cwd(), "../../examples", name), "utf8");
const PLACES = read("places.app.ts");
const RECIPES = read("recipes.app.tsx");
const WORKOUT = read("workout.app.tsx");

/** What the agent produced for the user's city-places app — generated code, not hand-written. */
const GENERATED = `import { defineApp } from "potyro";

export default defineApp({
  id: "city-places",
  name: "City Places",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      label: "Place",
      fields: {
        name: { type: "text", required: true },
        tags: { type: "tags", options: ["favorite", "cheap"] },
        location: { type: "geo" },
      },
    },
  },
  pages: [{ id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location" } }],
});
`;

const apply = async (source: string, edit: Edit): Promise<string> => {
  const result = await applyEdit(source, edit);
  if (!result.ok) throw new Error(`edit refused: ${result.reason}`);
  return result.source;
};

/** Everything except the lines that differ — the guard against a printer reflowing the file. */
const untouchedLines = (before: string, after: string): boolean => {
  const a = before.split("\n");
  const b = after.split("\n");
  const changed = a.filter((line, i) => b[i] !== line).length;
  return changed <= 3 && Math.abs(a.length - b.length) <= 1;
};

beforeEach(resetSourceTools);

describe("inspect", () => {
  it("reads entities, fields and pages from every real app", async () => {
    for (const source of [PLACES, RECIPES, WORKOUT, GENERATED]) {
      const shape = await inspect(source);
      expect(shape.blocked).toBeUndefined();
      expect(shape.entities.length).toBeGreaterThan(0);
      expect(shape.pages.length).toBeGreaterThan(0);
      for (const entity of shape.entities) expect(entity.blocked).toBeUndefined();
    }
  });

  it("reports each page's entity, which is what the panel offers field controls for", async () => {
    const shape = await inspect(PLACES);
    expect(shape.pages.find((p) => p.id === "map")).toMatchObject({ title: "Map", entity: "place" });
  });

  it("reports a field's declared label and hidden flag", async () => {
    const edited = await apply(GENERATED, { kind: "field-label", entity: "place", field: "name", value: "Place name" });
    const withHidden = await apply(edited, { kind: "field-hidden", entity: "place", field: "tags", value: true });

    const fields = (await inspect(withHidden)).entities[0]!.fields;
    expect(fields.find((f) => f.key === "name")).toEqual({ key: "name", label: "Place name", hidden: false });
    expect(fields.find((f) => f.key === "tags")).toEqual({ key: "tags", hidden: true });
  });

  it("says why an app it cannot read structurally is off limits", async () => {
    const opaque = 'import { defineApp } from "potyro";\nconst config = buildIt();\nexport default defineApp(config);\n';
    const shape = await inspect(opaque);
    expect(shape.blocked).toMatch(/defineApp/);
    expect(shape.entities).toEqual([]);
  });

  it("blocks one entity for a spread without blocking the rest of the app", async () => {
    const spread = GENERATED.replace("name: { type: \"text\", required: true },", "...commonFields,");
    const shape = await inspect(spread);
    expect(shape.blocked).toBeUndefined();
    expect(shape.entities[0]!.blocked).toMatch(/spread|computed/);
    expect(shape.entities[0]!.fields).toEqual([]);
  });
});

describe("field label", () => {
  it("inserts a label where the app declared none", async () => {
    // The common case: generated apps lean on the field key, so renaming is an INSERT, not a replace.
    // (The examples label every field, in six languages since #303.)
    const next = await apply(GENERATED, { kind: "field-label", entity: "place", field: "name", value: "Place name" });
    expect(next).toContain('name: { label: "Place name", type: "text", required: true }');
    expect(untouchedLines(GENERATED, next)).toBe(true);
  });

  it("replaces a label that is already there", async () => {
    const once = await apply(PLACES, { kind: "field-label", entity: "place", field: "name", value: "First" });
    const twice = await apply(once, { kind: "field-label", entity: "place", field: "name", value: "Second" });
    expect(twice).toContain('label: "Second"');
    expect(twice).not.toContain('label: "First"');
    expect(untouchedLines(once, twice)).toBe(true);
  });

  it("clears the label rather than writing an empty one", async () => {
    // An empty string would render a blank label; the default is the ABSENCE of the property.
    const set = await apply(GENERATED, { kind: "field-label", entity: "place", field: "name", value: "Temp" });
    const cleared = await apply(set, { kind: "field-label", entity: "place", field: "name", value: "  " });
    expect(cleared).not.toContain('label: ""');
    expect(cleared).toContain('name: { type: "text", required: true }');
  });

  it("escapes a label that would otherwise break the source", async () => {
    const next = await apply(PLACES, { kind: "field-label", entity: "place", field: "name", value: 'He said "hi"\\' });
    const shape = await inspect(next);
    expect(shape.blocked).toBeUndefined();
    expect(shape.entities.find((e) => e.key === "place")!.fields[0]!.label).toBe('He said "hi"\\');
  });
});

describe("hiding a field", () => {
  it("sets and clears the flag", async () => {
    const hidden = await apply(PLACES, { kind: "field-hidden", entity: "place", field: "notes", value: true });
    expect(hidden).toContain("notes: { hidden: true,");

    const shown = await apply(hidden, { kind: "field-hidden", entity: "place", field: "notes", value: false });
    // Byte-identical to where we started — clearing must leave no trace, not an explicit `false`.
    // (Asserting on the whole file rather than the substring: `places.app.ts` legitimately declares
    // `hidden: true` on a page, which is not what this is about.)
    expect(shown).toBe(PLACES);
  });
});

describe("reordering fields", () => {
  it("moves a field and keeps everything else intact", async () => {
    const before = (await inspect(PLACES)).entities.find((e) => e.key === "place")!.fields.map((f) => f.key);
    const moved = [before[0]!, before[7]!, ...before.slice(1, 7), ...before.slice(8)];

    const next = await apply(PLACES, { kind: "field-order", entity: "place", order: moved });
    const after = (await inspect(next)).entities.find((e) => e.key === "place")!.fields.map((f) => f.key);
    expect(after).toEqual(moved);
    // Same fields, same count — a reorder must never lose one.
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("carries a field's own comment with it", async () => {
    const source = `import { defineApp } from "potyro";
export default defineApp({
  id: "a", name: "A", version: "1.0.0", schemaVersion: 1,
  entities: {
    thing: {
      displayField: "name",
      fields: {
        name: { type: "text" },
        // measured at the widest point
        width: { type: "number" },
      },
    },
  },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "thing" } }],
});
`;
    const next = await apply(source, { kind: "field-order", entity: "thing", order: ["width", "name"] });
    // The comment must travel with `width`, not stay above whatever lands in that slot.
    expect(next).toMatch(/\/\/ measured at the widest point\s*\n\s*width:/);
  });

  it("refuses an order that isn't the same set of fields", async () => {
    expect(await applyEdit(PLACES, { kind: "field-order", entity: "place", order: ["name"] })).toEqual({
      ok: false,
      reason: expect.stringContaining("exactly the fields"),
    });
  });

  it("pins displayField before a reorder that would change it", async () => {
    // `displayFieldFor` falls back to the FIRST field. Without pinning, dragging a field to the top
    // silently renames every record in every list and relation picker.
    const source = `import { defineApp } from "potyro";
export default defineApp({
  id: "a", name: "A", version: "1.0.0", schemaVersion: 1,
  entities: { thing: { fields: { title: { type: "text" }, code: { type: "text" } } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "thing" } }],
});
`;
    expect(source).not.toContain("displayField");
    const next = await apply(source, { kind: "field-order", entity: "thing", order: ["code", "title"] });
    expect(next).toContain('displayField: "title"');
  });

  it("leaves displayField alone when the reorder cannot change it", async () => {
    // `places` declares displayField explicitly, so there is nothing to protect against.
    const before = (await inspect(PLACES)).entities.find((e) => e.key === "place")!.fields.map((f) => f.key);
    const next = await apply(PLACES, { kind: "field-order", entity: "place", order: [...before].reverse() });
    expect(next.match(/displayField/g) ?? []).toHaveLength(PLACES.match(/displayField/g)!.length);
  });
});

describe("page title", () => {
  it("renames a page", async () => {
    const next = await apply(PLACES, { kind: "page-title", page: "map", value: "Where things are" });
    expect(next).toContain('title: "Where things are"');
    expect(untouchedLines(PLACES, next)).toBe(true);
  });

  it("refuses a page it can't find literally", async () => {
    expect(await applyEdit(PLACES, { kind: "page-title", page: "nope", value: "x" })).toEqual({
      ok: false,
      reason: expect.stringContaining("nope"),
    });
  });
});

describe("refusing rather than guessing", () => {
  it.each([
    ["an unknown entity", { kind: "field-label", entity: "ghost", field: "a", value: "x" }],
    ["an unknown field", { kind: "field-label", entity: "place", field: "ghost", value: "x" }],
  ] as [string, Edit][])("declines %s with a reason", async (_label, edit) => {
    const result = await applyEdit(PLACES, edit);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBeTruthy();
  });

  it("declines an app whose fields come from a spread", async () => {
    const spread = GENERATED.replace('name: { type: "text", required: true },', "...commonFields,");
    const result = await applyEdit(spread, { kind: "field-label", entity: "place", field: "tags", value: "Tags" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("spread") });
  });

  it("declines source it cannot parse instead of mangling it", async () => {
    const result = await applyEdit("this is not { valid ts", { kind: "page-title", page: "map", value: "x" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("parse") });
  });
});

describe("everything else is byte-identical", () => {
  it("preserves comments, imports and functions across an edit", async () => {
    // recipes.app.ts is the hard case: imports, helper modules, a custom view, comments throughout.
    // Written in English, translated in catalogs (docs/30): the label is one string.
    const next = await apply(RECIPES, { kind: "field-label", entity: "recipe", field: "servings", value: "Serves" });

    const comments = (s: string): number => (s.match(/\/\//g) ?? []).length;
    expect(comments(next)).toBe(comments(RECIPES));
    expect(next.split("\n")).toHaveLength(RECIPES.split("\n").length);

    // The only differing line is the one that was edited.
    const differing = RECIPES.split("\n").filter((l, i) => next.split("\n")[i] !== l);
    expect(differing).toHaveLength(1);
    expect(differing[0]).toContain('label: "Servings"');
  });
});

// #82: the launcher shows an app's identity without running it, so `inspect` reads it from the
// source — the literal `name`, `icon` and `theme.accent`, and nothing when they are not literal.
describe("inspect: identity", () => {
  it("reads name, icon and accent when they are written literally", async () => {
    const source = `import { defineApp } from "potyro";
export default defineApp({ id: "gym", name: "PPL Log", icon: "🏋", version: "1.0.0", schemaVersion: 1, theme: { accent: "#5B8DEF" },
  entities: { x: { fields: { name: { type: "text" } } } }, pages: [] });`;
    expect(await inspect(source)).toMatchObject({ name: "PPL Log", icon: "🏋", accent: "#5B8DEF" });
  });

  it("leaves out what is not there, or not literal", async () => {
    const source = `import { defineApp } from "potyro";
const NAME = "Computed";
export default defineApp({ id: "x", name: NAME, version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] });`;
    const shape = await inspect(source);
    expect(shape.name).toBeUndefined();
    expect(shape.icon).toBeUndefined();
    expect(shape.accent).toBeUndefined();
  });

  it("reads the example apps' identity", async () => {
    const workout = readFileSync(resolve(process.cwd(), "../../examples/workout.app.tsx"), "utf8");
    expect(await inspect(workout)).toMatchObject({ name: "Workout", icon: "dumbbell", accent: "#B6E62E" });
  });
});

// Entity groups (#100): read when written literally, and regrouped in place — a group's
// `fields: [...]` is the only text that changes, so titles, comments and the fold stay put.
describe("groups", () => {
  const GROUPED = `import { defineApp } from "potyro";
export default defineApp({
  id: "a", name: "A", version: "1.0.0", schemaVersion: 1,
  entities: {
    recipe: {
      displayField: "name",
      fields: {
        name: { type: "text" },
        servings: { type: "number" },
        notes: { type: "text" },
        rating: { type: "number" },
      },
      computed: { calories: () => 1 },
      groups: [
        // what you see first
        { title: "Overview", fields: ["name", "servings"] },
        { title: "Nutrition", fields: ["calories"], collapsed: true },
      ],
    },
  },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "recipe" } }],
});
`;

  it("reads the groups and the computed keys of the real Recipes app", async () => {
    const recipe = (await inspect(RECIPES)).entities.find((e) => e.key === "recipe")!;
    // Titles in English; their translations are the app's catalogs (docs/30).
    expect(recipe.groups?.map((g) => g.title)).toEqual(["Overview", "Ingredients", "Steps", "Nutrition & cost", "Your notes"]);
    expect(recipe.groups?.[3]?.fields).toContain("caloriesPerServing");
    expect(recipe.computed).toContain("caloriesPerServing");
    expect(recipe.blocked).toBeUndefined();
  });

  it("moves a field between groups by rewriting only that group's list", async () => {
    const next = await apply(GROUPED, { kind: "field-groups", entity: "recipe", groups: [["name"], ["servings", "calories"]] });
    expect(next).toContain(`{ title: "Overview", fields: ["name"] }`);
    expect(next).toContain(`{ title: "Nutrition", fields: ["servings", "calories"], collapsed: true }`);
    expect(next).toContain("// what you see first");
    expect(untouchedLines(GROUPED, next)).toBe(true);
    expect((await inspect(next)).entities[0]!.groups?.map((g) => g.fields)).toEqual([["name"], ["servings", "calories"]]);
  });

  it("refuses a regroup that names an unknown key, lists one twice, or empties a group", async () => {
    const refused = async (groups: string[][]) => (await applyEdit(GROUPED, { kind: "field-groups", entity: "recipe", groups })) as { ok: false; reason: string };
    expect((await refused([["name", "photo"], ["calories"]])).reason).toContain('"photo"');
    expect((await refused([["name", "servings"], ["name"]])).reason).toContain("one group");
    expect((await refused([["name", "servings"], []])).reason).toContain("Nutrition");
    expect((await refused([["name", "servings"]])).reason).toContain("groups that are there now");
  });

  it("marks an entity whose groups are not literal, rather than guessing", async () => {
    const source = GROUPED.replace(/groups: \[[\s\S]*?\n      \],/, "groups: makeGroups(),");
    expect(source).toContain("makeGroups()");
    const recipe = (await inspect(source)).entities[0]!;
    expect(recipe.blocked).toMatch(/groups/);
  });
});
