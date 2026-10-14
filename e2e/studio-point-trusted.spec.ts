import { test, expect, type Page } from "@playwright/test";
import { ask, chooseOpenRouter, currentCard } from "./studio-helpers.js";

// Point at the app (#284): in the Studio's preview, tap a part of the app and talk about it.
//
// What has to hold, in a real browser against the real shell and a scripted OpenRouter:
//
//   - point mode takes the taps: pointing at a tab does not open it, so it is never using the app
//   - what is pointed at is the part the tap was in, with what it is inside one tap wider
//   - the next message carries it: a chip on the box and on the message, and the request the model
//     receives names it in words and shows the lines that declare it — and the app only once
//   - the edit that comes back lands on that part, as the app renders it
//   - a finger works as well as a mouse, and Cancel leaves the app as it was

const SLEEP = `import { defineApp } from "potyro";
import { useState } from "react";

function Tonight() {
  const [count, setCount] = useState(0);
  return (
    <div className="tonight">
      <h2>Tonight</h2>
      <button type="button" onClick={() => setCount(count + 1)}>
        Start the night
      </button>
      <p>Started {count} times</p>
    </div>
  );
}

export default defineApp({
  id: "sleep",
  name: "Sleep",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    night: {
      label: "Night",
      displayField: "date",
      fields: {
        date: { type: "datetime", required: true },
        hours: { type: "number", label: "Hours slept" },
        note: { type: "text" },
      },
    },
  },
  pages: [
    {
      id: "patterns",
      title: "Patterns",
      layout: {
        type: "stack",
        items: [
          { title: "Nights", view: { type: "list", entity: "night", display: { primary: "date", secondary: "hours" } } },
          { title: "Short nights", view: { type: "table", entity: "night", display: { columns: ["date", "hours"] } } },
        ],
      },
    },
    { id: "tonight", title: "Tonight", view: { type: "custom", entity: "night", render: () => Tonight() } },
  ],
});
`;

/** The model's answer: one edit, to the part that was pointed at. */
const NIGHTS_LINE = '          { title: "Nights", view: { type: "list", entity: "night", display: { primary: "date", secondary: "hours" } } },';
const RENAME = `Renaming that list.\n\`\`\`ts\n<<<<<<< SEARCH\n${NIGHTS_LINE}\n=======\n${NIGHTS_LINE.replace('"Nights"', '"Every night"')}\n>>>>>>> REPLACE\n\`\`\``;

async function seed(page: Page): Promise<void> {
  await page.addInitScript((src) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "sleep", name: "Sleep", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]));
  }, SLEEP);
}

async function openStudioOnSleep(page: Page) {
  await page.goto("/?user=sleep");
  await expect(page.locator("h1").first()).toHaveText("Sleep", { timeout: 30_000 });
  const tools = page.locator(".k-tools");
  // On a phone the tools are behind the app's menu.
  if (!(await tools.getByRole("button", { name: "Studio" }).isVisible())) await page.getByRole("button", { name: /menu|more/i }).first().click();
  await page.getByRole("button", { name: "Studio" }).or(page.getByRole("menuitem", { name: /Studio/ })).first().click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-name")).toHaveText("Sleep", { timeout: 60_000 });
  return studio;
}

const centreOf = async (page: Page, selector: string): Promise<{ x: number; y: number }> => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 40) };
};

test.describe("with a mouse, beside the conversation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("point at a list, ask for a change: the model is told which, and the edit lands there", async ({ page }) => {
    const requests: Array<Array<{ role: string; content: string }>> = [];
    await page.route("**/openrouter.ai/**", async (route) => {
      requests.push((route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> }).messages);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: RENAME } }] }) });
    });
    await seed(page);
    const studio = await openStudioOnSleep(page);
    await chooseOpenRouter(page, studio);
    const preview = studio.locator(".k-studio-preview");
    await expect(preview.locator(".k-layout-title", { hasText: "Short nights" })).toBeVisible({ timeout: 60_000 });

    await studio.locator(".k-preview").getByRole("button", { name: "Point" }).click();
    await expect(studio.locator(".k-point-bar")).toContainText("Tap the part you mean");

    // Hovering outlines what a click would point at, and names it on the outline.
    const nights = await centreOf(page, '.k-studio-preview .k-layout-item:has(> .k-layout-title:text-is("Nights"))');
    await page.mouse.move(nights.x, nights.y);
    await expect(studio.locator(".k-point-tag")).toHaveText("“Nights” list");
    await page.mouse.click(nights.x, nights.y);

    const tray = studio.getByRole("group", { name: "What you are pointing at" });
    await expect(tray.getByRole("radio", { checked: true })).toHaveText("“Nights” list");
    await expect(tray.getByRole("radio")).toHaveText(["“Nights” list", "“Patterns” page"]);
    await tray.getByRole("button", { name: /Ask about this/ }).click();

    // Picked: the mode ends and the box carries it.
    await expect(studio.locator(".k-point-layer")).toHaveCount(0);
    await expect(studio.locator(".k-composer .k-point-chip")).toContainText("“Nights” list");
    await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeFocused();

    await ask(studio, "call it Every night");
    await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/Applied 1 edit/, { timeout: 60_000 });

    // The message keeps what it was about.
    await expect(studio.locator(".k-thread-mine").last().locator(".k-point-chip")).toContainText("“Nights” list");
    await expect(studio.locator(".k-composer .k-point-chip")).toHaveCount(0);

    // What the model received: the part in words, and the lines that declare it — that item, not
    // its neighbour — beside the app, which is in the conversation once.
    const first = requests[0]!.find((m) => m.role === "user")!.content;
    expect(first).toContain('They pointed at the "Nights" list on the "Patterns" page');
    const lineOf = (needle: string): number => SLEEP.split("\n").findIndex((l) => l.includes(needle)) + 1;
    const at = lineOf('{ title: "Nights"');
    expect(first).toContain(`lines ${at}–${at}`);
    const excerpt = first.slice(first.indexOf(`lines ${at}–${at}`));
    expect(excerpt).toContain('{ title: "Nights", view: { type: "list"');
    expect(excerpt.slice(0, excerpt.indexOf("```", excerpt.indexOf("```") + 3))).not.toContain("Short nights");
    expect(first.split('id: "sleep"').length - 1).toBe(1);
    expect(first).toContain('About the "Nights" list on the "Patterns" page: call it Every night');

    // And the change is on that part, as the app renders it.
    await expect(preview.locator(".k-layout-title", { hasText: "Every night" })).toBeVisible({ timeout: 60_000 });
    await expect(preview.locator(".k-layout-title", { hasText: "Short nights" })).toBeVisible();
  });
});

test.describe("with a finger, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap points rather than presses, widens with one more tap, and comes back to the chat", async ({ page }) => {
    await seed(page);
    const studio = await openStudioOnSleep(page);

    // From the box: the app opens already pointing.
    await studio.getByRole("button", { name: "Point at the app" }).click();
    await expect(studio.locator(".k-point-bar")).toBeVisible();
    await expect(studio.locator(".k-studio-preview .k-layout-title", { hasText: "Short nights" })).toBeVisible({ timeout: 60_000 });

    // Tapping a tab points at its page — it does not open it.
    const tab = await centreOf(page, '.k-studio-preview .k-tab:has-text("Tonight")');
    await page.touchscreen.tap(tab.x, tab.y);
    const tray = studio.getByRole("group", { name: "What you are pointing at" });
    await expect(tray.getByRole("radio", { checked: true })).toHaveText("“Tonight” page");
    await expect(studio.locator(".k-studio-preview .k-layout-title", { hasText: "Short nights" })).toBeVisible();

    // Another tap points somewhere else; one more widens it to the page it is on.
    const table = await centreOf(page, '.k-studio-preview .k-layout-item:has(> .k-layout-title:text-is("Short nights"))');
    await page.touchscreen.tap(table.x, table.y);
    await expect(tray.getByRole("radio", { checked: true })).toHaveText("“Short nights” table");
    await tray.getByRole("radio", { name: "“Patterns” page" }).tap();
    await expect(tray.getByRole("radio", { checked: true })).toHaveText("“Patterns” page");
    await tray.getByRole("button", { name: /Ask about this/ }).tap();

    // Back in the conversation, with the box saying what the message is about.
    await expect(studio.locator(".k-preview")).toHaveCount(0);
    await expect(studio.locator(".k-composer .k-point-chip")).toContainText("“Patterns” page");
    await studio.getByRole("button", { name: "Stop pointing at “Patterns” page" }).tap();
    await expect(studio.locator(".k-composer .k-point-chip")).toHaveCount(0);

    // Cancel: the app works again, as it was.
    await studio.getByRole("button", { name: "Point at the app" }).tap();
    await studio.locator(".k-point-bar").getByRole("button", { name: "Cancel" }).tap();
    await expect(studio.locator(".k-point-layer")).toHaveCount(0);
    await studio.locator(".k-studio-preview .k-tab", { hasText: "Tonight" }).tap();
    await expect(studio.locator(".k-studio-preview").getByRole("button", { name: "Start the night" })).toBeVisible();
  });
});
