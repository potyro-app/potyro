// @vitest-environment happy-dom
//
// A form's fill buttons (#81): "Scan label" above the first field of the create and the edit form.
// The app's function returns values; the form fills what is empty, asks before replacing what the
// person entered (only where the new value differs), names what a field refused, and says a failure
// at the button. Nothing is saved by any of it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defineApp, type FillFn } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { RecordForm } from "../src/record-form.js";

const toast = vi.fn();

/** What the next press of "Scan label" does. */
let scan: FillFn = () => ({});
/** The drafts it was handed. */
const drafts: Array<Record<string, unknown>> = [];

const app = (fill: unknown[] | undefined) =>
  defineApp({
    id: "cellar",
    name: "Cellar",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      bottle: {
        label: "Bottle",
        displayField: "name",
        fields: {
          name: { type: "text", required: true },
          year: { type: "number", integer: true, min: 1900 },
          grape: { type: "enum", options: ["malbec", "merlot", "syrah"], labels: { malbec: "Malbec", merlot: "Merlot", syrah: "Syrah" } },
          price: { type: "money", currency: "EUR" },
          bottles: { type: "number", integer: true, default: 1 },
          opened: { type: "boolean" },
          source: { type: "text", hidden: true },
          notes: { type: "text", multiline: true },
        },
        ...(fill ? { fill } : {}),
      },
    },
    pages: [{ id: "all", title: "Bottles", view: { type: "list", entity: "bottle" } }],
  } as never);

const SCAN = [
  {
    label: "Scan label",
    icon: "camera",
    description: "Reads the label with AI",
    run: ((draft, ctx) => {
      drafts.push({ ...draft });
      return scan(draft, ctx);
    }) as FillFn,
  },
];

async function makeRuntime(fill: unknown[] | null = SCAN): Promise<{ runtime: PotyroRuntime; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.open("cellar");
  const ui: UiBridge = { toast, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app(fill ?? undefined) });
  return { runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }), store };
}

afterEach(() => {
  cleanup();
  toast.mockClear();
  drafts.length = 0;
  scan = () => ({});
  vi.restoreAllMocks();
});

const nameBox = (): HTMLInputElement => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
const yearBox = (): HTMLInputElement => screen.getByRole("spinbutton", { name: "Year" }) as HTMLInputElement;
const scanButton = (): HTMLElement => screen.getByRole("button", { name: "Scan label" });
const type = (el: HTMLElement, value: string): void => void fireEvent.change(el, { target: { value } });
const press = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const review = (): HTMLElement => screen.getByRole("group", { name: "Replace what you entered?" });
const noReview = (): void => expect(screen.queryByRole("group", { name: "Replace what you entered?" })).toBeNull();

async function openCreate(fill?: unknown[] | null): Promise<{ runtime: PotyroRuntime; store: MemoryStore; onDone: ReturnType<typeof vi.fn> }> {
  const made = await makeRuntime(fill);
  const onDone = vi.fn();
  render(<RecordForm runtime={made.runtime} entity="bottle" onDone={onDone} onCancel={() => {}} />);
  await screen.findByRole("textbox", { name: "Name" });
  return { ...made, onDone };
}

describe("a form's fill button", () => {
  it("sits above the first field, with its words, and the form still opens on the first field", async () => {
    await openCreate();
    const button = scanButton();
    expect(button.compareDocumentPosition(nameBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.closest(".k-form-body")).toBeTruthy();
    expect(screen.getByText("Reads the label with AI")).toBeTruthy();
    expect(button.getAttribute("type")).toBe("button");
    expect(document.activeElement).toBe(nameBox());
  });

  it("is not there for an entity that declares none", async () => {
    await openCreate([]);
    expect(document.querySelector("[data-k-form-fill]")).toBeNull();
    cleanup();
    const { runtime } = await makeRuntime(null);
    render(<RecordForm runtime={runtime} entity="bottle" onDone={() => {}} onCancel={() => {}} />);
    await screen.findByRole("textbox", { name: "Name" });
    expect(document.querySelector("[data-k-form-fill]")).toBeNull();
  });

  it("fills the empty fields of a new record, says which, and saves nothing", async () => {
    const { store } = await openCreate();
    scan = () => ({ name: "Catena", year: 2019, grape: "malbec", source: "label" });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena"));
    expect(yearBox().value).toBe("2019");
    expect(screen.getByRole("radio", { name: "Malbec" }).getAttribute("aria-checked")).toBe("true");
    noReview();
    // A hidden field is filled too, and not announced: the person never sees it.
    expect(screen.getByRole("status").textContent).toBe("Filled in: Name, Year, and Grape");
    expect(drafts[0]).toMatchObject({ bottles: 1, opened: false });
    expect(drafts[0]!.id).toBeUndefined();
    expect(await store.all("bottle")).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("the filled values are what the form saves", async () => {
    const { store, onDone } = await openCreate();
    scan = () => ({ name: "Catena", year: 2019, source: "label" });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena"));
    await press(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await store.all("bottle"))[0]).toMatchObject({ name: "Catena", year: 2019, source: "label" });
  });

  it("asks before replacing what the person entered — only where the new value differs", async () => {
    await openCreate();
    type(nameBox(), "My Malbec");
    type(yearBox(), "2018");
    scan = () => ({ name: "Catena", year: 2018, grape: "merlot", price: 1250 });
    await press(scanButton());
    const group = await waitFor(review);
    // Name differs: listed, theirs beside the new one. Year is the same: not mentioned. Grape and
    // Price were empty: filled without a question.
    expect(within(group).getAllByRole("group").map((g) => within(g).getByText(/./, { selector: "legend" }).textContent)).toEqual(["Name"]);
    expect(within(group).getByRole("radio", { name: /^Yours\s*My Malbec$/ })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /^New\s*Catena$/ })).toBeTruthy();
    expect(nameBox().value).toBe("My Malbec");
    expect(screen.getByRole("radio", { name: "Merlot" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(group);
    expect(screen.getByText("Filled in: Grape and Price")).toBeTruthy();
  });

  it("says nothing at all when the app returns nothing: the person closed its camera or its list", async () => {
    await openCreate();
    type(nameBox(), "Catena");
    scan = () => null;
    await press(scanButton());
    await waitFor(() => expect(scanButton().getAttribute("aria-busy")).toBe("false"));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    noReview();
    expect(nameBox().value).toBe("Catena");
  });

  it("shows no review when every filled field got the same value back", async () => {
    await openCreate();
    type(nameBox(), "Catena");
    type(yearBox(), "2019");
    scan = () => ({ name: " Catena ", year: 2019 });
    await press(scanButton());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nothing new to fill in."));
    noReview();
    expect(nameBox().value).toBe("Catena");
  });

  it("takes the choice field by field: the picked ones are replaced, the others kept", async () => {
    await openCreate();
    type(nameBox(), "My Malbec");
    type(yearBox(), "2018");
    type(screen.getByRole("textbox", { name: "Notes" }), "from Ana");
    scan = () => ({ name: "Catena", year: 2019, notes: "Mendoza" });
    await press(scanButton());
    const group = await waitFor(review);
    const use = within(group).getByRole("button", { name: "Use selected" }) as HTMLButtonElement;
    // Nothing is picked for the person: every field starts on theirs.
    expect(within(group).getAllByRole("radio", { name: /^Yours/ }).every((r) => (r as HTMLInputElement).checked)).toBe(true);
    expect(use.disabled).toBe(true);
    await press(within(group).getByRole("radio", { name: /^New\s*2,?019$/ }));
    expect(use.disabled).toBe(false);
    await press(use);
    noReview();
    expect(yearBox().value).toBe("2019");
    expect(nameBox().value).toBe("My Malbec");
    expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).value).toBe("from Ana");
    // The focus goes back into the form, to the button that asked.
    expect(document.activeElement).toBe(scanButton());
  });

  it("“Use all new” replaces every listed field, “Keep mine” none", async () => {
    await openCreate();
    type(nameBox(), "My Malbec");
    type(yearBox(), "2018");
    scan = () => ({ name: "Catena", year: 2019 });
    await press(scanButton());
    await press(within(await waitFor(review)).getByRole("button", { name: "Keep mine" }));
    noReview();
    expect([nameBox().value, yearBox().value]).toEqual(["My Malbec", "2018"]);

    await press(scanButton());
    await press(within(await waitFor(review)).getByRole("button", { name: "Use all new" }));
    noReview();
    expect([nameBox().value, yearBox().value]).toEqual(["Catena", "2019"]);
  });

  it("shows the two values the way the form shows them: an option's label, money as money", async () => {
    const { runtime } = await makeRuntime();
    const saved = await runtime.create("bottle", { name: "Catena", grape: "malbec", price: 1250 });
    render(<RecordForm runtime={runtime} entity="bottle" recordId={saved.id} onDone={() => {}} onCancel={() => {}} />);
    await screen.findByRole("textbox", { name: "Name" });
    scan = () => ({ grape: "syrah", price: 1999 });
    await press(scanButton());
    const group = await waitFor(review);
    expect(within(group).getByRole("radio", { name: /^Yours\s*Malbec$/ })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /^New\s*Syrah$/ })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /^Yours\s*€\s?12\.50$/ })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /^New\s*€\s?19\.99$/ })).toBeTruthy();
  });

  it("replaces what nobody typed without asking: a default, and what an earlier fill put there", async () => {
    await openCreate();
    expect((screen.getByRole("spinbutton", { name: "Bottles" }) as HTMLInputElement).value).toBe("1");
    scan = () => ({ name: "Catena", bottles: 6, opened: true });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena"));
    noReview();
    expect((screen.getByRole("spinbutton", { name: "Bottles" }) as HTMLInputElement).value).toBe("6");
    expect(screen.getByRole("switch", { name: "Opened" }).getAttribute("aria-checked")).toBe("true");
    // Scanned again: the first scan's values are not the person's, so the second replaces them.
    scan = () => ({ name: "Catena Alta" });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena Alta"));
    noReview();
    // Once the person corrects it, it is theirs.
    type(nameBox(), "Catena Alta 2019");
    scan = () => ({ name: "Catena" });
    await press(scanButton());
    await waitFor(review);
    expect(nameBox().value).toBe("Catena Alta 2019");
  });

  it("names a value its field refused under the button, fills the rest, and does not throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openCreate();
    scan = () => ({ name: "Catena", grape: "Cabernet Sauvignon", year: 1492.5, vintage: 2019 });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena"));
    const lines = [...document.querySelectorAll('.k-form-fill-note[data-kind="skipped"]')].map((p) => p.textContent);
    expect(lines).toEqual(["Not filled: Grape must be one of: malbec, merlot, syrah.", "Not filled: Year must be a whole number."]);
    expect(yearBox().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says a failure at the button, in the words an action's failure gets — no toast", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime } = await openCreate();
    const heard: string[] = [];
    runtime.onFailure((f) => heard.push(`${f.what}: ${f.message}`));
    type(nameBox(), "Mine");
    scan = () => {
      throw new Error("Hold the label flat and try again");
    };
    await press(scanButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Hold the label flat and try again");
    expect(alert.closest("[data-k-form-fill]")).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
    expect(heard).toEqual(["fill bottle[0]: Hold the label flat and try again"]);
    // A bug is one plain sentence; the form is as it was and still works.
    scan = (draft) => ({ name: (draft.nope as { deeper: string }).deeper });
    await press(scanButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That did not work"));
    expect(nameBox().value).toBe("Mine");
    scan = () => ({ year: 2019 });
    await press(scanButton());
    await waitFor(() => expect(yearBox().value).toBe("2019"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an answer that is not a set of values is a failure said plainly, not a crash", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openCreate();
    scan = (() => "Catena") as never;
    await press(scanButton());
    expect((await screen.findByRole("alert")).textContent).toBe("That did not work");
    expect(nameBox().value).toBe("");
  });

  it("closing the camera or saying “Not now” is not an error: nothing is said", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await openCreate();
    scan = () => {
      throw new Error("Cancelled: no file was chosen");
    };
    await press(scanButton());
    await waitFor(() => expect(scanButton().getAttribute("aria-busy")).toBe("false"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("while it runs the form is usable but not saved, and it cannot be started twice", async () => {
    const { onDone, store } = await openCreate();
    let finish: (v: Record<string, unknown>) => void = () => {};
    scan = () => new Promise((resolve) => (finish = resolve));
    await press(scanButton());
    await waitFor(() => expect(scanButton().getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("status").textContent).toBe("Working on it…");
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await press(scanButton());
    expect(drafts).toHaveLength(1);
    // Typing goes on meanwhile, and what was typed is what the answer is weighed against.
    type(nameBox(), "Typed while it read");
    fireEvent.submit(nameBox().closest("form")!);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      finish({ name: "Catena", year: 2019 });
    });
    await waitFor(review);
    expect(nameBox().value).toBe("Typed while it read");
    expect(yearBox().value).toBe("2019");
    expect(create.disabled).toBe(false);
    expect(await store.all("bottle")).toEqual([]);
  });

  it("an answer that arrives after the form was closed touches nothing", async () => {
    await openCreate();
    let finish: (v: Record<string, unknown>) => void = () => {};
    scan = () => new Promise((resolve) => (finish = resolve));
    await press(scanButton());
    cleanup();
    await act(async () => {
      finish({ name: "Catena" });
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("on the edit form: the draft is the record, and its saved values are the person's", async () => {
    const { runtime, store } = await makeRuntime();
    const saved = await runtime.create("bottle", { name: "Catena", year: 2018, bottles: 1 });
    const onDone = vi.fn();
    render(<RecordForm runtime={runtime} entity="bottle" recordId={saved.id} onDone={onDone} onCancel={() => {}} />);
    await screen.findByRole("textbox", { name: "Name" });
    expect(scanButton()).toBeTruthy();
    scan = () => ({ name: "Catena", year: 2019, bottles: 6, grape: "syrah" });
    await press(scanButton());
    const group = await waitFor(review);
    expect(drafts[0]).toMatchObject({ id: saved.id, name: "Catena", year: 2018 });
    // Name is the same; Year and Bottles were saved by the person; Grape was empty.
    expect(within(group).getAllByRole("group").map((g) => g.querySelector("legend")!.textContent)).toEqual(["Year", "Bottles"]);
    expect(screen.getByRole("radio", { name: "Syrah" }).getAttribute("aria-checked")).toBe("true");
    // Nothing reached the record yet.
    expect(await store.get("bottle", saved.id)).toMatchObject({ year: 2018, bottles: 1 });
    await press(within(group).getByRole("button", { name: "Use all new" }));
    await press(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(saved.id));
    expect(await store.get("bottle", saved.id)).toMatchObject({ name: "Catena", year: 2019, bottles: 6, grape: "syrah" });
  });

  it("a filled field answers its “Required”", async () => {
    await openCreate();
    await press(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Required")).toBeTruthy();
    scan = () => ({ name: "Catena" });
    await press(scanButton());
    await waitFor(() => expect(nameBox().value).toBe("Catena"));
    expect(screen.queryByText("Required")).toBeNull();
  });

  it("offers every declared button, each running its own function", async () => {
    const lookup = vi.fn(() => ({ notes: "looked up" }));
    await openCreate([...SCAN, { label: "Look it up", run: lookup }]);
    await press(screen.getByRole("button", { name: "Look it up" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).value).toBe("looked up"));
    expect(drafts).toHaveLength(0);
  });
});
