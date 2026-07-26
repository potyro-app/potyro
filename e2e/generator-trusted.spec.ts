import { test, expect } from "@playwright/test";

// The "Create an app" panel: paste/edit a .app.ts and preview it. This exercises the whole
// runtime-execution path in a real browser — esbuild-wasm bundles the source on demand, and the
// QuickJS-WASM isolate runs it untrusted. Proves arbitrary app logic runs safely client-side.

test("create-an-app panel bundles + previews an app in the isolate", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.locator("header").getByRole("button", { name: "New app" }).click();
  const panel = page.locator(".k-gen-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "App source" })).toHaveValue(/defineApp/);

  // Three generation sources, each gated (no live model call in the test):
  await panel.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await expect(panel.getByRole("button", { name: /claude -p/ })).toBeEnabled(); // no key needed
  await expect(panel.getByRole("button", { name: "On-device" })).toBeVisible(); // gated on WebGPU (env-dependent)
  const cloud = panel.getByRole("button", { name: "Cloud", exact: true });
  await expect(cloud).toBeDisabled(); // needs a key
  await panel.getByLabel("Anthropic API key").fill("sk-ant-example");
  await expect(cloud).toBeEnabled();

  // Bundle (esbuild-wasm) + run untrusted (QuickJS isolate) + render the preview.
  await panel.getByRole("button", { name: "Preview" }).click();
  const preview = page.locator(".k-gen-preview");
  await expect(preview.locator("h1")).toHaveText("My App", { timeout: 30_000 });
  await expect(preview.locator(".k-prov")).toHaveText("untrusted"); // ran in the isolate, not directly
});
