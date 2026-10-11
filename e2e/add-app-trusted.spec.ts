import { test, expect, type Page } from "@playwright/test";

// Add an app (#253), in a real browser: from files on this device, from pasted source, from a link.
//
// The app reads a file it ships with (`plan.json`) and starts with one seeded record. The checks
// are what a person sees: the card names what is coming in, the app opens sealed unless they said
// "I wrote this", the shipped file is readable from the app, and an update keeps the record and
// replaces the file. Owner decisions, 2026-10-11: sealed by default; "mine" for file and paste only;
// Replace keeps data.

const source = (name: string) => `import { defineApp } from "potyro";
export default defineApp({
  id: "practice",
  name: "${name}",
  icon: "🎹",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    week: {
      label: "Week",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
      actions: {
        showPlan: async (_w, ctx) => {
          const plan = await ctx.files.json("plan.json");
          ctx.ui.toast(plan.weeks + " weeks");
        },
      },
    },
  },
  pages: [
    { id: "all", title: "Weeks", view: { type: "list", entity: "week", display: { primary: "title" }, onOpen: { page: "week", param: { weekId: "id" } } } },
    { id: "week", title: "Week", hidden: true, view: { type: "detail", entity: "week", param: "weekId", actions: ["showPlan"] } },
  ],
});
`;

const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });

async function openAdd(page: Page): Promise<import("@playwright/test").Locator> {
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addFromDevice(page: Page, files: ReturnType<typeof file>[]): Promise<import("@playwright/test").Locator> {
  const dialog = await openAdd(page);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles(files);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

async function showPlan(page: Page): Promise<void> {
  await page.getByRole("listitem").filter({ hasText: "Week one" }).first().click();
  await page.getByRole("button", { name: "Show Plan" }).click();
}

test.use({ viewport: { width: 1280, height: 800 } });

test("from this device: the card says what comes in, it opens sealed, reads its own file, and an update keeps the data", async ({ page }) => {
  await page.goto("/");
  const dialog = await addFromDevice(page, [
    file("practice.app.tsx", source("Practice")),
    file("plan.json", '{"weeks":12}', "application/json"),
    file("seed.json", '{"week":[{"title":"Week one"}]}', "application/json"),
  ]);

  const card = dialog.getByRole("region", { name: "About Practice" });
  await expect(card).toContainText("New on this device");
  await expect(card).toContainText("Week");
  await expect(card).toContainText("plan.json");
  await expect(card).toContainText("1 record");
  await expect(dialog.getByRole("checkbox", { name: /I wrote this/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Add app" }).click();

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await showPlan(page);
  await expect(page.locator(".k-toast").last()).toHaveText("12 weeks");

  // A newer build of the same app: the card knows it is here, Replace is the choice, and after it
  // the record is still the one record and the shipped file is the new one.
  await page.goto("/");
  const again = await addFromDevice(page, [
    file("practice.app.tsx", source("Practice")),
    file("plan.json", '{"weeks":14}', "application/json"),
    file("seed.json", '{"week":[{"title":"Week one"}]}', "application/json"),
  ]);
  await expect(again.getByRole("region", { name: "About Practice" })).toContainText("Already on this device");
  await expect(again.getByRole("radio", { name: /Replace it, keep its data/ })).toBeChecked();
  await again.getByRole("button", { name: "Update app" }).click();

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.getByRole("listitem").filter({ hasText: "Week one" })).toHaveCount(1);
  await showPlan(page);
  await expect(page.locator(".k-toast").last()).toHaveText("14 weeks");
});

test("pasted source marked as mine runs directly", async ({ page }) => {
  await page.goto("/");
  const dialog = await openAdd(page);
  await dialog.getByRole("button", { name: /Paste the source/ }).click();
  await dialog.getByRole("textbox", { name: "The app's source" }).fill(source("Pasted"));
  await dialog.getByRole("button", { name: "Check it" }).click();
  await expect(dialog.getByRole("region", { name: "About Pasted" })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(page.locator("h1").first()).toHaveText("Pasted");
});

test("an install link opens the dialog with the link, and the app comes in sealed with no way to vouch for it", async ({ page }) => {
  await page.route("https://apps.example.test/practice.app.tsx", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: source("Linked") }),
  );
  await page.goto(`/#add=${encodeURIComponent("https://apps.example.test/practice.app.tsx")}`);
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  await expect(dialog.getByRole("textbox", { name: "Link to the app" })).toHaveValue("https://apps.example.test/practice.app.tsx");
  await dialog.getByRole("button", { name: "Fetch" }).click();

  await expect(dialog.getByRole("region", { name: "About Linked" })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("checkbox", { name: /I wrote this/ })).toHaveCount(0);
  await expect(dialog).toContainText("sealed box");
  await dialog.getByRole("button", { name: "Add app" }).click();

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
});

test("a file that is not an app is refused with a reason, and nothing is added", async ({ page }) => {
  await page.goto("/");
  const dialog = await openAdd(page);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([file("notes.md", "# not an app")]);
  await expect(dialog.getByRole("alert")).toContainText("None of these is an app");
});
