import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// The version gate while the app is OPEN (KA-22, #63).
//
// Two people share a list. Ana changes the app so it stores its data differently (schema 2, with a
// migration). Bo has the old version open the whole time. Before this, Bo's copy found out only on
// its next open — until then it kept writing v1 records into data Ana's copy was about to migrate,
// and Ana's copy migrated the shared data the moment it opened, without a word to anyone.
//
// What must hold:
//   - Ana is ASKED before the shared data changes, and "Not now" leaves her app read-only;
//   - Bo is locked the moment Ana's version is published, without reloading, and asked to update;
//   - while locked, the add button is drawn inactive and a tap on it explains rather than acts;
//   - each way out (Ana's "Update data", Bo's "Update") actually unlocks.
//
// A unit test cannot see any of this: the lock arrives over a relay from another device, and what
// matters is what the locked page does with a tap.

const V1 = `import { defineApp } from "karta";

export default defineApp({
  id: "shared-todo",
  name: "Shared Todo",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: { label: "Item", icon: "✅", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});
`;

const V2 = V1.replace('version: "1.0.0"', 'version: "2.0.0"')
  .replace("schemaVersion: 1", "schemaVersion: 2")
  .replace('title: { type: "text", required: true } }', 'title: { type: "text", required: true }, done: { type: "boolean", default: false } }')
  .replace(
    "  pages:",
    '  migrations: [{ from: "1.0.0", to: "2.0.0", steps: [{ op: "addField", entity: "item", field: "done", default: false }] }],\n  pages:',
  );

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "shared-todo", name: "Shared Todo", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [V1, opts?.app ?? false] as const,
  );
  return context.newPage();
}

const banner = (p: Page) => p.locator(".k-lock-banner");
const addButton = (p: Page) => p.locator(".k-quick").first();

test("a newer version locks an open copy, and data changes shape only when asked", async ({ browser }) => {
  test.slow();
  expect(V2).toContain("schemaVersion: 2");
  expect(V2).toContain("migrations:");

  // ---- Ana shares, Bo joins ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=shared-todo");
  await expect(a.locator("h1").first()).toHaveText("Shared Todo", { timeout: 30_000 });

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Shared Todo", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=shared-todo");
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });

  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator("h1").first()).toHaveText("Shared Todo", { timeout: 60_000 });
  await expect(b.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });
  // Bo is not locked to begin with: same version as Ana.
  await expect(banner(b)).toHaveCount(0);
  await expect(addButton(b)).not.toHaveAttribute("aria-disabled", "true");

  // ---- Ana saves a version that stores its data differently ----
  await a.getByRole("button", { name: "Studio" }).click();
  const studio = a.locator(".k-studio");
  await studio.getByRole("button", { name: "Shared Todo", exact: true }).click();
  await studio.getByRole("tab", { name: "Source" }).click();
  const source = studio.getByRole("textbox", { name: "App source" });
  await expect(source).toContainText("schemaVersion: 1", { timeout: 30_000 });
  await source.fill(V2);
  await studio.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(
      async () =>
        a
          .evaluate(() => {
            const apps = JSON.parse(localStorage.getItem("karta:user-apps") ?? "[]") as { id: string; source: string }[];
            return apps.find((x) => x.id === "shared-todo")?.source ?? "";
          })
          .catch(() => ""),
      { timeout: 30_000 },
    )
    .toContain("schemaVersion: 2");

  // Opening it publishes the new version, then ASKS before touching the shared data.
  await a.goto("/?user=shared-todo");
  const ask = a.locator(".k-dialog", { hasText: "changes how “Shared Todo” stores its data" });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask).toContainText("Bo will need to update their copy too");
  await ask.getByRole("button", { name: "Not now" }).click();
  await expect(banner(a)).toContainText("still uses the previous version", { timeout: 30_000 });
  await expect(addButton(a)).toHaveAttribute("aria-disabled", "true");

  // ---- THE CLAIM: Bo, still open on the old version, is locked without reloading ----
  const live = b.locator(".k-dialog", { hasText: "was just updated to a newer version" });
  await expect(live).toBeVisible({ timeout: 30_000 });
  await live.getByRole("button", { name: "Not now" }).click();
  await expect(banner(b)).toContainText("This app has a newer version", { timeout: 10_000 });
  await expect(addButton(b)).toHaveAttribute("aria-disabled", "true");
  await expect(addButton(b)).toHaveCSS("opacity", "0.45");

  // A tap on the inactive add button explains, and opens no form to fill in for nothing. `force`:
  // Playwright will not click an `aria-disabled` control, and a person's finger will.
  await addButton(b).click({ force: true });
  await expect(b.locator(".k-toast", { hasText: "Read-only" })).toBeVisible();
  await expect(b.locator(".k-form-fields")).toHaveCount(0);

  // ---- The ways out ----
  await banner(a).getByRole("button", { name: "Update data" }).click();
  await expect(banner(a)).toHaveCount(0, { timeout: 30_000 });
  await expect(addButton(a)).not.toHaveAttribute("aria-disabled", "true");
  const migrated = await a.evaluate(() => localStorage.getItem("karta:user-apps"));
  expect(migrated).toContain("schemaVersion: 2");

  await banner(b).getByRole("button", { name: "Update" }).click();
  await expect(b.locator("h1").first()).toHaveText("Shared Todo", { timeout: 60_000 });
  await expect(b.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });
  await expect(banner(b)).toHaveCount(0);
  await expect(addButton(b)).not.toHaveAttribute("aria-disabled", "true");
  const bSource = await b.evaluate(() => localStorage.getItem("karta:user-apps"));
  expect(bSource).toContain("schemaVersion: 2");

  await ctxA.close();
  await ctxB.close();
});
