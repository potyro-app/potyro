import { test, expect, type Page } from "./console-guard";

// Edit mode: change the app's own words where they are on screen.
//
// What has to hold, in a real browser against the real shell:
//
//   - what is marked editable is exactly the text written literally in the app — a custom view's
//     JSX, tab names, field labels — and never a record's own data or the shell's menus
//   - tapping marked text edits it instead of doing what the element does (a button doesn't fire)
//   - saving splices the source (nothing else in the file moves), shows at once, and is a version
//   - fields and tabs move from the same spot, and the app re-runs with edit mode still on
//   - where nothing is editable, the bar says so and points at the Studio — no empty panel

const APP_SOURCE = `import { defineApp } from "potyro";
import { useState } from "react";

function Board(props) {
  const [count, setCount] = useState(0);
  return (
    <div className="board">
      <h2>Plan for today</h2>
      <button type="button" onClick={() => setCount(count + 1)}>
        Start session
      </button>
      <p className="count">Pressed {count}</p>
    </div>
  );
}

export default defineApp({
  id: "kit",
  name: "Kit",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Name" },
        // how many of them there are
        quantity: { type: "number" },
        notes: { type: "text", multiline: true },
      },
    },
  },
  pages: [
    { id: "all", title: "Everything", view: { type: "table", entity: "item", display: { columns: ["title", "quantity"] } } },
    { id: "board", title: "Board", view: { type: "custom", entity: "item", render: (props) => Board(props) } },
  ],
});
`;

async function seed(page: Page): Promise<void> {
  // Once: a re-run reloads the page, and re-seeding would overwrite the edit under test.
  await page.addInitScript((src) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem(
      "potyro:user-apps",
      JSON.stringify([{ id: "kit", name: "Kit", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
  }, APP_SOURCE);
}

/** A read that lands mid-reload throws; that is "not yet". */
const storedSource = async (page: Page): Promise<string> => {
  try {
    return await page.evaluate(
      () => (JSON.parse(localStorage.getItem("potyro:user-apps")!) as { id: string; source: string }[]).find((a) => a.id === "kit")!.source,
    );
  } catch {
    return "";
  }
};

/** What edit mode has marked, as the text of each highlighted range. */
const marked = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("k-editable");
    return h ? [...h].map((r) => r.toString().trim()).filter(Boolean) : [];
  });

async function openKit(page: Page): Promise<void> {
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");
}

/** A table shows its header only once it has a row. */
async function addItem(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /Add: Item/ }).first().click();
  const form = page.locator(".k-modal");
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: /Save|Add|Create/ }).first().click();
  await expect(page.locator(".k-table td", { hasText: name })).toBeVisible();
}

async function editMode(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Edit mode" });
  if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
  await expect(page.locator(".k-inline-bar")).toBeVisible();
}

/** Click the middle of the first rendered occurrence of `text` — the way a person taps a word —
 *  once edit mode has marked it (it reads the app's source first). */
async function tapText(page: Page, text: string, within = "body"): Promise<void> {
  await expect.poll(() => marked(page)).toContain(text);
  const box = await page.evaluate(
    ({ text, within }) => {
      const root = document.querySelector(within)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.textContent?.trim() !== text) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.width > 0) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    },
    { text, within },
  );
  if (!box) throw new Error(`no visible text "${text}"`);
  await page.mouse.click(box.x, box.y);
}

async function awaitRerun(page: Page, act: () => Promise<void>): Promise<void> {
  const MARK = "__potyro_pre_reload";
  await page.evaluate((key: string) => ((globalThis as Record<string, unknown>)[key] = true), MARK);
  await act();
  await expect
    .poll(() => page.evaluate((key: string) => (globalThis as Record<string, unknown>)[key] === undefined, MARK).catch(() => false), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect(page.locator("h1")).toHaveText("Kit");
}

test("marks the custom view's own words, and renames a button in place without pressing it", async ({ page }) => {
  await openKit(page);
  await page.locator(".k-tab", { hasText: "Board" }).first().click();
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
  await editMode(page);

  await expect.poll(() => marked(page)).toEqual(expect.arrayContaining(["Plan for today", "Start session", "Pressed", "Board", "Everything"]));
  // The shell's own tools are not the app's words.
  expect(await marked(page)).not.toContain("Edit mode");

  await tapText(page, "Start session", ".board");
  const pop = page.getByRole("dialog", { name: "Change text" });
  await expect(pop).toBeVisible();
  // The tap edited the label; it did not press the button.
  await expect(page.locator(".count")).toHaveText("Pressed 0");

  await pop.getByRole("textbox").fill("Begin workout");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(pop).toHaveCount(0);
  // Shown at once, before any re-run.
  await expect(page.locator(".board button")).toHaveText("Begin workout");

  await expect.poll(() => storedSource(page)).toContain("Begin workout");
  const after = await storedSource(page);
  // A splice, not a rewrite: only that line differs.
  const before = APP_SOURCE.split("\n");
  expect(after.split("\n").filter((l, i) => l !== before[i])).toEqual(["        Begin workout"]);

  // Done re-runs the app; the new label is now what the app itself renders, and the button works.
  await awaitRerun(page, () => page.locator(".k-inline-bar").getByRole("button", { name: "Done" }).click());
  await expect(page.locator(".k-inline-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Begin workout" }).click();
  await expect(page.locator(".count")).toHaveText("Pressed 1");
});

test("never offers a record's own data, even when it reads like the app's words", async ({ page }) => {
  await openKit(page);
  // A record whose name is the same as the Board page's heading.
  await addItem(page, "Plan for today");

  await editMode(page);
  await expect.poll(() => marked(page)).toEqual(expect.arrayContaining(["Name", "Quantity"]));
  expect(await marked(page)).not.toContain("Plan for today");
});

test("renames a field from its column header, including one that had no label written", async ({ page }) => {
  await openKit(page);
  await addItem(page, "Rope");
  await editMode(page);
  await expect.poll(() => marked(page)).toContain("Quantity");

  await tapText(page, "Quantity", ".k-table");
  const pop = page.getByRole("dialog", { name: "Change field name" });
  await pop.getByRole("textbox").fill("How many");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".k-table th", { hasText: "How many" })).toBeVisible();
  await expect.poll(() => storedSource(page)).toContain(`quantity: { label: "How many", type: "number" }`);
  // It landed in History as a hand adjustment — History re-runs nothing, so finish editing first.
  await awaitRerun(page, () => page.locator(".k-inline-bar").getByRole("button", { name: "Done" }).click());
  await page.getByRole("button", { name: "History" }).click();
  const newest = page.locator(".k-timeline-entry").first();
  await expect(newest.locator(".k-history-origin")).toHaveText("adjusted");
  await expect(newest.locator(".k-timeline-note")).toContainText("quantity");
});

test("moves a field and a tab from the same spot, and stays in edit mode across the re-run", async ({ page }) => {
  await openKit(page);
  await addItem(page, "Rope");
  await editMode(page);

  await tapText(page, "Quantity", ".k-table");
  await awaitRerun(page, () => page.getByRole("dialog", { name: "Change field name" }).getByRole("button", { name: "↑ Earlier" }).click());
  await expect(page.locator(".k-inline-bar")).toBeVisible();
  const src = await storedSource(page);
  expect(src.indexOf("quantity:")).toBeLessThan(src.indexOf("title:"));
  // The field's comment travelled with it.
  expect(src).toContain("// how many of them there are\n        quantity:");

  await expect.poll(() => marked(page)).toContain("Board");
  await tapText(page, "Board", ".k-nav");
  await awaitRerun(page, () => page.getByRole("dialog", { name: "Change page name" }).getByRole("button", { name: "← Earlier" }).click());
  await expect(page.locator(".k-nav .k-tab-label").first()).toHaveText("Board");
});

test("hiding a field takes it out of the form", async ({ page }) => {
  await openKit(page);
  await addItem(page, "Rope");
  await editMode(page);
  await tapText(page, "Quantity", ".k-table");
  await awaitRerun(page, () => page.getByRole("dialog", { name: "Change field name" }).getByLabel("Hide from the form").check());
  await expect.poll(() => storedSource(page)).toContain("hidden: true");
  await page.locator(".k-inline-bar").getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Add: Item/ }).first().click();
  await expect(page.locator(".k-modal .k-form-label", { hasText: "Name" })).toBeVisible();
  await expect(page.locator(".k-modal .k-form-label", { hasText: "Quantity" })).toHaveCount(0);
});

test("with nothing editable on screen, the bar says so and the Studio is one tap away", async ({ page }) => {
  // One page, and every word on it computed: there is no literal to change anywhere.
  const COMPUTED = `import { defineApp } from "potyro";

function Screen() {
  return <p className="computed">{["Nothing", "literal"].join(" ")}</p>;
}

export default defineApp({
  id: "kit",
  name: "Kit",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { item: { fields: { title: { type: "text" } } } },
  pages: [{ id: "only", title: String("Only"), view: { type: "custom", entity: "item", render: () => Screen() } }],
});
`;
  await page.addInitScript((src) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "kit", name: "Kit", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]));
  }, COMPUTED);
  await page.goto("/?user=kit");
  await expect(page.locator(".computed")).toHaveText("Nothing literal");
  await editMode(page);
  await expect(page.locator(".k-inline-bar")).toContainText("Nothing on this screen is written as plain text in the app.");
  expect(await marked(page)).toEqual([]);

  await page.locator(".k-inline-bar").getByRole("button", { name: "Ask the Studio" }).click();
  await expect(page.getByRole("textbox", { name: "Describe the app" })).toHaveValue(/^On the "Only" page: $/);
});

test("a record's text is never offered, even when a placeholder or label reads the same (Groceries)", async ({ page }) => {
  // The seeded Groceries has an item "Milk" and an aisle "Produce" — and its source has
  // `placeholder: "Milk"` and `placeholder: "Produce"`. Both rows were highlighted as editable.
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(page.locator(".k-checklist").getByRole("checkbox", { name: "Milk" })).toBeVisible();
  await editMode(page);
  // The tab is the app's own word, so it is offered — which also proves the marks are in.
  await expect.poll(() => marked(page)).toContain("Shopping");
  const words = await marked(page);
  expect(words).not.toContain("Milk");
  expect(words).not.toContain("Produce");
});
