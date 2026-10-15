import { test, expect, type Route } from "./console-guard";

// Ask's review (#213), with the model stubbed. Every proposed record is checked against what the
// search actually returned: two sites confirm one, one site only another, nothing names a third.
// A second model disputes one value. The review starts from those facts — approved, held back with
// the reason, a disputed value left out unless kept — and the person decides, in cards or a table.

const APP_ID = "spots";
const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "${APP_ID}", name: "Spots", version: "1.0.0", schemaVersion: 1,
  entities: { spot: { label: "Spot", displayField: "name", fields: {
    name: { type: "text", required: true },
    town: { type: "text" },
    hours: { type: "text" },
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "spot", display: { primary: "name", secondary: (s) => [s.town, s.hours].filter(Boolean).join(" · ") } } }],
});
`;

const PROPOSAL = {
  content: "",
  annotations: [
    { type: "url_citation", url_citation: { url: "https://guide.example/vegan", title: "Vegan guide", content: "Ninfood in Cuneo is fully vegan. Alter ego also listed." } },
    { type: "url_citation", url_citation: { url: "https://reviews.example/ninfood", title: "Ninfood reviews", content: "Ninfood, Cuneo: open 12:30-14:30." } },
  ],
  tool_calls: [
    {
      id: "p",
      type: "function",
      function: {
        name: "propose_records",
        arguments: JSON.stringify({
          summary: "Three spots.",
          rows: [
            { entity: "spot", ref: "n", values: { name: "Ninfood", town: "Cuneo", hours: "12:00-15:00" } },
            { entity: "spot", ref: "a", values: { name: "Alter ego", town: "Cuneo" } },
            { entity: "spot", ref: "g", values: { name: "Green Ghost", town: "Cuneo" } },
          ],
        }),
      },
    },
  ],
};

const VERDICTS = {
  content: "",
  tool_calls: [
    {
      id: "v",
      type: "function",
      function: {
        name: "verdicts",
        arguments: JSON.stringify({ verdicts: [{ ref: "n", verdict: "contradicted", problems: [{ field: "hours", kind: "contradicted", why: "reviews.example says 12:30-14:30." }] }, { ref: "a", verdict: "supported" }] }),
      },
    },
  ],
};

async function stubModel(route: Route): Promise<void> {
  const body = JSON.parse(route.request().postData() ?? "{}") as { tools?: Array<{ function?: { name?: string } }>; messages: Array<{ content: string }> };
  const tools = (body.tools ?? []).map((t) => t.function?.name);
  const message = tools.includes("verdicts") ? VERDICTS : String(body.messages[0]?.content).startsWith("Search the web for each") ? { content: "done" } : PROPOSAL;
  // Every call says what it cost, as OpenRouter's does.
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }], usage: { cost: 0.007 } }) });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id]) => {
      if (!localStorage.getItem("potyro:user-apps")) localStorage.setItem("potyro:user-apps", JSON.stringify([{ id, name: "Spots", source, trusted: true, updatedAt: new Date().toISOString() }]));
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub", openrouterModel: "deepseek/deepseek-v4-flash-0731" }));
      localStorage.removeItem("potyro:ask-review-layout");
    },
    [SOURCE, APP_ID],
  );
});

test("records start approved or held back by what was read; the person decides, in cards or a table", async ({ page }) => {
  await page.route("**/openrouter.ai/**", stubModel);
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText("Spots");
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Spots" });
  await dialog.getByRole("textbox", { name: "What to add" }).fill("vegetarian spots in Cuneo");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("Three spots.")).toBeVisible();
  // Proposing, once more after the unconfirmed record is sent back, the dedicated search for the
  // one-site record, and the check: four calls at 0.7¢.
  await expect(dialog.locator(".k-ask-cost")).toHaveText("This request cost 2.8¢ of your OpenRouter credit.");

  const card = (name: string) => dialog.locator(".k-ask-card", { hasText: name });
  await expect(card("Ninfood").locator(".k-ask-badge")).toHaveText("2 sources");
  await expect(card("Alter ego").locator(".k-ask-badge")).toHaveText("Only guide.example");
  await expect(card("Green Ghost").locator(".k-ask-badge")).toHaveText("Not confirmed");
  await expect(dialog.locator(".k-ask-review-count")).toHaveText("1 of 3 approved · 2 held back");
  await expect(card("Alter ego")).toContainText("Only guide.example mentions it");
  await expect(card("Green Ghost")).toContainText("No page that was read mentions “Green Ghost”");

  // The disputed value: shown crossed out with the reason, left out unless kept.
  await card("Ninfood").getByRole("button", { name: /All details/ }).click();
  const hours = card("Ninfood").locator(".k-ask-value[data-issue='contradicted']");
  await expect(hours).toHaveAttribute("data-dropped", "true");
  await expect(hours).toContainText("reviews.example says 12:30-14:30");
  await expect(card("Ninfood").getByRole("link", { name: "reviews.example" })).toHaveAttribute("href", "https://reviews.example/ninfood");

  // The table shows the same, and decides the same.
  await dialog.getByRole("button", { name: "Table" }).click();
  const table = dialog.locator(".k-ask-table");
  await expect(table.locator("thead th")).toContainText(["", "Confirmed", "Name", "Town", "Hours"]);
  await table.getByRole("button", { name: "Approve Alter ego" }).click();
  await expect(dialog.locator(".k-ask-review-count")).toHaveText("2 of 3 approved · 1 held back");

  await dialog.getByRole("button", { name: "Add 2" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  // The app keeps a running total, shown the next time Ask opens.
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  await expect(page.getByRole("dialog", { name: "Ask Spots" }).locator(".k-ask-cost")).toContainText("Ask has used 2.8¢");
  await page.getByRole("dialog", { name: "Ask Spots" }).getByRole("button", { name: "Close" }).click();
  const rows = page.locator(".k-list-row");
  await expect(rows).toHaveCount(2);
  // Saved without the disputed hours; the unconfirmed record was not saved.
  await expect(rows.filter({ hasText: "Ninfood" })).toContainText("Cuneo");
  await expect(rows.filter({ hasText: "Ninfood" })).not.toContainText("12:00");
  await expect(rows.filter({ hasText: "Green Ghost" })).toHaveCount(0);
});
