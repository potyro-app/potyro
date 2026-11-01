import { test, expect, type BrowserContext } from "./console-guard";
import { makeDemoLink, stranger } from "./share-demo";
import { openSource } from "./studio-helpers.js";

// The gallery opens in this tab (#487). From the Studio's key panel, "Start from an app in the
// gallery" used to open a tab of its own; the gallery's Make it mine then opened Potyro there while
// the Studio's tab still held the storage, and the copy was refused: "Potyro is open in another tab".
// Now the one tab goes to the gallery and comes back with the copy, and what the person typed is
// still theirs when they come back to the Studio.
//
// The relay is faked at the browser's edge, its chat route off (today's production); the gallery is
// a page at potyro.com with one Make it mine, linked as gallery/src/build.mjs links it.

const PROMPT = "a list of the plants I water and when";

async function noFreeRoute(context: BrowserContext): Promise<string[]> {
  await context.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: false }) }));
  // Nothing here may reach `claude -p`: on the dev server it is a real model on this machine.
  const asked: string[] = [];
  await context.route("**/__generate**", (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

test("from the key panel: the gallery and Make it mine, in one tab, with no refusal; the idea is kept", async ({ page, context, browser, baseURL }) => {
  // The gallery's app: a demo link of Plants, made on another device.
  const author = await stranger(browser, baseURL!);
  const link = await makeDemoLink(author.page, "Plants");
  await author.context.close();
  await context.route("https://potyro.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>Potyro gallery</title><h1>Apps to try</h1><a href="${link}&remix=1">Make it mine</a>` }),
  );
  const asked = await noFreeRoute(context);

  // Home: the idea, described; the Studio has no way to make it (no key, no free route), so the panel.
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "Make the app you need" });
  await welcome.getByRole("textbox", { name: "Describe your app" }).fill(PROMPT);
  await welcome.getByRole("button", { name: "Describe an app" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toHaveValue(PROMPT, { timeout: 30_000 });
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).click();
  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // The gallery, in this tab: no second tab to fight this one for the storage.
  const start = panel.getByRole("link", { name: "Start from an app in the gallery" });
  await expect(start).not.toHaveAttribute("target", /./);
  await start.click();
  await expect(page).toHaveURL(/^https:\/\/potyro\.com\//);
  expect(context.pages()).toEqual([page]);

  // Make it mine: back in Potyro, in the same tab, and the copy is made at the first press.
  await page.getByRole("link", { name: "Make it mine" }).click();
  const card = page.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Plants" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Make it mine" }).click();
  const remix = page.getByRole("dialog", { name: "App studio" });
  await expect(remix.getByRole("listitem", { name: "The Studio, on your remix" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alertdialog", { name: "Potyro is open in another tab" })).toHaveCount(0);
  await expect(page.getByText("Potyro is open in another tab")).toHaveCount(0);
  expect(context.pages()).toEqual([page]);
  // The remix's Studio is about the copy: the idea for a new app is not put in its box.
  await expect(remix.getByRole("textbox", { name: "Describe the app", includeHidden: true })).not.toHaveValue(PROMPT);
  await remix.getByRole("button", { name: "Close studio" }).click();
  // The copy runs, on its sample plants: on the Plants page, which lists them all (Today shows only
  // what is due within a week, and the seed's dates move with the calendar).
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Plants" }).click();
  await expect(page.getByText("Monstera").first()).toBeVisible({ timeout: 30_000 });

  // Back on Home the idea is still theirs: in Home's box, and in the Studio's when it opens again.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Actions for Plants (remix)" })).toBeVisible({ timeout: 30_000 });
  const box = page.getByRole("textbox", { name: "Describe your app" }).first();
  await expect(box).toHaveValue(PROMPT);
  // With words in it the box is already its full size: focus (a press on send) does not move the
  // button out from under the finger.
  const send = page.getByRole("button", { name: "Describe an app" }).first();
  const before = await send.boundingBox();
  await box.focus();
  expect(await send.boundingBox()).toEqual(before);
  await box.blur();
  // The Studio, opened any way (here: the header's New app), starts with them too.
  await page.getByRole("button", { name: "New app" }).first().click();
  const again = page.locator(".k-studio");
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.getByRole("textbox", { name: "Describe the app", includeHidden: true })).toHaveValue(PROMPT);
  // Taken once: a Studio opened after this one starts empty.
  await again.getByRole("button", { name: "Close studio" }).click();
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Describe your app" }).first()).toHaveValue("", { timeout: 30_000 });

  expect(asked).toEqual([]);
});

const GALLERY_PAGE = `<!doctype html><title>Potyro gallery</title><h1>Apps to try</h1>`;

test("from the key panel with code not saved: asked first; Stay keeps it, Leave goes", async ({ page, context }) => {
  await context.route("https://potyro.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: GALLERY_PAGE }));
  const asked = await noFreeRoute(context);

  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-name")).toHaveText("Groceries", { timeout: 60_000 });
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).click();
  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // A change in the code, not saved: it lives only in this page.
  const tools = await openSource(page, studio);
  const source = tools.getByRole("textbox", { name: "App source" });
  const edited = `${await source.inputValue()}\n// water on Sundays\n`;
  await source.fill(edited);
  await tools.getByRole("button", { name: "Close code, files and history" }).click();
  const here = page.url();

  const start = panel.getByRole("link", { name: "Start from an app in the gallery" });
  await start.click();
  const ask = page.getByRole("dialog", { name: "Leave for the gallery?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByText("The change you have not kept here is lost.")).toBeVisible();
  // Stay: still here, the change still in the code.
  await ask.getByRole("button", { name: "Stay" }).click();
  await expect(ask).toHaveCount(0);
  expect(page.url()).toBe(here);
  const again = await openSource(page, studio);
  await expect(again.getByRole("textbox", { name: "App source" })).toHaveValue(edited);
  await again.getByRole("button", { name: "Close code, files and history" }).click();

  // Leave: the person said so, and the page goes to the gallery.
  await start.click();
  await page.getByRole("dialog", { name: "Leave for the gallery?" }).getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/^https:\/\/potyro\.com\//);
  expect(context.pages()).toEqual([page]);
  expect(asked).toEqual([]);
});

test.describe("on a phone, Home's box owns the kept idea", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("cleared, nothing comes back; typed, Browse the gallery keeps it", async ({ page, context }) => {
    await context.route("https://potyro.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: GALLERY_PAGE }));
    const asked = await noFreeRoute(context);

    // Words kept from a Studio that went to the gallery (kept-idea.ts), and Home on the way back.
    await page.goto("/");
    await page.evaluate((text) => sessionStorage.setItem("potyro:kept-idea", JSON.stringify({ app: null, text })), PROMPT);
    await page.reload();
    const box = page.getByRole("textbox", { name: "Describe your app" }).first();
    await expect(box).toHaveValue(PROMPT, { timeout: 30_000 });

    // Cleared and sent: the Studio opens on an empty box, not on the words just deleted.
    await box.fill("");
    await page.getByRole("button", { name: "Describe an app" }).first().click();
    const studio = page.locator(".k-studio");
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByRole("textbox", { name: "Describe the app", includeHidden: true })).toHaveValue("");
    await studio.getByRole("button", { name: "Close studio" }).click();
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Describe your app" }).first()).toHaveValue("", { timeout: 30_000 });

    // Typed on Home, then the gallery from the New app menu: the words are there on the way back.
    await page.getByRole("textbox", { name: "Describe your app" }).first().fill("a reading tracker");
    await page.locator(".k-launch-fab").click();
    await page.getByRole("menuitem", { name: "Browse the gallery" }).click();
    await expect(page).toHaveURL(/^https:\/\/potyro\.com\//);
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Describe your app" }).first()).toHaveValue("a reading tracker", { timeout: 30_000 });
    expect(asked).toEqual([]);
  });
});
