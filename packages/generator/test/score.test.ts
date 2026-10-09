import { describe, expect, it } from "vitest";
import { scoreSource } from "../src/index.js";

// The three scoring gates: compile (esbuild), validate (defineApp/Zod at import), render (query).

const GOOD = `
import { defineApp } from "potyro";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: {
    title: { type: "text", required: true },
    done: { type: "boolean", default: false },
  }, computed: { shout: (t) => String(t.title).toUpperCase() } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});
`;

const SYNTAX_ERROR = `export default (`; // unbalanced → esbuild parse error

const NOT_POTYRO = `export default { hello: 1 };`; // valid JS, not a PotyroApp

const INVALID_SCHEMA = `
import { defineApp } from "potyro";
export default defineApp({
  id: "x", name: "X", version: "1.0.0", schemaVersion: 1,
  entities: { a: { label: "A", displayField: "n", fields: { n: { type: "text" } } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "MISSING", display: { primary: "n" } } }],
});
`;

describe("scoreSource", () => {
  it("scores a well-formed app as compiles + validates + renders", async () => {
    const r = await scoreSource(GOOD);
    expect(r).toMatchObject({ compiles: true, validates: true, renders: true });
    expect(r.errors).toEqual([]);
  });

  it("fails the compile gate on a syntax error", async () => {
    const r = await scoreSource(SYNTAX_ERROR);
    expect(r.compiles).toBe(false);
    expect(r.validates).toBe(false);
    expect(r.errors[0]).toMatch(/^compile:/);
  });

  it("compiles but fails validation when the default export isn't a PotyroApp", async () => {
    const r = await scoreSource(NOT_POTYRO);
    expect(r).toMatchObject({ compiles: true, validates: false, renders: false });
    expect(r.errors[0]).toMatch(/^validate:/);
  });

  it("fails validation when defineApp rejects the schema (unknown entity)", async () => {
    const r = await scoreSource(INVALID_SCHEMA);
    expect(r).toMatchObject({ compiles: true, validates: false });
    expect(r.errors[0]).toMatch(/^validate:/);
  });
});
