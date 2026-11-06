import { test, expect, type Browser, type BrowserContext, type Page } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";

// Write Together (apps/write-together): two people, one document, through the real sync relay.
//
// The platform claim under test is docs/04 "Writing together": a `text` field with
// `collaborative: true` merges two people's keystrokes and remembers who typed what. Everything
// below reads what a person sees — the words in the textarea on both devices, the colour under
// each person's words, a comment pinned to a word that keeps its word after the text in front of it
// changes — never only that something was stored.

let zip: Buffer;
test.beforeAll(() => {
  zip = packApp("write-together", "write-together.app.tsx");
});

async function device(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
  const page = await context.newPage();
  return { context, page };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Write" });
const backdrop = (page: Page) => page.locator(".wt-backdrop");
/** The background colour drawn under a stretch of text written by `who`. */
async function tintUnder(page: Page, text: string): Promise<string> {
  const span = backdrop(page).locator("span", { hasText: text }).first();
  await expect(span).toBeVisible();
  return span.evaluate((el) => getComputedStyle(el).backgroundColor);
}
/** Put the caret at `at` (and select up to `to`), then type as a person would. */
async function typeAt(page: Page, at: number, text: string): Promise<void> {
  await editor(page).evaluate((el, pos) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(pos, pos);
  }, at);
  await page.keyboard.type(text);
}

test("two people write one document at once, each in their colour, and a comment stays on its word", async ({ browser }) => {
  test.slow();

  // ---- Ana adds the app as hers, starts a document, writes ----
  const { context: ctxA, page: a } = await device(browser, { width: 1280, height: 800 });
  await addAsMine(a, "write-together.potyro-app.zip", zip);
  await a.getByRole("button", { name: "New document" }).click();
  const prompt = a.locator(".k-dialog");
  await prompt.locator("input").fill("Plan");
  await prompt.getByRole("button", { name: "OK" }).click();
  await expect(editor(a)).toBeVisible({ timeout: 30_000 });
  await editor(a).click();
  await a.keyboard.type("Hello from Ana.");
  await expect(editor(a)).toHaveValue("Hello from Ana.");
  // Her own words are tinted at once, in her colour.
  await expect(backdrop(a).locator("span[data-by]", { hasText: "Hello from Ana." })).toBeVisible();

  // ---- she shares it: Use it together ----
  await a.getByRole("button", { name: "Documents" }).click();
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Write Together", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  const field = a.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
  await a.locator(".k-list-row", { hasText: "Plan" }).click();
  await expect(editor(a)).toHaveValue("Hello from Ana.", { timeout: 30_000 });

  // ---- Bo joins on his phone and finds her words ----
  const { context: ctxB, page: b } = await device(browser, { width: 390, height: 780 });
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator(".k-list-row", { hasText: "Plan" })).toBeVisible({ timeout: 60_000 });
  await b.locator(".k-list-row", { hasText: "Plan" }).click();
  await expect(editor(b)).toHaveValue("Hello from Ana.", { timeout: 60_000 });

  // ---- they type at the same time, at opposite ends ----
  await Promise.all([typeAt(a, 0, "Note: "), typeAt(b, "Hello from Ana.".length, " And Bo.")]);
  const whole = "Note: Hello from Ana. And Bo.";
  await expect(editor(a)).toHaveValue(whole, { timeout: 60_000 });
  await expect(editor(b)).toHaveValue(whole, { timeout: 60_000 });

  // ---- each person's words wear that person's colour, the same on both screens ----
  await expect(backdrop(a).locator("span[data-by]", { hasText: "And Bo." })).toBeVisible({ timeout: 30_000 });
  const anaOnA = await tintUnder(a, "Hello from Ana.");
  const boOnA = await tintUnder(a, "And Bo.");
  expect(anaOnA).not.toBe(boOnA);
  expect(anaOnA).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await expect(backdrop(b).locator("span[data-by]", { hasText: "And Bo." })).toBeVisible({ timeout: 30_000 });
  expect(await tintUnder(b, "Hello from Ana.")).toBe(anaOnA);
  expect(await tintUnder(b, "And Bo.")).toBe(boOnA);
  // Two writers in the strip, on both.
  await expect(a.locator(".wt-swatch")).toHaveCount(2);
  await expect(b.locator(".wt-swatch")).toHaveCount(2);

  // ---- Ana types fast: nobody's colours blink off meanwhile, on either screen ----
  // The runs the host answers with trail the keys; carried onto the screen they keep the colours
  // on. A flash lasts one frame, so it is counted by an observer on every render of the backdrop,
  // not by looking now and then.
  const observe = (page: Page, text: string): Promise<void> =>
    page.evaluate((needle) => {
      const w = window as unknown as { __blinks: number; __renders: number };
      w.__blinks = 0;
      w.__renders = 0;
      const check = (): void => {
        const spans = [...document.querySelectorAll<HTMLElement>(".wt-backdrop span")];
        if (!spans.length) return;
        w.__renders++;
        const named = spans.find((el) => el.hasAttribute("data-by") && (el.textContent ?? "").includes(needle));
        if (!named) w.__blinks++;
      };
      new MutationObserver(check).observe(document.querySelector(".wt-backdrop")!, { subtree: true, childList: true, attributes: true, characterData: true });
    }, text);
  const blinks = (page: Page): Promise<{ blinks: number; renders: number }> => page.evaluate(() => ({ blinks: (window as unknown as { __blinks: number }).__blinks, renders: (window as unknown as { __renders: number }).__renders }));
  await observe(a, "And Bo.");
  await observe(b, "Hello from Ana.");
  const burst = " Ana adds a long sentence here, typed quickly, to see the colours hold.";
  await editor(a).evaluate((el, pos) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(pos, pos);
  }, whole.length);
  await a.keyboard.type(burst, { delay: 25 }); // a fast typist, for a couple of seconds
  await expect(editor(b)).toHaveValue(whole + burst, { timeout: 60_000 });
  await a.waitForTimeout(500);
  const onA = await blinks(a);
  const onB = await blinks(b);
  expect(onA.renders).toBeGreaterThan(10); // the observer saw the typing
  expect(onB.renders).toBeGreaterThan(10);
  expect({ a: onA.blinks, b: onB.blinks }).toEqual({ a: 0, b: 0 });
  // Take the sentence out again so the rest of the spec reads as before.
  await editor(a).evaluate((el, len) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(len, t.value.length);
  }, whole.length);
  await a.keyboard.press("Delete");
  await expect(editor(a)).toHaveValue(whole);
  await expect(editor(b)).toHaveValue(whole, { timeout: 60_000 });

  // ---- Bo comments on "Hello" ----
  await editor(b).evaluate((el, [from, to]) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(from, to);
  }, [whole.indexOf("Hello"), whole.indexOf("Hello") + 5]);
  await b.getByRole("button", { name: "+ Comment" }).click();
  await expect(b.locator(".wt-compose")).toContainText("“Hello”");
  await b.getByRole("textbox", { name: "Comment", exact: true }).fill("Too formal?");
  await b.getByRole("button", { name: "Add", exact: true }).click();
  await expect(b.getByTestId("comment")).toContainText(["Too formal?"]);
  await expect(backdrop(b).locator("span[data-comments]")).toHaveText("Hello");

  // ---- Ana sees it, then types in front of it: the comment keeps its word ----
  await expect(a.getByRole("button", { name: "Comments" })).toContainText("1", { timeout: 60_000 });
  await a.getByRole("button", { name: "Comments" }).click();
  await expect(a.getByTestId("comment")).toContainText("Too formal?");
  await expect(a.getByTestId("comment")).toContainText("Bo");
  await expect(backdrop(a).locator("span[data-comments]")).toHaveText("Hello", { timeout: 30_000 });
  await typeAt(a, 0, "PS. ");
  await expect(editor(a)).toHaveValue(`PS. ${whole}`);
  await expect(backdrop(a).locator("span[data-comments]")).toHaveText("Hello", { timeout: 30_000 });
  await expect(editor(b)).toHaveValue(`PS. ${whole}`, { timeout: 60_000 });
  await expect(backdrop(b).locator("span[data-comments]")).toHaveText("Hello", { timeout: 30_000 });

  // ---- Preview reads the document as a page ----
  await typeAt(a, 0, "# ");
  await a.getByRole("button", { name: "Preview" }).click();
  await expect(a.locator(".wt-preview h2")).toHaveText(`PS. ${whole}`);

  await ctxA.close();
  await ctxB.close();
});
