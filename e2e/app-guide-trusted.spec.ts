import { test, expect, type Page } from "./console-guard";

// An app carries a guide: how to use it, said by the app (#80).
//
// A person describes an app and has to experiment to learn how it works; someone who was sent it
// never saw the conversation that made it. `guide` in `defineApp` is a few steps, and the shell
// shows them twice: the first time the app is opened on this device, as a card at the top of the
// page, and whenever asked for, from the app's menu. Closed once, the card does not come back by
// itself. An app that has no guide shows neither.

const STEPS = ["Tap “Add: Wine” to write down a bottle: its name and where it is from.", "Tap a bottle to change it."];

const cellar = (id: string, guide: string): string => `import { defineApp } from "potyro";
export default defineApp({
  id: "${id}", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  ${guide}
  entities: {
    wine: {
      label: "Wine", displayField: "name",
      fields: { name: { type: "text", required: true, label: "Name" }, region: { type: "text", label: "Region" } },
    },
  },
  pages: [{ id: "wines", title: "Wines", view: { type: "list", entity: "wine", display: { primary: "name", secondary: "region" } } }],
});
`;

const WITH_GUIDE = cellar("cellar", `guide: ${JSON.stringify(STEPS)},`);
const WITHOUT_GUIDE = cellar("plain", "");

/** Seed the person's own apps once: a reload keeps what the page wrote since. */
async function open(page: Page, id: string): Promise<void> {
  await page.addInitScript(
    ([withGuide, without]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      const now = new Date().toISOString();
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "cellar", name: "Cellar", source: withGuide, trusted: true, updatedAt: now },
          { id: "plain", name: "Cellar", source: without, trusted: true, updatedAt: now },
        ]),
      );
    },
    [WITH_GUIDE, WITHOUT_GUIDE] as const,
  );
  await page.goto(`/?user=${id}`);
  await expect(page.getByRole("button", { name: "Add: Wine" }).first()).toBeVisible({ timeout: 30_000 });
}

/** The app's menu entry: in the side bar on a wide screen, in the ⋯ menu on a phone. */
async function openGuideFromMenu(page: Page): Promise<void> {
  const tool = page.locator("[data-tool=guide]:visible");
  if (await tool.count()) return tool.first().click();
  await page.locator(".k-topbar .k-topbar-btn[aria-haspopup]").last().click();
  await page.getByRole("menuitem", { name: "How to use it" }).click();
}

test("the guide shows the first time an app is opened, and closed it stays closed", async ({ page }) => {
  await open(page, "cellar");
  const card = page.locator(".k-guide-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "How to use it" })).toBeVisible();
  await expect(card.locator(".k-guide-step")).toHaveText(STEPS);

  // It is part of the page, not a dialog: the app under it works while it is there.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add: Wine" }).first().click();
  const form = page.locator(".k-form");
  await form.getByRole("textbox", { name: "Name" }).fill("Barolo 2019");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toHaveText([/Barolo 2019/]);
  await expect(card).toBeVisible();

  // Not closed yet: it is there again after a reload.
  await page.reload();
  await expect(page.locator(".k-list-row")).toHaveText([/Barolo 2019/], { timeout: 30_000 });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".k-list-row")).toHaveText([/Barolo 2019/], { timeout: 30_000 });
  await expect(card).toHaveCount(0);
});

test("the guide is in the app's menu, also after its card was closed", async ({ page }) => {
  await open(page, "cellar");
  await page.locator(".k-guide-card").getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".k-guide-card")).toHaveCount(0);

  await openGuideFromMenu(page);
  const sheet = page.getByRole("dialog", { name: "How to use it" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Cellar");
  await expect(sheet.locator(".k-guide-step")).toHaveText(STEPS);
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await openGuideFromMenu(page);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
  // Asking for it is not the first visit again.
  await expect(page.locator(".k-guide-card")).toHaveCount(0);
});

test("an app without a guide shows no card and has no menu entry", async ({ page }) => {
  await open(page, "plain");
  await expect(page.locator(".k-guide-card")).toHaveCount(0);
  await expect(page.locator("[data-tool=guide]")).toHaveCount(0);
  const more = page.locator(".k-topbar .k-topbar-btn[aria-haspopup]:visible");
  if (await more.count()) {
    await more.last().click();
    await expect(page.getByRole("menu").first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "How to use it" })).toHaveCount(0);
  }
});
