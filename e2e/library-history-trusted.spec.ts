import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSource } from "./studio-helpers.js";

// Libraries over time (#266) and the piano package (#258), in a real browser. Beside
// libraries-trusted.spec.ts: an upgrade is a History version with a lock.json diff, going back to
// it works with every request off this machine refused, and the piano app installs from its
// package with its helpers as modules and no build step.
//
// The library is a small one served in place of esm.sh, shaped like esm.sh's answers.

const ROOT = "https://esm.sh/tally-stats@1.2.0?bundle";
const SITE: Record<string, string> = {
  [ROOT]: `/* esm.sh - tally-stats@1.2.0 */\nexport * from "/tally-stats@1.2.0/es2022/tally-stats.bundle.mjs";\n`,
  "https://esm.sh/tally-stats@1.2.0/es2022/tally-stats.bundle.mjs": `import { round } from "/tiny-round@0.3.0/es2022/tiny-round.mjs";\nexport const mean = (xs) => round(xs.reduce((a, b) => a + b, 0) / xs.length);\nexport const describe = (xs) => "mean " + mean(xs) + " of " + xs.length;\n`,
  "https://esm.sh/tiny-round@0.3.0/es2022/tiny-round.mjs": `export const round = (n) => Math.round(n * 100) / 100;\n`,
  // 1.2.1, for the upgrade: the same shape, a different answer.
  "https://esm.sh/tally-stats@1.2.1?bundle": `export * from "/tally-stats@1.2.1/es2022/tally-stats.bundle.mjs";\n`,
  "https://esm.sh/tally-stats@1.2.1/es2022/tally-stats.bundle.mjs": `export const describe = (xs) => "average " + xs.length;\n`,
};

/** Serve the library site; every request to it is counted. */
async function serveLibraries(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route("https://esm.sh/**", (route) => {
    const url = route.request().url();
    asked.push(url);
    const body = SITE[url];
    return body === undefined
      ? route.fulfill({ status: 404, body: "not found" })
      : route.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body });
  });
  return asked;
}

/** Nothing leaves this machine from here on: every request to another host is refused, and counted. */
async function cutTheNetwork(context: BrowserContext): Promise<string[]> {
  const refused: string[] = [];
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      refused.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  return refused;
}

/** An app whose list shows what the library computed, through one of the app's own modules. */
const tallySource = (id: string, url = ROOT) => `import { defineApp } from "potyro";
import { summary } from "./format.js";
import { describe } from "${url}";

export default defineApp({
  id: "${id}",
  name: "Tally",
  icon: "🔢",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    score: {
      label: "Score",
      displayField: "title",
      fields: { title: { type: "text", required: true }, values: { type: "text" } },
      computed: { summary: (s) => summary(String(s.values ?? "")), raw: (s) => describe(String(s.values ?? "").split(",").map(Number)) },
    },
  },
  pages: [{ id: "all", title: "Scores", view: { type: "list", entity: "score", display: { primary: "title", secondary: (s) => s.summary + " | " + s.raw } } }],
});
`;
const FORMAT = `import { describe } from "${ROOT}";\nexport const summary = (values: string): string => describe(values.split(",").map(Number));\n`;
const SEED = JSON.stringify({ score: [{ title: "Scales", values: "2,3,4.5" }] });
const RENDERED = "mean 3.17 of 3"; // (2 + 3 + 4.5) / 3, rounded by the second package

const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });

async function addFromDevice(page: Page, files: ReturnType<typeof file>[]) {
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles(files);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

const tallyFiles = (id: string) => [file("tally.app.ts", tallySource(id)), file("format.ts", FORMAT), file("seed.json", SEED, "application/json")];

test.use({ viewport: { width: 1280, height: 800 } });

test("a library upgrade is a version in History, with the lock.json change beside the code's", async ({ page, context }) => {
  await serveLibraries(context);
  await page.goto("/");
  let dialog = await addFromDevice(page, tallyFiles("tally-upgrade"));
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Scales" })).toContainText(RENDERED, { timeout: 30_000 });

  // The next build moves the app to 1.2.1, its main file and its module.
  await page.goto("/");
  const next = (s: string) => s.replaceAll("tally-stats@1.2.0", "tally-stats@1.2.1");
  dialog = await addFromDevice(page, [file("tally.app.ts", next(tallySource("tally-upgrade"))), file("format.ts", next(FORMAT)), file("seed.json", SEED, "application/json")]);
  await expect(dialog.getByRole("region", { name: "About Tally" })).toContainText("fetches tally-stats 1.2.1");
  await dialog.getByRole("button", { name: "Update app" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Scales" })).toContainText("average 3 | average 3", { timeout: 30_000 });

  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  const tools = await openSource(page, studio);
  await tools.getByRole("tab", { name: "History" }).click();
  const history = studio.locator(".k-studio-history");
  const entry = (seq: string) => history.locator(".k-timeline-entry").filter({ has: page.locator(".k-history-seq", { hasText: seq }) });
  await entry("v2").getByRole("button").first().click();
  await expect(history.locator(".k-history-lock")).toContainText("lock.json — the libraries it uses");
  await expect(history.locator(".k-history-lock .k-diff-add").first()).toContainText("tally-stats@1.2.1");
  await expect(history.locator(".k-diff").first().locator(".k-diff-del")).toContainText("tally-stats@1.2.0?bundle");

  // Back to v1, with no network: its library's bytes are still on the device. History keeps the main
  // file, not the module (#258), so the module the app has now still imports 1.2.1 — which has to
  // stay, or the restored app would not open.
  await cutTheNetwork(context);
  await entry("v1").getByRole("button").first().click();
  await history.getByRole("button", { name: "Restore v1" }).click();
  await expect(history.locator(".k-history-now")).toHaveCount(1);
  await page.goto("/?user=tally-upgrade");
  await expect(page.getByRole("listitem").filter({ hasText: "Scales" })).toContainText(`average 3 | ${RENDERED}`, { timeout: 30_000 });
});

test("the piano package installs with its helpers as modules, no build step, and runs", async ({ page }) => {
  // Packed exactly as `pnpm --filter @potyro/app-piano build` packs it.
  const dir = mkdtempSync(join(tmpdir(), "piano-e2e-"));
  const piano = join(process.cwd(), "apps/piano");
  execFileSync("node", [join(process.cwd(), "scripts/pack-app.mjs"), "piano.app.tsx", "plan.json", "-o", join(dir, "piano.potyro-app.zip")], { cwd: piano, env: { ...process.env, INIT_CWD: piano } });

  await page.goto("/");
  const dialog = await addFromDevice(page, [{ name: "piano.potyro-app.zip", mimeType: "application/zip", buffer: readFileSync(join(dir, "piano.potyro-app.zip")) }]);
  const card = dialog.getByRole("region", { name: /About Piano/ });
  await expect(card).toContainText(/plan\.ts, progress\.ts,? and styles\.ts/);
  // Its plan and its five catalogs (docs/30): six files, summed up.
  await expect(card).toContainText(/Comes with\s*6 files/);
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  // Today is drawn by piano.app.tsx from plan.json, with plan.ts and progress.ts doing the reading.
  await expect(page.getByText("Warm-up").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You can name any white key in under 2 seconds.").first()).toBeVisible();
});
