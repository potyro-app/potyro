import { test, expect, type Page } from "@playwright/test";

// Bringing in what another AI made (#213), with the model stubbed: a paste (or a file) goes to the
// model as data with the request; what the paste names is confirmed by it ("From what you pasted");
// what the model adds beyond it is held back as not confirmed. The person sees exactly what is sent.

const APP_ID = "reading";
const SOURCE = `import { defineApp } from "karta";
export default defineApp({
  id: "${APP_ID}", name: "Reading", version: "1.0.0", schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true }, author: { type: "text" }, year: { type: "number", integer: true } } } },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title", secondary: "author" } } }],
});
`;

const PASTE = "Sure! Here are two classics:\n1. Invisible Cities — Italo Calvino (1972)\n2. The Leopard — Giuseppe Tomasi di Lampedusa (1958)";

const PROPOSAL = {
  content: "",
  tool_calls: [
    {
      id: "p",
      type: "function",
      function: {
        name: "propose_records",
        arguments: JSON.stringify({
          summary: "Two books from your list, and one more.",
          rows: [
            { entity: "book", ref: "a", values: { title: "Invisible Cities", author: "Italo Calvino", year: 1972 } },
            { entity: "book", ref: "b", values: { title: "The Leopard", author: "Giuseppe Tomasi di Lampedusa", year: 1958 } },
            { entity: "book", ref: "c", values: { title: "Baudolino", author: "Umberto Eco", year: 2000 } },
          ],
        }),
      },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, id]) => {
      if (!localStorage.getItem("karta:user-apps")) localStorage.setItem("karta:user-apps", JSON.stringify([{ id, name: "Reading", source, trusted: true, updatedAt: new Date().toISOString() }]));
      sessionStorage.setItem("karta:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-stub", openrouterModel: "deepseek/deepseek-v4-flash-0731" }));
    },
    [SOURCE, APP_ID],
  );
});

async function openAsk(page: Page, bodies: string[]) {
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const tools = JSON.stringify(JSON.parse(route.request().postData() ?? "{}").tools ?? []);
    const message = tools.includes('"verdicts"') ? { content: "" } : PROPOSAL;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
  });
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText("Reading");
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Reading" });
  await dialog.locator(".k-ask-context").getByRole("checkbox", { name: /Search the web/ }).uncheck();
  return dialog;
}

test("a paste becomes records; what it names is confirmed by it, what the model added is held back", async ({ page }) => {
  const bodies: string[] = [];
  const dialog = await openAsk(page, bodies);
  await dialog.getByRole("button", { name: "Paste what another AI made" }).click();
  await dialog.getByRole("textbox", { name: "What another AI made" }).fill(PASTE);
  await expect(dialog.locator(".k-ask-privacy").first()).toContainText("and paste");
  // No request typed: the paste is enough.
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.getByText("Two books from your list, and one more.")).toBeVisible();

  const sent = JSON.parse(bodies[0]!) as { messages: Array<{ role: string; content: string }> };
  const user = sent.messages.find((m) => m.role === "user")!.content;
  expect(user).toContain("Add what's in this.");
  expect(user).toContain("The Leopard — Giuseppe Tomasi di Lampedusa (1958)");

  const card = (t: string) => dialog.locator(".k-ask-card", { hasText: t });
  await expect(card("Invisible Cities").locator(".k-ask-badge")).toHaveText("From what you pasted");
  await expect(card("The Leopard").locator(".k-ask-badge")).toHaveText("From what you pasted");
  await expect(card("Baudolino").locator(".k-ask-badge")).toHaveText("Not confirmed");
  await dialog.getByRole("button", { name: "Add 2" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(2);
  await expect(page.locator(".k-list-row", { hasText: "Baudolino" })).toHaveCount(0);
});

test("a file another AI made is read on this device into the same box, labelled with its name", async ({ page }) => {
  const bodies: string[] = [];
  const dialog = await openAsk(page, bodies);
  await dialog.getByLabel("File to bring in").setInputFiles({ name: "books.md", mimeType: "text/markdown", buffer: Buffer.from(PASTE) });
  await expect(dialog.locator(".k-ask-material")).toContainText("📄 books.md");
  await expect(dialog.getByRole("textbox", { name: "What another AI made" })).toHaveValue(PASTE);
  await dialog.getByRole("textbox", { name: "What to add" }).fill("add these to my list");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dialog.locator(".k-ask-card", { hasText: "Invisible Cities" }).locator(".k-ask-badge")).toHaveText("From books.md");
});
