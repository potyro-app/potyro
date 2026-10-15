import { test, expect, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { chooseOpenRouter, currentCard, openSource } from "./studio-helpers.js";

// Changing an app whose library needs a full web page (#266), in the Studio, with a scripted
// OpenRouter. Reported from the Android build on apps/photo-garden (p5 from esm.sh): the Studio
// checks a change in the sealed box, where such a library cannot start, so the app as the person
// has it failed the check too — every change was turned back until the model repeated itself, and
// the card said so in a developer's words. esm.sh is answered from e2e/fixtures/esm.

const LIBRARY = "https://esm.sh/needs-window@1.0.0?bundle";
const fixture = readFileSync(new URL("./fixtures/esm/needs-window.mjs", import.meta.url), "utf8");

const PAGE = '    { id: "all", title: "Widths", view: { type: "list", entity: "width", display: { primary: "title" } } },';
const SOURCE = `import { defineApp } from "potyro";
import { width } from "${LIBRARY}";
export default defineApp({
  id: "widths",
  name: "Widths",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    width: { label: "Width", displayField: "title", fields: { title: { type: "text", required: true } }, computed: { px: () => String(width) } },
  },
  pages: [
${PAGE}
  ],
});
`;

const edit = (prose: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${PAGE}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``;
const RENAME = edit("Renaming the page.", PAGE.replace('title: "Widths"', 'title: "Screen widths"'));
// Fails the app's own checks every time: a page that names an entity the app does not have.
const BROKEN = edit("Pointing the page at sizes.", PAGE.replace('entity: "width"', 'entity: "size"'));

type Msg = { role: string; content: string };
const reply = (content: string) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });

async function addAsMine(page: Page): Promise<void> {
  await page.context().route("https://esm.sh/**", (route) =>
    route.request().url() === LIBRARY
      ? route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fixture })
      : route.abort("internetdisconnected"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([{ name: "widths.app.ts", mimeType: "text/plain", buffer: Buffer.from(SOURCE) }]);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
}

async function changeInStudio(page: Page, replies: (n: number) => string, request: string) {
  const requests: Msg[][] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    requests.push((route.request().postDataJSON() as { messages: Msg[] }).messages);
    return route.fulfill(reply(replies(requests.length)));
  });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-name")).toHaveText("Widths", { timeout: 60_000 });
  await chooseOpenRouter(page, studio);
  await studio.getByRole("textbox", { name: "Describe the app" }).fill(request);
  await studio.getByRole("button", { name: /Modify the app/ }).click();
  return { studio, requests };
}

test.use({ viewport: { width: 1280, height: 800 } });

test("a change to an app whose library needs a full web page is accepted on the first try", async ({ page }) => {
  await addAsMine(page);
  const { studio, requests } = await changeInStudio(page, () => RENAME, "call the page Screen widths");
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/Applied 1 edit/, { timeout: 90_000 });
  // One model call: the change passed the check the first time it was sent.
  expect(requests).toHaveLength(1);
  const tools = await openSource(page, studio);
  await expect(tools.getByRole("textbox", { name: "App source" })).toHaveValue(/title: "Screen widths"/);
});

test("a change that cannot be made is said in plain words, the developer's words folded away", async ({ page }) => {
  await addAsMine(page);
  const { studio, requests } = await changeInStudio(page, () => BROKEN, "show sizes instead");
  const failure = studio.locator('.k-thread-answer[data-tone="failure"]');
  await expect(failure).toHaveText(/^I couldn't make this change: /, { timeout: 90_000 });
  await expect(failure).not.toContainText(/candidate|the model|repl(y|ies)|word for word/);
  // It was the app's own check that turned the change back, not the library: the model was told so.
  expect(requests.length).toBeGreaterThan(1);
  expect(requests[1]!.at(-1)!.content).toMatch(/size/);
  expect(requests[1]!.at(-1)!.content).not.toMatch(/needs a full web page/);

  const details = studio.locator("details.k-thread-detail");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.locator("p")).toBeHidden();
  await details.locator("summary").click();
  await expect(details.locator("p")).toBeVisible();
  await expect(details.locator("p")).toContainText(/repeated itself|candidate/);
});
