import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The `ctx.ui.timer` / `ctx.ui.keepAwake` fixture (fixtures/kitchen.app.ts), installed trusted or not,
// with the screen's wake lock recorded rather than taken: the browser's own lock cannot be observed
// from a page, and a headless one may refuse it. What the shell asks for, and when it lets go, can.
// Not a `.spec.ts`, so Playwright does not collect it.

/** A second app to switch to: leaving Kitchen in place, the way a person does. */
const PANTRY = `import { defineApp } from "potyro";
export default defineApp({ id: "pantry", name: "Pantry", version: "1.0.0", schemaVersion: 1,
  entities: { jar: { label: "Jar", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "jars", title: "Jars", view: { type: "list", entity: "jar", display: { primary: "name" } } }] });
`;

export async function installKitchen(page: Page, trusted: boolean): Promise<void> {
  const source = readFileSync(fileURLToPath(new URL("./fixtures/kitchen.app.ts", import.meta.url)), "utf8");
  await page.addInitScript(
    ([src, t, pantry]) => {
      if (!localStorage.getItem("potyro:user-apps")) {
        const at = new Date().toISOString();
        localStorage.setItem(
          "potyro:user-apps",
          JSON.stringify([
            { id: "kitchen", name: "Kitchen", source: src, trusted: t, updatedAt: at },
            { id: "pantry", name: "Pantry", source: pantry, trusted: t, updatedAt: at },
          ]),
        );
      }
      const log: string[] = [];
      (window as unknown as { __wake: string[] }).__wake = log;
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: async (type: string) => {
            log.push(`request:${type}`);
            const sentinel = { released: false, release: async () => void ((sentinel.released = true), log.push("release")) };
            return sentinel;
          },
        },
      });
    },
    [source, trusted, PANTRY] as const,
  );
  await page.goto("/?user=kitchen");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
}

export const wakeLog = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as unknown as { __wake: string[] }).__wake]);

export const chip = (page: Page, label: RegExp | string) => page.locator(".k-timer-chip", { hasText: label });

/** Leave Kitchen for Pantry through the app switcher: in place, so the shell puts Kitchen away. */
export async function switchToPantry(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.getByRole("dialog", { name: "Switch app" }).getByRole("button", { name: /Pantry$/ }).first().click();
  await expect(page.locator("h1").first()).toHaveText("Pantry", { timeout: 30_000 });
}

/** The page actions sit in the page's own bar; on a phone some are behind its ⋯. */
export async function run(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: false }).first().click();
}
