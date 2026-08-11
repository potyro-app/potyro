// The migration shape, and the error messages it gives when a model gets it wrong.
//
// Both of these come from one real report. Asked to add todo lists to a working app, the agent
// produced migrations that failed validation with:
//
//   migrations.0.from: Expected string, received number
//   migrations.0.to: Expected string, received number
//   migrations.0.steps.0: Invalid input
//   migrations.0.steps.1: Invalid input
//
// The first two are the model reaching for `schemaVersion` (a number, right there in the same
// object) when `from`/`to` are APP VERSIONS. The last two said nothing at all — to the user, and to
// the repair model that was handed the same text and asked to fix it.
//
// The deeper hazard is the near miss: `{ from: "1", to: "2" }` is a string, so it PASSES a plain
// `z.string()`, and then never runs, because `migrateOnLoad` matches `from` against the app version
// the data was written under. Requiring semver is what turns silent inertness into something
// somebody can see.

import { describe, expect, it } from "vitest";
import { structureSchema } from "../src/validate.js";

const app = (migrations: unknown): unknown => ({
  id: "todo",
  name: "Todo",
  version: "1.1.0",
  schemaVersion: 2,
  entities: { todo: { fields: { title: { type: "text" } } } },
  pages: [{ id: "all", title: "Todos", view: { type: "list", entity: "todo" } }],
  migrations,
});

const issuesFor = (migrations: unknown): string[] => {
  const r = structureSchema.safeParse(app(migrations));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
};

describe("a migration's from/to are app versions", () => {
  it("accepts the semver pair the runtime actually matches on", () => {
    expect(
      issuesFor([{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addRelation", entity: "todo", field: "list", to: "list" }] }]),
    ).toEqual([]);
  });

  it("rejects schemaVersion numbers, which is what the model reached for", () => {
    const issues = issuesFor([{ from: 1, to: 2, steps: [] }]);
    expect(issues.join(" ")).toContain("migrations.0.from");
    expect(issues.join(" ")).toContain("migrations.0.to");
  });

  it("rejects a bare `1`/`2` — a string, but one that can never match", () => {
    // The case worth having a test for. It is the shape the generator's contract used to ask for:
    // valid to a `z.string()`, and inert forever.
    const issues = issuesFor([{ from: "1", to: "2", steps: [] }]);
    expect(issues.length, "a string that matches no stored version must not pass").toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("semver");
  });
});

describe("a step that is wrong says what the steps ARE", () => {
  it("names every allowed op when the op does not exist", () => {
    // `addEntity` is the one a model invents when asked to add a grouping type — and it does not
    // exist, because a new entity has no records and needs no step.
    const issues = issuesFor([{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addEntity", entity: "list" }] }]);
    const text = issues.join(" ");
    expect(text, "the old message was just `Invalid input`").toContain("addField");
    expect(text).toContain("addRelation");
    expect(text).toContain("setDefaultForExisting");
  });

  it("names the missing key when the op is right", () => {
    const issues = issuesFor([{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addRelation", entity: "todo", to: "list" }] }]);
    expect(issues.join(" ")).toContain("field");
    expect(issues.join(" ")).not.toContain("Invalid input");
  });

  it("still takes a `transform` step, which has no op at all", () => {
    expect(issuesFor([{ from: "1.0.0", to: "1.1.0", steps: [{ transform: (r: unknown) => r }] }])).toEqual([]);
  });

  it("says so when transform is not a function", () => {
    const issues = issuesFor([{ from: "1.0.0", to: "1.1.0", steps: [{ transform: "nope" }] }]);
    expect(issues.join(" ")).toContain("transform must be a function");
  });
});
