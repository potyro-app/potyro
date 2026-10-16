import { test, expect, type Page } from "./console-guard";

// Split's guests (docs/04 §Guests): the people of a group named before they have the app. The sample
// Lisbon weekend names three — Ana, Tom and Inês — so its balances say who owes whom on the first run,
// alone; the expense form's pickers name them like members; Invite names more ("Who's coming?"); and
// a guest is in the groups that list them, so the flat's bills stay yours.

const shots = process.env.POTYRO_SHOTS;

test.use({ viewport: { width: 1280, height: 900 } });

const balances = (page: Page) => page.locator(".k-aggregate");

async function chooseGroup(page: Page, name: RegExp): Promise<void> {
  const scope = page.locator(".k-scope");
  if (await scope.isVisible().catch(() => false)) await scope.click();
  await page.getByRole("dialog").getByRole("button", { name }).first().click();
  await expect(scope).toContainText(name);
}

test("guests make a group lively before anyone joins, and Invite names more", async ({ page }) => {
  await page.goto("/?user=split");
  await expect(page.getByRole("button", { name: /^Lisbon weekend/ }).first()).toBeVisible({ timeout: 30_000 });
  await chooseGroup(page, /^Lisbon weekend/);

  // The first run, alone: the guests are in the balances, and the way out names them.
  for (const who of ["Ana", "Tom", "Inês"]) await expect(balances(page)).toContainText(who, { timeout: 30_000 });
  await expect(balances(page)).toContainText("you are owed");
  await expect(balances(page)).toContainText(/(Ana|Tom|Inês) → You/);
  await expect(page.locator(".k-list-row", { hasText: "Airport taxi" })).toContainText("Tom paid");
  if (shots) await page.screenshot({ path: `${shots}/split-guests-lisbon.png` });

  // The expense form's pickers name them like anyone else, and "Between" starts with all four.
  await page.getByRole("button", { name: /Add expense/ }).first().click();
  const form = page.locator(".k-form");
  await form.getByLabel("Description").fill("Ginjinha");
  await form.getByLabel(/^Amount/).fill("12");
  const paidBy = form.getByLabel("Paid by");
  await expect(paidBy.locator("option")).toContainText(["—", "Ana", "Tom", "Inês"]);
  await paidBy.selectOption({ label: "Inês" });
  for (const who of ["Ana", "Tom", "Inês"]) await expect(form.locator(".k-person-chip", { hasText: who })).toHaveAttribute("aria-pressed", "true");
  if (shots) await page.screenshot({ path: `${shots}/split-guests-picker.png` });
  await form.getByRole("button", { name: /^(Create|Save)/ }).first().click();
  await page.getByRole("button", { name: "Expenses" }).first().click();
  await expect(page.locator(".k-list-row", { hasText: "Ginjinha" })).toContainText("Inês paid", { timeout: 30_000 });

  // The flat lists none of them: alone, nobody owes anybody — and Invite is where the others come in.
  await chooseGroup(page, /^Flat/);
  await expect(page.locator(".k-list-row", { hasText: "Internet" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Just you so far\. Tap Invite to name who's coming/)).toBeVisible();
  await expect(balances(page)).not.toContainText("Ana");

  await page.getByRole("button", { name: /Invite/ }).first().click();
  await page.getByRole("menuitem", { name: /Name them now/ }).click();
  const names = page.getByRole("dialog", { name: "Who's coming?" });
  await names.getByLabel(/^Names/).fill("Sam and Kai, Tom");
  await names.getByRole("button", { name: "Add them" }).click();
  await expect(page.locator(".k-toast").last()).toHaveText("Sam, Kai, and Tom can be in expenses now");
  // The flat's bills, written with nobody named, are everyone's now: Sam, Kai and Tom owe their part.
  for (const who of ["Sam", "Kai", "Tom"]) await expect(balances(page)).toContainText(who, { timeout: 30_000 });
  await expect(balances(page)).not.toContainText("Ana");
  if (shots) await page.screenshot({ path: `${shots}/split-guests-flat-invited.png` });

  // Tom was already a guest: named again, he is the same Tom, not a second one.
  await page.getByRole("button", { name: /Add expense/ }).first().click();
  await expect(page.locator(".k-form").getByLabel("Paid by").locator("option", { hasText: "Tom" })).toHaveCount(1);
});
