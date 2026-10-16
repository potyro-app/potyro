import { test, expect, type Locator, type Page } from "./console-guard";
import { openNewStudio } from "./studio-helpers.js";
import { endSpeech, fakeRecognizer, mockRelay, say } from "./voice.js";

// The Studio's microphone (docs/29 §4): tap or hold, the words appear in the box as they are said,
// they can be changed, and they are sent like typed ones. Where the words would leave the device the
// Studio asks once, naming who makes them; on the device it does not ask at all. In Firefox, which
// has no SpeechRecognition, the recording is written down by the (mocked) AI relay.
//
// No real recognizer and no real model: voice.ts. `VOICE_SHOTS` (a directory) also saves the mic's
// states at 412 px, light and dark.

const SHOTS = process.env.VOICE_SHOTS;
const box = (studio: Locator) => studio.getByRole("textbox", { name: "Describe the app" });
const mic = (studio: Locator) => studio.locator(".k-voice-btn");
const strip = (page: Page) => page.locator(".k-voice-strip");

async function stubGenerator(page: Page): Promise<void> {
  // The model is not what this spec is about: the turn is made and answered with nothing to build.
  await page.route("**/__generate**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "job-1" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "What should it remember about each plant?" }) }),
  );
}

/** On a phone the floating New app asks first: make one, or add one someone sent. */
async function openPhoneStudio(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.locator(".k-launch-fab").tap();
  await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
  const studio = page.locator(".k-studio");
  await expect(box(studio)).toBeVisible({ timeout: 30_000 });
  return studio;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.locator(".k-composer").screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
}

test.describe("Chromium: the browser's recognizer", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Firefox has no SpeechRecognition: the next describe");

  test("tap: asks once (Google's servers), words appear live, stop, change them, send", async ({ page }) => {
    await fakeRecognizer(page);
    await stubGenerator(page);
    const studio = await openNewStudio(page);
    await box(studio).fill("A plant diary");

    await mic(studio).click();
    const dialog = page.locator(".k-dialog");
    await expect(dialog).toContainText("Use your voice to describe the app?");
    await expect(dialog).toContainText("on Google’s servers, so what you say leaves your device");
    await dialog.getByRole("button", { name: "Use my voice" }).click();

    await expect(strip(page)).toContainText("Listening — tap ■ to stop");
    await expect(strip(page)).toContainText("Through Google’s speech service");
    await expect(mic(studio)).toHaveAttribute("aria-pressed", "true");
    await expect(studio.locator(".k-composer-box")).toHaveAttribute("data-listening", "true");

    await say(page, "with a photo", false);
    await expect(box(studio)).toHaveValue("A plant diary with a photo");
    await say(page, "with a photo of each plant", true);
    await expect(box(studio)).toHaveValue("A plant diary with a photo of each plant");

    await mic(studio).click(); // tap again: stop
    await expect(strip(page)).toHaveCount(0);
    await expect(mic(studio)).toHaveAttribute("aria-pressed", "false");

    // Editable before sending.
    await box(studio).press("End");
    await box(studio).pressSequentially(" and watering days");
    await studio.getByRole("button", { name: "Create the app" }).click();
    await expect(studio.getByText("A plant diary with a photo of each plant and watering days")).toBeVisible();
    await expect(box(studio)).toHaveValue("");

    // Asked once: the next listening goes without a question.
    await mic(studio).click();
    await expect(strip(page)).toContainText("Listening");
    await expect(dialog).toHaveCount(0);
    await endSpeech(page);
    await expect(strip(page)).toHaveCount(0);
  });

  test("on the device: no question; hold to talk, let go to stop", async ({ page }) => {
    await fakeRecognizer(page, { local: true });
    const studio = await openNewStudio(page);
    const b = (await mic(studio).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await expect(strip(page)).toContainText("Listening — let go when you’re done");
    await expect(strip(page)).toContainText("On this device");
    await expect(page.locator(".k-dialog")).toHaveCount(0);
    await say(page, "a habit tracker", false);
    await expect(box(studio)).toHaveValue("a habit tracker");
    await page.mouse.up();
    await expect(strip(page)).toHaveCount(0);
    await expect(box(studio)).toHaveValue("a habit tracker");
  });

  test("typing takes over from the microphone", async ({ page }) => {
    await fakeRecognizer(page, { local: true });
    const studio = await openNewStudio(page);
    await mic(studio).click();
    await say(page, "a reading list", false);
    await expect(box(studio)).toHaveValue("a reading list");
    await box(studio).press("End");
    await box(studio).pressSequentially("!");
    await expect(strip(page)).toHaveCount(0);
    await expect(box(studio)).toHaveValue("a reading list!");
  });
});

test.describe("Firefox: a recording, written down by the AI relay", () => {
  test.skip(({ browserName }) => browserName !== "firefox", "only Firefox lacks SpeechRecognition");

  test("asks once naming OpenRouter, records, says it is writing it down, the words land in the box", async ({ page }) => {
    const got = await mockRelay(page, "A shopping list for the week");
    // The relay answers slowly enough to see "Writing down…".
    await page.route("**/ai/complete", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fallback();
    });
    const studio = await openNewStudio(page);
    await expect(mic(studio)).toBeVisible();
    await mic(studio).click();
    const dialog = page.locator(".k-dialog");
    await expect(dialog).toContainText("Use your voice to describe the app?");
    await expect(dialog).toContainText("sent to an AI service (OpenRouter) to be written down — it leaves your device");
    expect(got.filter((g) => g.path === "/ai/complete")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Use my voice" }).click();

    await expect(strip(page)).toContainText("Listening");
    await expect(strip(page)).toContainText("Sent to OpenRouter to write down");
    await page.waitForTimeout(800); // a moment of (fake) sound
    await mic(studio).click();
    await expect(strip(page)).toContainText("Writing down what you said…");
    await expect(box(studio)).toHaveValue("A shopping list for the week");
    await expect(strip(page)).toHaveCount(0);

    const sent = got.filter((g) => g.path === "/ai/complete");
    expect(sent).toHaveLength(1);
    const parts = sent[0]!.body!.parts!;
    expect(parts.map((p) => p.type)).toEqual(["text", "audio"]);
    expect(parts[1]!.data).toMatch(/^data:audio\/wav;base64,UklGR/); // "RIFF"
  });
});

test.describe("screenshots, 412 px", () => {
  test.skip(({ browserName }) => browserName !== "chromium" || !SHOTS, "VOICE_SHOTS=<dir> to save them");
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`the microphone's states (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await fakeRecognizer(page);
      const studio = await openPhoneStudio(page);
      await expect(mic(studio)).toBeVisible();
      await shot(page, `1-idle-${scheme}`);
      await mic(studio).tap();
      await page.locator(".k-dialog").getByRole("button", { name: "Use my voice" }).tap();
      await say(page, "A plant diary with a photo of each", false);
      await expect(strip(page)).toContainText("Listening");
      await shot(page, `2-listening-${scheme}`);
      await mic(studio).tap();
      await expect(strip(page)).toHaveCount(0);
      await shot(page, `3-heard-${scheme}`);
      await page.screenshot({ path: `${SHOTS}/4-whole-${scheme}.png` });
    });
  }
});
