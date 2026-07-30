import { test, expect } from "@playwright/test";

// The Studio: a full-screen surface that generates/edits an app, previews it live, and saves it to a
// local "My Apps" library. The preview is the default view, and it runs TRUSTED — an app authored
// here is the user's own (CLAUDE.md rule 3). It also has to, to be truthful: custom views never run
// untrusted (React is stubbed inside the isolate), so an isolate preview renders every custom view
// as a blank panel and shows the author something their app will never do. The isolate remains the
// fallback for a malformed app, and the path for anything that arrived from someone else.

test("studio previews an app trusted by default and saves it to My Apps", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.locator("header").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();

  // Preview-first: the starter app renders immediately, nothing to click.
  const preview = studio.locator(".k-studio-preview");
  await expect(preview.locator("h1")).toHaveText("My App", { timeout: 30_000 });
  await expect(preview.locator(".k-prov")).toContainText("trusted"); // the user's own app runs direct

  // Generation sources, each gated (no live model call in the test):
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await expect(studio.getByRole("button", { name: /claude -p/ })).toBeEnabled(); // no key needed
  await expect(studio.getByRole("button", { name: "On-device" })).toBeVisible(); // gated on WebGPU
  const modelPicker = studio.getByRole("combobox", { name: "On-device model" });
  await expect(modelPicker).toHaveValue(/Qwen2.5-Coder-1.5B/); // recommended default
  // The on-device engine needs WebGPU, which Firefox does not ship — the control is correctly
  // disabled there, so only exercise it where the capability exists.
  const hasWebGPU = await page.evaluate(() => "gpu" in navigator);
  if (hasWebGPU) {
    await modelPicker.selectOption("Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC");
    await expect(modelPicker).toHaveValue(/Qwen2.5-Coder-0.5B/);
  } else {
    await expect(modelPicker).toBeDisabled();
  }
  const cloud = studio.getByRole("button", { name: "Cloud", exact: true });
  await expect(cloud).toBeDisabled(); // needs a key
  await studio.getByLabel("Anthropic API key").fill("sk-ant-example");
  await expect(cloud).toBeEnabled();

  // With an app previewed, "Modify this app" adapts the current app (no live model call here).
  await expect(studio.getByRole("button", { name: /Modify this app/ })).toBeEnabled();

  // Source is behind a toggle, not the default view.
  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/defineApp/);

  // Save to the local library → it appears in "My Apps".
  await studio.getByRole("button", { name: /Save to My Apps/ }).click();
  await expect(studio.locator(".k-myapps .k-myapp-open")).toHaveText("My App");

  // The saved app is launchable full-screen from its route, and runs TRUSTED: it is the user's own.
  await page.goto("/?user=my-app");
  await expect(page.locator("h1").first()).toHaveText("My App");
  await expect(page.locator(".k-prov").first()).toHaveText(/^trusted/);
  await expect(page.getByRole("button", { name: "Switch app" })).toBeVisible(); // the ⊞ Apps switcher

  // Both directions still work, starting from trusted. Revoke → back into the isolate.
  await page.locator(".k-prov-btn").click();
  const trust = page.locator(".k-trustdialog");
  await expect(trust).toBeVisible();
  await trust.getByRole("button", { name: "Revoke trust" }).click();
  await expect(page.locator("h1").first()).toHaveText("My App", { timeout: 30_000 });
  await expect(page.locator(".k-prov").first()).toHaveText(/^untrusted/);

  // Promote untrusted → trusted: the badge is actionable → a trust prompt → runs DIRECTLY on reload.
  await page.locator(".k-prov-btn").click();
  await page.locator(".k-trustdialog").getByRole("button", { name: "Promote to trusted" }).click();
  // Re-runs the saved source as a real module. h1 still renders → it executed.
  await expect(page.locator("h1").first()).toHaveText("My App", { timeout: 30_000 });
  await expect(page.locator(".k-prov").first()).toHaveText(/^trusted/, { timeout: 30_000 });

  // ⑤ Edit mode: toggle it, click a UI element's ✎, and get a targeted Modify dialog (no live call).
  await page.getByRole("button", { name: "Edit mode" }).click();
  const mark = page.locator(".k-editmark").first();
  await expect(mark).toBeVisible();
  await mark.click();
  const dialog = page.locator(".k-modifydialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Describe the change" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply with AI" })).toBeDisabled(); // needs text
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Edit mode" }).click(); // toggle off before switching apps

  // The ⊞ Apps launcher lists the saved app under My Apps, and can delete it inline.
  await page.getByRole("button", { name: "Switch app" }).click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay.locator(".k-launch-usertile .k-launch-name")).toHaveText("My App");
  await overlay.getByRole("button", { name: "Delete My App" }).click();
  await expect(overlay.locator(".k-launch-usertile")).toHaveCount(0);
});
