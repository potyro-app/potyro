import { test, expect, type Page } from "@playwright/test";

// Ask runs an app's actions (#213), with the model stubbed. "Add a basil in the kitchen, water it and
// the ferns, feed the monstera 12 g": the model names records the way the person did, never having
// seen them; the device finds them. An exact name is ticked, "fern" offers both ferns unticked, a new
// row's action follows that row. Only what is ticked runs, through the action's own code. And the
// same declared action, from its button, asks with a form of its fields.

const APP_ID = "ask-plants";
const APP_NAME = "Green Room";

const SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    room: { label: "Room", displayField: "name", fields: { name: { type: "text", required: true } } },
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        room: { type: "relation", to: "room" },
        watered: { type: "boolean" },
        fed: { type: "number" },
      },
      actions: {
        water: async (p, ctx) => { await ctx.patch("plant", p.id, { watered: true }); },
        feed: {
          label: "Feed",
          description: "Log a feeding",
          input: { grams: { type: "number", min: 0, required: true } },
          run: async (p, ctx, input) => { await ctx.patch("plant", p.id, { fed: input.grams }); },
        },
      },
    },
  },
  pages: [
    {
      id: "plants",
      title: "Plants",
      view: {
        type: "list",
        entity: "plant",
        display: {
          primary: "name",
          secondary: (p) => [p.room?.name, p.watered ? "watered" : "", p.fed ? "fed " + p.fed + " g" : ""].filter(Boolean).join(" · "),
        },
        rowActions: ["feed"],
      },
    },
    { id: "rooms", title: "Rooms", view: { type: "list", entity: "room", display: { primary: "name" } } },
  ],
});
`;

const PROPOSAL = {
  choices: [
    {
      message: {
        content: "",
        tool_calls: [
          {
            id: "t1",
            type: "function",
            function: {
              name: "propose_records",
              arguments: JSON.stringify({
                summary: "A basil for the kitchen, and some watering and feeding.",
                rows: [{ entity: "plant", ref: "b", values: { name: "Basil", room: { match: "kitchen" } } }],
                actions: [
                  { entity: "plant", action: "water", on: "@b" },
                  { entity: "plant", action: "water", match: "ferns" },
                  { entity: "plant", action: "feed", match: "monstera", input: { grams: 12 } },
                ],
              }),
            },
          },
        ],
      },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id, name]) => {
      if (!localStorage.getItem("karta:user-apps")) {
        localStorage.setItem("karta:user-apps", JSON.stringify([{ id, name, source, trusted: true, updatedAt: new Date().toISOString() }]));
      }
      sessionStorage.setItem("karta:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub", openrouterModel: "anthropic/claude-sonnet-4.5" }));
    },
    [SOURCE, APP_ID, APP_NAME],
  );
});

async function add(page: Page, entity: string, name: string): Promise<void> {
  await page.getByRole("button", { name: `New ${entity}` }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
}

test("Ask proposes action runs by name; the device finds the records; only ticked runs happen", async ({ page }) => {
  const bodies: string[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) });
  });

  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await add(page, "Room", "Kitchen");
  await page.getByRole("button", { name: "Plants" }).click();
  for (const name of ["Monstera", "Boston fern", "Bird's nest fern"]) await add(page, "Plant", name);
  const list = page.locator(".k-list-row");
  await expect(list).toHaveCount(3);

  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  const dialog = page.getByRole("dialog", { name: `Ask ${APP_NAME}` });
  await dialog.getByRole("textbox", { name: "What to add" }).fill("add a basil in the kitchen, water it and the ferns, feed the monstera 12 g");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("A basil for the kitchen, and some watering and feeding.")).toBeVisible();

  // The model was told the actions and what they take, and none of the person's plants or rooms.
  expect(bodies[0]).toContain("Log a feeding");
  for (const name of ["Monstera", "Boston fern", "Kitchen"]) expect(bodies[0]).not.toContain(name);

  // The new row's link found the kitchen on this device.
  await expect(dialog.locator(".k-ask-row", { hasText: "Basil" })).toContainText("Kitchen");
  const actions = dialog.locator(".k-ask-action");
  await expect(actions).toHaveCount(3);
  const [waterNew, waterFerns, feed] = [actions.nth(0), actions.nth(1), actions.nth(2)];
  await expect(waterNew.getByRole("checkbox", { name: /Basil/ })).toBeChecked();
  await expect(waterFerns.getByRole("checkbox")).toHaveCount(2);
  await expect(waterFerns.getByRole("checkbox", { name: "Boston fern" })).not.toBeChecked();
  await expect(waterFerns).toContainText("tick the ones you meant");
  await expect(feed).toContainText("Grams 12");
  await expect(feed.getByRole("checkbox", { name: "Monstera" })).toBeChecked();

  await waterFerns.getByRole("checkbox", { name: "Boston fern" }).check();
  await dialog.getByRole("button", { name: "Add 1 and run 3" }).click();
  await expect(dialog.getByText("Added 1 record, ran 3 actions.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(list.filter({ hasText: "Basil" })).toContainText("Kitchen · watered");
  await expect(list.filter({ hasText: "Boston fern" })).toContainText("watered");
  await expect(list.filter({ hasText: "Bird's nest fern" })).not.toContainText("watered");
  await expect(list.filter({ hasText: "Monstera" })).toContainText("fed 12 g");
});

test("a declared action's button asks with a form of its fields", async ({ page }) => {
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await add(page, "Plant", "Monstera");
  const row = page.locator(".k-list-row", { hasText: "Monstera" });
  await row.getByRole("button", { name: "Feed" }).click();
  const form = page.getByRole("dialog", { name: "Feed" });
  await form.getByRole("spinbutton").fill("7");
  await form.getByRole("button", { name: "Feed" }).click();
  await expect(row).toContainText("fed 7 g");
});
