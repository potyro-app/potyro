import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Installs the #112 fixture app (trusted or not) and opens a fresh note's page.
export async function installQuestions(page: Page, trusted: boolean): Promise<void> {
  const source = readFileSync(fileURLToPath(new URL("./fixtures/ui-questions.app.ts", import.meta.url)), "utf8");
  await page.addInitScript(([src, t]) => {
    localStorage.setItem("karta:user-apps", JSON.stringify([{ id: "ui-questions", name: "Questions", source: src, trusted: t, updatedAt: new Date().toISOString() }]));
  }, [source, trusted] as const);
  await page.goto("/?user=ui-questions");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
  await page.getByRole("button", { name: /New note/ }).first().click();
  await expect(page.locator("article.k-detail")).toBeVisible({ timeout: 30_000 });
}

