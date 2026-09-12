import { test, expect } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// The Studio: a full-screen surface that generates/edits an app, previews it live, and saves it to a
// local "My Apps" library. The preview is the default view, and it runs TRUSTED — an app authored
// here is the user's own (CLAUDE.md rule 3). It also has to, to be truthful: custom views never run
// untrusted (React is stubbed inside the isolate), so an isolate preview renders every custom view
// as a blank panel and shows the author something their app will never do. The isolate remains the
// fallback for a malformed app, and the path for anything that arrived from someone else.

test("studio previews an app trusted by default and saves it to My Apps", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();

  // Preview-first: the starter app renders immediately, nothing to click.
  const preview = studio.locator(".k-studio-preview");
  await expect(preview.locator("h1")).toHaveText("My App", { timeout: 30_000 });
  await expect(preview.locator(".k-app")).toHaveAttribute("data-provenance", "trusted"); // the user's own app runs direct

  // ONE action, and one engine chosen in one place. The starter is an empty page, so the action is
  // "Create"; it becomes "Modify" once there is a real app.
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  const go = studio.getByRole("button", { name: /Create the app|Modify the app/ });
  await expect(go).toHaveText(/Create the app/);
  await expect(go).toBeEnabled(); // claude -p needs no key

  const settings = studio.getByRole("button", { name: "Model settings" });
  await expect(settings).toContainText("claude -p");
  await settings.click();
  const models = page.getByRole("dialog", { name: "Model settings" });
  // A cloud engine cannot run without the user's own key, so the action is gated until there is one.
  await models.getByRole("radio", { name: /Anthropic/ }).check();
  await models.getByRole("button", { name: "Close model settings" }).click();
  await expect(settings).toContainText("Anthropic");
  await expect(go).toBeDisabled();
  await settings.click();
  await models.getByLabel("Anthropic API key").fill("sk-ant-example");
  await models.getByRole("button", { name: "Close model settings" }).click();
  await expect(go).toBeEnabled();

  // The on-device engine needs WebGPU, which Firefox does not ship — it is offered but disabled
  // there, with the reason, rather than silently missing.
  const hasWebGPU = await page.evaluate(() => "gpu" in navigator);
  await settings.click();
  const onDevice = models.getByRole("radio", { name: /^On-device/ });
  if (hasWebGPU) {
    await onDevice.check();
    await expect(models.getByRole("combobox", { name: "On-device model" })).toHaveValue(/Qwen2.5-Coder/);
  } else {
    await expect(onDevice).toBeDisabled();
  }
  await models.getByRole("button", { name: "Close model settings" }).click();


  // Source is behind a toggle, not the default view.
  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/defineApp/);

  // Save to the local library → it appears in "My Apps".
  await studio.getByRole("button", { name: /Save to My Apps/ }).click();
  await expect(studio.locator(".k-myapps .k-myapp-open", { hasText: "My App" })).toHaveCount(1);

  // The saved app is launchable full-screen from its route, and runs TRUSTED: it is the user's own.
  await page.goto("/?user=my-app");
  await expect(page.locator("h1").first()).toHaveText("My App");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");
  await expect(page.getByRole("button", { name: "Switch app" })).toBeVisible(); // the ⊞ Apps switcher

  // Both directions still work, starting from trusted. Revoke → back into the isolate.
  await page.locator(".k-prov-btn").click();
  const trust = page.locator(".k-trustdialog");
  await expect(trust).toBeVisible();
  await trust.getByRole("button", { name: "Revoke trust" }).click();
  await expect(page.locator("h1").first()).toHaveText("My App", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  // Promote untrusted → trusted: the badge is actionable → a trust prompt → runs DIRECTLY on reload.
  await page.locator(".k-prov-btn").click();
  await page.locator(".k-trustdialog").getByRole("button", { name: "Promote to trusted" }).click();
  // Re-runs the saved source as a real module. h1 still renders → it executed.
  await expect(page.locator("h1").first()).toHaveText("My App", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });

  // ⑤ Edit mode: toggle it, click a UI element's ✎, and get a targeted Modify dialog (no live call).
  await page.getByRole("button", { name: "Edit mode" }).click();
  const mark = page.locator(".k-editmark").first();
  await expect(mark).toBeVisible();
  await mark.click();
  const dialog = page.locator(".k-modifydialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Describe the change" })).toBeVisible();
  // Absent, not disabled. With direct structural controls in the same dialog, an "Apply with AI"
  // button sitting there is the only thing that looks like "save" — so a rename reads as needing a
  // model call it does not need. It appears once there is something to send.
  await expect(dialog.getByRole("button", { name: "Apply with AI" })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Describe the change" }).fill("make it a gallery");
  await expect(dialog.getByRole("button", { name: "Apply with AI" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Edit mode" }).click(); // toggle off before switching apps

  // The ⊞ Apps launcher lists the saved app under My Apps, and can delete it inline.
  await page.getByRole("button", { name: "Switch app" }).click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay.locator(".k-launch-tile", { hasText: "My App" })).toHaveCount(1);
  // Deleting an app destroys its records, history and diagnoses, so it asks first — in-app, not a
  // platform dialog.
  await tileAction(overlay, "My App", "delete");
  const confirmDialog = page.locator(".k-dialog");
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("can't be undone");
  await confirmDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(overlay.locator(".k-launch-tile", { hasText: "My App" })).toHaveCount(0);
});
