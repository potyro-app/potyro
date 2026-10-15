import { test, expect } from "./console-guard";
import { installShared } from "./realm.js";

// Shared apps' logic runs in the browser realm (#272, docs/22 phase 1): a Worker inside an
// opaque-origin sandboxed iframe, reached only through the mediated ctx. What is checked is what a
// person gets from it — an app that uses the browser's own built-ins works sealed, and the Add-an-app
// card stops warning about them — and that it really is the realm doing it, not QuickJS.

test.use({ viewport: { width: 1280, height: 800 } });

test("a shared app's logic runs in the realm: one sandboxed frame per open app, and no QuickJS", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/?app=recipes");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  // Its computed calories came back from the realm.
  await expect(page.locator(".k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  const frame = page.locator("#potyro-realms iframe");
  await expect(frame).toHaveCount(1);
  // allow-scripts and nothing else: an opaque origin, no top navigation, no popups, no forms.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const srcdoc = String(await frame.getAttribute("srcdoc"));
  expect(srcdoc).toContain("default-src 'none'");
  expect(srcdoc).toContain("connect-src 'none'");
  expect(requests.filter((u) => /quickjs|emscripten-module/i.test(u))).toEqual([]);

  // Switching apps puts the old realm away and starts the next one.
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.locator(".k-launcher-overlay .k-launch-tile", { hasText: "Plants" }).click();
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await expect(frame).toHaveCount(1);
});

const INTL_APP = `import { defineApp } from "potyro";
// Built-ins QuickJS never had, at the top level and in the logic: they work sealed in the realm.
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export default defineApp({
  id: "sealed-intl",
  name: "Sealed Intl",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [{ id: "add", label: "Add entry", entity: "entry", mode: "instant", prefill: { title: "東京タワーへ行く", amount: 1234.5, link: "https://example.org/a?b=1" } }],
  entities: {
    entry: {
      displayField: "title",
      fields: { title: { type: "text" }, amount: { type: "number" }, link: { type: "text" } },
      computed: {
        price: (r) => euro.format(Number(r.amount)),
        host: (r) => new URL(String(r.link)).hostname,
        bytes: (r) => new TextEncoder().encode(String(r.title)).length,
        words: (r) => [...new Intl.Segmenter("ja", { granularity: "word" }).segment(String(r.title))].filter((s) => s.isWordLike).length,
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Entries",
      view: { type: "list", entity: "entry", display: { primary: "title", secondary: (r) => \`\${r.price} · \${r.host} · \${r.bytes} bytes · \${r.words > 0 ? "words" : "no words"}\` } },
    },
  ],
});
`;

test("a shared app that uses Intl, URL and TextEncoder works sealed", async ({ page }) => {
  await installShared(page, "sealed-intl", "Sealed Intl", INTL_APP);
  await page.getByRole("button", { name: /Add entry/ }).first().click();
  // Through QuickJS every one of these was empty (docs/22 §2).
  await expect(page.locator(".k-secondary").first()).toHaveText("1.234,50 € · example.org · 24 bytes · words", { timeout: 15_000 });
});

const PAGE_AT_LOAD = `import { defineApp } from "potyro";
const title = document.title;
export default defineApp({ id: "needs-page", name: "Needs a page", version: "1.0.0", schemaVersion: 1,
  entities: { n: { fields: { t: { type: "text" } } } }, pages: [{ id: "all", title, view: { type: "list", entity: "n" } }] });
`;

test("the Add-an-app card no longer warns about the browser's built-ins, and still does about a page", async ({ page }) => {
  await page.goto("/");
  const check = async (source: string, name: string) => {
    const dialog = page.getByRole("dialog", { name: "Add an app" });
    if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Add an app" }).click();
    await dialog.getByRole("button", { name: /Paste the source/ }).click();
    await dialog.getByRole("textbox", { name: "The app's source" }).fill(source);
    await dialog.getByRole("button", { name: "Check it" }).click();
    return dialog;
  };

  const intl = await check(INTL_APP, "Sealed Intl");
  const card = intl.getByRole("region", { name: "About Sealed Intl" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(intl).not.toContainText("don’t have yet");
  await page.keyboard.press("Escape");

  await page.reload();
  const needsPage = await check(PAGE_AT_LOAD, "Needs a page");
  await expect(needsPage).toContainText("a full web page (document)", { timeout: 30_000 });
});
