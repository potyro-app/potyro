// @vitest-environment happy-dom
// A multiline text field reads back on the record page with its own line breaks — a recipe's steps,
// a note in paragraphs — and a one-line field stays plain text.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldValue } from "../src/field-value.js";

const app = defineApp({
  id: "text-value",
  name: "Text Value",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    idea: { displayField: "title", fields: { title: { type: "text", required: true }, steps: { type: "text", multiline: true } } },
  },
  pages: [{ id: "list", title: "Ideas", view: { type: "list", entity: "idea", display: { primary: "title" } } }],
});

async function makeRuntime(): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open(app.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

afterEach(cleanup);

describe("a text field on the record page", () => {
  it("keeps a multiline field's line breaks", async () => {
    const runtime = await makeRuntime();
    const { container } = render(<FieldValue runtime={runtime} entity="idea" fieldKey="steps" value={"1. Fry\n2. Simmer"} />);
    const lines = container.querySelector(".k-text-lines");
    expect(lines?.textContent).toBe("1. Fry\n2. Simmer");
  });

  it("leaves a one-line field as plain text", async () => {
    const runtime = await makeRuntime();
    const { container } = render(<FieldValue runtime={runtime} entity="idea" fieldKey="title" value="Chicken rice" />);
    expect(container.querySelector(".k-text-lines")).toBeNull();
    expect(container.textContent).toBe("Chicken rice");
  });
});
