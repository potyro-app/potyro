import { test, expect, type Page } from "@playwright/test";

// Ask's data sources (#213), in a browser, with the model and the APIs stubbed. The app declares a
// source that needs a key; the person pastes it once and it is still there after a reload (the
// vault, not the page). They add a source of their own from its docs link alone, and the first time
// the model wants to send that key somewhere, they are asked. Each key reaches its API, and nothing
// else: not the model, not localStorage.

const APP_ID = "dog-places-src";
const APP_NAME = "Dog Spots";
const APP_KEY = "app-key-4417";
const MY_KEY = "my-key-9921";

const SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  sources: {
    places: {
      label: "Places search",
      description: "places near a point",
      endpoint: "https://api.places.test/v1/",
      auth: { header: "X-Api-Key" },
    },
  },
  entities: {
    place: { label: "Place", displayField: "name", fields: { name: { type: "text", required: true } } },
  },
  pages: [{ id: "places", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } }],
});
`;

const tool = (id: string, name: string, args: unknown) => ({
  choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});

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

const openAsk = async (page: Page) => {
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  return page.getByRole("dialog", { name: `Ask ${APP_NAME}` });
};

test("an app's source and the person's own: keys stored safely, sent only where allowed, never to the model", async ({ page }) => {
  const modelBodies: string[] = [];
  const apiCalls: Array<{ url: string; key: string | null }> = [];
  let turn = 0;
  let mine = "";

  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postData() ?? "";
    modelBodies.push(body);
    turn += 1;
    mine ||= /mine:[a-z0-9]+/.exec(body)?.[0] ?? "";
    const reply =
      turn === 1
        ? tool("t1", "fetch_data", { source: "app:places", url: "search?q=dog" })
        : turn === 2
          ? tool("t2", "fetch_data", { source: mine, url: "https://maps.mine.test/v2/near?q=dog" })
          : tool("t3", "propose_records", {
              summary: "Two spots.",
              rows: [
                { entity: "place", ref: "a", values: { name: "Dog Beach" } },
                { entity: "place", ref: "b", values: { name: "Bark Park" } },
              ],
            });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
  await page.route("https://api.places.test/**", async (route) => {
    apiCalls.push({ url: route.request().url(), key: route.request().headers()["x-api-key"] ?? null });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '[{"name":"Dog Beach"}]' });
  });
  await page.route("https://maps.mine.test/**", async (route) => {
    apiCalls.push({ url: route.request().url(), key: new URL(route.request().url()).searchParams.get("apikey") });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '[{"name":"Bark Park"}]' });
  });

  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  let dialog = await openAsk(page);

  // The app's source waits for a key; the person pastes it.
  const sources = dialog.locator(".k-ask-sources");
  await expect(sources.locator(".k-ask-source[data-waiting]")).toContainText("Places search");
  await sources.getByLabel("Key for Places search").fill(APP_KEY);
  await sources.getByRole("button", { name: "Save key" }).click();
  await expect(sources.locator(".k-ask-source[data-waiting]")).toHaveCount(0);
  await expect(sources).toContainText("secure store");

  // A source of their own, from its docs link alone, with the key in a query parameter.
  await sources.getByRole("button", { name: /Add a source/ }).click();
  const add = sources.getByRole("group", { name: "Add a source" });
  await add.getByLabel("Name").fill("My maps");
  await add.getByLabel("Docs link").fill("https://docs.mine.test/maps");
  await add.getByLabel("Key").fill(MY_KEY);
  await add.getByLabel("Where the key goes").selectOption("query");
  await add.getByLabel("Parameter name").fill("apikey");
  await add.getByRole("button", { name: "Add source" }).click();
  await expect(sources).toContainText("2 ready");

  // A key survives a reload: it is in the vault, not the page.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  dialog = await openAsk(page);
  await expect(dialog.locator(".k-ask-sources")).toContainText("2 ready");

  await dialog.getByRole("textbox", { name: "What to add" }).fill("dog spots");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();

  // Even the app's own source asks before its first request: a shared app cannot make Ask call a
  // server behind the person's back.
  const question = dialog.getByRole("alertdialog");
  await expect(question).toContainText("Send your Places search key to api.places.test?");
  await expect(question).toContainText("which this app names");
  expect(apiCalls).toEqual([]);
  await question.getByRole("button", { name: "Allow", exact: true }).click();

  // The model wants the person's own key sent somewhere new: they are asked first.
  await expect(question).toContainText("Send your My maps key to maps.mine.test?");
  expect(apiCalls.map((c) => new URL(c.url).host)).toEqual(["api.places.test"]);
  await question.getByRole("button", { name: "Allow", exact: true }).click();

  await expect(dialog.getByText("Two spots.")).toBeVisible();
  // Everything Ask read is listed with the proposal, and the list carries no key.
  const read = dialog.locator(".k-ask-fetched");
  await read.locator("summary").click();
  await expect(read).toContainText("Read from 2 addresses");
  await expect(read).toContainText("https://maps.mine.test/v2/near?q=dog");
  await expect(read).not.toContainText(MY_KEY);
  expect(apiCalls).toEqual([
    { url: "https://api.places.test/v1/search?q=dog", key: APP_KEY },
    { url: `https://maps.mine.test/v2/near?q=dog&apikey=${MY_KEY}`, key: MY_KEY },
  ]);
  // What the APIs sent back reached the model; the keys did not.
  expect(modelBodies.join("\n")).toContain("Bark Park");
  for (const body of modelBodies) {
    expect(body).not.toContain(APP_KEY);
    expect(body).not.toContain(MY_KEY);
  }
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(APP_KEY);
  expect(stored).not.toContain(MY_KEY);
});
