import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition, type Computed } from "../src/index.js";

const minimal: AppDefinition = {
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    task: {
      label: "Task",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        done: { type: "boolean", default: false },
        priority: { type: "number", min: 0, max: 3, integer: true },
      },
      computed: {
        label: (r) => (r.done ? `✓ ${r.title}` : r.title),
      },
      actions: {
        toggle: async (r, ctx) => {
          await ctx.patch("task", r.id, { done: !r.done });
        },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "All",
      view: {
        type: "list",
        entity: "task",
        sort: (a, b) => a.title.localeCompare(b.title),
        display: { primary: "title", secondary: (r) => (r.done ? "done" : "todo") },
        rowActions: ["toggle"],
      },
    },
  ],
};

describe("defineApp — valid definitions", () => {
  it("accepts a minimal app and brands + normalizes it", () => {
    const app = defineApp(minimal);
    expect(app.__potyroApp).toBe(true);
    expect(app.id).toBe("todo");
    // normalized optional arrays
    expect(app.reminders).toEqual([]);
    expect(app.migrations).toEqual([]);
    // function closures survive
    expect(typeof app.entities.task.actions?.toggle).toBe("function");
  });

  it("preserves computed/binding function identity (does not wrap or strip)", () => {
    const app = defineApp(minimal);
    const computed = app.entities.task.computed?.label as Computed | undefined; // written as a bare function
    expect(computed?.({ id: "x", createdAt: "", updatedAt: "", done: true, title: "hi" } as never, {} as never)).toBe(
      "✓ hi",
    );
  });
});

describe("defineApp — invalid declarative parts throw ValidationError", () => {
  it("rejects a bad semver version", () => {
    expect(() => defineApp({ ...minimal, version: "one" })).toThrow(ValidationError);
  });

  it("rejects an id that is not a slug", () => {
    expect(() => defineApp({ ...minimal, id: "Not A Slug" })).toThrow(ValidationError);
  });

  it("rejects an unknown field type", () => {
    const bad = {
      ...minimal,
      entities: {
        task: { ...minimal.entities.task, fields: { title: { type: "wat" } } },
      },
    } as unknown as AppDefinition;
    expect(() => defineApp(bad)).toThrow(ValidationError);
  });

  it("rejects an enum field with no options", () => {
    const bad = {
      ...minimal,
      entities: {
        task: { ...minimal.entities.task, fields: { title: { type: "text" }, k: { type: "enum", options: [] } } },
      },
    } as unknown as AppDefinition;
    expect(() => defineApp(bad)).toThrow(ValidationError);
  });
});

describe("defineApp — referential integrity", () => {
  it("rejects a relation to an unknown entity", () => {
    const bad: AppDefinition = {
      ...minimal,
      entities: {
        task: {
          ...minimal.entities.task,
          fields: { ...minimal.entities.task.fields, owner: { type: "relation", to: "person" } },
        },
      },
    };
    expect(() => defineApp(bad)).toThrow(/unknown entity "person"/);
  });

  it("rejects a view over an unknown entity", () => {
    const bad: AppDefinition = {
      ...minimal,
      pages: [{ id: "x", title: "X", view: { type: "list", entity: "ghost" } }],
    };
    expect(() => defineApp(bad)).toThrow(/unknown entity "ghost"/);
  });

  it("rejects a detail section referencing an unknown field", () => {
    const bad: AppDefinition = {
      ...minimal,
      pages: [
        {
          id: "d",
          title: "D",
          view: { type: "detail", entity: "task", sections: [{ title: "S", fields: ["nope"] }] },
        },
      ],
    };
    expect(() => defineApp(bad)).toThrow(/unknown field\/computed "nope"/);
  });

  it("allows a string binding that points at a computed key", () => {
    const ok: AppDefinition = {
      ...minimal,
      pages: [
        {
          id: "t",
          title: "T",
          view: { type: "table", entity: "task", display: { columns: ["title", "label"] } },
        },
      ],
    };
    expect(() => defineApp(ok)).not.toThrow();
  });

  it("collects multiple issues into one error", () => {
    const bad: AppDefinition = {
      ...minimal,
      pages: [{ id: "x", title: "X", view: { type: "map", entity: "ghost", geo: "nowhere" } }],
    };
    try {
      defineApp(bad);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues.length).toBeGreaterThanOrEqual(1);
    }
  });
});
