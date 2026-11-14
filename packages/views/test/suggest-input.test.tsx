// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FieldInput, RecordForm } from "../src/index.js";
import { settle } from "../src/suggest-input.js";

// A list that grows with the person's data (#82): a `text` field with `suggest` offers the values
// its records already hold, takes a new one as typed, and offers that one the next time.

const app = defineApp({
  id: "cellar",
  name: "Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    wine: {
      label: "Wine",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        region: { type: "text", suggest: true },
        colour: { type: "text", suggest: ["Red", "White", "Rosé"] },
        notes: { type: "text" },
      },
    },
  },
  pages: [{ id: "list", title: "Wines", view: { type: "list", entity: "wine", display: { primary: "name" } } }],
});

async function makeRuntime(wines: Array<Record<string, unknown>> = []): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("cellar");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  for (const wine of wines) await runtime.ctx.create("wine", wine);
  return runtime;
}

const CELLAR = [
  { name: "A", region: "Piemonte", colour: "Red" },
  { name: "B", region: "Douro", colour: "Orange" },
  { name: "C", region: "Piemonte" },
  { name: "D", region: "Mosel" },
];

/** The field as a form holds it: what is typed is the value. */
function Held({ runtime, field, initial = "" }: { runtime: PotyroRuntime; field: "region" | "colour"; initial?: string }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <>
      <FieldInput runtime={runtime} field={runtime.definition.entities.wine!.fields[field]!} value={value} onChange={setValue} label={field} source={{ entity: "wine", field }} />
      <output data-testid="value">{String(value)}</output>
    </>
  );
}

const offered = (): string[] => screen.queryAllByRole("option").map((o) => o.textContent ?? "");
const held = (): string => screen.getByTestId("value").textContent ?? "";

afterEach(cleanup);

describe("a text field with suggest", () => {
  it("is a combobox that offers the values its records hold, once each, in order", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox", { name: "region" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toEqual(["Douro", "Mosel", "Piemonte"]));
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "region" }).id).toBe(box.getAttribute("aria-controls"));
  });

  it("adds the declared starting values to the ones in use", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="colour" />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(offered()).toEqual(["Orange", "Red", "Rosé", "White"]));
  });

  it("offers the starting values before there is any record, and nothing at all when there are none", async () => {
    const runtime = await makeRuntime();
    const { unmount } = render(<Held runtime={runtime} field="colour" />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(offered()).toEqual(["Red", "Rosé", "White"]));
    unmount();

    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("narrows as you type, and a tap takes one", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toHaveLength(3));
    fireEvent.change(box, { target: { value: "o" } });
    expect(offered()).toEqual(["Douro", "Mosel", "Piemonte", "Add “o”"]);
    fireEvent.change(box, { target: { value: "mo" } });
    expect(offered()).toEqual(["Mosel", "Piemonte", "Add “mo”"]);
    fireEvent.click(screen.getByRole("option", { name: "Mosel" }));
    expect(held()).toBe("Mosel");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps a value nobody used yet, exactly as typed, and says so", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    fireEvent.change(box, { target: { value: "Etna" } });
    await waitFor(() => expect(offered()).toEqual(["Add “Etna”"]));
    fireEvent.click(screen.getByRole("option", { name: "Add “Etna”" }));
    expect(held()).toBe("Etna");
  });

  it("opens on every choice when the field already has a value", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" initial="Mosel" />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(offered()).toEqual(["Douro", "Mosel", "Piemonte"]));
    expect(screen.getByRole("option", { name: "Mosel" }).getAttribute("aria-selected")).toBe("true");
  });

  it("walks the list with the arrow keys and takes the active one with Enter, the focus staying in the field", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toHaveLength(3));
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const active = document.getElementById(box.getAttribute("aria-activedescendant")!);
    expect(active?.textContent).toBe("Mosel");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(document.getElementById(box.getAttribute("aria-activedescendant")!)?.textContent).toBe("Piemonte");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(held()).toBe("Piemonte");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stays closed when the field is only passed through, and opens from the keyboard with Down or by typing", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    await waitFor(() => expect(runtime.ctx.query("wine")).resolves.toHaveLength(4));
    fireEvent.focus(box);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await waitFor(() => expect(offered()).toEqual(["Douro", "Mosel", "Piemonte"]));
    expect(document.getElementById(box.getAttribute("aria-activedescendant")!)?.textContent).toBe("Douro");
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.change(box, { target: { value: "pi" } });
    expect(offered()).toEqual(["Piemonte", "Add “pi”"]);
  });

  it("settles an offered value's spelling on Enter instead of saving a second spelling", async () => {
    const runtime = await makeRuntime(CELLAR);
    let submitted = 0;
    render(
      <form onSubmit={(e) => (e.preventDefault(), (submitted += 1))}>
        <Held runtime={runtime} field="region" />
      </form>,
    );
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toHaveLength(3));
    fireEvent.change(box, { target: { value: "mosel" } });
    const settledFirst = !fireEvent.keyDown(box, { key: "Enter" });
    expect(settledFirst).toBe(true); // the key was taken: no submit follows it
    expect(held()).toBe("Mosel");
    // The next Enter is the form's.
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true);
    expect(submitted).toBe(0);
  });

  it("closes the list on Escape without the key reaching the sheet around it", async () => {
    const runtime = await makeRuntime(CELLAR);
    let escaped = 0;
    render(
      <div onKeyDown={(e) => (e.key === "Escape" ? (escaped += 1) : null)}>
        <Held runtime={runtime} field="region" />
      </div>,
    );
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toHaveLength(3));
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(escaped).toBe(0);
    // With the list closed, Escape is the sheet's again.
    fireEvent.keyDown(box, { key: "Escape" });
    expect(escaped).toBe(1);
  });

  it("settles the spelling of a value that is already offered, and trims, when the field is left", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<Held runtime={runtime} field="region" />);
    const box = screen.getByRole("combobox");
    fireEvent.click(box);
    await waitFor(() => expect(offered()).toHaveLength(3));
    fireEvent.change(box, { target: { value: "  piemonte " } });
    fireEvent.blur(box);
    expect(held()).toBe("Piemonte");
    fireEvent.click(box);
    fireEvent.change(box, { target: { value: " Etna  " } });
    fireEvent.blur(box);
    expect(held()).toBe("Etna");
  });

  it("is a plain input for a field without suggest", async () => {
    const runtime = await makeRuntime(CELLAR);
    render(<FieldInput runtime={runtime} field={runtime.definition.entities.wine!.fields.notes!} value="" onChange={() => {}} source={{ entity: "wine", field: "notes" }} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});

describe("settle", () => {
  it("trims, and takes an offered choice's spelling", () => {
    expect(settle("  barolo ", ["Barolo", "Etna"])).toBe("Barolo");
    expect(settle(" New one ", ["Barolo"])).toBe("New one");
    expect(settle("   ", ["Barolo"])).toBe("");
  });
});

describe("in the record form", () => {
  it("saves a new value as plain text, trimmed, and offers it on the next record", async () => {
    const runtime = await makeRuntime(CELLAR);
    const first = render(<RecordForm runtime={runtime} entity="wine" onDone={() => {}} onCancel={() => {}} />);
    const name = (await screen.findAllByRole("textbox"))[0]!;
    fireEvent.change(name, { target: { value: "E" } });
    const region = screen.getByRole("combobox", { name: "Region" });
    fireEvent.click(region);
    // Typed and saved with Enter in the form, without ever leaving the field.
    fireEvent.change(region, { target: { value: "  Etna " } });
    fireEvent.submit(region.closest("form")!);
    await waitFor(async () => expect((await runtime.ctx.query("wine")).map((w) => w.region)).toContain("Etna"));
    first.unmount();

    render(<RecordForm runtime={runtime} entity="wine" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Region" }));
    await waitFor(() => expect(offered()).toEqual(["Douro", "Etna", "Mosel", "Piemonte"]));
  });
});
