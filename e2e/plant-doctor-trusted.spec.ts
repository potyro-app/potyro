import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";

// apps/plant-doctor, packed as its build packs it and added from this device — SHARED, so it runs
// sealed in the browser realm the way a friend's copy does, asks before the camera and before the AI,
// and draws every screen with built-in views. A photo goes in; the person reads the finding (as sure
// as the photo allows, no surer), checks the care plan, and the plant is saved with its reminders. A
// check-up photo later sends the earlier photo beside today's and says it is better.
//
// OpenRouter is a mocked route: no real model is called, nothing is spent.

const PHOTO = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const RELAY_404 = "the free AI relay is not deployed in this test: its /ai/health and /ai/complete answer 404, as on a site without it";

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 860 } });

/** Add a packed app from this device; `mine: false` leaves "I wrote this" unticked, so it runs sealed. */
async function addPackage(page: Page, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: "plant-doctor.potyro-app.zip", mimeType: "application/zip", buffer: zip });
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 60_000 });
}

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name });
const field = (page: Page, label: string) => page.getByRole("main").locator(".k-field", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });
/** "Fri 23 Oct, 9:00" the way this browser's en-GB writes it. */
const at = (page: Page, d: Date) =>
  page.evaluate((t) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(t)), d.getTime());
const inDays = (n: number, hour = 9) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

test("a shared copy looks at a plant: camera and AI asked first, the finding read, the care plan checked and saved with reminders, and a check-up that compares", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*404/, RELAY_404);
  const first = {
    isPlant: true,
    clear: true,
    plant: { common: "Monstera", latin: "Monstera deliciosa", sure: "high" },
    problem: { kind: "underwatering", name: "Too little water", sure: "medium", signs: ["Curling leaves", "Dry, pulled-back soil"], check: ["Feel the soil a finger deep"], todo: ["Water deeply", "Let it drain"], serious: false },
    care: { waterEveryDays: 8, light: "bright", watch: ["Brown tips"] },
    trend: null,
    trendNote: null,
  };
  const later = { ...first, problem: { ...first.problem, kind: "none", name: null, signs: ["Leaves flat and firm"] }, trend: "better", trendNote: "The leaves have uncurled." };
  const sent: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
    } catch {
      // the realm's frame has no storage, and needs none of this
    }
  });
  await page.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route(OPENROUTER, async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    const answer = sent.length === 1 ? first : later;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { cost: 0.0003 } }) });
  });

  await addPackage(page, packApp("plant-doctor", "plant-doctor.app.ts"), false);
  const main = page.getByRole("main");
  await expect(main.getByText(/^Photograph a plant — or one sick leaf/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Check a plant/ }).click();
  const sheet = page.getByRole("menu", { name: "Check a plant" });
  await expect(sheet.getByRole("menuitem", { name: "Try it on a sample photo A made-up plant, looked at without AI — nothing is sent" })).toBeVisible();
  await sheet.getByRole("menuitem", { name: /^Choose a photo/ }).click();
  const camera = page.locator(".k-dialog", { hasText: "to use the camera?" });
  await expect(camera).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await camera.getByRole("button", { name: "Confirm" }).click();
  await (await chooser).setFiles({ name: "plant.png", mimeType: "image/png", buffer: PHOTO });
  const consent = page.locator(".k-dialog", { hasText: "wants to send a photo to an AI service" });
  await expect(consent).toContainText("“Plant Doctor” wants to send a photo to an AI service (OpenRouter) to read it.");
  expect(sent).toEqual([]);
  await consent.getByRole("button", { name: "Allow" }).click();

  // The finding, read before anything is kept: as sure as the look was, with the caveat.
  const finding = page.locator(".k-dialog", { hasText: "Probably: Too little water" });
  await expect(finding).toBeVisible({ timeout: 30_000 });
  await expect(finding).toContainText("Looks like: Monstera (Monstera deliciosa)");
  await expect(finding).toContainText("What it looks like: Curling leaves; Dry, pulled-back soil");
  await expect(finding).toContainText("A photo can't be sure.");
  await finding.getByRole("button", { name: "Save it with a care plan" }).click();

  // The care plan, filled in from the look; the person names the plant and says it was watered today.
  const form = page.getByRole("dialog", { name: "Your plant and its care plan" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Monstera");
  await expect(form.getByRole("textbox", { name: "Kind of plant" })).toHaveValue("Monstera deliciosa");
  await form.getByRole("textbox", { name: "Name" }).fill("Monty");
  await form.getByRole("group", { name: "Last watered shortcuts" }).getByRole("button", { name: "Today" }).click();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Water in 8 days. Next check-up photo in 7 days.")).toBeVisible({ timeout: 20_000 });

  // The finding's page.
  await expect(main.getByRole("heading", { name: "Too little water" })).toBeVisible();
  await expect(field(page, "It seems")).toContainText("Probably: Too little water");
  await expect(field(page, "What to do")).toContainText("• Water deeply\n• Let it drain");
  await expect(field(page, "When to ask someone")).toContainText("A photo can't be sure.");

  // What went: the photo and the instructions, one request.
  expect(sent).toHaveLength(1);
  const user = (sent[0]!.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; text?: string }>;
  expect(user.map((p) => p.type)).toEqual(["text", "image_url"]);
  expect(user[0]!.text).toContain("Say what plant it most likely is");

  // Plants: the card, and the plant's page with its plan and the reminders as they will come.
  await tab(page, "Plants").click();
  const card = main.getByRole("button", { name: /^Monty/ });
  await expect(card).toHaveAccessibleName("Monty Water in 8 days · Struggling");
  // The card is laid out as a gallery card: photo on top, the name under it, then its line — not the
  // Studio's version-card grid, which drew the name over its own line.
  const [photoBox, nameBox, lineBox] = await Promise.all([card.locator(".k-card-media").boundingBox(), card.locator(".k-primary").boundingBox(), card.locator(".k-secondary").boundingBox()]);
  expect(nameBox!.y).toBeGreaterThanOrEqual(photoBox!.y + photoBox!.height - 1);
  expect(lineBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1);
  await card.click();
  await expect(field(page, "Water")).toContainText("Water in 8 days");
  const water = await at(page, inDays(8));
  const check = await at(page, inDays(7));
  await expect(field(page, "Reminders")).toHaveText(`RemindersWater: ${water} · Check-up photo: ${check}`);

  // A check-up: the earlier photo beside today's, and it is better.
  await page.getByRole("button", { name: "New check-up photo" }).click();
  const again = page.getByRole("menu", { name: "A check-up photo" });
  await expect(again).toBeVisible();
  // A real plant's check-up offers no sample: the sample's second picture is of the sample plant.
  await expect(again.getByRole("menuitem", { name: /^Try it on a sample photo/ })).toHaveCount(0);
  await again.getByRole("menuitem", { name: /^Choose a photo/ }).click();
  // A sealed app asks for the camera at every photo; the AI it asked about once.
  await expect(camera).toBeVisible();
  const chooser2 = page.waitForEvent("filechooser");
  await camera.getByRole("button", { name: "Confirm" }).click();
  await (await chooser2).setFiles({ name: "plant-2.png", mimeType: "image/png", buffer: PHOTO });
  await expect(consent).toHaveCount(0);
  await expect(page.locator(".k-toast", { hasText: "Better since last time. The leaves have uncurled." })).toBeVisible({ timeout: 30_000 });
  expect(sent).toHaveLength(2);
  const user2 = (sent[1]!.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; text?: string }>;
  expect(user2.map((p) => p.type)).toEqual(["text", "image_url", "image_url"]);
  expect(user2[0]!.text).toMatch(/The first image is the same plant on \d{4}-\d{2}-\d{2}, when it looked like: underwatering \(Too little water\)/);
  expect(JSON.stringify(sent[1])).not.toContain("Monty");
  await expect(field(page, "Since last time")).toContainText("Better since last time. The leaves have uncurled.");

  // Shared, a check-up says it is a guess.
  await page.getByRole("button", { name: "Send to someone" }).click();
  const share = page.getByRole("dialog", { name: "Monty" });
  await expect(share.getByRole("textbox", { name: "What will be sent" })).toHaveValue(/^Monty: Looks healthy\n[\s\S]*\(A guess from a photo by Plant Doctor's AI, not a diagnosis\.\)$/);
});

test("the sample plant works with no key at all, sends nothing, and its check-up finds it better", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://openrouter.ai/") || r.url().includes("/ai/")) asked.push(r.url());
  });
  await addPackage(page, packApp("plant-doctor", "plant-doctor.app.ts"), false);
  await page.getByRole("button", { name: /Check a plant/ }).click();
  await page.getByRole("menu", { name: "Check a plant" }).getByRole("menuitem", { name: /^Try it on a sample photo/ }).click();
  const finding = page.locator(".k-dialog", { hasText: "Probably: Too much water" });
  await expect(finding).toBeVisible({ timeout: 20_000 });
  await finding.getByRole("button", { name: "Save it with a care plan" }).click();
  const form = page.getByRole("dialog", { name: "Your plant and its care plan" });
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Pothos");
  await form.getByRole("button", { name: "Save" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Too much water" })).toBeVisible({ timeout: 20_000 });
  // The photo on the finding is the sample, and it says so.
  const img = main.locator("img").first();
  await expect(img).toBeVisible();
  expect(await img.evaluate(async (el: HTMLImageElement) => (await fetch(el.src)).text())).toContain("SAMPLE PHOTO");

  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Plants" }).click();
  await main.getByRole("button", { name: /^Pothos/ }).click();
  await page.getByRole("button", { name: "New check-up photo" }).click();
  await page.getByRole("menu", { name: "A check-up photo" }).getByRole("menuitem", { name: /^Try it on a sample photo/ }).click();
  await expect(page.locator(".k-toast", { hasText: "Better since last time. No new yellow leaves, and the soil is drier than last time." })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Check-ups" }).click();
  await expect(main.getByText("Looks healthy")).toBeVisible();
  await expect(main.getByText("Probably: Too much water")).toBeVisible();
  expect(asked).toEqual([]);
});
