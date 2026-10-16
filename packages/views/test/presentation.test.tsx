// @vitest-environment happy-dom
// The built-in views' design options (list `lead`, gallery `aspect`, detail `cover` / `facts` /
// `primaryAction`, the page count a view reports, backdrops) — what each renders, and what an app
// that sets none of them gets.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type AppInput } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { GalleryView, ListView } from "../src/builtins.js";
import { DetailView } from "../src/detail.js";
import { PageCountContext } from "../src/page-count.js";
import { firstPhotoField, initialOf, mediaFieldFor } from "../src/lead.js";
import { backdropImage, backdropKind, backdropOf, pageOf } from "../src/backdrop.js";

afterEach(cleanup);

const started: string[] = [];

function app(over: Partial<AppInput> = {}): AppInput {
  return {
    id: "gym",
    name: "Gym",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      exercise: {
        label: "Exercise",
        icon: "🏋",
        displayField: "name",
        fields: {
          name: { type: "text" },
          level: { type: "enum", options: ["easy", "hard"], colors: { easy: "green", hard: "red" } },
          notes: { type: "text" },
          reps: { type: "number" },
        },
        actions: { start: { label: "Start", icon: "▶", run: (r) => void started.push(String(r.name)) } },
      },
    },
    pages: [
      { id: "list", title: "Exercises", view: { type: "list", entity: "exercise", display: { primary: "name" }, onOpen: { page: "ex", param: { id: "id" } } } },
      { id: "icons", title: "Icons", view: { type: "list", entity: "exercise", display: { primary: "name", lead: "icon" } } },
      { id: "bare", title: "Bare", view: { type: "list", entity: "exercise", display: { primary: "name", lead: "none" } } },
      { id: "cards", title: "Cards", view: { type: "gallery", entity: "exercise", aspect: "portrait" } },
      { id: "ex", title: "Exercise", hidden: true, view: { type: "detail", entity: "exercise", param: "id", primaryAction: "start" } },
      { id: "full", title: "Full", hidden: true, background: { image: "art/gym.jpg" }, view: { type: "detail", entity: "exercise", param: "id", cover: "full", facts: ["reps"] } },
    ],
    ...over,
  };
}

async function runtimeFor(def: AppInput, rows: Record<string, unknown>[]): Promise<{ runtime: PotyroRuntime; ids: string[] }> {
  const store = new MemoryStore();
  const built = defineApp(def);
  await store.open(built.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: built });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
  const ids: string[] = [];
  for (const r of rows) ids.push(String((await runtime.ctx.create("exercise", r)).id));
  return { runtime, ids };
}

const props = (runtime: PotyroRuntime, pageId: string, params: Record<string, unknown> = {}) => ({
  runtime,
  pageId,
  params,
  setParam: () => {},
  navigate: () => {},
});

describe("a list row's lead", () => {
  it("is the record's initial in its own colour by default — the first coloured badge's, else its text's", async () => {
    const { runtime } = await runtimeFor(app(), [{ name: "squat", level: "hard" }]);
    render(<ListView {...props(runtime, "list")} />);
    await screen.findByText("squat");
    const lead = document.querySelector(".k-list-row .k-lead") as HTMLElement;
    expect(lead.textContent).toBe("S");
    expect(lead.dataset.glyph).toBe("initial");
    expect(lead.getAttribute("aria-hidden")).toBe("true");
    expect(lead.style.getPropertyValue("--swatch")).toMatch(/^oklch\(/);
  });

  it('is the entity\'s icon with `lead: "icon"`, and nothing with `lead: "none"`', async () => {
    const { runtime } = await runtimeFor(app(), [{ name: "squat" }]);
    render(<ListView {...props(runtime, "icons")} />);
    await screen.findByText("squat");
    expect(document.querySelector(".k-lead")?.textContent).toBe("🏋");
    cleanup();
    render(<ListView {...props(runtime, "bare")} />);
    await screen.findByText("squat");
    expect(document.querySelector(".k-list-row .k-lead")).toBeNull();
  });

  it("takes the first letter a person reads, whole", () => {
    expect(initialOf("élan")).toBe("É");
    expect(initialOf("  bench")).toBe("B");
    expect(initialOf("👩‍🍳 Chef")).toBe("👩‍🍳");
    expect(initialOf("")).toBe("·");
  });

  it("is the entity's first photo field when the page names none", () => {
    const fields = { name: { type: "text" as const }, doc: { type: "media" as const, accept: "any" as const }, pic: { type: "media" as const } };
    expect(firstPhotoField({ fields })).toBe("pic");
    expect(mediaFieldFor("doc", { fields })).toBe("doc");
    expect(mediaFieldFor(false, { fields })).toBeUndefined();
    expect(firstPhotoField({ fields: { name: { type: "text" } } })).toBeUndefined();
  });
});

describe("a short list", () => {
  it("offers the next one in its own shape, and stops offering once the page is full", async () => {
    const { runtime } = await runtimeFor(app(), [{ name: "squat" }]);
    const onCreate = vi.fn();
    render(<ListView {...props(runtime, "list")} onCreate={onCreate} />);
    await screen.findByText("squat");
    fireEvent.click(screen.getByRole("button", { name: "Add: Exercise" }));
    expect(onCreate).toHaveBeenCalledWith("exercise", {});
    cleanup();
    for (const name of ["a", "b", "c"]) await runtime.ctx.create("exercise", { name });
    render(<ListView {...props(runtime, "list")} onCreate={onCreate} />);
    await screen.findByText("squat");
    expect(screen.queryByRole("button", { name: "Add: Exercise" })).toBeNull();
  });

  it("an empty page says the app's words and offers the first one", async () => {
    const { runtime } = await runtimeFor(app(), []);
    const onCreate = vi.fn();
    render(<ListView {...props(runtime, "list")} onCreate={onCreate} />);
    expect(await screen.findByText("Nothing here yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add: Exercise/ }));
    expect(onCreate).toHaveBeenCalledWith("exercise", {});
  });
});

describe("the page's count", () => {
  it("is told by the view that has the rows, without a second query", async () => {
    const { runtime } = await runtimeFor(app(), [{ name: "a" }, { name: "b" }]);
    const heard: Array<number | undefined> = [];
    render(
      <PageCountContext.Provider value={(n) => heard.push(n)}>
        <ListView {...props(runtime, "list")} />
      </PageCountContext.Provider>,
    );
    await waitFor(() => expect(heard.at(-1)).toBe(2));
    cleanup();
    expect(heard.at(-1)).toBeUndefined();
  });
});

describe("a gallery", () => {
  it("takes its shape from `aspect`, and a card with no photo wears its colour and initial", async () => {
    const { runtime } = await runtimeFor(app(), [{ name: "plank" }]);
    render(<GalleryView {...props(runtime, "cards")} />);
    await screen.findByText("plank");
    expect(document.querySelector(".k-gallery")?.getAttribute("data-aspect")).toBe("portrait");
    expect(document.querySelector(".k-card-glyph")?.textContent).toBe("P");
    expect(document.querySelector(".k-placeholder")).toBeNull();
  });
});

describe("a record page", () => {
  it("opens on a band with the record's facts, its primary action big, and only what the record has", async () => {
    started.length = 0;
    const { runtime, ids } = await runtimeFor(app(), [{ name: "squat", level: "hard" }]);
    render(<DetailView {...props(runtime, "ex", { id: ids[0] })} />);
    await screen.findByRole("heading", { name: "squat" });
    expect(document.querySelector(".k-detail")?.getAttribute("data-cover")).toBe("band");
    // Facts default to the entity's enum fields, in their colour.
    expect(document.querySelector(".k-fact[data-tinted]")?.textContent).toBe("hard");
    // An empty field is not a dash on the page.
    expect(screen.queryByText("Notes")).toBeNull();
    const cta = document.querySelector(".k-cta") as HTMLButtonElement;
    expect(cta.textContent).toContain("Start");
    expect(cta.textContent).toContain("▶");
    fireEvent.click(cta);
    await waitFor(() => expect(started).toEqual(["squat"]));
    // One loud button per page: the bar's first action is not filled when the cover has one.
    expect(document.querySelector(".k-detail-actions .k-primary-action")).toBeNull();
  });

  it("fills the screen with the page's background picture when the record has no photo", async () => {
    const { runtime, ids } = await runtimeFor(app(), [{ name: "lunge", reps: 12 }]);
    render(<DetailView {...props(runtime, "full", { id: ids[0] })} />);
    await screen.findByRole("heading", { name: "lunge" });
    expect(document.querySelector(".k-detail")?.getAttribute("data-cover")).toBe("full");
    expect(document.querySelector(".k-fact")?.textContent).toBe("Reps 12");
  });
});

describe("backdrops", () => {
  const def = { theme: { background: "dots" as const }, pages: [{ id: "a" }, { id: "b", background: { image: "art/b.jpg" } }] };
  it("a page's own wins over the app's; with neither, a wash of the app's colour", () => {
    expect(backdropOf(def, pageOf(def, "a"))).toBe("dots");
    expect(backdropOf(def, pageOf(def, "b#1"))).toEqual({ image: "art/b.jpg" });
    expect(backdropOf({ pages: [] }, undefined)).toBe("wash");
    expect(backdropImage(def, pageOf(def, "b"))).toBe("art/b.jpg");
    expect(backdropImage(def, pageOf(def, "a"))).toBeUndefined();
    expect(backdropKind({ image: "x" })).toBe("image");
  });
});
