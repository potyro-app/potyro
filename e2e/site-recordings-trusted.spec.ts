import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Browser, type BrowserContext, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { answerNamePrompt } from "./name-prompt.js";
import { tileAction } from "./launcher-actions.js";
import { E2E_RELAY } from "./ports";

// The recordings on potyro.com (#8, #34): the real product, driven the way a person drives it, on a
// phone-sized screen, with every model answer replayed from a saved one so a re-shoot costs nothing
// and shows the same thing every time. Not part of the gate: it runs only when asked,
//
//   POTYRO_SITE_RECORD=1 POTYRO_E2E_PORT_BASE=5100 pnpm exec playwright test e2e/site-recordings-trusted.spec.ts --project trusted
//
// and writes `<name>.webm` (plus a few stills) into POTYRO_SITE_OUT (default: dist/site-recordings).
// The clips are recorded at 1× — Playwright's recorder draws a 2× page into the top-left quarter of the
// frame — at 412×915, a tall phone. Pauses are generous on purpose: a visitor reads the screen.

test.skip(!process.env.POTYRO_SITE_RECORD, "only when asked: POTYRO_SITE_RECORD=1");

const OUT = process.env.POTYRO_SITE_OUT ?? join(process.cwd(), "dist", "site-recordings");
const PHONE = { width: 412, height: 915 };
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Moments in a clip, in seconds since the test's first phone opened: written beside the clips, for the cut. */
let started = 0;
let marks: Record<string, number> = {};
const mark = (name: string) => { marks[name] = Math.round(((Date.now() - started) / 1000) * 10) / 10; };
const writeMarks = (name: string) => { writeFileSync(join(OUT, `${name}.marks.json`), JSON.stringify(marks, null, 2)); marks = {}; };

/** Every phone a test opened: a failed test leaves a still of each, so the failure can be seen. */
const open: Array<{ name: string; page: Page }> = [];
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    for (const [i, { name, page }] of open.entries()) await page.screenshot({ path: join(OUT, `fail-${name}-${i}.png`) }).catch(() => {});
  }
  open.length = 0;
});

/** A phone that records itself. */
async function phone(browser: Browser, opts: { init?: (context: BrowserContext) => Promise<void>; record?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/Rome", colorScheme: "light", ...(opts.record === false ? {} : { recordVideo: { dir: OUT, size: PHONE } }), acceptDownloads: true });
  await opts.init?.(context);
  const page = await context.newPage();
  if (!open.length) started = Date.now();
  else mark(`phone${open.length + 1}`);
  open.push({ name: test.info().title.split(" ")[0].toLowerCase(), page });
  return { context, page };
}

/**
 * Two phones filmed together: the browser's own screencast, whose frames carry one clock, so the two
 * streams line up to the frame. Each frame is written as `<seconds>.jpg` into `${OUT}/<name>/<side>/`.
 */
async function screencast(page: Page, dir: string): Promise<() => Promise<void>> {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", (e) => {
    writeFileSync(join(dir, `${e.metadata.timestamp!.toFixed(3)}.jpg`), Buffer.from(e.data, "base64"));
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: PHONE.width, maxHeight: PHONE.height, everyNthFrame: 1 });
  return async () => { await cdp.send("Page.stopScreencast"); await cdp.detach(); };
}

/** Close the phone and keep its clip under `name`. */
async function keep(context: BrowserContext, page: Page, name: string): Promise<void> {
  const video = page.video();
  await context.close();
  const path = await video?.path();
  if (path) copyFileSync(path, join(OUT, `${name}.webm`));
}

/** Add a packed app from this device; `mine: false` leaves "I wrote this" unticked, so it runs sealed. */
async function addPackage(page: Page, name: string, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: `${name}.potyro-app.zip`, mimeType: "application/zip", buffer: zip });
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 60_000 });
}

test.describe("recordings for potyro.com", () => {
  test.setTimeout(300_000);

  test("Plant Doctor reads a real plant photo (apps that use AI)", async ({ browser, consoleGuard }) => {
    consoleGuard.allow(/Failed to load resource: .*404/, "the free AI relay is not deployed in this run: /ai/health and /ai/complete answer 404");
    const photo = readFileSync(join(process.cwd(), "examples", "files", "plants", "photos", "monstera.webp"));
    // A real answer's shape, as the Plant Doctor spec replays it; the photo is a monstera.
    const answer = {
      isPlant: true,
      clear: true,
      plant: { common: "Monstera", latin: "Monstera deliciosa", sure: "high" },
      problem: { kind: "underwatering", name: "Too little water", sure: "medium", signs: ["Curling leaves", "Dry, pulled-back soil"], check: ["Feel the soil a finger deep"], todo: ["Water deeply", "Let it drain"], serious: false },
      care: { waterEveryDays: 8, light: "bright", watch: ["Brown tips"] },
      trend: null,
      trendNote: null,
    };
    const { context, page } = await phone(browser, {
      init: async (context) => {
        await context.addInitScript(() => {
          try {
            sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
          } catch {
            // the realm's frame has no storage, and needs none of this
          }
        });
        await context.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
        await context.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
        await context.route(OPENROUTER, async (route) => {
          await new Promise((r) => setTimeout(r, 2_500)); // a model takes a moment; the clip should show the wait
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { cost: 0.0003 } }) });
        });
      },
    });
    await addPackage(page, "plant-doctor", packApp("plant-doctor", "plant-doctor.app.ts"), false);
    await expect(page.getByRole("main").getByText(/^Photograph a plant — or one sick leaf/)).toBeVisible({ timeout: 30_000 });
    mark("app");
    await pause(page, 2_000);
    await page.getByRole("button", { name: /Check a plant/ }).click();
    await pause(page, 1_600);
    await page.getByRole("menu", { name: "Check a plant" }).getByRole("menuitem", { name: /^Choose a photo/ }).click();
    const camera = page.locator(".k-dialog", { hasText: "to use the camera?" });
    await expect(camera).toBeVisible();
    await pause(page, 1_800);
    await page.screenshot({ path: join(OUT, "permission-camera.png") });
    const chooser = page.waitForEvent("filechooser");
    await camera.getByRole("button", { name: "Confirm" }).click();
    await (await chooser).setFiles({ name: "monstera.webp", mimeType: "image/webp", buffer: photo });
    const consent = page.locator(".k-dialog", { hasText: "wants to send a photo to an AI service" });
    await expect(consent).toBeVisible();
    await pause(page, 2_200);
    await page.screenshot({ path: join(OUT, "permission-ai.png") });
    await consent.getByRole("button", { name: "Allow" }).click();
    const finding = page.locator(".k-dialog", { hasText: "Probably: Too little water" });
    await expect(finding).toBeVisible({ timeout: 30_000 });
    await pause(page, 3_200);
    await page.screenshot({ path: join(OUT, "plant-doctor-finding.png") });
    await finding.getByRole("button", { name: "Save it with a care plan" }).click();
    const form = page.getByRole("dialog", { name: "Your plant and its care plan" });
    await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Monstera");
    await pause(page, 1_800);
    await form.getByRole("group", { name: "Last watered shortcuts" }).getByRole("button", { name: "Today" }).click();
    await pause(page, 900);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved. Water in 8 days. Next check-up photo in 7 days.")).toBeVisible({ timeout: 20_000 });
    await pause(page, 2_600);
    await page.screenshot({ path: join(OUT, "plant-doctor-saved.png") });
    await pause(page, 1_000);
    writeMarks("plant-doctor");
    await keep(context, page, "plant-doctor");
  });

  test("the Studio makes the Plants app from one sentence (describe it, or code it)", async ({ browser }) => {
    // The answer is the real Plants app, replayed: the Studio's own client is exercised unchanged.
    const source = readFileSync(join(process.cwd(), "examples", "plants.app.ts"), "utf8");
    const { context, page } = await phone(browser, {
      init: async (context) => {
        const jobs = new Map<string, string>();
        let served = 0;
        await context.route("**/__generate**", async (route) => {
          const request = route.request();
          if (request.method() === "POST") {
            const id = `job-${++served}`;
            jobs.set(id, source);
            return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id }) });
          }
          const id = new URL(request.url()).searchParams.get("id") ?? "";
          const text = jobs.get(id);
          if (text === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unknown job" }) });
          // A model takes a while; the clip shows the Studio waiting as it really does.
          await new Promise((r) => setTimeout(r, 6_000));
          jobs.delete(id);
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + text + "```\n" }) });
        });
      },
    });
    await page.goto("/");
    const welcome = page.getByRole("region", { name: "Make the app you need" });
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    mark("home");
    await pause(page, 1_800);
    const first = welcome.getByRole("textbox", { name: "Describe your app" });
    await first.click();
    await first.pressSequentially("An app to remind me to water my plants, with a photo of each one", { delay: 45 });
    await pause(page, 1_200);
    await welcome.getByRole("button", { name: "Describe an app" }).click();
    const studio = page.getByRole("dialog", { name: "App studio" });
    await expect(studio).toBeVisible({ timeout: 60_000 });
    await pause(page, 1_500);
    const create = studio.getByRole("button", { name: /Create the app/ });
    if (await create.isVisible().catch(() => false)) await create.click();
    await expect(studio.locator(".k-card[data-current] .k-card-seq")).toHaveText("v1", { timeout: 90_000 });
    await pause(page, 2_500);
    await page.screenshot({ path: join(OUT, "studio-made.png") });
    // On a phone the Studio shows Conversation and App as tabs: the app, full size.
    await studio.getByRole("tab", { name: "App" }).click();
    await expect(studio.locator("h1", { hasText: "Plants" }).first()).toBeVisible({ timeout: 60_000 });
    await pause(page, 3_500);
    await page.screenshot({ path: join(OUT, "studio-app.png") });
    await pause(page, 1_000);
    writeMarks("studio");
    await keep(context, page, "studio");
  });

  test("two phones change Groceries at once (together, in real time)", async ({ browser }) => {
    const device = async (context: BrowserContext) => {
      await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
    };
    const a = await phone(browser, { init: device, record: false });
    await a.page.goto("/?app=groceries");
    await expect(a.page.getByRole("checkbox", { name: "Apples" })).toBeVisible({ timeout: 60_000 });
    mark("aList");
    await pause(a.page, 2_000);

    // Share it: sync on, a name, the link.
    await a.page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await tileAction(a.page, "Groceries", "share");
    await a.page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
    await answerNamePrompt(a.page, "Ana");
    const linkField = a.page.locator(".k-dialog input");
    await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
    const link = await linkField.inputValue();
    await pause(a.page, 1_500);
    await a.page.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
    const more = a.page.locator(".k-dialog", { hasText: "more than one place" });
    if (await more.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) await more.getByRole("button", { name: "Cancel" }).click();
    await expect(a.page.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
    await expect(a.page.getByRole("checkbox", { name: "Apples" })).toBeVisible({ timeout: 60_000 });

    // The friend's phone joins by the link.
    const b = await phone(browser, { init: device, record: false });
    await b.page.goto(link);
    await b.page.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
    await answerNamePrompt(b.page, "Tom");
    await expect(b.page.getByRole("checkbox", { name: "Apples" })).toBeVisible({ timeout: 90_000 });
    mark("bList");
    // Both at the top of the same list before the cameras roll.
    for (const p of [a.page, b.page]) await p.evaluate(() => window.scrollTo(0, 0));
    await pause(a.page, 800);
    const stopA = await screencast(a.page, join(OUT, "together", "a"));
    const stopB = await screencast(b.page, join(OUT, "together", "b"));
    await pause(a.page, 1_400);

    // Tom ticks two things; each leaves Ana's list for the basket as he ticks it.
    const tick = async (page: Page, name: RegExp) => {
      const box = page.getByRole("checkbox", { name }).first();
      await box.scrollIntoViewIfNeeded();
      await box.click();
    };
    await tick(b.page, /Apples/);
    await expect(a.page.getByRole("checkbox", { name: /Apples/ })).toHaveCount(0, { timeout: 60_000 });
    await pause(a.page, 1_600);
    await tick(b.page, /Bananas/);
    await expect(a.page.getByRole("checkbox", { name: /Bananas/ })).toHaveCount(0, { timeout: 60_000 });
    await pause(a.page, 1_600);
    // Ana adds something; it appears on Tom's phone.
    const add = a.page.getByRole("textbox", { name: /Add an item/i }).or(a.page.getByPlaceholder(/Add an item/i)).first();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await add.pressSequentially("Oat milk", { delay: 70 });
    await a.page.getByRole("button", { name: /^Add$/ }).click();
    await expect(b.page.getByRole("checkbox", { name: /Oat milk/ }).first()).toBeVisible({ timeout: 60_000 });
    await pause(a.page, 2_800);
    await stopA();
    await stopB();
    await a.page.screenshot({ path: join(OUT, "together-a.png") });
    await b.page.screenshot({ path: join(OUT, "together-b.png") });
    mark("end");
    writeMarks("together");
    await a.context.close();
    await b.context.close();

  });

});
