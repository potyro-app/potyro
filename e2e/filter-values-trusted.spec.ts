import { test, expect } from "./console-guard";
import { chooseFilter, chosenFilter } from "./filters";

// A filter on a field with no fixed list (#79).
//
// A generated list declared `filters: [{ label: "Country", param: "country", from: "country" }]`
// where `country` is text. Nothing was wrong with the declaration, and the Filter sheet opened on
// nothing: a chip only knew how to read an enum's options. What the person meant was "filter by what
// is in my data", so that is what the chip offers — the distinct values the records hold.
//
// The app brings its own records through a page action, the way app code or an import adds them.

const BOOKS = `import { defineApp } from "potyro";
export default defineApp({
  id: "shelf", name: "Shelf", version: "1.0.0", schemaVersion: 1,
  entities: {
    book: {
      label: "Book", displayField: "title",
      fields: { title: { type: "text", required: true }, country: { type: "text" } },
    },
  },
  pages: [
    {
      id: "books", title: "Books",
      actions: [
        {
          label: "Fill the shelf",
          run: async (ctx) => {
            await ctx.create("book", { title: "Solaris", country: "Poland" });
            await ctx.create("book", { title: "Ferdydurke", country: "Poland" });
            await ctx.create("book", { title: "Il nome della rosa", country: "Italy" });
            await ctx.create("book", { title: "Anonymous", country: "" });
          },
        },
      ],
      view: {
        type: "list", entity: "book",
        display: { primary: "title", secondary: "country" },
        filters: [{ label: "Country", param: "country", from: "country", multi: true }],
        filter: (b, ctx) => !ctx.params.country || (ctx.params.country as string[]).includes(b.country as string),
      },
    },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "shelf", name: "Shelf", source, trusted: true, updatedAt: new Date().toISOString() }]));
  }, BOOKS);
  await page.goto("/?user=shelf");
  await expect(page.getByRole("button", { name: "Fill the shelf" })).toBeVisible({ timeout: 30_000 });
});

test("with no records yet, the Filter sheet says there is nothing to pick rather than opening empty", async ({ page }) => {
  await page.getByRole("button", { name: /^Filter/ }).click();
  const sheet = page.locator(".k-filter-sheet");
  await expect(sheet.getByRole("group", { name: "Country" })).toContainText("Nothing to pick yet.");
  await expect(sheet.locator(".k-chip")).toHaveCount(0);
});

test("a filter on a text field offers the values in the records, and choosing one narrows the list", async ({ page }) => {
  await page.getByRole("button", { name: "Fill the shelf" }).click();
  const rows = page.locator(".k-list-row");
  await expect(rows).toHaveCount(4, { timeout: 15_000 });

  // The values that are there, once each, in order; the book with no country adds no blank chip.
  await page.getByRole("button", { name: /^Filter/ }).click();
  const sheet = page.locator(".k-filter-sheet");
  await expect(sheet.locator(".k-chip")).toHaveText(["Italy", "Poland"]);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  // The app's own filter gets what an enum's chip would have given it: the chosen values, a list.
  await chooseFilter(page, "Poland");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Solaris" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Il nome della rosa" })).toHaveCount(0);

  // Narrowed to Poland, Italy is still on offer: the choices come from every record, not the rows left.
  await chooseFilter(page, "Italy");
  await expect(rows).toHaveCount(3);

  // Each chosen value is a chip beside the button; a tap takes it off.
  await chosenFilter(page, "Poland").click();
  await expect(rows).toHaveCount(1);
  await chosenFilter(page, "Italy").click();
  await expect(rows).toHaveCount(4);
});
