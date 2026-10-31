import AxeBuilder from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Locator, type Page } from "./console-guard";
import { currentCard } from "./studio-helpers.js";

// Two things the stranger journey (#124) found on a phone, at 390×844.
//
// #488: with no engine that can make an app, the key panel stands where the box was, and what the
// person typed on Home waited unseen in the hidden box while "Ideas to start from" — which fill that
// box — looked like the next step. The panel now says it back ("You asked for: …", one line, their
// words), the ideas are not offered while it is up, and once a key is added the box returns holding
// the words, which are sent as they were typed.
//
// #489: with the app open in the Studio, the app covered the Studio's Close, so leaving took the
// Conversation tab first, and the covered Close stayed in the reading order. The app now stands under
// the Studio's bar, Close and the tabs in reach; what it does cover is inert.

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;
const PROMPT = "a list of the plants I water and when";

const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "watering",
  name: "Watering",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { plant: { label: "Plant", displayField: "name", fields: { name: { type: "text", label: "Plant", required: true } } } },
  pages: [{ id: "all", title: "My plants", view: { type: "list", entity: "plant", display: { primary: "name" } } }],
});
`;

test.use(PHONE);

/** The element drawn at the middle of `l` is `l` or inside it: on top, not covered. */
async function onTop(page: Page, l: Locator): Promise<boolean> {
  const b = await l.boundingBox();
  if (!b) return false;
  const handle = await l.elementHandle();
  return page.evaluate(
    ([x, y, el]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      return Boolean(hit && (el as Element).contains(hit));
    },
    [b.x + b.width / 2, b.y + b.height / 2, handle] as const,
  );
}

async function settled(l: Locator): Promise<void> {
  await l.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))).then(() => undefined));
}

/**
 * Controls in the Studio a person can Tab to (or a reader lists) but cannot see: drawn on screen,
 * not inert, and something else on top of them. Each is named by its accessible text.
 */
async function coveredControls(studio: Locator): Promise<string[]> {
  return studio.evaluate((root) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])"))) {
      if (el.closest("[inert]") || (el as HTMLButtonElement).disabled) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) out.push(el.getAttribute("aria-label") || el.textContent!.trim() || el.tagName);
    }
    return out;
  });
}

/** Nothing here may reach `claude -p`: on the dev server it is a real model on this machine. */
async function noRealModel(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route("**/__generate**", (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

test("#488 the key panel says what was typed on Home, offers no ideas, and the words are sent once a key is added", async ({ page, context }) => {
  // No free app making today: the relay's chat route does not serve.
  await context.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: false }) }));
  // The anonymous counts the Studio sends (demand-counts.ts) are accepted, as the relay does.
  await context.route("**/ai/count", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  const cli = await noRealModel(context);
  const sent: string[] = [];
  await context.route("**/openrouter.ai/**", async (route) => {
    sent.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "```ts\n" + APP + "```" }, finish_reason: "stop" }] }) });
  });

  await page.goto("/");
  const welcome = page.getByRole("region", { name: "Make the app you need" });
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await welcome.getByRole("textbox", { name: "Describe your app" }).fill(PROMPT);
  await welcome.getByRole("button", { name: "Describe an app" }).tap();
  const studio = page.getByRole("dialog", { name: "App studio" });
  const box = studio.getByRole("textbox", { name: "Describe the app", includeHidden: true });
  await expect(box).toHaveValue(PROMPT, { timeout: 30_000 });

  // The dev server starts on `claude -p`; a deployed build starts on OpenRouter with no key. Go there.
  await studio.getByRole("button", { name: "Model settings" }).tap();
  let modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).tap();

  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await settled(studio);
  await expect(box).toBeHidden();
  // What was typed is on screen, on the panel, in the person's words — and only there in the Studio.
  const asked = panel.getByText(`You asked for: ${PROMPT}`);
  await expect(asked).toBeVisible();
  expect(await onTop(page, asked)).toBe(true);
  await expect(studio.getByText(PROMPT).filter({ visible: true })).toHaveCount(1);
  // One line.
  const line = (await asked.boundingBox())!;
  const lineHeight = await asked.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6);
  expect(line.height).toBeLessThan(lineHeight * 1.5);
  // No ideas that would fill the hidden box.
  await expect(studio.getByRole("list", { name: "Ideas to start from" })).toHaveCount(0);
  await expect(studio.locator(".k-studio-chip")).toHaveCount(0);

  // A key: the box comes back holding the words, and they are what is sent.
  await panel.getByRole("button", { name: "Add a key" }).tap();
  modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).tap();
  await expect(panel).toHaveCount(0);
  await expect(box).toBeVisible();
  await expect(box).toHaveValue(PROMPT);
  // The ideas are back with the box (the conversation has not started).
  await expect(studio.getByRole("list", { name: "Ideas to start from" })).toBeVisible();
  await studio.getByRole("button", { name: "Create the app" }).tap();
  await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
  expect(sent.length).toBeGreaterThan(0);
  const first = JSON.parse(sent[0]!) as { messages: Array<{ role: string; content: unknown }> };
  const said = first.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
  expect(said.some((c) => c.includes(PROMPT))).toBe(true);
  // The person's own words on the conversation, as typed.
  await expect(studio.locator(".k-thread-ask").first()).toHaveText(PROMPT);
  expect(cli).toEqual([]);
});

test("#489 with the app open, the Studio's Close is in reach, and nothing covered can be reached", async ({ page }) => {
  await page.route("**/__generate**", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "job-1" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + APP + "```\n" }) });
  });
  await page.addInitScript(() => localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" })));
  await page.goto("/");
  await page.locator(".k-launch-fab").tap();
  await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
  const studio = page.getByRole("dialog", { name: "App studio" });
  await studio.getByRole("textbox", { name: "Describe the app" }).fill(PROMPT);
  await studio.getByRole("button", { name: "Create the app" }).tap();
  await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
  await currentCard(studio).getByRole("button", { name: "Open" }).tap();

  const preview = studio.getByRole("region", { name: "App preview" });
  await expect(preview.locator("h1").first()).toHaveText("Watering", { timeout: 30_000 });
  await settled(studio);

  // Close, on top and a thumb's size, with the app open: no tab first.
  const close = studio.getByRole("button", { name: "Close studio" });
  await expect(close).toBeVisible();
  expect(await onTop(page, close)).toBe(true);
  const c = (await close.boundingBox())!;
  expect(Math.min(c.width, c.height)).toBeGreaterThanOrEqual(44);
  // The app has the screen under the Studio's bar, to the bottom; the bar keeps the tabs.
  const bar = (await studio.locator(".k-studio-bar").boundingBox())!;
  const app = (await preview.boundingBox())!;
  expect(app.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(app.y).toBeLessThanOrEqual(bar.y + bar.height + 1);
  expect(app.y + app.height).toBeCloseTo(PHONE.viewport.height, 0);
  expect(app.width).toBe(PHONE.viewport.width);
  const conversation = studio.locator(".k-studio-bar").getByRole("tab", { name: "Conversation" });
  expect(await onTop(page, conversation)).toBe(true);
  await expect(studio.locator(".k-studio-bar").getByRole("tab", { name: "App" })).toHaveAttribute("aria-selected", "true");

  // What the app covers (the conversation, the box) is out of reach, for a reader and for Tab.
  expect(await coveredControls(studio)).toEqual([]);
  const hiddenBox = studio.getByRole("textbox", { name: "Describe the app" });
  expect(await hiddenBox.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
  await hiddenBox.evaluate((el) => (el as HTMLElement).focus());
  await expect(hiddenBox).not.toBeFocused();
  const axe = await new AxeBuilder({ page }).include(".k-studio").withRules(["aria-hidden-focus"]).analyze();
  expect(axe.violations).toEqual([]);

  // The Conversation tab brings the conversation and the box back, live.
  await conversation.tap();
  await expect(preview).toHaveCount(0);
  const box = studio.getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible();
  await box.focus();
  await expect(box).toBeFocused();
  await currentCard(studio).getByRole("button", { name: "Open" }).tap();
  await expect(preview.locator("h1").first()).toHaveText("Watering", { timeout: 30_000 });

  // And Close, from the app, closes the Studio in one tap.
  await close.tap();
  await expect(studio).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Watering", exact: true })).toBeVisible({ timeout: 30_000 });
});

test("#489 an app run from hand-written code before any app exists keeps a way back on its own bar", async ({ page, context }) => {
  const cli = await noRealModel(context);
  await page.addInitScript(() => localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" })));
  await page.goto("/");
  await page.locator(".k-launch-fab").tap();
  await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
  const studio = page.getByRole("dialog", { name: "App studio" });
  await studio.getByRole("button", { name: "Studio menu" }).tap();
  await page.getByRole("menuitem", { name: "Write the code yourself" }).tap();
  const tools = page.getByRole("dialog", { name: "Code, files and history" });
  await tools.getByRole("textbox", { name: "App source" }).fill(APP);
  await tools.getByRole("button", { name: /Run/ }).tap();

  const preview = studio.getByRole("region", { name: "App preview" });
  await expect(preview.locator("h1").first()).toHaveText("Watering", { timeout: 30_000 });
  await settled(studio);
  // No app yet, so no tabs on the Studio's bar: the preview's own bar keeps the way back.
  await expect(studio.locator(".k-studio-bar").getByRole("tab")).toHaveCount(0);
  const back = preview.getByRole("button", { name: "Back to the chat" });
  await expect(back).toBeVisible();
  expect(await onTop(page, back)).toBe(true);
  const b = (await back.boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await coveredControls(studio)).toEqual([]);

  await back.tap();
  await expect(preview).toHaveCount(0);
  const box = studio.getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible();
  await box.focus();
  await expect(box).toBeFocused();
  expect(cli).toEqual([]);
});
