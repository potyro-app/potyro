import { test, expect, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// Ask (#213), with the model stubbed: a request goes out carrying the app's STRUCTURE and never its
// records; a first proposal that breaks a field's rule goes back to the model; the one that fits is
// shown for review, with the place the person already has unticked; only what they tick is added,
// with the new place linked to the new city. Then Ask is turned off for the app, stays off across a
// reload, and comes back from the tile editor.

const APP_ID = "dog-places";
const APP_NAME = "Dog Places";
const ALREADY_HAVE = "Jardim da Estrela";

const SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    city: { label: "City", displayField: "name", fields: { name: { type: "text", required: true } } },
    place: {
      label: "Place",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        kind: { type: "enum", options: ["cafe", "park", "beach"] },
        city: { type: "relation", to: "city" },
      },
    },
  },
  pages: [
    {
      id: "places",
      title: "Places",
      view: { type: "list", entity: "place", display: { primary: "name", secondary: (r) => [r.kind, r.city?.name].filter(Boolean).join(" in ") } },
    },
    { id: "cities", title: "Cities", view: { type: "list", entity: "city", display: { primary: "name" } } },
  ],
});
`;

const call = (id: string, args: unknown) => ({
  choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name: "propose_records", arguments: JSON.stringify(args) } }] } }],
});

const WRONG = call("t1", {
  summary: "x",
  rows: [{ entity: "place", ref: "a", values: { name: "Dog Beach", kind: "shore" } }],
});
const FITS = call("t2", {
  summary: "Three dog-friendly spots in Lisbon.",
  rows: [
    { entity: "city", ref: "lx", values: { name: "Lisbon" } },
    { entity: "place", ref: "a", values: { name: "Dog Beach", kind: "beach", city: "@lx" } },
    { entity: "place", ref: "b", values: { name: "Café Canino", kind: "cafe", city: "@lx" } },
    { entity: "place", ref: "c", values: { name: ALREADY_HAVE.toLowerCase(), kind: "park", city: "@lx" } },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id, name]) => {
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem("karta:user-apps", JSON.stringify([{ id, name, source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [SOURCE, APP_ID, APP_NAME],
  );
});

async function chooseOpenRouter(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await studio.getByRole("button", { name: "Model settings" }).click();
  const settings = page.getByRole("dialog", { name: "Model settings" });
  await settings.getByRole("radio", { name: /OpenRouter/ }).check();
  await settings.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await settings.getByRole("button", { name: "Close model settings" }).click();
  await studio.getByRole("button", { name: "Close studio" }).click();
}

const askButton = (page: Page) => page.getByRole("button", { name: /^✧?\s*Ask\b/ });

test("Ask proposes records in the app's shape, sends no records, and adds only what is ticked", async ({ page }) => {
  const bodies: string[] = [];
  let turn = 0;
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(route.request().postData() ?? "");
    turn += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(turn === 1 ? WRONG : FITS) });
  });

  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);

  // A record the person already has — the model must never see it.
  await page.getByRole("button", { name: "New Place" }).click();
  await page.getByLabel("Name").fill(ALREADY_HAVE);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(1);

  await chooseOpenRouter(page);
  await askButton(page).click();
  const dialog = page.getByRole("dialog", { name: `Ask ${APP_NAME}` });
  await expect(dialog.getByText("Nothing already in the app is sent.")).toBeVisible();
  await dialog.getByRole("textbox", { name: "What to add" }).fill("dog friendly places in Lisbon");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(dialog.getByText("Three dog-friendly spots in Lisbon.")).toBeVisible();
  expect(turn).toBe(2);
  // What left the device: the request and the structure, and not the record.
  expect(bodies[0]).toContain("dog friendly places in Lisbon");
  expect(bodies[0]).toContain("cafe, park, beach");
  for (const b of bodies) expect(b).not.toContain(ALREADY_HAVE);
  // The wrong proposal went back with the reason.
  expect(bodies[1]).toMatch(/must be one of: cafe, park, beach/);

  // The review: the one the person already has is marked and unticked.
  const rows = dialog.locator(".k-ask-row");
  await expect(rows).toHaveCount(4);
  const dup = rows.filter({ hasText: "already in your app" });
  await expect(dup).toHaveCount(1);
  await expect(dup.getByRole("checkbox")).not.toBeChecked();
  await expect(rows.filter({ hasText: "Dog Beach" })).toContainText("Lisbon");

  // Leave one more out, then add.
  await rows.filter({ hasText: "Café Canino" }).getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "Add 2" }).click();
  await expect(dialog.getByText("Added 2 records.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  const list = page.locator(".k-list-row");
  await expect(list).toHaveCount(2);
  // Its kind, and the new city it points at.
  await expect(list.filter({ hasText: "Dog Beach" })).toContainText("beach in Lisbon");
  await expect(list.filter({ hasText: ALREADY_HAVE })).toHaveCount(1);
  await expect(list.filter({ hasText: "Café Canino" })).toHaveCount(0);
});

test("Ask can be turned off for an app, stays off, and comes back from the tile editor", async ({ page }) => {
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await askButton(page).click();
  await page.getByRole("dialog", { name: `Ask ${APP_NAME}` }).getByRole("button", { name: "Turn off Ask for this app" }).click();
  await expect(askButton(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await expect(page.getByRole("button", { name: "Studio" })).toBeVisible();
  await expect(askButton(page)).toHaveCount(0);

  await page.goto("/");
  await tileAction(page, APP_NAME, "edit-tile");
  const editor = page.getByRole("dialog", { name: `Edit tile: ${APP_NAME}` });
  const ask = editor.getByRole("checkbox", { name: /Ask/ });
  await expect(ask).not.toBeChecked();
  await ask.check();
  await editor.getByRole("button", { name: "Save" }).click();

  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await expect(askButton(page)).toBeVisible();
});
