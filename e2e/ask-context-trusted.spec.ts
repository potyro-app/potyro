import { test, expect, type Page } from "@playwright/test";

// Ask's conversation and context (#213), with the model stubbed. From the owner's report: on a map of
// Cuneo, "add vegetarian restaurants" came back as a question. Now the dialog shows what goes with
// the request (the map's area, web search) and sends exactly that; the pages a search read are
// listed; and when the model does need to ask, the person answers in place and it carries on.

const APP_ID = "cuneo-places";
const SOURCE = `import { defineApp } from "karta";
export default defineApp({
  id: "${APP_ID}", name: "Cuneo Places", version: "1.0.0", schemaVersion: 1,
  entities: { place: { label: "Place", displayField: "name", fields: {
    name: { type: "text", required: true },
    location: { type: "geo", required: true },
    visited: { type: "boolean", default: true },
  } } },
  pages: [
    { id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location", camera: { center: [7.5427, 44.3845], zoom: 14 } } },
    { id: "all", title: "All", view: { type: "list", entity: "place", display: { primary: "name", secondary: (p) => (p.visited ? "visited" : "not yet") } } },
  ],
});
`;

const reply = (message: Record<string, unknown>) => ({ choices: [{ message }] });
const PROPOSAL = reply({
  content: "",
  // What a real search returns: pages with text. Both places are named on two different sites.
  annotations: [
    { type: "url_citation", url_citation: { url: "https://www.happycow.net/europe/italy/cuneo/", title: "Vegan Restaurants in Cuneo", content: "Bar Bibe, Corso Galileo Ferraris 26. Ninføød, Via Busca 3b: fully vegan." } },
    { type: "url_citation", url_citation: { url: "https://restaurantguru.com/cuneo-vegan", title: "Vegan in Cuneo", content: "Top vegan: Ninføød and Bar Bibe." } },
  ],
  tool_calls: [
    {
      id: "t1",
      type: "function",
      function: {
        name: "propose_records",
        arguments: JSON.stringify({
          summary: "Two vegetarian places in Cuneo, from HappyCow.",
          rows: [
            { entity: "place", ref: "a", values: { name: "Bar Bibe", location: { lat: 44.3874, lng: 7.5503, label: "Corso Galileo Ferraris 26, Cuneo" }, visited: false } },
            { entity: "place", ref: "b", values: { name: "Ninføød", location: { lat: 44.3925, lng: 7.5486, label: "Via Busca 3b, Cuneo" }, visited: false } },
          ],
        }),
      },
    },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id]) => {
      if (!localStorage.getItem("karta:user-apps")) localStorage.setItem("karta:user-apps", JSON.stringify([{ id, name: "Cuneo Places", source, trusted: true, updatedAt: new Date().toISOString() }]));
      sessionStorage.setItem("karta:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub", openrouterModel: "deepseek/deepseek-v4-flash-0731" }));
    },
    [SOURCE, APP_ID],
  );
});

/** OpenStreetMap's geocoder, stubbed: Bar Bibe's address agrees with the model, Via Busca lands 40 km off. */
async function stubGeocoder(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("https://nominatim.openstreetmap.org/**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    asked.push(q);
    const hit = q.startsWith("Corso Galileo Ferraris") ? [{ lat: "44.3861", lon: "7.5511" }] : [{ lat: "44.1", lon: "7.9" }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(hit) });
  });
  return asked;
}

async function openAsk(page: Page) {
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  return page.getByRole("dialog", { name: "Ask Cuneo Places" });
}

test("the map's area and web search go with the request, as shown; the sources are listed; nothing is marked visited", async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) });
  });
  const geocoded = await stubGeocoder(page);
  const dialog = await openAsk(page);
  const chips = dialog.locator(".k-ask-context");
  await expect(chips).toContainText("Area on your map · 44.38");
  await expect(chips.getByRole("checkbox", { name: /Search the web/ })).toBeChecked();

  await dialog.getByRole("textbox", { name: "What to add" }).fill("add vegetarian restaurants");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("Two vegetarian places in Cuneo, from HappyCow.")).toBeVisible();

  const system = String((bodies[0]!.messages as Array<{ content: string }>)[0]!.content);
  expect(system).toMatch(/Area: around 44\.38\d\d, 7\.54\d\d/);
  expect(system).toMatch(/visited.*defaults to true/);
  expect((bodies[0]!.tools as Array<{ type: string }>).map((t) => t.type)).toContain("openrouter:web_search");

  // Each address was looked up; the one the geocoder put 40 km away keeps the model's pin, flagged.
  expect(geocoded).toEqual(["Corso Galileo Ferraris 26, Cuneo", "Via Busca 3b, Cuneo"]);
  await expect(dialog.locator(".k-ask-card", { hasText: "Ninføød" })).toContainText("Location approximate");
  await expect(dialog.locator(".k-ask-card", { hasText: "Bar Bibe" })).not.toContainText("approximate");
  // Two sites name each place: confirmed, and approved.
  await expect(dialog.locator(".k-ask-card", { hasText: "Bar Bibe" }).locator(".k-ask-badge")).toHaveText("2 sources");
  await expect(dialog.locator(".k-ask-found summary")).toHaveText("Found on happycow.net, restaurantguru.com");
  await dialog.locator(".k-ask-found summary").click();
  await expect(dialog.getByRole("link", { name: "Vegan Restaurants in Cuneo" })).toHaveAttribute("href", "https://www.happycow.net/europe/italy/cuneo/");

  await dialog.getByRole("button", { name: "Add 2" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.locator(".k-tab", { hasText: "All" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(2);
  await expect(page.locator(".k-list-row", { hasText: "Bar Bibe" })).toContainText("not yet");
});

test("the area can be left out, and web search turned off, before sending", async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) });
  });
  const geocoded = await stubGeocoder(page);
  const dialog = await openAsk(page);
  await dialog.getByRole("button", { name: "Don’t send the map area" }).click();
  await dialog.locator(".k-ask-context").getByRole("checkbox", { name: /Search the web/ }).uncheck();
  await dialog.getByRole("textbox", { name: "What to add" }).fill("add vegetarian restaurants in Cuneo");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("Two vegetarian places in Cuneo, from HappyCow.")).toBeVisible();
  const system = String((bodies[0]!.messages as Array<{ content: string }>)[0]!.content);
  expect(system).not.toMatch(/Area: around/);
  expect(system).toMatch(/cannot look anything up/);
  expect(JSON.stringify(bodies[0]!.tools)).not.toContain("web_search");
  // No web: no geocoding either.
  expect(geocoded).toEqual([]);

  // The choice about web search is remembered on this device.
  await dialog.getByRole("button", { name: "Discard" }).click();
  await page.reload();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  await expect(page.getByRole("dialog", { name: "Ask Cuneo Places" }).locator(".k-ask-context").getByRole("checkbox", { name: /Search the web/ })).not.toBeChecked();
});

test("when the model must ask, the person answers in place and it carries on", async ({ page }) => {
  const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    const body = bodies.length === 1 ? reply({ content: "Which of your usual spots do you mean?" }) : PROPOSAL;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  const dialog = await openAsk(page);
  await dialog.getByRole("textbox", { name: "What to add" }).fill("add my usual spots");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("Which of your usual spots do you mean?")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Your answer" }).fill("the vegetarian ones in the centre");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Two vegetarian places in Cuneo, from HappyCow.")).toBeVisible();
  const second = bodies[1]!.messages;
  expect(second.at(-2)).toMatchObject({ role: "assistant", content: "Which of your usual spots do you mean?" });
  expect(second.at(-1)).toMatchObject({ role: "user", content: "the vegetarian ones in the centre" });
});
