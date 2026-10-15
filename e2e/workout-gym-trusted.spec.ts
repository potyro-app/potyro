import { test, expect } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The gym flow, in a REAL browser, against the app as actually installed in My Apps.
//
// Everything before this was checked in a Node harness, which does NOT exercise the path the app
// really takes: `loadTrustedModule` bundles the source in-browser with esbuild-wasm, resolving
// `potyro`/`react` to the shell's own modules, then imports it from a blob URL. A custom view that
// works under Node's bundler can still fail there. This test walks what a person does:
//
//   install → open → Start workout → Load routine / ＋ Exercise → tap a set → End

// A COMMITTED fixture, not the generator's output directory.
//
// This used to read `packages/generator/eval-out/migrated/`, which is gitignored build output — so
// the file existed only on the machine that generated it. In a fresh checkout the `readFileSync`
// threw at collection time and took the WHOLE Playwright run down with it, which is why CI had no
// browser coverage at all rather than one red spec.
//
// It is a generated app on purpose: the point of this test is that something the model wrote
// survives the real in-browser bundler. Pinning that exact source is what makes the test
// reproducible — regenerating it would quietly change what is under test. Resolved relative to this
// file rather than `process.cwd()`, so it does not depend on where the runner was invoked.
const SOURCE = readFileSync(fileURLToPath(new URL("./fixtures/workout-sessions.app.tsx", import.meta.url)), "utf8");

test.beforeEach(async ({ page }) => {
  // Seed My Apps before any script runs, exactly like the console installer does.
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "potyro:user-apps",
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
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

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
// opposite of how it actually ran. The tile must reflect the record: a trusted app carries no
// sandbox shield (#87) — and no pill of any kind.
test("the launcher reports a saved app's real provenance", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator(".k-launch-usertile").filter({ hasText: "Workout Sessions" });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(tile.getByRole("img", { name: "Runs sealed" })).toHaveCount(0);
  await expect(tile.locator(".k-prov")).toHaveCount(0);
});
