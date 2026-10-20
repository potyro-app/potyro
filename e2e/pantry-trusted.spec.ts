import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";

// apps/pantry (What's in my kitchen), packed as its build packs it and added from this device —
// SHARED, so it runs sealed in the browser realm the way a friend's copy does, asks before the camera
// and before the AI, and draws every screen with built-in views. A photo goes in; the items the
// person checked come out on Kitchen, soonest first under their headings, each with its reminder;
// used and thrown away count on Waste; and "What can I cook?" sends the names and days left of what
// is still there — nothing else — and its idea goes to the share sheet.
//
// OpenRouter is a mocked route: no real model is called, nothing is spent. The answers are built
// from today, so "in 3 days" is always ahead, whatever day the suite runs.

const PHOTO = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const RELAY_404 = "the free AI relay is not deployed in this test: its /ai/health and /ai/complete answer 404, as on a site without it";

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 860 } });

const inDays = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Add a packed app from this device; `mine: false` leaves "I wrote this" unticked, so it runs sealed. */
async function addPackage(page: Page, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: "pantry.potyro-app.zip", mimeType: "application/zip", buffer: zip });
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 60_000 });
}

/** The page's tab bar. */
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name });

test("a shared copy reads a shelf: camera and AI asked first, the checked items saved by expiry with reminders, used and wasted counted, and an idea for what goes first", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*404/, RELAY_404);
  const shelf = {
    kind: "food",
    boughtOn: null,
    items: [
      { name: "Milk", category: "dairy", where: "fridge", bestBefore: iso(inDays(5)), amount: "1 L" },
      { name: "Chicken thighs", category: "meat", where: null, bestBefore: iso(inDays(3)), amount: "500 g" },
      { name: "Spinach", category: "produce", where: null, bestBefore: null, amount: null },
    ],
  };
  const ideas = {
    ideas: [{ title: "Chicken and spinach skillet", uses: ["Chicken thighs", "Spinach", "Saffron"], minutes: 25, steps: ["Brown the chicken.", "Wilt the spinach in."] }],
  };
  const sent: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
    } catch {
      // the realm's frame has no storage, and needs none of this
    }
    const w = window as unknown as { __shared?: unknown[] };
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: async (data: unknown) => {
        (w.__shared ??= []).push(data);
      },
    });
  });
  await page.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route(OPENROUTER, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    const answer = JSON.stringify(body).includes("home kitchen") ? ideas : shelf;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { cost: 0.0003 } }) });
  });

  await addPackage(page, packApp("pantry", "pantry.app.ts"), false);
  const main = page.getByRole("main");
  await expect(main.getByText(/^Photograph a fridge shelf, your shopping or a receipt/)).toBeVisible({ timeout: 30_000 });

  // Add from a photo → Choose a photo. Sealed: the camera is asked for first.
  await page.getByRole("button", { name: /Add from a photo/ }).click();
  const sheet = page.getByRole("menu", { name: "Add from a photo" });
  await expect(sheet.getByRole("menuitem", { name: "Try it on a sample photo A made-up fridge shelf, read without AI — nothing is sent" })).toBeVisible();
  await sheet.getByRole("menuitem", { name: /^Choose a photo/ }).click();
  const camera = page.locator(".k-dialog", { hasText: "to use the camera?" });
  await expect(camera).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await camera.getByRole("button", { name: "Confirm" }).click();
  await (await chooser).setFiles({ name: "shelf.png", mimeType: "image/png", buffer: PHOTO });

  // Then the AI, naming the service, before anything is sent.
  const consent = page.locator(".k-dialog", { hasText: "wants to send a photo to an AI service" });
  await expect(consent).toContainText("“Pantry” wants to send a photo to an AI service (OpenRouter) to read it.");
  expect(sent).toEqual([]);
  await consent.getByRole("button", { name: "Allow" }).click();

  // The form: one card per thing found, the printed dates as read and the missing one guessed.
  const form = page.getByRole("dialog", { name: "Check what was found" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  const names = form.getByRole("textbox", { name: "What" });
  await expect(names).toHaveCount(3);
  await expect(names.nth(0)).toHaveValue("Milk");
  await expect(names.nth(2)).toHaveValue("Spinach");
  const guesses = form.getByRole("switch", { name: "The date is a guess" });
  await expect(guesses.nth(0)).not.toBeChecked();
  await expect(guesses.nth(2)).toBeChecked();
  // The person corrects a name before saving: what is saved is theirs.
  await names.nth(0).fill("Oat milk");
  await form.getByRole("button", { name: "Add to my kitchen" }).click();
  await expect(page.getByText("Added 3 things. First to go: Chicken thighs (3 days left).")).toBeVisible({ timeout: 20_000 });

  // Kitchen: under its heading, soonest first, the guess saying it is one.
  await expect(main.locator(".k-primary").first()).toHaveText("Chicken thighs");
  await expect(main.locator(".k-primary")).toHaveText(["Chicken thighs", "Oat milk", "Spinach"]);
  await expect(main.getByText("In the next 3 days", { exact: true })).toBeVisible();
  await expect(main.getByText("This week", { exact: true })).toBeVisible();
  await expect(main.getByText("3 days left · 500 g · Fridge")).toBeVisible();
  await expect(main.getByText("5 days left · date guessed · Fridge")).toBeVisible();
  // What went to the AI: the photo and the instructions, one request — never the person's edit.
  expect(sent).toHaveLength(1);
  const user = (sent[0]!.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; text?: string }>;
  expect(user.map((p) => p.type)).toEqual(["text", "image_url"]);
  expect(user[0]!.text).toContain("A photo of food");

  // The chicken's page: how long it keeps, and the reminder at 9:00 the day before.
  await main.locator(".k-list-row", { hasText: "Chicken thighs" }).click();
  const remindDay = new Date(inDays(2).getTime());
  remindDay.setHours(9);
  const expected = await page.evaluate(
    (t) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(t)),
    remindDay.getTime(),
  );
  await expect(page.locator(".k-field", { hasText: "Reminder" })).toHaveText(`Reminder${expected}`);
  await expect(page.locator(".k-field", { hasText: "Freshness" })).toHaveText("Freshness3 days left");

  // Used it: it leaves Kitchen and counts on Waste. The spinach is thrown out.
  await page.getByRole("button", { name: "Used it" }).click();
  await expect(page.getByText("Used: Chicken thighs. Nice.")).toBeVisible();
  await tab(page, "Kitchen").click();
  await expect(main.locator(".k-primary")).toHaveText(["Oat milk", "Spinach"]);
  await main.locator(".k-list-row", { hasText: "Spinach" }).click();
  await page.getByRole("button", { name: "Threw it out" }).click();
  await expect(page.getByText("Thrown away: Spinach. It counts on Waste.")).toBeVisible();
  await tab(page, "Waste").click();
  const tile = (label: string) => main.locator(".k-stat", { hasText: label });
  await expect(tile("Thrown away this month")).toContainText("1");
  await expect(tile("Used this month")).toContainText("1");
  await expect(tile("Thrown away, last 30 days")).toContainText("50%");
  await expect(main.getByText("Thrown away on", { exact: false })).toBeVisible();

  // What can I cook? — says what it sends, sends only that, and keeps only what is really there.
  await tab(page, "Kitchen").click();
  await page.getByRole("button", { name: /What can I cook\?/ }).click();
  const cook = page.getByRole("menu", { name: "What can I cook?" });
  await expect(cook.getByRole("menuitem", { name: /^Ask for 2–3 ideas Sends only these names and how long each has left: Oat milk$/ })).toBeVisible();
  await cook.getByRole("menuitem", { name: /^Ask for 2–3 ideas/ }).click();
  await expect(page.getByText("1 idea, using what goes first.")).toBeVisible({ timeout: 20_000 });
  expect(sent).toHaveLength(2);
  const ask = (sent[1]!.messages as Array<{ content: unknown }>)[1]!.content;
  const askText = JSON.stringify(ask);
  expect(askText).toContain("- Oat milk: 5 days left");
  expect(askText).not.toContain("image_url");
  expect(askText).not.toContain("Spinach");
  expect(askText).not.toContain("Chicken");

  await expect(main.locator(".k-primary")).toHaveText(["Chicken and spinach skillet"]);
  await main.locator(".k-list-row").first().click();
  await page.getByRole("button", { name: "Send it to someone" }).click();
  const share = page.getByRole("dialog", { name: "Chicken and spinach skillet" });
  // Neither the chicken nor the spinach is in the kitchen any more, so the idea uses nothing of it.
  await expect(share.getByRole("textbox", { name: "What will be sent" })).toHaveValue("Chicken and spinach skillet (25 min)\n\n1. Brown the chicken.\n2. Wilt the spinach in.");
});

test("the sample shelf works with no key at all, sends nothing, and the sample ideas use it", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://openrouter.ai/") || r.url().includes("/ai/")) asked.push(r.url());
  });
  await addPackage(page, packApp("pantry", "pantry.app.ts"), false);
  await page.getByRole("button", { name: /Add from a photo/ }).click();
  await page.getByRole("menu", { name: "Add from a photo" }).getByRole("menuitem", { name: /^Try it on a sample photo/ }).click();
  const form = page.getByRole("dialog", { name: "Sample shelf — check what was found" });
  await expect(form).toBeVisible({ timeout: 20_000 });
  await expect(form.getByRole("textbox", { name: "What" })).toHaveCount(6);
  await form.getByRole("button", { name: "Add to my kitchen" }).click();
  await expect(page.getByText("Added 6 things. First to go: Chicken thighs (Expires tomorrow).")).toBeVisible({ timeout: 20_000 });
  const main = page.getByRole("main");
  await expect(main.locator(".k-primary")).toHaveText(["Chicken thighs", "Milk", "Spinach", "Tomatoes", "Greek yogurt", "Cheddar"]);
  // How much and where ride through the form unseen: the card only asks what needs checking.
  await expect(main.getByText("Expires tomorrow · 500 g · Fridge")).toBeVisible();

  // The photo is the item page's cover (the entity's photo field fills the top of the page, and its
  // "From this photo" section is not shown twice), and it says SAMPLE across its top.
  await main.locator(".k-list-row", { hasText: "Milk" }).click();
  const img = page.getByRole("main").locator("img").first();
  await expect(img).toBeVisible();
  const svg = await img.evaluate(async (el: HTMLImageElement) => (await fetch(el.src)).text());
  expect(svg).toContain("SAMPLE PHOTO");

  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Kitchen" }).click();
  await page.getByRole("button", { name: /What can I cook\?/ }).click();
  await page.getByRole("menu", { name: "What can I cook?" }).getByRole("menuitem", { name: /^Show ideas for the sample shelf/ }).click();
  await expect(page.getByText("2 ideas, using what goes first.")).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText("Chicken thighs, Spinach and Tomatoes · 25 min")).toBeVisible();
  expect(asked).toEqual([]);
});
