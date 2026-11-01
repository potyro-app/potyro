import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Route } from "./console-guard";
import { tileAction } from "./launcher-actions";
import { makeDemoLink } from "./share-demo";
import { openFromCard } from "./studio-helpers.js";

// The stranger journey (#124, its amendment of 2026-10-30), shared by the trusted and the prod spec.
// Not a `.spec.ts`, so Playwright does not collect it.
//
// Someone who has never used Potyro, on a phone, with no key: from Home they describe an app, get a
// working app through the relay, put a record in it, make a link anyone can try from its tile, and the
// link opens on a second device. And the same person on a day free app making is not offered: the
// Studio says what to do instead, and the gallery is one tap away.
//
// The relay is faked at the browser's edge, the way packages/ai-relay/src/chat.ts answers. Nothing
// reaches a model. The share service is the one the dev server and `vite preview` run (vite.config.ts).

export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } as const;
export const DESKTOP = { viewport: { width: 1440, height: 900 } } as const;
export type Device = typeof PHONE | typeof DESKTOP;

export const MODEL = "deepseek/deepseek-v4-flash-0731";
export const PROMPT = "a list of the plants I water and when";
export const APP_NAME = "Watering";
export const MY_PLANT = "Lemon tree on the balcony";
/** What the share sheet says a demo link of an app with no sample records opens on. */
export const OPENS_EMPTY = "It opens an empty copy of the app right away in any browser. No account, nothing to install. Your records stay with you.";

/** What the model "writes" for the prompt: an app as a model would — no sample records of its own. */
export const APP_SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "watering",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", label: "Plant", required: true },
        watered: { type: "datetime", label: "Last watered" },
      },
    },
  },
  pages: [{ id: "all", title: "My plants", view: { type: "list", entity: "plant", display: { primary: "name", secondary: "watered" } } }],
});
`;

export interface RelayLog {
  chats: Array<{ authorization?: string; model?: unknown }>;
  counts: unknown[];
}

/**
 * The relay, faked for a whole context: /health says whether the chat route serves; the chat route
 * answers with the app above, in the OpenAI reply shape, with what is left; /count is accepted.
 */
export async function fakeRelay(context: BrowserContext, opts: { chat: boolean }): Promise<RelayLog> {
  const log: RelayLog = { chats: [], counts: [] };
  await context.route("**/ai/health", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.chat ? { ok: true, chat: true, model: MODEL } : { ok: true, chat: false }) }),
  );
  await context.route("**/ai/v1/chat/completions", async (route: Route) => {
    const req = route.request();
    log.chats.push({ authorization: req.headers().authorization, model: (req.postDataJSON() as { model?: unknown }).model });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-potyro-left-usd": "0.48" },
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "```ts\n" + APP_SOURCE + "```" }, finish_reason: "stop" }], usage: { cost: 0.004 } }),
    });
  });
  await context.route("**/ai/count", async (route) => {
    log.counts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return log;
}

/** Wait for the element's animations (a sheet sliding up, the Studio's entrance) to finish. */
export async function settled(l: Locator): Promise<void> {
  await l.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))).then(() => undefined));
}

/** The element actually drawn at the middle of `l` is `l` (or inside it): it is on top, not covered. */
export async function onTop(page: Page, l: Locator): Promise<boolean> {
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

/** The box is inside the viewport, whole. */
export async function onScreen(page: Page, l: Locator): Promise<boolean> {
  const b = await l.boundingBox();
  const vp = page.viewportSize()!;
  return Boolean(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5);
}

/**
 * Home on a first visit: the prompt box is the first thing, with its words; describe the app there.
 * `composer: false` when no engine can make an app: the Studio's key panel stands in its box.
 */
export async function describeFromHome(page: Page, opts: { composer: boolean } = { composer: true }): Promise<Locator> {
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "Make the app you need" });
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  const box = welcome.getByRole("textbox", { name: "Describe your app" });
  await expect(box).toBeVisible();
  expect(await onScreen(page, box)).toBe(true);
  await box.click();
  await box.fill(PROMPT);
  const send = welcome.getByRole("button", { name: "Describe an app" });
  const sendBox = (await send.boundingBox())!;
  expect(Math.min(sendBox.width, sendBox.height)).toBeGreaterThanOrEqual(44);
  await send.click();
  const studio = page.locator(".k-studio");
  await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  // The description came along: the Studio's own box holds it, ready to send.
  if (opts.composer) await expect(studio.getByRole("textbox", { name: "Describe the app" })).toHaveValue(PROMPT, { timeout: 30_000 });
  await settled(studio);
  return studio;
}

/**
 * A device that has never used Potyro: nothing stored, no key, its own browser storage. On a built
 * site (`deployed`) its service worker would answer past the context's routes, so it is kept out, as
 * the prod spec keeps it out of the first device.
 */
export async function secondDevice(browser: Browser, baseURL: string, device: Device, deployed = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: "en-US", ...(deployed ? { serviceWorkers: "block" as const } : {}), ...device });
  return { context, page: await context.newPage() };
}

/**
 * On Home, from the tile's ⋯: Share → A link anyone can try → Make the link. Returns the link. The
 * app the model wrote has no sample records, and the sheet says the link opens on an empty copy.
 */
export async function demoLinkFromTile(page: Page): Promise<string> {
  await tileAction(page, APP_NAME, "share-sheet");
  const sheet = page.getByRole("dialog", { name: `Share ${APP_NAME}` });
  await expect(sheet.getByRole("heading", { name: "A link anyone can try" })).toBeVisible();
  await expect(sheet.getByText(OPENS_EMPTY)).toBeVisible();
  await expect(sheet).not.toContainText("sample records");
  const make = sheet.getByRole("button", { name: "Make the link" });
  expect(await onScreen(page, make)).toBe(true);
  await make.click();
  const field = sheet.getByRole("textbox", { name: "Share link" });
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field.inputValue();
}

/** The smaller side of a box: a target a thumb can hit is at least 44px both ways. */
export async function smallerSide(l: Locator): Promise<number> {
  const b = (await l.boundingBox())!;
  return Math.min(b.width, b.height);
}

/** Nothing here may reach `claude -p`: on the dev server it is a real model on this machine. */
export async function noRealModel(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route("**/__generate**", (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

/** A gallery at potyro.com (the link's address when the build names none), with one app to make your own. */
export async function fakeGallery(context: BrowserContext, link: string): Promise<void> {
  await context.route("https://potyro.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>Potyro gallery</title><h1>Apps to try</h1><a href="${link}&remix=1">Make it mine</a>` }),
  );
}

/** Model settings → Potyro: listed because the relay's /health said its chat route serves. */
async function choosePotyro(page: Page, studio: Locator): Promise<void> {
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /^Potyro/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(modal).toBeHidden();
}

export interface Journey {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  baseURL: string;
  device: Device;
  /**
   * A deployed build: no `claude -p`, so a first visit's engine is the build's own pick. On the dev
   * server it starts on `claude -p`, and Potyro's free engine (or, with no free route, OpenRouter, where
   * a deployed build starts) is chosen by hand.
   */
  deployed: boolean;
}

/**
 * Describe an app on Home, get it through the relay's free route, add a record, make a link anyone can
 * try from the tile, and open it on a second device that has never used Potyro.
 */
export async function makeUseAndShare({ page, context, browser, baseURL, device, deployed }: Journey): Promise<void> {
  const relay = await fakeRelay(context, { chat: true });
  const cli = await noRealModel(context);
  const openRouter: string[] = [];
  context.on("request", (r) => r.url().startsWith("https://openrouter.ai/") && openRouter.push(r.url()));

  // 1. Home: the prompt box, described in the person's words.
  const studio = await describeFromHome(page);
  const engine = studio.getByRole("button", { name: "Model settings" });
  if (deployed) await expect(engine).toHaveText(/^\s*Potyro\s*$/, { timeout: 30_000 });
  else await choosePotyro(page, studio);
  await expect(engine).toHaveText(/Potyro/);
  const create = studio.getByRole("button", { name: "Create the app" });
  await expect(create).toBeEnabled();
  expect(await onScreen(page, create)).toBe(true);
  await create.click();

  // 2. A working app, through the relay's chat route, as this device, on the model it named.
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText(APP_NAME, { timeout: 60_000 });
  // One page, so no page title: the app's empty page says so, and offers the first record.
  await expect(preview.getByText("Nothing here yet.")).toBeVisible();
  expect(relay.chats.length).toBeGreaterThan(0);
  for (const c of relay.chats) {
    expect(c.authorization).toMatch(/^Bearer potyro-device:[A-Za-z0-9_-]{8,100}$/);
    expect(c.model).toBe(MODEL);
  }
  expect(openRouter).toEqual([]);
  expect(cli).toEqual([]);
  await expect(engine).toHaveText(/plenty left this month/);

  // 3. A record of their own, in the app as it runs.
  const add = preview.getByRole("button", { name: "Add: Plant" }).first();
  await expect(add).toBeVisible();
  expect(await onTop(page, add)).toBe(true);
  expect(await smallerSide(add)).toBeGreaterThanOrEqual(44);
  await add.click();
  const form = page.getByRole("dialog", { name: "Add: Plant" });
  await expect(form).toBeVisible();
  await settled(form);
  await form.getByLabel("Plant").fill(MY_PLANT);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
  const row = preview.getByText(MY_PLANT);
  await expect(row).toBeVisible();
  expect(await onTop(page, row)).toBe(true);

  // 4. Closed, the Studio leaves the person on Home, where the app has a tile.
  const close = studio.getByRole("button", { name: "Close studio" });
  if (device === PHONE) {
    // FINDING #489: on a phone the app is the whole screen and covers the Studio's Close, so the
    // Conversation tab comes first — two taps to leave, and the covered Close is still in the reading
    // order. This step encodes the bug on purpose: once #489 is fixed the next line fails, and it
    // becomes the real assertion — Close on top at once, no tab first.
    test.info().annotations.push({ type: "finding", description: "#489 on a phone the app preview covers the Studio's Close: two taps to leave, a covered button in the reading order" });
    expect(await onTop(page, close)).toBe(false);
    await studio.getByRole("region", { name: "App preview" }).getByRole("tab", { name: "Conversation" }).click();
  }
  expect(await onTop(page, close)).toBe(true);
  await close.click();
  await expect(studio).toHaveCount(0);
  await expect(page.getByRole("button", { name: APP_NAME, exact: true })).toBeVisible({ timeout: 30_000 });
  // Its ⋯ → Share → A link anyone can try: hosted by the share service beside the site.
  const link = await demoLinkFromTile(page);
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{22}/);

  // 5. A second device that has never used Potyro opens it: sealed, named, and none of the sharer's
  //    records. FINDING #486: an app made in the Studio has no sample records of its own, so the demo
  //    opens on the app's empty page (the sheet now says so: "an empty copy of the app"). This step
  //    encodes it on purpose: once #486 gives such an app something to show, the empty page below is
  //    no longer there and the step becomes the real assertion — the link opens on sample records.
  test.info().annotations.push({ type: "finding", description: "#486 an app made in the Studio has no sample records: its demo link opens on an empty page" });
  const { context: other, page: viewer } = await secondDevice(browser, baseURL, device, deployed);
  await fakeRelay(other, { chat: true });
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(viewer.locator("h1").first()).toHaveText(APP_NAME);
  await expect(viewer.getByText("Nothing here yet.")).toBeVisible();
  await expect(viewer.locator(".k-demo-bar")).toContainText("Made with Potyro");
  await expect(viewer.getByText(MY_PLANT)).toHaveCount(0);
  // The demo works as it is: a plant added there shows, on top, in the sealed app.
  const tryAdd = viewer.getByRole("button", { name: "Add: Plant" }).first();
  await expect(tryAdd).toBeVisible();
  await tryAdd.click();
  const tryForm = viewer.getByRole("dialog", { name: "Add: Plant" });
  await settled(tryForm);
  await tryForm.getByLabel("Plant").fill("Basil on the sill");
  await tryForm.getByRole("button", { name: "Create" }).click();
  const tried = viewer.getByText("Basil on the sill");
  await expect(tried).toBeVisible({ timeout: 30_000 });
  expect(await onTop(viewer, tried)).toBe(true);
  // Nothing was installed on the second device.
  expect(await viewer.evaluate(() => localStorage.getItem("potyro:user-apps"))).toBeNull();
  await other.close();
}

/**
 * The same person on a day the relay's free route is not offered (today's production: the allowance
 * exists but is off): the Studio says what a key is and offers the gallery, and the gallery's Make it
 * mine ends in an app of their own with nothing set up.
 */
export async function noFreeRouteToGallery({ page, context, browser, baseURL, deployed }: Journey): Promise<void> {
  // The gallery's app: a demo link of Plants with the remix intent, as its Make it mine links it.
  const { context: author, page: authorPage } = await secondDevice(browser, baseURL, DESKTOP, deployed);
  const galleryLink = await makeDemoLink(authorPage, "Plants");
  await author.close();

  const relay = await fakeRelay(context, { chat: false });
  const cli = await noRealModel(context);
  await fakeGallery(context, galleryLink);

  const studio = await describeFromHome(page, { composer: !deployed });
  if (!deployed) {
    // Potyro is not offered at all while the relay says its chat route does not serve.
    await studio.getByRole("button", { name: "Model settings" }).click();
    const modal = page.getByRole("dialog", { name: "Model settings" });
    await expect(modal.getByRole("radio", { name: /OpenRouter/ })).toBeVisible();
    await expect(modal.getByRole("radio", { name: /^Potyro/ })).toHaveCount(0);
    // A deployed build starts here, on OpenRouter with no key (engine-store.ts `startingConfig`).
    await modal.getByRole("radio", { name: /OpenRouter/ }).check();
    await modal.getByRole("button", { name: "Close model settings" }).click();
  }

  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await settled(panel);
  await expect(panel).toContainText("usually a few cents an app");
  // Hidden, it is out of the accessibility tree: found with `includeHidden` to read what it holds.
  const box = studio.getByRole("textbox", { name: "Describe the app", includeHidden: true });
  await expect(box).toBeHidden();
  // FINDING #488: the panel takes the composer's place, and what the person typed on Home is nowhere
  // on screen (it waits in the hidden box until a key is added); the Studio's "Ideas to start from"
  // stay above the panel and fill that hidden box — a tap that shows nothing. These lines encode the
  // bug on purpose: once #488 is fixed they fail, and they become the real assertions — the words
  // shown (or said to be kept), and the ideas hidden or off while the box is.
  test.info().annotations.push({ type: "finding", description: "#488 the words typed on Home are hidden behind the key panel, and 'Ideas to start from' fill the hidden box" });
  await expect(box).toHaveValue(PROMPT);
  // In the Studio, that is: Home behind it still holds them in its own box, under the Studio.
  await expect(studio.getByText(PROMPT).filter({ visible: true })).toHaveCount(0);
  const idea = studio.getByRole("list", { name: "Ideas to start from" }).getByRole("button").first();
  await expect(idea).toBeVisible();
  const ideaWords = (await idea.textContent())!.trim();
  await idea.click();
  await expect(box).toHaveValue(ideaWords);
  await expect(box).toBeHidden();
  // The idea itself is the only place in the Studio its words show.
  await expect(studio.getByText(ideaWords, { exact: true }).filter({ visible: true })).toHaveCount(1);
  // When the build names no gallery (VITE_POTYRO_GALLERY), the link is the live site's root: the
  // tests route it, or they would leave for potyro.com.
  const start = panel.getByRole("link", { name: "Start from an app in the gallery" });
  await expect(start).toHaveAttribute("href", "https://potyro.com/");
  expect(await smallerSide(start)).toBeGreaterThanOrEqual(44);
  expect(await onTop(page, start)).toBe(true);

  const opened = context.waitForEvent("page");
  await start.click();
  const gallery = await opened;
  await expect(gallery).toHaveURL(/^https:\/\/potyro\.com\//);
  await gallery.getByRole("link", { name: "Make it mine" }).click();
  const card = gallery.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Plants" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Make it mine" }).click();
  // FINDING: the gallery opened in a tab of its own (target=_blank), and its Make it mine opens Potyro
  // in that tab while the Studio's tab still holds the storage — so the copy is refused ("its files
  // could not be saved. Potyro is open in another tab") and the person is asked to take Potyro over
  // here. "Use it here", then Make it mine again, gets through. When that is fixed, these lines go and
  // the copy is made at the first press.
  test.info().annotations.push({ type: "finding", description: "Gallery → Make it mine is refused while the Studio's tab is open: 'Potyro is open in another tab'" });
  const taken = gallery.getByRole("alertdialog", { name: "Potyro is open in another tab" });
  await expect(taken).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole("alert")).toContainText("Potyro is open in another tab");
  await taken.getByRole("button", { name: "Use it here" }).click();
  await card.getByRole("button", { name: "Make it mine" }).click();
  // Their own copy, open in the Studio, and the app behind it running on its sample plants.
  const remix = gallery.getByRole("dialog", { name: "App studio" });
  await expect(remix.getByRole("listitem", { name: "The Studio, on your remix" })).toBeVisible({ timeout: 30_000 });
  await remix.getByRole("button", { name: "Close studio" }).click();
  await expect(gallery.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  // Its sample plants are there: on the Plants page, which lists them all — Today shows only what is
  // due within a week, and the seed's dates move with the calendar (Monstera is due on the 15th).
  await gallery.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Plants" }).click();
  const monstera = gallery.getByText("Monstera").first();
  await expect(monstera).toBeVisible({ timeout: 30_000 });
  expect(await onTop(gallery, monstera)).toBe(true);

  expect(relay.chats).toEqual([]);
  expect(cli).toEqual([]);
}
