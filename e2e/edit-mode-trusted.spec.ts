import { test, expect } from "@playwright/test";

// Edit mode: point at something in a running app, describe a change, and the agent rewrites the app.
//
// This path had its OWN copy of the generator client. When the endpoint became job-based only the
// Studio's copy was updated, so every edit died with "can't access property 'match', text is
// undefined" — the POST now returns { id }, and the stale copy read `.text`. Nothing caught it
// because no test drove Edit mode's request. This one does.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "edit-target",
  name: "Edit Target",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [{ id: "add-note", label: "Add note", icon: "＋", entity: "note", open: true }],
  entities: {
    note: {
      label: "Note",
      icon: "📝",
      displayField: "title",
      fields: { title: { type: "text", required: true }, body: { type: "text", multiline: true } },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "edit-target", name: "Edit Target", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER],
  );
});

test("edit mode reaches the generator without a client/endpoint mismatch", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(m.text());
  });
  const calls: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/__generate")) calls.push(`${r.request().method()} ${r.status()}`);
  });

  await page.goto("/?user=edit-target");
  await expect(page.locator("h1").first()).toHaveText("Edit Target", { timeout: 30_000 });

  // Point at the quick-action bar, exactly as a user does.
  await page.getByRole("button", { name: "Edit mode" }).click();
  const mark = page.locator(".k-editmark").first();
  await expect(mark).toBeVisible();
  await mark.click();

  const dialog = page.locator(".k-modifydialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Describe the change" }).fill("rename the quick action to 'New note'");
  await dialog.getByRole("button", { name: "Apply with AI" }).click();

  // The old bug threw synchronously on the POST response, before any poll. Requiring a POST *and* a
  // polling GET pins the client to the job-based contract.
  await expect(dialog.getByText(/Working…/)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => calls.filter((c) => c.startsWith("GET")).length, { timeout: 60_000 })
    .toBeGreaterThan(0);

  expect(calls.some((c) => c.startsWith("POST 202"))).toBe(true);
  expect(
    failures.filter((f) => /match|undefined/.test(f)),
    `client/endpoint mismatch:\n${failures.join("\n")}`,
  ).toEqual([]);
});
