import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The gym flow, in a REAL browser, against the app as actually installed in My Apps.
//
// Everything before this was checked in a Node harness, which does NOT exercise the path the app
// really takes: `loadTrustedModule` bundles the source in-browser with esbuild-wasm, resolving
// `karta`/`react` to the shell's own modules, then imports it from a blob URL. A custom view that
// works under Node's bundler can still fail there. This test walks what a person does:
//
//   install → open → Start workout → Load routine / ＋ Exercise → tap a set → End

const SOURCE = readFileSync(
  join(process.cwd(), "packages/generator/eval-out/migrated/workout-sessions.app.tsx"),
  "utf8",
);

test.beforeEach(async ({ page }) => {
  // Seed My Apps before any script runs, exactly like the console installer does.
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "workout-sessions", name: "Workout Sessions", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [SOURCE],
  );
});

test("a workout can be started, filled and logged without a form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/?user=workout-sessions");
  await expect(page.locator("h1").first()).toContainText("Workout", { timeout: 30_000 });

  // It must run TRUSTED: custom views are stubbed out in the isolate, so an untrusted load renders
  // the runner as a blank panel.
  await expect(page.locator(".k-prov").first()).toContainText("trusted");

  // --- library: create an exercise through the normal form -------------------------------------
  await page.getByRole("button", { name: /New exercise/ }).click();
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();
  await form.getByLabel(/^Name/).fill("Bench press");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();

  // --- gym: one tap starts a workout, no form --------------------------------------------------
  await page.getByRole("button", { name: /Start workout/ }).click();
  await expect(page.locator(".k-modal")).toHaveCount(0); // no create form appeared
  await expect(page.getByText(/series/).first()).toBeVisible({ timeout: 15_000 });

  // The runner's own controls must be present.
  await expect(page.getByRole("button", { name: /Load routine/ })).toBeVisible();
  // Scope to the runner: the header quick-bar also has a button matching /Exercise/ ("New exercise"),
  // and it comes first in the DOM.
  const runner = page.locator("main");
  const addExercise = runner.getByRole("button", { name: "＋ Exercise" });
  await expect(addExercise).toBeVisible();

  // --- the picker: a modal list, not a numbered prompt ------------------------------------------
  await addExercise.click();
  const picker = page.locator(".k-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel("Filter the list")).toBeVisible();
  await picker.getByRole("button", { name: /Bench press/ }).click();
  await expect(picker).toBeHidden();

  // --- log a set --------------------------------------------------------------------------------
  const first = page.getByRole("button", { name: /Bench press series 1/ });
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText("1 / 3 series")).toBeVisible();

  // Rest countdown starts itself.
  await expect(page.getByText("REST", { exact: true })).toBeVisible();

  // The clock actually advances (the earlier version was frozen at 00:00).
  const clockText = async () => (await page.locator("text=/^\\d{2}:\\d{2}$/").first().textContent()) ?? "";
  const t0 = await clockText();
  await page.waitForTimeout(2200);
  expect(await clockText()).not.toBe(t0);

  // --- weight is editable mid-workout -----------------------------------------------------------
  const kg = page.getByLabel("kg").first();
  await kg.fill("65");
  await kg.blur();
  await expect(kg).toHaveValue("65");

  await page.getByRole("button", { name: /End/ }).click();

  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

// The launcher hardcoded `badge="untrusted"` on every saved app, so a trusted app was labelled the
// opposite of how it actually ran. The badge must reflect the record.
test("the launcher reports a saved app's real provenance", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator(".k-launch-usertile").filter({ hasText: "Workout Sessions" });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(tile).toContainText("trusted");
  await expect(tile).not.toContainText("untrusted");
});
