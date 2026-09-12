import { test, expect, type Page } from "@playwright/test";

// Direct structural editing: change a label, hide a field, reorder fields, rename a page — without a
// model in the loop.
//
// These are edits to declarative data, so they need no intelligence, and routing them through the
// agent is where the cost/risk is worst: a minute of waiting and a whole-file rewrite to change six
// characters. What has to hold end to end:
//
//   - the change reaches the running app (not just the stored source)
//   - the source is edited surgically — everything outside the change is untouched
//   - it lands in History as `adjusted`, distinguishable from an agent rewrite
//   - where the source can't be edited structurally, the panel says so instead of pretending

const APP_SOURCE = `import { defineApp } from "karta";

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
        title: { type: "text", required: true },
        // how many of them there are
        quantity: { type: "number" },
        notes: { type: "text", multiline: true },
      },
    },
  },
  pages: [{ id: "all", title: "Everything", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});
`;

async function seed(page: Page, source = APP_SOURCE): Promise<void> {
  // Seed once: the panel reloads the app after saving, and re-seeding would overwrite the edit.
  await page.addInitScript((src) => {
    if (localStorage.getItem("karta:user-apps")) return;
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "kit", name: "Kit", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
  }, source);
}

/** Applying an edit reloads the app, so a poll can land mid-navigation — treat that as "not yet". */
const storedSource = async (page: Page): Promise<string> => {
  try {
    return await page.evaluate(
      () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { id: string; source: string }[]).find((a) => a.id === "kit")!.source,
    );
  } catch {
    return "";
  }
};

/** The app declares no quick actions, so the shell offers an automatic "New <Entity>". */
async function openNewItemForm(page: Page): Promise<void> {
  await page.locator(".k-quickbar").getByRole("button", { name: /New Item/ }).click();
  await expect(page.locator(".k-modal")).toBeVisible();
}

/** The form's field labels, in the order they are rendered. */
const formLabels = (page: Page): Promise<string[]> => page.locator(".k-modal .k-form-label").allInnerTexts();

async function openPanel(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Edit mode" });
  if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
  await page.locator(".k-editmark").last().click();
  await expect(page.locator(".k-modifydialog")).toBeVisible();
}

/**
 * Close the panel, and wait for the app the change produced.
 *
 * A structural edit defers its re-run to the moment the panel closes, and the re-run is a
 * `location.reload()` (`closeModify` in App.tsx). The dialog disappearing says the dialog
 * unmounted — nothing more. Anything read straight afterwards can be read from the document that is
 * ABOUT to be replaced, so a form opened here shows the fields as they were BEFORE the edit, and
 * the assertion fails with the exact symptom of the product bug this spec exists to catch. It was
 * intermittent for precisely that reason: which document you get is a race with the browser.
 *
 * A sentinel on `window` is the honest signal. It cannot survive the navigation, and nothing else
 * on this page changes — the title is "Kit" either side of the reload, the tab is the same tab.
 */
async function closePanelAndAwaitRerun(page: Page): Promise<void> {
  const MARK = "__karta_pre_reload";
  await page.evaluate((key: string) => ((globalThis as Record<string, unknown>)[key] = true), MARK);
  await page.locator(".k-modifydialog").getByRole("button", { name: /Close|Cancel/ }).click();
  await expect
    .poll(
      () =>
        page
          // A read that lands mid-navigation throws; that is "not yet", not a failure.
          .evaluate((key: string) => (globalThis as Record<string, unknown>)[key] === undefined, MARK)
          .catch(() => false),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.locator(".k-modifydialog")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText("Kit");
}

test("renaming a field label edits the source surgically and lands in History", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");
  const before = await storedSource(page);

  await openPanel(page);
  await page.getByLabel("Label for quantity").fill("How many");
  await page.getByLabel("Label for quantity").blur();

  await expect.poll(() => storedSource(page)).toContain('label: "How many"');
  await closePanelAndAwaitRerun(page);
  const after = await storedSource(page);

  // Surgical: same line count, and exactly one line differs. This is the property that makes a
  // structural edit reviewable — a printer that reflowed the file would make History useless.
  const b = before.split("\n");
  const a = after.split("\n");
  expect(a).toHaveLength(b.length);
  expect(b.filter((line, i) => a[i] !== line)).toHaveLength(1);
  // The field's own comment is still on the field it explains.
  expect(after).toMatch(/\/\/ how many of them there are\s*\n\s*quantity:/);

  await page.getByRole("button", { name: "History" }).click();
  const newest = page.locator(".k-timeline-entry").first();
  // `adjusted`, not `edit`: you changed this, the agent didn't rewrite the file.
  await expect(newest.locator(".k-history-origin")).toHaveText("adjusted");
  // The prompt is the headline of the timeline row — you should not have to open anything to see
  // what a version was for.
  await expect(newest.locator(".k-timeline-note")).toContainText("quantity");
  // The diff is what you open a version FOR, so it is not there until you ask.
  await expect(page.locator(".k-diff-line")).toHaveCount(0);
  await newest.getByRole("button").first().click();
  await expect(page.locator(".k-diff-line")).not.toHaveCount(0);
});

test("hiding a field takes it out of the running app's form", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");

  // It's in the form to begin with.
  await openNewItemForm(page);
  expect(await formLabels(page)).toContain("Notes");
  await page.locator(".k-modal").getByRole("button", { name: "Cancel" }).click();

  await openPanel(page);
  await page.getByLabel("Hide notes from the form").check();
  await expect.poll(() => storedSource(page)).toContain("hidden: true");
  // Closing is what re-runs the app now — edits no longer reload on every click, so the form below
  // must be opened on the document the re-run produced. See `closePanelAndAwaitRerun`.
  await closePanelAndAwaitRerun(page);

  // The decisive check: gone from the form the user actually sees, not just from the source.
  await openNewItemForm(page);
  const labels = await formLabels(page);
  expect(labels).toContain("Title *");
  expect(labels).not.toContain("Notes");
});

test("reordering fields reorders the form", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");

  await openPanel(page);
  await page.getByLabel("Move notes up").click();
  await expect.poll(() => storedSource(page)).toMatch(/notes:[\s\S]*quantity:/);
  await closePanelAndAwaitRerun(page);

  // Order in the source is the order in the form — `Object.entries(fields)` drives both.
  await openNewItemForm(page);
  const labels = await formLabels(page);
  const iNotes = labels.findIndex((l) => /notes/i.test(l));
  const iQuantity = labels.findIndex((l) => /quantity/i.test(l));
  expect(iNotes).toBeGreaterThanOrEqual(0);
  expect(iNotes).toBeLessThan(iQuantity);
});

test("several reorders in one sitting, without losing the panel or your place", async ({ page }) => {
  // Every structural edit used to reload the app immediately: the panel closed, Edit mode switched
  // off and you landed back on the first tab. Moving a field two places meant doing the whole dance
  // twice, which reads as "reordering doesn't work".
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");
  await page.locator(".k-tab", { hasText: "Everything" }).click();

  await openPanel(page);
  const order = () =>
    page.locator(".k-structure-field input.k-structure-name")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).placeholder));
  // Poll: the panel lazy-loads its parser, so the first inspect lands a beat after the dialog.
  await expect.poll(order).toEqual(["Title", "Quantity", "Notes"]);

  // Two moves in a row on the SAME open panel, each computed from the result of the last.
  await page.getByLabel("Move notes up").click();
  await expect.poll(order).toEqual(["Title", "Notes", "Quantity"]);
  await page.getByLabel("Move notes up").click();
  await expect.poll(order).toEqual(["Notes", "Title", "Quantity"]);
  await expect(page.locator(".k-modifydialog")).toBeVisible();

  // Closing re-runs the app once — and brings you back to the page you were on.
  await closePanelAndAwaitRerun(page);
  await expect(page.locator(".k-tab[data-active='true'] .k-tab-label")).toHaveText("Everything");

  await expect.poll(() => storedSource(page)).toMatch(/notes:[\s\S]*title:[\s\S]*quantity:/);
  await openNewItemForm(page);
  expect(await formLabels(page)).toEqual(["Notes", "Title *", "Quantity"]);
});

test("renaming a page renames its tab", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=kit");
  await expect(page.locator(".k-tab", { hasText: "Everything" })).toBeVisible();

  await openPanel(page);
  await page.getByLabel("Page name").fill("All of it");
  await page.getByLabel("Page name").blur();
  await expect.poll(() => storedSource(page)).toContain('title: "All of it"');
  await closePanelAndAwaitRerun(page);

  await expect(page.locator(".k-tab", { hasText: "All of it" })).toBeVisible();
  expect(await storedSource(page)).toContain('title: "All of it"');
});

test("a source it can't edit structurally says so, and offers the agent", async ({ page }) => {
  // Fields built by a spread: there is no literal to edit. Guessing here would corrupt the app, so
  // the panel must decline and name the reason rather than render a control that silently does
  // nothing.
  const spread = APP_SOURCE.replace('title: { type: "text", required: true },', "...shared,");
  await seed(page, spread.replace('import { defineApp } from "karta";', 'import { defineApp } from "karta";\nconst shared = { title: { type: "text", required: true } };'));
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");

  await openPanel(page);
  await expect(page.locator(".k-structure-blocked")).toContainText(/spread|computed/);
  await expect(page.locator(".k-structure-field")).toHaveCount(0);
  // The way through is still open.
  await expect(page.getByLabel("Describe the change")).toBeVisible();
});

// Entity groups (#100): the panel shows the fields group by group, and ↑/↓ move a field within its
// group or over the edge into the next one — one step, one edit to that group's `fields` list.
test("moving a field over a group's edge regroups it, in the source and on the form", async ({ page }) => {
  const GROUPED = APP_SOURCE.replace(
    `        notes: { type: "text", multiline: true },
      },`,
    `        notes: { type: "text", multiline: true },
      },
      groups: [
        { title: "Basics", fields: ["title"] },
        { title: "More", fields: ["quantity", "notes"] },
      ],`,
  );
  expect(GROUPED).toContain("Basics");
  await seed(page, GROUPED);
  await page.goto("/?user=kit");
  await expect(page.locator("h1")).toHaveText("Kit");

  await openPanel(page);
  await expect(page.locator(".k-structure-group")).toHaveText(["Basics", "More"]);
  // The top of the first group has nowhere to go; the top of the second can cross into the first.
  await expect(page.getByLabel("Move title up")).toBeDisabled();
  await page.getByLabel("Move quantity up").click();
  await expect.poll(() => storedSource(page)).toContain(`{ title: "Basics", fields: ["title", "quantity"] }`);
  await expect.poll(() => storedSource(page)).toContain(`{ title: "More", fields: ["notes"] }`);
  // The last field of a group cannot leave it empty.
  await expect(page.getByLabel("Move notes up")).toBeDisabled();
  await closePanelAndAwaitRerun(page);

  await openNewItemForm(page);
  const basics = page.locator(".k-modal .k-form-group").first();
  await expect(basics.locator(".k-form-group-title")).toHaveText("Basics");
  await expect(basics.locator(".k-form-label")).toHaveText(["Title *", "Quantity"]);
});
