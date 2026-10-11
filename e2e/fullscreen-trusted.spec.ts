import { test, expect, type Page } from "@playwright/test";

// A page that asks for the whole screen gets it — no top bar, no tabs — and the shell keeps the way
// out: its ✕, Escape, and back. Trusted and sealed alike: an app can ask for the screen, not keep it.

const APP = (trusted: boolean) => `import { defineApp } from "potyro";
export default defineApp({
  id: "full-${trusted}",
  name: "Full",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { score: { label: "Score", displayField: "points", fields: { points: { type: "number" } } } },
  pages: [
    { id: "play", title: "Play", fullscreen: true, view: { type: "list", entity: "score", display: { primary: "points" }, emptyText: "The whole screen is mine" } },
    { id: "scores", title: "Scores", view: { type: "list", entity: "score", display: { primary: "points" } } },
  ],
});
`;

async function install(page: Page, trusted: boolean): Promise<void> {
  await page.addInitScript(
    ([src, t, id]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id, name: "Full", source: src, trusted: t, updatedAt: new Date().toISOString() }]));
    },
    [APP(trusted), trusted, `full-${trusted}`] as const,
  );
  await page.goto(`/?user=full-${trusted}`);
}

for (const [label, viewport] of [["phone", { width: 412, height: 915 }], ["desktop", { width: 1280, height: 800 }]] as const) {
  for (const trusted of [true, false]) {
    test(`${label}, ${trusted ? "trusted" : "sealed"}: a full-screen page has no bars, and the shell's way out works`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await install(page, trusted);
      await expect(page.getByText("The whole screen is mine")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".k-topbar, .k-sidenav, .k-tabbar")).toHaveCount(0);
      const exit = page.getByRole("button", { name: "Leave full screen" });
      await expect(exit).toBeVisible();

      await exit.click();
      await expect(exit).toHaveCount(0);
      await expect(page.getByText("The whole screen is mine")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Full", level: 1 })).toBeVisible();

      // Back in from the tools, then out with Escape.
      const more = page.getByRole("button", { name: /^More/ });
      if (await more.isVisible()) await more.click();
      await page.getByRole("menuitem", { name: "Full screen" }).or(page.getByRole("button", { name: "Full screen" })).first().click();
      await expect(page.getByRole("button", { name: "Leave full screen" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Leave full screen" })).toHaveCount(0);
    });
  }
}
