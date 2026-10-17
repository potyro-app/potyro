import { expect, type Page } from "./console-guard";

// Split's balances are one row per payment that squares the group ("Tom owes you €129.66"), and a
// row's Settle records THAT payment: the form opens filled in from the row — not a list of every
// payment to choose from again. Once recorded, the row is gone. Shared by the trusted and sealed specs.

export async function settleFirstRow(page: Page): Promise<void> {
  await page.goto("/?user=split");
  const balances = page.locator(".k-aggregate");
  const row = balances.locator(".k-aggregate-row", { hasText: "Tom owes you" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  const amount = ((await row.locator(".k-aggregate-value").textContent()) ?? "").replace(/[^\d.]/g, "");
  await row.getByRole("button", { name: "Settle" }).click();
  const form = page.getByRole("dialog", { name: "Record a payment" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("combobox", { name: "From" }).locator("option:checked")).toHaveText("Tom");
  await expect(form.getByRole("combobox", { name: "To" }).locator("option:checked")).toHaveText(/^(Me|You)$/);
  await expect(form.getByLabel(/^Amount/)).toHaveValue(amount);
  await form.getByRole("button", { name: "Record it" }).click();
  await expect(form).toHaveCount(0);
  await expect(balances.locator(".k-aggregate-row", { hasText: "Tom owes you" })).toHaveCount(0, { timeout: 30_000 });
  await expect(balances.locator(".k-aggregate-row", { hasText: "Inês owes you" })).toBeVisible();
}
