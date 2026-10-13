// @vitest-environment happy-dom
// An enum's options read as their `labels` in the person's language (#302, docs/20 §9.2), while the
// record keeps the option: a board's columns, the record's pill, the form's buttons, a table cell.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { BoardView } from "../src/board.js";
import { FieldValue } from "../src/field-value.js";
import { FieldInput } from "../src/field-input.js";
import { TableView } from "../src/builtins.js";

const app: PotyroApp = defineApp({
  id: "labels",
  name: { en: "Tasks", pl: "Zadania" },
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pl"],
  entities: {
    task: {
      label: { en: "Task", pl: "Zadanie" },
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        status: {
          type: "enum",
          options: ["todo", "done"],
          labels: { todo: { en: "To do", pl: "Do zrobienia" }, done: { en: "Done", pl: "Zrobione" } },
        },
      },
    },
  },
  pages: [
    { id: "board", title: "Board", view: { type: "board", entity: "task", column: "status", display: { primary: "title" } } },
    { id: "table", title: "Table", view: { type: "table", entity: "task", display: { columns: ["title", "status"] } } },
  ],
});

async function makeRuntime(languages: string[]): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open(app.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav, languages });
  await runtime.ctx.create("task", { title: "Write tests", status: "todo" });
  return runtime;
}

afterEach(cleanup);

describe("enum labels", () => {
  it("a board titles its columns in the person's language", async () => {
    const runtime = await makeRuntime(["pl-PL"]);
    render(<BoardView runtime={runtime} pageId="board" params={{}} setParam={() => {}} navigate={() => {}} />);
    await screen.findByText("Write tests");
    const titles = [...document.querySelectorAll(".k-board-col-title")].map((e) => e.textContent);
    expect(titles).toEqual(["Do zrobienia", "Zrobione"]);
  });

  it("the record's pill and a table cell show the label; the stored value is still the option", async () => {
    const runtime = await makeRuntime(["pl"]);
    render(<FieldValue runtime={runtime} entity="task" fieldKey="status" value="done" />);
    expect(screen.getByText("Zrobione")).toBeTruthy();
    cleanup();
    render(<TableView runtime={runtime} pageId="table" params={{}} setParam={() => {}} navigate={() => {}} />);
    expect(await screen.findByText("Do zrobienia")).toBeTruthy();
    const [row] = await runtime.ctx.query("task");
    expect(row!.status).toBe("todo");
  });

  it("the form's buttons say the label and write the option", async () => {
    const runtime = await makeRuntime(["en-GB"]);
    let written: unknown;
    const field = runtime.definition.entities.task!.fields.status!;
    render(<FieldInput runtime={runtime} field={field} value={null} onChange={(v) => (written = v)} label="Status" />);
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(written).toBe("done");
  });
});
