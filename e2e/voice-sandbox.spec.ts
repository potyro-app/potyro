import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { installShared } from "./realm.js";
import { endSpeech, fakeRecognizer, mockRelay, say } from "./voice.js";

// `ctx.caps.speech` in a SHARED app (docs/29): it declares `permissions: { speech: true }`, and the
// first listening asks — “Voice Notes” wants to listen to you through the microphone — saying where
// the words are made. Not now refuses with "denied" and is asked again; Allow is kept. The words
// reach the sealed box, in the realm and in the QuickJS fallback. In Firefox the recording goes to
// the (mocked) AI relay, and the question says so.

const SOURCE = readFileSync(new URL("./fixtures/voice-notes.app.ts", import.meta.url), "utf8");
const tap = (page: Page, label: string) => page.locator(".k-page-action", { hasText: label }).click();
const line = (page: Page, text: string) => page.locator(".k-primary", { hasText: text });
const dialog = (page: Page) => page.locator(".k-dialog");

async function open(page: Page, sandbox: "realm" | "quickjs"): Promise<void> {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("potyro:sandbox", s);
    } catch {
      // the sealed frame has no storage
    }
  }, sandbox);
  await installShared(page, "voice-notes", "Voice Notes", SOURCE);
  await expect(page.locator(".k-page-action", { hasText: "Dictate" })).toBeVisible();
}

for (const sandbox of ["realm", "quickjs"] as const) {
  test(`a shared app asks once before it listens; its box hears the words (${sandbox})`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the browser's recognizer: Chromium; Firefox below");
    await fakeRecognizer(page, { local: true });
    await open(page, sandbox);

    // Not now: refused, nothing listens, and nothing is remembered.
    await tap(page, "Dictate");
    await expect(dialog(page)).toContainText("“Voice Notes” wants to listen to you through the microphone.");
    await expect(dialog(page)).toContainText("Your words are turned into text on this device; only the text reaches the app.");
    await dialog(page).getByRole("button", { name: "Not now" }).click();
    await expect(line(page, "refused denied")).toBeVisible();

    // Asked again; Allow.
    await tap(page, "Dictate");
    await dialog(page).getByRole("button", { name: "Allow" }).click();
    await expect(line(page, "listening en-US device")).toBeVisible();
    await say(page, "buy milk and bread");
    await endSpeech(page);
    await expect(line(page, "heard: buy milk and bread")).toBeVisible();

    // Kept: the next listening goes without a question, and Stop ends it with what was heard.
    await tap(page, "Dictate");
    await expect(line(page, "listening en-US device").nth(1)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await say(page, "call mum");
    await tap(page, "Stop");
    await expect(line(page, "heard: call mum")).toBeVisible();
  });
}

test("Firefox: a shared app's question says the recording goes to OpenRouter; the words come back", async ({ page, browserName }) => {
  test.skip(browserName !== "firefox", "only Firefox lacks SpeechRecognition");
  const got = await mockRelay(page, "water the ferns");
  await open(page, "realm");
  await tap(page, "Dictate");
  await expect(dialog(page)).toContainText("“Voice Notes” wants to listen to you through the microphone.");
  await expect(dialog(page)).toContainText("sent to an AI service (OpenRouter) to be written down — it leaves your device");
  await dialog(page).getByRole("button", { name: "Allow" }).click();
  await expect(line(page, "listening en-US cloud")).toBeVisible();
  await page.waitForTimeout(600);
  await tap(page, "Stop");
  await expect(line(page, "heard: water the ferns")).toBeVisible();
  expect(got.filter((g) => g.path === "/ai/complete")).toHaveLength(1);
});
