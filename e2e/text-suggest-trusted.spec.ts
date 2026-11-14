import { test, expect, type Locator, type Page } from "./console-guard";
import { chooseFilter } from "./filters";

// A list of choices that grows with the person's data (#82).
//
// "If the value is recognized and it is not in the list, add it." A field was either a fixed `enum`,
// which refused a value outside its options, or free `text`, which offered nothing. A `text` field
// with `suggest` is the one in between: the form offers the values the records already hold, a new
// one is kept as typed, and from the next record on it is one of the choices — in the form and in
// the filter, which reads the same field.

const CELLAR = `import { defineApp } from "potyro";
export default defineApp({
  id: "cellar", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  entities: {
    wine: {
      label: "Wine", displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        region: { type: "text", suggest: true, label: "Region" },
        colour: { type: "text", suggest: ["Red", "White"], label: "Colour" },
      },
    },
  },
  pages: [
    {
      id: "wines", title: "Wines",
      view: {
        type: "list", entity: "wine",
        display: { primary: "name", secondary: "region" },
        filters: [
          { label: "Region", param: "region", from: "region", multi: true },
          { label: "Colour", param: "colour", from: "colour", multi: true },
        ],
        filter: (w, ctx) =>
          (!ctx.params.region || (ctx.params.region as string[]).includes(w.region as string)) &&
          (!ctx.params.colour || (ctx.params.colour as string[]).includes(w.colour as string)),
      },
    },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "cellar", name: "Cellar", source, trusted: true, updatedAt: new Date().toISOString() }]));
  }, CELLAR);
  await page.goto("/?user=cellar");
  await expect(page.getByRole("button", { name: "Add: Wine" }).first()).toBeVisible({ timeout: 30_000 });
});

/** Open the form for a new wine, with its name filled in. */
async function newWine(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add: Wine" }).first().click();
  const form = page.locator(".k-form");
  await form.getByRole("textbox", { name: "Name" }).fill(name);
  return form;
}

async function create(page: Page, form: Locator): Promise<void> {
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-form")).toHaveCount(0);
}

test("a value typed once is offered on the next record, picked there, and offered by the filter", async ({ page }) => {
  const rows = page.locator(".k-list-row");

  // The first wine. Nothing has been typed into Region before, so nothing is offered; what is typed
  // is not a mistake, and the list says it will be added.
  let form = await newWine(page, "Barolo 2019");
  let region = form.getByRole("combobox", { name: "Region" });
  await region.click();
  await expect(page.getByRole("listbox", { name: "Region" })).toHaveCount(0);
  await region.pressSequentially("Piemonte");
  const offered = page.getByRole("listbox", { name: "Region" }).getByRole("option");
  await expect(offered).toHaveText(["Add “Piemonte”"]);
  await offered.first().click();
  await expect(region).toHaveValue("Piemonte");
  await expect(page.getByRole("listbox", { name: "Region" })).toHaveCount(0);
  // The field kept the focus: the list was tapped, the keyboard never left.
  await expect(region).toBeFocused();

  // The starting values are offered before any record has one.
  let colour = form.getByRole("combobox", { name: "Colour" });
  await colour.click();
  await expect(page.getByRole("listbox", { name: "Colour" }).getByRole("option")).toHaveText(["Red", "White"]);
  await page.getByRole("option", { name: "Red" }).click();
  await expect(colour).toHaveValue("Red");
  await create(page, form);
  await expect(rows).toHaveCount(1);

  // The second wine: Piemonte is a choice now. Typing narrows to it and a tap takes it.
  form = await newWine(page, "Barbera");
  region = form.getByRole("combobox", { name: "Region" });
  await region.click();
  await expect(offered).toHaveText(["Piemonte"]);
  await region.pressSequentially("pie");
  await expect(offered).toHaveText(["Piemonte", "Add “pie”"]);
  await page.getByRole("option", { name: "Piemonte", exact: true }).click();
  await expect(region).toHaveValue("Piemonte");
  await create(page, form);
  await expect(rows).toHaveCount(2);

  // The third, with the keyboard alone: a new region typed with space around it, which leaving the
  // field takes off; then the colour walked to with the arrow keys and taken with Enter.
  form = await newWine(page, "Riesling");
  region = form.getByRole("combobox", { name: "Region" });
  await region.click();
  await region.pressSequentially("  Mosel ");
  await region.press("Tab");
  await expect(region).toHaveValue("Mosel");
  colour = form.getByRole("combobox", { name: "Colour" });
  await expect(colour).toBeFocused();
  // Passing through a field with Tab opens nothing; the Down key does.
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Colour" }).getByRole("option")).toHaveText(["Red", "White"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(colour).toHaveValue("White");
  // Enter took the choice; it did not save the form.
  await expect(form).toBeVisible();
  await create(page, form);
  await expect(rows).toHaveCount(3);

  // The fourth: "piemonte" is the Piemonte already there, and is saved in that spelling.
  form = await newWine(page, "Nebbiolo");
  region = form.getByRole("combobox", { name: "Region" });
  await region.click();
  await expect(offered).toHaveText(["Mosel", "Piemonte"]);
  await region.pressSequentially("piemonte");
  await region.press("Tab");
  await expect(region).toHaveValue("Piemonte");
  await create(page, form);
  await expect(rows).toHaveCount(4);

  // The filter reads the same field: the regions in the records, once each, in order.
  await page.getByRole("button", { name: /^Filter/ }).click();
  const sheet = page.locator(".k-filter-sheet");
  await expect(sheet.getByRole("group", { name: "Region" }).locator(".k-chip")).toHaveText(["Mosel", "Piemonte"]);
  await expect(sheet.getByRole("group", { name: "Colour" }).locator(".k-chip")).toHaveText(["Red", "White"]);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  await chooseFilter(page, "Piemonte");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Riesling" })).toHaveCount(0);
});

test("a declared starting value no record uses is offered by the form and not by the filter", async ({ page }) => {
  const form = await newWine(page, "Vinho Verde");
  await form.getByRole("combobox", { name: "Colour" }).click();
  await page.getByRole("option", { name: "White" }).click();
  await create(page, form);
  await expect(page.locator(".k-list-row")).toHaveCount(1);

  await page.getByRole("button", { name: /^Filter/ }).click();
  const sheet = page.locator(".k-filter-sheet");
  // "Red" is declared and unused: a filter shows what is in the data.
  await expect(sheet.getByRole("group", { name: "Colour" }).locator(".k-chip")).toHaveText(["White"]);
  await expect(sheet.getByRole("group", { name: "Region" })).toContainText("Nothing to pick yet.");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the list is under the field and inside the screen, and a tap takes a choice", async ({ page }) => {
    let form = await newWine(page, "Douro tinto");
    await form.getByRole("combobox", { name: "Region" }).fill("Douro");
    // Escape closes the list, not the form.
    await expect(page.getByRole("listbox", { name: "Region" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(form).toBeVisible();
    await create(page, form);

    form = await newWine(page, "Porto");
    const region = form.getByRole("combobox", { name: "Region" });
    await region.tap();
    const list = page.getByRole("listbox", { name: "Region" });
    await expect(list).toBeVisible();
    const field = (await region.boundingBox())!;
    const box = (await list.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(field.y + field.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // A row is a finger tall.
    expect((await list.getByRole("option", { name: "Douro" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await list.getByRole("option", { name: "Douro" }).tap();
    await expect(region).toHaveValue("Douro");
    await expect(list).toHaveCount(0);
  });
});
