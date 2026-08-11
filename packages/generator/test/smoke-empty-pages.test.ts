// A page that throws every record away is a failure with no other symptom.
//
// From a real report. Asked to group todos into named lists, the agent produced an app that
// compiled, validated, rendered, migrated its existing data correctly — and did nothing. The filter
// was `(todo) => todo.list === ctx.params.listId`, and a `relation` resolves to the RELATED RECORD,
// so it compared an object with a string. Always false. The per-list page was empty and the
// "open/total" counter read 0/0, with no error raised anywhere for anyone to notice.
//
// Every existing gate passed that app. This is the one that does not: seeding gives every record a
// relation, so a filter of that shape shows up as a page that matched nothing.

import { describe, expect, it } from "vitest";
import { defineApp } from "karta";
import { smokeApp } from "../src/smoke.js";

const app = (filter: (todo: never, ctx: never) => boolean) =>
  defineApp({
    id: "shared-todo",
    name: "Shared Todo",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      list: { label: "List", displayField: "name", fields: { name: { type: "text", required: true } } },
      todo: {
        label: "Todo",
        displayField: "title",
        fields: { title: { type: "text", required: true }, list: { type: "relation", to: "list" } },
      },
    },
    pages: [
      { id: "lists", title: "Lists", view: { type: "list", entity: "list", display: { primary: "name" } } },
      {
        id: "list-todos",
        title: "Todos",
        view: { type: "list", entity: "todo", filter, display: { primary: "title" } },
      },
    ],
  } as never);

describe("a filter that can never match", () => {
  it("reports the page when a relation is compared to an id", async () => {
    // The exact line the model wrote.
    const result = await smokeApp(app(((t: { list?: unknown }, ctx: { params: Record<string, unknown> }) =>
      t.list === ctx.params.listId) as never) as never);

    expect(result.errors, "nothing throws — that is the whole problem").toEqual([]);
    expect(result.emptyPages).toContain("list-todos");
  });

  it("says nothing once the comparison reads the related record's id", async () => {
    // `.id` is the difference between an app that works and one that silently does not. A gate that
    // also fired here would be noise, and noise is how the real signal gets dismissed.
    const result = await smokeApp(app(((t: { list?: { id?: string } }) => Boolean(t.list?.id)) as never) as never);

    expect(result.errors).toEqual([]);
    expect(result.emptyPages).not.toContain("list-todos");
  });

  it("leaves an unfiltered page alone", async () => {
    const result = await smokeApp(app((() => true) as never) as never);
    expect(result.emptyPages).toEqual([]);
  });
});
